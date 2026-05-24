// Emoji reactions — realtime sync; one reaction per user per message.

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];

export function normalizeReactionsList(reactions) {
    if (!Array.isArray(reactions)) return [];
    return reactions
        .filter((r) => r && r.username && r.emoji)
        .map((r) => ({ username: r.username, emoji: r.emoji }));
}

export function findMessageForReaction(chatHistory, partner, messageId) {
    if (!partner || messageId == null) return null;
    const messages = chatHistory[partner] || [];
    return messages.find((m) => m.id != null && String(m.id) === String(messageId)) || null;
}

export function applyReactionSync(chatHistory, event, myUsername) {
    const partner = event.partner;
    const messageId = event.message_id;
    if (!partner || messageId == null) return null;

    const message = findMessageForReaction(chatHistory, partner, messageId);
    if (!message) return null;

    message.reactions = normalizeReactionsList(event.reactions);
    return { partner, messageId, message };
}

export function getReactionCounts(reactions) {
    const counts = new Map();
    (reactions || []).forEach(({ emoji }) => {
        counts.set(emoji, (counts.get(emoji) || 0) + 1);
    });
    return counts;
}

export function getMyReaction(reactions, myUsername) {
    return (reactions || []).find((r) => r.username === myUsername)?.emoji || null;
}

export function sendReactionPacket(socket, sendPacket, messageId, emoji) {
    if (!socket || messageId == null) return false;
    return sendPacket(socket, 'reaction', {
        message_id: messageId,
        emoji: emoji ?? '',
    });
}
