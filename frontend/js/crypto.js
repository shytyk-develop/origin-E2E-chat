// frontend/js/crypto.js

/** Max plaintext characters per message (hybrid RSA+AES-GCM envelope). */
export const MAX_ENCRYPTED_MESSAGE_CHARS = 2000;

const HYBRID_VERSION = 2;

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

function toUint8Array(buffer) {
    if (buffer instanceof Uint8Array) return buffer;
    return new Uint8Array(buffer);
}

function isHybridEnvelopeBytes(bytes) {
    return bytes.length > 2 && bytes[0] === 0x7b;
}

async function encryptHybrid(publicKey, textMessage) {
    const encoder = new TextEncoder();
    const plaintext = encoder.encode(textMessage);

    const aesKey = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        plaintext
    );
    const rawAesKey = await window.crypto.subtle.exportKey('raw', aesKey);
    const encryptedKey = await window.crypto.subtle.encrypt(
        { name: 'RSA-OAEP' },
        publicKey,
        rawAesKey
    );

    const envelope = {
        v: HYBRID_VERSION,
        iv: bytesToBase64(iv),
        ek: bytesToBase64(new Uint8Array(encryptedKey)),
        ct: bytesToBase64(new Uint8Array(ciphertext)),
    };

    return encoder.encode(JSON.stringify(envelope)).buffer;
}

async function decryptHybrid(privateKey, envelope) {
    const iv = base64ToBytes(envelope.iv);
    const encryptedKey = base64ToBytes(envelope.ek);
    const ciphertext = base64ToBytes(envelope.ct);

    const rawAesKey = await window.crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        encryptedKey
    );

    const aesKey = await window.crypto.subtle.importKey(
        'raw',
        rawAesKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );

    const plaintext = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        ciphertext
    );

    return new TextDecoder().decode(plaintext);
}

async function decryptLegacyRsa(privateKey, ciphertext) {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'RSA-OAEP' },
        privateKey,
        ciphertext
    );
    return new TextDecoder().decode(decryptedBuffer);
}

/* 1. Generate key pair: Public (for everyone) and Private (for us only) */
export async function generateKeyPair() {
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: 'RSA-OAEP',
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: 'SHA-256',
        },
        true,
        ['encrypt', 'decrypt']
    );

    return keyPair;
}

/* 2. Encrypt message — hybrid AES-GCM + RSA-OAEP (supports up to MAX_ENCRYPTED_MESSAGE_CHARS) */
export async function encryptMessage(publicKey, textMessage) {
    if (textMessage.length > MAX_ENCRYPTED_MESSAGE_CHARS) {
        throw new RangeError(`Message exceeds ${MAX_ENCRYPTED_MESSAGE_CHARS} characters`);
    }
    return encryptHybrid(publicKey, textMessage);
}

/* 3. Decrypt — hybrid envelope (v2) or legacy RSA-only ciphertext */
export async function decryptMessage(privateKey, encryptedBuffer) {
    const bytes = toUint8Array(encryptedBuffer);

    if (isHybridEnvelopeBytes(bytes)) {
        const envelope = JSON.parse(new TextDecoder().decode(bytes));
        if (envelope?.v === HYBRID_VERSION) {
            return decryptHybrid(privateKey, envelope);
        }
    }

    return decryptLegacyRsa(privateKey, bytes);
}

/* 4. Key Export */
export async function exportPublicKey(key) {
    return window.crypto.subtle.exportKey('jwk', key);
}

/* 5. Key Import */
export async function importPublicKey(jwkData) {
    return window.crypto.subtle.importKey(
        'jwk',
        jwkData,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt']
    );
}

export async function exportPrivateKey(key) {
    return window.crypto.subtle.exportKey('jwk', key);
}

export async function importPrivateKey(jwkData) {
    return window.crypto.subtle.importKey(
        'jwk',
        jwkData,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['decrypt']
    );
}

async function derivePasswordKey(password, saltBytes) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const baseKey = await window.crypto.subtle.importKey(
        'raw',
        passwordBuffer,
        'PBKDF2',
        false,
        ['deriveKey']
    );

    return window.crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations: 100000,
            hash: 'SHA-256',
        },
        baseKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptPrivateKeyWithPassword(privateKeyJWK, password) {
    const encoder = new TextEncoder();
    const jwkString = JSON.stringify(privateKeyJWK);
    const jwkBytes = encoder.encode(jwkString);

    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const aesKey = await derivePasswordKey(password, salt);

    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aesKey,
        jwkBytes
    );

    const bufBytes = new Uint8Array(encryptedBuffer);
    const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, '0')).join('');
    const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, '0')).join('');
    const cryptHex = Array.from(bufBytes).map((b) => b.toString(16).padStart(2, '0')).join('');

    return `${saltHex}:${ivHex}:${cryptHex}`;
}

export async function decryptPrivateKeyWithPassword(encryptedString, password) {
    const [saltHex, ivHex, cryptHex] = encryptedString.split(':');

    const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
    const cryptBytes = new Uint8Array(cryptHex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

    const aesKey = await derivePasswordKey(password, salt);

    try {
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv },
            aesKey,
            cryptBytes
        );
        const decoder = new TextDecoder();
        const jwkString = decoder.decode(decryptedBuffer);
        return JSON.parse(jwkString);
    } catch {
        throw new Error('Failed to decrypt private key. Wrong password or corrupted keys.');
    }
}
