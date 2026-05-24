/** Message delivery state machine (monotonic transitions only). */

export const MESSAGE_STATUS = {
    PENDING: 'pending',
    SENDING: 'sending',
    SENT: 'sent',
    DELIVERED: 'delivered',
    READ: 'read',
    FAILED: 'failed',
};

const STATUS_RANK = {
    [MESSAGE_STATUS.FAILED]: -1,
    [MESSAGE_STATUS.PENDING]: 0,
    [MESSAGE_STATUS.SENDING]: 1,
    [MESSAGE_STATUS.SENT]: 2,
    [MESSAGE_STATUS.DELIVERED]: 3,
    [MESSAGE_STATUS.READ]: 4,
};

export function statusRank(status) {
    return STATUS_RANK[status] ?? 0;
}

export function canUpgradeStatus(current, next) {
    if (!next) return false;
    if (current === MESSAGE_STATUS.FAILED) return next !== MESSAGE_STATUS.FAILED;
    return statusRank(next) > statusRank(current);
}

export function applyStatus(message, nextStatus) {
    if (!message || !nextStatus) return false;
    const current = message.status || (message.pending ? MESSAGE_STATUS.PENDING : MESSAGE_STATUS.SENT);
    if (!canUpgradeStatus(current, nextStatus)) return false;

    message.status = nextStatus;
    message.pending = nextStatus === MESSAGE_STATUS.PENDING || nextStatus === MESSAGE_STATUS.SENDING;
    return true;
}

export function deriveOutgoingStatusFromDb(row, myUsername) {
    if (row.sender !== myUsername) return undefined;
    if (row.read_at) return MESSAGE_STATUS.READ;
    if (row.delivered_at) return MESSAGE_STATUS.DELIVERED;
    return MESSAGE_STATUS.SENT;
}

export function createOutgoingMessage({
    clientMessageId,
    text,
    timestamp = Date.now(),
    status = MESSAGE_STATUS.SENDING,
}) {
    return {
        id: null,
        clientMessageId,
        sender: 'You',
        text,
        type: 'outgoing',
        timestamp,
        status,
        pending: status === MESSAGE_STATUS.PENDING || status === MESSAGE_STATUS.SENDING,
    };
}

export function reconcileOutgoingMessage(message, { id, timestamp, clientMessageId }) {
    if (id) message.id = id;
    if (timestamp) message.timestamp = timestamp;
    if (clientMessageId && !message.clientMessageId) {
        message.clientMessageId = clientMessageId;
    }
    if (message.status === MESSAGE_STATUS.PENDING || message.status === MESSAGE_STATUS.SENDING) {
        applyStatus(message, MESSAGE_STATUS.SENT);
    } else {
        message.pending = false;
    }
}
