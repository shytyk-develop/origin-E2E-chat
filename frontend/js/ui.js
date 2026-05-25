import {
    closeOverlay,
    closeOverlaysForChatChange,
    openContextMenu,
    openDropdown,
    openModalOverlay,
    openPopoverOverlay,
} from '../ui/overlays/overlayManager.js';
import { getMyReaction, getReactionCounts, QUICK_REACTIONS } from './messageReactions.js';
import {
    appendLinkedTextContent,
    createLinkSecurityNotice,
    messageContainsLink,
    isSafeWebHref,
} from './messageLinks.js';
import { hydrateProfilePrivacy, queueProfilePanelRefresh } from './profileSettings.js';
import { getPrivacyFlags, isChatMuted } from './privacy.js';
import { getDisplayLabel, loadProfile } from './profile.js';

export const DOM = {
    pageLogin: document.getElementById('page-login'),
    pageChat: document.getElementById('page-chat'),

    usernameInput: document.getElementById('usernameInput'),
    passwordInput: document.getElementById('passwordInput'),
    btnLogin: document.getElementById('btnLogin'),
    btnRegister: document.getElementById('btnRegister'),
    authError: document.getElementById('authError'),

    statusSpan: document.getElementById('status'),
    messagesDiv: document.getElementById('messages'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    usersListDiv: document.getElementById('usersList'),
    chatWithTitle: document.getElementById('chatWithTitle'),
    chatSubtitle: document.getElementById('chatSubtitle'),
    chatWelcome: document.getElementById('chat-welcome'),

    focusContactsBtn: document.getElementById('uiFocusContactsBtn'),
    focusComposerBtn: document.getElementById('uiFocusComposerBtn'),
    shortcutsBtn: document.getElementById('uiShortcutsBtn'),
    profileBtn: document.getElementById('uiProfileBtn'),
    settingsBtn: document.getElementById('uiSettingsBtn'),
    refreshUsersBtn: document.getElementById('uiRefreshUsersBtn'),
    contactSearchInput: document.getElementById('uiContactSearch'),
    clearContactSearchBtn: document.getElementById('uiClearContactSearchBtn'),
    copyUsernameBtn: document.getElementById('uiCopyUsernameBtn'),
    logoutBtn: document.getElementById('uiLogoutBtn'),

    chatSearchBtn: document.getElementById('uiChatSearchBtn'),
    scrollBottomBtn: document.getElementById('uiScrollBottomBtn'),
    chatMenuBtn: document.getElementById('uiChatMenuBtn'),

    messageSearchPanel: document.getElementById('uiMessageSearchPanel'),
    messageSearchInput: document.getElementById('uiMessageSearchInput'),
    messageSearchCount: document.getElementById('uiMessageSearchCount'),
    closeMessageSearchBtn: document.getElementById('uiCloseMessageSearchBtn'),

    attachBtn: document.getElementById('uiAttachBtn'),
    fileInput: document.getElementById('uiFileInput'),
    composerMenuBtn: document.getElementById('uiComposerMenuBtn'),
    replyBar: document.getElementById('uiReplyBar'),
    replyLabel: document.getElementById('uiReplyLabel'),
    replyPreview: document.getElementById('uiReplyPreview'),
    replyCloseBtn: document.getElementById('uiReplyCloseBtn'),
    draftStatus: document.getElementById('uiDraftStatus'),
    charCounter: document.getElementById('uiCharCounter'),

    settingsPanel: document.getElementById('uiSettingsPanel'),
    closeSettingsBtn: document.getElementById('uiCloseSettingsBtn'),
    prefEnterSend: document.getElementById('uiPrefEnterSend'),
    prefCompactMode: document.getElementById('uiPrefCompactMode'),
    prefShowTimestamps: document.getElementById('uiPrefShowTimestamps'),
    themePicker: document.getElementById('uiThemePicker'),
    glassPicker: document.getElementById('uiGlassPicker'),

    profilePanel: document.getElementById('uiProfilePanel'),
    closeProfileBtn: document.getElementById('uiCloseProfileBtn'),

    shortcutsPanel: document.getElementById('uiShortcutsPanel'),
    closeShortcutsBtn: document.getElementById('uiCloseShortcutsBtn'),
    toastRegion: document.getElementById('uiToastRegion')
};

const missingDomKeys = Object.entries(DOM)
    .filter(([, element]) => !element)
    .map(([key]) => key);

if (missingDomKeys.length) {
    throw new Error(`Missing required UI elements: ${missingDomKeys.join(', ')}`);
}

const contactsState = {
    users: [],
    sidebarChats: [],
    myUsername: '',
    activeUsername: null,
    query: '',
    searchMode: false,
    onUserSelect: null
};

const realtimeContext = {
    onlineUsers: new Set(),
    unreadCounts: {},
    typingUsers: new Set(),
};

let uiPreferences = { linkPreviews: true, showOnlineStatus: true, typingIndicators: true };

export function setUiPreferences(preferences) {
    uiPreferences = getPrivacyFlags(preferences);
    hydrateProfilePrivacy(preferences);
    refreshContactIndicators();
    refreshChatHeaderSubtitle();
}

const PRESENCE_ONLINE =
    'h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,0.35)]';
const PRESENCE_OFFLINE =
    'h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.35)]';
const UNREAD_BADGE =
    'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[10px] font-bold leading-none text-white';

const COMPOSER_DEFAULT_META = 'Cipher Stack: AES-GCM-256 + RSA-OAEP-2048';
export const MAX_MESSAGE_LENGTH = 2000;
const messageActionHandlers = {
    onDeleteMessage: null,
    onReply: null,
    onReact: null,
    getMyUsername: () => '',
};

export function setRealtimeContext(ctx = {}) {
    if (ctx.onlineUsers) {
        realtimeContext.onlineUsers = ctx.onlineUsers instanceof Set
            ? ctx.onlineUsers
            : new Set(ctx.onlineUsers);
    }
    if (ctx.unreadCounts) {
        realtimeContext.unreadCounts = { ...ctx.unreadCounts };
    }
    if (ctx.typingUsers) {
        realtimeContext.typingUsers = ctx.typingUsers instanceof Set
            ? ctx.typingUsers
            : new Set(ctx.typingUsers);
    }
    refreshContactIndicators();
    refreshChatHeaderSubtitle();
}

export function updateStatus(status, colorClass) {
    DOM.statusSpan.textContent = status;
    const statusIntent = `${status} ${colorClass}`.toLowerCase();
    const isOnline = statusIntent.includes('online') ||
        statusIntent.includes('green') ||
        statusIntent.includes('emerald');
    const isReconnecting = statusIntent.includes('reconnect') ||
        statusIntent.includes('yellow');

    if (isReconnecting) {
        DOM.statusSpan.className = 'status-offline';
        DOM.statusSpan.style.color = 'var(--t2)';
        return;
    }

    DOM.statusSpan.className = isOnline ? 'status-online' : 'status-offline';
    DOM.statusSpan.style.color = '';
}

export function setSidebarChats(chats, myUsername, onUserSelect, activeUsername = contactsState.activeUsername) {
    contactsState.sidebarChats = Array.isArray(chats) ? chats : [];
    contactsState.myUsername = myUsername;
    contactsState.onUserSelect = onUserSelect;
    contactsState.activeUsername = activeUsername;
    contactsState.searchMode = false;
    renderFilteredUsers();
}

export function renderUsersList(users, myUsername, onUserSelect, activeUsername = contactsState.activeUsername) {
    contactsState.users = Array.isArray(users) ? users : [];
    contactsState.myUsername = myUsername;
    contactsState.onUserSelect = onUserSelect;
    contactsState.activeUsername = activeUsername;
    contactsState.searchMode = true;
    renderFilteredUsers();
}

export function filterUsers(query) {
    contactsState.query = query.trim().toLowerCase();
    renderFilteredUsers();
}

export function clearUsersList(message = 'No conversations yet') {
    contactsState.users = [];
    contactsState.searchMode = false;
    if (!contactsState.sidebarChats.length) {
        DOM.usersListDiv.innerHTML = '';
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = message;
        DOM.usersListDiv.appendChild(empty);
        return;
    }
    renderFilteredUsers();
}

export function activateChatPanel(username) {
    closeOverlaysForChatChange();
    DOM.chatWithTitle.textContent = `Secure channel: ${username}`;
    DOM.messageInput.disabled = false;
    DOM.sendBtn.disabled = false;
    setChatToolsEnabled(true);
    setActiveContact(username);
    refreshChatHeaderSubtitle();
    autoResizeComposer();
    focusComposer();
}

export function resetChatPanel() {
    closeOverlaysForChatChange();
    DOM.chatWithTitle.textContent = 'Select a secure channel';
    if (DOM.chatSubtitle) {
        DOM.chatSubtitle.textContent = 'Asymmetric Cryptographic Handshake Tunnel';
        DOM.chatSubtitle.className = 'header-sub';
    }
    DOM.messagesDiv.innerHTML = '';
    DOM.messageInput.value = '';
    DOM.messageInput.disabled = true;
    DOM.sendBtn.disabled = true;
    setChatToolsEnabled(false);
    updateComposerMeta('');
    setDraftStatus(COMPOSER_DEFAULT_META);
    closeMessageSearch();
    setActiveContact(null);
}

export function renderMessagesList(messages) {
    DOM.messagesDiv.innerHTML = '';
    if (!Array.isArray(messages) || !messages.length) return;

    messages.forEach((message, index) => {
        const prev = index > 0 ? messages[index - 1] : null;
        DOM.messagesDiv.appendChild(buildMessageElement(message, prev));
    });
    scrollMessagesToBottom();
}

export function syncAllMessageRowActions() {
    DOM.messagesDiv.querySelectorAll('.message-row').forEach(syncMessageRowActions);
}

export function appendMessage(messageOrSender, text, type, timestamp = Date.now(), previousMessage = null) {
    const message = typeof messageOrSender === 'object'
        ? messageOrSender
        : { sender: messageOrSender, text, type, timestamp };

    if (!previousMessage) {
        const rows = DOM.messagesDiv.querySelectorAll('.message-row');
        const lastRow = rows[rows.length - 1];
        if (lastRow) {
            previousMessage = {
                type: lastRow.dataset.messageType,
                sender: lastRow.dataset.messageSender || '',
            };
        }
    }

    DOM.messagesDiv.appendChild(buildMessageElement(message, previousMessage));
    scrollMessagesToBottom();
}

function buildReplyPreviewEl(replyTo) {
    if (!replyTo) return null;

    const block = document.createElement('button');
    block.type = 'button';
    block.className = 'message-reply-preview';
    if (replyTo.unavailable) block.classList.add('is-unavailable');

    const author = document.createElement('span');
    author.className = 'message-reply-author';
    author.textContent = replyTo.author || 'Message';

    const preview = document.createElement('span');
    preview.className = 'message-reply-text';
    preview.textContent = replyTo.preview || '';

    block.append(author, preview);

    if (!replyTo.unavailable && replyTo.messageId) {
        block.addEventListener('click', (event) => {
            event.stopPropagation();
            scrollToMessageById(replyTo.messageId);
        });
    }

    return block;
}

function buildReactionsEl(message) {
    const reactions = message.reactions || [];
    if (!reactions.length) return null;

    const myUsername = messageActionHandlers.getMyUsername?.() || '';
    const counts = getReactionCounts(reactions);
    const wrap = document.createElement('div');
    wrap.className = 'message-reactions';

    counts.forEach((count, emoji) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'message-reaction-chip';
        if (reactions.some((r) => r.username === myUsername && r.emoji === emoji)) {
            chip.classList.add('is-mine');
        }
        chip.title = 'Toggle reaction';
        chip.dataset.emoji = emoji;

        const emojiSpan = document.createElement('span');
        emojiSpan.textContent = emoji;
        chip.append(emojiSpan);

        if (count > 1) {
            const countEl = document.createElement('span');
            countEl.className = 'message-reaction-count';
            countEl.textContent = String(count);
            chip.append(countEl);
        }

        wrap.append(chip);
    });

    return wrap;
}

