function createChatStateCore(deps = {}) {
  const {
    chatConfigStore,
    os,
    port,
    getCurrentWalletIdentity,
    getPreferredPeerEndpoint,
  } = deps;

  function defaultChatIdentity() {
    return {
      self: {
        walletId: '',
        merchantId: '',
        chatPubKey: '',
        chatKeyVersion: 1,
        published: false,
        lastPublishedTxid: '',
        lastPublishedAt: '',
      },
      pubkeyBindings: {},
      walletKeyIndex: {},
      conflicts: [],
    };
  }

  function defaultChatUi() {
    return {
      activeWalletId: '',
      chatUnreadTotal: 0,
      buttonHasUnread: false,
      threadStatus: {},
      artifactsRefreshedAt: 0,
      needsProfilePublish: false,
      legacyProfileReanchorQueued: false,
      migrationNotice: '',
    };
  }

  function detectChatPublicHost() {
    const envHost = String(
      process.env.BSV_MARKET_CHAT_PUBLIC_HOST
      || process.env.BSV_MARKET_PUBLIC_HOST
      || '',
    ).trim();
    if (envHost) return envHost;
    try {
      const interfaces = os.networkInterfaces() || {};
      const candidates = [];
      for (const rows of Object.values(interfaces)) {
        for (const row of Array.isArray(rows) ? rows : []) {
          const family = String(row?.family || '').toLowerCase();
          const address = String(row?.address || '').trim();
          if (family !== 'ipv4' || !address || row?.internal === true) continue;
          if (
            address.startsWith('10.')
            || address.startsWith('192.168.')
            || /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
          ) {
            const penalty = (
              address.startsWith('192.168.56.')
              || address.startsWith('192.168.122.')
              || address.startsWith('172.17.')
              || address.startsWith('172.18.')
            ) ? 100 : 0;
            candidates.push({ address, penalty });
          }
        }
      }
      candidates.sort((a, b) => a.penalty - b.penalty || a.address.localeCompare(b.address));
      if (candidates[0]?.address) return candidates[0].address;
    } catch (_) {}
    return '';
  }

  function resolveChatPublicPort(state) {
    const configured = Number(state?.chatConfig?.publicPort || 0);
    if (configured > 0 && configured !== 8787) return configured;
    const marketPort = Number(process.env.BSV_MARKET_PORT || port || 8091);
    if (marketPort > 0) return marketPort;
    const listenPort = Number(state?.chatConfig?.listenPort || 0);
    return listenPort > 0 ? listenPort : 8091;
  }

  function looksLikeGeneratedChatName(value = '', walletId = '') {
    const name = String(value || '').trim();
    const peerWalletId = String(walletId || '').trim();
    if (!name) return true;
    if (peerWalletId && name === peerWalletId) return true;
    return /^wallet-[a-z0-9_-]+$/i.test(name) || /^m-[a-z0-9_-]+$/i.test(name);
  }

  function ensureChatState(state, req = null) {
    const storedChatConfig = chatConfigStore.loadChatConfigSnapshot();
    if (!state.chatConfig || typeof state.chatConfig !== 'object') state.chatConfig = storedChatConfig;
    else state.chatConfig = { ...storedChatConfig, ...state.chatConfig };
    if (!state.chatIdentity || typeof state.chatIdentity !== 'object') state.chatIdentity = defaultChatIdentity();
    if (!state.chatIdentity.self || typeof state.chatIdentity.self !== 'object') {
      state.chatIdentity.self = defaultChatIdentity().self;
    } else {
      state.chatIdentity.self = { ...defaultChatIdentity().self, ...state.chatIdentity.self };
    }
    if (!state.chatIdentity.pubkeyBindings || typeof state.chatIdentity.pubkeyBindings !== 'object') {
      state.chatIdentity.pubkeyBindings = {};
    }
    if (!state.chatIdentity.walletKeyIndex || typeof state.chatIdentity.walletKeyIndex !== 'object') {
      state.chatIdentity.walletKeyIndex = {};
    }
    if (!Array.isArray(state.chatIdentity.conflicts)) state.chatIdentity.conflicts = [];
    if (!state.chatThreads || typeof state.chatThreads !== 'object') state.chatThreads = {};
    if (!state.chatMessages || typeof state.chatMessages !== 'object') state.chatMessages = {};
    if (!state.chatSessions || typeof state.chatSessions !== 'object') state.chatSessions = {};
    if (!state.chatDiscovery || typeof state.chatDiscovery !== 'object') state.chatDiscovery = {};
    if (!state.chatDiscovery.profiles || typeof state.chatDiscovery.profiles !== 'object') state.chatDiscovery.profiles = {};
    if (!state.chatDiscovery.invites || typeof state.chatDiscovery.invites !== 'object') state.chatDiscovery.invites = {};
    if (!state.chatUi || typeof state.chatUi !== 'object') state.chatUi = defaultChatUi();
    else state.chatUi = { ...defaultChatUi(), ...state.chatUi };
    if (!state.chatUi.threadStatus || typeof state.chatUi.threadStatus !== 'object') state.chatUi.threadStatus = {};
    if (!Array.isArray(state.recentRawtxs)) state.recentRawtxs = [];

    const current = getCurrentWalletIdentity(state, req);
    if (!state.chatIdentity.self.walletId) state.chatIdentity.self.walletId = current.walletId;
    if (!state.chatIdentity.self.merchantId) state.chatIdentity.self.merchantId = current.merchantId;
    const currentPublicHost = String(state.chatConfig.publicHost || '').trim();
    if (
      !currentPublicHost
      || currentPublicHost.startsWith('192.168.56.')
      || currentPublicHost.startsWith('192.168.122.')
      || currentPublicHost.startsWith('172.17.')
      || currentPublicHost.startsWith('172.18.')
    ) {
      state.chatConfig.publicHost = detectChatPublicHost();
    }
    state.chatConfig.publicPort = resolveChatPublicPort(state);
    state.chatConfig.displayName = String(state.profile?.name || '').trim();
    return state;
  }

  function ensureChatThread(state, walletId, patch = {}) {
    ensureChatState(state);
    const key = String(walletId || '').trim();
    if (!key) return null;
    if (!state.chatThreads[key] || typeof state.chatThreads[key] !== 'object') {
      state.chatThreads[key] = {
        walletId: key,
        merchantId: '',
        displayName: key,
        pubkeys: [],
        activeSessionId: '',
        lastMessageAt: '',
        lastReadAt: '',
        unreadCount: 0,
        hasInvite: false,
        lastTransport: 'onchain',
      };
    }
    const safePatch = patch && typeof patch === 'object' ? { ...patch } : {};
    if (Object.prototype.hasOwnProperty.call(safePatch, 'displayName')) {
      const currentName = String(state.chatThreads[key].displayName || '').trim();
      const nextName = String(safePatch.displayName || '').trim();
      if (
        !nextName
        || (
          looksLikeGeneratedChatName(nextName, key)
          && currentName
          && !looksLikeGeneratedChatName(currentName, key)
        )
      ) {
        delete safePatch.displayName;
      } else {
        safePatch.displayName = nextName;
      }
    }
    Object.assign(state.chatThreads[key], safePatch);
    if (!Array.isArray(state.chatThreads[key].pubkeys)) state.chatThreads[key].pubkeys = [];
    return state.chatThreads[key];
  }

  function getThreadConnectionSummary(state, walletId) {
    const sessions = Object.values(state.chatSessions || {}).filter((row) => String(row?.walletId || '') === String(walletId || ''));
    const effectiveEndpoint = getPreferredPeerEndpoint(state, walletId);
    const connected = Boolean(effectiveEndpoint) && sessions.some((row) => String(row?.state || '') === 'connected');
    const connecting = !connected && sessions.some((row) => {
      const s = String(row?.state || '');
      return s === 'connecting' || s === 'handshaking' || s === 'retrying';
    });
    return { directConnected: connected, connecting };
  }

  function rebuildChatUiSummary(state) {
    ensureChatState(state);
    let unreadTotal = 0;
    const threadStatus = {};
    Object.keys(state.chatThreads || {}).forEach((walletId) => {
      const thread = state.chatThreads[walletId] || {};
      const unreadCount = Math.max(0, Number(thread.unreadCount || 0));
      unreadTotal += unreadCount;
      const conn = getThreadConnectionSummary(state, walletId);
      threadStatus[walletId] = {
        directConnected: conn.directConnected,
        connecting: conn.connecting,
        hasUnread: unreadCount > 0,
        unreadCount,
        canFallbackOnchain: true,
      };
    });
    state.chatUi.chatUnreadTotal = unreadTotal;
    state.chatUi.buttonHasUnread = unreadTotal > 0;
    state.chatUi.threadStatus = threadStatus;
  }

  return {
    defaultChatIdentity,
    defaultChatUi,
    detectChatPublicHost,
    resolveChatPublicPort,
    ensureChatState,
    ensureChatThread,
    getThreadConnectionSummary,
    rebuildChatUiSummary,
  };
}

module.exports = {
  createChatStateCore,
};
