const STORAGE_KEY = 'originhub_ui_preferences';

export const DEFAULT_PREFERENCES = {
    enterToSend: true,
    compactMode: false,
    showTimestamps: true,
    theme: 'system', // 'light' | 'dark' | 'system'
    glassIntensity: 'medium', // 'low' | 'medium' | 'high'
    showOnlineStatus: true,
    readReceipts: true,
    typingIndicators: true,
    profileVisible: true,
    linkPreviews: true,
};

let systemThemeListener = null;

function resolveThemePreference(theme) {
    if (theme === 'light' || theme === 'dark') return theme;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(themePreference) {
    const resolved = resolveThemePreference(themePreference);
    document.documentElement.setAttribute('data-theme', resolved);
}

function bindSystemThemeListener(themePreference) {
    if (systemThemeListener) {
        window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', systemThemeListener);
        systemThemeListener = null;
    }

    if (themePreference !== 'system') return;

    systemThemeListener = () => applyTheme('system');
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', systemThemeListener);
}

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
    applyTheme(preferences.theme);
    bindSystemThemeListener(preferences.theme);

    const glass = preferences.glassIntensity || 'medium';
    document.documentElement.dataset.glass = glass;
}

export function updatePreference(preferences, key, value) {
    const next = { ...preferences, [key]: value };
    savePreferences(next);
    applyPreferences(next);
    return next;
}

