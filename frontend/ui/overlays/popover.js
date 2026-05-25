// Anchored popovers — chat info, quick appearance, reactions.

import { closeOverlay } from './overlayManager.js';
import { QUICK_REACTIONS } from '../../js/messageReactions.js';
import { computeKeyFingerprint } from '../../js/profile.js';
import { getPrivacyFlags } from '../../js/privacy.js';

export function renderPopover(container, state, runAction) {
    const { popoverId } = state.payload || {};

    if (popoverId === 'chat-info') {
        renderChatInfo(container, state.payload, runAction);
        return;
    }

    if (popoverId === 'reactions') {
        renderReactionPicker(container, state.payload, runAction);
        return;
    }

    const fallback = document.createElement('p');
    fallback.className = 'overlay-popover-body';
    fallback.textContent = 'Panel unavailable.';
    container.appendChild(fallback);
}

async function renderChatInfo(container, payload, runAction) {
    const title = document.createElement('h3');
    title.className = 'overlay-popover-title';
    title.textContent = payload?.partner ? `@${payload.partner}` : 'Chat info';

    const body = document.createElement('p');
    body.className = 'overlay-popover-body';
    body.textContent = 'End-to-end encrypted channel. Messages are decrypted only in your browser.';

    const meta = document.createElement('dl');
    meta.className = 'overlay-popover-meta';

    const prefs = payload?.preferences || {};
    const privacy = getPrivacyFlags(prefs);

    appendMeta(meta, 'Partner', payload?.partner ? `@${payload.partner}` : '—');
    if (privacy.showOnlineStatus) {
        appendMeta(meta, 'Status', payload?.online ? 'Online' : 'Offline');
    } else {
        appendMeta(meta, 'Status', 'Hidden (privacy)');
    }
    appendMeta(meta, 'Encryption', 'AES-GCM-256 + RSA-OAEP-2048');

    if (payload?.muted) {
        appendMeta(meta, 'Notifications', 'Muted locally');
    }

    if (payload?.publicKeyJwk) {
        let fp = 'Unavailable';
        try {
            fp = await computeKeyFingerprint(payload.publicKeyJwk);
        } catch {
            /* keep fallback */
        }
        appendMeta(meta, 'Fingerprint', fp);
    }

    container.append(title, body, meta);
}

function renderReactionPicker(container, payload, runAction) {
    const title = document.createElement('h3');
    title.className = 'overlay-popover-title';
    title.textContent = 'React';

    const picker = document.createElement('div');
    picker.className = 'reaction-picker';

    QUICK_REACTIONS.forEach((emoji) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'reaction-picker-btn';
        btn.textContent = emoji;
        btn.addEventListener('click', () => {
            closeOverlay({ reason: 'reaction-pick' });
            runAction('reaction.pick', { messageId: payload?.messageId, emoji });
        });
        picker.append(btn);
    });

    container.append(title, picker);
}

function appendMeta(dl, label, value) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
}
