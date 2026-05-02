const {
  validateSignalEnvelope,
  serializeSignalEnvelope,
  deserializeSignalEnvelope,
} = require('./chat_signal_protocol');

function createChatSignalService(deps = {}) {
  const sendSignal = typeof deps.sendSignal === 'function' ? deps.sendSignal : null;
  const handlers = new Map();

  function registerHandler(type, handler) {
    if (typeof handler !== 'function') throw new Error('handler must be a function');
    const safeType = String(type || '').trim();
    handlers.set(safeType, handler);
    return () => handlers.delete(safeType);
  }

  async function emitSignal(envelope = {}, meta = {}) {
    const normalized = validateSignalEnvelope(envelope);
    if (sendSignal) await sendSignal(serializeSignalEnvelope(normalized), normalized, meta);
    return normalized;
  }

  async function receiveSignal(input, meta = {}) {
    const envelope = deserializeSignalEnvelope(input);
    const handler = handlers.get(envelope.type);
    if (!handler) return { handled: false, envelope, meta };
    return {
      handled: true,
      envelope,
      result: await handler(envelope, meta),
    };
  }

  return {
    registerHandler,
    emitSignal,
    receiveSignal,
  };
}

module.exports = {
  createChatSignalService,
};
