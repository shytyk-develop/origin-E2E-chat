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

        offline_msgs = database.get_and_delete_offline_messages(username)
        for msg in offline_msgs:
            packet = {
                "type": "message",
                "from": msg["sender"],
                "content": msg["content"],
                "id": msg.get("id"),
                "client_message_id": msg.get("client_message_id"),
                "timestamp": msg.get("timestamp")
            }
            await websocket.send_text(json.dumps(packet))
        return True

    async def broadcast_users_list(self):
        users_from_db = [
            {
                "username": session["username"],
                "public_key": session["public_key"]
            }
            for session in self.active_connections.values()
            if session.get("username") and session.get("public_key")
        ]
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
        client_message_id = data.get("client_message_id")
        
        sender_session = self.active_connections.get(sender_websocket, {})
        sender_username = sender_session.get("username", "Unknown")

        saved_message = database.save_chat_history_message(
            sender_username,
            target_username,
            content_recipient,
            content_sender,
            client_message_id
        )

        ack_packet = {
            "type": "message_ack",
            "id": saved_message["id"],
            "client_message_id": saved_message["client_message_id"],
            "timestamp": saved_message["timestamp"]
        }
        await sender_websocket.send_text(json.dumps(ack_packet))
        
        # Build packet frame for immediate WebSocket routing
        packet = {
            "type": "message",
            "from": sender_username,
            "content": content_recipient,
            "id": saved_message["id"],
            "client_message_id": saved_message["client_message_id"],
            "timestamp": saved_message["timestamp"]
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
                database.save_offline_message(
                    sender_username,
                    target_username,
                    content_recipient,
                    saved_message["id"],
                    saved_message["client_message_id"],
                    saved_message["timestamp"]
                )
        else:
            # Reconnection pipeline buffer fallback trigger
            database.save_offline_message(
                sender_username,
                target_username,
                content_recipient,
                saved_message["id"],
                saved_message["client_message_id"],
                saved_message["timestamp"]
            )

manager = ConnectionManager()
