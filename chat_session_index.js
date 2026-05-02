function createChatSessionIndex(deps = {}) {
  const {
    runtimeStore,
    getPreferredPeerEndpoint,
    getPreferredPeerChatPubKey,
    isPeerManuallyDisconnected,
  } = deps;

  function summarizeConnectionState(state, walletId, req = null) {
    const sessions = runtimeStore.listSessionsByWalletId(state, walletId, req);
    const effectiveEndpoint = String(getPreferredPeerEndpoint(state, walletId) || '').trim();
    const directConnected = Boolean(effectiveEndpoint) && sessions.some((row) => String(row?.state || '') === 'connected');
    const connecting = !directConnected && sessions.some((row) => {
      const safeState = String(row?.state || '');
      return safeState === 'connecting' || safeState === 'handshaking' || safeState === 'retrying';
    });
    const hasPeerPubKey = Boolean(getPreferredPeerChatPubKey(state, walletId));
    const manuallyDisconnected = isPeerManuallyDisconnected(state, walletId);
    const canAttemptDirect = !manuallyDisconnected && Boolean(effectiveEndpoint) && hasPeerPubKey;
    const activeSession = sessions.find((row) => (
      ['connected', 'handshaking', 'connecting', 'retrying'].includes(String(row?.state || ''))
    )) || sessions[0] || null;
    return {
      walletId: String(walletId || '').trim(),
      directConnected,
      connecting,
      hasPeerPubKey,
      manuallyDisconnected,
      canAttemptDirect,
      preferredEndpoint: effectiveEndpoint,
      activeSessionId: String(activeSession?.sessionId || ''),
    };
  }

  function buildStatusPayload(state, walletId, fallbackAllowed = true, req = null) {
    const summary = summarizeConnectionState(state, walletId, req);
    return {
      walletId: summary.walletId,
      directConnected: summary.directConnected,
      connecting: summary.connecting,
      fallbackAllowed: fallbackAllowed === true,
      sessionId: summary.activeSessionId,
      hasPeerPubKey: summary.hasPeerPubKey,
      preferredEndpoint: summary.preferredEndpoint,
    };
  }

  return {
    summarizeConnectionState,
    buildStatusPayload,
  };
}

module.exports = {
  createChatSessionIndex,
};
