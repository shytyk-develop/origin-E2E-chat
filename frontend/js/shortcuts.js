export function registerShortcuts(actions) {
    const onKeyDown = (event) => {
        if (event.defaultPrevented) return;

        const key = event.key.toLowerCase();
        const primary = event.metaKey || event.ctrlKey;

        if (event.key === 'Escape') {
            actions.closeTransientUi?.();
            return;
        }

        if (primary && key === '/') {
            event.preventDefault();
            actions.openShortcuts?.();
            return;
        }

        if (primary && key === 'k') {
            event.preventDefault();
            actions.focusContacts?.();
            return;
        }

        if (event.altKey && key === 'm') {
            event.preventDefault();
            actions.focusComposer?.();
            return;
        }

        if (primary && event.shiftKey && key === 'f') {
            event.preventDefault();
            actions.openMessageSearch?.();
            return;
        }

        if (primary && event.shiftKey && key === 'e') {
            event.preventDefault();
            actions.exportChat?.();
            return;
        }

        if (primary && event.shiftKey && key === 'p') {
            event.preventDefault();
            actions.openProfile?.();
            return;
        }

        if (primary && event.shiftKey && key === 's') {
            event.preventDefault();
            actions.openSettings?.();
        }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
}
