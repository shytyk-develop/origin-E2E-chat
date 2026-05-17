export const API_URL = "https://originhub.onrender.com";

export function normalizeUsername(value) {
    return value.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function isValidUsername(username) {
    return /^[a-z0-9_]{3,32}$/.test(username);
}

export function usernamePolicyText() {
    return "Username must be 3-32 chars: lowercase English letters, digits, and underscore only.";
}

export async function loginRequest(username, password) {
    return postJson('/api/login', { username, password });
}

export async function registerRequest({ username, password, publicKey, encryptedPrivateKey }) {
    return postJson('/api/register', {
        username,
        password,
        public_key: publicKey,
        encrypted_private_key: encryptedPrivateKey
    });
}

export async function getChats(token, limit = 50) {
    return getJson(`/api/chats?limit=${limit}`, token);
}

export async function searchUsers(token, query, limit = 20) {
    if (query.length < 2) return [];
    return getJson(`/api/users/search?q=${encodeURIComponent(query)}&limit=${limit}`, token);
}

export async function getUser(token, username) {
    return getJson(`/api/users/${encodeURIComponent(username)}`, token);
}

export async function getHistory(token, user, partner, limit = 50, offset = 0) {
    return getJson(
        `/api/history?user=${encodeURIComponent(user)}&partner=${encodeURIComponent(partner)}&limit=${limit}&offset=${offset}`,
        token
    );
}

export async function deleteMessage(token, messageId) {
    return deleteJson(`/api/history/message/${encodeURIComponent(messageId)}`, token);
}

export async function deleteConversation(token, partner) {
    return deleteJson(`/api/history/conversation/${encodeURIComponent(partner)}`, token);
}

async function postJson(path, payload) {
    const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    return parseJsonResponse(res);
}

async function getJson(path, token) {
    const res = await fetch(`${API_URL}${path}`, {
        headers: authHeaders(token)
    });

    return parseJsonResponse(res);
}

async function deleteJson(path, token) {
    const res = await fetch(`${API_URL}${path}`, {
        method: 'DELETE',
        headers: authHeaders(token)
    });

    return parseJsonResponse(res);
}

function authHeaders(token) {
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJsonResponse(res) {
    const payload = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(payload.detail || payload.message || 'Request failed');
    }

    return payload;
}
