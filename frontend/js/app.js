// frontend/js/app.js

import {
    DOM,
    updateStatus,
    renderUsersList,
    setSidebarChats,
    activateChatPanel,
    resetChatPanel,
    appendMessage,
    renderMessagesList,
    filterUsers,
    focusComposer,
    focusContactSearch,
    autoResizeComposer,
    updateComposerMeta,
    setDraftStatus,
    setComposerValue,
    getComposerValue,
    clearComposer,
    insertAtCursor,
    scrollMessagesToBottom,
    openChatMenu,
    openComposerMenu,
    closeAllPopovers,
    openMessageSearch,
    closeMessageSearch,
    searchMessages,
    openSettings,
    openShortcuts,
    closeModals,
    closeTransientUi,
    showToast,
    setPreferenceControls,
    clearUsersList,
    updateMessageIdentity,
    updateMessageStatus,
    removeMessageElement,
    removeMessageFromDom,
    setMessageActionHandlers,
    setRealtimeContext
} from './ui.js';
import { createRealtimeController } from './realtime.js';
import {
    MESSAGE_STATUS,
    createOutgoingMessage,
    deriveOutgoingStatusFromDb,
} from './messageState.js';
import {
    applyStatusEvent,
    onMessageAck,
    scheduleReadReceipt,
    cancelReadReceipt,
} from './messageSync.js';
import {
    applyMessageDeleted,
    applyConversationDeleted,
    activeChatShouldRefresh,
    logDelete,
    messageMatchesDeletion,
    resolveDeletionChatPartner,
} from './messageDelete.js';
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
import { saveHistory, loadHistory, saveKeys, loadKeys, saveDraft, loadDraft, clearDraft } from './storage.js';
import { initRouter, navigateTo } from './router.js';
import { loadPreferences, applyPreferences, updatePreference } from './preferences.js';
import { registerShortcuts } from './shortcuts.js';
import {
    buildChatTranscript,
    downloadTextFile,
    copyText,
    createFileMarkers,
    makeSafeFilename
} from './chatActions.js';
import {
    normalizeUsername,
    isValidUsername,
    usernamePolicyText,
    loginRequest,
    registerRequest,
    searchUsers,
    getChats,
    getUser,
    getHistory,
    deleteMessage,
    deleteConversation
} from './api.js';

let socketConnection = null;
let routerReady = false;
let contactSearchTimer = null;
let realtime = null;
let state = {
    myUsername: null,
    myKeys: null,
    token: null,
    currentTargetUser: null,
    usersDirectory: {},
    sidebarChats: [],
    chatHistory: {},
    onlineUsers: new Set(),
    unreadCounts: {},
    typingUsers: new Set(),
    preferences: loadPreferences()
};

function syncRealtimeUi() {
    setRealtimeContext({
        onlineUsers: state.onlineUsers,
        unreadCounts: state.unreadCounts,
        typingUsers: state.typingUsers,
    });
}

function ensureRealtime() {
    if (realtime) return realtime;
    realtime = createRealtimeController({
        getSocket,
        sendPacket,
        getState: () => state,
        onUiSync: syncRealtimeUi,
    });
    return realtime;
}

function getSocket() {
    return socketConnection?.current || null;
}

function onContactSelected(username) {
    navigateTo(`/chat/@${username}`, handleNavigation);
}

function renderSidebar() {
    setSidebarChats(
        state.sidebarChats,
        state.myUsername,
        onContactSelected,
        state.currentTargetUser
    );
    syncRealtimeUi();
}

function upsertSidebarChat(partner, extras = {}) {
    if (!partner || partner === state.myUsername) return;

    const username = normalizeUsername(partner);
    const existingIndex = state.sidebarChats.findIndex(chat => chat.username === username);
    const merged = {
        ...(existingIndex >= 0 ? state.sidebarChats[existingIndex] : { username }),
        ...extras,
        username,
    };

    if (existingIndex >= 0) {
        state.sidebarChats.splice(existingIndex, 1);
    }
    state.sidebarChats.unshift(merged);

    if (merged.public_key) {
        state.usersDirectory[username] = merged.public_key;
    }
    renderSidebar();
}

