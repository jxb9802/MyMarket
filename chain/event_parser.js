'use strict';

const CHAIN_MARKER_PREFIX = 'BMMKT2|';

function parseBmmkt2AnchorText(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith(CHAIN_MARKER_PREFIX)) return null;
  const secondBar = raw.indexOf('|', CHAIN_MARKER_PREFIX.length);
  if (secondBar < 0) return null;
  const eventType = raw.slice(CHAIN_MARKER_PREFIX.length, secondBar).trim();
  const payloadRaw = raw.slice(secondBar + 1).trim();
  if (!eventType || !payloadRaw) return null;
  let payload;
  try {
    payload = JSON.parse(payloadRaw);
  } catch (_) {
    return null;
  }
  return {
    marker: 'BMMKT2',
    eventType,
    payload,
  };
}

module.exports = {
  parseBmmkt2AnchorText,
};
