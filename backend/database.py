# backend/database.py

import psycopg2
import json
import os
import bcrypt
from dotenv import load_dotenv

# Load variables from .env (for local development)
load_dotenv()

# Get database connection string
DATABASE_URL = os.getenv("DATABASE_URL")

def get_connection():
    """Creates and returns a connection to the Neon database"""
    return psycopg2.connect(DATABASE_URL)

def init_db():
    """Creates tables in PostgreSQL if they do not exist yet"""
    conn = get_connection()
    cursor = conn.cursor()
    
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
    
    # Safely migrate the schema to support multi-device syncing without dropping data
    cursor.execute('''
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS encrypted_private_key TEXT NOT NULL DEFAULT '';
    ''')
    
    # Offline messages table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS offline_messages (
            id SERIAL PRIMARY KEY,
            sender VARCHAR(255) NOT NULL,
            receiver VARCHAR(255) NOT NULL,
            content TEXT NOT NULL
        )
    ''')
    
    conn.commit()
    conn.close()

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
    
    # CONVERT THE DICTIONARY INTO A STRING
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
        conn.close()

def login_user_db(username: str, password: str):
    """Authenticates a user and returns their keys for cross-device synchronization"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT password_hash, public_key, encrypted_private_key FROM users WHERE username = %s', (username,))
    row = cursor.fetchone()
    conn.close()
    
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

def get_all_users() -> list:
    """Return a list of all registered users"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT username, public_key FROM users')
    rows = cursor.fetchall()
    conn.close()
    
    users = []
    for row in rows:
        username = row[0]
        public_key_str = row[1]
        
        # CONVERT THE DB STRING BACK INTO A DICTIONARY
        try:
            public_key_obj = json.loads(public_key_str)
        except (json.JSONDecodeError, TypeError):
            public_key_obj = public_key_str 
            
        users.append({"username": username, "public_key": public_key_obj})
        
    return users

# --- MESSAGE FUNCTIONS ---

def save_offline_message(sender: str, receiver: str, content: list):
    """Saves message for an offline user"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO offline_messages (sender, receiver, content) VALUES (%s, %s, %s)', 
        (sender, receiver, json.dumps(content))
    )
    conn.commit()
    conn.close()

def get_and_delete_offline_messages(receiver: str) -> list:
    """Fetches all accumulated messages for a user and removes them from the queue"""
    conn = get_connection()
    cursor = conn.cursor()
    
    # Read messages
    cursor.execute('SELECT sender, content FROM offline_messages WHERE receiver = %s', (receiver,))
    rows = cursor.fetchall()
    
    # Delete messages
    cursor.execute('DELETE FROM offline_messages WHERE receiver = %s', (receiver,))
    
    conn.commit()
    conn.close()
    
    return [{"sender": row[0], "content": json.loads(row[1])} for row in rows]

# Initialize tables on startup
init_db()