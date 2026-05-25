// Privacy preferences & local mute state (client-only).

export function getPrivacyFlags(preferences = {}) {
    return {
        showOnlineStatus: preferences.showOnlineStatus !== false,
        readReceipts: preferences.readReceipts !== false,
        typingIndicators: preferences.typingIndicators !== false,
        profileVisible: preferences.profileVisible !== false,
        linkPreviews: preferences.linkPreviews !== false,
    };
}

function mutedKey(username) {
    return `originhub_muted_${username}`;
}

export function loadMutedChats(myUsername) {
    if (!myUsername) return new Set();
    try {
        const raw = JSON.parse(localStorage.getItem(mutedKey(myUsername)));
        return new Set(Array.isArray(raw) ? raw : []);
    } catch {
        return new Set();
    }
}

export function saveMutedChats(myUsername, mutedSet) {
    if (!myUsername) return;
    localStorage.setItem(mutedKey(myUsername), JSON.stringify([...mutedSet]));
}

export function isChatMuted(myUsername, partner) {
    if (!myUsername || !partner) return false;
    return loadMutedChats(myUsername).has(partner);
}

export function toggleChatMuted(myUsername, partner) {
    const set = loadMutedChats(myUsername);
    if (set.has(partner)) set.delete(partner);
    else set.add(partner);
    saveMutedChats(myUsername, set);
    return set.has(partner);
}
