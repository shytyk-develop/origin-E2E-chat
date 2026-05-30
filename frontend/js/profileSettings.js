// Profile Settings — identity, security, privacy, data (appearance lives in Interface Settings).

import { copyText } from './chatActions.js';
import {
    buildStorageReport,
    clearChatHistory,
    clearLocalCache,
    computeInternalUserId,
    computeKeyFingerprint,
    formatBytes,
    getAvatarHue,
    getDisplayLabel,
    getInitials,
    getStorageBreakdown,
    loadProfile,
    PROFILE_LIMITS,
    readAvatarAsDataUrl,
    saveProfile,
    sanitizeProfileText,
    validateAvatarFile,
} from './profile.js';
import { getPrivacyFlags } from './privacy.js';

const PRIVACY_HINTS = {
    showOnlineStatus: {
        on: 'Contacts see when you are online; you see their Online / Offline status.',
        off: 'Nobody sees your online status; you do not see others’ presence (solidarity).',
    },
    readReceipts: {
        on: 'Partners see read checkmarks as soon as you open their chat.',
        off: 'No read receipts are sent when you view messages.',
    },
    typingIndicators: {
        on: 'Others see when you type; you see their typing indicator.',
        off: 'Typing is not sent or shown anywhere in the app.',
    },
};

let ctx = null;
let draftProfile = null;
let avatarPreviewUrl = null;

/** Resolve elements inside the profile panel (works when portaled to overlay). */
function $p(id) {
    const panel = document.getElementById('uiProfilePanel');
    if (panel) {
        const inside = panel.querySelector(`#${CSS.escape(id)}`);
        if (inside) return inside;
    }
    return document.getElementById(id);
}

function resolveUsername() {
    const fromCtx = ctx?.getUsername?.();
    if (fromCtx) return fromCtx;
    try {
        return localStorage.getItem('auth_username') || '';
    } catch {
        return '';
    }
}

export function initProfileSettings(context) {
    ctx = context;
    bindShell();
}

export function queueProfilePanelRefresh() {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => onProfilePanelOpen());
    });
}

function bindShell() {
    const panel = document.getElementById('uiProfilePanel');
    if (!panel) return;

    if (panel.dataset.profileBound) return;
    panel.dataset.profileBound = '1';

    panel.querySelectorAll('[data-profile-nav]').forEach((btn) => {
        btn.addEventListener('click', () => setSection(btn.dataset.profileNav));
    });

    $p('uiProfileDisplayName')?.addEventListener('input', onIdentityInput);
    $p('uiProfileBio')?.addEventListener('input', onIdentityInput);

    const avatarZone = $p('uiProfileAvatarZone');
    const fileInput = $p('uiProfileAvatarInput');
    $p('uiProfileAvatarUploadBtn')?.addEventListener('click', () => fileInput?.click());
    $p('uiProfileAvatarRemoveBtn')?.addEventListener('click', removeAvatar);
    fileInput?.addEventListener('change', onAvatarFileSelected);

    if (avatarZone && fileInput) {
        avatarZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            avatarZone.classList.add('is-dragover');
        });
        avatarZone.addEventListener('dragleave', () => avatarZone.classList.remove('is-dragover'));
        avatarZone.addEventListener('drop', (e) => {
            e.preventDefault();
            avatarZone.classList.remove('is-dragover');
            const file = e.dataTransfer?.files?.[0];
            if (file) processAvatarFile(file);
        });
        avatarZone.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInput?.click();
            }
        });
    }

    $p('uiProfileDisplayName')?.addEventListener('blur', () => saveIdentity(true));
    $p('uiProfileBio')?.addEventListener('blur', () => saveIdentity(true));

    $p('uiProfileSaveBtn')?.addEventListener('click', () => saveIdentity(false));
    $p('uiProfileCopyUsername')?.addEventListener('click', copyUsername);
    $p('uiProfileCopyUserId')?.addEventListener('click', copyUserId);
    $p('uiProfileCopyFingerprint')?.addEventListener('click', copyFingerprint);

    panel.querySelectorAll('[data-pref-key]').forEach((input) => {
        input.addEventListener('change', () => {
            const key = input.dataset.prefKey;
            const value = input.type === 'checkbox' ? input.checked : input.value;
            ctx?.onPreferenceChange?.(key, value);
            updatePrivacyHints(ctx?.getPreferences?.());
        });
    });

    $p('uiProfileClearCacheBtn')?.addEventListener('click', clearDrafts);
    $p('uiProfileClearHistoryBtn')?.addEventListener('click', clearHistory);
    $p('uiProfileExportDataBtn')?.addEventListener('click', exportStorageReport);
}

