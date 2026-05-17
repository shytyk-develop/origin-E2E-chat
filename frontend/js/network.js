// frontend/js/network.js

/* Establishes a secure WebSocket connection. */
export function connectToServer(onOpen, onMessage, onClose) {
    const WS_URL = "wss://originhub.onrender.com/ws";
    
    // For local development testing
    // const WS_URL = "ws://localhost:10000/ws";

    const socket = new WebSocket(WS_URL);
    
    socket.onopen = () => {
        console.log("WebSocket connected securely via HttpOnly Cookies! 🎉");
        if (onOpen) onOpen();
    };
    
    socket.onmessage = (event) => {
        if (onMessage) onMessage(event);
    };
    
    socket.onclose = (event) => {
        console.log(`WebSocket closed: Code ${event.code}, Reason: ${event.reason}`);
        if (onClose) onClose();
    };
    
    return socket;
}

/* Helper function for sending JSON packets over an active WebSocket connection */
export function sendPacket(socket, type, payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const packet = { type: type, ...payload };
        socket.send(JSON.stringify(packet));
    }
}