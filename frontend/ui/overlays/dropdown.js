// Dropdown menus — chat header, settings rail, composer tools.

import { closeOverlay } from './overlayManager.js';

const MENUS = {
    'chat-header': [
        { id: 'chat.mute', label: 'Mute chat' },
        { type: 'separator' },
        { id: 'chat.search', label: 'Search in chat', kbd: '⌘⇧F' },
        { id: 'chat.copyLink', label: 'Copy chat link' },
        { id: 'chat.export', label: 'Export local chat', kbd: '⌘⇧E' },
        { type: 'separator' },
        { id: 'chat.clearHistory', label: 'Clear history', danger: true },
        { id: 'chat.delete', label: 'Delete chat', danger: true },
        { type: 'separator' },
        { id: 'chat.info', label: 'Chat info' },
    ],
    settings: [
        { id: 'settings.modal', label: 'Interface', kbd: '⌘⇧S' },
        { id: 'settings.shortcuts', label: 'Keyboard shortcuts', kbd: '⌘⇧/' },
    ],
    composer: [
        { id: 'composer.timestamp', label: 'Insert timestamp' },
        { id: 'composer.securityNote', label: 'Insert security note' },
        { type: 'separator' },
        { id: 'composer.clearDraft', label: 'Clear draft', danger: true },
    ],
};

export function getDropdownMenu(menuId) {
    return MENUS[menuId] || [];
}

export function renderDropdown(container, state, runAction) {
    const menuId = state.payload?.menuId;
    const items = getDropdownMenu(menuId);
    const list = document.createElement('ul');
    list.className = 'overlay-menu-list';

    items.forEach((item) => {
        if (item.type === 'separator') {
            const sep = document.createElement('li');
            sep.className = 'overlay-menu-separator';
            sep.setAttribute('role', 'separator');
            list.appendChild(sep);
            return;
        }

        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'overlay-menu-item';
        btn.role = 'menuitem';
        btn.textContent = item.label;
        if (item.danger) btn.classList.add('is-danger');
        if (item.disabled) btn.disabled = true;

        if (item.kbd) {
            const kbd = document.createElement('span');
            kbd.className = 'overlay-menu-kbd';
            kbd.textContent = item.kbd;
            btn.append(kbd);
        }

        btn.addEventListener('click', () => {
            if (item.disabled) return;
            closeOverlay({ reason: 'menu-action' });
            runAction(item.id, state.payload);
        });

        li.append(btn);
        list.appendChild(li);
    });

    container.appendChild(list);
}
