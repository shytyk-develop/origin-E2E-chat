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
    settingsBtn: document.getElementById('uiSettingsBtn'),
    refreshUsersBtn: document.getElementById('uiRefreshUsersBtn'),
    contactSearchInput: document.getElementById('uiContactSearch'),
    clearContactSearchBtn: document.getElementById('uiClearContactSearchBtn'),
    copyUsernameBtn: document.getElementById('uiCopyUsernameBtn'),
    logoutBtn: document.getElementById('uiLogoutBtn'),

    chatSearchBtn: document.getElementById('uiChatSearchBtn'),
    scrollBottomBtn: document.getElementById('uiScrollBottomBtn'),
    chatMenuBtn: document.getElementById('uiChatMenuBtn'),
    chatMenu: document.getElementById('uiChatMenu'),
    copyChatLinkBtn: document.getElementById('uiCopyChatLinkBtn'),
    exportChatBtn: document.getElementById('uiExportChatBtn'),
    clearChatBtn: document.getElementById('uiClearChatBtn'),

    messageSearchPanel: document.getElementById('uiMessageSearchPanel'),
    messageSearchInput: document.getElementById('uiMessageSearchInput'),
    messageSearchCount: document.getElementById('uiMessageSearchCount'),
    closeMessageSearchBtn: document.getElementById('uiCloseMessageSearchBtn'),

    attachBtn: document.getElementById('uiAttachBtn'),
    fileInput: document.getElementById('uiFileInput'),
    composerMenuBtn: document.getElementById('uiComposerMenuBtn'),
    composerMenu: document.getElementById('uiComposerMenu'),
    insertTimestampBtn: document.getElementById('uiInsertTimestampBtn'),
    insertSecurityNoteBtn: document.getElementById('uiInsertSecurityNoteBtn'),
    clearDraftBtn: document.getElementById('uiClearDraftBtn'),
    draftStatus: document.getElementById('uiDraftStatus'),
    charCounter: document.getElementById('uiCharCounter'),

    backdrop: document.getElementById('uiBackdrop'),
    settingsPanel: document.getElementById('uiSettingsPanel'),
    closeSettingsBtn: document.getElementById('uiCloseSettingsBtn'),
    prefEnterSend: document.getElementById('uiPrefEnterSend'),
    prefCompactMode: document.getElementById('uiPrefCompactMode'),
    prefShowTimestamps: document.getElementById('uiPrefShowTimestamps'),

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

const PRESENCE_ONLINE =
    'h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_2px_rgba(52,211,153,0.35)]';
const PRESENCE_OFFLINE =
    'h-2.5 w-2.5 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.35)]';
const UNREAD_BADGE =
    'flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-indigo-500 px-1.5 text-[10px] font-bold leading-none text-white';

const COMPOSER_DEFAULT_META = 'Cipher Stack: AES-GCM-256 + RSA-OAEP-2048';
const MAX_MESSAGE_LENGTH = 2000;
const messageActionHandlers = {
    onDeleteMessage: null
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
        statusIntent.includes('emerald') ||
        statusIntent.includes('yellow');

    DOM.statusSpan.className = isOnline
        ? 'rounded-full px-2 py-0.5 text-xs font-medium text-emerald-400'
        : 'rounded-full px-2 py-0.5 text-xs font-medium text-red-400';
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
    DOM.chatWithTitle.textContent = `Secure channel: ${username}`;
    DOM.messageInput.disabled = false;
    DOM.sendBtn.disabled = false;
    setChatToolsEnabled(true);
    setActiveContact(username);
    refreshChatHeaderSubtitle();
    focusComposer();
}

