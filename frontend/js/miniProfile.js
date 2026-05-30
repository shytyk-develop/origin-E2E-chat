// Hover mini profile card for contact rows.

import { copyText } from './chatActions.js';
import { computeOverlayPosition, applyOverlayPosition } from '../ui/overlays/positioning.js';
import {
    getAvatarHue,
    getDisplayLabel,
    getInitials,
} from './profile.js';
import { resolveContactProfile } from './profileDirectory.js';

const SHOW_DELAY_MS = 220;
const HIDE_DELAY_MS = 120;

let ctx = null;
let card = null;
let showTimer = null;
let hideTimer = null;
let activeRow = null;
let activeUsername = null;

export function initMiniProfile(context) {
    ctx = context;
    ensureCard();
}

function ensureCard() {
    if (card) return;
    card = document.createElement('div');
    card.id = 'uiMiniProfile';
    card.className = 'mini-profile-card';
    card.hidden = true;
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Contact profile');
    card.addEventListener('mouseenter', cancelHide);
    card.addEventListener('mouseleave', scheduleHide);
    document.body.appendChild(card);
}

export function attachMiniProfileHover(row, username, userHint) {
    if (!row || !username) return;
    row.addEventListener('mouseenter', () => scheduleShow(row, username, userHint));
    row.addEventListener('mouseleave', scheduleHide);
    row.addEventListener('focus', () => scheduleShow(row, username, userHint));
    row.addEventListener('blur', scheduleHide);
}

function scheduleShow(row, username, userHint) {
    cancelHide();
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => {
        showMiniProfile(row, username, userHint);
    }, SHOW_DELAY_MS);
}

function scheduleHide() {
    window.clearTimeout(showTimer);
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(hideMiniProfile, HIDE_DELAY_MS);
}

function cancelHide() {
    window.clearTimeout(hideTimer);
}

function hideMiniProfile() {
    if (!card) return;
    card.hidden = true;
    card.classList.remove('is-visible');
    activeRow = null;
    activeUsername = null;
}

function showMiniProfile(row, username, userHint) {
    ensureCard();
    const myUsername = ctx?.getMyUsername?.() || '';
    const profile = resolveContactProfile(username, userHint, myUsername);
    const label = getDisplayLabel(username, profile);
    const online = ctx?.isOnline?.(username) ?? false;
    const muted = ctx?.isMuted?.(username) ?? false;
    const showPresence = ctx?.showPresence?.() !== false;

    activeRow = row;
    activeUsername = username;

    card.innerHTML = '';
    card.appendChild(buildCardContent({
        username,
        label,
        profile,
        online,
        muted,
        showPresence,
    }));
    positionCard(row);
    card.hidden = false;
    requestAnimationFrame(() => card.classList.add('is-visible'));
}

function buildCardContent({ username, label, profile, online, muted, showPresence }) {
    const wrap = document.createElement('div');
    wrap.className = 'mini-profile-inner';

    const hero = document.createElement('div');
    hero.className = 'mini-profile-hero';

    const avatar = document.createElement('div');
    avatar.className = 'mini-profile-avatar';
    avatar.style.setProperty('--avatar-hue', String(getAvatarHue(username)));
    if (profile.avatarDataUrl) {
        const img = document.createElement('img');
        img.src = profile.avatarDataUrl;
        img.alt = '';
        avatar.appendChild(img);
    } else {
        avatar.textContent = getInitials(label);
    }

    const identity = document.createElement('div');
    identity.className = 'mini-profile-identity';

    const nameEl = document.createElement('div');
    nameEl.className = 'mini-profile-name';
    nameEl.textContent = label;

    const handleEl = document.createElement('div');
    handleEl.className = 'mini-profile-handle';
    handleEl.textContent = `@${username}`;

    identity.append(nameEl, handleEl);

    if (showPresence) {
        const status = document.createElement('span');
        status.className = `mini-profile-status ${online ? 'is-online' : 'is-offline'}`;
        status.textContent = online ? 'Online' : 'Offline';
        identity.appendChild(status);
    }

    hero.append(avatar, identity);

    const bioEl = document.createElement('p');
    bioEl.className = 'mini-profile-bio';
    const bioText = profile.bio?.trim();
    if (bioText) {
        bioEl.textContent = bioText;
    } else {
        bioEl.textContent = 'No bio yet';
        bioEl.classList.add('is-placeholder');
    }

    const actions = document.createElement('div');
    actions.className = 'mini-profile-actions';

    actions.append(
        actionBtn('Message', 'primary', () => {
            hideMiniProfile();
            ctx?.onOpenChat?.(username);
        }),
        actionBtn('Copy ID', 'ghost', async () => {
            try {
                await copyText(username);
                ctx?.showToast?.('Username copied.', 'success');
            } catch {
                ctx?.showToast?.('Copy failed.', 'error');
            }
        }),
        actionBtn(muted ? 'Unmute' : 'Mute', 'ghost', () => {
            ctx?.onToggleMute?.(username);
            hideMiniProfile();
        })
    );

    wrap.append(hero, bioEl, actions);
    return wrap;
}

function actionBtn(label, variant, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `mini-profile-btn mini-profile-btn--${variant}`;
    btn.textContent = label;
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
    });
    return btn;
}

function positionCard(row) {
    const rect = row.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const size = {
        width: cardRect.width || 280,
        height: cardRect.height || 200,
    };
    const pos = computeOverlayPosition(rect, null, size, { gap: 10, pad: 12 });
    applyOverlayPosition(card, pos);
}

export function refreshActiveMiniProfile(userHint) {
    if (!activeRow || !activeUsername || !card || card.hidden) return;
    showMiniProfile(activeRow, activeUsername, userHint);
}
