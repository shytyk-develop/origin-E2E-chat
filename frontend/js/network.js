// frontend/js/network.js

/* Establishes a secure WebSocket connection using a JWT token via query parameters */
export function connectToServer(token, onOpen, onMessage, onClose) {
    const WS_URL = `wss://originhub.onrender.com/ws?token=${token}`;

    const socket = new WebSocket(WS_URL);
    
    socket.onopen = () => {
        console.log("WebSocket connected securely!");
        if (onOpen) onOpen();
    };
    
    socket.onmessage = (event) => {
        if (onMessage) onMessage(event);
    };
    
    socket.onclose = (event) => {
        print(`WebSocket closed: Code ${event.code}, Reason: ${event.reason}`);
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