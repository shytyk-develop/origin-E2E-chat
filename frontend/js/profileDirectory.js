// Remote profile cache — display name, bio, avatar from API / WebSocket.

import { DEFAULT_PROFILE, loadProfile } from './profile.js';

const remoteCache = new Map();

export function mapApiUserProfile(user) {
    if (!user) return { ...DEFAULT_PROFILE };
    return {
        displayName: user.display_name || user.displayName || '',
        bio: user.bio || '',
        avatarDataUrl:
            typeof user.avatar_data === 'string' && user.avatar_data.startsWith('data:image/')
                ? user.avatar_data
                : typeof user.avatarDataUrl === 'string' && user.avatarDataUrl.startsWith('data:image/')
                    ? user.avatarDataUrl
                    : null,
    };
}

export function cacheRemoteProfile(username, profile) {
    if (!username || !profile) return;
    remoteCache.set(username, {
        displayName: profile.displayName || '',
        bio: profile.bio || '',
        avatarDataUrl: profile.avatarDataUrl || null,
    });
}

export function cacheRemoteProfileFromApi(username, user) {
    cacheRemoteProfile(username, mapApiUserProfile(user));
}

export function ingestUserRecords(users) {
    if (!Array.isArray(users)) return;
    users.forEach((user) => {
        if (user?.username) cacheRemoteProfileFromApi(user.username, user);
    });
}

export function resolveContactProfile(username, userHint = null, myUsername = null) {
    if (!username) return { ...DEFAULT_PROFILE };
    if (myUsername && username === myUsername) {
        return loadProfile(username);
    }
    if (
        userHint &&
        (userHint.display_name !== undefined ||
            userHint.displayName !== undefined ||
            userHint.bio !== undefined ||
            userHint.avatar_data !== undefined ||
            userHint.avatarDataUrl !== undefined)
    ) {
        const mapped = mapApiUserProfile(userHint);
        cacheRemoteProfile(username, mapped);
        return mapped;
    }
    return remoteCache.get(username) || { ...DEFAULT_PROFILE };
}

export function clearProfileDirectory() {
    remoteCache.clear();
}
