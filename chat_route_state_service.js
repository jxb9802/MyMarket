function createChatRouteStateService(deps = {}) {
  const {
    buildChatServiceState,
    buildChatReadState,
    ensureChatState,
    chatConfigStore,
    normalizeChatHttpEndpoint,
  } = deps;

  function getServiceState(req, options = {}) {
    const state = buildChatServiceState(req, options);
    ensureChatState(state, req);
    return state;
  }

  function getReadState(req, options = {}) {
    const state = buildChatReadState(req, options);
    ensureChatState(state, req);
    return state;
  }

  function updateConfig(req, body = {}) {
    const state = getServiceState(req, { includeLocalState: false });
    state.chatConfig.enabled = body?.enabled !== undefined ? body.enabled === true : state.chatConfig.enabled;
    state.chatConfig.displayName = String(state.profile?.name || '').trim();
    state.chatConfig.listenPort = Math.max(1, Math.min(65535, Number(body?.listenPort || state.chatConfig.listenPort || 8787)));
    state.chatConfig.publicHost = String(body?.publicHost || state.chatConfig.publicHost || '').trim();
    state.chatConfig.publicPort = Math.max(1, Math.min(65535, Number(body?.publicPort || state.chatConfig.publicPort || state.chatConfig.listenPort)));
    state.chatConfig.allowOnchainInvite = body?.allowOnchainInvite !== undefined ? body.allowOnchainInvite === true : state.chatConfig.allowOnchainInvite;
    state.chatConfig.autoPublishEndpoint = body?.autoPublishEndpoint !== undefined ? body.autoPublishEndpoint === true : state.chatConfig.autoPublishEndpoint;
    if (!state.chatConfig.manualPeerEndpoints || typeof state.chatConfig.manualPeerEndpoints !== 'object') {
      state.chatConfig.manualPeerEndpoints = {};
    }
    if (body?.manualPeerEndpoints && typeof body.manualPeerEndpoints === 'object' && !Array.isArray(body.manualPeerEndpoints)) {
      state.chatConfig.manualPeerEndpoints = Object.fromEntries(
        Object.entries(body.manualPeerEndpoints)
          .map(([walletId, endpointLike]) => [String(walletId || '').trim(), normalizeChatHttpEndpoint(endpointLike || '')])
          .filter(([walletId, endpoint]) => walletId && walletId !== 'null' && endpoint),
      );
    }
    if (!state.chatConfig.manualPeerNames || typeof state.chatConfig.manualPeerNames !== 'object') {
      state.chatConfig.manualPeerNames = {};
    }
    if (body?.manualPeerNames && typeof body.manualPeerNames === 'object' && !Array.isArray(body.manualPeerNames)) {
      state.chatConfig.manualPeerNames = Object.fromEntries(
        Object.entries(body.manualPeerNames)
          .map(([walletId, name]) => [String(walletId || '').trim(), String(name || '').trim()])
          .filter(([walletId, name]) => walletId && walletId !== 'null' && name),
      );
    }
    if (body?.manualDisconnects && typeof body.manualDisconnects === 'object' && !Array.isArray(body.manualDisconnects)) {
      state.chatConfig.manualDisconnects = Object.fromEntries(
        Object.entries(body.manualDisconnects)
          .map(([walletId, disconnected]) => [String(walletId || '').trim(), disconnected === true])
          .filter(([walletId]) => walletId && walletId !== 'null'),
      );
    }
    state.chatConfig = chatConfigStore.saveChatConfigSnapshot(state.chatConfig);
    return state.chatConfig;
  }

  function setPeerEndpoint(req, walletId, endpointLike) {
    const state = getServiceState(req, { includeLocalState: false });
    const endpoint = normalizeChatHttpEndpoint(endpointLike || '');
    if (!state.chatConfig.manualPeerEndpoints || typeof state.chatConfig.manualPeerEndpoints !== 'object') {
      state.chatConfig.manualPeerEndpoints = {};
    }
    if (!endpoint) {
      delete state.chatConfig.manualPeerEndpoints[walletId];
      chatConfigStore.updateChatConfig((config) => {
        delete config.manualPeerEndpoints[walletId];
      });
    } else {
      state.chatConfig.manualPeerEndpoints[walletId] = endpoint;
      chatConfigStore.updateChatConfig((config) => {
        config.manualPeerEndpoints[walletId] = endpoint;
      });
    }
    return {
      walletId,
      endpoint,
      manualPeerEndpoints: state.chatConfig.manualPeerEndpoints,
    };
  }

  return {
    getServiceState,
    getReadState,
    updateConfig,
    setPeerEndpoint,
  };
}

module.exports = {
  createChatRouteStateService,
};