function buildMessageElement(message, previousMessage = null) {
    const isOutgoing = message.type === 'outgoing';
    const showSenderName = shouldShowSenderName(message, previousMessage);
    const isGrouped = isGroupedWithPrevious(message, previousMessage);

    const row = document.createElement('div');
    row.className = [
        'message-row group',
        isOutgoing ? 'message-row--own' : 'message-row--other',
        isGrouped ? 'message-row--grouped' : '',
    ].join(' ').trim();
    row.dataset.messageType = message.type;
    row.dataset.messageSender = message.sender || '';

    if (message.id) row.dataset.messageId = String(message.id);
    if (message.clientMessageId) row.dataset.clientMessageId = message.clientMessageId;

    const status = message.status || (message.pending ? 'sending' : (isOutgoing ? 'sent' : undefined));
    if (status) row.dataset.messageStatus = status;
    applyPendingVisual(row, status);

    if (showSenderName) {
        const nameEl = document.createElement('div');
        nameEl.className = 'message-sender-label';
        nameEl.textContent = message.sender;
        row.append(nameEl);
    }

    const contentWrap = document.createElement('div');
    contentWrap.className = 'message-content-wrap';

    const shell = document.createElement('div');
    shell.className = 'message-shell';

    const bubble = document.createElement('div');
    bubble.className = [
        'message-bubble',
        isOutgoing ? 'message-bubble--own' : 'message-bubble--other',
    ].join(' ');

    const inner = document.createElement('div');
    inner.className = 'message-bubble-inner';

    const replyEl = buildReplyPreviewEl(message.replyTo);
    if (replyEl) inner.append(replyEl);

    const bodyRow = document.createElement('div');
    bodyRow.className = 'message-body-row';

    const textEl = document.createElement('span');
    textEl.className = 'message-text';
    appendLinkedTextContent(textEl, message.text || '', { linkify: true });

    const meta = document.createElement('span');
    meta.className = 'message-meta';

    const timeEl = document.createElement('span');
    timeEl.className = 'message-time';
    timeEl.textContent = formatMessageTime(new Date(message.timestamp || Date.now()));
    meta.append(timeEl);

    if (isOutgoing) {
        const statusEl = document.createElement('span');
        statusEl.className = 'message-status';
        statusEl.dataset.status = status || 'sent';
        statusEl.textContent = formatMessageStatusIcon(status, false);
        statusEl.title = formatMessageStatusTitle(status, false);
        meta.append(statusEl);
    }

    bodyRow.append(textEl, meta);
    inner.append(bodyRow);

    if (messageContainsLink(message.text)) {
        inner.append(createLinkSecurityNotice());
    }

    bubble.append(inner);

    const hoverActions = document.createElement('div');
    hoverActions.className = 'message-hover-actions';
    hoverActions.setAttribute('role', 'group');
    hoverActions.setAttribute('aria-label', 'Message actions');

    const replyBtn = document.createElement('button');
    replyBtn.type = 'button';
    replyBtn.className = 'message-quick-btn';
    replyBtn.dataset.action = 'reply';
    replyBtn.title = 'Reply';
    replyBtn.textContent = '↩';

    const reactBtn = document.createElement('button');
    reactBtn.type = 'button';
    reactBtn.className = 'message-quick-btn';
    reactBtn.dataset.action = 'react';
    reactBtn.title = 'React';
    reactBtn.textContent = '☺';

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'message-action-btn message-action-btn--delete';
    deleteBtn.dataset.action = 'delete';
    deleteBtn.textContent = '×';
    deleteBtn.title = message.id ? 'Delete message' : 'Waiting for sync';

    if (isOutgoing) {
        hoverActions.append(deleteBtn, reactBtn, replyBtn);
    } else {
        hoverActions.append(replyBtn, reactBtn, deleteBtn);
    }

    shell.append(bubble, hoverActions);
    contentWrap.append(shell);

    const reactionsEl = buildReactionsEl(message);
    if (reactionsEl) contentWrap.append(reactionsEl);

    row.append(contentWrap);
    syncMessageRowActions(row);

    return row;
}

