// Realtime message / conversation deletion — immutable store updates + chat partner resolution.

import { normalizeUsername } from './api.js';

const DEBUG_DELETE =
    typeof localStorage !== 'undefined' && localStorage.getItem('e2e_debug_delete') !== '0';

export function logDelete(...args) {
    if (DEBUG_DELETE) console.log('[DELETE]', ...args);
}

/** Resolve chatHistory object key (handles legacy non-normalized keys). */
export function findChatHistoryKey(chatHistory, username) {
    if (!username) return null;
    const normalized = normalizeUsername(username);
    if (chatHistory[username]) return username;
    if (chatHistory[normalized]) return normalized;
    for (const key of Object.keys(chatHistory)) {
        if (normalizeUsername(key) === normalized) return key;
    }
    return normalized;
}

function updateChatMessages(chatHistory, key, updater) {
    const storageKey = findChatHistoryKey(chatHistory, key) || key;
    const prev = chatHistory[storageKey] || [];
    const next = updater(prev);
    if (next === prev) return { storageKey, changed: false };
    chatHistory[storageKey] = next;
    return { storageKey, changed: true };
}

/** Who this user talks to in chatHistory for a deletion event. */
export function resolveDeletionChatPartner(event, myUsername) {
    const me = myUsername ? normalizeUsername(myUsername) : '';

    if (event.sender && event.receiver) {
        const sender = normalizeUsername(event.sender);
        const receiver = normalizeUsername(event.receiver);
        if (me === sender) return receiver;
        if (me === receiver) return sender;
    }

    const deletedBy = event.deleted_by ? normalizeUsername(event.deleted_by) : '';
    const payloadPartner = event.partner || event.chat_id;
    const normalizedPartner = payloadPartner ? normalizeUsername(payloadPartner) : '';

    // payload partner is the deleter's counterparty; for the peer, the chat key is deleted_by
    if (deletedBy && me && deletedBy !== me) {
        return deletedBy;
    }

    return normalizedPartner || null;
}

export function messageMatchesDeletion(message, { messageId, clientMessageId }) {
    if (messageId != null && message.id != null && String(message.id) === String(messageId)) {
        return true;
    }
    if (clientMessageId && message.clientMessageId === clientMessageId) {
        return true;
    }
    return false;
}

function filterDeletedMessages(messages, deletion) {
    const prev = messages || [];
    const next = prev.filter((m) => !messageMatchesDeletion(m, deletion));
    return next.length === prev.length ? prev : next;
}

function chatHasDeletion(chatHistory, chatKey, deletion) {
    return (chatHistory[chatKey] || []).some((m) => messageMatchesDeletion(m, deletion));
}

/**
 * Remove a deleted message from chatHistory (immutable per-partner arrays).
 * @returns {{ partner: string|null, changed: boolean }}
 */
export function applyMessageDeleted(chatHistory, event, saveHistory, myUsername) {
    const messageId = event.message_id;
    const clientMessageId = event.client_message_id;
    const deletion = { messageId, clientMessageId };
    const resolvedPartner = resolveDeletionChatPartner(event, myUsername);

    logDelete('[DELETE EVENT]', event);
    logDelete('[RESOLVED CHAT PARTNER]', resolvedPartner);

    const keysToTry = [];
    if (resolvedPartner) keysToTry.push(resolvedPartner);
    if (event.deleted_by) keysToTry.push(normalizeUsername(event.deleted_by));
    if (event.partner || event.chat_id) {
        keysToTry.push(normalizeUsername(event.partner || event.chat_id));
    }

    const tried = new Set();
    let changed = false;
    let affectedPartner = null;

    for (const key of keysToTry) {
        if (!key || tried.has(key)) continue;
        tried.add(key);
        const { storageKey, changed: keyChanged } = updateChatMessages(
            chatHistory,
            key,
            (prev) => filterDeletedMessages(prev, deletion)
        );
        if (keyChanged) {
            changed = true;
            affectedPartner = storageKey;
            logDelete('[STATE UPDATED]', { key: storageKey });
            break;
        }
    }

    if (!changed) {
        for (const key of Object.keys(chatHistory)) {
            const norm = normalizeUsername(key);
            if (tried.has(norm)) continue;
            tried.add(norm);
            const prev = chatHistory[key] || [];
            const next = filterDeletedMessages(prev, deletion);
            if (next !== prev) {
                chatHistory[key] = next;
                changed = true;
                affectedPartner = key;
                logDelete('[STATE UPDATED fallback scan]', { key });
                break;
            }
        }
    }

    if (changed && saveHistory) saveHistory();
    return { partner: affectedPartner, changed, resolvedPartner };
}

export function applyConversationDeleted(chatHistory, event, saveHistory, myUsername) {
    const partner = resolveDeletionChatPartner(
        {
            sender: event.deleted_by,
            receiver: event.partner || event.chat_id,
            deleted_by: event.deleted_by,
            partner: event.partner,
            chat_id: event.chat_id,
        },
        myUsername
    );

    const storageKey = partner ? findChatHistoryKey(chatHistory, partner) : null;
    if (!storageKey || !chatHistory[storageKey]) {
        return { partner, changed: false };
    }

    delete chatHistory[storageKey];
    if (saveHistory) saveHistory();
    return { partner, changed: true };
}

export function activeChatShouldRefresh(activeTargetUser, event, chatHistory, myUsername) {
    if (!activeTargetUser) return false;

    const active = normalizeUsername(activeTargetUser);
    const resolved = resolveDeletionChatPartner(event, myUsername);
    const deletedBy = event.deleted_by ? normalizeUsername(event.deleted_by) : '';

    const deletion = {
        messageId: event.message_id,
        clientMessageId: event.client_message_id,
    };

    const activeKey = findChatHistoryKey(chatHistory, activeTargetUser);
    if (activeKey && chatHasDeletion(chatHistory, activeKey, deletion)) {
        return true;
    }

    return (
        (resolved && active === resolved) ||
        (deletedBy && active === deletedBy)
    );
}
