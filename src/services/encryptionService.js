const CryptoJS = require('crypto-js');

const SECRET_KEY = process.env.ENCRYPTION_KEY || 'MitraTukang-SuperSecret-AES256-Key-2026';

/**
 * Enkripsi data sensitif (NIK KTP / Data Pribadi) dengan AES-256 (Kepatuhan UU PDP)
 */
function encryptData(plainText) {
    if (!plainText) return null;
    return CryptoJS.AES.encrypt(plainText.toString(), SECRET_KEY).toString();
}

/**
 * Dekripsi data sensitif AES-256
 */
function decryptData(cipherText) {
    if (!cipherText) return null;
    try {
        const bytes = CryptoJS.AES.decrypt(cipherText, SECRET_KEY);
        return bytes.toString(CryptoJS.enc.Utf8);
    } catch (err) {
        return null;
    }
}

/**
 * Generate Presigned Temporary URL dengan batas kedaluwarsa 10 menit (UU PDP compliance)
 */
function generatePresignedUrl(filePath, expiresInSeconds = 600) {
    const expiresAt = Date.now() + (expiresInSeconds * 1000);
    const signaturePayload = `${filePath}:${expiresAt}:${SECRET_KEY}`;
    const token = CryptoJS.SHA256(signaturePayload).toString(CryptoJS.enc.Hex);
    return `/api/secure-media/view?path=${encodeURIComponent(filePath)}&expires=${expiresAt}&token=${token}`;
}

/**
 * Validasi Presigned URL
 */
function validatePresignedToken(filePath, expires, token) {
    if (Date.now() > parseInt(expires)) {
        return false; // Expired
    }
    const signaturePayload = `${filePath}:${expires}:${SECRET_KEY}`;
    const expectedToken = CryptoJS.SHA256(signaturePayload).toString(CryptoJS.enc.Hex);
    return expectedToken === token;
}

module.exports = {
    encryptData,
    decryptData,
    generatePresignedUrl,
    validatePresignedToken
};
