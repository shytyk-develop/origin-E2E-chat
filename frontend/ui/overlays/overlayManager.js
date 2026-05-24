// Single source of truth for all floating UI (dropdown, context, popover, modal).

import { renderDropdown } from './dropdown.js';
import { renderContextMenu } from './contextMenu.js';
import { renderPopover } from './popover.js';
import { renderModal, attachModalPanel, releaseModalPanel } from './modal.js';

const CLOSE_DELAY_MS = 100;
const OPEN_ANIM_MS = 16;

/** @type {import('./overlayManager.js').OverlayState | null} */
let overlayState = null;
let closeTimer = null;
let openFrame = null;
let rootEl = null;
let backdropEl = null;
let surfaceEl = null;
/** @type {Record<string, Function>} */
let actions = {};
let scrollCloseBound = false;
let ignoreOutsideUntil = 0;

/**
 * @typedef {Object} OverlayState
 * @property {'dropdown'|'context'|'popover'|'modal'} type
 * @property {{ x: number, y: number }} [position]
 * @property {DOMRect} [anchorRect]
 * @property {Record<string, unknown>} payload
 * @property {string|null} targetId
 */

export function registerOverlayActions(handlers) {
    actions = { ...actions, ...handlers };
}

export function getOverlayAction(id) {
    return actions[id];
}

export function runOverlayAction(id, payload = {}) {
    const fn = actions[id];
    if (typeof fn === 'function') {
        fn(payload);
    }
}

export function getOverlayState() {
    return overlayState ? { ...overlayState } : null;
}

export function isOverlayOpen() {
    return overlayState !== null;
}

/**
 * @param {OverlayState} next
 */
export function openOverlay(next) {
    window.clearTimeout(closeTimer);
    window.cancelAnimationFrame(openFrame);

    if (overlayState?.type === 'modal') {
        releaseModalPanel(overlayState.payload?.modalId);
    }

    ignoreOutsideUntil = Date.now() + 180;

    overlayState = {
        type: next.type,
        position: next.position ? { ...next.position } : undefined,
        anchorRect: next.anchorRect
            ? {
                x: next.anchorRect.x,
                y: next.anchorRect.y,
                width: next.anchorRect.width,
                height: next.anchorRect.height,
                top: next.anchorRect.top,
                right: next.anchorRect.right,
                bottom: next.anchorRect.bottom,
                left: next.anchorRect.left,
            }
            : undefined,
        payload: next.payload ? { ...next.payload } : {},
        targetId: next.targetId ?? null,
    };

    renderOverlay({ animate: true });
}

export function closeOverlay({ immediate = false } = {}) {
    if (!overlayState) return;

    window.clearTimeout(closeTimer);
    window.cancelAnimationFrame(openFrame);

    if (surfaceEl) {
        surfaceEl.classList.remove('is-visible');
        surfaceEl.classList.add('is-closing');
    }
    if (backdropEl) {
        backdropEl.classList.remove('is-visible');
    }

    const closingType = overlayState.type;
    const closingPayload = { ...overlayState.payload };

    const finish = () => {
        if (closingType === 'modal') {
            releaseModalPanel(closingPayload.modalId);
        }
        overlayState = null;
        if (rootEl) {
            rootEl.innerHTML = '';
            rootEl.classList.remove('is-active');
            rootEl.setAttribute('aria-hidden', 'true');
        }
        surfaceEl = null;
        backdropEl = null;
    };

    if (immediate) {
        finish();
        return;
    }

    closeTimer = window.setTimeout(finish, CLOSE_DELAY_MS);
}

export function initOverlayManager({ rootId = 'ui-overlay-root' } = {}) {
    rootEl = document.getElementById(rootId);
    if (!rootEl) {
        rootEl = document.createElement('div');
        rootEl.id = rootId;
        document.body.appendChild(rootEl);
    }

    if (!scrollCloseBound) {
        scrollCloseBound = true;
        document.addEventListener(
            'keydown',
            (event) => {
                if (event.key === 'Escape' && overlayState) {
                    event.preventDefault();
                    closeOverlay();
                }
            },
            true
        );

        document.addEventListener(
            'mousedown',
            (event) => {
                if (Date.now() < ignoreOutsideUntil) return;
                if (!overlayState || overlayState.type === 'modal') return;
                if (surfaceEl?.contains(event.target)) return;
                const anchorId = overlayState.payload?.anchorId;
                if (anchorId) {
                    const anchor = document.getElementById(anchorId);
                    if (anchor?.contains(event.target)) return;
                }
                closeOverlay();
            },
            true
        );

        const messages = document.getElementById('messages');
        messages?.addEventListener(
            'scroll',
            () => {
                if (overlayState && (overlayState.type === 'dropdown' || overlayState.type === 'context')) {
                    closeOverlay({ immediate: true });
                }
            },
            { passive: true }
        );
    }
}

