// Reply metadata — single-level only; preview resolved client-side from local history.

export const REPLY_PREVIEW_MAX = 100;

export function truncateReplyPreview(text) {
    if (!text) return '';
    const normalized = String(text).replace(/\s+/g, ' ').trim();
    if (normalized.length <= REPLY_PREVIEW_MAX) return normalized;
    return `${normalized.slice(0, REPLY_PREVIEW_MAX).trimEnd()}…`;
}

export function findMessageById(chatHistory, partner, messageId) {
    if (!partner || messageId == null) return null;
    const messages = chatHistory[partner] || [];
    return messages.find((m) => m.id != null && String(m.id) === String(messageId)) || null;
}

/**
 * Resolve reply preview from local store only (no nested chains).
 */
export function resolveReplyMeta(chatHistory, partner, replyToMessageId, myUsername) {
    if (!replyToMessageId) return null;

    const original = findMessageById(chatHistory, partner, replyToMessageId);
    if (!original) {
        return {
            messageId: replyToMessageId,
            unavailable: true,
            author: '',
            preview: 'Message unavailable',
        };
    }

    if (original.deleted) {
        return {
            messageId: replyToMessageId,
            unavailable: true,
            deleted: true,
            author: original.sender === 'You' ? 'You' : original.sender,
            preview: 'Message deleted',
        };
    }

    const author =
        original.type === 'outgoing' || original.sender === 'You'
            ? 'You'
            : original.sender;

    return {
        messageId: replyToMessageId,
        unavailable: false,
        author,
        preview: truncateReplyPreview(original.text),
    };
}

export function buildPendingReplyFromMessage(message, partner) {
    if (!message?.id) return null;
    const author =
        message.type === 'outgoing' || message.sender === 'You'
            ? 'You'
            : message.sender;

    return {
        messageId: message.id,
        partner,
        author,
        preview: truncateReplyPreview(message.text),
    };
}

export function attachReplyToMessage(message, chatHistory, partner, replyToMessageId, myUsername) {
    if (!replyToMessageId) {
        message.replyTo = null;
        return message;
    }
    message.replyTo = resolveReplyMeta(
        chatHistory,
        partner,
        replyToMessageId,
        myUsername
    );
    return message;
}
