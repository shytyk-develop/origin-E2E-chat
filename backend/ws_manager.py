# backend/ws_manager.py
from fastapi import WebSocket
import json
from typing import Dict, Any

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

    async def broadcast_users_list(self):
        # 1. Collect a list of everyone who has already provided a username
        users = []
        for ws, data in self.active_connections.items():
            if data["username"] and data["public_key"]:
                users.append({
                    "username": data["username"],
                    "public_key": data["public_key"]
                })
        
        # 2. Formulate the message
        message = {
            "type": "users_list",
            "users": users
        }
        
        # 3. Broadcast this list to all connected clients
        message_json = json.dumps(message)
        for ws in self.active_connections.keys():
            await ws.send_text(message_json)

    async def send_personal_message(self, message_data: dict, sender_ws: WebSocket):
        target_username = message_data.get("to")
        sender_username = self.active_connections[sender_ws]["username"]
        
        # Search for the recipient by their username
        for ws, data in self.active_connections.items():
            if data["username"] == target_username:
                # Formulate the payload and send it only to them
                packet = {
                    "type": "message",
                    "from": sender_username,
                    "content": message_data["content"] # Encrypted array
                }
                await ws.send_text(json.dumps(packet))
                break

manager = ConnectionManager()