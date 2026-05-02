const crypto = require('crypto');

const DEFAULT_TTL_SEC = 12 * 60 * 60;

function getSigningKey() {
  return String(process.env.SESSION_SIGNING_KEY || 'dev-session-key').trim();
}

function base64urlEncode(input) {
  return Buffer.from(input).toString('base64url');
}

function base64urlDecode(input) {
  return Buffer.from(String(input || ''), 'base64url').toString('utf8');
}

function signToken(payload, options = {}) {
  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = Math.max(60, Number(options.ttlSec || DEFAULT_TTL_SEC));
  const body = {
    sub: String(payload?.sub || '').trim(),
    role: String(payload?.role || 'user').trim(),
    iat: nowSec,
    exp: nowSec + ttlSec,
    meta: payload?.meta && typeof payload.meta === 'object' ? payload.meta : {},
  };
  const encoded = base64urlEncode(JSON.stringify(body));
  const sig = crypto.createHmac('sha256', getSigningKey()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

function verifyToken(token) {
  const raw = String(token || '').trim();
  if (!raw.includes('.')) {
    const err = new Error('Invalid session token');
    err.code = 'INVALID_SESSION_TOKEN';
    throw err;
  }
  const [encoded, sig] = raw.split('.', 2);
  const expected = crypto.createHmac('sha256', getSigningKey()).update(encoded).digest('base64url');
  if (sig !== expected) {
    const err = new Error('Session signature mismatch');
    err.code = 'INVALID_SESSION_SIGNATURE';
    throw err;
  }
  const payload = JSON.parse(base64urlDecode(encoded));
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(payload?.exp)) || Number(payload.exp) < nowSec) {
    const err = new Error('Session expired');
    err.code = 'SESSION_EXPIRED';
    throw err;
  }
  return payload;
}

function extractBearerToken(req) {
  const header = String(req?.headers?.authorization || '').trim();
  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

module.exports = {
  signToken,
  verifyToken,
  extractBearerToken,
};
