// Connect to our local FastAPI server
// Adress starts with ws:// and not http://
const socket = new WebSocket("ws://localhost:8000/ws");

// DOM elements
const messagesDiv = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const statusSpan = document.getElementById("status");

// Event: connection successfully established
socket.onopen = function(e) {
    statusSpan.textContent = "Online";
    statusSpan.className = "text-green-500 text-sm ml-2";
    console.log("[open] Connection established");
};

// Event: message received from the server
socket.onmessage = function(event) {
    console.log(`[message] Data received from server: ${event.data}`);
    
    const msgElement = document.createElement("div");
    // Keep the gray color for incoming messages (from others)
    msgElement.className = "bg-slate-700 p-2 rounded w-fit max-w-[80%] break-words";
    msgElement.textContent = event.data;
    
    messagesDiv.appendChild(msgElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
};

// Event: connection closed or dropped
socket.onclose = function(event) {
    statusSpan.textContent = "Disconnected";
    statusSpan.className = "text-red-500 text-sm ml-2";
};

// Function to send a message (triggered by the "Send" button)
function sendMessage() {
    const text = messageInput.value;
    if (text.trim() === "") return;

    // 1. Send text to the server
    socket.send(text);
    
    // 2. RENDER OUR OWN MESSAGE ON THE SCREEN
    const msgElement = document.createElement("div");
    // Use a different color and right alignment for our own messages
    msgElement.className = "bg-blue-600 p-2 rounded w-fit max-w-[80%] break-words self-end ml-auto text-right";
    msgElement.textContent = text;
    
    messagesDiv.appendChild(msgElement);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;

    // 3. Clear the input field
    messageInput.value = "";
}

// Send on Enter key press
messageInput.addEventListener("keypress", function(event) {
    if (event.key === "Enter") {
        sendMessage();
    }
});