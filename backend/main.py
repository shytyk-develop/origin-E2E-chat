# backend/main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
import json
import jwt
import os
import asyncio
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

# --- ASYNC MEMORY BUFFER FOR BATCH WRITES ---
db_write_queue = asyncio.Queue()

async def batch_history_flush_worker():
    """Background task worker that gathers database writes and executes them in massive batches"""
    while True:
        await asyncio.sleep(4.0)  # Flush queue to disk every 2 seconds
        batch = []
        while not db_write_queue.empty():
            item = await db_write_queue.get()
            batch.append(item)
            db_write_queue.task_done()
        
        if batch:
            try:
                database.save_chat_history_batch(batch)
                print(f"📦 High-load Flush: Successfully batched {len(batch)} messages into PostgreSQL disk storage.")
            except Exception as e:
                print(f"❌ Critical high-load error writing batch chunk to PostgreSQL: {e}")

@app.on_event("startup")
async def startup_event():
    """Triggers the async worker tasks on microservice booting sequence"""
    asyncio.create_task(batch_history_flush_worker())

def create_access_token(username: str) -> str:
    """Generates a secure access token valid for 24 hours"""
    expiration = datetime.utcnow() + timedelta(hours=24)
    payload = {"sub": username, "exp": expiration}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

class RegisterRequest(BaseModel):
    username: str
    password: str
    public_key: Any
    encrypted_private_key: str

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
async def login(req: LoginRequest):
    """Authenticates user and returns the token directly in the response body"""
    user_keys = database.login_user_db(req.username, req.password)
    if user_keys is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    token = create_access_token(req.username)
    return {
        "message": "Login successful", 
        "access_token": token,
        "public_key": user_keys["public_key"],
        "encrypted_private_key": user_keys["encrypted_private_key"]
    }

@app.get("/api/history")
async def get_history(user: str, partner: str, limit: int = Query(50), offset: int = Query(0)):
    """Returns a slice of double-encrypted messaging payload blocks protecting against backend over-allocations"""
    return database.get_chat_history_db(user, partner, limit=limit, offset=offset)

# --- SECURE WEBSOCKET FOR ROUTING MESSAGES ---
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str = Query(None)):    
    if not token:
        print("❌ Handshake blocked: missing token parameter")
        await websocket.close(code=1008, reason="Missing token")
        return
        
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        token_username = payload.get("sub")
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
                if data["username"] != token_username:
                    print(f"⚠️ Security alert: Identity theft attempt detected from token payload context")
                    await websocket.close(code=1008, reason="Identity theft detected")
                    return
                    
                await manager.register_user(websocket, data["username"], data["public_key"])
                await manager.broadcast_users_list()
                
            elif data["type"] == "message":
                await manager.send_personal_message(data, websocket)
            
    except WebSocketDisconnect:
        manager.disconnect(websocket)