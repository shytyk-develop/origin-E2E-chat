# backend/database.py

import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from psycopg2.extras import execute_values
import json
import os
import bcrypt
from dotenv import load_dotenv
from typing import Optional
from datetime import datetime, timezone

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

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_users_username_lower
            ON users (LOWER(username));
        ''')
        
        # Offline messages table (signals/notifications backup)
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS offline_messages (
                id SERIAL PRIMARY KEY,
                sender VARCHAR(255) NOT NULL,
                receiver VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                chat_history_id INTEGER,
                client_message_id VARCHAR(80),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            ALTER TABLE offline_messages
            ADD COLUMN IF NOT EXISTS chat_history_id INTEGER;
        ''')

        cursor.execute('''
            ALTER TABLE offline_messages
            ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(80);
        ''')

        cursor.execute('''
            ALTER TABLE offline_messages
            ADD COLUMN IF NOT EXISTS timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
        ''')
        
        # NEW: Permanent double-encrypted chat history database table
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS chat_history (
                id SERIAL PRIMARY KEY,
                sender VARCHAR(255) NOT NULL,
                receiver VARCHAR(255) NOT NULL,
                content_recipient TEXT NOT NULL,  -- Encrypted via recipient's public key
                content_sender TEXT NOT NULL,     -- Encrypted via sender's own public key
                client_message_id VARCHAR(80),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')

        cursor.execute('''
            ALTER TABLE chat_history
            ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(80);
        ''')
        
        # CRITICAL INDEX OPTIMIZATION: Prevents full table scans on high volumes
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_chat_history_routing 
            ON chat_history (sender, receiver);
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_chat_history_sender
            ON chat_history (sender);
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_chat_history_receiver
            ON chat_history (receiver);
        ''')

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_chat_history_timestamp
            ON chat_history (timestamp);
        ''')

        cursor.execute('''
            CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_history_client_message_id
            ON chat_history (client_message_id)
            WHERE client_message_id IS NOT NULL;
        ''')

        cursor.execute('''
            ALTER TABLE chat_history
            ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP;
        ''')

        cursor.execute('''
            ALTER TABLE chat_history
            ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS conversation_read_state (
                username VARCHAR(255) NOT NULL,
                partner VARCHAR(255) NOT NULL,
                last_read_message_id INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (username, partner)
            )
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

def search_users_db(query: str, current_username: str, limit: int = 20) -> list:
    """Search users by username without returning the whole database."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        safe_limit = max(1, min(limit, 50))
        normalized_query = query.lower().strip()
        like_query = normalized_query.replace('\\', '\\\\').replace('_', '\\_')
        cursor.execute('''
            SELECT username, public_key
            FROM users
            WHERE username <> %s
              AND username ~ '^[a-z0-9_]+$'
              AND username LIKE %s ESCAPE '\\'
            ORDER BY
                CASE
                    WHEN username = %s THEN 0
                    WHEN username LIKE %s ESCAPE '\\' THEN 1
                    ELSE 2
                END,
                username
            LIMIT %s
        ''', (
            current_username,
            f'%{like_query}%',
            normalized_query,
            f'{like_query}%',
            safe_limit
        ))
        rows = cursor.fetchall()
        return [_user_row_to_dict(row) for row in rows]
    finally:
        release_connection(conn)

def conversation_exists_db(user: str, partner: str) -> bool:
    """Returns True when at least one message exists between two users."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT 1
            FROM chat_history
            WHERE (sender = %s AND receiver = %s)
               OR (sender = %s AND receiver = %s)
            LIMIT 1
        ''', (user, partner, partner, user))
        return cursor.fetchone() is not None
    finally:
        release_connection(conn)

