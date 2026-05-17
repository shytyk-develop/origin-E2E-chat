# backend/ws_manager.py
from fastapi import WebSocket
import json
import asyncio
from typing import Dict, Any, Optional

import database


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[WebSocket, Dict[str, Any]] = {}
        self.username_to_websocket: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = {"username": None, "public_key": None}

    def disconnect(self, websocket: WebSocket):
        session = self.active_connections.pop(websocket, None)
        if session and session.get("username"):
            mapped = self.username_to_websocket.get(session["username"])
            if mapped is websocket:
                del self.username_to_websocket[session["username"]]

    def get_websocket_for_user(self, username: str) -> Optional[WebSocket]:
        return self.username_to_websocket.get(username)

    async def register_user(self, websocket: WebSocket, username: str, public_key: str):
        """Registers a user upon successful handshake authentication."""
        previous = self.username_to_websocket.get(username)
        if previous and previous is not websocket:
            self.disconnect(previous)
            try:
                await previous.close(code=1000, reason="Replaced by a newer session")
            except Exception:
                pass

        self.active_connections[websocket]["username"] = username
        self.active_connections[websocket]["public_key"] = public_key
        self.username_to_websocket[username] = websocket

        offline_msgs = await asyncio.to_thread(
            database.get_and_delete_offline_messages, username
        )
        for msg in offline_msgs:
            packet = {
                "type": "message",
                "from": msg["sender"],
                "content": msg["content"],
                "id": msg.get("id"),
                "client_message_id": msg.get("client_message_id"),
                "timestamp": msg.get("timestamp"),
            }
            await websocket.send_text(json.dumps(packet))

        return True

    async def broadcast_users_list(self):
        users_from_db = [
            {
                "username": session["username"],
                "public_key": session["public_key"],
            }
            for session in self.active_connections.values()
            if session.get("username") and session.get("public_key")
        ]
        message = {"type": "users_list", "users": users_from_db}
        message_json = json.dumps(message)
        for ws in list(self.active_connections.keys()):
            try:
                await ws.send_text(message_json)
            except Exception:
                self.disconnect(ws)

    async def _send_json(self, websocket: WebSocket, payload: dict):
        await websocket.send_text(json.dumps(payload))

    async def send_personal_message(self, data: dict, sender_websocket: WebSocket):
        """Push ciphertext to the recipient first, persist to PostgreSQL in a worker thread."""
        target_username = data.get("to")
        content_recipient = data.get("content_recipient")
        content_sender = data.get("content_sender")
        client_message_id = data.get("client_message_id")

        sender_session = self.active_connections.get(sender_websocket, {})
        sender_username = sender_session.get("username", "Unknown")
        sender_public_key = sender_session.get("public_key")

        is_new_chat = not await asyncio.to_thread(
            database.conversation_exists_db, sender_username, target_username
        )

        packet = {
            "type": "message",
            "from": sender_username,
            "content": content_recipient,
            "id": None,
            "client_message_id": client_message_id,
            "timestamp": None,
        }

        target_websocket = self.get_websocket_for_user(target_username)
        if target_websocket:
            try:
                if is_new_chat:
                    await self._send_json(target_websocket, {
                        "type": "new_chat",
                        "partner": {
                            "username": sender_username,
                            "public_key": sender_public_key,
                        },
                    })
                await self._send_json(target_websocket, packet)
            except Exception:
                self.disconnect(target_websocket)
                target_websocket = None

        saved_message = await asyncio.to_thread(
            database.save_chat_history_message,
            sender_username,
            target_username,
            content_recipient,
            content_sender,
            client_message_id,
        )

        packet["id"] = saved_message["id"]
        packet["timestamp"] = saved_message["timestamp"]

        if target_websocket:
            try:
                await self._send_json(target_websocket, {
                    "type": "message_sync",
                    "from": sender_username,
                    "client_message_id": client_message_id,
                    "id": saved_message["id"],
                    "timestamp": saved_message["timestamp"],
                })
            except Exception:
                self.disconnect(target_websocket)
                target_websocket = None

        if not target_websocket:
            await asyncio.to_thread(
                database.save_offline_message,
                sender_username,
                target_username,
                content_recipient,
                saved_message["id"],
                saved_message["client_message_id"],
                saved_message["timestamp"],
            )

        ack_packet = {
            "type": "message_ack",
            "id": saved_message["id"],
            "client_message_id": saved_message["client_message_id"],
            "timestamp": saved_message["timestamp"],
        }
        await self._send_json(sender_websocket, ack_packet)

        if is_new_chat:
            partner_data = await asyncio.to_thread(database.get_user_db, target_username)
            if partner_data:
                await self._send_json(sender_websocket, {
                    "type": "new_chat",
                    "partner": partner_data,
                    "last_message_at": saved_message["timestamp"],
                })


manager = ConnectionManager()
