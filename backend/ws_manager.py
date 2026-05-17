# backend/ws_manager.py
from fastapi import WebSocket
import json
import jwt
import os
from typing import Dict, Any

import database 

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[WebSocket, Dict[str, Any]] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = {"username": None, "public_key": None}

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            del self.active_connections[websocket]

    async def register_user(self, websocket: WebSocket, username: str, public_key: str):
        """Registers a user upon successful handshake authentication"""
        self.active_connections[websocket]["username"] = username
        self.active_connections[websocket]["public_key"] = public_key
        
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
        users_from_db = database.get_all_users()
        message = {
            "type": "users_list",
            "users": users_from_db
        }
        message_json = json.dumps(message)
        for ws in self.active_connections.keys():
            await ws.send_text(message_json)

    async def send_personal_message(self, data: dict, sender_websocket: WebSocket):
        """Routes dual-payload encrypted frames instantly and buffers database writes seamlessly"""
        target_username = data.get("to")
        content_recipient = data.get("content_recipient") # Ciphertext built for the receiver
        content_sender = data.get("content_sender")       # Ciphertext built for self-sync history
        
        sender_session = self.active_connections.get(sender_websocket, {})
        sender_username = sender_session.get("username", "Unknown")
        
        # --- NON-BLOCKING DATABASE BUFFER COUPLING (HIGH-LOAD OPTIMIZATION) ---

        from main import db_write_queue
        await db_write_queue.put({
            "sender": sender_username,
            "receiver": target_username,
            "content_recipient": content_recipient,
            "content_sender": content_sender
        })
        
        # Build packet frame for immediate WebSocket routing
        packet = {
            "type": "message",
            "from": sender_username,
            "content": content_recipient
        }
        
        target_websocket = None
        for ws, session in self.active_connections.items():
            if session.get("username") == target_username:
                target_websocket = ws
                break
                
        if target_websocket:
            try:
                await target_websocket.send_text(json.dumps(packet))
            except Exception:
                self.disconnect(target_websocket)
                database.save_offline_message(sender_username, target_username, content_recipient)
        else:
            # Reconnection pipeline buffer fallback trigger
            database.save_offline_message(sender_username, target_username, content_recipient)

manager = ConnectionManager()