// Single source of truth for all floating UI — production lifecycle + positioning.

import { renderDropdown } from './dropdown.js';
import { renderContextMenu } from './contextMenu.js';
import { renderPopover } from './popover.js';
import { renderModal, attachModalPanel, releaseModalPanel } from './modal.js';
import { computeOverlayPosition, applyOverlayPosition } from './positioning.js';
import { overlayDebug, isOverlayDebugEnabled } from './debug.js';

export const ANIM_MS = 150;
const OPEN_GUARD_MS = 160;

/** @type {import('./overlayManager.js').OverlayState | null} */
let overlayState = null;
let generation = 0;
let lifecycleQueue = Promise.resolve();
let closeTimer = null;
let openFrame = null;
let ignoreOutsideUntil = 0;
let isClosing = false;

let rootEl = null;
let backdropEl = null;
let surfaceEl = null;

/** @type {Record<string, Function>} */
let actions = {};

let listenersBound = false;
let onKeyDown = null;
let onOutsideClick = null;
let onResize = null;
let onVisualViewportChange = null;
let scrollTargets = [];

/**
 * @typedef {Object} OverlayState
 * @property {'dropdown'|'context'|'popover'|'modal'} type
 * @property {{ x: number, y: number }} [position]
 * @property {Object} [anchorRect]
 * @property {Record<string, unknown>} payload
 * @property {string|null} targetId
 * @property {number} generation
 */

function freezeState(next, gen) {
    return Object.freeze({
        type: next.type,
        position: next.position ? Object.freeze({ x: next.position.x, y: next.position.y }) : undefined,
        anchorRect: normalizeRect(next.anchorRect),
        payload: Object.freeze({ ...(next.payload || {}) }),
        targetId: next.targetId ?? null,
        generation: gen,
    });
}

function normalizeRect(rect) {
    if (!rect) return undefined;
    return Object.freeze({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
    });
}

function runLifecycle(task) {
    lifecycleQueue = lifecycleQueue
        .then(task)
        .catch((err) => {
            console.error('[overlay] lifecycle error:', err);
        });
    return lifecycleQueue;
}

function clearTimers() {
    window.clearTimeout(closeTimer);
    window.cancelAnimationFrame(openFrame);
    closeTimer = null;
    openFrame = null;
}

function hardDestroy(reason) {
    clearTimers();

    const closingState = overlayState;
    if (closingState?.type === 'modal' && closingState.payload?.modalId) {
        releaseModalPanel(closingState.payload.modalId);
    }

    overlayState = null;
    isClosing = false;
    backdropEl = null;
    surfaceEl = null;

    if (rootEl) {
        rootEl.innerHTML = '';
        rootEl.classList.remove('is-active');
        rootEl.setAttribute('aria-hidden', 'true');
    }

    overlayDebug('destroy', { reason, generation });
}

function animateClose(gen, reason) {
    return new Promise((resolve) => {
        if (!overlayState || overlayState.generation !== gen) {
            resolve();
            return;
        }

        isClosing = true;
        overlayDebug('close-start', { reason, gen });

        surfaceEl?.classList.remove('is-visible');
        surfaceEl?.classList.add('is-closing');
        backdropEl?.classList.remove('is-visible');

        closeTimer = window.setTimeout(() => {
            if (overlayState?.generation === gen) {
                hardDestroy(reason);
            }
            isClosing = false;
            overlayDebug('close-done', { reason, gen });
            resolve();
        }, ANIM_MS);
    });
}

export function registerOverlayActions(handlers) {
    actions = { ...actions, ...handlers };
}

export function runOverlayAction(id, payload = {}) {
    const fn = actions[id];
    if (typeof fn === 'function') fn(payload);
}

export function getOverlayState() {
    if (!overlayState) return null;
    return {
        type: overlayState.type,
        position: overlayState.position ? { ...overlayState.position } : undefined,
        anchorRect: overlayState.anchorRect ? { ...overlayState.anchorRect } : undefined,
        payload: { ...overlayState.payload },
        targetId: overlayState.targetId,
        generation: overlayState.generation,
    };
}

export function isOverlayOpen() {
    return overlayState !== null && !isClosing;
}

