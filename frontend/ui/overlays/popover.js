// Anchored popovers — chat info, quick appearance.

import { closeOverlay } from './overlayManager.js';

export function renderPopover(container, state, runAction) {
    const { popoverId } = state.payload || {};

    if (popoverId === 'chat-info') {
        renderChatInfo(container, state.payload);
        return;
    }

    if (popoverId === 'appearance') {
        renderAppearanceQuick(container, state.payload, runAction);
        return;
    }

    const fallback = document.createElement('p');
    fallback.className = 'overlay-popover-body';
    fallback.textContent = 'Panel unavailable.';
    container.appendChild(fallback);
}

function renderChatInfo(container, payload) {
    const title = document.createElement('h3');
    title.className = 'overlay-popover-title';
    title.textContent = payload?.partner ? `Chat with ${payload.partner}` : 'Chat info';

    const body = document.createElement('p');
    body.className = 'overlay-popover-body';
    body.textContent = 'End-to-end encrypted channel. Messages are decrypted only in your browser.';

    const meta = document.createElement('dl');
    meta.className = 'overlay-popover-meta';

    appendMeta(meta, 'Partner', payload?.partner || '—');
    appendMeta(meta, 'Status', payload?.online ? 'Online' : 'Offline');
    appendMeta(meta, 'Encryption', 'AES-GCM-256 + RSA-OAEP-2048');

    container.append(title, body, meta);
}

function renderAppearanceQuick(container, payload, runAction) {
    const title = document.createElement('h3');
    title.className = 'overlay-popover-title';
    title.textContent = 'Appearance';

    const row = document.createElement('div');
    row.className = 'theme-picker';
    row.setAttribute('role', 'group');

    ['light', 'dark', 'system'].forEach((value) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.themeValue = value;
        btn.textContent = value === 'system' ? 'Auto' : value.charAt(0).toUpperCase() + value.slice(1);
        btn.classList.toggle('is-active', payload?.theme === value);
        btn.addEventListener('click', () => {
            closeOverlay({ reason: 'theme-pick' });
            runAction('theme.set', { theme: value });
        });
        row.append(btn);
    });

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'overlay-menu-item';
    more.style.marginTop = '10px';
    more.textContent = 'All interface settings…';
    more.addEventListener('click', () => {
        closeOverlay({ reason: 'open-settings' });
        runAction('settings.modal', {});
    });

    container.append(title, row, more);
}

function appendMeta(dl, label, value) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
}
