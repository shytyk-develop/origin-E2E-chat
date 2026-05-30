# backend/main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any, Optional
import json
import jwt
import os
import re
from datetime import datetime, timedelta

from ws_manager import manager 
import database 

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://originhub.vercel.app", "http://localhost:5173", "http://127.0.0.1:5173"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- JWT CONFIGURATION ---
JWT_SECRET = os.getenv("JWT_SECRET_KEY", "super_secret_fallback_key_built_32_bytes!!")
JWT_ALGORITHM = "HS256"
USERNAME_RE = re.compile(r"^[a-z0-9_]{3,32}$")

def create_access_token(username: str) -> str:
    """Generates a secure access token valid for 24 hours"""
    expiration = datetime.utcnow() + timedelta(hours=24)
    payload = {"sub": username, "exp": expiration}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def normalize_username(username: str) -> str:
    return username.strip().lower()

def validate_username(username: str):
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(
            status_code=422,
            detail="Username must be 3-32 characters and contain only lowercase English letters, digits, and underscore."
        )

def get_current_username(authorization: Optional[str] = Header(default=None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing authorization token")

    token = authorization[len("Bearer "):].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        username = payload.get("sub")
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if not username:
        raise HTTPException(status_code=401, detail="Invalid token subject")
    return normalize_username(username)

class RegisterRequest(BaseModel):
    username: str
    password: str
    public_key: Any
    encrypted_private_key: str

class LoginRequest(BaseModel):
    username: str
    password: str

class ProfileUpdateRequest(BaseModel):
    display_name: str = ""
    bio: str = ""
    avatar_data: Optional[str] = None

PROFILE_DISPLAY_NAME_MAX = 32
PROFILE_BIO_MAX = 140
PROFILE_AVATAR_MAX_LEN = 700_000

def sanitize_profile_field(value: str, max_len: int) -> str:
    if not isinstance(value, str):
        return ""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value.strip())
    return cleaned[:max_len]

def validate_avatar_data(value: Optional[str]) -> Optional[str]:
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not value.startswith("data:image/"):
        raise HTTPException(status_code=422, detail="Avatar must be a data:image/ URL.")
    if len(value) > PROFILE_AVATAR_MAX_LEN:
        raise HTTPException(status_code=422, detail="Avatar image is too large.")
    return value

# --- HTTP API ENDPOINTS ---

@app.post("/api/register")
async def register(req: RegisterRequest):
    username = normalize_username(req.username)
    validate_username(username)

    success = database.register_user_db(username, req.password, req.public_key, req.encrypted_private_key)
    if not success:
        raise HTTPException(status_code=400, detail="Username is already taken")
    return {"message": "Registration successful"}

@app.post("/api/login")
async def login(req: LoginRequest):
    """Authenticates user and returns the token directly in the response body"""
    username = normalize_username(req.username)
    validate_username(username)

    user_keys = database.login_user_db(username, req.password)
    if user_keys is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    token = create_access_token(username)
    return {
        "message": "Login successful", 
        "access_token": token,
        "public_key": user_keys["public_key"],
        "encrypted_private_key": user_keys["encrypted_private_key"]
    }

@app.get("/api/history")
async def get_history(user: str, partner: str, limit: int = Query(50), offset: int = Query(0), authorization: Optional[str] = Header(default=None)):
    """Returns a slice of double-encrypted messaging payload blocks protecting against backend over-allocations"""
    current_username = get_current_username(authorization)
    user = normalize_username(user)
    partner = normalize_username(partner)
    validate_username(user)
    validate_username(partner)

    if user != current_username:
        raise HTTPException(status_code=403, detail="Cannot read history for another user")

    return database.get_chat_history_db(user, partner, limit=limit, offset=offset)

@app.get("/api/chats")
async def get_chats(limit: int = Query(50), authorization: Optional[str] = Header(default=None)):
    """Returns users who share at least one message with the authenticated user."""
    current_username = get_current_username(authorization)
    return database.get_chat_partners_db(current_username, limit=limit)

@app.get("/api/users/search")
async def search_users(q: str = Query(""), limit: int = Query(20), authorization: Optional[str] = Header(default=None)):
    current_username = get_current_username(authorization)
    query = normalize_username(q)

    if len(query) < 2:
        return []

    if not re.fullmatch(r"^[a-z0-9_]+$", query):
        raise HTTPException(status_code=422, detail="Search can contain only lowercase English letters, digits, and underscore.")

    return database.search_users_db(query, current_username, limit=limit)

@app.get("/api/users/{username}")
async def get_user(username: str, authorization: Optional[str] = Header(default=None)):
    get_current_username(authorization)
    normalized_username = normalize_username(username)
    validate_username(normalized_username)

    user = database.get_user_db(normalized_username)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.put("/api/profile")
async def update_profile(req: ProfileUpdateRequest, authorization: Optional[str] = Header(default=None)):
    """Update public profile metadata visible to contacts."""
    current_username = get_current_username(authorization)
    display_name = sanitize_profile_field(req.display_name, PROFILE_DISPLAY_NAME_MAX)
    bio = sanitize_profile_field(req.bio, PROFILE_BIO_MAX)
    avatar_data = validate_avatar_data(req.avatar_data)

    updated = database.update_user_profile_db(current_username, display_name, bio, avatar_data)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")

    profile = {
        "display_name": display_name,
        "bio": bio,
        "avatar_data": avatar_data,
    }
    await manager.broadcast_profile_update(current_username, profile)
    return {"username": current_username, **profile}

@app.delete("/api/history/message/{message_id}")
async def delete_message(message_id: int, authorization: Optional[str] = Header(default=None)):
    current_username = get_current_username(authorization)
    metadata = database.delete_chat_message_db(current_username, message_id)
    if not metadata:
        raise HTTPException(status_code=404, detail="Message not found")
    await manager.notify_message_deleted(metadata)
    return {"deleted": True, **metadata}

@app.delete("/api/history/conversation/{partner}")
async def delete_conversation(partner: str, authorization: Optional[str] = Header(default=None)):
    current_username = get_current_username(authorization)
    normalized_partner = normalize_username(partner)
    validate_username(normalized_partner)

    deleted_count = database.delete_conversation_db(current_username, normalized_partner)
    await manager.notify_conversation_deleted(current_username, normalized_partner)
    return {"deleted": True, "count": deleted_count}

# --- SECURE WEBSOCKET FOR ROUTING MESSAGES ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):    
    if not token:
        print("❌ Handshake blocked: missing token parameter")
        await websocket.close(code=1008, reason="Missing token")
        return
        
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        token_username = normalize_username(payload.get("sub", ""))
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        print("❌ Handshake blocked: invalid or expired token signature")
        await websocket.close(code=1008, reason="Invalid token")
        return

    await manager.connect(websocket)
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            
            if data["type"] == "join":
                username = normalize_username(data["username"])
                if not USERNAME_RE.fullmatch(username):
                    await websocket.close(code=1008, reason="Invalid username")
                    return

                if username != token_username:
                    print(f"⚠️ Security alert: Identity theft attempt detected from token payload context")
                    await websocket.close(code=1008, reason="Identity theft detected")
                    return
                    
                await manager.register_user(
                    websocket,
                    username,
                    data["public_key"],
                    share_presence=bool(data.get("share_presence", True)),
                )
                await manager.broadcast_users_list()
                
            elif data["type"] == "message":
                await manager.send_personal_message(data, websocket)

            elif data["type"] == "typing":
                await manager.handle_typing(data, websocket)

            elif data["type"] == "delivery_ack":
                await manager.handle_delivery_ack(data, websocket)

            elif data["type"] == "read_receipt":
                await manager.handle_read_receipt(data, websocket)

            elif data["type"] == "chat_focus":
                await manager.handle_chat_focus(data, websocket)

            elif data["type"] == "presence_setting":
                await manager.handle_presence_setting(data, websocket)

            elif data["type"] == "reaction":
                await manager.handle_reaction(data, websocket)
            
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
