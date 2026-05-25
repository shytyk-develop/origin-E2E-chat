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
        on: 'Contacts see Online / Offline in the chat header and sidebar.',
        off: 'Presence is hidden — header shows “End-to-end encrypted” only.',
    },
    readReceipts: {
        on: 'Read status is sent to partners when you open a chat.',
        off: 'No read receipts are sent when you view messages.',
    },
    typingIndicators: {
        on: 'Others see when you type; you see their typing indicator.',
        off: 'Typing is not sent or shown anywhere in the app.',
    },
    profileVisible: {
        on: 'Your display name is shown on this device (future: shared with contacts).',
        off: 'Sidebar shows “Private profile” instead of your display name.',
    },
    linkPreviews: {
        on: 'Links in messages are clickable with a security notice.',
        off: 'Links appear as plain text without warnings or click-through.',
    },
};

let ctx = null;
let draftProfile = null;
let avatarPreviewUrl = null;

export function initProfileSettings(context) {
    ctx = context;
    bindShell();
}

function bindShell() {
    const panel = document.getElementById('uiProfilePanel');
    if (!panel) return;

    panel.querySelectorAll('[data-profile-nav]').forEach((btn) => {
        btn.addEventListener('click', () => setSection(btn.dataset.profileNav));
    });

    document.getElementById('uiProfileDisplayName')?.addEventListener('input', onIdentityInput);
    document.getElementById('uiProfileBio')?.addEventListener('input', onIdentityInput);

    const avatarZone = document.getElementById('uiProfileAvatarZone');
    const fileInput = document.getElementById('uiProfileAvatarInput');
    document.getElementById('uiProfileAvatarUploadBtn')?.addEventListener('click', () => fileInput?.click());
    document.getElementById('uiProfileAvatarRemoveBtn')?.addEventListener('click', removeAvatar);
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

    document.getElementById('uiProfileDisplayName')?.addEventListener('blur', () => saveIdentity(true));
    document.getElementById('uiProfileBio')?.addEventListener('blur', () => saveIdentity(true));

    document.getElementById('uiProfileSaveBtn')?.addEventListener('click', () => saveIdentity(false));
    document.getElementById('uiProfileCopyUsername')?.addEventListener('click', copyUsername);
    document.getElementById('uiProfileCopyUserId')?.addEventListener('click', copyUserId);
    document.getElementById('uiProfileCopyFingerprint')?.addEventListener('click', copyFingerprint);

    panel.querySelectorAll('[data-pref-key]').forEach((input) => {
        input.addEventListener('change', () => {
            const key = input.dataset.prefKey;
            const value = input.type === 'checkbox' ? input.checked : input.value;
            ctx?.onPreferenceChange?.(key, value);
            updatePrivacyHints(ctx?.getPreferences?.());
        });
    });

    document.getElementById('uiProfileClearCacheBtn')?.addEventListener('click', clearDrafts);
    document.getElementById('uiProfileClearHistoryBtn')?.addEventListener('click', clearHistory);
    document.getElementById('uiProfileExportDataBtn')?.addEventListener('click', exportStorageReport);
}

export function onProfilePanelOpen() {
    if (!ctx) return;
    const username = ctx.getUsername?.();
    draftProfile = loadProfile(username);
    avatarPreviewUrl = draftProfile.avatarDataUrl;
    setSection('identity');
    hydrateIdentity(username);
    hydrateSecurity();
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
    const displayInput = document.getElementById('uiProfileDisplayName');
    const bioInput = document.getElementById('uiProfileBio');
    if (displayInput) displayInput.value = draftProfile.displayName;
    if (bioInput) bioInput.value = draftProfile.bio;

    const usernameEl = document.getElementById('uiProfileUsername');
    const copyUserBtn = document.getElementById('uiProfileCopyUsername');

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
    const idEl = document.getElementById('uiProfileUserId');
    const copyBtn = document.getElementById('uiProfileCopyUserId');
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
    const fpEl = document.getElementById('uiProfileFingerprint');
    const copyFpBtn = document.getElementById('uiProfileCopyFingerprint');
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
    return pub || null;
}

function hydratePrivacy() {
    hydrateProfilePrivacy(ctx?.getPreferences?.());
    updatePrivacyHints(ctx?.getPreferences?.());
}

function updatePrivacyHints(preferences) {
    const flags = getPrivacyFlags(preferences);
    document.querySelectorAll('[data-privacy-hint]').forEach((el) => {
        const key = el.dataset.privacyHint;
        const hints = PRIVACY_HINTS[key];
        if (!hints) return;
        const on = flags[key];
        el.textContent = on ? hints.on : hints.off;
    });
}