export function onProfilePanelOpen() {
    const username = resolveUsername();
    draftProfile = loadProfile(username);
    avatarPreviewUrl = draftProfile.avatarDataUrl;
    setSection('identity');
    hydrateIdentity(username);
    void hydrateSecurity();
    hydratePrivacy();
    hydrateData(username);
}

function setSection(id) {
    const panel = document.getElementById('uiProfilePanel');
    if (!panel) return;

    panel.querySelectorAll('[data-profile-nav]').forEach((btn) => {
        const on = btn.dataset.profileNav === id;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-current', on ? 'page' : 'false');
    });

    panel.querySelectorAll('[data-profile-section]').forEach((section) => {
        section.classList.toggle('hidden', section.dataset.profileSection !== id);
    });
}

function hydrateIdentity(username) {
    const displayInput = $p('uiProfileDisplayName');
    const bioInput = $p('uiProfileBio');
    if (displayInput) displayInput.value = draftProfile.displayName;
    if (bioInput) bioInput.value = draftProfile.bio;

    const usernameEl = $p('uiProfileUsername');
    const copyUserBtn = $p('uiProfileCopyUsername');

    if (!username) {
        if (usernameEl) usernameEl.textContent = 'Not signed in';
        setCopyEnabled(copyUserBtn, false);
    } else {
        if (usernameEl) usernameEl.textContent = `@${username}`;
        setCopyEnabled(copyUserBtn, true);
    }

    updatePreview(username);
    updateCharCounts();
    hydrateUserId(username);
}

async function hydrateUserId(username) {
    const idEl = $p('uiProfileUserId');
    const copyBtn = $p('uiProfileCopyUserId');
    if (!idEl) return;

    if (!username) {
        idEl.textContent = 'Not available';
        setCopyEnabled(copyBtn, false);
        return;
    }

    const pub = await resolvePublicKeyJwk();
    if (!pub) {
        idEl.textContent = 'Keys not loaded';
        setCopyEnabled(copyBtn, false);
        return;
    }

    try {
        idEl.textContent = await computeInternalUserId(pub);
        idEl.dataset.raw = idEl.textContent;
        setCopyEnabled(copyBtn, true);
    } catch {
        idEl.textContent = 'Could not derive ID';
        setCopyEnabled(copyBtn, false);
    }
}

async function hydrateSecurity() {
    const fpEl = $p('uiProfileFingerprint');
    const copyFpBtn = $p('uiProfileCopyFingerprint');
    if (!fpEl) return;

    const pub = await resolvePublicKeyJwk();
    if (!pub) {
        fpEl.textContent = 'Sign in and unlock keys to view your fingerprint.';
        fpEl.dataset.raw = '';
        setCopyEnabled(copyFpBtn, false);
        return;
    }

    try {
        const fp = await computeKeyFingerprint(pub);
        fpEl.textContent = fp;
        fpEl.dataset.raw = fp.replace(/\s/g, '');
        setCopyEnabled(copyFpBtn, true);
    } catch {
        fpEl.textContent = 'Could not compute fingerprint';
        fpEl.dataset.raw = '';
        setCopyEnabled(copyFpBtn, false);
    }
}

async function resolvePublicKeyJwk() {
    let pub = ctx?.getPublicKeyJwk?.();
    if (pub) return pub;
    if (typeof ctx?.ensurePublicKeyJwk === 'function') {
        pub = await ctx.ensurePublicKeyJwk();
    }
    if (pub) return pub;

    const username = resolveUsername();
    if (!username) return null;
    try {
        const raw = localStorage.getItem(`e2e_keys_${username}`);
        if (raw) {
            const parsed = JSON.parse(raw);
            return parsed?.publicKey || null;
        }
    } catch {
        /* ignore */
    }
    return null;
}

function hydratePrivacy() {
    hydrateProfilePrivacy(ctx?.getPreferences?.());
    updatePrivacyHints(ctx?.getPreferences?.());
}

