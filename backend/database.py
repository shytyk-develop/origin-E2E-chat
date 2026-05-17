# backend/database.py

import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import execute_values
import json
import os
import bcrypt
from dotenv import load_dotenv

# Load variables from .env (for local development)
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# --- HIGH LOAD CONFIGURATION: CONNECTION POOL ---
# Initialize a global connection pool (min 2, max 20 threads/connections)
db_pool = ThreadedConnectionPool(2, 20, dsn=DATABASE_URL)

def get_connection():
    """Retrieves a functional connection from the connection pool"""
    return db_pool.getconn()

def release_connection(conn):
    """Safely returns a connection back to the pool"""
    db_pool.putconn(conn)

def init_db():
    """Creates tables and optimization indexes in PostgreSQL if they do not exist"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Users table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                username VARCHAR(255) PRIMARY KEY,
                public_key TEXT NOT NULL
            )
        ''')
        
        cursor.execute('''
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
        ''')
        
        cursor.execute('''
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT NOT NULL DEFAULT '';
        ''')
        
        # Offline messages table (signals/notifications backup)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS offline_messages (
                id SERIAL PRIMARY KEY,
                sender VARCHAR(255) NOT NULL,
                receiver VARCHAR(255) NOT NULL,
                content TEXT NOT NULL
            )
        ''')
        
        # NEW: Permanent double-encrypted chat history database table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_history (
                id SERIAL PRIMARY KEY,
                sender VARCHAR(255) NOT NULL,
                receiver VARCHAR(255) NOT NULL,
                content_recipient TEXT NOT NULL,  -- Encrypted via recipient's public key
                content_sender TEXT NOT NULL,     -- Encrypted via sender's own public key
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        # CRITICAL INDEX OPTIMIZATION: Prevents full table scans on high volumes
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_chat_history_routing 
            ON chat_history (sender, receiver);
        ''')
        
        conn.commit()
    finally:
        release_connection(conn)

# --- PASSWORD CRYPTOGRAPHY HELPERS ---

def hash_password(password: str) -> str:
    """Hashes a plain-text password using bcrypt"""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain-text password against a hashed match"""
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

# --- USER FUNCTIONS ---

def register_user_db(username: str, password: str, public_key, encrypted_private_key: str) -> bool:
    """Registers a new user with a hashed password, public key, and synced private key"""
    conn = get_connection()
    cursor = conn.cursor()
    
    if isinstance(public_key, dict):
        public_key_str = json.dumps(public_key)
    else:
        public_key_str = public_key
    
    hashed_pw = hash_password(password)
    
    try:
        cursor.execute(
            'INSERT INTO users (username, password_hash, public_key, encrypted_private_key) VALUES (%s, %s, %s, %s)', 
            (username, hashed_pw, public_key_str, encrypted_private_key)
        )
        conn.commit()
        return True
    except psycopg2.IntegrityError:
        conn.rollback()
        return False
    finally:
        release_connection(conn)

def login_user_db(username: str, password: str):
    """Authenticates a user and returns their keys for cross-device synchronization"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT password_hash, public_key, encrypted_private_key FROM users WHERE username = %s', (username,))
        row = cursor.fetchone()
        
        if row is None:
            return None
            
        db_hash, db_pub_key_str, db_enc_priv_key = row[0], row[1], row[2]
        
        if verify_password(password, db_hash):
            try:
                pub_key_obj = json.loads(db_pub_key_str)
            except (json.JSONDecodeError, TypeError):
                pub_key_obj = db_pub_key_str
                
            return {
                "public_key": pub_key_obj,
                "encrypted_private_key": db_enc_priv_key
            }
        return None
    finally:
        release_connection(conn)

def get_all_users() -> list:
    """Return a list of all registered users"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('SELECT username, public_key FROM users')
        rows = cursor.fetchall()
        
        users = []
        for row in rows:
            username = row[0]
            public_key_str = row[1]
            
            try:
                public_key_obj = json.loads(public_key_str)
            except (json.JSONDecodeError, TypeError):
                public_key_obj = public_key_str 
                
            users.append({"username": username, "public_key": public_key_obj})
        return users
    finally:
        release_connection(conn)

# --- OPTIMIZED MESSAGE FUNCTIONS WITH BATCHING & PAGINATION ---

def save_chat_history_batch(messages_batch: list):
    """Executes a highly efficient high-load bulk INSERT for history packets"""
    if not messages_batch:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Transforming objects into a structured data tuple for psycopg2 extras
        query_data = [
            (msg['sender'], msg['receiver'], json.dumps(msg['content_recipient']), json.dumps(msg['content_sender']))
            for msg in messages_batch
        ]
        execute_values(
            cursor,
            "INSERT INTO chat_history (sender, receiver, content_recipient, content_sender) VALUES %s",
            query_data
        )
        conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        release_connection(conn)

def get_chat_history_db(user: str, partner: str, limit: int = 50, offset: int = 0) -> list:
    """Fetches paginated E2EE chunks using the optimized composited b-tree database index"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT sender, receiver, content_recipient, content_sender 
            FROM chat_history 
            WHERE (sender = %s AND receiver = %s) OR (sender = %s AND receiver = %s)
            ORDER BY id DESC
            LIMIT %s OFFSET %s
        ''', (user, partner, partner, user, limit, offset))
        rows = cursor.fetchall()
        
        # Reverse the chunk before returning so it displays chronologically (oldest to newest)
        rows.reverse()
        
        return [{
            "sender": r[0],
            "receiver": r[1],
            "content_recipient": json.loads(r[2]),
            "content_sender": json.loads(r[3])
        } for r in rows]
    finally:
        release_connection(conn)

def save_offline_message(sender: str, receiver: str, content: list):
    """Saves message for an offline user"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            'INSERT INTO offline_messages (sender, receiver, content) VALUES (%s, %s, %s)', 
            (sender, receiver, json.dumps(content))
        )
        conn.commit()
    finally:
        release_connection(conn)

def get_and_delete_offline_messages(receiver: str) -> list:
    """Fetches all accumulated messages for a user and removes them from the queue"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Read messages
        cursor.execute('SELECT sender, content FROM offline_messages WHERE receiver = %s', (receiver,))
        rows = cursor.fetchall()
        
        # Delete messages
        cursor.execute('DELETE FROM offline_messages WHERE receiver = %s', (receiver,))
        conn.commit()
        return [{"sender": row[0], "content": json.loads(row[1])} for row in rows]
    finally:
        release_connection(conn)

# Initialize tables on startup
init_db()