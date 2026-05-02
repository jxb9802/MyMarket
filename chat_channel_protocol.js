const FRAME_TYPES = new Set([
  'chat.control.open',
  'chat.control.ack',
  'chat.control.disconnect',
  'chat.control.ping',
  'chat.control.pong',
  'chat.message.send',
  'chat.message.delivered',
  'chat.message.failed',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function validateChannelFrame(frame = {}) {
  const type = normalizeString(frame.type);
  if (!FRAME_TYPES.has(type)) {
    throw new Error(`Unsupported chat channel frame type: ${type || '<empty>'}`);
  }
  const channel = type.startsWith('chat.control.') ? 'control' : 'message';
  return {
    version: 1,
    type,
    channel,
    sessionId: normalizeString(frame.sessionId),
    messageId: normalizeString(frame.messageId),
    createdAt: normalizeString(frame.createdAt) || new Date().toISOString(),
    payload: frame.payload && typeof frame.payload === 'object'
      ? { ...frame.payload }
      : {},
  };
}

function serializeChannelFrame(frame = {}) {
  return JSON.stringify(validateChannelFrame(frame));
}

function deserializeChannelFrame(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input;
  try {
    return validateChannelFrame(parsed);
  } catch (_) {
    return null;
  }
}

module.exports = {
  FRAME_TYPES,
  validateChannelFrame,
  serializeChannelFrame,
  deserializeChannelFrame,
};