function getRowMessageId(row) {
    const id = row?.dataset?.messageId;
    return id != null && id !== '' ? id : null;
}

/** Enable/disable hover actions from row dataset (after ack / sync). */
export function syncMessageRowActions(row) {
    if (!row) return;
    const hasId = getRowMessageId(row) != null;
    row.classList.toggle('is-actions-pending', !hasId);

    const replyBtn = row.querySelector('[data-action="reply"]');
    const reactBtn = row.querySelector('[data-action="react"]');
    const deleteBtn = row.querySelector('[data-action="delete"]');

    if (replyBtn) {
        replyBtn.disabled = !hasId;
        replyBtn.title = hasId ? 'Reply' : 'Waiting for sync';
    }
    if (reactBtn) {
        reactBtn.disabled = !hasId;
        reactBtn.title = hasId ? 'React' : 'Waiting for sync';
    }
    if (deleteBtn) {
        deleteBtn.disabled = !hasId;
        deleteBtn.title = hasId ? 'Delete message' : 'Waiting for sync';
    }
}

let messageActionsDelegated = false;

/** One listener on #messages — survives rerender and always reads fresh message id. */
export function initMessageActions() {
    if (messageActionsDelegated || !DOM.messagesDiv) return;
    messageActionsDelegated = true;

    DOM.messagesDiv.addEventListener('mousedown', (event) => {
        if (event.target.closest('[data-action], .message-reaction-chip, .message-bubble')) {
            event.stopPropagation();
        }
    });

    DOM.messagesDiv.addEventListener('click', (event) => {
        const link = event.target.closest('.message-link');
        if (link) {
            event.stopPropagation();
            const href = link.getAttribute('href');
            if (!href || !isSafeWebHref(href)) {
                event.preventDefault();
            }
            return;
        }

        const row = event.target.closest('.message-row');
        if (!row) return;

        const messageId = getRowMessageId(row);
        if (!messageId) return;

        if (event.target.closest('[data-action="reply"]')) {
            event.preventDefault();
            event.stopPropagation();
            messageActionHandlers.onReply?.({ id: messageId });
            return;
        }

        if (event.target.closest('[data-action="react"]')) {
            event.preventDefault();
            event.stopPropagation();
            const btn = event.target.closest('[data-action="react"]');
            messageActionHandlers.onReact?.(messageId, null, btn);
            return;
        }

        if (event.target.closest('[data-action="delete"]')) {
            event.preventDefault();
            event.stopPropagation();
            messageActionHandlers.onDeleteMessage?.(messageId);
            return;
        }

        const chip = event.target.closest('.message-reaction-chip');
        if (chip?.dataset.emoji) {
            event.preventDefault();
            event.stopPropagation();
            messageActionHandlers.onReact?.(messageId, chip.dataset.emoji);
        }
    });

    DOM.messagesDiv.addEventListener('dblclick', (event) => {
        const row = event.target.closest('.message-row');
        const bubble = event.target.closest('.message-bubble');
        if (!row || !bubble) return;

        const messageId = getRowMessageId(row);
        if (!messageId) return;

        event.stopPropagation();
        messageActionHandlers.onReact?.(messageId, null, bubble);
    });
}

