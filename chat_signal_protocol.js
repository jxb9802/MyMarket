const SIGNAL_TYPES = new Set([
  'chat.signal.connect_request',
  'chat.signal.offer',
  'chat.signal.answer',
  'chat.signal.reject',
  'chat.signal.cancel',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function validateSignalEnvelope(envelope = {}) {
  const type = normalizeString(envelope.type);
  if (!SIGNAL_TYPES.has(type)) throw new Error(`Unsupported chat signal type: ${type || '<empty>'}`);
  const sessionId = normalizeString(envelope.sessionId);
  const fromWalletId = normalizeString(envelope.fromWalletId);
  const toWalletId = normalizeString(envelope.toWalletId);
  if (!sessionId) throw new Error('chat signal sessionId is required');
  if (!fromWalletId) throw new Error('chat signal fromWalletId is required');
  if (!toWalletId) throw new Error('chat signal toWalletId is required');
  return {
    version: 1,
    type,
    sessionId,
    fromWalletId,
    toWalletId,
    createdAt: normalizeString(envelope.createdAt) || new Date().toISOString(),
    payload: envelope.payload && typeof envelope.payload === 'object' ? { ...envelope.payload } : {},
  };
}

function serializeSignalEnvelope(envelope = {}) {
  return JSON.stringify(validateSignalEnvelope(envelope));
}

function deserializeSignalEnvelope(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  return validateSignalEnvelope(parsed);
}

module.exports = {
  SIGNAL_TYPES,
  validateSignalEnvelope,
  serializeSignalEnvelope,
  deserializeSignalEnvelope,
};
