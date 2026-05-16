// frontend/js/app.js

import { DOM, hideLoginShowChat, updateStatus, renderUsersList, activateChatPanel, appendMessage } from './ui.js';
import { connectToServer, sendPacket } from './network.js';
import { generateKeyPair, exportPublicKey, importPublicKey, encryptMessage, decryptMessage } from './crypto.js';
import { saveHistory, loadHistory } from './storage.js';

let socket = null;
let state = {
    myUsername: null,
    myKeys: null,
    currentTargetUser: null,
    usersDirectory: {},
    chatHistory: {}
};

async function joinChat() {
    const inputName = DOM.usernameInput.value.trim();
    if (!inputName) return;
    
    state.myUsername = inputName;
    hideLoginShowChat();

    // Load history from local storage
    state.chatHistory = loadHistory(state.myUsername);

    // 1. Cryptography
    state.myKeys = await generateKeyPair();
    const exportedPublicKey = await exportPublicKey(state.myKeys.publicKey);

    // 2. Network
    socket = connectToServer(
        // onOpen
        () => {
            updateStatus("Online", "text-green-500");
            sendPacket(socket, "join", { 
                username: state.myUsername, 
                public_key: exportedPublicKey 
            });
        },
        // onMessage
        async (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === "users_list") {
                // Update the directory
                state.usersDirectory = {};
                data.users.forEach(u => state.usersDirectory[u.username] = u.public_key);
                
                // Render the interface
                renderUsersList(data.users, state.myUsername, switchChat);
            } 
            else if (data.type === "message") {
                const encryptedBytes = new Uint8Array(data.content);
                const decryptedText = await decryptMessage(state.myKeys.privateKey, encryptedBytes);
                processMessage(data.from, data.from, decryptedText, "incoming");
            }
        },
        // onClose
        () => updateStatus("Disconnected", "text-red-500")
    );
}

// Function to add a message to memory and (if necessary) render it to the screen
function processMessage(chatPartner, sender, text, type) {
    // 1. If no history with this user -> create an empty array
    if (!state.chatHistory[chatPartner]) {
        state.chatHistory[chatPartner] = [];
    }

    // 2. Save message to memory
    state.chatHistory[chatPartner].push({ sender, text, type });

    // 3. If this specific chat is currently open on the screen —> render it
    if (state.currentTargetUser === chatPartner) {
        appendMessage(sender, text, type);
    }

    // 4. Save changes to local storage
    saveHistory(state.myUsername, state.chatHistory);
}

// Switches the active chat window to the selected user
function switchChat(username) {
    state.currentTargetUser = username;
    activateChatPanel(username); // Unlocks the UI (function from ui.js)
    
    // 1. Clear current screen
    DOM.messagesDiv.innerHTML = ""; 

    // 2. If history exists, render all previous messages
    if (state.chatHistory[username]) {
        state.chatHistory[username].forEach(msg => {
            appendMessage(msg.sender, msg.text, msg.type);
        });
    }
}

// Make function globally available for the HTML button
window.handleSendMessage = async function() {
    const text = DOM.messageInput.value.trim();
    if (!text || !state.currentTargetUser) return;

    const targetPublicKeyJWK = state.usersDirectory[state.currentTargetUser];
    const targetCryptoKey = await importPublicKey(targetPublicKeyJWK);
    
    const encryptedBuffer = await encryptMessage(targetCryptoKey, text);
    const encryptedArray = Array.from(new Uint8Array(encryptedBuffer));

    sendPacket(socket, "message", {
        to: state.currentTargetUser,
        content: encryptedArray
    });

    processMessage(state.currentTargetUser, "Вы", text, "outgoing");
    DOM.messageInput.value = "";
}

DOM.loginModal.querySelector('button').addEventListener('click', joinChat); // Make available for the login button
DOM.sendBtn.addEventListener('click', handleSendMessage); // Make available for the send button