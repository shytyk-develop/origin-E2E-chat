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
    clearMessageView,
    patchGroupingFromState,
    patchMessageReplyPreview,
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
    openSettingsMenu,
    closeAllPopovers,
    openChatInfoPopover,
    initMessageContextMenu,
    initMessageActions,
    highlightMessageRow,
    openMessageSearch,
    closeMessageSearch,
    searchMessages,
    openSettings,
    openProfile,
    openShortcuts,
    closeModals,
    closeTransientUi,
    showToast,
    setPreferenceControls,
    clearUsersList,
    showContactsLoading,
    updateMessageIdentity,
    updateMessageStatus,
    removeMessageElement,
    removeMessageFromDom,
    setMessageActionHandlers,
    setRealtimeContext,
    setUiPreferences,
    updateProfileRailButton,
    refreshContactList,
    showComposerReplyBar,
    hideComposerReplyBar,
    patchMessageReactionsDom,
    openReactionPicker,
    scrollToMessageById,
    reconcileMessageRowsWithHistory,
    MAX_MESSAGE_LENGTH,
    showComposerLimitError,
    clearComposerLimitError,
} from './ui.js';
import {
    attachReplyToMessage,
    buildPendingReplyFromMessage,
} from './messageReply.js';
import {
    applyReactionSync,
    applyLocalReaction,
    getMyReaction,
    normalizeReactionsList,
    sendReactionPacket,
} from './messageReactions.js';
import { createRealtimeController, isUserOnline } from './realtime.js';
import {
    initOverlayManager,
    registerOverlayActions,
    closeOverlaysForRouteChange,
} from '../ui/overlays/overlayManager.js';
import {
    MESSAGE_STATUS,
    createOutgoingMessage,
    deriveOutgoingStatusFromDb,
} from './messageState.js';
import {
    applyStatusEvent,
    onMessageAck,
    flushReadReceipt,
    cancelReadReceipt,
} from './messageSync.js';
import {
    applyMessageDeleted,
    applyConversationDeleted,
    logDelete,
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
import { initProfileSettings } from './profileSettings.js';
import { initLoginPage, teardownLoginPage } from './loginPage.js';
import { playLoginSuccessReveal, resetLoginBackground } from './loginCanvas.js';
import { getPrivacyFlags, isChatMuted, toggleChatMuted } from './privacy.js';
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
    deleteConversation,
    updateProfile,
} from './api.js';
import {
    cacheRemoteProfileFromApi,
    clearProfileDirectory,
    ingestUserRecords,
} from './profileDirectory.js';
import { initMiniProfile } from './miniProfile.js';

let socketConnection = null;
let routerReady = false;
let contactSearchTimer = null;
let saveChatHistoryTimer = null;
let realtime = null;
let state = {
    myUsername: null,
    myKeys: null,
    myPublicKeyJwk: null,
    token: null,
    currentTargetUser: null,
    usersDirectory: {},
    sidebarChats: [],
    chatHistory: {},
    onlineUsers: new Set(),
    unreadCounts: {},
    typingUsers: new Set(),
    preferences: loadPreferences(),
    pendingReply: null,
};

function syncRealtimeUi() {
    setRealtimeContext({
        onlineUsers: state.onlineUsers,
        unreadCounts: state.unreadCounts,
        typingUsers: state.typingUsers,
    });
}

function syncUiPreferences() {
    setUiPreferences(state.preferences);
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
    if (!state.myUsername) return;
    window.clearTimeout(saveChatHistoryTimer);
    saveChatHistoryTimer = window.setTimeout(() => {
        saveHistory(state.myUsername, state.chatHistory);
        saveChatHistoryTimer = null;
    }, 120);
}

function flushChatHistorySave() {
    if (saveChatHistoryTimer) {
        window.clearTimeout(saveChatHistoryTimer);
        saveChatHistoryTimer = null;
    }
    if (state.myUsername) {
        saveHistory(state.myUsername, state.chatHistory);
    }
}

function clearPendingReply() {
    state.pendingReply = null;
    hideComposerReplyBar();
}

function startReplyToMessage(payload) {
    const partner = state.currentTargetUser;
    if (!partner || !payload?.messageId) return;

    const message = (state.chatHistory[partner] || []).find(
        (m) => String(m.id) === String(payload.messageId)
    );
    if (!message) return;

    state.pendingReply = buildPendingReplyFromMessage(message, partner);
    showComposerReplyBar(state.pendingReply);
    focusComposer();
}

