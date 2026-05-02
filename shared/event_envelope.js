function makeEnvelope(topic, payload, options = {}) {
  return {
    topic: String(topic || '').trim(),
    requestId: String(options.requestId || '').trim(),
    source: String(options.source || '').trim(),
    target: String(options.target || '').trim(),
    ts: Number(options.ts || Date.now()),
    payload: payload && typeof payload === 'object' ? payload : {},
  };
}

function assertEnvelope(value) {
  const envelope = value && typeof value === 'object' ? value : null;
  if (!envelope || !String(envelope.topic || '').trim()) {
    const err = new Error('Invalid event envelope');
    err.code = 'INVALID_EVENT_ENVELOPE';
    throw err;
  }
  return envelope;
}

module.exports = {
  makeEnvelope,
  assertEnvelope,
};
