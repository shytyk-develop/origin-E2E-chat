// frontend/js/crypto.js

/* 1. Generate key pair: Public (for everyone) and Private (for us only) */
export async function generateKeyPair() {
    const keyPair = await window.crypto.subtle.generateKey(
        {
            name: "RSA-OAEP", // Standard asymmetric encryption algorithm
            modulusLength: 2048, // Secure key length
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256", // Hashing algorithm
        },
        true, // Allow key export (to send public key to server)
        ["encrypt", "decrypt"] // Purpose of the keys
    );
    
    console.log("✅ Keys successfully generated!", keyPair);
    return keyPair;
}

/* 2. Encrypt message (Using the recipient's PUBLIC key) */
export async function encryptMessage(publicKey, textMessage) {
    // Convert plain text into a byte array
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(textMessage);

    // Encrypt
    const encryptedBuffer = await window.crypto.subtle.encrypt(
        {
            name: "RSA-OAEP"
        },
        publicKey,
        encodedData
    );

    console.log("🔒 Message encrypted!");
    return encryptedBuffer;
}

/* 3. Decrypt a message (Using our own PRIVATE key) */
export async function decryptMessage(privateKey, encryptedBuffer) {
    // Decrypt
    const decryptedBuffer = await window.crypto.subtle.decrypt(
        {
            name: "RSA-OAEP"
        },
        privateKey,
        encryptedBuffer
    );

    // Convert bytes back into readable text
    const decoder = new TextDecoder();
    const textMessage = decoder.decode(decryptedBuffer);

    console.log("🔓 Message decrypted:", textMessage);
    return textMessage;
}

/* 4. Key Export: converting CryptoKey into a standard JSON (to send it over the network) */
export async function exportPublicKey(key) {
    const exportedKey = await window.crypto.subtle.exportKey(
        "jwk", // JSON Web Key format
        key
    );
    return exportedKey; 
}

/* 5. Key Import: converting the received JSON back into a CryptoKey (to use for encryption) */
export async function importPublicKey(jwkData) {
    const importedKey = await window.crypto.subtle.importKey(
        "jwk",
        jwkData,
        {
            name: "RSA-OAEP",
            hash: "SHA-256"
        },
        true,
        ["encrypt"]
    );
    return importedKey;
}

/* 6. Export PRIVATE key into a JWK JSON */
export async function exportPrivateKey(key) {
    const exportedKey = await window.crypto.subtle.exportKey(
        "jwk",
        key
    );
    return exportedKey;
}

/* 7. Import PRIVATE key from a JWK JSON back into a CryptoKey */
export async function importPrivateKey(jwkData) {
    return await window.crypto.subtle.importKey(
        "jwk",
        jwkData,
        {
            name: "RSA-OAEP",
            hash: "SHA-256"
        },
        true, // Allow usage for decryption
        ["decrypt"]
    );
}

// =======================================================
// NEW BLOCK: SYMMETRIC PASSWORD-BASED PRIVATE KEY ENCRYPTION
// =======================================================

/**
 * Derives a secure 256-bit AES key from a plain text password using PBKDF2
 */
async function derivePasswordKey(password, saltBytes) {
    const encoder = new TextEncoder();
    const passwordBuffer = encoder.encode(password);

    const baseKey = await window.crypto.subtle.importKey(
        "raw",
        passwordBuffer,
        "PBKDF2",
        false,
        ["deriveKey"]
    );

    return await window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt: saltBytes,
            iterations: 100000, 
            hash: "SHA-256"
        },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * Encrypts the client's JWK private key using AES-GCM derived from their password
 */
export async function encryptPrivateKeyWithPassword(privateKeyJWK, password) {
    const encoder = new TextEncoder();
    const jwkString = JSON.stringify(privateKeyJWK);
    const jwkBytes = encoder.encode(jwkString);

    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    const aesKey = await derivePasswordKey(password, salt);

    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        aesKey,
        jwkBytes
    );

    const bufBytes = new Uint8Array(encryptedBuffer);
    const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
    const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('');
    const cryptHex = Array.from(bufBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    return `${saltHex}:${ivHex}:${cryptHex}`;
}

/**
 * Decrypts a hex-encoded cipher string back into a functional JWK private key object
 */
export async function decryptPrivateKeyWithPassword(encryptedString, password) {
    const [saltHex, ivHex, cryptHex] = encryptedString.split(':');
    
    const salt = new Uint8Array(saltHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    const cryptBytes = new Uint8Array(cryptHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

    const aesKey = await derivePasswordKey(password, salt);

    try {
        const decryptedBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: iv },
            aesKey,
            cryptBytes
        );
        const decoder = new TextDecoder();
        const jwkString = decoder.decode(decryptedBuffer);
        return JSON.parse(jwkString);
    } catch (e) {
        throw new Error("Failed to decrypt private key. Wrong password or corrupted keys.");
    }
}