# backend/ws_manager.py
from fastapi import WebSocket
import json
import jwt
import os
from typing import Dict, Any

# Import database module
import database 

# Extract the secret key for verifying tokens
JWT_SECRET = os.getenv("JWT_SECRET_KEY", "super_secret_fallback_key_built_32_bytes!!")
JWT_ALGORITHM = "HS256"

class ConnectionManager:
    def __init__(self):
        # Dictionary instead of a simple list:
        # { websocket_connection: {"username": "Ian", "public_key": {...}} }
        self.active_connections: Dict[WebSocket, Dict[str, Any]] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = {"username": None, "public_key": None}

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            del self.active_connections[websocket]

    async def register_user(self, websocket: WebSocket, username: str, public_key: str):
        """Registers a user upon successful handshake authentication"""
        
        # --- ACCESS GRANTED (Token already verified in main.py) ---
        self.active_connections[websocket]["username"] = username
        self.active_connections[websocket]["public_key"] = public_key
        
        # Update public key in the database safely
        database.register_user_db(username, "", public_key, "")
        
        offline_msgs = database.get_and_delete_offline_messages(username)
        for msg in offline_msgs:
            packet = {
                "type": "message",
                "from": msg["sender"],
                "content": msg["content"]
            }
            await websocket.send_text(json.dumps(packet))
            
        return True

    async def broadcast_users_list(self):
        # Fetch the contact list from the Database instead of RAM
        users_from_db = database.get_all_users()
        
        # Formulate the message
        message = {
            "type": "users_list",
            "users": users_from_db
        }
        
        # Broadcast this list to all connected clients
        message_json = json.dumps(message)
        for ws in self.active_connections.keys():
            await ws.send_text(message_json)

    async def send_personal_message(self, data: dict, sender_websocket: WebSocket):
        
        target_username = data.get("to")
        content = data.get("content") 

        # 1. Safely identify who is sending the message
        sender_session = self.active_connections.get(sender_websocket, {})
        sender_username = sender_session.get("username", "Unknown")
        
        # 2. Rebuild the clear text packet for delivery
        packet = {
            "type": "message",
            "from": sender_username,
            "content": content
        }
        
        # 3. Try to find the recipient's active socket
        target_websocket = None
        for ws, session in self.active_connections.items():
            if session.get("username") == target_username:
                target_websocket = ws
                break
                
        # 4. ROUTING CRITICAL LOGIC
        if target_websocket:
            try:
                await target_websocket.send_text(json.dumps(packet))
                print(f"✉️ Real-time delivery: from {sender_username} to {target_username}")
            except Exception as e:
                print(f"⚠️ Stale socket detected for {target_username}. Redirecting to DB. Error: {e}")
                # Clean up the dead connection immediately to prevent memory leaks
                self.disconnect(target_websocket)
                # Fallback to database queue
                database.save_offline_message(sender_username, target_username, content)
        else:
            # TARGET IS OFFLINE
            print(f"🌙 {target_username} is offline. Saving message to PostgreSQL queue...")
            database.save_offline_message(sender_username, target_username, content)

manager = ConnectionManager()