export function scrollToMessageById(messageId) {
    if (messageId == null) return;
    const row = DOM.messagesDiv.querySelector(
        `[data-message-id="${CSS.escape(String(messageId))}"]`
    );
    if (!row) return;
    row.classList.add('is-highlighted');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    window.setTimeout(() => row.classList.remove('is-highlighted'), 1600);
}

export function patchMessageReactionsDom(messageId, reactions, myUsername) {
    const row = DOM.messagesDiv.querySelector(
        `[data-message-id="${CSS.escape(String(messageId))}"]`
    );
    if (!row) return;

    const host = row.querySelector('.message-content-wrap') || row;
    let wrap = host.querySelector('.message-reactions');
    if (!reactions?.length) {
        wrap?.remove();
        return;
    }

    const fakeMessage = { id: messageId, reactions };
    const next = buildReactionsEl(fakeMessage);
    if (!next) return;

    if (wrap) {
        wrap.replaceWith(next);
    } else {
        host.append(next);
    }
}

export function showComposerReplyBar(pendingReply) {
    if (!DOM.replyBar) return;
    if (!pendingReply) {
        DOM.replyBar.classList.add('hidden');
        return;
    }
    DOM.replyBar.classList.remove('hidden');
    if (DOM.replyLabel) {
        DOM.replyLabel.textContent = `Reply to ${pendingReply.author}`;
    }
    if (DOM.replyPreview) {
        DOM.replyPreview.textContent = pendingReply.preview;
    }
}

