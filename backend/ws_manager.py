# backend/ws_manager.py
from fastapi import WebSocket
import json
import asyncio
from typing import Dict, Any, Optional, Set

import database


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[WebSocket, Dict[str, Any]] = {}
        self.username_to_websocket: Dict[str, WebSocket] = {}
        self.online_usernames: Set[str] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections[websocket] = {
            "username": None,
            "public_key": None,
            "active_chat": None,
        }

    async def disconnect(self, websocket: WebSocket):
        session = self.active_connections.pop(websocket, None)
        username = session.get("username") if session else None
        if username:
            mapped = self.username_to_websocket.get(username)
            if mapped is websocket:
                del self.username_to_websocket[username]
                self.online_usernames.discard(username)
                await self.broadcast_presence(username, False)

    def get_websocket_for_user(self, username: str) -> Optional[WebSocket]:
        return self.username_to_websocket.get(username)

    def _session_username(self, websocket: WebSocket) -> Optional[str]:
        return self.active_connections.get(websocket, {}).get("username")

    async def register_user(self, websocket: WebSocket, username: str, public_key: str):
        previous = self.username_to_websocket.get(username)
        if previous and previous is not websocket:
            await self.disconnect(previous)
            try:
                await previous.close(code=1000, reason="Replaced by a newer session")
            except Exception:
                pass

        self.active_connections[websocket]["username"] = username
        self.active_connections[websocket]["public_key"] = public_key
        self.username_to_websocket[username] = websocket
        self.online_usernames.add(username)

        await self._send_json(websocket, {
            "type": "presence_sync",
            "online": sorted(self.online_usernames),
        })
        await self.broadcast_presence(username, True, exclude=websocket)

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

    async def broadcast_presence(self, username: str, is_online: bool, exclude: Optional[WebSocket] = None):
        payload = {
            "type": "presence",
            "username": username,
            "online": is_online,
        }
        for ws in list(self.active_connections.keys()):
            if ws is exclude:
                continue
            try:
                await self._send_json(ws, payload)
            except Exception:
                await self.disconnect(ws)

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
                await self.disconnect(ws)

    async def _send_json(self, websocket: WebSocket, payload: dict):
        await websocket.send_text(json.dumps(payload))

    async def _notify_user(self, username: str, payload: dict):
        ws = self.get_websocket_for_user(username)
        if not ws:
            return False
        try:
            await self._send_json(ws, payload)
            return True
        except Exception:
            await self.disconnect(ws)
            return False

    async def notify_message_deleted(self, metadata: dict):
        """Push message_deleted to both conversation participants (all tabs via WS)."""
        partner = metadata.get("partner") or metadata.get("chat_id")
        deleted_by = metadata.get("deleted_by")
        if not partner or not deleted_by:
            return

        payload = {
            "type": "message_deleted",
            "message_id": metadata.get("message_id"),
            "chat_id": partner,
            "partner": partner,
            "sender": metadata.get("sender"),
            "receiver": metadata.get("receiver"),
            "deleted_by": deleted_by,
            "client_message_id": metadata.get("client_message_id"),
            "deleted_at": metadata.get("deleted_at"),
            "deleted_for_everyone": metadata.get("deleted_for_everyone", True),
        }
        for username in {deleted_by, partner}:
            await self._notify_user(username, payload)

    async def notify_conversation_deleted(self, deleted_by: str, partner: str):
        payload = {
            "type": "conversation_deleted",
            "chat_id": partner,
            "partner": partner,
            "deleted_by": deleted_by,
        }
        for username in {deleted_by, partner}:
            await self._notify_user(username, payload)

    async def handle_typing(self, data: dict, websocket: WebSocket):
        sender = self._session_username(websocket)
        target = data.get("to")
        if not sender or not target:
            return

        await self._notify_user(target, {
            "type": "typing",
            "from": sender,
            "is_typing": bool(data.get("is_typing", True)),
        })

    async def handle_chat_focus(self, data: dict, websocket: WebSocket):
        username = self._session_username(websocket)
        if not username:
            return
        partner = data.get("partner")
        if partner:
            self.active_connections[websocket]["active_chat"] = partner
        else:
            self.active_connections[websocket]["active_chat"] = None

    async def handle_delivery_ack(self, data: dict, websocket: WebSocket):
        recipient = self._session_username(websocket)
        message_id = data.get("message_id")
        client_message_id = data.get("client_message_id")
        sender = data.get("from")
        if not recipient or not sender or not message_id:
            return

        marked = await asyncio.to_thread(database.mark_message_delivered_db, int(message_id))
        if not marked:
            return

        await self._notify_user(sender, {
            "type": "message_status",
            "status": "delivered",
            "message_id": message_id,
            "client_message_id": client_message_id,
            "partner": recipient,
        })

    async def handle_read_receipt(self, data: dict, websocket: WebSocket):
        reader = self._session_username(websocket)
        partner = data.get("partner")
        up_to_message_id = data.get("up_to_message_id")
        if not reader or not partner or not up_to_message_id:
            return

        session = self.active_connections.get(websocket, {})
        if session.get("active_chat") != partner:
            return

        await asyncio.to_thread(
            database.mark_conversation_read_db,
            reader,
            partner,
            int(up_to_message_id),
        )

        await self._notify_user(partner, {
            "type": "message_status",
            "status": "read",
            "partner": reader,
            "up_to_message_id": up_to_message_id,
        })

        await self._send_json(websocket, {
            "type": "unread_sync",
            "partner": partner,
            "unread_count": 0,
        })

    async def send_personal_message(self, data: dict, sender_websocket: WebSocket):
        """Push ciphertext to the recipient first, persist to PostgreSQL in a worker thread."""
        target_username = data.get("to")
        content_recipient = data.get("content_recipient")
        content_sender = data.get("content_sender")
        client_message_id = data.get("client_message_id")
        reply_to_message_id = data.get("reply_to_message_id")

        sender_session = self.active_connections.get(sender_websocket, {})
        sender_username = sender_session.get("username", "Unknown")
        sender_public_key = sender_session.get("public_key")

        validated_reply_id = None
        if reply_to_message_id is not None:
            try:
                reply_id = int(reply_to_message_id)
                in_chat = await asyncio.to_thread(
                    database.message_in_conversation_db,
                    reply_id,
                    sender_username,
                    target_username,
                )
                if in_chat:
                    validated_reply_id = reply_id
            except (TypeError, ValueError):
                validated_reply_id = None

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
            "reply_to_message_id": validated_reply_id,
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
                await self.disconnect(target_websocket)
                target_websocket = None

        saved_message = await asyncio.to_thread(
            database.save_chat_history_message,
            sender_username,
            target_username,
            content_recipient,
            content_sender,
            client_message_id,
            validated_reply_id,
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
                    "reply_to_message_id": validated_reply_id,
                })
                unread_count = await asyncio.to_thread(
                    database.get_unread_count_db, target_username, sender_username
                )
                await self._send_json(target_websocket, {
                    "type": "unread_sync",
                    "partner": sender_username,
                    "unread_count": unread_count,
                })
            except Exception:
                await self.disconnect(target_websocket)
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
            "reply_to_message_id": validated_reply_id,
        }
        await self._send_json(sender_websocket, ack_packet)

        await self._send_json(sender_websocket, {
            "type": "message_status",
            "status": "sent",
            "message_id": saved_message["id"],
            "client_message_id": client_message_id,
        })

        if is_new_chat:
            partner_data = await asyncio.to_thread(database.get_user_db, target_username)
            if partner_data:
                await self._send_json(sender_websocket, {
                    "type": "new_chat",
                    "partner": partner_data,
                    "last_message_at": saved_message["timestamp"],
                })

    async def handle_reaction(self, data: dict, websocket: WebSocket):
        username = self._session_username(websocket)
        message_id = data.get("message_id")
        emoji = data.get("emoji")
        if not username or message_id is None:
            return

        if emoji == "":
            emoji = None

        try:
            message_id_int = int(message_id)
        except (TypeError, ValueError):
            return

        result = await asyncio.to_thread(
            database.set_message_reaction_db,
            username,
            message_id_int,
            emoji,
        )
        if not result:
            return

        participants = await asyncio.to_thread(
            database.get_message_participants_db,
            message_id_int,
        )
        if not participants:
            return

        sender, receiver = participants
        for participant in participants:
            # Each client stores history under their counterparty's username.
            chat_partner = receiver if participant == sender else sender
            await self._notify_user(participant, {
                "type": "reaction_sync",
                "message_id": result["message_id"],
                "partner": chat_partner,
                "username": result["username"],
                "emoji": result["emoji"],
                "reactions": result["reactions"],
            })


manager = ConnectionManager()
