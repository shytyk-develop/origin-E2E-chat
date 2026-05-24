const DEBUG_KEY = 'ui_overlay_debug';

export function isOverlayDebugEnabled() {
    try {
        return localStorage.getItem(DEBUG_KEY) === '1';
    } catch {
        return false;
    }
}

export function overlayDebug(event, data) {
    if (!isOverlayDebugEnabled()) return;
    console.log(`[overlay:${event}]`, data);
}
