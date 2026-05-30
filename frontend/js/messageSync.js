import {
    MESSAGE_STATUS,
    applyStatus,
    reconcileOutgoingMessage,
} from './messageState.js';
import { updateMessageIdentity, updateMessageStatus } from './ui.js';

const pendingStatusEvents = new Map();
let readReceiptTimer = null;
let readReceiptPartner = null;

export function queueStatusEvent(clientMessageId, event) {
    if (!clientMessageId) return;
    const key = clientMessageId;
    if (!pendingStatusEvents.has(key)) {
        pendingStatusEvents.set(key, []);
    }
    pendingStatusEvents.get(key).push(event);
}

export function flushStatusQueue(clientMessageId, chatHistory, saveHistory) {
    const events = pendingStatusEvents.get(clientMessageId);
    if (!events?.length) return;
    pendingStatusEvents.delete(clientMessageId);

    for (const event of events) {
        applyStatusEvent(chatHistory, event, saveHistory);
    }
}

export function findOutgoingMessage(chatHistory, { clientMessageId, messageId, partner }) {
    const partners = partner ? [partner] : Object.keys(chatHistory);

    for (const name of partners) {
        const found = (chatHistory[name] || []).find(item =>
            item.type === 'outgoing' && (
                (clientMessageId && item.clientMessageId === clientMessageId) ||
                (messageId && String(item.id) === String(messageId))
            )
        );
        if (found) return found;
    }
    return null;
}

export function applyStatusEvent(chatHistory, event, saveHistory) {
    const { status, client_message_id, message_id, partner, up_to_message_id } = event;

    if (status === MESSAGE_STATUS.READ && partner && up_to_message_id != null) {
        const messages = chatHistory[partner] || [];
        const upTo = Number(up_to_message_id);
        let changed = false;
        messages.forEach((msg) => {
            if (msg.type !== 'outgoing' || msg.id == null) return;
            if (Number(msg.id) <= upTo) {
                if (applyStatus(msg, MESSAGE_STATUS.READ)) changed = true;
                updateMessageStatus(msg.clientMessageId, msg.id, MESSAGE_STATUS.READ);
            }
        });
        if (changed && saveHistory) saveHistory();
        return null;
    }

    const message = findOutgoingMessage(chatHistory, {
        clientMessageId: client_message_id,
        messageId: message_id,
        partner,
    });

    if (!message) {
        if (client_message_id && (status === MESSAGE_STATUS.SENT || status === MESSAGE_STATUS.DELIVERED)) {
            queueStatusEvent(client_message_id, event);
        }
        return;
    }

    if (applyStatus(message, status)) {
        if (saveHistory) saveHistory();
        updateMessageStatus(message.clientMessageId, message.id, message.status);
    }
    return null;
}

export function onMessageAck(chatHistory, { client_message_id, id, timestamp }, saveHistory) {
    const message = findOutgoingMessage(chatHistory, { clientMessageId: client_message_id });
    if (!message) return;

    reconcileOutgoingMessage(message, {
        id,
        timestamp,
        clientMessageId: client_message_id,
    });
    if (saveHistory) saveHistory();

    updateMessageIdentity(client_message_id, id, timestamp, message.status);

    flushStatusQueue(client_message_id, chatHistory, saveHistory);
}

export function flushReadReceipt(partner, sendReadReceipt, getMessages) {
    if (!partner) return;

    readReceiptPartner = partner;
    window.clearTimeout(readReceiptTimer);

    const messages = getMessages(partner) || [];
    const lastAny = [...messages].reverse().find((msg) => msg.id != null);
    if (!lastAny) return;

    sendReadReceipt(partner, lastAny.id);
}

/** @deprecated Use flushReadReceipt for immediate delivery */
export function scheduleReadReceipt(partner, sendReadReceipt, getMessages) {
    flushReadReceipt(partner, sendReadReceipt, getMessages);
}

export function cancelReadReceipt() {
    window.clearTimeout(readReceiptTimer);
    readReceiptPartner = null;
}
