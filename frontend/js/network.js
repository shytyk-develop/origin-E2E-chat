// frontend/js/network.js

/* Connection function (accepts callbacks for event handling) */
function connectToServer(onOpen, onMessage, onClose) {
    const ws = new WebSocket("ws://localhost:8000/ws");
    
    ws.onopen = onOpen;
    ws.onmessage = onMessage;
    ws.onclose = onClose;
    
    return ws;
}

/* Helper function for sending JSON packets */
function sendPacket(ws, type, payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        const packet = { type: type, ...payload };
        ws.send(JSON.stringify(packet));
    }
}