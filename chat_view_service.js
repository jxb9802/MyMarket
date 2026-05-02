function createChatViewService(deps = {}) {
  const {
    CHAT_MODULE_ENABLED,
    ensureChatState,
    ensureSelfChatIdentity,
    getSendPreviewForWallet,
    getPreferredPeerChatPubKey,
    chatDomain,
    getChatSelfStateSnapshot,
    normalizeEventPayload,
    verifyWalletKeyBindPayload,
    getEffectiveAnchorRows,
    ensureCurrentMerchantId,
    queueLocalChange,
    getSessionPassword,
    wallet,
  } = deps;

  async function getChatDomainPreview(state, _req, walletId) {
    if (!CHAT_MODULE_ENABLED) {
      return {
        walletId: String(walletId || ''),
        presenceStatus: 'disabled',
        transport: 'disabled',
        requiresFeeConfirm: false,
        directConnected: false,
        connecting: false,
        feeSat: 0,
        hasPeerPubKey: false,
      };
    }
    const preview = {
      walletId: String(walletId || ''),
      ...getSendPreviewForWallet(state, walletId),
      hasPeerPubKey: Boolean(getPreferredPeerChatPubKey(state, walletId)),
    };
    return {
      walletId: String(walletId || ''),
      presenceStatus: preview.directConnected
        ? 'chatable'
        : (preview.connecting ? 'connecting' : 'offline'),
      transport: String(preview.transport || 'onchain'),
      requiresFeeConfirm: preview.requiresFeeConfirm !== false,
      directConnected: preview.directConnected === true,
      connecting: preview.connecting === true,
      feeSat: Math.max(0, Number(preview.feeSat || 0)),
      hasPeerPubKey: preview.hasPeerPubKey === true,
    };
  }

  async function getChatRelationSnapshot(state, req, walletId) {
    const self = ensureSelfChatIdentity(state, req);
    const contacts = await chatDomain.getContacts(String(self.walletId || ''));
    return (Array.isArray(contacts) ? contacts : []).find((row) => String(row?.peerWalletId || '') === String(walletId || '')) || {
      selfWalletId: String(self.walletId || ''),
      peerWalletId: String(walletId || ''),
      isFriend: false,
      friendStatus: 'none',
      blocked: false,
    };
  }

  function getChatRelationSnapshotFast(state, req, walletId) {
    ensureChatState(state, req);
    const self = ensureSelfChatIdentity(state, req);
    const normalizedWalletId = String(walletId || '').trim();
    const thread = normalizedWalletId && state?.chatThreads?.[normalizedWalletId] && typeof state.chatThreads[normalizedWalletId] === 'object'
      ? state.chatThreads[normalizedWalletId]
      : null;
    return {
      selfWalletId: String(self.walletId || ''),
      peerWalletId: normalizedWalletId,
      isFriend: thread?.isFriend === true,
      friendStatus: String(thread?.friendStatus || 'none'),
      blocked: thread?.blocked === true,
    };
  }

  async function emitChatSelfStateChanged(state, req, patch = {}) {
    const self = ensureSelfChatIdentity(state, req);
    const current = await getChatSelfStateSnapshot(state, req);
    return chatDomain.emitChatEvent('chat.self.status.changed', {
      selfWalletId: String(self.walletId || ''),
      online: patch.online !== undefined ? patch.online === true : current.online,
      storageLimitBytes: Math.max(1024, Number(patch.storageLimitBytes || current.storageLimitBytes || 104857600)),
    }, {
      producer: 'chat_api',
      entityType: 'chat_self_state',
      entityId: String(self.walletId || ''),
    });
  }

  function searchChatProfiles(state, req, query = '') {
    const self = ensureSelfChatIdentity(state, req);
    const q = String(query || '').trim().toLowerCase();
    const profiles = state.chatDiscovery?.profiles && typeof state.chatDiscovery.profiles === 'object'
      ? state.chatDiscovery.profiles
      : {};
    return Object.values(profiles)
      .filter((row) => {
        const walletId = String(row?.walletId || '').trim();
        if (!walletId || walletId === String(self.walletId || '').trim()) return false;
        const merchantId = String(row?.merchantId || '').trim();
        if (!merchantId && !walletId) return false;
        if (!q) return true;
        return walletId.toLowerCase().includes(q) || merchantId.toLowerCase().includes(q);
      })
      .slice(0, 20)
      .map((row) => ({
        walletId: String(row?.walletId || ''),
        merchantId: String(row?.merchantId || ''),
        displayName: String(row?.displayName || row?.name || row?.merchantId || row?.walletId || ''),
        verified: row?.verified === true,
      }));
  }

  function hasPendingProfileSetChange(state) {
    const queue = Array.isArray(state?.localChanges?.queue) ? state.localChanges.queue : [];
    return queue.some((item) => {
      const eventType = String(item?.eventType || '').trim();
      const status = String(item?.status || '').trim();
      return eventType === 'profile_set'
        && ['pending', 'queued', 'broadcasted'].includes(status || 'pending')
        && String(item?.targetType || '') === 'profile'
        && String(item?.targetId || '') === 'buyer';
    });
  }

  function hasVerifiedCurrentSelfChatBinding(state, req = null) {
    ensureChatState(state, req);
    const self = ensureSelfChatIdentity(state, req);
    const selfWalletId = String(self.walletId || '').trim();
    const selfChatPubKey = String(self.chatPubKey || '').trim();
    if (!selfWalletId || !/^[0-9a-f]{66}$/i.test(selfChatPubKey)) return false;
    const rows = getEffectiveAnchorRows(state, { sqlite: { eventTypes: ['wallet_key_bind'] } });
    return rows.some((row) => {
      if (String(row?.eventType || '').trim() !== 'wallet_key_bind') return false;
      const payload = normalizeEventPayload('wallet_key_bind', row?.payload || {}, String(row?.ts || ''));
      return String(payload.walletId || '').trim() === selfWalletId
        && String(payload.chatPubKey || '').trim() === selfChatPubKey
        && verifyWalletKeyBindPayload(payload);
    });
  }

  function hasPendingSelfChatBindingChange(state, req = null) {
    ensureChatState(state, req);
    const self = ensureSelfChatIdentity(state, req);
    const selfWalletId = String(self.walletId || '').trim();
    const selfChatPubKey = String(self.chatPubKey || '').trim();
    if (!selfWalletId || !selfChatPubKey) return false;
    const queue = Array.isArray(state?.localChanges?.queue) ? state.localChanges.queue : [];
    return queue.some((item) => {
      const eventType = String(item?.eventType || '').trim();
      const status = String(item?.status || '').trim();
      if (eventType !== 'wallet_key_bind') return false;
      if (!['pending', 'queued', 'broadcasted'].includes(status || 'pending')) return false;
      const payload = normalizeEventPayload('wallet_key_bind', item?.payload || {}, String(item?.ts || ''));
      return String(payload.walletId || '').trim() === selfWalletId
        && String(payload.chatPubKey || '').trim() === selfChatPubKey
        && verifyWalletKeyBindPayload(payload);
    });
  }

  function hasCurrentProfileSetOnChain(state, req = null) {
    const currentMerchantId = ensureCurrentMerchantId(state, req || {});
    const rows = getEffectiveAnchorRows(state, { sqlite: { eventTypes: ['profile_set'] } });
    return rows.some((row) => {
      if (String(row?.eventType || '').trim() !== 'profile_set') return false;
      const payload = normalizeEventPayload('profile_set', row?.payload || {}, String(row?.ts || ''));
      return String(payload.merchantId || '').trim() === String(currentMerchantId || '').trim();
    });
  }

  function queueSelfChatBindingChange(state, req = null) {
    ensureChatState(state, req);
    const self = ensureSelfChatIdentity(state, req);
    const selfWalletId = String(self.walletId || '').trim();
    const selfChatPubKey = String(self.chatPubKey || '').trim();
    if (!selfWalletId || !selfChatPubKey) return null;
    const endpointHints = state.chatConfig.publicHost
      ? [`${state.chatConfig.publicHost}:${Number(state.chatConfig.publicPort || state.chatConfig.listenPort || 8787)}`]
      : [];
    const relayHints = [];
    const queuedChange = queueLocalChange(state, 'wallet_key_bind', {
      walletId: self.walletId,
      merchantId: self.merchantId,
      chatPubKey: self.chatPubKey,
      endpointHints,
      relayHints,
    }, 'chat', self.walletId);
    if (!queuedChange) return null;
    const createdAt = String(queuedChange?.payload?._updatedAt || queuedChange?.ts || new Date().toISOString());
    let signature = '';
    try {
      const mnemonic = wallet.getMnemonicFromPassword(getSessionPassword(req));
      signature = wallet.signWalletKeyBind({
        mnemonic,
        walletId: self.walletId,
        merchantId: self.merchantId,
        chatPubKey: self.chatPubKey,
        endpointHints,
        relayHints,
        createdAt,
      });
    } catch (_) {
      return null;
    }
    queuedChange.payload.signature = signature;
    queuedChange.payload.createdAt = createdAt;
    state.chatIdentity.self.lastPublishedAt = createdAt;
    return queuedChange;
  }

  function prepareLegacyWalletProfileMigration(state, req = null) {
    ensureChatState(state, req);
    const hasBoundSelf = hasVerifiedCurrentSelfChatBinding(state, req);
    let hasPendingChatBind = hasPendingSelfChatBindingChange(state, req);
    const hasProfileOnChain = hasCurrentProfileSetOnChain(state, req);
    const syncReady = Boolean(state?.sync?.online);
    let queuedChatBind = false;
    if (syncReady && !hasBoundSelf && !hasPendingChatBind) {
      const bindChange = queueSelfChatBindingChange(state, req);
      if (bindChange) {
        queuedChatBind = true;
        hasPendingChatBind = true;
      }
    }
    state.chatUi.needsProfilePublish = !hasBoundSelf;
    state.chatUi.legacyProfileReanchorQueued = queuedChatBind;
    state.chatUi.migrationNotice = !hasBoundSelf
      ? (hasPendingChatBind
        ? 'chat_profile_publish_queued'
        : (queuedChatBind
          ? 'chat_profile_auto_publish_queued'
          : 'chat_publish_required'))
      : '';
    return {
      hasBoundSelf,
      hasProfileOnChain,
      queued: queuedChatBind,
      queuedProfile: false,
      queuedChatBind,
      notice: String(state.chatUi.migrationNotice || ''),
    };
  }

  return {
    getChatDomainPreview,
    getChatRelationSnapshot,
    getChatRelationSnapshotFast,
    emitChatSelfStateChanged,
    searchChatProfiles,
    hasPendingProfileSetChange,
    hasPendingSelfChatBindingChange,
    queueSelfChatBindingChange,
    hasCurrentProfileSetOnChain,
    hasVerifiedCurrentSelfChatBinding,
    prepareLegacyWalletProfileMigration,
  };
}

module.exports = {
  createChatViewService,
};
