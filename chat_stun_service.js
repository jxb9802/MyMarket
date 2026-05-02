const DEFAULT_PUBLIC_STUN_SERVERS = Object.freeze([
  'stun:stun.l.google.com:19302',
  'stun:global.stun.twilio.com:3478',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function createChatStunService(deps = {}) {
  const startServer = typeof deps.startServer === 'function' ? deps.startServer : null;
  const selfCheck = typeof deps.selfCheck === 'function' ? deps.selfCheck : null;

  async function startLocalStun(options = {}) {
    if (!startServer) return { started: false, options: { ...options } };
    return startServer(options);
  }

  async function runSelfCheck(options = {}) {
    if (!selfCheck) {
      return {
        ok: false,
        publicReachable: false,
        reason: 'self_check_not_implemented',
        options: { ...options },
      };
    }
    return selfCheck(options);
  }

  function canAnnounce(result = {}) {
    return result.ok === true && result.publicReachable === true;
  }

  return {
    DEFAULT_PUBLIC_STUN_SERVERS,
    startLocalStun,
    runSelfCheck,
    canAnnounce,
  };
}

module.exports = {
  DEFAULT_PUBLIC_STUN_SERVERS,
  createChatStunService,
};