def get_unread_count_db(username: str, partner: str) -> int:
    """Count incoming messages from partner not yet marked read."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT COUNT(*)
            FROM chat_history ch
            LEFT JOIN conversation_read_state crs
              ON crs.username = %s AND crs.partner = %s
            WHERE ch.receiver = %s
              AND ch.sender = %s
              AND ch.id > COALESCE(crs.last_read_message_id, 0)
        ''', (username, partner, username, partner))
        row = cursor.fetchone()
        return int(row[0]) if row else 0
    finally:
        release_connection(conn)

def get_unread_counts_db(username: str) -> dict:
    """Returns {partner: unread_count} for all conversations."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            WITH partners AS (
                SELECT DISTINCT
                    CASE
                        WHEN sender = %s THEN receiver
                        ELSE sender
                    END AS partner
                FROM chat_history
                WHERE sender = %s OR receiver = %s
            )
            SELECT
                p.partner,
                COUNT(ch.id)::int
            FROM partners p
            LEFT JOIN conversation_read_state crs
              ON crs.username = %s AND crs.partner = p.partner
            LEFT JOIN chat_history ch
              ON ch.sender = p.partner
             AND ch.receiver = %s
             AND ch.id > COALESCE(crs.last_read_message_id, 0)
            GROUP BY p.partner
        ''', (username, username, username, username, username))
        return {row[0]: row[1] for row in cursor.fetchall()}
    finally:
        release_connection(conn)

def mark_conversation_read_db(username: str, partner: str, up_to_message_id: int) -> int:
    """Marks all incoming messages from partner up to message id as read."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO conversation_read_state (username, partner, last_read_message_id, updated_at)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (username, partner)
            DO UPDATE SET
                last_read_message_id = GREATEST(
                    conversation_read_state.last_read_message_id,
                    EXCLUDED.last_read_message_id
                ),
                updated_at = CURRENT_TIMESTAMP
        ''', (username, partner, up_to_message_id))

        cursor.execute('''
            UPDATE chat_history
            SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
            WHERE sender = %s
              AND receiver = %s
              AND id <= %s
              AND read_at IS NULL
        ''', (partner, username, up_to_message_id))
        updated = cursor.rowcount
        conn.commit()
        return updated
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        release_connection(conn)

def mark_message_delivered_db(message_id: int) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            UPDATE chat_history
            SET delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP)
            WHERE id = %s
        ''', (message_id,))
        updated = cursor.rowcount > 0
        conn.commit()
        return updated
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        release_connection(conn)

def get_chat_partners_db(username: str, limit: int = 50) -> list:
    """Returns sidebar contacts: users with at least one message, newest first."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        safe_limit = max(1, min(limit, 100))
        cursor.execute('''
            WITH partners AS (
                SELECT
                    CASE
                        WHEN sender = %s THEN receiver
                        ELSE sender
                    END AS partner,
                    MAX(timestamp) AS last_message_at,
                    MAX(id) AS last_message_id
                FROM chat_history
                WHERE sender = %s OR receiver = %s
                GROUP BY partner
            )
            SELECT
                p.partner,
                u.public_key,
                p.last_message_at,
                p.last_message_id,
                COALESCE((
                    SELECT COUNT(ch.id)::int
                    FROM chat_history ch
                    LEFT JOIN conversation_read_state crs
                      ON crs.username = %s AND crs.partner = p.partner
                    WHERE ch.sender = p.partner
                      AND ch.receiver = %s
                      AND ch.id > COALESCE(crs.last_read_message_id, 0)
                ), 0) AS unread_count
            FROM partners p
            INNER JOIN users u ON u.username = p.partner
            ORDER BY p.last_message_at DESC NULLS LAST, p.last_message_id DESC
            LIMIT %s
        ''', (username, username, username, username, username, safe_limit))
        rows = cursor.fetchall()
        return [{
            "username": row[0],
            "public_key": _parse_public_key(row[1]),
            "last_message_at": row[2].isoformat() if row[2] else None,
            "last_message_id": row[3],
            "unread_count": row[4] or 0,
        } for row in rows]
    finally:
        release_connection(conn)

def get_user_db(username: str):
    """Return one user public key by exact username."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT username, public_key
            FROM users
            WHERE username = %s
              AND username ~ '^[a-z0-9_]+$'
        ''', (username,))
        row = cursor.fetchone()
        return _user_row_to_dict(row) if row else None
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
            (
                msg['sender'],
                msg['receiver'],
                json.dumps(msg['content_recipient']),
                json.dumps(msg['content_sender']),
                msg.get('client_message_id')
            )
            for msg in messages_batch
        ]
        execute_values(
            cursor,
            "INSERT INTO chat_history (sender, receiver, content_recipient, content_sender, client_message_id) VALUES %s",
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
            SELECT id, sender, receiver, content_recipient, content_sender, client_message_id, timestamp,
                   delivered_at, read_at
            FROM chat_history 
            WHERE (sender = %s AND receiver = %s) OR (sender = %s AND receiver = %s)
            ORDER BY id DESC
            LIMIT %s OFFSET %s
        ''', (user, partner, partner, user, limit, offset))
        rows = cursor.fetchall()
        
        # Reverse the chunk before returning so it displays chronologically (oldest to newest)
        rows.reverse()
        
        return [{
            "id": r[0],
            "sender": r[1],
            "receiver": r[2],
            "content_recipient": json.loads(r[3]),
            "content_sender": json.loads(r[4]),
            "client_message_id": r[5],
            "timestamp": r[6].isoformat() if r[6] else None,
            "delivered_at": r[7].isoformat() if r[7] else None,
            "read_at": r[8].isoformat() if r[8] else None,
        } for r in rows]
    finally:
        release_connection(conn)

def save_chat_history_message(sender: str, receiver: str, content_recipient: list, content_sender: list, client_message_id: Optional[str] = None):
    """Persists one encrypted chat packet and returns its database identity."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            INSERT INTO chat_history (sender, receiver, content_recipient, content_sender, client_message_id)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, timestamp
        ''', (
            sender,
            receiver,
            json.dumps(content_recipient),
            json.dumps(content_sender),
            client_message_id
        ))
        row = cursor.fetchone()
        conn.commit()
        return {
            "id": row[0],
            "timestamp": row[1].isoformat() if row[1] else None,
            "client_message_id": client_message_id
        }
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        release_connection(conn)