function sendReactionForMessage(messageId, emoji) {
    const partner = state.currentTargetUser;
    if (!partner || messageId == null) return;

    const message = (state.chatHistory[partner] || []).find(
        (m) => String(m.id) === String(messageId)
    );
    if (!message) return;

    const mine = getMyReaction(message.reactions, state.myUsername);
    const nextEmoji = mine === emoji ? null : emoji;
    const previous = normalizeReactionsList(message.reactions);

    const reactions = applyLocalReaction(message, state.myUsername, nextEmoji);
    saveChatHistory();
    patchMessageReactionsDom(messageId, reactions, state.myUsername);

    const sent = sendReactionPacket(getSocket(), sendPacket, messageId, nextEmoji);
    if (!sent) {
        message.reactions = previous;
        saveChatHistory();
        patchMessageReactionsDom(messageId, previous, state.myUsername);
        showToast('Could not send reaction. Check connection.', 'error');
    }
}

function handleToggleReaction(messageId, emoji, anchor) {
    if (emoji) {
        sendReactionForMessage(messageId, emoji);
        return;
    }

    if (anchor) {
        openReactionPicker(anchor, messageId);
        return;
    }

    const partner = state.currentTargetUser;
    const message = (state.chatHistory[partner] || []).find(
        (m) => String(m.id) === String(messageId)
    );
    const mine = message ? getMyReaction(message.reactions, state.myUsername) : null;
    if (mine) {
        sendReactionForMessage(messageId, mine);
    }
}

function mapDbMessageToLocal(msg, partner) {
    const isMe = msg.sender === state.myUsername;
    const record = {
        id: msg.id,
        clientMessageId: msg.client_message_id,
        sender: isMe ? 'You' : msg.sender,
        text: '',
        type: isMe ? 'outgoing' : 'incoming',
        timestamp: msg.timestamp || Date.now(),
        status: isMe ? deriveOutgoingStatusFromDb(msg, state.myUsername) : undefined,
        pending: false,
        reactions: normalizeReactionsList(msg.reactions),
    };
    attachReplyToMessage(
        record,
        state.chatHistory,
        partner,
        msg.reply_to_message_id,
        state.myUsername
    );
    return record;
}

function markRepliesUnavailable(partner, deletedMessageId) {
    const messages = state.chatHistory[partner] || [];
    const affectedIds = [];
    messages.forEach((m) => {
        if (m.replyTo && String(m.replyTo.messageId) === String(deletedMessageId)) {
            m.replyTo = {
                messageId: deletedMessageId,
                unavailable: true,
                deleted: true,
                author: m.replyTo.author || '',
                preview: 'Message deleted',
            };
            if (m.id != null) affectedIds.push(m.id);
        }
    });
    return affectedIds;
}

function patchReplyPreviewsForMessages(partner, messageIds) {
    const messages = state.chatHistory[partner] || [];
    messageIds.forEach((id) => {
        const msg = messages.find((m) => m.id != null && String(m.id) === String(id));
        if (msg?.replyTo) {
            patchMessageReplyPreview(msg.id, msg.replyTo);
        }
    });
}

function applyActiveChatMessageDeletion(deletion) {
    const activeChat = state.currentTargetUser;
    if (!activeChat) return;

    const removed = removeMessageFromDom(deletion);
    const messagesAfter = state.chatHistory[activeChat] || [];
    if (removed) {
        patchGroupingFromState(messagesAfter);
    }
}

function handleMessageDeletedEvent(data) {
    console.log('[WS RECEIVED]', data);

    const chatPartner = resolveDeletionChatPartner(data, state.myUsername);
    const activeChat = state.currentTargetUser;
    const deletion = {
        messageId: data.message_id,
        clientMessageId: data.client_message_id,
    };

    const partnerKey = chatPartner || activeChat;
    const affectedReplyIds =
        partnerKey && data.message_id
            ? markRepliesUnavailable(partnerKey, data.message_id)
            : [];

    const { changed, partner: affectedKey } = applyMessageDeleted(
        state.chatHistory,
        data,
        saveChatHistory,
        state.myUsername
    );

    const activePartner = activeChat && (
        activeChat === partnerKey ||
        activeChat === affectedKey ||
        normalizeUsername(activeChat) === normalizeUsername(partnerKey || '')
    );

    if (activePartner) {
        applyActiveChatMessageDeletion(deletion);
        if (affectedReplyIds.length) {
            patchReplyPreviewsForMessages(activeChat, affectedReplyIds);
        }
    } else if (changed) {
        removeMessageFromDom(deletion);
    }

    logDelete('[STATE UPDATED]', { changed, affectedKey, activePartner, affectedReplyIds });
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
        clearMessageView();
        clearDraft(state.myUsername, state.currentTargetUser);
        logDelete('[UI CLEARED conversation]', chatPartner);
    }

    renderSidebar();
}

