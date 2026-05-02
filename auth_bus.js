function createAuthBus() {
  function buildMessage(type, snapshot, extra = {}) {
    return {
      type: String(type || 'auth.snapshot'),
      snapshot: snapshot && typeof snapshot === 'object' ? { ...snapshot } : {},
      ...extra,
    };
  }

  function sendToTarget(target, type, snapshot, extra = {}) {
    if (!target || target.killed || target.connected === false || typeof target.send !== 'function') return false;
    try {
      target.send(buildMessage(type, snapshot, extra));
      return true;
    } catch (_) {
      return false;
    }
  }

  function broadcast(targets = [], type, snapshot, extra = {}) {
    return (Array.isArray(targets) ? targets : [])
      .map((target) => sendToTarget(target, type, snapshot, extra))
      .some(Boolean);
  }

  return {
    buildMessage,
    sendToTarget,
    broadcast,
  };
}

module.exports = {
  createAuthBus,
};
