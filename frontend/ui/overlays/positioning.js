// Viewport-safe fixed positioning (visualViewport-aware).

const DEFAULT_PAD = 8;
const DEFAULT_GAP = 6;

/**
 * @param {DOMRectReadOnly|{top:number,left:number,right:number,bottom:number,width:number,height:number}} [anchorRect]
 * @param {{x:number,y:number}} [pointer]
 * @param {{ width: number, height: number }} menuSize
 * @param {{ pad?: number, gap?: number }} [opts]
 */
export function computeOverlayPosition(anchorRect, pointer, menuSize, opts = {}) {
    const pad = opts.pad ?? DEFAULT_PAD;
    const gap = opts.gap ?? DEFAULT_GAP;
    const menuW = Math.max(menuSize.width, 1);
    const menuH = Math.max(menuSize.height, 1);

    const vv = window.visualViewport;
    const offsetLeft = vv?.offsetLeft ?? 0;
    const offsetTop = vv?.offsetTop ?? 0;
    const vw = vv?.width ?? window.innerWidth;
    const vh = vv?.height ?? window.innerHeight;
    const maxX = offsetLeft + vw - pad;
    const maxY = offsetTop + vh - pad;
    const minX = offsetLeft + pad;
    const minY = offsetTop + pad;

    let x = minX;
    let y = minY;
    let flipX = false;
    let flipY = false;
    let placement = 'default';

    if (anchorRect) {
        const belowY = anchorRect.bottom + gap;
        const aboveY = anchorRect.top - menuH - gap;
        const fitsBelow = belowY + menuH <= maxY;
        const fitsAbove = aboveY >= minY;

        if (fitsBelow) {
            y = belowY;
            placement = 'below';
        } else if (fitsAbove) {
            y = aboveY;
            flipY = true;
            placement = 'above';
        } else {
            y = clamp(belowY, minY, maxY - menuH);
            placement = 'below-clamped';
        }

        x = anchorRect.left;
        if (x + menuW > maxX) {
            x = anchorRect.right - menuW;
            flipX = true;
        }
    } else if (pointer) {
        x = pointer.x;
        y = pointer.y;
        placement = 'pointer';

        if (y + menuH > maxY && pointer.y - menuH - gap >= minY) {
            y = pointer.y - menuH - gap;
            flipY = true;
        }
        if (x + menuW > maxX && pointer.x - menuW >= minX) {
            x = pointer.x - menuW;
            flipX = true;
        }
    }

    x = clamp(x, minX, maxX - menuW);
    y = clamp(y, minY, maxY - menuH);

    return Object.freeze({
        x: Math.round(x),
        y: Math.round(y),
        flipX,
        flipY,
        placement,
        viewport: Object.freeze({
            offsetLeft,
            offsetTop,
            width: vw,
            height: vh,
            scale: vv?.scale ?? 1,
        }),
    });
}

export function applyOverlayPosition(el, result, { isModal = false } = {}) {
    if (isModal) {
        el.style.left = '50%';
        el.style.top = '50%';
        el.style.transformOrigin = 'center center';
        return;
    }

    el.style.left = `${result.x}px`;
    el.style.top = `${result.y}px`;

    if (result.flipY && result.flipX) {
        el.style.transformOrigin = 'bottom right';
    } else if (result.flipY) {
        el.style.transformOrigin = 'bottom left';
    } else if (result.flipX) {
        el.style.transformOrigin = 'top right';
    } else {
        el.style.transformOrigin = 'top left';
    }
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(value, max));
}