export function resetChatPanel() {
    DOM.chatWithTitle.textContent = 'Select a secure channel';
    if (DOM.chatSubtitle) {
        DOM.chatSubtitle.textContent = 'Asymmetric Cryptographic Handshake Tunnel';
        DOM.chatSubtitle.className = 'header-sub text-sm text-zinc-400';
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

export function appendMessage(messageOrSender, text, type, timestamp = Date.now()) {
    const message = typeof messageOrSender === 'object'
        ? messageOrSender
        : { sender: messageOrSender, text, type, timestamp };

    const msgElement = document.createElement('div');
    msgElement.className = message.type === 'outgoing'
        ? 'message-bubble message-outgoing'
        : 'message-bubble message-incoming';
    if (message.pending) {
        msgElement.classList.add('is-pending');
    }
    if (message.id) {
        msgElement.dataset.messageId = String(message.id);
    }
    if (message.clientMessageId) {
        msgElement.dataset.clientMessageId = message.clientMessageId;
    }

    const senderElement = document.createElement('div');
    senderElement.className = 'message-sender';
    senderElement.textContent = message.sender;

    const textElement = document.createElement('div');
    textElement.className = 'message-text';
    textElement.textContent = message.text;

    const footerRow = document.createElement('div');
    footerRow.className = 'mt-1 flex items-center justify-end gap-1';

    const timeElement = document.createElement('div');
    timeElement.className = 'message-time text-[10px] text-zinc-500';
    timeElement.textContent = formatMessageTime(new Date(message.timestamp || Date.now()));
    footerRow.append(timeElement);

    if (message.type === 'outgoing') {
        const statusElement = document.createElement('span');
        statusElement.dataset.messageStatus = 'true';
        statusElement.className = formatMessageStatusClasses(message.status, message.pending);
        statusElement.textContent = formatMessageStatusIcon(message.status, message.pending);
        statusElement.title = formatMessageStatusTitle(message.status, message.pending);
        footerRow.append(statusElement);
    }

    const actionsElement = document.createElement('div');
    actionsElement.className = 'message-actions';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'message-action-btn danger';
    deleteButton.textContent = 'Delete';
    deleteButton.disabled = !message.id;
    deleteButton.title = message.id ? 'Delete message from database' : 'Waiting for database sync';
    deleteButton.addEventListener('click', () => {
        if (!message.id) return;
        messageActionHandlers.onDeleteMessage?.(message.id);
    });

    actionsElement.append(deleteButton);
    msgElement.append(senderElement, textElement, footerRow, actionsElement);
    DOM.messagesDiv.appendChild(msgElement);
    scrollMessagesToBottom();
}

export function updateMessageIdentity(clientMessageId, id, timestamp) {
    const msgElement = DOM.messagesDiv.querySelector(`[data-client-message-id="${CSS.escape(clientMessageId)}"]`);
    if (!msgElement) return;

    msgElement.dataset.messageId = String(id);
    msgElement.classList.remove('is-pending');

    const deleteButton = msgElement.querySelector('.message-action-btn');
    if (deleteButton) {
        deleteButton.disabled = false;
        deleteButton.title = 'Delete message from database';
    }

    const timeElement = msgElement.querySelector('.message-time');
    if (timeElement && timestamp) {
        timeElement.textContent = formatMessageTime(new Date(timestamp));
    }

    updateMessageStatus(clientMessageId, id, 'sent');
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

    const statusElement = msgElement.querySelector('[data-message-status]');
    if (!statusElement) return;

    statusElement.textContent = formatMessageStatusIcon(status, false);
    statusElement.title = formatMessageStatusTitle(status, false);
    statusElement.className = formatMessageStatusClasses(status, false);
}

export function removeMessageElement(messageId) {
    const msgElement = DOM.messagesDiv.querySelector(`[data-message-id="${CSS.escape(String(messageId))}"]`);
    msgElement?.remove();
}

export function setMessageActionHandlers(handlers) {
    messageActionHandlers.onDeleteMessage = handlers.onDeleteMessage || null;
}

export function setComposerValue(text) {
    DOM.messageInput.value = text;
    autoResizeComposer();
    updateComposerMeta(text);
}

export function getComposerValue() {
    return DOM.messageInput.value;
}

export function clearComposer() {
    setComposerValue('');
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
    DOM.messageInput.style.height = 'auto';
    DOM.messageInput.style.height = `${Math.min(DOM.messageInput.scrollHeight, 132)}px`;
}

export function updateComposerMeta(text) {
    const length = text.length;
    DOM.charCounter.textContent = `${length} / ${MAX_MESSAGE_LENGTH}`;
    DOM.charCounter.classList.toggle('danger', length > MAX_MESSAGE_LENGTH);
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

export function openChatMenu() {
    togglePopover(DOM.chatMenu);
}

export function openComposerMenu() {
    togglePopover(DOM.composerMenu);
}

export function closeAllPopovers() {
    DOM.chatMenu.classList.add('hidden');
    DOM.composerMenu.classList.add('hidden');
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
    const bubbles = [...DOM.messagesDiv.querySelectorAll('.message-bubble')];
    let matches = 0;

    bubbles.forEach(bubble => {
        const haystack = bubble.textContent.toLowerCase();
        const isMatch = !normalized || haystack.includes(normalized);
        bubble.classList.toggle('is-search-hidden', !isMatch);
        bubble.classList.toggle('is-search-match', Boolean(normalized && isMatch));
        if (normalized && isMatch) matches += 1;
    });

    DOM.messageSearchCount.textContent = normalized
        ? `${matches} match${matches === 1 ? '' : 'es'}`
        : `${bubbles.length} messages`;
}

export function openSettings() {
    openModal(DOM.settingsPanel);
}

export function openShortcuts() {
    openModal(DOM.shortcutsPanel);
}

export function closeModals() {
    DOM.settingsPanel.classList.add('hidden');
    DOM.shortcutsPanel.classList.add('hidden');
    DOM.backdrop.classList.add('hidden');
}

export function closeTransientUi() {
    closeAllPopovers();
    closeModals();
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
}

export function setChatToolsEnabled(isEnabled) {
    [
        DOM.chatSearchBtn,
        DOM.scrollBottomBtn,
        DOM.chatMenuBtn,
        DOM.copyChatLinkBtn,
        DOM.exportChatBtn,
        DOM.clearChatBtn,
        DOM.composerMenuBtn,
        DOM.attachBtn
    ].forEach(control => {
        control.disabled = !isEnabled;
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
        subtitle.className = 'contact-subtitle text-xs text-zinc-500';
        subtitle.dataset.contactSubtitle = 'true';
        if (realtimeContext.typingUsers.has(user.username)) {
            subtitle.innerHTML = buildTypingDotsHtml();
        } else {
            subtitle.textContent = user.last_message_at
                ? formatSidebarTime(user.last_message_at)
                : 'Secure channel';
        }

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

function togglePopover(popover) {
    const shouldOpen = popover.classList.contains('hidden');
    closeAllPopovers();
    popover.classList.toggle('hidden', !shouldOpen);
}

function openModal(panel) {
    closeAllPopovers();
    DOM.backdrop.classList.remove('hidden');
    DOM.settingsPanel.classList.toggle('hidden', panel !== DOM.settingsPanel);
    DOM.shortcutsPanel.classList.toggle('hidden', panel !== DOM.shortcutsPanel);
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
    return realtimeContext.onlineUsers.has(username) ? PRESENCE_ONLINE : PRESENCE_OFFLINE;
}

function buildTypingDotsHtml() {
    return `<span class="inline-flex items-center gap-0.5 text-xs text-zinc-400" aria-label="Typing">
        <span class="h-1 w-1 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.2s]"></span>
        <span class="h-1 w-1 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.1s]"></span>
        <span class="h-1 w-1 animate-bounce rounded-full bg-zinc-400"></span>
    </span>`;
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
            if (realtimeContext.typingUsers.has(username)) {
                subtitle.innerHTML = buildTypingDotsHtml();
            }
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
        DOM.chatSubtitle.className = 'header-sub text-sm text-zinc-400';
        return;
    }

    if (realtimeContext.typingUsers.has(partner)) {
        DOM.chatSubtitle.innerHTML = `<span class="inline-flex items-center gap-2 text-sm text-zinc-400">
            <span>typing</span>${buildTypingDotsHtml()}
        </span>`;
        return;
    }

    const online = realtimeContext.onlineUsers.has(partner);
    DOM.chatSubtitle.innerHTML = online
        ? '<span class="text-sm font-medium text-emerald-400">Online</span>'
        : '<span class="text-sm font-medium text-red-400">Offline</span>';
}

function formatMessageStatusIcon(status, pending) {
    if (pending || status === 'sending') return '◔';
    if (status === 'read') return '✓✓';
    if (status === 'delivered') return '✓✓';
    if (status === 'sent') return '✓';
    return '◔';
}

function formatMessageStatusTitle(status, pending) {
    if (pending || status === 'sending') return 'Sending';
    if (status === 'read') return 'Read';
    if (status === 'delivered') return 'Delivered';
    if (status === 'sent') return 'Sent';
    return 'Sending';
}

function formatMessageStatusClasses(status, pending) {
    const base = 'text-[11px] leading-none';
    if (pending || status === 'sending') return `${base} text-zinc-500`;
    if (status === 'read') return `${base} text-emerald-400`;
    if (status === 'delivered') return `${base} text-zinc-400`;
    return `${base} text-zinc-500`;
}
