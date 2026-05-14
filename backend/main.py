from fastapi import FastAPI, WebSocket

app = FastAPI()

# If someone hits the /ws endpoint, use this function
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    # Allow client to connect
    await websocket.accept()
    
    while True:
        # data = "message that client sent"
        message = await websocket.receive_text() 
        
        # return client's message
        await websocket.send_text(f"You said '{message}'") 
