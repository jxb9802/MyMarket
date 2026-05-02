function makeProtocolError(code, message, details = null) {
  const err = new Error(String(message || code || 'Protocol error'));
  err.code = String(code || 'PROTOCOL_ERROR').trim();
  if (details && typeof details === 'object') err.details = details;
  return err;
}

module.exports = {
  makeProtocolError,
};