/**
 * @param {{ immediate?: boolean, reason?: string }} [options]
 */
export function closeOverlay(options = {}) {
    const { immediate = false, reason = 'manual' } = options;

    return runLifecycle(async () => {
        if (!overlayState) return;

        const gen = overlayState.generation;
        generation += 1;

        if (immediate) {
            hardDestroy(reason);
            return;
        }

        await animateClose(gen, reason);
    });
}

export function destroyAllOverlays(reason = 'destroy-all') {
    generation += 1;
    return closeOverlay({ immediate: true, reason });
}

export function closeOverlaysForChatChange() {
    return destroyAllOverlays('chat-change');
}

export function closeOverlaysForRouteChange() {
    return destroyAllOverlays('route-change');
}

/**
 * @param {Omit<OverlayState, 'generation'>} next
 */
function replaceOverlay(next) {
    if (overlayState) {
        hardDestroy('replace');
    }

    generation += 1;
    const gen = generation;
    ignoreOutsideUntil = Date.now() + OPEN_GUARD_MS;

    overlayState = freezeState(next, gen);
    overlayDebug('open', {
        type: next.type,
        targetId: next.targetId,
        generation: gen,
    });

    mountOverlay(gen);
    return getOverlayState();
}

export function openOverlay(next) {
    return runLifecycle(async () => {
        replaceOverlay(next);
    });
}

function mountOverlay(gen) {
    if (!rootEl || !overlayState || overlayState.generation !== gen) return;

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
        backdropEl.addEventListener('click', (event) => {
            event.stopPropagation();
            closeOverlay({ reason: 'backdrop' });
        });
        rootEl.appendChild(backdropEl);
    }

    surfaceEl = document.createElement('div');
    const surfaceKind =
        overlayState.type === 'context'
            ? 'menu'
            : overlayState.type;
    surfaceEl.className = `overlay-surface overlay-surface--${surfaceKind}`;
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

    layoutSurface(surfaceEl, overlayState);

    // Show immediately (double rAF could skip is-visible on fast re-open).
    if (overlayState?.generation === gen && surfaceEl) {
        backdropEl?.classList.add('is-visible');
        surfaceEl.classList.add('is-visible');
    }

    openFrame = window.requestAnimationFrame(() => {
        if (overlayState?.generation !== gen || !surfaceEl) return;
        layoutSurface(surfaceEl, overlayState);
    });
}

function layoutSurface(el, state) {
    if (state.type === 'modal') {
        applyOverlayPosition(el, { x: 0, y: 0 }, { isModal: true });
        return;
    }

    const rect = el.getBoundingClientRect();
    const menuSize = {
        width: rect.width || el.offsetWidth || 220,
        height: rect.height || el.offsetHeight || 120,
    };

    const anchorRect = state.anchorRect
        ? {
            top: state.anchorRect.top,
            left: state.anchorRect.left,
            right: state.anchorRect.right,
            bottom: state.anchorRect.bottom,
            width: state.anchorRect.width,
            height: state.anchorRect.height,
        }
        : undefined;

    const position = computeOverlayPosition(
        anchorRect,
        state.position,
        menuSize
    );

    applyOverlayPosition(el, position, { isModal: false });

    overlayDebug('position', {
        type: state.type,
        menuSize,
        result: position,
    });
}

export function repositionActiveOverlay() {
    if (!overlayState || !surfaceEl || overlayState.type === 'modal') return;
    layoutSurface(surfaceEl, overlayState);
}

function eventComposedPath(event) {
    if (typeof event.composedPath === 'function') {
        return event.composedPath();
    }
    return [event.target];
}

function shouldIgnoreOutsideInteraction(event) {
    if (!overlayState || isClosing) return true;
    if (Date.now() < ignoreOutsideUntil) return true;

    const path = eventComposedPath(event);

    if (surfaceEl && path.includes(surfaceEl)) return true;

    const anchorId = overlayState.payload?.anchorId;
    if (anchorId) {
        const anchor = document.getElementById(anchorId);
        if (anchor && path.includes(anchor)) return true;
    }

    return false;
}

