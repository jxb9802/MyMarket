function createChatStateBuilder(deps = {}) {
  const {
    chatConfigStore,
    getRuntimeProjectionStateSnapshot,
    trimStateToCoreDomains,
    loadJsonStateRawFast,
    defaultChatIdentity,
    defaultChatUi,
    defaultState,
    loadRegisteredChatProfilesFromSqlite,
    loadRecentChatStewardEndpoints,
    localStateDomain,
    loadProfileSnapshotFromSqlite,
    sanitizeMerchantId,
    deriveMerchantIdForSession,
    ensureChatState,
    rebuildWalletKeyBindingsFromAnchors,
    rebuildRegisteredPeerProfilesFromAnchors,
    rebuildChatUiSummary,
  } = deps;

  function mergeChatStateArtifacts(baseState, fallbackState, req = null) {
    if (!baseState || typeof baseState !== 'object' || !fallbackState || typeof fallbackState !== 'object') {
      return baseState;
    }
    ensureChatState(baseState, req);
    ensureChatState(fallbackState, req);

    const fallbackManualPeerEndpoints = fallbackState.chatConfig?.manualPeerEndpoints
      && typeof fallbackState.chatConfig.manualPeerEndpoints === 'object'
      ? fallbackState.chatConfig.manualPeerEndpoints
      : {};
    const baseManualPeerEndpoints = baseState.chatConfig?.manualPeerEndpoints
      && typeof baseState.chatConfig.manualPeerEndpoints === 'object'
      ? baseState.chatConfig.manualPeerEndpoints
      : {};
    baseState.chatConfig.manualPeerEndpoints = {
      ...fallbackManualPeerEndpoints,
      ...baseManualPeerEndpoints,
    };

    const fallbackManualDisconnects = fallbackState.chatConfig?.manualDisconnects
      && typeof fallbackState.chatConfig.manualDisconnects === 'object'
      ? fallbackState.chatConfig.manualDisconnects
      : {};
    const baseManualDisconnects = baseState.chatConfig?.manualDisconnects
      && typeof baseState.chatConfig.manualDisconnects === 'object'
      ? baseState.chatConfig.manualDisconnects
      : {};
    baseState.chatConfig.manualDisconnects = {
      ...fallbackManualDisconnects,
      ...baseManualDisconnects,
    };

    const fallbackProfiles = fallbackState.chatDiscovery?.profiles
      && typeof fallbackState.chatDiscovery.profiles === 'object'
      ? fallbackState.chatDiscovery.profiles
      : {};
    const baseProfiles = baseState.chatDiscovery?.profiles
      && typeof baseState.chatDiscovery.profiles === 'object'
      ? baseState.chatDiscovery.profiles
      : {};
    baseState.chatDiscovery.profiles = {
      ...fallbackProfiles,
      ...baseProfiles,
    };

    const fallbackInvites = fallbackState.chatDiscovery?.invites
      && typeof fallbackState.chatDiscovery.invites === 'object'
      ? fallbackState.chatDiscovery.invites
      : {};
    const baseInvites = baseState.chatDiscovery?.invites
      && typeof baseState.chatDiscovery.invites === 'object'
      ? baseState.chatDiscovery.invites
      : {};
    baseState.chatDiscovery.invites = {
      ...fallbackInvites,
      ...baseInvites,
    };

    const merchantsById = new Map();
    const addMerchant = (merchant) => {
      const id = sanitizeMerchantId(merchant?.id || '');
      if (!id) return;
      const existing = merchantsById.get(id) || {};
      merchantsById.set(id, {
        ...existing,
        ...(merchant && typeof merchant === 'object' ? merchant : {}),
        id,
      });
    };
    (Array.isArray(fallbackState.merchants) ? fallbackState.merchants : []).forEach(addMerchant);
    (Array.isArray(baseState.merchants) ? baseState.merchants : []).forEach(addMerchant);
    baseState.merchants = Array.from(merchantsById.values());

    const fallbackThreads = fallbackState.chatThreads && typeof fallbackState.chatThreads === 'object'
      ? fallbackState.chatThreads
      : {};
    const baseThreads = baseState.chatThreads && typeof baseState.chatThreads === 'object'
      ? baseState.chatThreads
      : {};
    baseState.chatThreads = {
      ...fallbackThreads,
      ...baseThreads,
    };

    const fallbackSessions = fallbackState.chatSessions && typeof fallbackState.chatSessions === 'object'
      ? fallbackState.chatSessions
      : {};
    const baseSessions = baseState.chatSessions && typeof baseState.chatSessions === 'object'
      ? baseState.chatSessions
      : {};
    baseState.chatSessions = {
      ...fallbackSessions,
      ...baseSessions,
    };

    if (
      !String(baseState.chatIdentity?.self?.chatPubKey || '').trim()
      && String(fallbackState.chatIdentity?.self?.chatPubKey || '').trim()
    ) {
      baseState.chatIdentity.self = {
        ...baseState.chatIdentity.self,
        ...fallbackState.chatIdentity.self,
      };
    }
    if (
      (!baseState.chatIdentity?.pubkeyBindings || Object.keys(baseState.chatIdentity.pubkeyBindings).length <= 0)
      && fallbackState.chatIdentity?.pubkeyBindings
      && typeof fallbackState.chatIdentity.pubkeyBindings === 'object'
    ) {
      baseState.chatIdentity.pubkeyBindings = { ...fallbackState.chatIdentity.pubkeyBindings };
    }
    if (
      (!baseState.chatIdentity?.walletKeyIndex || Object.keys(baseState.chatIdentity.walletKeyIndex).length <= 0)
      && fallbackState.chatIdentity?.walletKeyIndex
      && typeof fallbackState.chatIdentity.walletKeyIndex === 'object'
    ) {
      baseState.chatIdentity.walletKeyIndex = { ...fallbackState.chatIdentity.walletKeyIndex };
    }

    rebuildWalletKeyBindingsFromAnchors(baseState, req);
    rebuildRegisteredPeerProfilesFromAnchors(baseState, req);
    rebuildChatUiSummary(baseState);
    return baseState;
  }

  function buildChatServiceState(req = null, options = {}) {
    const storedChatConfig = chatConfigStore.loadChatConfigSnapshot();
    const runtimeState = getRuntimeProjectionStateSnapshot(req);
    if (runtimeState && typeof runtimeState === 'object') {
      const baseState = {
        ...trimStateToCoreDomains(runtimeState, req),
        chatConfig: {
          ...storedChatConfig,
        },
        chatIdentity: {
          ...defaultChatIdentity(),
          ...(runtimeState?.chatIdentity && typeof runtimeState.chatIdentity === 'object' ? runtimeState.chatIdentity : {}),
          self: {
            ...defaultChatIdentity().self,
            ...(runtimeState?.chatIdentity?.self && typeof runtimeState.chatIdentity.self === 'object'
              ? runtimeState.chatIdentity.self
              : {}),
          },
        },
        chatThreads: runtimeState?.chatThreads && typeof runtimeState.chatThreads === 'object'
          ? { ...runtimeState.chatThreads }
          : {},
        chatMessages: runtimeState?.chatMessages && typeof runtimeState.chatMessages === 'object'
          ? { ...runtimeState.chatMessages }
          : {},
        chatSessions: runtimeState?.chatSessions && typeof runtimeState.chatSessions === 'object'
          ? { ...runtimeState.chatSessions }
          : {},
        chatUi: {
          ...defaultChatUi(),
          ...(runtimeState?.chatUi && typeof runtimeState.chatUi === 'object' ? runtimeState.chatUi : {}),
        },
        chatDiscovery: {
          ...defaultState().chatDiscovery,
          ...(runtimeState?.chatDiscovery && typeof runtimeState.chatDiscovery === 'object' ? runtimeState.chatDiscovery : {}),
          profiles: runtimeState?.chatDiscovery?.profiles && typeof runtimeState.chatDiscovery.profiles === 'object'
            ? { ...runtimeState.chatDiscovery.profiles }
            : {},
          invites: runtimeState?.chatDiscovery?.invites && typeof runtimeState.chatDiscovery.invites === 'object'
            ? { ...runtimeState.chatDiscovery.invites }
            : {},
        },
        merchants: Array.isArray(runtimeState?.merchants)
          ? runtimeState.merchants.map((merchant) => ({ ...merchant }))
          : [],
        recentRawtxs: Array.isArray(runtimeState?.recentRawtxs) ? runtimeState.recentRawtxs.map((row) => ({ ...row })) : [],
        pendingAnchors: Array.isArray(runtimeState?.pendingAnchors) ? runtimeState.pendingAnchors.map((row) => ({ ...row })) : [],
        localChanges: runtimeState?.localChanges && typeof runtimeState.localChanges === 'object'
          ? {
              seq: Math.max(1, Number(runtimeState.localChanges.seq || 1)),
              queue: Array.isArray(runtimeState.localChanges.queue) ? runtimeState.localChanges.queue.map((row) => ({ ...row })) : [],
            }
          : { seq: 1, queue: [] },
      };
      const raw = loadJsonStateRawFast();
      if (raw && typeof raw === 'object') {
        const rawChatState = {
          ...baseState,
          chatConfig: {
            ...storedChatConfig,
          },
          chatIdentity: {
            ...defaultChatIdentity(),
            ...(raw.chatIdentity && typeof raw.chatIdentity === 'object' ? raw.chatIdentity : {}),
            self: {
              ...defaultChatIdentity().self,
              ...(raw?.chatIdentity?.self && typeof raw.chatIdentity.self === 'object' ? raw.chatIdentity.self : {}),
            },
          },
          chatSessions: raw?.chatSessions && typeof raw.chatSessions === 'object'
            ? raw.chatSessions
            : {},
          chatThreads: raw?.chatThreads && typeof raw.chatThreads === 'object'
            ? raw.chatThreads
            : {},
          chatDiscovery: {
            ...defaultState().chatDiscovery,
            ...(raw?.chatDiscovery && typeof raw.chatDiscovery === 'object' ? raw.chatDiscovery : {}),
            profiles: raw?.chatDiscovery?.profiles && typeof raw.chatDiscovery.profiles === 'object'
              ? { ...raw.chatDiscovery.profiles }
              : {},
            invites: raw?.chatDiscovery?.invites && typeof raw.chatDiscovery.invites === 'object'
              ? { ...raw.chatDiscovery.invites }
              : {},
          },
          merchants: Array.isArray(raw?.merchants)
            ? raw.merchants.map((merchant) => ({ ...merchant }))
            : [],
        };
        mergeChatStateArtifacts(baseState, rawChatState, req);
      }
      const sqliteChatProfiles = loadRegisteredChatProfilesFromSqlite();
      if (sqliteChatProfiles && typeof sqliteChatProfiles === 'object' && Object.keys(sqliteChatProfiles).length > 0) {
        const fallbackChatState = { ...baseState };
        fallbackChatState.chatIdentity = defaultChatIdentity();
        fallbackChatState.chatThreads = {};
        fallbackChatState.chatMessages = {};
        fallbackChatState.chatSessions = {};
        fallbackChatState.chatUi = defaultChatUi();
        fallbackChatState.chatDiscovery = { profiles: {}, invites: {} };
        fallbackChatState.chatDiscovery.profiles = {
          ...(fallbackChatState.chatDiscovery?.profiles && typeof fallbackChatState.chatDiscovery.profiles === 'object'
            ? fallbackChatState.chatDiscovery.profiles
            : {}),
          ...sqliteChatProfiles,
        };
        mergeChatStateArtifacts(baseState, fallbackChatState, req);
      }
      const stewardEndpoints = loadRecentChatStewardEndpoints();
      if (stewardEndpoints && typeof stewardEndpoints === 'object' && Object.keys(stewardEndpoints).length > 0) {
        const stewardChatState = { ...baseState };
        stewardChatState.chatIdentity = defaultChatIdentity();
        stewardChatState.chatThreads = {};
        stewardChatState.chatMessages = {};
        stewardChatState.chatSessions = {};
        stewardChatState.chatUi = defaultChatUi();
        stewardChatState.chatDiscovery = { profiles: {}, invites: {} };
        stewardChatState.chatConfig = stewardChatState.chatConfig || {};
        stewardChatState.chatConfig.manualPeerEndpoints = {
          ...(storedChatConfig?.manualPeerEndpoints && typeof storedChatConfig.manualPeerEndpoints === 'object'
            ? storedChatConfig.manualPeerEndpoints
            : {}),
          ...stewardEndpoints,
        };
        mergeChatStateArtifacts(baseState, stewardChatState, req);
      }
      if (options?.includeLocalState === true) {
        const localStateSnapshot = localStateDomain.getLocalStateSync('main');
        baseState.recentRawtxs = Array.isArray(localStateSnapshot?.recentRawtxs)
          ? localStateSnapshot.recentRawtxs.map((row) => ({ ...row }))
          : [];
        baseState.localChanges = {
          seq: Math.max(1, Number(localStateSnapshot?.seq || baseState?.localChanges?.seq || 1)),
          queue: Array.isArray(localStateSnapshot?.localChanges)
            ? localStateSnapshot.localChanges.map((row) => ({ ...row }))
            : Array.isArray(baseState?.localChanges?.queue)
              ? baseState.localChanges.queue.map((row) => ({ ...row }))
              : [],
        };
        baseState.pendingAnchors = Array.isArray(localStateSnapshot?.pendingAnchors)
          ? localStateSnapshot.pendingAnchors
            .filter((row) => row?.confirmed !== true)
            .map((row) => ({ ...row, payload: row?.payload && typeof row.payload === 'object' ? row.payload : {} }))
          : Array.isArray(baseState?.pendingAnchors)
            ? baseState.pendingAnchors.map((row) => ({ ...row, payload: row?.payload && typeof row.payload === 'object' ? row.payload : {} }))
            : [];
      }
      ensureChatState(baseState, req);
      return baseState;
    }

    const raw = loadJsonStateRawFast();
    const init = defaultState();
    const profileSnapshot = loadProfileSnapshotFromSqlite();
    const localStateSnapshot = options?.includeLocalState === true
      ? localStateDomain.getLocalStateSync('main')
      : null;
    const currentMerchantId = sanitizeMerchantId(
      (req ? deriveMerchantIdForSession(req) : '')
        || profileSnapshot?.merchantId
        || raw?.currentMerchantId
        || init.currentMerchantId,
    ) || 'm-local';
    const state = {
      ...init,
      profile: {
        ...init.profile,
        ...(profileSnapshot
          ? {
              name: String(profileSnapshot.name || init.profile?.name || ''),
              localStatus: String(profileSnapshot.localStatus || ''),
              localUpdatedAt: String(profileSnapshot.localUpdatedAt || ''),
            }
          : {}),
      },
      currentMerchantId,
      chatConfig: {
        ...storedChatConfig,
      },
      chatIdentity: {
        ...init.chatIdentity,
        ...(raw?.chatIdentity && typeof raw.chatIdentity === 'object' ? raw.chatIdentity : {}),
        self: {
          ...init.chatIdentity.self,
          ...(raw?.chatIdentity?.self && typeof raw.chatIdentity.self === 'object' ? raw.chatIdentity.self : {}),
        },
        pubkeyBindings: {},
        walletKeyIndex: {},
        conflicts: Array.isArray(raw?.chatIdentity?.conflicts) ? raw.chatIdentity.conflicts : [],
      },
      chatSessions: raw?.chatSessions && typeof raw.chatSessions === 'object'
        ? raw.chatSessions
        : {},
      chatDiscovery: {
        ...init.chatDiscovery,
        ...(raw?.chatDiscovery && typeof raw.chatDiscovery === 'object' ? raw.chatDiscovery : {}),
        profiles: raw?.chatDiscovery?.profiles && typeof raw.chatDiscovery.profiles === 'object'
          ? { ...raw.chatDiscovery.profiles }
          : {},
        invites: raw?.chatDiscovery?.invites && typeof raw.chatDiscovery.invites === 'object'
          ? { ...raw.chatDiscovery.invites }
          : {},
      },
      chatUi: {
        ...defaultChatUi(),
        ...(raw?.chatUi && typeof raw.chatUi === 'object' ? raw.chatUi : {}),
      },
      merchants: Array.isArray(raw?.merchants)
        ? raw.merchants.map((merchant) => ({ ...merchant }))
        : [],
      recentRawtxs: Array.isArray(localStateSnapshot?.recentRawtxs)
        ? localStateSnapshot.recentRawtxs.map((row) => ({ ...row }))
        : [],
      localChanges: {
        seq: Math.max(1, Number(localStateSnapshot?.seq || 1)),
        queue: Array.isArray(localStateSnapshot?.localChanges)
          ? localStateSnapshot.localChanges.map((row) => ({ ...row }))
          : [],
      },
      pendingAnchors: Array.isArray(localStateSnapshot?.pendingAnchors)
        ? localStateSnapshot.pendingAnchors
          .filter((row) => row?.confirmed !== true)
          .map((row) => ({ ...row, payload: row?.payload && typeof row.payload === 'object' ? row.payload : {} }))
        : [],
    };
    const sqliteChatProfiles = loadRegisteredChatProfilesFromSqlite();
    if (sqliteChatProfiles && typeof sqliteChatProfiles === 'object' && Object.keys(sqliteChatProfiles).length > 0) {
      state.chatDiscovery.profiles = {
        ...state.chatDiscovery.profiles,
        ...sqliteChatProfiles,
      };
    }
    ensureChatState(state, req);
    return state;
  }

  function buildChatReadState(req = null, options = {}) {
    return buildChatServiceState(req, options);
  }

  return {
    buildChatServiceState,
    buildChatReadState,
    mergeChatStateArtifacts,
  };
}

module.exports = {
  createChatStateBuilder,
};