function refreshContactsDisplay() {
    refreshContactList();
    syncRealtimeUi();
}

function handleProfileUpdated(data) {
    if (!data?.username) return;
    cacheRemoteProfileFromApi(data.username, data);
    refreshContactsDisplay();
    if (state.currentTargetUser === data.username) {
        activateChatPanel(data.username);
    }
}

async function syncProfileToServer(profile) {
    if (!state.token || !profile) return;
    await updateProfile(state.token, profile);
}

function sendChatFocus(partner) {
    const socket = getSocket();
    if (!socket) return;
    sendPacket(socket, 'chat_focus', { partner: partner || null });
}

function syncPresencePrivacy() {
    const share = getPrivacyFlags(state.preferences).showOnlineStatus;
    const socket = getSocket();
    if (socket) {
        sendPacket(socket, 'presence_setting', { share_presence: share });
    }
    if (!share) {
        ensureRealtime().setOnlineUsers([]);
    }
    syncRealtimeUi();
}

function markActiveChatRead() {
    const partner = state.currentTargetUser;
    if (!partner) return;

    ensureRealtime().clearUnread(partner);
    sendChatFocus(partner);

    if (!getPrivacyFlags(state.preferences).readReceipts) return;

    flushReadReceipt(
        partner,
        (p, upToId) => ensureRealtime().sendReadReceipt(p, upToId),
        (p) => state.chatHistory[p]
    );
}

applyPreferences(state.preferences);
setPreferenceControls(state.preferences);
syncUiPreferences();
resetChatPanel();
clearUsersList();

initOverlayManager();

initProfileSettings({
    getUsername: () => state.myUsername || localStorage.getItem('auth_username') || '',
    getPublicKeyJwk: () => state.myPublicKeyJwk,
    ensurePublicKeyJwk: async () => {
        if (state.myPublicKeyJwk) return state.myPublicKeyJwk;
        const user = state.myUsername || localStorage.getItem('auth_username');
        const saved = loadKeys(user);
        if (saved?.publicKey) {
            state.myPublicKeyJwk = saved.publicKey;
            return saved.publicKey;
        }
        return null;
    },
    getPreferences: () => state.preferences,
    onPreferenceChange: (key, value) => {
        state.preferences = updatePreference(state.preferences, key, value);
        setPreferenceControls(state.preferences);
        syncUiPreferences();
        if (key === 'showOnlineStatus') {
            syncPresencePrivacy();
        }
        if (key === 'typingIndicators' && !value) {
            ensureRealtime().stopTyping();
            state.typingUsers = new Set();
            syncRealtimeUi();
        }
        showToast('Privacy setting applied.', 'success');
    },
    onProfileSaved: async (profile) => {
        updateProfileRailButton(state.myUsername);
        try {
            await syncProfileToServer(profile);
            refreshContactsDisplay();
        } catch (err) {
            console.error('Profile sync failed:', err);
            showToast('Saved locally; server sync failed.', 'error');
        }
    },
    onClearAllHistory: async () => {
        const partners = new Set([
            ...Object.keys(state.chatHistory || {}),
            ...(state.sidebarChats || []).map((chat) => chat.username),
        ]);
        const errors = [];
        for (const partner of partners) {
            if (!partner) continue;
            if (normalizeUsername(partner) === normalizeUsername(state.myUsername)) continue;
            try {
                await deleteConversation(state.token, partner);
            } catch (err) {
                console.error('Delete conversation failed:', partner, err);
                errors.push(partner);
            }
        }
        state.chatHistory = {};
        flushChatHistorySave();
        state.sidebarChats = [];
        clearMessageView();
        resetChatPanel();
        renderSidebar();
        if (errors.length) {
            throw new Error(`Could not delete: ${errors.join(', ')}`);
        }
    },
    showToast,
});