function handleNewChatEvent(data) {
    const partner = data?.partner;
    if (!partner?.username) return;

    upsertSidebarChat(partner.username, {
        public_key: partner.public_key,
        last_message_at: data.last_message_at || new Date().toISOString(),
    });
}

function saveChatHistory() {
    saveHistory(state.myUsername, state.chatHistory);
}

function handleMessageDeletedEvent(data) {
    console.log('[WS RECEIVED]', data);

    const chatPartner = resolveDeletionChatPartner(data, state.myUsername);
    const activeChat = state.currentTargetUser;
    const deletion = {
        messageId: data.message_id,
        clientMessageId: data.client_message_id,
    };

    const messagesBefore = activeChat ? [...(state.chatHistory[activeChat] || [])] : [];
    const foundMessage = messagesBefore.find((m) => messageMatchesDeletion(m, deletion));
    const shouldRerender =
        Boolean(foundMessage) ||
        activeChatShouldRefresh(activeChat, data, state.chatHistory, state.myUsername);

    logDelete('[CURRENT CHAT]', activeChat);
    logDelete('[RESOLVED CHAT PARTNER]', chatPartner);
    logDelete('[MESSAGE FOUND in active chat]', Boolean(foundMessage));

    const { changed, partner: affectedKey } = applyMessageDeleted(
        state.chatHistory,
        data,
        saveChatHistory,
        state.myUsername
    );

    if (shouldRerender && activeChat) {
        const messagesAfter = state.chatHistory[activeChat] || [];
        renderMessagesList(messagesAfter);
        logDelete('[UI RERENDERED]', { activeChat, count: messagesAfter.length });
    } else if (changed) {
        const domFound = removeMessageFromDom({
            messageId: data.message_id,
            clientMessageId: data.client_message_id,
        });
        logDelete('[DOM ELEMENT FOUND]', domFound);
    }

    if (!changed && !foundMessage) {
        logDelete('[SKIP] no store change and message not in active chat');
    } else {
        logDelete('[STATE UPDATED]', { changed, affectedKey });
    }
}

function handleConversationDeletedEvent(data) {
    console.log('[WS RECEIVED]', data);

    const chatPartner = resolveDeletionChatPartner(
        {
            ...data,
            sender: data.deleted_by,
            receiver: data.partner || data.chat_id,
        },
        state.myUsername
    );
    if (!chatPartner) return;

    applyConversationDeleted(state.chatHistory, data, saveChatHistory, state.myUsername);
    state.sidebarChats = state.sidebarChats.filter(
        (chat) => normalizeUsername(chat.username) !== chatPartner
    );

    if (state.currentTargetUser && normalizeUsername(state.currentTargetUser) === chatPartner) {
        DOM.messagesDiv.innerHTML = "";
        clearDraft(state.myUsername, state.currentTargetUser);
        logDelete('[UI CLEARED conversation]', chatPartner);
    }

    renderSidebar();
}

function sendChatFocus(partner) {
    const socket = getSocket();
    if (!socket) return;
    sendPacket(socket, 'chat_focus', { partner: partner || null });
}

function markActiveChatRead() {
    const partner = state.currentTargetUser;
    if (!partner) return;

    ensureRealtime().clearUnread(partner);
    sendChatFocus(partner);

    scheduleReadReceipt(
        partner,
        (p, upToId) => ensureRealtime().sendReadReceipt(p, upToId),
        (p) => state.chatHistory[p]
    );
}

applyPreferences(state.preferences);
setPreferenceControls(state.preferences);
resetChatPanel();
clearUsersList();

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
            switchChat(targetUser);
        } else {
            state.currentTargetUser = null;
            sendChatFocus(null);
            cancelReadReceipt();
            resetChatPanel();
            DOM.chatWelcome.classList.remove('hidden');
        }
    }
}

