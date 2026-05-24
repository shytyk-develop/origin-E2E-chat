// Message context menu (right-click).

import { closeOverlay } from './overlayManager.js';

export function getMessageContextItems(payload) {
    const isOutgoing = payload?.messageType === 'outgoing';

    if (isOutgoing) {
        const items = [
            { id: 'message.copy', label: 'Copy' },
        ];
        if (payload?.messageId) {
            items.push({ id: 'message.edit', label: 'Edit', disabled: true });
            items.push({ type: 'separator' });
            items.push({ id: 'message.delete', label: 'Delete for everyone', danger: true });
        }
        return items;
    }

    return [
        { id: 'message.copy', label: 'Copy' },
        { id: 'message.reply', label: 'Reply' },
        { type: 'separator' },
        { id: 'message.highlight', label: 'Select / Highlight' },
    ];
}

export function renderContextMenu(container, state, runAction) {
    const items = getMessageContextItems(state.payload);
    const list = document.createElement('ul');
    list.className = 'overlay-menu-list';

    items.forEach((item) => {
        if (item.type === 'separator') {
            const sep = document.createElement('li');
            sep.className = 'overlay-menu-separator';
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