function updatePrivacyHints(preferences) {
    const flags = getPrivacyFlags(preferences);
    const panel = document.getElementById('uiProfilePanel');
    const scope = panel || document;
    scope.querySelectorAll('[data-privacy-hint]').forEach((el) => {
        const key = el.dataset.privacyHint;
        const hints = PRIVACY_HINTS[key];
        if (!hints) return;
        const on = flags[key];
        el.textContent = on ? hints.on : hints.off;
    });
}

function hydrateData(username) {
    if (!username) {
        setText('uiProfileStorageUsed', 'Sign in required');
        setText('uiProfileHistorySize', '—');
        setText('uiProfileKeysSize', '—');
        setText('uiProfileMetaSize', '—');
        setText('uiProfileMessageCount', '—');
        setText('uiProfileCachedMedia', '—');
        return;
    }

    const b = getStorageBreakdown(username);
    setText('uiProfileStorageUsed', formatBytes(b.total));
    setText('uiProfileHistorySize', formatBytes(b.history));
    setText('uiProfileKeysSize', formatBytes(b.keys));
    setText('uiProfileMetaSize', formatBytes(b.profile + b.drafts));
    setText('uiProfileMessageCount', String(b.messageCount));
    setText('uiProfileCachedMedia', `${b.chatCount} chats`);
}

function setText(id, value) {
    const el = $p(id);
    if (el) el.textContent = value;
}

function setCopyEnabled(btn, enabled) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.classList.toggle('is-disabled', !enabled);
}

function onIdentityInput() {
    draftProfile.displayName = $p('uiProfileDisplayName')?.value || '';
    draftProfile.bio = $p('uiProfileBio')?.value || '';
    updatePreview(resolveUsername());
    updateCharCounts();
}

function updateCharCounts() {
    const nameCount = $p('uiProfileNameCount');
    const bioCount = $p('uiProfileBioCount');
    const nameLen = [...(draftProfile.displayName || '')].length;
    const bioLen = [...(draftProfile.bio || '')].length;
    if (nameCount) nameCount.textContent = `${nameLen} / ${PROFILE_LIMITS.displayName}`;
    if (bioCount) bioCount.textContent = `${bioLen} / ${PROFILE_LIMITS.bio}`;
}

function updatePreview(username) {
    const label = getDisplayLabel(username, draftProfile);
    const previewName = $p('uiProfilePreviewName');
    const previewBio = $p('uiProfilePreviewBio');
    const previewInitials = $p('uiProfilePreviewInitials');
    const previewImg = $p('uiProfilePreviewImg');

    if (previewName) previewName.textContent = label;
    if (previewBio) {
        previewBio.textContent = draftProfile.bio?.trim() || 'No status set';
        previewBio.classList.toggle('is-placeholder', !draftProfile.bio?.trim());
    }

    const avatarZone = $p('uiProfileAvatarZone');
    const previewRing = $p('uiProfileAvatarPreview');
    const hue = getAvatarHue(username);
    avatarZone?.style.setProperty('--avatar-hue', String(hue));
    previewRing?.style.setProperty('--avatar-hue', String(hue));

    renderAvatar(
        avatarZone,
        $p('uiProfileAvatarInitials'),
        $p('uiProfileAvatarImg'),
        username,
        avatarPreviewUrl
    );

    if (previewInitials) previewInitials.textContent = getInitials(label);
    if (previewImg) {
        if (avatarPreviewUrl) {
            previewImg.src = avatarPreviewUrl;
            previewImg.classList.remove('hidden');
            previewInitials?.classList.add('hidden');
        } else {
            previewImg.removeAttribute('src');
            previewImg.classList.add('hidden');
            previewInitials?.classList.remove('hidden');
        }
    }
}

function renderAvatar(ringEl, initialsEl, imgEl, username, dataUrl) {
    if (!ringEl) return;
    const label = getDisplayLabel(username, draftProfile);
    ringEl.style.setProperty('--avatar-hue', String(getAvatarHue(username)));

    if (initialsEl) initialsEl.textContent = getInitials(label);
    if (imgEl) {
        if (dataUrl) {
            imgEl.src = dataUrl;
            imgEl.classList.remove('hidden');
            initialsEl?.classList.add('hidden');
        } else {
            imgEl.removeAttribute('src');
            imgEl.classList.add('hidden');
            initialsEl?.classList.remove('hidden');
        }
    }
}