export function hideComposerReplyBar() {
    DOM.replyBar?.classList.add('hidden');
}

export function openReactionPicker(anchor, messageId) {
    openPopoverOverlay({
        popoverId: 'reactions',
        anchor,
        targetId: `reactions-${messageId}`,
        payload: { messageId },
    });
}

function shouldShowSenderName(message, previousMessage) {
    if (message.type === 'outgoing') return false;
    if (!previousMessage) return true;
    if (previousMessage.type === 'outgoing') return true;
    return previousMessage.sender !== message.sender;
}

function isGroupedWithPrevious(message, previousMessage) {
    if (!previousMessage) return false;
    if (message.type !== previousMessage.type) return false;
    if (message.type === 'outgoing') return true;
    return previousMessage.sender === message.sender;
}

export function updateMessageIdentity(clientMessageId, id, timestamp, status = 'sent') {
    const msgElement = DOM.messagesDiv.querySelector(`[data-client-message-id="${CSS.escape(clientMessageId)}"]`);
    if (!msgElement) return;

    msgElement.dataset.messageId = String(id);
    msgElement.dataset.messageStatus = status;
    applyPendingVisual(msgElement, status);
    syncMessageRowActions(msgElement);

    const timeElement = msgElement.querySelector('.message-time');
    if (timeElement && timestamp) {
        timeElement.textContent = formatMessageTime(new Date(timestamp));
    }

    updateMessageStatus(clientMessageId, id, status);
}

export function updateMessageStatus(clientMessageId, messageId, status) {
    const selector = clientMessageId
        ? `[data-client-message-id="${CSS.escape(clientMessageId)}"]`
        : messageId
            ? `[data-message-id="${CSS.escape(String(messageId))}"]`
            : null;
    if (!selector) return;

    const msgElement = DOM.messagesDiv.querySelector(selector);
    if (!msgElement) return;

    msgElement.dataset.messageStatus = status;
    applyPendingVisual(msgElement, status);

    const statusElement = msgElement.querySelector('.message-status');
    if (!statusElement) return;

    statusElement.dataset.status = status;
    statusElement.textContent = formatMessageStatusIcon(status, false);
    statusElement.title = formatMessageStatusTitle(status, false);
}

function applyPendingVisual(row, status) {
    const isPending = status === 'pending' || status === 'sending';
    row.classList.toggle('is-pending', isPending);
}

export function removeMessageElement(messageId) {
    if (messageId == null) return;
    const msgElement = DOM.messagesDiv.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
    msgElement?.remove();
}

export function removeMessageFromDom({ messageId, clientMessageId } = {}) {
    let found = false;
    if (messageId != null) {
        const el = DOM.messagesDiv.querySelector(
            `[data-message-id="${CSS.escape(String(messageId))}"]`
        );
        if (el) {
            el.remove();
            found = true;
        }
    }
    if (clientMessageId) {
        const byClient = DOM.messagesDiv.querySelector(
            `[data-client-message-id="${CSS.escape(clientMessageId)}"]`
        );
        if (byClient) {
            byClient.remove();
            found = true;
        }
    }
    return found;
}

export function setMessageActionHandlers(handlers) {
    messageActionHandlers.onDeleteMessage = handlers.onDeleteMessage || null;
    messageActionHandlers.onReply = handlers.onReply || null;
    messageActionHandlers.onReact = handlers.onReact || null;
    messageActionHandlers.getMyUsername = handlers.getMyUsername || (() => '');
}

export function setComposerValue(text) {
    DOM.messageInput.value = text;
    updateComposerMeta(text);
    autoResizeComposer();
}

export function getComposerValue() {
    return DOM.messageInput.value;
}

export function clearComposer() {
    setComposerValue('');
    autoResizeComposer();
    focusComposer();
}

