const fs = require('fs');
const path = require('path');

function createChatPeerRuntime(deps = {}) {
  const {
    chatConfigStore,
    ensureChatState,
    buildChatServiceState,
    buildRuntimeAuthReq,
    loadRegisteredChatProfilesFromSqlite,
    LOG_DIR,
  } = deps;

  const getRuntimeReq = typeof buildRuntimeAuthReq === 'function'
    ? buildRuntimeAuthReq
    : deps.buildRuntimeWalletReq;

  let endpointCache = {
    mtimeMs: 0,
    endpoints: {},
  };

  function normalizeChatHttpEndpoint(endpointLike) {
    const raw = String(endpointLike || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^[^:/\s]+:\d{1,5}$/i.test(raw)) return `http://${raw}`;
    return '';
  }

  function loadRecentChatStewardEndpoints() {
    const logFile = path.join(LOG_DIR, 'chat-steward.log');
    let st = null;
    try {
      st = fs.statSync(logFile);
    } catch (_) {
      return endpointCache.endpoints || {};
    }
    const mtimeMs = Number(st?.mtimeMs || 0);
    if (mtimeMs > 0 && mtimeMs === Number(endpointCache.mtimeMs || 0)) {
      return endpointCache.endpoints || {};
    }
    const endpoints = {};
    try {
      const maxBytes = 512 * 1024;
      const size = Math.max(0, Number(st?.size || 0));
      const start = Math.max(0, size - maxBytes);
      const fd = fs.openSync(logFile, 'r');
      try {
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, size - start, start);
        const lines = String(buf.toString('utf8') || '').split(/\r?\n/);
        for (const line of lines) {
          if (!line || line[0] !== '{') continue;
          let row = null;
          try {
            row = JSON.parse(line);
          } catch (_) {
            row = null;
          }
          if (!row || typeof row !== 'object') continue;
          const event = String(row.event || '').trim();
          if (event !== 'connect_test_connected' && event !== 'connect_test_unverified') continue;
          const walletId = String(row.walletId || '').trim();
          const host = String(row.host || '').trim();
          const port = Number(row.port || 0);
          const endpoint = normalizeChatHttpEndpoint(host && port > 0 ? `${host}:${port}` : '');
          if (!walletId || !endpoint) continue;
          endpoints[walletId] = endpoint;
        }
      } finally {
        fs.closeSync(fd);
      }
    } catch (_) {}
    endpointCache = {
      mtimeMs,
      endpoints,
    };
    return endpoints;
  }

  function isPeerManuallyDisconnected(state, walletId) {
    const normalizedWalletId = String(walletId || '').trim();
    if (!normalizedWalletId) return false;
    const manualDisconnects = chatConfigStore.loadChatConfigSnapshot()?.manualDisconnects || null;
    return Boolean(manualDisconnects && manualDisconnects[normalizedWalletId] === true);
  }

  function setPeerManualDisconnect(state, walletId, disconnected = true) {
    const normalizedWalletId = String(walletId || '').trim();
    if (!normalizedWalletId) return false;
    ensureChatState(state);
    if (!state.chatConfig.manualDisconnects || typeof state.chatConfig.manualDisconnects !== 'object') {
      state.chatConfig.manualDisconnects = {};
    }
    if (disconnected) {
      if (state.chatConfig.manualDisconnects[normalizedWalletId] === true) return false;
      state.chatConfig.manualDisconnects[normalizedWalletId] = true;
      chatConfigStore.updateChatConfig((config) => {
        config.manualDisconnects[normalizedWalletId] = true;
      });
      return true;
    }
    if (state.chatConfig.manualDisconnects[normalizedWalletId] === false) return false;
    state.chatConfig.manualDisconnects[normalizedWalletId] = false;
    chatConfigStore.updateChatConfig((config) => {
      config.manualDisconnects[normalizedWalletId] = false;
    });
    return true;
  }

  function rememberManualPeerEndpoint(state, walletId, endpoint) {
    const normalizedWalletId = String(walletId || '').trim();
    const normalizedEndpoint = normalizeChatHttpEndpoint(endpoint || '');
    if (!normalizedWalletId || !normalizedEndpoint) return false;
    ensureChatState(state);
    if (!state.chatConfig.manualPeerEndpoints || typeof state.chatConfig.manualPeerEndpoints !== 'object') {
      state.chatConfig.manualPeerEndpoints = {};
    }
    if (String(state.chatConfig.manualPeerEndpoints[normalizedWalletId] || '') === normalizedEndpoint) return false;
    state.chatConfig.manualPeerEndpoints[normalizedWalletId] = normalizedEndpoint;
    chatConfigStore.updateChatConfig((config) => {
      config.manualPeerEndpoints[normalizedWalletId] = normalizedEndpoint;
    });
    return true;
  }

  function rememberManualPeerEndpointRuntime(walletId, endpoint) {
    const tempState = buildChatServiceState(getRuntimeReq(), { includeLocalState: false });
    return rememberManualPeerEndpoint(tempState, walletId, endpoint);
  }

  function getPreferredPeerChatPubKey(state, walletId) {
    const safeWalletId = String(walletId || '').trim();
    const thread = state?.chatThreads?.[safeWalletId] || null;
    const fromThread = Array.isArray(thread?.pubkeys) ? thread.pubkeys.find((x) => /^[0-9a-f]{66}$/i.test(String(x || ''))) : '';
    if (fromThread) return String(fromThread);
    const fromProfile = Array.isArray(state?.chatDiscovery?.profiles?.[safeWalletId]?.chatPubKeys)
      ? state.chatDiscovery.profiles[safeWalletId].chatPubKeys.find((x) => /^[0-9a-f]{66}$/i.test(String(x || '')))
      : '';
    if (fromProfile) return String(fromProfile);
    const sqliteProfiles = typeof loadRegisteredChatProfilesFromSqlite === 'function'
      ? loadRegisteredChatProfilesFromSqlite()
      : {};
    const sqliteProfile = sqliteProfiles && typeof sqliteProfiles === 'object'
      ? sqliteProfiles[safeWalletId]
      : null;
    const sqlitePubKey = Array.isArray(sqliteProfile?.chatPubKeys)
      ? sqliteProfile.chatPubKeys.find((x) => /^[0-9a-f]{66}$/i.test(String(x || '')))
      : '';
    if (sqlitePubKey) {
      if (!state.chatDiscovery?.profiles || typeof state.chatDiscovery.profiles !== 'object') {
        state.chatDiscovery = state.chatDiscovery && typeof state.chatDiscovery === 'object'
          ? state.chatDiscovery
          : {};
        state.chatDiscovery.profiles = {};
      }
      state.chatDiscovery.profiles[safeWalletId] = {
        ...(state.chatDiscovery.profiles[safeWalletId] && typeof state.chatDiscovery.profiles[safeWalletId] === 'object'
          ? state.chatDiscovery.profiles[safeWalletId]
          : {}),
        ...(sqliteProfile && typeof sqliteProfile === 'object' ? sqliteProfile : {}),
        walletId: safeWalletId,
        chatPubKeys: Array.isArray(sqliteProfile?.chatPubKeys) ? sqliteProfile.chatPubKeys.filter(Boolean) : [sqlitePubKey],
      };
      return String(sqlitePubKey);
    }
    return '';
  }

  function getWalletIdForChatPubKey(state, chatPubKey) {
    ensureChatState(state);
    const key = String(chatPubKey || '').trim();
    if (!key) return '';
    const direct = String(state.chatIdentity?.pubkeyBindings?.[key]?.walletId || '').trim();
    if (direct) return direct;
    const profiles = state?.chatDiscovery?.profiles && typeof state.chatDiscovery.profiles === 'object'
      ? Object.values(state.chatDiscovery.profiles)
      : [];
    for (const profile of profiles) {
      const walletId = String(profile?.walletId || '').trim();
      if (!walletId) continue;
      const pubKeys = Array.isArray(profile?.chatPubKeys) ? profile.chatPubKeys : [];
      if (pubKeys.some((item) => String(item || '').trim() === key)) {
        return walletId;
      }
    }
    const sqliteProfiles = typeof loadRegisteredChatProfilesFromSqlite === 'function'
      ? loadRegisteredChatProfilesFromSqlite()
      : {};
    if (sqliteProfiles && typeof sqliteProfiles === 'object') {
      for (const [walletId, profile] of Object.entries(sqliteProfiles)) {
        const safeWalletId = String(walletId || '').trim();
        if (!safeWalletId) continue;
        const pubKeys = Array.isArray(profile?.chatPubKeys) ? profile.chatPubKeys : [];
        if (!pubKeys.some((item) => String(item || '').trim() === key)) continue;
        if (!state.chatIdentity?.pubkeyBindings || typeof state.chatIdentity.pubkeyBindings !== 'object') {
          state.chatIdentity.pubkeyBindings = {};
        }
        state.chatIdentity.pubkeyBindings[key] = {
          chatPubKey: key,
          walletId: safeWalletId,
          merchantId: String(profile?.merchantId || '').trim(),
          signatureOk: profile?.verified === true,
          source: 'sqlite_wallet_key_bind',
          updatedAt: String(profile?.updatedAt || ''),
        };
        if (!state.chatDiscovery?.profiles || typeof state.chatDiscovery.profiles !== 'object') {
          state.chatDiscovery = state.chatDiscovery && typeof state.chatDiscovery === 'object'
            ? state.chatDiscovery
            : {};
          state.chatDiscovery.profiles = {};
        }
        const existing = state.chatDiscovery.profiles[safeWalletId];
        state.chatDiscovery.profiles[safeWalletId] = {
          ...(existing && typeof existing === 'object' ? existing : {}),
          ...(profile && typeof profile === 'object' ? profile : {}),
          walletId: safeWalletId,
          chatPubKeys: pubKeys.filter(Boolean),
        };
        return safeWalletId;
      }
    }
    return '';
  }

  function getPreferredPeerEndpoint(state, walletId) {
    const safeWalletId = String(walletId || '').trim();
    const persistedConfig = chatConfigStore.loadChatConfigSnapshot?.() || {};
    const persistedManualEndpoint = normalizeChatHttpEndpoint(
      persistedConfig?.manualPeerEndpoints && typeof persistedConfig.manualPeerEndpoints === 'object'
        ? persistedConfig.manualPeerEndpoints[safeWalletId] || ''
        : '',
    );
    if (persistedManualEndpoint) return persistedManualEndpoint;
    const runtimeManualEndpoint = normalizeChatHttpEndpoint(
      state?.chatConfig?.manualPeerEndpoints && typeof state.chatConfig.manualPeerEndpoints === 'object'
        ? state.chatConfig.manualPeerEndpoints[safeWalletId] || ''
        : '',
    );
    if (runtimeManualEndpoint) return runtimeManualEndpoint;
    const sessionEndpoint = Object.values(state?.chatSessions || {})
      .filter((row) => String(row?.walletId || '').trim() === safeWalletId)
      .sort((a, b) => Date.parse(String(b?.lastConnectedAt || b?.lastHandshakeAt || '')) - Date.parse(String(a?.lastConnectedAt || a?.lastHandshakeAt || '')))
      .map((row) => normalizeChatHttpEndpoint(row?.peerEndpoint || ''))
      .find(Boolean) || '';
    if (sessionEndpoint) return sessionEndpoint;
    const hints = Array.isArray(state?.chatDiscovery?.profiles?.[safeWalletId]?.endpointHints)
      ? state.chatDiscovery.profiles[safeWalletId].endpointHints
      : [];
    for (const hint of hints) {
      const normalized = normalizeChatHttpEndpoint(hint);
      if (normalized) return normalized;
    }
    const stewardEndpoint = loadRecentChatStewardEndpoints()[safeWalletId] || '';
    if (stewardEndpoint) return stewardEndpoint;
    return '';
  }

  function getSendPreviewForWallet(state, walletId) {
    const sessions = Object.values(state?.chatSessions || {}).filter((row) => String(row?.walletId || '') === String(walletId || ''));
    const effectiveEndpoint = getPreferredPeerEndpoint(state, walletId);
    const directConnected = Boolean(effectiveEndpoint) && sessions.some((row) => String(row?.state || '') === 'connected');
    const connecting = !directConnected && sessions.some((row) => {
      const s = String(row?.state || '');
      return s === 'connecting' || s === 'handshaking' || s === 'retrying';
    });
    const hasEndpoint = Boolean(effectiveEndpoint);
    const hasPeerPubKey = Boolean(getPreferredPeerChatPubKey(state, walletId));
    const manuallyDisconnected = isPeerManuallyDisconnected(state, walletId);
    const canAttemptDirect = !manuallyDisconnected
      && hasEndpoint
      && hasPeerPubKey;
    return {
      transport: directConnected || canAttemptDirect ? 'p2p' : 'onchain',
      requiresFeeConfirm: !(directConnected || canAttemptDirect),
      directConnected,
      connecting,
      feeSat: directConnected || canAttemptDirect ? 0 : 12,
    };
  }

  return {
    normalizeChatHttpEndpoint,
    loadRecentChatStewardEndpoints,
    isPeerManuallyDisconnected,
    setPeerManualDisconnect,
    rememberManualPeerEndpoint,
    rememberManualPeerEndpointRuntime,
    getPreferredPeerChatPubKey,
    getWalletIdForChatPubKey,
    getPreferredPeerEndpoint,
    getSendPreviewForWallet,
  };
}

module.exports = {
  createChatPeerRuntime,
};