// 2. AUTHORIZATION AND REGISTRATION (HTTP POST)
async function handleAuth(isLogin) {
    const username = normalizeUsername(DOM.usernameInput.value.trim());
    const password = DOM.passwordInput.value.trim();
    DOM.usernameInput.value = username;

    if (!username || !password) {
        showAuthMessage("Please enter both username and password.", true);
        return;
    }

    if (!isValidUsername(username)) {
        showAuthMessage(usernamePolicyText(), true);
        return;
    }

    try {
        if (isLogin) {
            const resData = await loginRequest(username, password);
            state.token = resData.access_token;

            localStorage.setItem('auth_token', state.token);
            localStorage.setItem('auth_username', username);

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

            await registerRequest({
                username,
                password,
                publicKey: pubJWK,
                encryptedPrivateKey: encPrivString
            });

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

async function loadSidebarChats() {
    if (!state.token || !state.myUsername) return;

    try {
        const chats = await getChats(state.token, 50);
        state.sidebarChats = chats;
        chats.forEach(chat => {
            state.usersDirectory[chat.username] = chat.public_key;
            if (chat.unread_count != null) {
                state.unreadCounts[chat.username] = chat.unread_count;
            }
        });
        renderSidebar();
    } catch (err) {
        console.error("Sidebar sync failed:", err);
        renderSidebar();
    }
}

// Runs after SUCCESSFUL login
function finishLoginSetup(username, exportedPublicKeyJSON, targetPath = '/chat') {
    state.myUsername = username;
    state.chatHistory = loadHistory(state.myUsername);

    ensureRouter();
    navigateTo(targetPath, handleNavigation);
    loadSidebarChats();
    ensureRealtime();

    if (socketConnection) {
        socketConnection.close();
    }

    socketConnection = connectToServer(
        state.token,
        (activeSocket) => {
            updateStatus("Online", "text-green-500");
            sendPacket(activeSocket, "join", {
                username: state.myUsername,
                public_key: exportedPublicKeyJSON
            });
            if (state.currentTargetUser) {
                sendPacket(activeSocket, "chat_focus", { partner: state.currentTargetUser });
            }
        },
        async (event) => {
            const data = JSON.parse(event.data);

            if (data.type === "users_list") {
                data.users.forEach(u => {
                    state.usersDirectory[u.username] = u.public_key;
                });
            }
            else if (data.type === "presence_sync") {
                ensureRealtime().setOnlineUsers(data.online || []);
            }
            else if (data.type === "presence") {
                ensureRealtime().setPresence(data.username, Boolean(data.online));
            }
            else if (data.type === "typing") {
                ensureRealtime().setTyping(data.from, Boolean(data.is_typing));
            }
            else if (data.type === "new_chat") {
                handleNewChatEvent(data);
            }
            else if (data.type === "message") {
                const encryptedBytes = new Uint8Array(data.content);
                const decryptedText = await decryptMessage(state.myKeys.privateKey, encryptedBytes);
                upsertSidebarChat(data.from, {
                    last_message_at: data.timestamp || new Date().toISOString(),
                });

                const isActiveChat = state.currentTargetUser === data.from;
                if (!isActiveChat) {
                    ensureRealtime().incrementUnread(data.from);
                }

                processMessage(data.from, {
                    id: data.id,
                    clientMessageId: data.client_message_id,
                    sender: data.from,
                    text: decryptedText,
                    type: "incoming",
                    timestamp: data.timestamp || Date.now()
                });

                if (data.id) {
                    ensureRealtime().sendDeliveryAck(data.from, data.id, data.client_message_id);
                    if (isActiveChat) {
                        markActiveChatRead();
                    }
                }
            }
            else if (data.type === "message_sync") {
                const partner = data.from;
                const messages = state.chatHistory[partner] || [];
                const target = messages.find(m => m.clientMessageId === data.client_message_id);

                if (target && data.id) {
                    target.id = data.id;
                    if (data.timestamp) target.timestamp = data.timestamp;
                    saveChatHistory();
                }

                if (state.currentTargetUser === partner && data.id) {
                    ensureRealtime().sendDeliveryAck(partner, data.id, data.client_message_id);
                    markActiveChatRead();
                }
            }
            else if (data.type === "message_ack") {
                onMessageAck(state.chatHistory, data, saveChatHistory);
            }
            else if (data.type === "message_status") {
                applyStatusEvent(state.chatHistory, data, saveChatHistory);
            }
            else if (data.type === "unread_sync") {
                ensureRealtime().setUnread(data.partner, data.unread_count);
            }
            else if (data.type === "message_deleted") {
                console.log('[WS RECEIVED] message_deleted', data);
                handleMessageDeletedEvent(data);
            }
            else if (data.type === "conversation_deleted") {
                handleConversationDeletedEvent(data);
            }
        },
        (event, closedByUser) => {
            if (!closedByUser) {
                updateStatus("Reconnecting...", "text-yellow-500");
                return;
            }
            updateStatus("Disconnected", "text-red-500");
        }
    );
}

function ensureRouter() {
    if (routerReady) return;
    initRouter(handleNavigation);
    routerReady = true;
}

function processMessage(chatPartner, messageInput) {
    if (!state.chatHistory[chatPartner]) {
        state.chatHistory[chatPartner] = [];
    }

    const message = {
        id: messageInput.id || null,
        clientMessageId: messageInput.clientMessageId || null,
        sender: messageInput.sender,
        text: messageInput.text,
        type: messageInput.type,
        timestamp: messageInput.timestamp || Date.now(),
        status: messageInput.status || (messageInput.type === 'outgoing' ? MESSAGE_STATUS.SENT : undefined),
        pending: messageInput.status === MESSAGE_STATUS.PENDING || messageInput.status === MESSAGE_STATUS.SENDING,
    };

    state.chatHistory[chatPartner].push(message);

    if (state.currentTargetUser === chatPartner) {
        const history = state.chatHistory[chatPartner];
        const prev = history.length > 1 ? history[history.length - 2] : null;
        appendMessage(message, null, null, null, prev);
    }
    saveHistory(state.myUsername, state.chatHistory);
}

async function ensureUserKey(username) {
    if (state.usersDirectory[username]) return true;

    try {
        const user = await getUser(state.token, username);
        state.usersDirectory[user.username] = user.public_key;
        return true;
    } catch (err) {
        console.error("User lookup failed:", err);
        showToast("User was not found.", "error");
        return false;
    }
}

// Switches active chat with cloud-history parsing layer integration
async function switchChat(username) {
    username = normalizeUsername(username);
    if (!isValidUsername(username)) {
        showToast(usernamePolicyText(), "error");
        navigateTo('/chat', handleNavigation);
        return;
    }

    const userReady = await ensureUserKey(username);
    if (!userReady) {
        navigateTo('/chat', handleNavigation);
        return;
    }

    persistCurrentDraft();
    cancelReadReceipt();
    state.currentTargetUser = username;
    sendChatFocus(username);
    activateChatPanel(username);
    DOM.chatWelcome.classList.add('hidden');
    DOM.messagesDiv.innerHTML = "";

    // --- SECURE LAZY CLOUD SYNCHRONIZATION ---
    // Fetch latest 50 messages slice. Server doesn't know plain text content!
    try {
        const cloudHistory = await getHistory(state.token, state.myUsername, username, 50, 0);
        state.chatHistory[username] = [];

        for (const msg of cloudHistory) {
            const isMe = (msg.sender === state.myUsername);
            const rawBytes = isMe ? msg.content_sender : msg.content_recipient;
            const encryptedBytes = new Uint8Array(rawBytes);

            try {
                const decryptedText = await decryptMessage(state.myKeys.privateKey, encryptedBytes);
                const outgoingStatus = isMe
                    ? deriveOutgoingStatusFromDb(msg, state.myUsername)
                    : undefined;
                state.chatHistory[username].push({
                    id: msg.id,
                    clientMessageId: msg.client_message_id,
                    sender: isMe ? "You" : msg.sender,
                    text: decryptedText,
                    type: isMe ? "outgoing" : "incoming",
                    timestamp: msg.timestamp || Date.now(),
                    status: outgoingStatus,
                    pending: false,
                });
            } catch (cryptoErr) {
                console.error("🔒 Crypto payload corruption block dropped:", cryptoErr);
            }
        }
    } catch (err) {
        console.warn("Database sync unreachable, using browser cache storage fallback:", err);
    }

    if (state.chatHistory[username]?.length) {
        renderMessagesList(state.chatHistory[username]);
    }
    setComposerValue(loadDraft(state.myUsername, username));
    setDraftStatus(getComposerValue() ? "Draft restored locally" : "Cipher Stack: AES-GCM-256 + RSA-OAEP-2048");
    saveHistory(state.myUsername, state.chatHistory);
    markActiveChatRead();
    syncRealtimeUi();
}

async function handleSendMessage() {
    const text = getComposerValue().trim();

    if (!state.currentTargetUser) {
        showToast("Select a chat first.", "error");
        return;
    }

    if (!text) {
        focusComposer();
        return;
    }

    if (text.length > 2000) {
        showToast("Message is over the 2000 character limit.", "error");
        focusComposer();
        return;
    }

    const targetPublicKeyJWK = state.usersDirectory[state.currentTargetUser];
    if (!targetPublicKeyJWK) {
        showToast("Recipient key is not available yet. Refresh contacts.", "error");
        focusComposer();
        return;
    }

    try {
        const targetCryptoKey = await importPublicKey(targetPublicKeyJWK);
        const encryptedBufferRecipient = await encryptMessage(targetCryptoKey, text);
        const encryptedArrayRecipient = Array.from(new Uint8Array(encryptedBufferRecipient));

        const encryptedBufferSelf = await encryptMessage(state.myKeys.publicKey, text);
        const encryptedArraySender = Array.from(new Uint8Array(encryptedBufferSelf));
        const clientMessageId = crypto.randomUUID();

        const sent = sendPacket(getSocket(), "message", {
            to: state.currentTargetUser,
            content_recipient: encryptedArrayRecipient,
            content_sender: encryptedArraySender,
            client_message_id: clientMessageId
        });

        if (!sent) {
            const failed = createOutgoingMessage({
                clientMessageId,
                text,
                status: MESSAGE_STATUS.FAILED,
            });
            processMessage(state.currentTargetUser, failed);
            throw new Error("WebSocket is not connected");
        }

        upsertSidebarChat(state.currentTargetUser, {
            public_key: targetPublicKeyJWK,
            last_message_at: new Date().toISOString(),
        });

        processMessage(state.currentTargetUser, createOutgoingMessage({
            clientMessageId,
            text,
            status: MESSAGE_STATUS.SENDING,
        }));
        clearDraft(state.myUsername, state.currentTargetUser);
        clearComposer();
        setDraftStatus("Message queued. Waiting for database sync.");
    } catch (err) {
        console.error("Message send failed:", err);
        showToast("Message send failed. Check connection and keys.", "error");
    } finally {
        focusComposer();
    }
}

window.handleSendMessage = handleSendMessage;

// Event Listeners
DOM.btnLogin.addEventListener('click', () => handleAuth(true));
DOM.btnRegister.addEventListener('click', () => handleAuth(false));
DOM.usernameInput.addEventListener('input', () => {
    DOM.usernameInput.value = normalizeUsername(DOM.usernameInput.value);
});
DOM.usernameInput.addEventListener('keydown', handleAuthKeyboard);
DOM.passwordInput.addEventListener('keydown', handleAuthKeyboard);
DOM.sendBtn.addEventListener('click', handleSendMessage);

DOM.messageInput.addEventListener('input', () => {
    autoResizeComposer();
    updateComposerMeta(getComposerValue());
    persistCurrentDraft();
    if (state.currentTargetUser && getComposerValue().trim()) {
        ensureRealtime().notifyTyping(state.currentTargetUser);
    }
});

DOM.messageInput.addEventListener('keydown', (event) => {
    const primary = event.metaKey || event.ctrlKey;
    if (event.key === 'Enter' && !event.shiftKey && (state.preferences.enterToSend || primary)) {
        event.preventDefault();
        handleSendMessage();
    }
});

DOM.contactSearchInput.addEventListener('input', () => {
    handleContactSearchInput();
});

DOM.clearContactSearchBtn.addEventListener('click', () => {
    DOM.contactSearchInput.value = '';
    filterUsers('');
    clearUsersList();
    focusContactSearch();
});

DOM.refreshUsersBtn.addEventListener('click', refreshUsersDirectory);
DOM.focusContactsBtn.addEventListener('click', focusContactSearch);
DOM.focusComposerBtn.addEventListener('click', focusComposer);
DOM.settingsBtn.addEventListener('click', openSettings);
DOM.shortcutsBtn.addEventListener('click', openShortcuts);
DOM.closeSettingsBtn.addEventListener('click', closeModals);
DOM.closeShortcutsBtn.addEventListener('click', closeModals);
DOM.backdrop.addEventListener('click', closeModals);

DOM.copyUsernameBtn.addEventListener('click', copyCurrentUsername);
DOM.logoutBtn.addEventListener('click', handleLogout);

DOM.chatMenuBtn.addEventListener('click', openChatMenu);
DOM.composerMenuBtn.addEventListener('click', openComposerMenu);
DOM.chatSearchBtn.addEventListener('click', openMessageSearch);
DOM.closeMessageSearchBtn.addEventListener('click', closeMessageSearch);
DOM.messageSearchInput.addEventListener('input', () => searchMessages(DOM.messageSearchInput.value));
DOM.scrollBottomBtn.addEventListener('click', scrollMessagesToBottom);

DOM.copyChatLinkBtn.addEventListener('click', copyCurrentChatLink);
DOM.exportChatBtn.addEventListener('click', exportCurrentChat);
DOM.clearChatBtn.addEventListener('click', clearCurrentChat);

DOM.attachBtn.addEventListener('click', () => DOM.fileInput.click());
DOM.fileInput.addEventListener('change', () => {
    if (!DOM.fileInput.files.length) return;
    insertAtCursor(createFileMarkers(DOM.fileInput.files));
    persistCurrentDraft();
    DOM.fileInput.value = '';
});

DOM.insertTimestampBtn.addEventListener('click', () => {
    insertAtCursor(new Date().toLocaleString());
    persistCurrentDraft();
    closeAllPopovers();
});

DOM.insertSecurityNoteBtn.addEventListener('click', () => {
    insertAtCursor('Encrypted locally before transport.');
    persistCurrentDraft();
    closeAllPopovers();
});

DOM.clearDraftBtn.addEventListener('click', () => {
    clearDraft(state.myUsername, state.currentTargetUser);
    clearComposer();
    setDraftStatus("Draft cleared.");
    closeAllPopovers();
});

bindPreferenceToggle(DOM.prefEnterSend, 'enterToSend');
bindPreferenceToggle(DOM.prefCompactMode, 'compactMode');
bindPreferenceToggle(DOM.prefShowTimestamps, 'showTimestamps');

if (DOM.themePicker) {
    DOM.themePicker.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-theme-value]');
        if (!btn) return;
        state.preferences = updatePreference(state.preferences, 'theme', btn.dataset.themeValue);
        setPreferenceControls(state.preferences);
        showToast('Theme updated.', 'success');
    });
}
document.addEventListener('click', (event) => {
    const clickedPopover = event.target.closest('.popover-menu');
    const clickedPopoverButton = event.target.closest('#uiChatMenuBtn, #uiComposerMenuBtn');
    if (!clickedPopover && !clickedPopoverButton) {
        closeAllPopovers();
    }
});

