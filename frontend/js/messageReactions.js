// Emoji reactions — realtime sync; one reaction per user per message.

import { normalizeUsername } from './api.js';
import { findChatHistoryKey } from './messageDelete.js';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🔥', '👏'];

export function normalizeReactionsList(reactions) {
    if (!Array.isArray(reactions)) return [];
    return reactions
        .filter((r) => r && r.username && r.emoji)
        .map((r) => ({ username: r.username, emoji: r.emoji }));
}

/**
 * chatHistory key for this user from a reaction_sync event.
 * `partner` in the payload is the reactor's counterparty; the peer must use reactor as key.
 */
export function resolveReactionChatPartner(event, myUsername) {
    const me = myUsername ? normalizeUsername(myUsername) : '';
    const reactor = event.username ? normalizeUsername(event.username) : '';
    const payloadPartner = event.partner ? normalizeUsername(event.partner) : '';

    if (reactor && me && reactor === me) {
        return payloadPartner;
    }
    if (reactor && me && reactor !== me) {
        return reactor;
    }
    return payloadPartner;
}

export function findMessageForReaction(chatHistory, messageId, preferredPartner = null) {
    if (messageId == null) return null;

    const keysToTry = [];
    if (preferredPartner) {
        const key = findChatHistoryKey(chatHistory, preferredPartner);
        if (key) keysToTry.push(key);
    }
    keysToTry.push(...Object.keys(chatHistory));

    const seen = new Set();
    for (const key of keysToTry) {
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const message = (chatHistory[key] || []).find(
            (m) => m.id != null && String(m.id) === String(messageId)
        );
        if (message) return { partner: key, message };
    }
    return null;
}

export function applyReactionSync(chatHistory, event, myUsername) {
    const messageId = event.message_id;
    if (messageId == null) return null;

    const chatPartner = resolveReactionChatPartner(event, myUsername);
    const located = findMessageForReaction(chatHistory, messageId, chatPartner);
    if (!located) return null;

    located.message.reactions = normalizeReactionsList(event.reactions);
    return {
        partner: located.partner,
        messageId,
        message: located.message,
        reactions: located.message.reactions,
    };
}

/** Optimistic local toggle before server ack (idempotent when sync arrives). */
export function applyLocalReaction(message, myUsername, emojiOrNull) {
    let reactions = normalizeReactionsList(message.reactions);
    reactions = reactions.filter((r) => r.username !== myUsername);
    if (emojiOrNull) {
        reactions.push({ username: myUsername, emoji: emojiOrNull });
    }
    message.reactions = reactions;
    return reactions;
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
