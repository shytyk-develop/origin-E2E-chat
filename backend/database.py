# backend/database.py

import psycopg2
import json
import os
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

# --- USER FUNCTIONS ---

def save_user(username: str, public_key: str):
    """Saves or updates a user's key (Upsert)"""
    conn = get_connection()
    cursor = conn.cursor()
    
    query = '''
        INSERT INTO users (username, public_key) 
        VALUES (%s, %s)
        ON CONFLICT (username) 
        DO UPDATE SET public_key = EXCLUDED.public_key;
    '''
    cursor.execute(query, (username, public_key))
    conn.commit()
    conn.close()

def get_all_users() -> list:
    """Returns a list of all registered users"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute('SELECT username, public_key FROM users')
    rows = cursor.fetchall()
    conn.close()
    
    return [{"username": row[0], "public_key": row[1]} for row in rows]

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