setMessageActionHandlers({
    onDeleteMessage: deleteSingleMessage
});

registerShortcuts({
    closeTransientUi: () => {
        closeTransientUi();
        closeMessageSearch();
    },
    openShortcuts,
    openSettings,
    openMessageSearch,
    focusContacts: focusContactSearch,
    focusComposer,
    exportChat: exportCurrentChat
});

function handleAuthKeyboard(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        handleAuth(true);
    }
}

function bindPreferenceToggle(control, key) {
    control.addEventListener('change', () => {
        state.preferences = updatePreference(state.preferences, key, control.checked);
        setPreferenceControls(state.preferences);
        showToast("Interface setting saved.", "success");
    });
}

function handleContactSearchInput() {
    const query = normalizeUsername(DOM.contactSearchInput.value);
    DOM.contactSearchInput.value = query;
    filterUsers(query);

    window.clearTimeout(contactSearchTimer);

    if (query.length < 2) {
        renderSidebar();
        return;
    }

    clearUsersList("Searching...");
    contactSearchTimer = window.setTimeout(() => {
        performUserSearch(query);
    }, 220);
}

async function performUserSearch(query) {
    try {
        const users = await searchUsers(state.token, query, 20);
        users.forEach(user => {
            state.usersDirectory[user.username] = user.public_key;
        });
        renderUsersList(users, state.myUsername, onContactSelected, state.currentTargetUser);
    } catch (err) {
        console.error("User search failed:", err);
        clearUsersList("Search failed");
        showToast(err.message || "User search failed.", "error");
    }
}

