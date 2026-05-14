// frontend/js/crypto.js

/* 1. Generate key pair: Public (for everyone) and Private (for us only) */
async function generateKeyPair() {
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
async function encryptMessage(publicKey, textMessage) {
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
async function decryptMessage(privateKey, encryptedBuffer) {
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
async function exportPublicKey(key) {
    const exportedKey = await window.crypto.subtle.exportKey(
        "jwk", // JSON Web Key format
        key
    );
    return exportedKey; 
}

/* 5. Key Import: converting the received JSON back into a CryptoKey (to use for encryption) */
async function importPublicKey(jwkData) {
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


/* 
Test run (Sandbox)
async function runCryptoTest() {
    console.log("--- CRYPTOGRAPHY TEST START ---");
    
    // 1. Generate keys
    const bobKeys = await generateKeyPair();

    // 2. User "A" writes a message and encrypts it with "B"'s public key
    const originalText = "Hello";
    console.log("Original:", originalText);
    
    const encryptedData = await encryptMessage(bobKeys.publicKey, originalText);
    console.log("To the server, it looks like this:", new Uint8Array(encryptedData)); 

    // 3. "B" receives message and decrypts it with private key
    const decryptedText = await decryptMessage(bobKeys.privateKey, encryptedData);
    
    console.log("--- TEST END ---");
}

// Run the test when file loads
runCryptoTest(); 
*/