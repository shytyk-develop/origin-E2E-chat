from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from typing import List

app = FastAPI()

# Class for managing connections
class ConnectionManager:
    def __init__(self):
        # List of all active clients
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        # Accept connection and add it to the list
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        # Remove connection from the list if disconnected
        self.active_connections.remove(websocket)

    async def broadcast(self, message: str, sender: WebSocket):
        # Broadcast the message to everyone except sender
        for connection in self.active_connections:
            if connection != sender:
                await connection.send_text(message)

# Create a "manager" instance for our application
manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # 1. A new client connects
    await manager.connect(websocket)
    try:
        while True:
            # 2. Wait for message from this client
            message = await websocket.receive_text()
            
            # 3. Once received, broadcast to others
            await manager.broadcast(message, sender=websocket)
            
    except WebSocketDisconnect:
        # 4. If client closes the tab/disconnects — remove them
        manager.disconnect(websocket)