function persistCurrentDraft() {
    if (!state.myUsername || !state.currentTargetUser) return;

    const text = getComposerValue();
    if (text.trim()) {
        saveDraft(state.myUsername, state.currentTargetUser, text);
        setDraftStatus("Draft saved locally.");
    } else {
        clearDraft(state.myUsername, state.currentTargetUser);
        setDraftStatus("Cipher Stack: AES-GCM-256 + RSA-OAEP-2048");
    }
}

function refreshUsersDirectory() {
    const query = normalizeUsername(DOM.contactSearchInput.value);
    if (query.length < 2) {
        loadSidebarChats();
        showToast("Conversations refreshed.", "success");
        return;
    }

    performUserSearch(query);
}

async function copyCurrentUsername() {
    if (!state.myUsername) {
        showToast("No active identity.", "error");
        return;
    }

    try {
        await copyText(state.myUsername);
        showToast("Identity copied.", "success");
    } catch (err) {
        console.error("Copy identity failed:", err);
        showToast("Copy failed.", "error");
    }
}

async function copyCurrentChatLink() {
    if (!state.currentTargetUser) {
        showToast("Select a chat first.", "error");
        return;
    }

    try {
        await copyText(`${window.location.origin}/chat/@${state.currentTargetUser}`);
        closeAllPopovers();
        showToast("Chat link copied.", "success");
    } catch (err) {
        console.error("Copy chat link failed:", err);
        showToast("Copy failed.", "error");
    }
}