export function focusComposer() {
    if (!DOM.messageInput.disabled) {
        DOM.messageInput.focus();
    }
}

export function focusContactSearch() {
    DOM.contactSearchInput.focus();
    DOM.contactSearchInput.select();
}

export function autoResizeComposer() {
    const minHeight = 42;
    const maxHeight = 132;
    const input = DOM.messageInput;
    input.style.height = 'auto';
    const scrollH = input.scrollHeight;
    const nextHeight = Math.min(Math.max(scrollH, minHeight), maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = scrollH > maxHeight ? 'auto' : 'hidden';
}

export function updateComposerMeta(text) {
    const length = text.length;
    const over = length > MAX_MESSAGE_LENGTH;
    DOM.charCounter.textContent = over
        ? `${length} / ${MAX_MESSAGE_LENGTH} — limit exceeded`
        : `${length} / ${MAX_MESSAGE_LENGTH}`;
    DOM.charCounter.classList.toggle('danger', over);
    if (DOM.draftStatus?.dataset.limitError === '1' && !over) {
        DOM.draftStatus.dataset.limitError = '0';
        setDraftStatus(
            text.trim() ? 'Draft saved locally' : COMPOSER_DEFAULT_META
        );
    }
}

export function showComposerLimitError(message) {
    DOM.charCounter.classList.add('danger');
    DOM.charCounter.textContent = message;
    if (DOM.draftStatus) {
        DOM.draftStatus.dataset.limitError = '1';
        DOM.draftStatus.textContent = message;
        DOM.draftStatus.classList.add('danger');
    }
}

export function clearComposerLimitError() {
    if (DOM.draftStatus?.dataset.limitError === '1') {
        DOM.draftStatus.dataset.limitError = '0';
        DOM.draftStatus.classList.remove('danger');
    }
}

export function setDraftStatus(text = COMPOSER_DEFAULT_META) {
    DOM.draftStatus.textContent = text;
}

export function insertAtCursor(text) {
    if (DOM.messageInput.disabled) return;

    const input = DOM.messageInput;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? input.value.length;

    input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
    const cursor = start + text.length;
    input.setSelectionRange(cursor, cursor);
    autoResizeComposer();
    updateComposerMeta(input.value);
    focusComposer();
}

export function scrollMessagesToBottom() {
    DOM.messagesDiv.scrollTop = DOM.messagesDiv.scrollHeight;
}

function openMenuDropdown(menuId, anchor, targetId) {
    if (!anchor) return;
    openDropdown({
        menuId,
        anchor,
        targetId,
    });
}

export function openChatMenu(event) {
    event?.stopPropagation();
    openMenuDropdown('chat-header', DOM.chatMenuBtn, 'chat-header');
}

export function openComposerMenu(event) {
    event?.stopPropagation();
    openMenuDropdown('composer', DOM.composerMenuBtn, 'composer');
}

export function openSettingsMenu(event) {
    event?.stopPropagation();
    openMenuDropdown('settings', DOM.settingsBtn, 'settings');
}

export function closeAllPopovers() {
    closeOverlay();
}

export function openMessageSearch() {
    DOM.messageSearchPanel.classList.remove('hidden');
    DOM.messageSearchInput.focus();
    DOM.messageSearchInput.select();
    searchMessages(DOM.messageSearchInput.value);
}

export function closeMessageSearch() {
    DOM.messageSearchPanel.classList.add('hidden');
    DOM.messageSearchInput.value = '';
    searchMessages('');
}

export function searchMessages(query) {
    const normalized = query.trim().toLowerCase();
    const bubbles = [...DOM.messagesDiv.querySelectorAll('.message-row')];
    let matches = 0;

    bubbles.forEach((row) => {
        const haystack = row.textContent.toLowerCase();
        const isMatch = !normalized || haystack.includes(normalized);
        row.classList.toggle('is-search-hidden', Boolean(normalized && !isMatch));
        row.classList.toggle('is-search-match', Boolean(normalized && isMatch));
        if (normalized && isMatch) matches += 1;
    });

    DOM.messageSearchCount.textContent = normalized
        ? `${matches} match${matches === 1 ? '' : 'es'}`
        : `${bubbles.length} messages`;
}

export function openSettings() {
    openModalOverlay('settings', 'settings');
}

export function openProfile() {
    openModalOverlay('profile', 'profile');
    queueProfilePanelRefresh();
}

export function openShortcuts() {
    openModalOverlay('shortcuts', 'shortcuts');
}

export function closeModals() {
    closeOverlay();
}

export function closeTransientUi() {
    closeOverlay();
}

export function openChatInfoPopover(partner, online, publicKeyJwk = null, extra = {}) {
    openPopoverOverlay({
        popoverId: 'chat-info',
        anchor: DOM.chatMenuBtn,
        targetId: 'chat-info',
        payload: { partner, online, publicKeyJwk, ...extra },
    });
}

export function initMessageContextMenu(getContextPayload) {
    DOM.messagesDiv.addEventListener('contextmenu', (event) => {
        const row = event.target.closest('.message-row');
        if (!row) return;
        event.preventDefault();

        const payload = getContextPayload(row);
        if (!payload) return;

        openContextMenu({
            x: event.clientX,
            y: event.clientY,
            payload,
            targetId: payload.clientMessageId || payload.messageId || 'message',
        });
    });
}

export function highlightMessageRow(targetId) {
    DOM.messagesDiv.querySelectorAll('.message-row.is-highlighted').forEach((el) => {
        el.classList.remove('is-highlighted');
    });
    if (!targetId) return;
    const row =
        DOM.messagesDiv.querySelector(`[data-message-id="${CSS.escape(String(targetId))}"]`) ||
        DOM.messagesDiv.querySelector(`[data-client-message-id="${CSS.escape(String(targetId))}"]`);
    row?.classList.add('is-highlighted');
    row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

export function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast is-${type}`;
    toast.textContent = message;
    DOM.toastRegion.appendChild(toast);

    window.setTimeout(() => {
        toast.remove();
    }, 3200);
}

export function setPreferenceControls(preferences) {
    DOM.prefEnterSend.checked = preferences.enterToSend;
    DOM.prefCompactMode.checked = preferences.compactMode;
    DOM.prefShowTimestamps.checked = preferences.showTimestamps;

    if (DOM.themePicker) {
        DOM.themePicker.querySelectorAll('[data-theme-value]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.themeValue === preferences.theme);
        });
    }

    syncPickerActive(DOM.themePicker, 'data-theme-value', preferences.theme);
    syncPickerActive(DOM.glassPicker, 'data-glass-value', preferences.glassIntensity || 'medium');
    setUiPreferences(preferences);
}

function syncPickerActive(container, attr, value) {
    if (!container) return;
    container.querySelectorAll(`[${attr}]`).forEach((btn) => {
        btn.classList.toggle('is-active', btn.getAttribute(attr) === value);
    });
}

/** Single entry point for profile: nav rail profile button. */
export function updateProfileRailButton(username) {
    if (!DOM.profileBtn) return;
    if (!username) {
        DOM.profileBtn.title = 'Profile settings';
        DOM.profileBtn.setAttribute('aria-label', 'Profile settings');
        return;
    }
    const profile = loadProfile(username);
    const label = getDisplayLabel(username, profile);
    DOM.profileBtn.title = `${label} (@${username})`;
    DOM.profileBtn.setAttribute('aria-label', `Profile: ${label}`);
}

export function setChatToolsEnabled(isEnabled) {
    [
        DOM.chatSearchBtn,
        DOM.scrollBottomBtn,
        DOM.chatMenuBtn,
        DOM.composerMenuBtn,
        DOM.attachBtn,
    ].forEach((control) => {
        if (control) control.disabled = !isEnabled;
    });
}

function renderFilteredUsers() {
    DOM.usersListDiv.innerHTML = '';

    const sourceUsers = contactsState.searchMode
        ? contactsState.users
        : contactsState.sidebarChats;

    const visibleUsers = sourceUsers.filter(user => {
        if (user.username === contactsState.myUsername) return false;
        if (!contactsState.query) return true;
        return user.username.toLowerCase().includes(contactsState.query);
    });

    if (!visibleUsers.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        if (contactsState.searchMode) {
            empty.textContent = contactsState.query ? 'No matching nodes' : 'Type at least 2 characters';
        } else if (contactsState.query) {
            empty.textContent = 'No matching conversations';
        } else {
            empty.textContent = 'No conversations yet';
        }
        DOM.usersListDiv.appendChild(empty);
        return;
    }

    visibleUsers.forEach(user => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'contact-row';
        btn.dataset.username = user.username;
        btn.setAttribute('aria-label', `Open chat with ${user.username}`);

        const avatar = document.createElement('div');
        avatar.className = 'contact-avatar';
        avatar.textContent = getInitials(user.username);

        const meta = document.createElement('div');
        meta.className = 'contact-meta';

        const name = document.createElement('div');
        name.className = 'contact-name';
        name.textContent = user.username;

        const subtitle = document.createElement('div');
        subtitle.className = 'contact-subtitle';
        subtitle.dataset.contactSubtitle = 'true';
        applyContactSubtitle(subtitle, user.username, user);

        meta.append(name, subtitle);

        const presence = document.createElement('div');
        presence.className = `contact-presence ${getPresenceClasses(user.username)}`;
        presence.dataset.presenceDot = 'true';
        presence.setAttribute('aria-hidden', 'true');

        btn.append(avatar, meta, presence);

        const unreadCount = realtimeContext.unreadCounts[user.username] ?? user.unread_count ?? 0;
        if (unreadCount > 0 && user.username !== contactsState.activeUsername) {
            const badge = document.createElement('span');
            badge.dataset.unreadBadge = 'true';
            badge.className = UNREAD_BADGE;
            badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
            btn.append(badge);
        }
        btn.onclick = () => contactsState.onUserSelect?.(user.username);
        DOM.usersListDiv.appendChild(btn);
    });

    setActiveContact(contactsState.activeUsername);
}

function formatSidebarTime(isoValue) {
    const date = new Date(isoValue);
    if (Number.isNaN(date.getTime())) return 'Recent activity';

    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function setActiveContact(username) {
    contactsState.activeUsername = username;

    DOM.usersListDiv.querySelectorAll('.contact-row').forEach(button => {
        const isActive = button.dataset.username === username;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-current', isActive ? 'true' : 'false');
    });
}

function getInitials(username) {
    return username
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0].toUpperCase())
        .join('') || '?';
}

function formatMessageTime(date) {
    return date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getPresenceClasses(username) {
    if (!uiPreferences.showOnlineStatus) return 'presence-neutral';
    return realtimeContext.onlineUsers.has(username) ? PRESENCE_ONLINE : PRESENCE_OFFLINE;
}

function findContactUser(username) {
    return contactsState.sidebarChats.find(chat => chat.username === username)
        || contactsState.users.find(chat => chat.username === username);
}

function applyContactSubtitle(subtitleEl, username, userHint = null) {
    if (contactsState.myUsername && isChatMuted(contactsState.myUsername, username)) {
        subtitleEl.textContent = 'Muted';
        subtitleEl.className = 'contact-subtitle is-muted';
        return;
    }

    if (uiPreferences.typingIndicators && realtimeContext.typingUsers.has(username)) {
        subtitleEl.innerHTML = buildTypingDotsHtml();
        subtitleEl.className = 'contact-subtitle is-typing';
        return;
    }

    const user = userHint || findContactUser(username);
    subtitleEl.textContent = user?.last_message_at
        ? formatSidebarTime(user.last_message_at)
        : 'Secure channel';
    subtitleEl.className = 'contact-subtitle';
}

function buildTypingDotsHtml() {
    return `<span class="typing-dots" aria-label="Typing"><span></span><span></span><span></span></span>`;
}

function refreshContactIndicators() {
    DOM.usersListDiv.querySelectorAll('.contact-row').forEach(row => {
        const username = row.dataset.username;
        if (!username) return;

        const presence = row.querySelector('[data-presence-dot]');
        if (presence) {
            presence.className = `contact-presence ${getPresenceClasses(username)}`;
        }

        const subtitle = row.querySelector('[data-contact-subtitle]');
        if (subtitle) {
            applyContactSubtitle(subtitle, username);
        }

        let badge = row.querySelector('[data-unread-badge]');
        const unread = realtimeContext.unreadCounts[username] ?? 0;
        const showBadge = unread > 0 && username !== contactsState.activeUsername;

        if (showBadge) {
            if (!badge) {
                badge = document.createElement('span');
                badge.dataset.unreadBadge = 'true';
                row.append(badge);
            }
            badge.className = UNREAD_BADGE;
            badge.textContent = unread > 99 ? '99+' : String(unread);
        } else if (badge) {
            badge.remove();
        }
    });
}

function refreshChatHeaderSubtitle() {
    if (!DOM.chatSubtitle) return;

    const partner = contactsState.activeUsername;
    if (!partner) {
        DOM.chatSubtitle.textContent = 'Asymmetric Cryptographic Handshake Tunnel';
        DOM.chatSubtitle.className = 'header-sub';
        return;
    }

    if (uiPreferences.typingIndicators && realtimeContext.typingUsers.has(partner)) {
        DOM.chatSubtitle.innerHTML = `<span class="presence-badge presence-badge--typing">
            <span>typing</span>${buildTypingDotsHtml()}
        </span>`;
        DOM.chatSubtitle.className = 'header-sub';
        return;
    }

    if (!uiPreferences.showOnlineStatus) {
        DOM.chatSubtitle.textContent = 'End-to-end encrypted';
        DOM.chatSubtitle.className = 'header-sub';
        return;
    }

    const online = realtimeContext.onlineUsers.has(partner);
    DOM.chatSubtitle.innerHTML = online
        ? '<span class="presence-badge presence-badge--online"><span class="presence-dot" aria-hidden="true"></span>Online</span>'
        : '<span class="presence-badge presence-badge--offline"><span class="presence-dot" aria-hidden="true"></span>Offline</span>';
    DOM.chatSubtitle.className = 'header-sub';
}

function formatMessageStatusIcon(status) {
    if (status === 'pending' || status === 'sending') return '◔';
    if (status === 'failed') return '!';
    if (status === 'read') return '✓✓';
    if (status === 'delivered') return '✓✓';
    if (status === 'sent') return '✓';
    return '';
}

function formatMessageStatusTitle(status) {
    if (status === 'pending' || status === 'sending') return 'Sending';
    if (status === 'failed') return 'Failed';
    if (status === 'read') return 'Read';
    if (status === 'delivered') return 'Delivered';
    if (status === 'sent') return 'Sent to server';
    return '';
}

