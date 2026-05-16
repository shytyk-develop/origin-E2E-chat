// frontend/js/app.js

import { DOM, updateStatus, renderUsersList, activateChatPanel, appendMessage } from './ui.js';
import { connectToServer, sendPacket } from './network.js';
import { generateKeyPair, exportPublicKey, exportPrivateKey, importPublicKey, importPrivateKey, encryptMessage, decryptMessage } from './crypto.js';
import { saveHistory, loadHistory, saveKeys, loadKeys } from './storage.js';

const API_URL = "https://originhub.onrender.com"; 

let socket = null;
let state = {
    myUsername: null,
    myKeys: null,
    currentTargetUser: null,
    usersDirectory: {},
    chatHistory: {}
};

// Main routing handler
async function handleNavigation(view, param) {
    // 1. Hide all views/pages
    document.querySelectorAll('.route-page').forEach(page => page.classList.add('hidden'));

    if (view === 'login') {
        DOM.pageLogin.classList.remove('hidden');
    } 
    else if (view === 'chat' || view === 'chat-user') {
        // Guard clause: if user is not authenticated, redirect to login
        if (!state.myUsername) {
            navigateTo('/login', handleNavigation);
            return;
        }

        DOM.pageChat.classList.remove('hidden');

        if (view === 'chat-user' && param) {
            // Route /chat/@username — open specific chat window
            const targetUser = param;
            
            // Check if user directory is already loaded from the server
            if (state.usersDirectory[targetUser] || Object.keys(state.usersDirectory).length === 0) {
                switchChat(targetUser);
            } else {
                // If accessed via a direct link, save the intent to open this chat
                state.currentTargetUser = targetUser;
            }
        } else {
            // Regular /chat route — show the welcome screen
            state.currentTargetUser = null;
            document.getElementById('chat-window')?.classList.add('hidden');
            DOM.chatWelcome.classList.remove('hidden');
        }
    }
}

// 2. AUTHORIZATION AND REGISTRATION (HTTP POST)
async function handleAuth(isLogin) {
    const username = DOM.usernameInput.value.trim();
    const password = DOM.passwordInput.value.trim();

    if (!username || !password) {
        showAuthMessage("Please enter both username and password.", true);
        return;
    }

    try {
        if (isLogin) {
            // --- LOGIN LOGIC ---
            const res = await fetch(`${API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (!res.ok) throw new Error("Invalid username or password");

            // Look for keys in local storage
            const savedKeysJWK = loadKeys(username);
            if (!savedKeysJWK) {
                throw new Error("Encryption keys not found on this device! Login rejected for security.");
            }

            // Restore keys
            state.myKeys = {
                publicKey: await importPublicKey(savedKeysJWK.publicKey),
                privateKey: await importPrivateKey(savedKeysJWK.privateKey)
            };
            
            finishLoginSetup(username, savedKeysJWK.publicKey);

        } else {
            // --- REGISTRATION LOGIC ---
            // 1. Generate new key pair
            state.myKeys = await generateKeyPair();
            
            const pubJWK = await exportPublicKey(state.myKeys.publicKey);
            const privJWK = await exportPrivateKey(state.myKeys.privateKey);

            // 2. Send payload to server
            const res = await fetch(`${API_URL}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, public_key: pubJWK })
            });

            if (!res.ok) throw new Error("Username is already taken");

            // 3. Save keys locally
            saveKeys(username, { publicKey: pubJWK, privateKey: privJWK });
            
            showAuthMessage("Registration successful! You can now log in.", false);
        }
    } catch (err) {
        showAuthMessage(err.message, true);
    }
}

function showAuthMessage(text, isError) {
    DOM.authError.textContent = text;
    DOM.authError.classList.remove('hidden');
    DOM.authError.classList.toggle('text-red-400', isError);
    DOM.authError.classList.toggle('text-green-400', !isError);
}

// Runs after SUCCESSFUL login
function finishLoginSetup(username, exportedPublicKeyJSON) {
    state.myUsername = username;
    state.chatHistory = loadHistory(state.myUsername);
    
    // Clean redirect via SPA
    navigateTo('/chat', handleNavigation);

    // Establish WebSocket connection
    socket = connectToServer(
        // onOpen
        () => {
            updateStatus("Online", "text-green-500");
            sendPacket(socket, "join", { 
                username: state.myUsername, 
                public_key: exportedPublicKeyJSON 
            });
        },
        // onMessage
        async (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === "users_list") {
                // Update the directory
                state.usersDirectory = {};
                data.users.forEach(u => state.usersDirectory[u.username] = u.public_key);
                
                // Render the interface with URL updates when a user is clicked
                renderUsersList(data.users, state.myUsername, (selectedUser) => {
                    navigateTo(`/chat/@${selectedUser}`, handleNavigation);
                });

                // If a deep-linked chat was requested before the directory loaded, switch to it now
                if (state.currentTargetUser) {
                    switchChat(state.currentTargetUser);
                }
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
    DOM.chatWelcome.classList.add('hidden'); 
    
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

// Event Listeners
DOM.btnLogin.addEventListener('click', () => handleAuth(true));
DOM.btnRegister.addEventListener('click', () => handleAuth(false));
DOM.sendBtn.addEventListener('click', handleSendMessage); 

// Initialize the client-side router on startup
initRouter(handleNavigation);