function exportCurrentChat() {
    if (!state.currentTargetUser) {
        showToast("Select a chat first.", "error");
        return;
    }

    const messages = state.chatHistory[state.currentTargetUser] || [];
    const transcript = buildChatTranscript({
        owner: state.myUsername,
        partner: state.currentTargetUser,
        messages
    });
    const filename = `originhub-${makeSafeFilename(state.currentTargetUser)}-${new Date().toISOString().slice(0, 10)}.txt`;

    downloadTextFile(filename, transcript);
    closeAllPopovers();
    showToast("Local chat exported.", "success");
}

async function clearCurrentChat() {
    if (!state.currentTargetUser) {
        showToast("Select a chat first.", "error");
        return;
    }

    const partner = state.currentTargetUser;
    const confirmed = window.confirm(`Delete the entire chat history with ${partner} from the database? This cannot be undone.`);
    if (!confirmed) {
        closeAllPopovers();
        focusComposer();
        return;
    }

    try {
        await deleteConversation(state.token, partner);
        state.chatHistory[partner] = [];
        state.sidebarChats = state.sidebarChats.filter(chat => chat.username !== partner);
        DOM.messagesDiv.innerHTML = "";
        clearDraft(state.myUsername, partner);
        saveHistory(state.myUsername, state.chatHistory);
        renderSidebar();
        closeAllPopovers();
        showToast("Chat history deleted from database.", "success");
    } catch (err) {
        console.error("Conversation delete failed:", err);
        showToast(err.message || "Could not delete chat history.", "error");
    } finally {
        focusComposer();
    }
}

