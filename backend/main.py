# backend/main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Response, Query, Cookie
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
import json
import jwt
import os
from datetime import datetime, timedelta

from ws_manager import manager 
import database 

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://originhub.vercel.app", "http://localhost:5173"],  
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- JWT CONFIGURATION ---
JWT_SECRET = os.getenv("JWT_SECRET_KEY", "super_secret_fallback_key_built_32_bytes!!")
JWT_ALGORITHM = "HS256"

def create_access_token(username: str) -> str:
    """Generates a secure access token valid for 24 hours"""
    expiration = datetime.utcnow() + timedelta(hours=24)
    payload = {"sub": username, "exp": expiration}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

class RegisterRequest(BaseModel):
    username: str
    password: str
    public_key: Any
    encrypted_private_key: str  # Encrypted key backup for multi-device sync

class LoginRequest(BaseModel):
    username: str
    password: str

# --- HTTP API ENDPOINTS ---

@app.post("/api/register")
async def register(req: RegisterRequest):
    success = database.register_user_db(req.username, req.password, req.public_key, req.encrypted_private_key)
    if not success:
        raise HTTPException(status_code=400, detail="Username is already taken")
    return {"message": "Registration successful"}

@app.post("/api/login")
async def login(req: LoginRequest, response: Response):
    """Authenticates user and bakes the JWT session token inside an HttpOnly Cookie"""
    user_keys = database.login_user_db(req.username, req.password)
    if user_keys is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    token = create_access_token(req.username)
    
    # Set the cookie securely on the client browser
    response.set_cookie(
        key="access_token",
        value=token,
        httponly=True,     # JS cannot read this cookie
        samesite="lax",    
        secure=True,       
        max_age=86400      # 24 hours lifespan in seconds
    )
    
    return {
        "message": "Login successful", 
        "public_key": user_keys["public_key"],
        "encrypted_private_key": user_keys["encrypted_private_key"]
    }

# --- SECURE WEBSOCKET FOR ROUTING MESSAGES ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, access_token: str = Cookie(None)):    
    """FastAPI automatically extracts the 'access_token' cookie from handshake headers"""
    
    # 1. Guard clause for missing authentication cookie
    if not access_token:
        print("❌ Handshake blocked: authentication cookie is missing")
        await websocket.close(code=1008, reason="Missing auth cookie")
        return
        
    # 2. Decode and cryptographically verify the JWT signature from cookie
    try:
        payload = jwt.decode(access_token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        token_username = payload.get("sub")
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        print("❌ Handshake blocked: invalid or expired authentication cookie")
        await websocket.close(code=1008, reason="Invalid auth cookie")
        return

    # 3. Handshake successful — establish WebSocket connection via manager
    await manager.connect(websocket)
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            
            if data["type"] == "join":
                # Multi-layered check: match the packet username with the signature subject
                if data["username"] != token_username:
                    print(f"⚠️ Security alert: Identity theft attempt detected from token payload context")
                    await websocket.close(code=1008, reason="Identity theft detected")
                    return
                    
                await manager.register_user(websocket, data["username"], data["public_key"])
                await manager.broadcast_users_list()
                
            elif data["type"] == "message":
                await manager.send_personal_message(data, websocket)
            
    except WebSocketDisconnect:
        # If client closes the tab/disconnects — remove them
        manager.disconnect(websocket)