initMiniProfile({
    getMyUsername: () => state.myUsername,
    onOpenChat: onContactSelected,
    showToast,
    isOnline: (username) => isUserOnline(state, username),
    isMuted: (username) => isChatMuted(state.myUsername, username),
    onToggleMute: (partner) => {
        if (!state.myUsername || !partner) return;
        const muted = toggleChatMuted(state.myUsername, partner);
        showToast(muted ? 'Chat muted locally.' : 'Chat unmuted.', 'success');
        syncRealtimeUi();
    },
    showPresence: () => getPrivacyFlags(state.preferences).showOnlineStatus,
});

registerOverlayActions({
    'chat.search': () => openMessageSearch(),
    'chat.copyLink': () => copyCurrentChatLink(),
    'chat.export': () => exportCurrentChat(),
    'chat.clearHistory': () => clearCurrentChat(),
    'chat.delete': () => clearCurrentChat(),
    'chat.info': () => {
        if (!state.currentTargetUser) {
            showToast('Select a chat first.', 'error');
            return;
        }
        const partner = state.currentTargetUser;
        openChatInfoPopover(
            partner,
            isUserOnline(state, partner),
            state.usersDirectory[partner] || null,
            {
                preferences: state.preferences,
                muted: isChatMuted(state.myUsername, partner),
            }
        );
    },
    'chat.mute': () => toggleCurrentChatMute(),
    'settings.modal': () => openSettings(),
    'settings.shortcuts': () => openShortcuts(),
    'composer.timestamp': () => {
        insertAtCursor(new Date().toLocaleString());
        persistCurrentDraft();
    },
    'composer.securityNote': () => {
        insertAtCursor('Encrypted locally before transport.');
        persistCurrentDraft();
    },
    'composer.clearDraft': () => {
        clearDraft(state.myUsername, state.currentTargetUser);
        clearComposer();
        setDraftStatus('Draft cleared.');
    },
    'theme.set': ({ theme }) => {
        state.preferences = updatePreference(state.preferences, 'theme', theme);
        setPreferenceControls(state.preferences);
        showToast('Theme updated.', 'success');
    },
    'message.copy': (payload) => {
        const text = payload?.text || '';
        if (!text) return;
        copyText(text)
            .then(() => showToast('Message copied.', 'success'))
            .catch(() => showToast('Copy failed.', 'error'));
    },
    'message.delete': (payload) => {
        if (payload?.messageId) deleteSingleMessage(payload.messageId);
    },
    'message.highlight': (payload) => {
        highlightMessageRow(payload?.messageId || payload?.clientMessageId);
    },
    'message.reply': (payload) => {
        startReplyToMessage(payload);
    },
    'message.react': (payload) => {
        if (!payload?.messageId) return;
        const row = DOM.messagesDiv.querySelector(
            `[data-message-id="${CSS.escape(String(payload.messageId))}"]`
        );
        const anchor = row?.querySelector('.message-bubble') || row;
        handleToggleReaction(payload.messageId, null, anchor);
    },
    'reaction.pick': (payload) => {
        if (payload?.messageId && payload?.emoji) {
            sendReactionForMessage(payload.messageId, payload.emoji);
        }
    },
});

function resolveMessageForRow(row) {
    const partner = state.currentTargetUser;
    if (!partner || !row) return null;

    const messageId = row.dataset.messageId;
    const clientMessageId = row.dataset.clientMessageId;
    const history = state.chatHistory[partner] || [];

    return history.find((item) =>
        (messageId != null && messageId !== '' && item.id != null && String(item.id) === String(messageId)) ||
        (clientMessageId && item.clientMessageId === clientMessageId)
    ) || null;
}

setMessageActionHandlers({
    onDeleteMessage: deleteSingleMessage,
    onReply: (message) => startReplyToMessage({ messageId: message.id }),
    onReact: (messageId, emoji, anchor) => handleToggleReaction(messageId, emoji, anchor),
    getMyUsername: () => state.myUsername,
    resolveMessage: resolveMessageForRow,
    onActionUnavailable: () => {
        showToast('Message is still syncing. Try again in a moment.', 'info');
    },
});

