// Realtime message / conversation deletion — immutable store updates.

function messageMatchesDeletion(message, { messageId, clientMessageId }) {
    if (messageId != null && message.id != null && String(message.id) === String(messageId)) {
        return true;
    }
    if (clientMessageId && message.clientMessageId === clientMessageId) {
        return true;
    }
    return false;
}

function filterDeletedMessages(messages, deletion) {
    const next = (messages || []).filter((m) => !messageMatchesDeletion(m, deletion));
    return next.length === (messages || []).length ? messages : next;
}

/**
 * Remove a deleted message from chatHistory (immutable per-partner arrays).
 * @returns {{ partner: string|null, changed: boolean }}
 */
export function applyMessageDeleted(chatHistory, event, saveHistory) {
    const messageId = event.message_id;
    const clientMessageId = event.client_message_id;
    const partner = event.partner || event.chat_id;
    const deletion = { messageId, clientMessageId };

    let changed = false;

    if (partner) {
        const prev = chatHistory[partner] || [];
        const next = filterDeletedMessages(prev, deletion);
        if (next !== prev) {
            chatHistory[partner] = next;
            changed = true;
        }
    } else {
        for (const key of Object.keys(chatHistory)) {
            const prev = chatHistory[key] || [];
            const next = filterDeletedMessages(prev, deletion);
            if (next !== prev) {
                chatHistory[key] = next;
                changed = true;
            }
        }
    }

    if (changed && saveHistory) saveHistory();
    return { partner, changed };
}

export function applyConversationDeleted(chatHistory, event, saveHistory) {
    const partner = event.partner || event.chat_id;
    if (!partner || !chatHistory[partner]) {
        return { partner, changed: false };
    }

    delete chatHistory[partner];
    if (saveHistory) saveHistory();
    return { partner, changed: true };
}