async function onAvatarFileSelected(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await processAvatarFile(file);
}

async function processAvatarFile(file) {
    const check = validateAvatarFile(file);
    if (!check.ok) {
        ctx?.showToast?.(check.error, 'error');
        return;
    }
    try {
        avatarPreviewUrl = await readAvatarAsDataUrl(file);
        draftProfile.avatarDataUrl = avatarPreviewUrl;
        updatePreview(resolveUsername());
        ctx?.showToast?.('Avatar updated.', 'success');
        saveIdentity(true);
    } catch {
        ctx?.showToast?.('Could not load image.', 'error');
    }
}

function removeAvatar() {
    avatarPreviewUrl = null;
    draftProfile.avatarDataUrl = null;
    updatePreview(resolveUsername());
    saveIdentity(true);
}

function saveIdentity(silent = false) {
    const username = resolveUsername();
    if (!username) return;

    draftProfile.displayName = sanitizeProfileText(
        $p('uiProfileDisplayName')?.value || '',
        PROFILE_LIMITS.displayName
    );
    draftProfile.bio = sanitizeProfileText(
        $p('uiProfileBio')?.value || '',
        PROFILE_LIMITS.bio
    );
    draftProfile.avatarDataUrl = avatarPreviewUrl;

    saveProfile(username, draftProfile);
    ctx?.onProfileSaved?.(draftProfile);
    if (!silent) {
        ctx?.showToast?.('Profile saved.', 'success');
    }
}

function clearDrafts() {
    const username = resolveUsername();
    if (!username) return;
    const n = clearLocalCache(username);
    hydrateData(username);
    ctx?.showToast?.(n ? `Cleared ${n} draft(s).` : 'No drafts to clear.', 'success');
}

async function clearHistory() {
    const username = resolveUsername();
    if (!username) return;
    if (
        !window.confirm(
            'Delete all conversations on the server for every contact? This removes history for you and your partners and cannot be undone.'
        )
    ) {
        return;
    }
    try {
        if (typeof ctx?.onClearAllHistory === 'function') {
            await ctx.onClearAllHistory();
        } else {
            clearChatHistory(username);
        }
        hydrateData(username);
        ctx?.showToast?.('All chat history deleted.', 'success');
    } catch (err) {
        ctx?.showToast?.(err?.message || 'Could not clear chat history.', 'error');
    }
}

async function exportStorageReport() {
    const username = resolveUsername();
    if (!username) return;
    try {
        await copyText(buildStorageReport(username));
        ctx?.showToast?.('Storage report copied.', 'success');
    } catch {
        ctx?.showToast?.('Copy failed.', 'error');
    }
}

async function copyUsername() {
    const username = resolveUsername();
    if (!username) {
        ctx?.showToast?.('Not signed in.', 'error');
        return;
    }
    await copyField(username);
}

async function copyUserId() {
    const el = $p('uiProfileUserId');
    const raw = el?.dataset.raw || el?.textContent;
    await copyField(raw);
}

async function copyFingerprint() {
    const raw = $p('uiProfileFingerprint')?.dataset.raw;
    await copyField(raw);
}

async function copyField(text) {
    const value = typeof text === 'string' ? text.trim() : '';
    if (
        !value ||
        value === '—' ||
        value === 'Loading…' ||
        value.startsWith('Not ') ||
        value.startsWith('Could ') ||
        value.startsWith('Keys ') ||
        value.startsWith('Sign ')
    ) {
        ctx?.showToast?.('Nothing to copy yet.', 'error');
        return;
    }
    try {
        await copyText(value);
        ctx?.showToast?.('Copied to clipboard.', 'success');
    } catch {
        ctx?.showToast?.('Copy failed.', 'error');
    }
}

export function hydrateProfilePrivacy(preferences) {
    const prefs = preferences || ctx?.getPreferences?.() || {};
    const map = {
        showOnlineStatus: 'uiPrefShowOnline',
        readReceipts: 'uiPrefReadReceipts',
        typingIndicators: 'uiPrefTypingIndicators',
    };
    Object.entries(map).forEach(([key, id]) => {
        const el = $p(id);
        if (el) el.checked = prefs[key] !== false;
    });
}
