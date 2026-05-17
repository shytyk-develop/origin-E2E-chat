// frontend/js/storage.js

// Save chat history to browser's local storage
export function saveHistory(username, history) {
    // Convert JavaScript object into a JSON string
    localStorage.setItem(`e2e_history_${username}`, JSON.stringify(history));
}

// Load history (or return an empty object if it doesn't exist yet)
export function loadHistory(username) {
    const savedData = localStorage.getItem(`e2e_history_${username}`);
    if (savedData) {
        return JSON.parse(savedData);
    }
    return {}; // If no history yet, return an empty object
}

// Save keys (already converted to JWK) to local storage
export function saveKeys(username, keysObj) {
    localStorage.setItem(`e2e_keys_${username}`, JSON.stringify(keysObj));
}

// Load the keys from local storage
export function loadKeys(username) {
    const savedKeys = localStorage.getItem(`e2e_keys_${username}`);
    return savedKeys ? JSON.parse(savedKeys) : null;
}

export function saveDraft(username, partner, text) {
    if (!username || !partner) return;
    localStorage.setItem(`e2e_draft_${username}_${partner}`, text);
}

export function loadDraft(username, partner) {
    if (!username || !partner) return '';
    return localStorage.getItem(`e2e_draft_${username}_${partner}`) || '';
}

export function clearDraft(username, partner) {
    if (!username || !partner) return;
    localStorage.removeItem(`e2e_draft_${username}_${partner}`);
}