async function deleteSingleMessage(messageId) {
    if (!state.currentTargetUser || !messageId) return;

    const confirmed = window.confirm("Delete this message from the database?");
    if (!confirmed) {
        focusComposer();
        return;
    }

    const partner = state.currentTargetUser;
    const snapshot = [...(state.chatHistory[partner] || [])];
    const targetMsg = snapshot.find((m) => String(m.id) === String(messageId));
    const clientMessageId = targetMsg?.clientMessageId;

    const optimisticEvent = {
        message_id: messageId,
        client_message_id: clientMessageId,
        partner,
        deleted_by: state.myUsername,
        sender: state.myUsername,
        receiver: partner,
    };

    applyMessageDeleted(state.chatHistory, optimisticEvent, saveChatHistory, state.myUsername);
    if (state.currentTargetUser === partner) {
        renderMessagesList(state.chatHistory[partner] || []);
    }

    try {
        await deleteMessage(state.token, messageId);
        showToast("Message deleted from database.", "success");
    } catch (err) {
        console.error("Message delete failed:", err);
        state.chatHistory[partner] = snapshot;
        saveChatHistory();
        if (state.currentTargetUser === partner) {
            renderMessagesList(snapshot);
        }
        showToast(err.message || "Could not delete message.", "error");
    } finally {
        focusComposer();
    }
}