initMessageContextMenu((row) => {
    const message = resolveMessageForRow(row);
    const text = row.querySelector('.message-text')?.textContent || '';
    return {
        messageId: message?.id != null ? String(message.id) : (row.dataset.messageId || null),
        clientMessageId: row.dataset.clientMessageId || null,
        messageType: row.dataset.messageType,
        text,
    };
});
initMessageActions();

let loginUiMounted = false;

function setAuthPending(isPending) {
    DOM.pageLogin?.classList.toggle('is-loading', isPending);
    DOM.btnLogin.disabled = isPending;
    DOM.btnRegister.disabled = isPending;
}

// Main routing handler
async function handleNavigation(view, param) {
    closeOverlaysForRouteChange();
    document.querySelectorAll('.route-page').forEach(page => page.classList.add('hidden'));

    if (view === 'login') {
        DOM.pageLogin.classList.remove('hidden');
        setAuthPending(false);
        if (!loginUiMounted) {
            initLoginPage(DOM.pageLogin);
            loginUiMounted = true;
        } else {
            resetLoginBackground(DOM.pageLogin);
        }
    } 
    else {
        if (loginUiMounted) {
            teardownLoginPage();
            loginUiMounted = false;
        }

        if (view === 'chat' || view === 'chat-user') {
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

            setAuthPending(true);
            await playLoginSuccessReveal(DOM.pageLogin);
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
        setAuthPending(false);
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
        ingestUserRecords(chats);
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
    state.myPublicKeyJwk = exportedPublicKeyJSON;
    state.chatHistory = loadHistory(state.myUsername);
    updateProfileRailButton(username);

    ensureRouter();
    navigateTo(targetPath, handleNavigation);
    showContactsLoading();
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
                public_key: exportedPublicKeyJSON,
                share_presence: getPrivacyFlags(state.preferences).showOnlineStatus,
            });
            if (state.currentTargetUser) {
                sendPacket(activeSocket, "chat_focus", { partner: state.currentTargetUser });
            }
        },
        async (event) => {
            const data = JSON.parse(event.data);

            if (data.type === "users_list") {
                ingestUserRecords(data.users);
                data.users.forEach(u => {
                    state.usersDirectory[u.username] = u.public_key;
                });
                refreshContactList();
            }
            else if (data.type === "profile_updated") {
                handleProfileUpdated(data);
            }
            else if (data.type === "presence_sync") {
                if (getPrivacyFlags(state.preferences).showOnlineStatus) {
                    ensureRealtime().setOnlineUsers(data.online || []);
                } else {
                    ensureRealtime().setOnlineUsers([]);
                }
                syncRealtimeUi();
            }
            else if (data.type === "presence") {
                if (!getPrivacyFlags(state.preferences).showOnlineStatus) return;
                ensureRealtime().setPresence(data.username, Boolean(data.online));
                syncRealtimeUi();
            }
            else if (data.type === "typing") {
                if (getPrivacyFlags(state.preferences).typingIndicators) {
                    ensureRealtime().setTyping(data.from, Boolean(data.is_typing));
                }
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
                if (!isActiveChat && !isChatMuted(state.myUsername, data.from)) {
                    ensureRealtime().incrementUnread(data.from);
                }

                const incoming = {
                    id: data.id,
                    clientMessageId: data.client_message_id,
                    sender: data.from,
                    text: decryptedText,
                    type: "incoming",
                    timestamp: data.timestamp || Date.now(),
                    reactions: [],
                };
                attachReplyToMessage(
                    incoming,
                    state.chatHistory,
                    data.from,
                    data.reply_to_message_id,
                    state.myUsername
                );
                processMessage(data.from, incoming);

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
                    if (data.reply_to_message_id) {
                        attachReplyToMessage(
                            target,
                            state.chatHistory,
                            partner,
                            data.reply_to_message_id,
                            state.myUsername
                        );
                        if (state.currentTargetUser === partner && target.id && target.replyTo) {
                            patchMessageReplyPreview(target.id, target.replyTo);
                        }
                    }
                    saveChatHistory();
                    if (
                        state.currentTargetUser === partner &&
                        data.client_message_id
                    ) {
                        updateMessageIdentity(
                            data.client_message_id,
                            data.id,
                            data.timestamp,
                            target.status || 'sent'
                        );
                        reconcileMessageRowsWithHistory([target]);
                    }
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
            else if (data.type === "reaction_sync") {
                handleReactionSyncEvent(data);
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

function handleReactionSyncEvent(data) {
    const result = applyReactionSync(state.chatHistory, data, state.myUsername);
    if (!result) return;
    saveChatHistory();

    const row = DOM.messagesDiv.querySelector(
        `[data-message-id="${CSS.escape(String(data.message_id))}"]`
    );
    if (row) {
        patchMessageReactionsDom(data.message_id, result.reactions, state.myUsername);
    } else if (state.currentTargetUser) {
        reconcileMessageRowsWithHistory(state.chatHistory[state.currentTargetUser] || []);
    }
}

function findHistoryMessage(history, message) {
    if (!Array.isArray(history) || !message) return null;
    return history.find((item) =>
        (message.id != null && item.id != null && String(item.id) === String(message.id)) ||
        (message.clientMessageId && item.clientMessageId === message.clientMessageId)
    ) || null;
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
        replyTo: messageInput.replyTo || null,
        reactions: normalizeReactionsList(messageInput.reactions),
    };

    if (!message.replyTo && messageInput.replyToMessageId) {
        attachReplyToMessage(
            message,
            state.chatHistory,
            chatPartner,
            messageInput.replyToMessageId,
            state.myUsername
        );
    }

    const history = state.chatHistory[chatPartner];
    const existing = findHistoryMessage(history, message);
    if (existing) {
        if (message.status) existing.status = message.status;
        if (message.text) existing.text = message.text;
        if (message.timestamp) existing.timestamp = message.timestamp;
        if (message.id) existing.id = message.id;
        if (message.replyTo) existing.replyTo = message.replyTo;
        if (message.reactions?.length) existing.reactions = message.reactions;

        if (state.currentTargetUser === chatPartner && existing.clientMessageId) {
            if (existing.id) {
                updateMessageIdentity(
                    existing.clientMessageId,
                    existing.id,
                    existing.timestamp,
                    existing.status || MESSAGE_STATUS.SENT
                );
                if (existing.replyTo) {
                    patchMessageReplyPreview(existing.id, existing.replyTo);
                }
            } else if (existing.status) {
                updateMessageStatus(existing.clientMessageId, null, existing.status);
            }
        }
        saveChatHistory();
        if (state.currentTargetUser === chatPartner) {
            reconcileMessageRowsWithHistory([existing]);
        }
        return;
    }

    history.push(message);

    if (state.currentTargetUser === chatPartner) {
        const prev = history.length > 1 ? history[history.length - 2] : null;
        appendMessage(message, null, null, null, prev);
    }
    saveChatHistory();
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
    flushChatHistorySave();
    cancelReadReceipt();
    clearPendingReply();
    state.currentTargetUser = username;
    sendChatFocus(username);
    activateChatPanel(username);
    DOM.chatWelcome.classList.add('hidden');
    clearMessageView();

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
                const record = mapDbMessageToLocal(msg, username);
                record.text = decryptedText;
                state.chatHistory[username].push(record);
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
    setDraftStatus(getComposerValue() ? "Draft restored locally" : "End-to-end encrypted");
    flushChatHistorySave();
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

    if (text.length > MAX_MESSAGE_LENGTH) {
        showComposerLimitError(
            `Message exceeds ${MAX_MESSAGE_LENGTH} characters and was not sent.`
        );
        focusComposer();
        return;
    }
    clearComposerLimitError();

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
        const replyToId = state.pendingReply?.messageId ?? null;
        const replyMeta = state.pendingReply
            ? {
                messageId: state.pendingReply.messageId,
                unavailable: false,
                author: state.pendingReply.author,
                preview: state.pendingReply.preview,
            }
            : null;

        const sent = sendPacket(getSocket(), "message", {
            to: state.currentTargetUser,
            content_recipient: encryptedArrayRecipient,
            content_sender: encryptedArraySender,
            client_message_id: clientMessageId,
            reply_to_message_id: replyToId,
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
            replyTo: replyMeta,
        }));
        clearPendingReply();
        clearDraft(state.myUsername, state.currentTargetUser);
        clearComposer();
        setDraftStatus("Message queued. Waiting for database sync.");
    } catch (err) {
        console.error("Message send failed:", err);
        if (err instanceof RangeError) {
            showComposerLimitError(err.message);
        } else {
            showToast("Message send failed. Check connection and keys.", "error");
        }
    } finally {
        focusComposer();
    }
}