function handleOutsideClick(event) {
    if (shouldIgnoreOutsideInteraction(event)) return;

    const path = eventComposedPath(event);
    if (backdropEl && path.includes(backdropEl)) {
        closeOverlay({ reason: 'backdrop' });
        return;
    }

    closeOverlay({ reason: 'outside' });
}

function handleKeyDown(event) {
    if (event.key !== 'Escape' || !overlayState) return;
    event.preventDefault();
    event.stopPropagation();
    closeOverlay({ reason: 'esc' });
}

function handleViewportChange() {
    repositionActiveOverlay();
}

function bindGlobalListeners() {
    if (listenersBound) return;
    listenersBound = true;

    onKeyDown = handleKeyDown;
    onOutsideClick = handleOutsideClick;
    onResize = handleViewportChange;
    onVisualViewportChange = handleViewportChange;

    document.addEventListener('keydown', onKeyDown, true);
    // Bubble phase: runs after the trigger button's click handler opens the menu.
    document.addEventListener('click', onOutsideClick, false);
    window.addEventListener('resize', onResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onVisualViewportChange);
    window.visualViewport?.addEventListener('scroll', onVisualViewportChange);

    const messages = document.getElementById('messages');
    if (messages) {
        const onScroll = () => {
            if (
                overlayState &&
                (overlayState.type === 'dropdown' || overlayState.type === 'context')
            ) {
                closeOverlay({ immediate: true, reason: 'scroll' });
            }
        };
        messages.addEventListener('scroll', onScroll, { passive: true });
        scrollTargets.push({ el: messages, fn: onScroll });
    }
}

export function teardownOverlayManager() {
    destroyAllOverlays('teardown');

    if (!listenersBound) return;
    listenersBound = false;

    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('click', onOutsideClick, false);
    window.removeEventListener('resize', onResize);
    window.visualViewport?.removeEventListener('resize', onVisualViewportChange);
    window.visualViewport?.removeEventListener('scroll', onVisualViewportChange);

    scrollTargets.forEach(({ el, fn }) => el.removeEventListener('scroll', fn));
    scrollTargets = [];

    onKeyDown = null;
    onOutsideClick = null;
    onResize = null;
    onVisualViewportChange = null;
}

export function initOverlayManager({ rootId = 'ui-overlay-root' } = {}) {
    rootEl = document.getElementById(rootId);
    if (!rootEl) {
        rootEl = document.createElement('div');
        rootEl.id = rootId;
        document.body.appendChild(rootEl);
    }

    bindGlobalListeners();

    if (isOverlayDebugEnabled()) {
        console.info('[overlay] debug mode enabled (ui_overlay_debug=1)');
    }
}

export function openDropdown({ menuId, anchor, targetId = null, payload = {} }) {
    const tid = targetId || menuId;
    const current = getOverlayState();
    if (current?.type === 'dropdown' && current.targetId === tid) {
        return closeOverlay({ reason: 'toggle' });
    }

    const anchorEl = typeof anchor === 'string' ? document.getElementById(anchor) : anchor;
    const anchorRect = anchorEl?.getBoundingClientRect();

    return openOverlay({
        type: 'dropdown',
        anchorRect,
        payload: { menuId, anchorId: anchorEl?.id || null, ...payload },
        targetId: tid,
    });
}

export function openContextMenu({ x, y, payload, targetId = null }) {
    return openOverlay({
        type: 'context',
        position: { x, y },
        payload,
        targetId,
    });
}

export function openPopoverOverlay({ popoverId, anchor, payload = {}, targetId = null }) {
    const anchorEl = typeof anchor === 'string' ? document.getElementById(anchor) : anchor;
    return openOverlay({
        type: 'popover',
        anchorRect: anchorEl?.getBoundingClientRect(),
        payload: { popoverId, anchorId: anchorEl?.id || null, ...payload },
        targetId: targetId || popoverId,
    });
}

export function openModalOverlay(modalId, targetId = null) {
    const current = getOverlayState();
    if (current?.type === 'modal' && current.targetId === (targetId || modalId)) {
        return closeOverlay({ reason: 'toggle' });
    }

    return openOverlay({
        type: 'modal',
        payload: { modalId },
        targetId: targetId || modalId,
    });
}
