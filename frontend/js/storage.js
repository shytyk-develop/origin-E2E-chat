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