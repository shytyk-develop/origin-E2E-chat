// frontend/js/app.js

let socket = null;
let state = {
    myUsername: null,
    myKeys: null,
    currentTargetUser: null,
    usersDirectory: {}
};

async function joinChat() {
    const inputName = DOM.usernameInput.value.trim();
    if (!inputName) return;
    
    state.myUsername = inputName;
    hideLoginShowChat();

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
                renderUsersList(data.users, state.myUsername, (selectedUser) => {
                    state.currentTargetUser = selectedUser;
                    activateChatPanel(selectedUser);
                });
            } 
            else if (data.type === "message") {
                const encryptedBytes = new Uint8Array(data.content);
                const decryptedText = await decryptMessage(state.myKeys.privateKey, encryptedBytes);
                appendMessage(data.from, decryptedText, "incoming");
            }
        },
        // onClose
        () => updateStatus("Disconnected", "text-red-500")
    );
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

    appendMessage("You", text, "outgoing");
    DOM.messageInput.value = "";
}

window.joinChat = joinChat; // Make available for the login button