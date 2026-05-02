function createChatSessionRuntime(deps = {}) {
  const {
    crypto,
    ensureChatState,
    ensureChatThread,
    mapPresenceStatusLabel,
    rebuildChatUiSummary,
    normalizeChatHttpEndpoint,
    getPreferredPeerEndpoint,
    getRuntimeProjectionStateSnapshot,
    buildRuntimeAuthReq,
    commitChatRuntimeState,
    appendMarketDebug,
  } = deps;

  const getRuntimeReq = typeof buildRuntimeAuthReq === 'function'
    ? buildRuntimeAuthReq
    : deps.buildRuntimeWalletReq;

  function buildChatSessionId(walletId) {
    return `chat-${String(walletId || '').trim()}-${crypto.randomUUID()}`;
  }

  function upsertChatSession(state, walletId, patch = {}) {
    ensureChatState(state);
    const explicit = String(patch.sessionId || '').trim();
    const sessionId = explicit || buildChatSessionId(walletId);
    if (!state.chatSessions[sessionId] || typeof state.chatSessions[sessionId] !== 'object') {
      state.chatSessions[sessionId] = {
        sessionId,
        walletId: String(walletId || ''),
        peerPubKey: '',
        peerEndpoint: '',
        state: 'idle',
        transportPreference: 'p2p',
        lastHandshakeAt: '',
        lastPingAt: '',
        lastPongAt: '',
        lastConnectedAt: '',
        lastFailedAt: '',
        failureCount: 0,
      };
    }
    Object.assign(state.chatSessions[sessionId], patch || {});
    const thread = ensureChatThread(state, walletId);
    if (thread && !thread.activeSessionId) thread.activeSessionId = sessionId;
    return state.chatSessions[sessionId];
  }

  function findChatSession(state, walletId, sessionId = '') {
    ensureChatState(state);
    const normalizedWalletId = String(walletId || '').trim();
    const normalizedSessionId = String(sessionId || '').trim();
    if (normalizedSessionId && state.chatSessions?.[normalizedSessionId]) {
      return state.chatSessions[normalizedSessionId];
    }
    const thread = state.chatThreads?.[normalizedWalletId];
    if (thread?.activeSessionId && state.chatSessions?.[thread.activeSessionId]) {
      return state.chatSessions[thread.activeSessionId];
    }
    return Object.values(state.chatSessions || {}).find((session) => String(session?.walletId || '').trim() === normalizedWalletId) || null;
  }

  function applyRuntimeChatSessionStatus(state, walletId, status, patch = {}) {
    ensureChatState(state);
    const normalizedWalletId = String(walletId || '').trim();
    if (!normalizedWalletId) return null;
    const normalizedStatus = String(status || '').trim().toLowerCase() || 'idle';
    const peerEndpoint = normalizeChatHttpEndpoint(
      patch.peerEndpoint
      || getPreferredPeerEndpoint(state, normalizedWalletId)
      || '',
    );
    const session = upsertChatSession(state, normalizedWalletId, {
      sessionId: String(patch.sessionId || '').trim(),
      peerPubKey: String(patch.peerPubKey || ''),
      peerEndpoint,
      state: normalizedStatus,
      lastHandshakeAt: String(patch.lastHandshakeAt || ''),
      lastPingAt: String(patch.lastPingAt || ''),
      lastPongAt: String(patch.lastPongAt || ''),
      lastConnectedAt: String(patch.lastConnectedAt || ''),
      lastFailedAt: String(patch.lastFailedAt || ''),
      failureCount: Math.max(0, Number(patch.failureCount || 0)),
    });
    const thread = ensureChatThread(state, normalizedWalletId, {
      displayName: String(patch.displayName || normalizedWalletId),
    });
    if (thread) {
      thread.directConnected = normalizedStatus === 'connected';
      thread.connecting = normalizedStatus === 'connecting'
        || normalizedStatus === 'handshaking'
        || normalizedStatus === 'retrying';
      thread.presenceStatus = thread.directConnected ? 'chatable' : (thread.connecting ? 'connecting' : 'offline');
      thread.statusLabel = mapPresenceStatusLabel(thread.presenceStatus, thread);
      thread.activeSessionId = String(session?.sessionId || thread.activeSessionId || '');
    }
    rebuildChatUiSummary(state);
    return session;
  }

  function commitRuntimeChatSessionStatus(walletId, status, patch = {}, meta = {}) {
    const runtimeState = getRuntimeProjectionStateSnapshot(getRuntimeReq());
    if (!runtimeState) return null;
    const previous = findChatSession(runtimeState, walletId, patch?.sessionId);
    const session = applyRuntimeChatSessionStatus(runtimeState, walletId, status, patch);
    if (!session) return null;
    const normalizedStatus = String(status || '').trim().toLowerCase() || 'idle';
    const displayName = String(patch.displayName || '').trim();
    const peerEndpoint = normalizeChatHttpEndpoint(
      patch.peerEndpoint
      || getPreferredPeerEndpoint(runtimeState, String(walletId || '').trim())
      || '',
    );
    const peerPubKey = String(patch.peerPubKey || '').trim();
    const failureCount = Math.max(0, Number(patch.failureCount || 0));
    const changed = !previous
      || String(previous.state || '') !== normalizedStatus
      || String(previous.sessionId || '') !== String(session.sessionId || '')
      || String(previous.peerEndpoint || '') !== peerEndpoint
      || String(previous.peerPubKey || '') !== peerPubKey
      || Number(previous.failureCount || 0) !== failureCount
      || (displayName && String(runtimeState.chatThreads?.[String(walletId || '').trim()]?.displayName || '') !== displayName);
    if (!changed) return session;
    commitChatRuntimeState(runtimeState, {
      writeJson: false,
      refresh: false,
      reason: String(meta.reason || `runtime_chat_session:${String(status || '').trim() || 'updated'}`),
    });
    appendMarketDebug('runtime_chat_session_applied', {
      walletId: String(walletId || ''),
      sessionId: String(session.sessionId || ''),
      status: String(status || ''),
      reason: String(meta.reason || `runtime_chat_session:${String(status || '').trim() || 'updated'}`),
    });
    return session;
  }

  function commitRuntimeChatSessionHeartbeat(walletId, patch = {}, meta = {}) {
    const runtimeState = getRuntimeProjectionStateSnapshot(getRuntimeReq());
    if (!runtimeState) return null;
    ensureChatState(runtimeState);
    const normalizedWalletId = String(walletId || '').trim();
    if (!normalizedWalletId) return null;
    const existing = findChatSession(runtimeState, normalizedWalletId, patch?.sessionId);
    const session = existing || upsertChatSession(runtimeState, normalizedWalletId, {
      sessionId: String(patch.sessionId || '').trim(),
      peerEndpoint: normalizeChatHttpEndpoint(
        patch.peerEndpoint
        || getPreferredPeerEndpoint(runtimeState, normalizedWalletId)
        || '',
      ),
      state: 'connected',
    });
    let changed = false;
    const nextValues = {
      peerEndpoint: normalizeChatHttpEndpoint(
        patch.peerEndpoint
        || session.peerEndpoint
        || getPreferredPeerEndpoint(runtimeState, normalizedWalletId)
        || '',
      ),
      lastPingAt: String(patch.lastPingAt || ''),
      lastPongAt: String(patch.lastPongAt || ''),
      lastConnectedAt: String(patch.lastConnectedAt || patch.lastSeenAt || ''),
    };
    if (String(session.state || '') !== 'connected') {
      session.state = 'connected';
      changed = true;
    }
    Object.entries(nextValues).forEach(([key, value]) => {
      if (value && String(session[key] || '') !== value) {
        session[key] = value;
        changed = true;
      }
    });
    const thread = ensureChatThread(runtimeState, normalizedWalletId);
    if (thread && !thread.activeSessionId && session?.sessionId) {
      thread.activeSessionId = String(session.sessionId || '');
      changed = true;
    }
    if (!changed) return session;
    commitChatRuntimeState(runtimeState, {
      writeJson: false,
      refresh: false,
      reason: String(meta.reason || 'chat_transport_v2:heartbeat'),
    });
    appendMarketDebug('runtime_chat_session_heartbeat', {
      walletId: normalizedWalletId,
      sessionId: String(session.sessionId || ''),
      reason: String(meta.reason || 'chat_transport_v2:heartbeat'),
    });
    return session;
  }

  function commitRuntimeChatDisconnected(walletId, meta = {}) {
    const runtimeState = getRuntimeProjectionStateSnapshot(getRuntimeReq());
    if (!runtimeState) return false;
    ensureChatState(runtimeState, getRuntimeReq());
    const normalizedWalletId = String(walletId || '').trim();
    if (!normalizedWalletId) return false;
    let changed = false;
    for (const session of Object.values(runtimeState.chatSessions || {})) {
      if (String(session?.walletId || '').trim() !== normalizedWalletId) continue;
      session.state = 'idle';
      session.lastHandshakeAt = '';
      session.lastPingAt = '';
      session.lastPongAt = '';
      session.lastConnectedAt = '';
      session.lastFailedAt = '';
      session.failureCount = 0;
      changed = true;
    }
    const thread = ensureChatThread(runtimeState, normalizedWalletId);
    if (thread) {
      thread.directConnected = false;
      thread.connecting = false;
      thread.presenceStatus = 'offline';
      thread.statusLabel = mapPresenceStatusLabel('offline', thread);
      changed = true;
    }
    if (!changed) return false;
    rebuildChatUiSummary(runtimeState);
    commitChatRuntimeState(runtimeState, {
      writeJson: false,
      refresh: false,
      reason: String(meta.reason || 'chat_disconnect_requested'),
    });
    appendMarketDebug('runtime_chat_disconnected', {
      walletId: normalizedWalletId,
      reason: String(meta.reason || 'chat_disconnect_requested'),
    });
    return true;
  }

  return {
    buildChatSessionId,
    upsertChatSession,
    findChatSession,
    applyRuntimeChatSessionStatus,
    commitRuntimeChatSessionHeartbeat,
    commitRuntimeChatSessionStatus,
    commitRuntimeChatDisconnected,
  };
}

module.exports = {
  createChatSessionRuntime,
};
