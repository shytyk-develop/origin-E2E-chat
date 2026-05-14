from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import json
from ws_manager import manager

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://originhub.vercel.app"],  
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # New client connects
    await manager.connect(websocket)
    try:
        while True:
            data_str = await websocket.receive_text()
            data = json.loads(data_str)
            
            if data["type"] == "join":
                manager.active_connections[websocket]["username"] = data["username"]
                manager.active_connections[websocket]["public_key"] = data["public_key"]
                await manager.broadcast_users_list()
                
            elif data["type"] == "message":
                await manager.send_personal_message(data, websocket)
            
    except WebSocketDisconnect:
        # If client closes the tab/disconnects — remove them
        manager.disconnect(websocket)
        await manager.broadcast_users_list()