// Local profile identity — synced to server as public metadata (display name, bio, avatar).

export const PROFILE_LIMITS = {
    displayName: 32,
    bio: 140,
    avatarMaxBytes: 512 * 1024,
};

export const DEFAULT_PROFILE = {
    displayName: '',
    bio: '',
    avatarDataUrl: null,
};

const AVATAR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function profileKey(username) {
    return `originhub_profile_${username}`;
}

export function loadProfile(username) {
    if (!username) return { ...DEFAULT_PROFILE };
    try {
        const raw = localStorage.getItem(profileKey(username));
        if (!raw) return { ...DEFAULT_PROFILE };
        const saved = JSON.parse(raw);
        return {
            ...DEFAULT_PROFILE,
            displayName: sanitizeProfileText(saved.displayName, PROFILE_LIMITS.displayName),
            bio: sanitizeProfileText(saved.bio, PROFILE_LIMITS.bio),
            avatarDataUrl:
                typeof saved.avatarDataUrl === 'string' && saved.avatarDataUrl.startsWith('data:image/')
                    ? saved.avatarDataUrl
                    : null,
        };
    } catch (err) {
        console.warn('Failed to load profile:', err);
        return { ...DEFAULT_PROFILE };
    }
}

export function saveProfile(username, profile) {
    if (!username) return;
    const payload = {
        displayName: sanitizeProfileText(profile.displayName, PROFILE_LIMITS.displayName),
        bio: sanitizeProfileText(profile.bio, PROFILE_LIMITS.bio),
        avatarDataUrl: profile.avatarDataUrl || null,
    };
    localStorage.setItem(profileKey(username), JSON.stringify(payload));
}

/** Strip control chars; keep emoji/unicode; never interpret as HTML. */
export function sanitizeProfileText(value, maxLen) {
    if (typeof value !== 'string') return '';
    const cleaned = value
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim();
    return [...cleaned].slice(0, maxLen).join('');
}

export function getDisplayLabel(username, profile) {
    const name = profile?.displayName?.trim();
    return name || username || 'User';
}

export function getInitials(label) {
    if (!label) return '?';
    return label
        .split(/[\s._-]+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join('') || '?';
}

/** Render a small avatar circle inside a contact row or list item. */
export function applyContactAvatar(containerEl, username, profile) {
    if (!containerEl) return;
    const label = getDisplayLabel(username, profile);
    const hue = getAvatarHue(username);
    containerEl.style.setProperty('--avatar-hue', String(hue));
    containerEl.classList.toggle('has-photo', Boolean(profile?.avatarDataUrl));
    containerEl.replaceChildren();

    if (profile?.avatarDataUrl) {
        const img = document.createElement('img');
        img.src = profile.avatarDataUrl;
        img.alt = '';
        img.className = 'contact-avatar-img';
        img.loading = 'lazy';
        containerEl.appendChild(img);
        return;
    }

    containerEl.textContent = getInitials(label);
}

export function getAvatarHue(username) {
    let hash = 0;
    const s = username || 'user';
    for (let i = 0; i < s.length; i += 1) {
        hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
}

export async function computeKeyFingerprint(publicKeyJwk) {
    const canonical = JSON.stringify({
        kty: publicKeyJwk.kty,
        n: publicKeyJwk.n,
        e: publicKeyJwk.e,
    });
    const digest = await window.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonical)
    );
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return formatFingerprint(hex);
}

export function formatFingerprint(hex) {
    const upper = hex.toUpperCase();
    const groups = [];
    for (let i = 0; i < upper.length; i += 4) {
        groups.push(upper.slice(i, i + 4));
    }
    return groups.join(' ');
}

export async function computeInternalUserId(publicKeyJwk) {
    const digest = await window.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(publicKeyJwk))
    );
    const bytes = new Uint8Array(digest).slice(0, 8);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function validateAvatarFile(file) {
    if (!file) return { ok: false, error: 'No file selected.' };
    if (!AVATAR_MIME.has(file.type)) {
        return { ok: false, error: 'Use JPEG, PNG, or WebP.' };
    }
    if (file.size > PROFILE_LIMITS.avatarMaxBytes) {
        return { ok: false, error: 'Image must be under 512 KB.' };
    }
    return { ok: true };
}

export function readAvatarAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Failed to read image.'));
        reader.readAsDataURL(file);
    });
}

function entrySize(key, value) {
    return (key.length + (value || '').length) * 2;
}

export function estimateLocalStorageUsage(username) {
    let bytes = 0;
    let keys = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (username && !key.includes(username) && !key.startsWith('originhub_')) continue;
        bytes += entrySize(key, localStorage.getItem(key));
        keys += 1;
    }
    return { bytes, keys };
}

export function getStorageBreakdown(username) {
    const breakdown = {
        total: 0,
        history: 0,
        keys: 0,
        profile: 0,
        drafts: 0,
        prefs: 0,
        other: 0,
        messageCount: 0,
        chatCount: 0,
    };

    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        const val = localStorage.getItem(key) || '';
        const size = entrySize(key, val);
        breakdown.total += size;

        if (key === `e2e_history_${username}`) {
            breakdown.history += size;
            try {
                const hist = JSON.parse(val);
                breakdown.chatCount = Object.keys(hist).length;
                Object.values(hist).forEach((msgs) => {
                    breakdown.messageCount += (msgs || []).length;
                });
            } catch {
                /* ignore */
            }
        } else if (key === `e2e_keys_${username}`) {
            breakdown.keys += size;
        } else if (key === `originhub_profile_${username}`) {
            breakdown.profile += size;
        } else if (key.startsWith(`e2e_draft_${username}_`)) {
            breakdown.drafts += size;
        } else if (key.startsWith('originhub_')) {
            breakdown.prefs += size;
        } else if (!username || key.includes(username)) {
            breakdown.other += size;
        }
    }

    return breakdown;
}

export function buildStorageReport(username) {
    const b = getStorageBreakdown(username);
    return [
        'OriginHub local storage report',
        `User: ${username || '—'}`,
        `Total: ${formatBytes(b.total)}`,
        `Chat history: ${formatBytes(b.history)} (${b.messageCount} messages, ${b.chatCount} chats)`,
        `Keys: ${formatBytes(b.keys)}`,
        `Profile & drafts: ${formatBytes(b.profile + b.drafts)}`,
        `App preferences: ${formatBytes(b.prefs)}`,
        `Generated: ${new Date().toISOString()}`,
    ].join('\n');
}

export function clearChatHistory(username) {
    if (!username) return 0;
    const key = `e2e_history_${username}`;
    const had = localStorage.getItem(key);
    localStorage.removeItem(key);
    return had ? 1 : 0;
}

export function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function clearLocalCache(username) {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith(`e2e_draft_${username}_`)) toRemove.push(key);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    return toRemove.length;
}

export function countChatPartners(username) {
    if (!username) return 0;
    try {
        const history = JSON.parse(localStorage.getItem(`e2e_history_${username}`) || '{}');
        return Object.keys(history).length;
    } catch {
        return 0;
    }
}

export function countMessageMarkers(username) {
    if (!username) return 0;
    try {
        const history = JSON.parse(localStorage.getItem(`e2e_history_${username}`) || '{}');
        let n = 0;
        Object.values(history).forEach((msgs) => {
            (msgs || []).forEach((m) => {
                if (/\[file:/i.test(m.text || '')) n += 1;
            });
        });
        return n;
    } catch {
        return 0;
    }
}
