const DEFAULT_PHASE = 'idle';
const PHASES = new Set([
  'idle',
  'signaling',
  'checking',
  'connected',
  'disconnected',
]);

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizePhase(phase) {
  const normalized = normalizeString(phase);
  return PHASES.has(normalized) ? normalized : DEFAULT_PHASE;
}

function normalizeIsoTimestamp(value, fallback = '') {
  const raw = normalizeString(value);
  if (!raw) return fallback;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return fallback;
  return new Date(ms).toISOString();
}

function createEmptySession(walletId, patch = {}) {
  const now = new Date().toISOString();
  const sessionId = normalizeString(patch.sessionId);
  if (!sessionId) throw new Error('sessionId is required');
  return {
    walletId: normalizeString(walletId),
    sessionId,
    phase: normalizePhase(patch.phase),
    iceState: normalizeString(patch.iceState),
    dtlsState: normalizeString(patch.dtlsState),
    channelState: normalizeString(patch.channelState),
    manuallyDisconnected: patch.manuallyDisconnected === true,
    lastHeartbeatAt: normalizeIsoTimestamp(patch.lastHeartbeatAt),
    lastMessageAt: normalizeIsoTimestamp(patch.lastMessageAt),
    createdAt: normalizeIsoTimestamp(patch.createdAt, now),
    updatedAt: normalizeIsoTimestamp(patch.updatedAt, now),
  };
}

function applySessionPatch(session, patch = {}) {
  if (!session || typeof session !== 'object') throw new Error('session is required');
  if (patch.walletId !== undefined) session.walletId = normalizeString(patch.walletId);
  if (patch.phase !== undefined) session.phase = normalizePhase(patch.phase);
  if (patch.iceState !== undefined) session.iceState = normalizeString(patch.iceState);
  if (patch.dtlsState !== undefined) session.dtlsState = normalizeString(patch.dtlsState);
  if (patch.channelState !== undefined) session.channelState = normalizeString(patch.channelState);
  if (patch.manuallyDisconnected !== undefined) session.manuallyDisconnected = patch.manuallyDisconnected === true;
  if (patch.lastHeartbeatAt !== undefined) session.lastHeartbeatAt = normalizeIsoTimestamp(patch.lastHeartbeatAt);
  if (patch.lastMessageAt !== undefined) session.lastMessageAt = normalizeIsoTimestamp(patch.lastMessageAt);
  session.updatedAt = normalizeIsoTimestamp(patch.updatedAt, new Date().toISOString());
  return session;
}

function createChatTransportSessionStore() {
  const sessions = new Map();

  function getSession(sessionId) {
    const normalized = normalizeString(sessionId);
    return normalized ? sessions.get(normalized) || null : null;
  }

  function listSessions() {
    return Array.from(sessions.values()).map((row) => ({ ...row }));
  }

  function listSessionsByWalletId(walletId) {
    const safeWalletId = normalizeString(walletId);
    if (!safeWalletId) return [];
    return listSessions().filter((row) => row.walletId === safeWalletId);
  }

  function createSession(walletId, patch = {}) {
    const session = createEmptySession(walletId, patch);
    sessions.set(session.sessionId, session);
    return { ...session };
  }

  function upsertSession(walletId, patch = {}) {
    const sessionId = normalizeString(patch.sessionId);
    if (!sessionId) throw new Error('sessionId is required');
    const current = sessions.get(sessionId);
    if (!current) return createSession(walletId, patch);
    applySessionPatch(current, { ...patch, walletId });
    return { ...current };
  }

  function removeSession(sessionId) {
    const current = getSession(sessionId);
    if (!current) return null;
    sessions.delete(current.sessionId);
    return { ...current };
  }

  function clearSessions(walletId = '') {
    const safeWalletId = normalizeString(walletId);
    if (!safeWalletId) {
      sessions.clear();
      return;
    }
    for (const row of sessions.values()) {
      if (row.walletId === safeWalletId) sessions.delete(row.sessionId);
    }
  }

  return {
    PHASES,
    normalizePhase,
    createSession,
    upsertSession,
    getSession,
    listSessions,
    listSessionsByWalletId,
    removeSession,
    clearSessions,
  };
}

module.exports = {
  DEFAULT_PHASE,
  PHASES,
  normalizePhase,
  createChatTransportSessionStore,
};