function handleLogout() {
    persistCurrentDraft();

    if (socketConnection) {
        socketConnection.close();
        socketConnection = null;
    }
    window.clearTimeout(contactSearchTimer);

    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');

    state.myUsername = null;
    state.myKeys = null;
    state.token = null;
    state.currentTargetUser = null;
    state.usersDirectory = {};
    state.sidebarChats = [];
    state.chatHistory = {};
    state.onlineUsers = new Set();
    state.unreadCounts = {};
    state.typingUsers = new Set();
    cancelReadReceipt();
    sendChatFocus(null);
    realtime?.reset();
    realtime = null;

    DOM.usernameInput.value = "";
    DOM.passwordInput.value = "";
    DOM.contactSearchInput.value = "";
    filterUsers("");
    clearUsersList();
    resetChatPanel();
    updateStatus("Disconnected", "text-red-500");
    navigateTo('/login', handleNavigation);
    showToast("Logged out.", "success");
}

// Asynchronous application rehydration task to process auto-logins on page reloads
async function initializeApp() {
    const savedToken = localStorage.getItem('auth_token');
    const savedUsername = localStorage.getItem('auth_username');
    const initialPath = window.location.pathname;

    if (savedToken && savedUsername) {
        const savedKeysJWK = loadKeys(savedUsername);
        if (savedKeysJWK) {
            try {
                // Restore tokens to active RAM state boundaries
                state.token = savedToken;
                state.myUsername = savedUsername;
                state.myKeys = {
                    publicKey: await importPublicKey(savedKeysJWK.publicKey),
                    privateKey: await importPrivateKey(savedKeysJWK.privateKey)
                };
                
                // Fire up setup and bypass login form, preserving the current deep-linked path
                const routeFallback = (initialPath === '/' || initialPath === '/login') ? '/chat' : initialPath;
                finishLoginSetup(savedUsername, savedKeysJWK.publicKey, routeFallback);
                return;
            } catch (err) {
                console.error("Session rehydration failed:", err);
                localStorage.removeItem('auth_token');
                localStorage.removeItem('auth_username');
            }
        }
    }

    // Default flow: Boot the client-side router normally if no session exists
    ensureRouter();
    if (initialPath === '/' || initialPath === '/chat') {
        navigateTo('/login', handleNavigation);
    }
}

// Trigger the application boot sequence
initializeApp();