def delete_chat_message_db(username: str, message_id: int) -> Optional[dict]:
    """Deletes one chat message if the user is a participant. Returns metadata for WS sync."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            SELECT id, sender, receiver, client_message_id
            FROM chat_history
            WHERE id = %s
              AND (sender = %s OR receiver = %s)
        ''', (message_id, username, username))
        row = cursor.fetchone()
        if not row:
            return None

        msg_id, sender, receiver, client_message_id = row
        partner = receiver if sender == username else sender

        cursor.execute('''
            DELETE FROM chat_history
            WHERE id = %s
        ''', (msg_id,))

        cursor.execute('''
            DELETE FROM offline_messages
            WHERE chat_history_id = %s
              AND (sender = %s OR receiver = %s)
        ''', (msg_id, username, username))

        conn.commit()
        deleted_at = datetime.now(timezone.utc).isoformat()
        return {
            "message_id": msg_id,
            "chat_id": partner,
            "partner": partner,
            "deleted_by": username,
            "client_message_id": client_message_id,
            "deleted_at": deleted_at,
            "deleted_for_everyone": True,
        }
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        release_connection(conn)

def delete_conversation_db(username: str, partner: str) -> int:
    """Deletes all stored packets for one conversation."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute('''
            DELETE FROM chat_history
            WHERE (sender = %s AND receiver = %s)
               OR (sender = %s AND receiver = %s)
        ''', (username, partner, partner, username))
        deleted = cursor.rowcount

        cursor.execute('''
            DELETE FROM offline_messages
            WHERE (sender = %s AND receiver = %s)
               OR (sender = %s AND receiver = %s)
        ''', (username, partner, partner, username))

        conn.commit()
        return deleted
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        release_connection(conn)

def save_offline_message(sender: str, receiver: str, content: list, chat_history_id: Optional[int] = None, client_message_id: Optional[str] = None, timestamp: Optional[str] = None):
    """Saves message for an offline user"""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            '''
            INSERT INTO offline_messages (sender, receiver, content, chat_history_id, client_message_id, timestamp)
            VALUES (%s, %s, %s, %s, %s, COALESCE(%s::timestamp, CURRENT_TIMESTAMP))
            ''',
            (sender, receiver, json.dumps(content), chat_history_id, client_message_id, timestamp)
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
        cursor.execute('''
            SELECT sender, content, chat_history_id, client_message_id, timestamp
            FROM offline_messages
            WHERE receiver = %s
            ORDER BY id ASC
        ''', (receiver,))
        rows = cursor.fetchall()
        
        # Delete messages
        cursor.execute('DELETE FROM offline_messages WHERE receiver = %s', (receiver,))
        conn.commit()
        return [{
            "sender": row[0],
            "content": json.loads(row[1]),
            "id": row[2],
            "client_message_id": row[3],
            "timestamp": row[4].isoformat() if row[4] else None
        } for row in rows]
    finally:
        release_connection(conn)

def _parse_public_key(public_key_str):
    try:
        return json.loads(public_key_str)
    except (json.JSONDecodeError, TypeError):
        return public_key_str

def _user_row_to_dict(row):
    return {
        "username": row[0],
        "public_key": _parse_public_key(row[1])
    }

# Initialize tables on startup
init_db()
