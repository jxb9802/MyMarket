const crypto = require('crypto');

const PROTOCOL_NAME = 'bsv-market-p2p-probe';
const PROTOCOL_VERSION = 1;

function isoNow() {
  return new Date().toISOString();
}

function randomId(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeWalletId(value) {
  return String(value || '').trim();
}

function normalizeDeviceId(value, walletId = '') {
  const explicit = String(value || '').trim();
  if (explicit) return explicit;
  return `${normalizeWalletId(walletId) || 'device'}-${crypto.randomUUID()}`;
}

function makeEnvelope(type, payload = {}, meta = {}) {
  return {
    protocol: PROTOCOL_NAME,
    version: PROTOCOL_VERSION,
    type: String(type || '').trim(),
    packetId: String(meta.packetId || randomId('pkt')),
    ts: String(meta.ts || isoNow()),
    ...payload,
  };
}

function validateEnvelope(envelope, expectedType = '') {
  if (!envelope || typeof envelope !== 'object') {
    throw new Error('packet must be an object');
  }
  if (String(envelope.protocol || '') !== PROTOCOL_NAME) {
    throw new Error('protocol mismatch');
  }
  if (Number(envelope.version || 0) !== PROTOCOL_VERSION) {
    throw new Error('protocol version mismatch');
  }
  const type = String(envelope.type || '').trim();
  if (!type) throw new Error('packet type is required');
  if (expectedType && type !== expectedType) {
    throw new Error(`packet type mismatch: expected ${expectedType}, got ${type}`);
  }
  return envelope;
}

function httpBaseToWsUrl(baseUrl, path = '/p2p/ws') {
  const url = new URL(String(baseUrl || ''));
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = path;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function baseUrlToOriginParts(baseUrl) {
  const url = new URL(String(baseUrl || ''));
  return {
    protocol: url.protocol,
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)),
    origin: url.origin,
  };
}

module.exports = {
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  isoNow,
  randomId,
  normalizeWalletId,
  normalizeDeviceId,
  makeEnvelope,
  validateEnvelope,
  httpBaseToWsUrl,
  baseUrlToOriginParts,
};
