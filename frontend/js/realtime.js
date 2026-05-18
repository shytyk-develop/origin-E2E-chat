// Realtime presence, typing, receipts, and unread state (in-memory, WS-synced).

const TYPING_IDLE_MS = 1200;

export function createRealtimeController({ getSocket, sendPacket, getState, onUiSync }) {
    let typingTimer = null;
    let lastTypingTarget = null;

    function syncUi() {
        onUiSync?.();
    }

    function setOnlineUsers(usernames) {
        getState().onlineUsers = new Set(usernames || []);
        syncUi();
    }

    function setPresence(username, online) {
        if (online) {
            getState().onlineUsers.add(username);
        } else {
            getState().onlineUsers.delete(username);
        }
        syncUi();
    }

    function setUnread(partner, count) {
        getState().unreadCounts[partner] = Math.max(0, Number(count) || 0);
        syncUi();
    }

    function incrementUnread(partner) {
        setUnread(partner, (getState().unreadCounts[partner] || 0) + 1);
    }

    function clearUnread(partner) {
        setUnread(partner, 0);
    }

    function setTyping(from, isTyping) {
        if (isTyping) {
            getState().typingUsers.add(from);
        } else {
            getState().typingUsers.delete(from);
        }
        syncUi();
    }

    function notifyTyping(targetUser) {
        if (!targetUser) return;

        const socket = getSocket();
        if (!socket) return;

        if (lastTypingTarget && lastTypingTarget !== targetUser) {
            sendPacket(socket, 'typing', { to: lastTypingTarget, is_typing: false });
        }
        lastTypingTarget = targetUser;

        sendPacket(socket, 'typing', { to: targetUser, is_typing: true });
        window.clearTimeout(typingTimer);
        typingTimer = window.setTimeout(() => {
            sendPacket(socket, 'typing', { to: targetUser, is_typing: false });
        }, TYPING_IDLE_MS);
    }

    function stopTyping() {
        window.clearTimeout(typingTimer);
        if (lastTypingTarget) {
            const socket = getSocket();
            if (socket) {
                sendPacket(socket, 'typing', { to: lastTypingTarget, is_typing: false });
            }
            lastTypingTarget = null;
        }
    }

    function sendDeliveryAck(from, messageId, clientMessageId) {
        const socket = getSocket();
        if (!socket || !from) return;
        sendPacket(socket, 'delivery_ack', {
            from,
            message_id: messageId,
            client_message_id: clientMessageId,
        });
    }

    function sendReadReceipt(partner, upToMessageId) {
        const socket = getSocket();
        if (!socket || !partner || !upToMessageId) return;
        sendPacket(socket, 'read_receipt', {
            partner,
            up_to_message_id: upToMessageId,
        });
    }

    function reset() {
        stopTyping();
        getState().onlineUsers = new Set();
        getState().unreadCounts = {};
        getState().typingUsers = new Set();
        syncUi();
    }

    return {
        setOnlineUsers,
        setPresence,
        setUnread,
        incrementUnread,
        clearUnread,
        setTyping,
        notifyTyping,
        stopTyping,
        sendDeliveryAck,
        sendReadReceipt,
        reset,
    };
}

export function isUserOnline(state, username) {
    return state.onlineUsers?.has(username) ?? false;
}

export function getUnreadCount(state, username) {
    return state.unreadCounts?.[username] || 0;
}

export function isUserTyping(state, username) {
    return state.typingUsers?.has(username) ?? false;
}
