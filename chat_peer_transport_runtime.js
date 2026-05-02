const {
  createChatTransportSessionStore,
  normalizePhase,
} = require('./chat_transport_session_store');

function normalizeString(value) {
  return String(value || '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function createChatPeerTransportRuntime(deps = {}) {
  const sessionStore = deps.sessionStore || createChatTransportSessionStore();
  const heartbeatTimeoutMs = Number.isFinite(deps.heartbeatTimeoutMs)
    ? Number(deps.heartbeatTimeoutMs)
    : 30000;

  function requireSession(sessionId) {
    const session = sessionStore.getSession(sessionId);
    if (!session) throw new Error(`Unknown chat transport session: ${normalizeString(sessionId)}`);
    return session;
  }

  function createSession(walletId, patch = {}) {
    const safeWalletId = normalizeString(walletId);
    if (!safeWalletId) throw new Error('walletId is required');
    const nextPatch = {
      ...patch,
      walletId: safeWalletId,
      phase: normalizePhase(patch.phase || 'idle'),
    };
    return sessionStore.createSession(safeWalletId, nextPatch);
  }

  function updateSession(sessionId, patch = {}) {
    const current = requireSession(sessionId);
    return sessionStore.upsertSession(current.walletId, {
      ...patch,
      sessionId: current.sessionId,
    });
  }

  function transitionSession(sessionId, phase, patch = {}) {
    return updateSession(sessionId, {
      ...patch,
      phase: normalizePhase(phase),
      manuallyDisconnected: phase === 'disconnected'
        ? patch.manuallyDisconnected === true
        : false,
    });
  }

  function beginSignaling(walletId, patch = {}) {
    return createSession(walletId, {
      ...patch,
      phase: 'signaling',
    });
  }

  function markChecking(sessionId, patch = {}) {
    return transitionSession(sessionId, 'checking', patch);
  }

  function markConnected(sessionId, patch = {}) {
    return transitionSession(sessionId, 'connected', patch);
  }

  function markDisconnected(sessionId, patch = {}) {
    return transitionSession(sessionId, 'disconnected', patch);
  }

  function markManualDisconnect(sessionId, patch = {}) {
    return markDisconnected(sessionId, {
      ...patch,
      manuallyDisconnected: true,
    });
  }

  function touchHeartbeat(sessionId, timestamp = nowIso()) {
    return updateSession(sessionId, {
      lastHeartbeatAt: timestamp,
    });
  }

  function touchMessage(sessionId, timestamp = nowIso()) {
    return updateSession(sessionId, {
      lastMessageAt: timestamp,
    });
  }

  function collectTimedOutSessions(now = Date.now()) {
    const sessions = sessionStore.listSessions();
    return sessions.filter((session) => {
      if (session.phase !== 'connected') return false;
      const lastHeartbeatAt = Date.parse(String(session.lastHeartbeatAt || ''));
      if (!Number.isFinite(lastHeartbeatAt)) return false;
      return now - lastHeartbeatAt > heartbeatTimeoutMs;
    });
  }

  function disconnectTimedOutSessions(now = Date.now()) {
    const timedOut = collectTimedOutSessions(now);
    return timedOut.map((session) => markDisconnected(session.sessionId, {
      channelState: 'closed',
      iceState: 'disconnected',
      dtlsState: 'closed',
    }));
  }

  function getDirectConnectedWalletIds() {
    const walletIds = new Set();
    for (const session of sessionStore.listSessions()) {
      if (session.phase === 'connected') walletIds.add(session.walletId);
    }
    return Array.from(walletIds.values());
  }

  return {
    sessionStore,
    createSession,
    updateSession,
    transitionSession,
    beginSignaling,
    markChecking,
    markConnected,
    markDisconnected,
    markManualDisconnect,
    touchHeartbeat,
    touchMessage,
    collectTimedOutSessions,
    disconnectTimedOutSessions,
    getDirectConnectedWalletIds,
  };
}

module.exports = {
  createChatPeerTransportRuntime,
};
