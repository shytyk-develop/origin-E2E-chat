const STORAGE_KEY = 'originhub_ui_preferences';

export const DEFAULT_PREFERENCES = {
    enterToSend: true,
    compactMode: false,
    showTimestamps: true
};

export function loadPreferences() {
    try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
        return { ...DEFAULT_PREFERENCES, ...(saved || {}) };
    } catch (err) {
        console.warn('Failed to load UI preferences:', err);
        return { ...DEFAULT_PREFERENCES };
    }
}

export function savePreferences(preferences) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function applyPreferences(preferences) {
    document.body.classList.toggle('ui-compact', preferences.compactMode);
    document.body.classList.toggle('ui-hide-times', !preferences.showTimestamps);
}

export function updatePreference(preferences, key, value) {
    const next = { ...preferences, [key]: value };
    savePreferences(next);
    applyPreferences(next);
    return next;
}