window.handleSendMessage = handleSendMessage;

// Event Listeners
DOM.btnLogin.addEventListener('click', () => handleAuth(true));
DOM.btnRegister.addEventListener('click', () => handleAuth(false));
document.getElementById('loginForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    handleAuth(true);
});
DOM.usernameInput.addEventListener('input', () => {
    DOM.usernameInput.value = normalizeUsername(DOM.usernameInput.value);
});
DOM.usernameInput.addEventListener('keydown', handleAuthKeyboard);
DOM.passwordInput.addEventListener('keydown', handleAuthKeyboard);
DOM.sendBtn.addEventListener('click', handleSendMessage);

DOM.messageInput.addEventListener('input', () => {
    autoResizeComposer();
    clearComposerLimitError();
    updateComposerMeta(getComposerValue());
    persistCurrentDraft();
    if (
        state.currentTargetUser &&
        getComposerValue().trim() &&
        getPrivacyFlags(state.preferences).typingIndicators
    ) {
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
DOM.profileBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    openProfile();
});
DOM.settingsBtn.addEventListener('click', (event) => openSettingsMenu(event));
DOM.shortcutsBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    openShortcuts();
});
DOM.closeSettingsBtn.addEventListener('click', closeModals);
DOM.closeShortcutsBtn.addEventListener('click', closeModals);