function hydrateData(username) {
    if (!username) {
        setText('uiProfileStorageUsed', '—');
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
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setCopyEnabled(btn, enabled) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.classList.toggle('is-disabled', !enabled);
}

function onIdentityInput() {
    draftProfile.displayName = document.getElementById('uiProfileDisplayName')?.value || '';
    draftProfile.bio = document.getElementById('uiProfileBio')?.value || '';
    updatePreview(ctx?.getUsername?.());
    updateCharCounts();
}

function updateCharCounts() {
    const nameCount = document.getElementById('uiProfileNameCount');
    const bioCount = document.getElementById('uiProfileBioCount');
    const nameLen = [...(draftProfile.displayName || '')].length;
    const bioLen = [...(draftProfile.bio || '')].length;
    if (nameCount) nameCount.textContent = `${nameLen} / ${PROFILE_LIMITS.displayName}`;
    if (bioCount) bioCount.textContent = `${bioLen} / ${PROFILE_LIMITS.bio}`;
}

function updatePreview(username) {
    const label = getDisplayLabel(username, draftProfile);
    const previewName = document.getElementById('uiProfilePreviewName');
    const previewBio = document.getElementById('uiProfilePreviewBio');
    const previewInitials = document.getElementById('uiProfilePreviewInitials');
    const previewImg = document.getElementById('uiProfilePreviewImg');

    if (previewName) previewName.textContent = label;
    if (previewBio) {
        previewBio.textContent = draftProfile.bio?.trim() || 'No status set';
        previewBio.classList.toggle('is-placeholder', !draftProfile.bio?.trim());
    }

    const avatarZone = document.getElementById('uiProfileAvatarZone');
    const previewRing = document.getElementById('uiProfileAvatarPreview');
    const hue = getAvatarHue(username);
    avatarZone?.style.setProperty('--avatar-hue', String(hue));
    previewRing?.style.setProperty('--avatar-hue', String(hue));

    renderAvatar(
        avatarZone,
        document.getElementById('uiProfileAvatarInitials'),
        document.getElementById('uiProfileAvatarImg'),
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
        updatePreview(ctx?.getUsername?.());
        ctx?.showToast?.('Avatar updated — saved locally.', 'success');
        saveIdentity(true);
    } catch {
        ctx?.showToast?.('Could not load image.', 'error');
    }
}

function removeAvatar() {
    avatarPreviewUrl = null;
    draftProfile.avatarDataUrl = null;
    updatePreview(ctx?.getUsername?.());
    saveIdentity(true);
}

function saveIdentity(silent = false) {
    const username = ctx?.getUsername?.();
    if (!username) return;

    draftProfile.displayName = sanitizeProfileText(
        document.getElementById('uiProfileDisplayName')?.value || '',
        PROFILE_LIMITS.displayName
    );
    draftProfile.bio = sanitizeProfileText(
        document.getElementById('uiProfileBio')?.value || '',
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
    const username = ctx?.getUsername?.();
    if (!username) return;
    const n = clearLocalCache(username);
    hydrateData(username);
    ctx?.showToast?.(n ? `Cleared ${n} draft(s).` : 'No drafts to clear.', 'success');
}

function clearHistory() {
    const username = ctx?.getUsername?.();
    if (!username) return;
    if (!window.confirm('Delete all local chat history for this account? Messages cannot be restored from this device.')) {
        return;
    }
    clearChatHistory(username);
    ctx?.onHistoryCleared?.();
    hydrateData(username);
    ctx?.showToast?.('Local chat history cleared.', 'success');
}

async function exportStorageReport() {
    const username = ctx?.getUsername?.();
    if (!username) return;
    try {
        await copyText(buildStorageReport(username));
        ctx?.showToast?.('Storage report copied.', 'success');
    } catch {
        ctx?.showToast?.('Copy failed.', 'error');
    }
}

async function copyUsername() {
    const username = ctx?.getUsername?.();
    if (!username) {
        ctx?.showToast?.('Not signed in.', 'error');
        return;
    }
    await copyField(username);
}

async function copyUserId() {
    const raw = document.getElementById('uiProfileUserId')?.dataset.raw
        || document.getElementById('uiProfileUserId')?.textContent;
    await copyField(raw);
}

async function copyFingerprint() {
    const raw = document.getElementById('uiProfileFingerprint')?.dataset.raw;
    await copyField(raw);
}

async function copyField(text) {
    const value = typeof text === 'string' ? text.trim() : '';
    if (!value || value === '—' || value.startsWith('Not ') || value.startsWith('Could ') || value.startsWith('Keys ') || value.startsWith('Sign ')) {
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
        profileVisible: 'uiPrefProfileVisible',
        linkPreviews: 'uiPrefLinkPreviews',
    };
    Object.entries(map).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.checked = prefs[key] !== false;
    });
}
