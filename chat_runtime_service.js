function createChatRuntimeService(deps = {}) {
  const {
    wallet,
    getSessionPassword,
    ensureChatState,
    getCurrentWalletIdentity,
    walletIdByMerchant,
    ensureChatThread,
    rebuildChatUiSummary,
    getThreadConnectionSummary,
    getRuntimeProjectionStateSnapshot,
    buildRuntimeAuthReq,
    commitChatRuntimeState,
    appendMarketDebug,
    chatDomain,
  } = deps;

  const getRuntimeReq = typeof buildRuntimeAuthReq === 'function'
    ? buildRuntimeAuthReq
    : deps.buildRuntimeWalletReq;

  function threadByWalletIdSafe(state, walletId) {
    return state?.chatThreads?.[String(walletId || '')] || null;
  }

  function syncChatThreadsFromUsers(state, req = null) {
    ensureChatState(state, req);
    const current = getCurrentWalletIdentity(state, req);
    (state.users || [])
      .filter((u) => String(u?.id || '') !== 'buyer')
      .forEach((u) => {
        const merchantId = String(u?.merchantId || '').trim();
        if (!merchantId) return;
        const walletId = walletIdByMerchant(merchantId);
        if (walletId === current.walletId) return;
        const thread = ensureChatThread(state, walletId, {
          merchantId,
          displayName: String(u?.name || walletId),
        });
        const pubkeys = Array.isArray(state.chatIdentity?.walletKeyIndex?.[walletId]?.pubkeys)
          ? state.chatIdentity.walletKeyIndex[walletId].pubkeys
          : [];
        thread.pubkeys = Array.isArray(thread.pubkeys) ? thread.pubkeys : [];
        pubkeys.forEach((key) => {
          if (!thread.pubkeys.includes(key)) thread.pubkeys.push(key);
        });
      });
  }

  function listChatMessagesForWallet(state, walletId) {
    return Object.values(state.chatMessages || {})
      .filter((row) => String(row?.walletId || '') === String(walletId || ''))
      .sort((a, b) => Date.parse(String(a?.ts || '')) - Date.parse(String(b?.ts || '')));
  }

  function messageTimestampMs(value = '') {
    return Date.parse(String(value || '')) || 0;
  }

  function shouldUpdateThreadLastMessage(thread, nextTs = '', msgId = '') {
    const currentMs = messageTimestampMs(thread?.lastMessageAt);
    const nextMs = messageTimestampMs(nextTs);
    if (nextMs <= 0) return currentMs <= 0;
    if (currentMs <= 0) return true;
    if (nextMs !== currentMs) return nextMs > currentMs;
    const currentId = String(thread?.lastMessageId || '').trim();
    const nextId = String(msgId || '').trim();
    return Boolean(nextId && currentId && nextId.localeCompare(currentId) > 0);
  }

  function appendChatMessage(state, messageLike = {}) {
    ensureChatState(state);
    const msgId = String(messageLike.msgId || '').trim();
    const walletId = String(messageLike.walletId || '').trim();
    if (!msgId || !walletId) return null;
    if (state.chatMessages[msgId]) {
      const existing = state.chatMessages[msgId];
      const nextStatus = String(messageLike.status || existing.status || '');
      if (existing.status !== 'visible' && (nextStatus === 'visible' || nextStatus === 'delivered')) {
        existing.status = nextStatus;
      }
      if (!existing.txid && messageLike.txid) existing.txid = String(messageLike.txid || '');
      if (!existing.ciphertext && messageLike.ciphertext) existing.ciphertext = String(messageLike.ciphertext || '');
      if (!existing.signature && messageLike.signature) existing.signature = String(messageLike.signature || '');
      if (!existing.text && messageLike.text) existing.text = String(messageLike.text || '');
      if (!existing.ts && messageLike.ts) existing.ts = String(messageLike.ts || '');
      const thread = ensureChatThread(state, walletId);
      if (thread) {
        const nextTs = String(existing.ts || messageLike.ts || '');
        const nextMsgId = String(existing.msgId || msgId || '');
        if (shouldUpdateThreadLastMessage(thread, nextTs, nextMsgId)) {
          thread.lastMessageId = nextMsgId || String(thread.lastMessageId || '');
          thread.lastMessageAt = nextTs || String(thread.lastMessageAt || '');
          thread.lastTransport = String(existing.transport || messageLike.transport || thread.lastTransport || 'onchain');
        }
      }
      rebuildChatUiSummary(state);
      return existing;
    }
    const row = {
      msgId,
      sessionId: String(messageLike.sessionId || ''),
      walletId,
      peerPubKey: String(messageLike.peerPubKey || ''),
      transport: String(messageLike.transport || 'onchain'),
      direction: String(messageLike.direction || 'out'),
      text: String(messageLike.text || ''),
      ciphertext: String(messageLike.ciphertext || ''),
      nonce: String(messageLike.nonce || ''),
      authTag: String(messageLike.authTag || ''),
      signature: String(messageLike.signature || ''),
      orderId: String(messageLike.orderId || ''),
      txid: String(messageLike.txid || ''),
      status: String(messageLike.status || 'visible'),
      ts: String(messageLike.ts || new Date().toISOString()),
      feeSat: Math.max(0, Number(messageLike.feeSat || 0)),
    };
    state.chatMessages[msgId] = row;
    const thread = ensureChatThread(state, walletId);
    if (thread) {
      if (shouldUpdateThreadLastMessage(thread, row.ts, row.msgId)) {
        thread.lastMessageId = row.msgId;
        thread.lastMessageAt = row.ts;
        thread.lastTransport = row.transport;
      }
      if (row.direction === 'in') {
        thread.unreadCount = Math.max(0, Number(thread.unreadCount || 0)) + 1;
      }
    }
    rebuildChatUiSummary(state);
    return row;
  }

  function getCurrentChatPublicKeySafe(req) {
    try {
      const mnemonic = wallet.getMnemonicFromPassword(getSessionPassword(req));
      return String(wallet.deriveChatPublicKeyFromMnemonic(mnemonic) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function ensureSelfChatIdentity(state, req) {
    ensureChatState(state, req);
    const current = getCurrentWalletIdentity(state, req);
    state.chatIdentity.self.walletId = current.walletId;
    state.chatIdentity.self.merchantId = current.merchantId;
    if (!state.chatIdentity.self.chatPubKey) {
      state.chatIdentity.self.chatPubKey = getCurrentChatPublicKeySafe(req);
    }
    const ownProfile = state.chatDiscovery?.profiles?.[current.walletId] || null;
    const ownProfilePubkeys = Array.isArray(ownProfile?.chatPubKeys)
      ? ownProfile.chatPubKeys.map((key) => String(key || '').trim()).filter(Boolean)
      : [];
    const selfPubKey = String(state.chatIdentity.self.chatPubKey || '').trim();
    if (ownProfile?.verified === true && selfPubKey && ownProfilePubkeys.includes(selfPubKey)) {
      state.chatIdentity.self.published = true;
      if (!state.chatIdentity.self.lastPublishedAt && ownProfile.updatedAt) {
        state.chatIdentity.self.lastPublishedAt = String(ownProfile.updatedAt || '');
      }
    }
    return state.chatIdentity.self;
  }

  function getSelfChatIdentity(state, req) {
    ensureChatState(state, req);
    const current = getCurrentWalletIdentity(state, req);
    const existing = state?.chatIdentity?.self && typeof state.chatIdentity.self === 'object'
      ? state.chatIdentity.self
      : {};
    const chatPubKey = String(existing.chatPubKey || getCurrentChatPublicKeySafe(req) || '').trim();
    if (chatPubKey && state.chatIdentity?.self && typeof state.chatIdentity.self === 'object') {
      state.chatIdentity.self.chatPubKey = chatPubKey;
    }
    return {
      ...existing,
      walletId: String(current.walletId || existing.walletId || '').trim(),
      merchantId: String(current.merchantId || existing.merchantId || '').trim(),
      chatPubKey,
    };
  }

  async function getChatSelfStateSnapshot(state, req) {
    const self = getSelfChatIdentity(state, req);
    const snapshot = await chatDomain.getSelfState(String(self.walletId || ''));
    return {
      selfWalletId: String(snapshot?.selfWalletId || self.walletId || ''),
      online: snapshot?.online !== false,
      storageLimitBytes: Math.max(1024, Number(snapshot?.storageLimitBytes || 104857600)),
      updatedAt: String(snapshot?.updatedAt || ''),
    };
  }

  function getChatSelfStateSnapshotFast(state, req) {
    const self = getSelfChatIdentity(state, req);
    return {
      selfWalletId: String(self.walletId || ''),
      online: state?.chatUi?.selfOnline !== false,
      storageLimitBytes: Math.max(1024, Number(state?.chatUi?.storageLimitBytes || 104857600)),
      updatedAt: String(state?.chatUi?.selfUpdatedAt || ''),
    };
  }

  function applyChatEventToRuntimeState(eventType, payload = {}) {
    const type = String(eventType || '').trim();
    if (!type) return false;
    const runtimeState = getRuntimeProjectionStateSnapshot(getRuntimeReq());
    if (!runtimeState) return false;
    let changed = false;
    if (
      type === 'chat.message.sent'
      || type === 'chat.message.received'
      || type === 'chat.message.anchored'
    ) {
      const peerWalletId = String(payload.peerWalletId || '').trim();
      const msgId = String(payload.msgId || '').trim();
      if (!peerWalletId || !msgId) return false;
      const currentThread = threadByWalletIdSafe(runtimeState, peerWalletId);
      ensureChatThread(runtimeState, peerWalletId, {
        displayName: String(payload.displayName || currentThread?.displayName || peerWalletId),
      });
      const beforeUnread = Math.max(0, Number(threadByWalletIdSafe(runtimeState, peerWalletId)?.unreadCount || 0));
      const row = appendChatMessage(runtimeState, {
        msgId,
        sessionId: String(payload.sessionId || ''),
        walletId: peerWalletId,
        peerPubKey: String(payload.senderPubKey || payload.peerPubKey || ''),
        transport: String(payload.transport || 'onchain'),
        direction: String(payload.direction || ''),
        text: String(payload.text || ''),
        orderId: String(payload.orderId || ''),
        txid: String(payload.txid || ''),
        status: String(payload.status || ''),
        ts: String(payload.ts || new Date().toISOString()),
      });
      const afterUnread = Math.max(0, Number(threadByWalletIdSafe(runtimeState, peerWalletId)?.unreadCount || 0));
      changed = Boolean(row) || beforeUnread !== afterUnread;
    } else if (type === 'chat.thread.read_marked') {
      const peerWalletId = String(payload.peerWalletId || '').trim();
      if (!peerWalletId) return false;
      const thread = threadByWalletIdSafe(runtimeState, peerWalletId);
      if (!thread) return false;
      thread.unreadCount = 0;
      thread.lastReadAt = new Date().toISOString();
      rebuildChatUiSummary(runtimeState);
      changed = true;
    }
    if (!changed) return false;
    commitChatRuntimeState(runtimeState, {
      writeJson: false,
      refresh: false,
      reason: `runtime_chat_event:${type}`,
    });
    appendMarketDebug('runtime_chat_event_applied', {
      eventType: type,
      peerWalletId: String(payload.peerWalletId || ''),
      msgId: String(payload.msgId || ''),
      unreadTotal: Math.max(0, Number(runtimeState?.chatUi?.chatUnreadTotal || 0)),
    });
    return true;
  }

  return {
    threadByWalletIdSafe,
    syncChatThreadsFromUsers,
    listChatMessagesForWallet,
    appendChatMessage,
    getCurrentChatPublicKeySafe,
    ensureSelfChatIdentity,
    getSelfChatIdentity,
    getChatSelfStateSnapshot,
    getChatSelfStateSnapshotFast,
    applyChatEventToRuntimeState,
  };
}

module.exports = {
  createChatRuntimeService,
};
