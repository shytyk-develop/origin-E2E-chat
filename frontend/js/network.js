// frontend/js/network.js

const WS_BASE_URL = "wss://originhub.onrender.com/ws";
const RECONNECT_BASE_MS = 800;
const RECONNECT_MAX_MS = 12000;

/* Establishes a secure WebSocket connection using a JWT token via encrypted query parameters */
export function connectToServer(token, onOpen, onMessage, onClose) {
    let socket = null;
    let reconnectTimer = null;
    let reconnectAttempt = 0;
    let closedByUser = false;

    const connect = () => {
        const WS_URL = `${WS_BASE_URL}?token=${encodeURIComponent(token)}`;
        socket = new WebSocket(WS_URL);

        socket.onopen = () => {
            reconnectAttempt = 0;
            console.log("WebSocket connected securely!");
            if (onOpen) onOpen(socket);
        };

        socket.onmessage = (event) => {
            if (onMessage) onMessage(event, socket);
        };

        socket.onclose = (event) => {
            console.log(`WebSocket closed: Code ${event.code}, Reason: ${event.reason}`);
            if (onClose) onClose(event, closedByUser);

            if (!closedByUser && event.code !== 1008) {
                const delay = Math.min(
                    RECONNECT_BASE_MS * (2 ** reconnectAttempt),
                    RECONNECT_MAX_MS
                );
                reconnectAttempt += 1;
                reconnectTimer = window.setTimeout(connect, delay);
            }
        };

        socket.onerror = () => {
            // onclose handles reconnect/backoff
        };
    };

    connect();

    return {
        get current() {
            return socket;
        },
        close() {
            closedByUser = true;
            window.clearTimeout(reconnectTimer);
            socket?.close();
        },
    };
}

/* Helper function for sending JSON packets over an active WebSocket connection */
export function sendPacket(socket, type, payload) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        const packet = { type, ...payload };
        socket.send(JSON.stringify(packet));
        return true;
    }
    return false;
}
