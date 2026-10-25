const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET || 'cab_booking_super_secret_key_secure_2026';

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken(payload) {
    const data = JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 });
    const b64 = Buffer.from(data).toString('base64url');
    const signature = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
    return `${b64}.${signature}`;
}

function verifyToken(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [b64, signature] = parts;
    const expected = crypto.createHmac('sha256', SECRET).update(b64).digest('base64url');
    if (signature !== expected) return null;
    try {
        const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
        if (payload.exp && Date.now() > payload.exp) return null;
        return payload;
    } catch {
        return null;
    }
}

function parseAuthHeader(req) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return null;
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return null;
    return verifyToken(match[1]);
}

module.exports = {
    hashPassword,
    generateToken,
    verifyToken,
    parseAuthHeader
};