DOM.copyUsernameBtn.addEventListener('click', copyCurrentUsername);
DOM.logoutBtn.addEventListener('click', handleLogout);

DOM.chatMenuBtn.addEventListener('click', (event) => openChatMenu(event));
DOM.composerMenuBtn.addEventListener('click', (event) => openComposerMenu(event));
DOM.chatSearchBtn.addEventListener('click', openMessageSearch);
DOM.closeMessageSearchBtn.addEventListener('click', closeMessageSearch);
DOM.messageSearchInput.addEventListener('input', () => searchMessages(DOM.messageSearchInput.value));
DOM.scrollBottomBtn.addEventListener('click', () => scrollMessagesToBottom({ force: true, smooth: true }));

DOM.attachBtn.addEventListener('click', () => DOM.fileInput.click());
DOM.fileInput.addEventListener('change', () => {
    if (!DOM.fileInput.files.length) return;
    insertAtCursor(createFileMarkers(DOM.fileInput.files));
    persistCurrentDraft();
    DOM.fileInput.value = '';
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

if (DOM.glassPicker) {
    DOM.glassPicker.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-glass-value]');
        if (!btn) return;
        state.preferences = updatePreference(state.preferences, 'glassIntensity', btn.dataset.glassValue);
        setPreferenceControls(state.preferences);
        showToast('Glass intensity updated.', 'success');
    });
}

if (DOM.replyCloseBtn) {
    DOM.replyCloseBtn.addEventListener('click', clearPendingReply);
}

registerShortcuts({
    closeTransientUi: () => {
        closeTransientUi();
        closeMessageSearch();
    },
    openShortcuts,
    openProfile,
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
        ingestUserRecords(users);
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
        setDraftStatus("End-to-end encrypted");
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

function toggleCurrentChatMute() {
    const partner = state.currentTargetUser;
    if (!partner || !state.myUsername) {
        showToast('Select a chat first.', 'error');
        return;
    }
    const muted = toggleChatMuted(state.myUsername, partner);
    closeAllPopovers();
    showToast(muted ? 'Chat muted locally.' : 'Chat unmuted.', 'success');
    syncRealtimeUi();
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
        clearMessageView();
        clearDraft(state.myUsername, partner);
        flushChatHistorySave();
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
    const affectedReplyIds = markRepliesUnavailable(partner, messageId);
    if (state.currentTargetUser === partner) {
        removeMessageFromDom({ messageId, clientMessageId });
        patchReplyPreviewsForMessages(partner, affectedReplyIds);
        patchGroupingFromState(state.chatHistory[partner] || []);
    }

    try {
        await deleteMessage(state.token, messageId);
        showToast("Message deleted from database.", "success");
    } catch (err) {
        console.error("Message delete failed:", err);
        state.chatHistory[partner] = snapshot;
        flushChatHistorySave();
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
    flushChatHistorySave();
    closeOverlaysForRouteChange();

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
    clearProfileDirectory();
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
