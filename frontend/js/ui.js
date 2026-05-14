// frontend/js/ui.js

export const DOM = {
    loginModal: document.getElementById('loginModal'),
    mainApp: document.getElementById('mainApp'),
    statusSpan: document.getElementById('status'),
    messagesDiv: document.getElementById('messages'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    usersListDiv: document.getElementById('usersList'),
    chatWithTitle: document.getElementById('chatWithTitle'),
    usernameInput: document.getElementById('usernameInput')
};

export function hideLoginShowChat() {
    DOM.loginModal.classList.add('hidden');
    DOM.mainApp.classList.remove('hidden');
}

export function updateStatus(status, colorClass) {
    DOM.statusSpan.textContent = status;
    DOM.statusSpan.className = `${colorClass} text-sm`;
}

/**
 * Renders the contact list
 * @param {Array} users - Array of user objects
 * @param {string} myUsername - The current user's name to skip in the list
 * @param {Function} onUserSelect - Callback function when a user is clicked
 */
export function renderUsersList(users, myUsername, onUserSelect) {
    DOM.usersListDiv.innerHTML = "";
    users.forEach(user => {
        if (user.username === myUsername) return;

        const btn = document.createElement("button");
        btn.className = "w-full text-left p-2 hover:bg-slate-700 rounded transition-colors";
        btn.textContent = user.username;
        btn.onclick = () => onUserSelect(user.username);
        DOM.usersListDiv.appendChild(btn);
    });
}

export function activateChatPanel(username) {
    DOM.chatWithTitle.textContent = `Chat with: ${username}`;
    DOM.messageInput.disabled = false;
    DOM.sendBtn.disabled = false;
    DOM.sendBtn.className = "bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded font-semibold transition-colors text-white";
}

export function appendMessage(sender, text, type) {
    const msgElement = document.createElement("div");
    
    if (type === "outgoing") {
        msgElement.className = "bg-blue-600 p-2 rounded w-fit max-w-[80%] break-words self-end ml-auto text-right mb-2";
    } else {
        msgElement.className = "bg-slate-700 p-2 rounded w-fit max-w-[80%] break-words mb-2";
    }
    
    msgElement.innerHTML = `<div class="text-xs text-slate-300 mb-1">${sender}</div>${text}`;
    DOM.messagesDiv.appendChild(msgElement);
    DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
}