// Modal dialogs — portals existing settings / shortcuts / profile panels.

import { onProfilePanelOpen } from '../../js/profileSettings.js';
import { closeOverlay } from './overlayManager.js';

const holderId = 'ui-overlay-modal-holder';
const panelIds = {
    settings: 'uiSettingsPanel',
    shortcuts: 'uiShortcutsPanel',
    profile: 'uiProfilePanel',
};

const closeButtonSelectors = {
    settings: '#uiCloseSettingsBtn',
    shortcuts: '#uiCloseShortcutsBtn',
    profile: '#uiCloseProfileBtn',
};

/** @type {Record<string, { panel: HTMLElement, parent: HTMLElement, next: ChildNode|null }>} */
const portaled = {};

export function renderModal(container) {
    container.classList.add('overlay-surface--modal');
    container.setAttribute('aria-labelledby', 'overlay-modal-title');
}

export function attachModalPanel(modalId, container) {
    const panelId = panelIds[modalId];
    const panel = panelId ? document.getElementById(panelId) : null;
    if (!panel) return;

    ensureHolder();
    if (!portaled[modalId]) {
        portaled[modalId] = {
            panel,
            parent: panel.parentElement,
            next: panel.nextSibling,
        };
    }

    panel.classList.remove('hidden');
    panel.classList.add('modal-panel');
    container.appendChild(panel);

    const closeSel = closeButtonSelectors[modalId];
    const closeButtons = closeSel
        ? panel.querySelectorAll(closeSel)
        : panel.querySelectorAll('[data-overlay-close]');

    closeButtons.forEach((closeBtn) => {
        if (closeBtn.dataset.overlayBound) return;
        closeBtn.dataset.overlayBound = '1';
        closeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            closeOverlay({ reason: 'modal-close-btn' });
        });
    });

    if (modalId === 'profile') {
        onProfilePanelOpen();
    }
}

export function releaseModalPanel(modalId) {
    const entry = portaled[modalId];
    if (!entry) return;

    const { panel, parent, next } = entry;
    panel.classList.add('hidden');

    if (next && next.parentNode === parent) {
        parent.insertBefore(panel, next);
    } else {
        parent.appendChild(panel);
    }

    delete portaled[modalId];
}

function ensureHolder() {
    let holder = document.getElementById(holderId);
    if (!holder) {
        holder = document.createElement('div');
        holder.id = holderId;
        holder.className = 'overlay-modal-holder';
        document.body.appendChild(holder);
    }
    return holder;
}

export function openModalById(modalId) {
    return modalId;
}