function renderOverlay({ animate }) {
    if (!rootEl || !overlayState) return;

    rootEl.innerHTML = '';
    rootEl.classList.add('is-active');
    rootEl.setAttribute('aria-hidden', 'false');

    const needsBackdrop =
        overlayState.type === 'modal' ||
        overlayState.type === 'popover' ||
        overlayState.type === 'context';

    if (needsBackdrop) {
        backdropEl = document.createElement('div');
        backdropEl.className = `overlay-backdrop${overlayState.type === 'modal' ? ' is-modal' : ''}`;
        backdropEl.addEventListener('mousedown', () => closeOverlay());
        rootEl.appendChild(backdropEl);
    }

    surfaceEl = document.createElement('div');
    surfaceEl.className = `overlay-surface overlay-surface--${overlayState.type === 'context' ? 'menu' : overlayState.type}`;
    surfaceEl.setAttribute('role', overlayState.type === 'modal' ? 'dialog' : 'menu');
    surfaceEl.setAttribute('aria-modal', overlayState.type === 'modal' ? 'true' : 'false');

    switch (overlayState.type) {
        case 'dropdown':
            renderDropdown(surfaceEl, overlayState, runOverlayAction);
            break;
        case 'context':
            renderContextMenu(surfaceEl, overlayState, runOverlayAction);
            break;
        case 'popover':
            renderPopover(surfaceEl, overlayState, runOverlayAction);
            break;
        case 'modal':
            renderModal(surfaceEl, overlayState);
            attachModalPanel(overlayState.payload.modalId, surfaceEl);
            break;
        default:
            break;
    }

    rootEl.appendChild(surfaceEl);
    positionSurface(surfaceEl, overlayState);

    if (animate) {
        openFrame = window.requestAnimationFrame(() => {
            positionSurface(surfaceEl, overlayState);
            backdropEl?.classList.add('is-visible');
            surfaceEl?.classList.add('is-visible');
        });
    } else {
        backdropEl?.classList.add('is-visible');
        surfaceEl?.classList.add('is-visible');
    }
}

/**
 * @param {HTMLElement} el
 * @param {OverlayState} state
 */
export function positionSurface(el, state) {
    const pad = 8;
    const rect = el.getBoundingClientRect();
    const menuW = rect.width || 220;
    const menuH = rect.height || 120;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    if (state.type === 'modal') {
        el.style.left = '50%';
        el.style.top = '50%';
        return;
    }

    let x;
    let y;

    if (state.anchorRect) {
        const a = state.anchorRect;
        x = a.left;
        y = a.bottom + 6;
        if (y + menuH > vh - pad) {
            y = a.top - menuH - 6;
        }
        if (x + menuW > vw - pad) {
            x = a.right - menuW;
        }
    } else if (state.position) {
        x = state.position.x;
        y = state.position.y;
        if (x + menuW > vw - pad) x = vw - menuW - pad;
        if (y + menuH > vh - pad) y = vh - menuH - pad;
    } else {
        x = pad;
        y = pad;
    }

    x = Math.max(pad, Math.min(x, vw - menuW - pad));
    y = Math.max(pad, Math.min(y, vh - menuH - pad));

    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
}

export function openDropdown({ menuId, anchor, targetId = null, payload = {} }) {
    const tid = targetId || menuId;
    const current = getOverlayState();
    if (current?.type === 'dropdown' && current.targetId === tid) {
        closeOverlay();
        return;
    }

    const anchorEl = typeof anchor === 'string' ? document.getElementById(anchor) : anchor;
    const anchorRect = anchorEl?.getBoundingClientRect();
    openOverlay({
        type: 'dropdown',
        anchorRect,
        payload: { menuId, anchorId: anchorEl?.id || null, ...payload },
        targetId: tid,
    });
}

export function closeOverlaysForChatChange() {
    closeOverlay({ immediate: true });
}

export function openContextMenu({ x, y, payload, targetId = null }) {
    openOverlay({
        type: 'context',
        position: { x, y },
        payload,
        targetId,
    });
}

export function openPopoverOverlay({ popoverId, anchor, payload = {}, targetId = null }) {
    const anchorEl = typeof anchor === 'string' ? document.getElementById(anchor) : anchor;
    openOverlay({
        type: 'popover',
        anchorRect: anchorEl?.getBoundingClientRect(),
        payload: { popoverId, ...payload },
        targetId: targetId || popoverId,
    });
}

export function openModalOverlay(modalId, targetId = null) {
    openOverlay({
        type: 'modal',
        payload: { modalId },
        targetId: targetId || modalId,
    });
}
