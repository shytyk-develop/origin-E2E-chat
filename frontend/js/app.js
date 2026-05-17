// frontend/js/app.js

import { DOM, updateStatus, renderUsersList, activateChatPanel, appendMessage } from './ui.js';
import { connectToServer, sendPacket } from './network.js';
import { 
    generateKeyPair, 
    exportPublicKey, 
    exportPrivateKey, 
    importPublicKey, 
    importPrivateKey, 
    encryptMessage, 
    decryptMessage,
    encryptPrivateKeyWithPassword,
    decryptPrivateKeyWithPassword
} from './crypto.js';
import { saveHistory, loadHistory, saveKeys, loadKeys } from './storage.js';
import { initRouter, navigateTo } from './router.js';

const API_URL = "https://originhub.onrender.com"; 

let socket = null;
let state = {
    myUsername: null,
    myKeys: null,
    token: null,
    currentTargetUser: null,
    usersDirectory: {},
    chatHistory: {}
};

// Main routing handler
async function handleNavigation(view, param) {
    document.querySelectorAll('.route-page').forEach(page => page.classList.add('hidden'));

    if (view === 'login') {
        DOM.pageLogin.classList.remove('hidden');
    } 
    else if (view === 'chat' || view === 'chat-user') {
        if (!state.myUsername) {
            navigateTo('/login', handleNavigation);
            return;
        }

        DOM.pageChat.classList.remove('hidden');

        if (view === 'chat-user' && param) {
            const targetUser = param;
            if (state.usersDirectory[targetUser] || Object.keys(state.usersDirectory).length === 0) {
                switchChat(targetUser);
            } else {
                state.currentTargetUser = targetUser;
            }
        } else {
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
            const res = await fetch(`${API_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            if (!res.ok) throw new Error("Invalid username or password");

            const resData = await res.json();
            state.token = resData.access_token;

            let savedKeysJWK = loadKeys(username);
            
            if (!savedKeysJWK) {
                console.log("📱 New device detected! Synchronizing encrypted keys from the secure cloud...");
                const decryptedPrivJWK = await decryptPrivateKeyWithPassword(resData.encrypted_private_key, password);
                
                savedKeysJWK = {
                    publicKey: resData.public_key,
                    privateKey: decryptedPrivJWK
                };
                saveKeys(username, savedKeysJWK);
            }

            state.myKeys = {
                publicKey: await importPublicKey(savedKeysJWK.publicKey),
                privateKey: await importPrivateKey(savedKeysJWK.privateKey)
            };
            
            finishLoginSetup(username, savedKeysJWK.publicKey);

        } else {
            state.myKeys = await generateKeyPair();
            const pubJWK = await exportPublicKey(state.myKeys.publicKey);
            const privJWK = await exportPrivateKey(state.myKeys.privateKey);

            const encPrivString = await encryptPrivateKeyWithPassword(privJWK, password);

            const res = await fetch(`${API_URL}/api/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    username, 
                    password, 
                    public_key: pubJWK,
                    encrypted_private_key: encPrivString
                })
            });

            if (!res.ok) throw new Error("Username is already taken");

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
    
    navigateTo('/chat', handleNavigation);

    socket = connectToServer(
        state.token,
        () => {
            updateStatus("Online", "text-green-500");
            sendPacket(socket, "join", { 
                username: state.myUsername, 
                public_key: exportedPublicKeyJSON 
            });
        },
        async (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === "users_list") {
                state.usersDirectory = {};
                data.users.forEach(u => state.usersDirectory[u.username] = u.public_key);
                
                renderUsersList(data.users, state.myUsername, (selectedUser) => {
                    navigateTo(`/chat/@${selectedUser}`, handleNavigation);
                });

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
        () => updateStatus("Disconnected", "text-red-500")
    );
}

function processMessage(chatPartner, sender, text, type) {
    if (!state.chatHistory[chatPartner]) {
        state.chatHistory[chatPartner] = [];
    }
    state.chatHistory[chatPartner].push({ sender, text, type });

    if (state.currentTargetUser === chatPartner) {
        appendMessage(sender, text, type);
    }
    saveHistory(state.myUsername, state.chatHistory);
}

// Switches active chat with cloud-history parsing layer integration
async function switchChat(username) {
    state.currentTargetUser = username;
    activateChatPanel(username); 
    DOM.chatWelcome.classList.add('hidden'); 
    DOM.messagesDiv.innerHTML = ""; 

    // --- SECURE LAZY CLOUD SYNCHRONIZATION ---
    // Fetch latest 50 messages slice. Server doesn't know plain text content!
    try {
        const res = await fetch(`${API_URL}/api/history?user=${state.myUsername}&partner=${username}&limit=50&offset=0`);
        if (res.ok) {
            const cloudHistory = await res.json();
            state.chatHistory[username] = []; // Clear current RAM session slice to avoid duplicate merges
            
            for (const msg of cloudHistory) {
                const isMe = (msg.sender === state.myUsername);
                
                // CRITICAL DECISION POINT: If I sent it, decrypt 'content_sender'. 
                // If the partner sent it, decrypt 'content_recipient'.
                const rawBytes = isMe ? msg.content_sender : msg.content_recipient;
                const encryptedBytes = new Uint8Array(rawBytes);
                
                try {
                    const decryptedText = await decryptMessage(state.myKeys.privateKey, encryptedBytes);
                    state.chatHistory[username].push({
                        sender: isMe ? "You" : msg.sender,
                        text: decryptedText,
                        type: isMe ? "outgoing" : "incoming"
                    });
                } catch (cryptoErr) {
                    console.error("🔒 Crypto payload corruption block dropped:", cryptoErr);
                }
            }
        }
    } catch (err) {
        console.warn("Database sync unreachable, using browser cache storage fallback:", err);
    }

    if (state.chatHistory[username]) {
        state.chatHistory[username].forEach(msg => {
            appendMessage(msg.sender, msg.text, msg.type);
        });
    }
    saveHistory(state.myUsername, state.chatHistory);
}

// Make function globally available for the HTML button
window.handleSendMessage = async function() {
    const text = DOM.messageInput.value.trim();
    if (!text || !state.currentTargetUser) return;

    // 1. ENCRYPT FOR THE RECIPIENT
    const targetPublicKeyJWK = state.usersDirectory[state.currentTargetUser];
    const targetCryptoKey = await importPublicKey(targetPublicKeyJWK);
    const encryptedBufferRecipient = await encryptMessage(targetCryptoKey, text);
    const encryptedArrayRecipient = Array.from(new Uint8Array(encryptedBufferRecipient));

    // 2. ENCRYPT FOR OURSELVES (Multi-device dynamic cloud recovery strategy)
    const encryptedBufferSelf = await encryptMessage(state.myKeys.publicKey, text);
    const encryptedArraySender = Array.from(new Uint8Array(encryptedBufferSelf));

    // 3. SEND THE DUAL PAYLOAD BUNDLE
    sendPacket(socket, "message", {
        to: state.currentTargetUser,
        content_recipient: encryptedArrayRecipient,
        content_sender: encryptedArraySender
    });

    processMessage(state.currentTargetUser, "You", text, "outgoing");
    DOM.messageInput.value = "";
}

// Event Listeners
DOM.btnLogin.addEventListener('click', () => handleAuth(true));
DOM.btnRegister.addEventListener('click', () => handleAuth(false));
DOM.sendBtn.addEventListener('click', window.handleSendMessage); 

initRouter(handleNavigation);