function registerChatRoutes(app, deps = {}) {
  const {
    CHAT_MODULE_ENABLED,
    walletAuthRequired,
    fail,
    appendMarketDebug,
    getRuntimeChatProjectionStateSnapshot,
    getRuntimeChatOnlyStateSnapshot,
    buildChatReadState,
    buildChatServiceState,
    buildProjectionBackedState,
    getChatDomainThreadPayload,
    getChatSelfStateSnapshot,
    emitChatSelfStateChanged,
    chatDomain,
    rebuildPublicStateCacheLocally,
    broadcastFrontendDomainSnapshots,
    ensureSelfChatIdentity,
    getSelfChatIdentity,
    searchChatProfiles,
    maybeBridgeChatFactsForColdRead,
    tryAnchorEvent,
    getChatRelationSnapshot,
    markExistingChatThreadRead,
    commitChatRuntimeState,
    ensureChatState,
    rebuildChatUiSummary,
    getChatDomainOpenPayload,
    getChatDomainPreview,
    getRuntimeAuthSnapshot,
    getChatSelfStateSnapshotFast,
    getChatRelationSnapshotFast,
    isPeerManuallyDisconnected,
    setPeerManualDisconnect,
    normalizeChatHttpEndpoint,
    getWalletIdForChatPubKey,
    commitRuntimeChatSessionStatus,
    getRecentChatAnchorRowsForPeer,
    commitRuntimeChatDisconnected,
    broadcastFrontendBootstrapSnapshots,
    decryptChatEnvelopeWithRuntime,
    verifyChatEnvelopeWithRuntime,
    getSessionPassword,
    defaultChatConfig,
    getPreferredPeerEndpoint,
    getPreferredPeerChatPubKey,
    wallet,
    bridgeWalletFactsToDomainSafe,
    scheduleFrontendDomainBroadcast,
    commitLocalState,
    rememberRecentRawtx,
    STATE_FILE,
    chatConfigStore,
    queueLocalChange,
    buildLocalStateSnapshotPayload,
    hashSnapshotPayload,
    cancelSqliteSnapshotPersist,
    localStateDomain,
    axios,
    crypto,
    chatRouteStateService,
    chatConnectFlow,
    chatOpenFlow,
    chatThreadFlow,
    chatSendFlow,
    chatRuntimeGate,
    chatSessionIndex,
    chatWorkerClient,
    chatAttachmentService,
    publishFrontendEvent,
  } = deps;
  function buildRuntimeAuthReq() {
    const snapshot = typeof getRuntimeAuthSnapshot === 'function'
      ? getRuntimeAuthSnapshot({ includeSecret: true })
      : null;
    const password = String(snapshot?.walletPassword || '').trim();
    return password ? { session: { walletPassword: password } } : {};
  }

  function getChatFriendAnchorWarning(anchor) {
    const error = String(anchor?.error || anchor?.message || '').trim();
    if (!error) return '';
    if (anchor?.timeout === true) return error;
    if (/No local SPV UTXOs found|missing \d+ spendable input|missing .*spendable input|insufficient .*balance|Insufficient .*balance|UTXO/i.test(error)) {
      return error;
    }
    return '';
  }

  function shouldFailChatFriendAnchor(anchor) {
    if (!anchor?.error) return false;
    if (anchor?.skipped === true || anchor?.timeout === true) return false;
    if (getChatFriendAnchorWarning(anchor)) return false;
    return true;
  }

  function getChatFriendAnchorPreflightWarning() {
    try {
      const snapshot = typeof wallet?.getWalletReadSnapshot === 'function'
        ? wallet.getWalletReadSnapshot({ includeHistory: false })
        : null;
      const availableSat = Number(snapshot?.available || snapshot?.total || 0);
      if (Number.isFinite(availableSat) && availableSat <= 0) {
        return 'No local SPV UTXOs found';
      }
    } catch (_) {}
    return '';
  }

  async function tryChatFriendAnchor(req, state, eventType, payload, options = {}) {
    const preflightWarning = getChatFriendAnchorPreflightWarning();
    if (preflightWarning) {
      return { error: preflightWarning, skipped: true };
    }
    const waitMs = Math.max(1000, Number(process.env.BSV_MARKET_CHAT_FRIEND_ANCHOR_WAIT_MS || 7000));
    const anchorPromise = tryAnchorEvent(req, state, eventType, payload, {
      ...options,
      trackOutputs: options.trackOutputs !== false,
    });
    let timer = null;
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(() => resolve({
        error: `Friend anchor timed out after ${waitMs}ms; saved locally`,
        skipped: true,
        timeout: true,
      }), waitMs);
    });
    const result = await Promise.race([anchorPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);
    if (result?.timeout === true) {
      anchorPromise
        .then((late) => appendMarketDebug?.('chat_friend_anchor_late_result', {
          eventType,
          txid: String(late?.txid || ''),
          error: String(late?.error || ''),
        }))
        .catch((err) => appendMarketDebug?.('chat_friend_anchor_late_error', {
          eventType,
          message: String(err?.message || err || 'late anchor failed'),
        }));
    }
    return result;
  }

  function buildChatFriendAnchorResponse(anchor, extra = {}) {
    const warning = getChatFriendAnchorWarning(anchor);
    return {
      success: true,
      ...extra,
      txid: String(anchor?.txid || ''),
      anchored: Boolean(anchor?.txid) && !warning,
      anchorSkipped: Boolean(anchor?.skipped),
      warning,
    };
  }

  function respondChatDisabled(req, res) {
    return res.status(503).json({
      success: false,
      error: 'chat module disabled',
      chatEnabled: false,
      path: String(req?.path || req?.originalUrl || ''),
    });
  }

  function assertChatRuntimeEnabled(req, state = null) {
    if (!chatRuntimeGate || typeof chatRuntimeGate.assertEnabled !== 'function') return null;
    return chatRuntimeGate.assertEnabled(state);
  }

  function getLiveChatRuntimeState(req, options = {}) {
    const {
      includeLocalState = false,
      allowBuildFallback = true,
      lightweight = true,
    } = options;
    const runtimeReq = buildRuntimeAuthReq();
    const runtimeState = lightweight && typeof getRuntimeChatOnlyStateSnapshot === 'function'
      ? getRuntimeChatOnlyStateSnapshot(runtimeReq)
      : (typeof getRuntimeChatProjectionStateSnapshot === 'function'
        ? getRuntimeChatProjectionStateSnapshot(runtimeReq)
        : null);
    if (runtimeState && typeof runtimeState === 'object') {
      ensureChatState(runtimeState, runtimeReq);
      return {
        state: runtimeState,
        runtimeReq,
        source: 'runtime',
      };
    }
    if (!allowBuildFallback) {
      return {
        state: null,
        runtimeReq,
        source: 'none',
      };
    }
    const builtState = buildChatServiceState(req || runtimeReq, { includeLocalState });
    ensureChatState(builtState, req || runtimeReq);
    return {
      state: builtState,
      runtimeReq,
      source: 'fallback',
    };
  }

  function getChatStateForPubKeyLookup(req, walletId = '', senderPubKey = '', options = {}) {
    const runtime = getLiveChatRuntimeState(req, options);
    if (!runtime.state) return runtime;
    return runtime;
  }

  async function proxyChatWorker(res, method, args = [], options = {}) {
    if (!chatWorkerClient || typeof chatWorkerClient.callChatWorker !== 'function') {
      return fail(res, 'chat worker unavailable', 503);
    }
    try {
      const result = await chatWorkerClient.callChatWorker(method, args, options);
      return res.json(result);
    } catch (error) {
      return fail(res, String(error?.message || `${method} failed`), Number(error?.statusCode || 500));
    }
  }

  async function handleChatOpenRequest(req, res) {
    const startedAt = Date.now();
    try {
      return await proxyChatWorker(res, 'get_open', [req.query || {}], { timeoutMs: 25000 });
    } finally {
      const elapsedMs = Date.now() - startedAt;
      if (typeof appendMarketDebug === 'function') {
        appendMarketDebug('chat_open_route_timing', {
          elapsedMs,
          limit: Number(req.query?.limit || 0),
        });
      }
    }
  }

  if (!CHAT_MODULE_ENABLED) {
    app.use(/^\/api\/chat(?:\/.*)?$/, (req, res) => respondChatDisabled(req, res));
    return;
  }

  app.get('/api/chat/config', walletAuthRequired, (req, res) => {
    return proxyChatWorker(res, 'get_config');
  });

  app.post('/api/chat/config', walletAuthRequired, (req, res) => {
    return proxyChatWorker(res, 'update_config', [req.body || {}]);
  });

  app.get('/api/chat/peer-endpoints', walletAuthRequired, (req, res) => {
    return proxyChatWorker(res, 'get_peer_endpoints');
  });

  app.post('/api/chat/peer-endpoint', walletAuthRequired, (req, res) => {
    const walletId = String(req.body?.walletId || '').trim();
    if (!walletId) return fail(res, 'walletId is required');
    return proxyChatWorker(res, 'set_peer_endpoint', [walletId, req.body?.endpoint || '']);
  });

  app.get('/api/chat/identity', walletAuthRequired, (req, res) => {
    const { state } = getLiveChatRuntimeState(req, {
      includeLocalState: false,
      allowBuildFallback: false,
    });
    if (!state) return fail(res, 'chat runtime unavailable', 503);
    const self = getSelfChatIdentity(state, req);
    return res.json({ success: true, identity: self });
  });

  app.post('/api/chat/profile/publish', walletAuthRequired, async (req, res) => {
    const state = buildChatServiceState(req, { includeLocalState: false });
    const self = ensureSelfChatIdentity(state, req);
    if (!self.chatPubKey) return fail(res, 'chatPubKey unavailable', 500);
    const publishedAt = new Date().toISOString();
    let signature = '';
    try {
      const mnemonic = wallet.getMnemonicFromPassword(getSessionPassword(req));
      signature = wallet.signWalletKeyBind({
        mnemonic,
        walletId: self.walletId,
        merchantId: self.merchantId,
        chatPubKey: self.chatPubKey,
        endpointHints: state.chatConfig.publicHost
          ? [`${state.chatConfig.publicHost}:${Number(state.chatConfig.publicPort || state.chatConfig.listenPort || 8787)}`]
          : [],
        relayHints: [],
        createdAt: publishedAt,
      });
    } catch (err) {
      return fail(res, String(err?.message || 'wallet key bind signature failed'), 500);
    }
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
      signature,
    }, 'chat', self.walletId);
    if (!queuedChange) return fail(res, 'wallet key bind queue failed', 500);
    queuedChange.payload.createdAt = publishedAt;
    state.chatIdentity.self.lastPublishedAt = publishedAt;
    let anchor = null;
    try {
      anchor = await tryAnchorEvent(req, state, 'wallet_key_bind', queuedChange.payload || {}, {
        password: getSessionPassword(req),
        changeId: String(queuedChange.id || ''),
        updatedAt: publishedAt,
        includeUnconfirmed: true,
        trackOutputs: true,
      });
    } catch (_) {
      anchor = null;
    }
    if (anchor?.txid) {
      queuedChange.status = 'broadcasted';
      queuedChange.txid = String(anchor.txid || '');
      queuedChange.broadcastedAt = publishedAt;
      queuedChange.lastBroadcastAt = publishedAt;
      queuedChange.feeSat = Number(anchor.feeSat || 0);
      queuedChange.rawtx = String(anchor.rawtx || '');
      queuedChange.broadcastNodes = Array.isArray(anchor.broadcastNodes) ? anchor.broadcastNodes.slice(0, 8) : [];
      queuedChange.broadcastSuccessCount = Number(anchor.broadcastSuccessCount || 0);
      queuedChange.broadcastAttemptedCount = Number(anchor.broadcastAttemptedCount || 0);
      delete queuedChange.lastError;
      delete queuedChange.failedAt;
      state.chatIdentity.self.lastPublishedTxid = String(anchor.txid || '');
      state.chatIdentity.self.published = true;
      rememberRecentRawtx(state, {
        ts: publishedAt,
        txid: String(anchor.txid || ''),
        eventType: 'wallet_key_bind',
        note: 'market:wallet_key_bind',
        rawtx: String(anchor.rawtx || ''),
      });
      appendMarketDebug('chat_profile_publish_anchor_ok', {
        walletId: String(self.walletId || ''),
        chatPubKey: String(self.chatPubKey || ''),
        txid: String(anchor.txid || ''),
        feeSat: Number(anchor.feeSat || 0),
      });
    }
    cancelSqliteSnapshotPersist('localState');
    const localStatePayload = buildLocalStateSnapshotPayload(state);
    await localStateDomain.emitLocalStateSnapshot(localStatePayload, {
      producer: 'chat_profile_publish',
      dedupeKey: `local_state.snapshot:${hashSnapshotPayload(localStatePayload)}`,
    });
    commitChatRuntimeState(state, { writeJson: false });
    commitLocalState(state, { writeJson: true, refresh: false });
    return res.json({
      success: true,
      queued: true,
      anchored: Boolean(anchor?.txid),
      anchorTxid: String(anchor?.txid || ''),
      changeId: String(queuedChange.id || ''),
      identity: state.chatIdentity.self,
    });
  });

  app.get('/api/chat/open', walletAuthRequired, handleChatOpenRequest);
  app.get('/api/chat/threads', walletAuthRequired, handleChatOpenRequest);

  app.get('/api/chat/thread', walletAuthRequired, async (req, res) => {
    const walletId = String(req.query?.walletId || '').trim();
    if (!walletId) return fail(res, 'walletId is required');
    return proxyChatWorker(res, 'get_thread', [walletId, req.query || {}], { timeoutMs: 25000 });
  });

  app.get('/api/chat/wallet-id-for-pubkey', walletAuthRequired, async (req, res) => {
    const pubKey = String(req.query?.pubKey || req.query?.chatPubKey || '').trim();
    if (!pubKey) return fail(res, 'pubKey is required');
    const state = buildChatReadState(req, { includeLocalState: false });
    const walletId = typeof getWalletIdForChatPubKey === 'function'
      ? String(getWalletIdForChatPubKey(state, pubKey) || '').trim()
      : '';
    return res.json({ success: true, walletId });
  });

  app.get('/api/chat/self-state', walletAuthRequired, async (req, res) => {
    const state = buildChatReadState(req, { includeLocalState: false });
    const selfState = await getChatSelfStateSnapshot(state, req);
    return res.json({ success: true, selfState });
  });

  app.post('/api/chat/self-state', walletAuthRequired, async (req, res) => {
    const state = buildChatServiceState(req, { includeLocalState: false });
    const nextOnline = req.body?.online !== false;
    await emitChatSelfStateChanged(state, req, {
      online: nextOnline,
    });
    await chatDomain.flushProjection?.();
    await rebuildPublicStateCacheLocally('chat_self_state_changed', state);
    await broadcastFrontendDomainSnapshots('chat', 'chat_self_state_changed');
    const selfState = await getChatSelfStateSnapshot(state, req);
    return res.json({ success: true, selfState });
  });

  app.get('/api/chat/search', walletAuthRequired, async (req, res) => {
    const state = buildChatServiceState(req, { includeLocalState: true });
    await maybeBridgeChatFactsForColdRead(state, req, { reason: 'search' });
    await chatDomain.flushProjection?.();
    const self = getSelfChatIdentity(state, req);
    const contacts = await chatDomain.getContacts(String(self.walletId || ''));
    const friendSet = new Set((Array.isArray(contacts) ? contacts : []).filter((row) => row?.isFriend === true).map((row) => String(row?.peerWalletId || '')));
    const blockedSet = new Set((Array.isArray(contacts) ? contacts : []).filter((row) => row?.blocked === true).map((row) => String(row?.peerWalletId || '')));
    let results = searchChatProfiles(state, req, req.query?.q)
      .filter((row) => !friendSet.has(String(row.walletId || '')))
      .map((row) => ({
        ...row,
        isFriend: false,
        blocked: blockedSet.has(String(row.walletId || '')),
      }));
    if (results.length <= 0) {
      await maybeBridgeChatFactsForColdRead(state, req, { reason: 'search_force', force: true });
      results = searchChatProfiles(state, req, req.query?.q)
        .filter((row) => !friendSet.has(String(row.walletId || '')))
        .map((row) => ({
          ...row,
          isFriend: false,
          blocked: blockedSet.has(String(row.walletId || '')),
        }));
    }
    return res.json({ success: true, results });
  });

  app.post('/api/chat/friend/request', walletAuthRequired, async (req, res) => {
    const state = buildChatServiceState(req, { includeLocalState: false });
    const peerWalletId = String(req.body?.walletId || '').trim();
    if (!peerWalletId) return fail(res, 'walletId is required');
    const self = ensureSelfChatIdentity(state, req);
    const selfState = await getChatSelfStateSnapshot(state, req);
    if (selfState.online === false) return fail(res, 'offline users reject friend requests', 409);
    const relation = await getChatRelationSnapshot(state, req, peerWalletId);
    if (relation.blocked === true) return fail(res, 'peer is blocked', 409);
    const anchor = await tryChatFriendAnchor(req, state, 'chat_friend_request', {
      fromWalletId: String(self.walletId || ''),
      toWalletId: peerWalletId,
    }, {
      updatedAt: new Date().toISOString(),
    });
    if (shouldFailChatFriendAnchor(anchor)) return fail(res, String(anchor.error || 'Anchor failed'), 400);
    await chatDomain.emitChatEvent('chat.friend.requested', {
      fromWalletId: String(self.walletId || ''),
      toWalletId: peerWalletId,
    }, {
      producer: 'chat_api',
      entityType: 'chat_friend',
      entityId: `${String(self.walletId || '')}:${peerWalletId}`,
    });
    return res.json(buildChatFriendAnchorResponse(anchor, { walletId: peerWalletId }));
  });

  app.post('/api/chat/friend/accept', walletAuthRequired, async (req, res) => {
    const state = buildChatServiceState(req, { includeLocalState: false });
    const peerWalletId = String(req.body?.walletId || '').trim();
    if (!peerWalletId) return fail(res, 'walletId is required');
    const self = ensureSelfChatIdentity(state, req);
    const selfState = await getChatSelfStateSnapshot(state, req);
    if (selfState.online === false) return fail(res, 'offline users reject friend requests', 409);
    const anchor = await tryChatFriendAnchor(req, state, 'chat_friend_accept', {
      fromWalletId: String(self.walletId || ''),
      toWalletId: peerWalletId,
    }, {
      updatedAt: new Date().toISOString(),
    });
    if (shouldFailChatFriendAnchor(anchor)) return fail(res, String(anchor.error || 'Anchor failed'), 400);
    await chatDomain.emitChatEvent('chat.friend.accepted', {
      selfWalletId: String(self.walletId || ''),
      peerWalletId,
    }, {
      producer: 'chat_api',
      entityType: 'chat_friend',
      entityId: `${String(self.walletId || '')}:${peerWalletId}`,
    });
    return res.json(buildChatFriendAnchorResponse(anchor, { walletId: peerWalletId }));
  });

  app.post('/api/chat/friend/reject', walletAuthRequired, async (req, res) => {
    const state = buildChatServiceState(req, { includeLocalState: false });
    const peerWalletId = String(req.body?.walletId || '').trim();
    if (!peerWalletId) return fail(res, 'walletId is required');
    const self = ensureSelfChatIdentity(state, req);
    const selfState = await getChatSelfStateSnapshot(state, req);
    if (selfState.online === false) return fail(res, 'offline users reject friend requests', 409);
    const anchor = await tryChatFriendAnchor(req, state, 'chat_friend_reject', {
      fromWalletId: String(self.walletId || ''),
      toWalletId: peerWalletId,
      action: 'reject',
    }, {
      updatedAt: new Date().toISOString(),
    });
    if (shouldFailChatFriendAnchor(anchor)) return fail(res, String(anchor.error || 'Anchor failed'), 400);
    await chatDomain.emitChatEvent('chat.friend.rejected', {
      selfWalletId: String(self.walletId || ''),
      peerWalletId,
      action: 'reject',
    }, {
      producer: 'chat_api',
      entityType: 'chat_friend',
      entityId: `${String(self.walletId || '')}:${peerWalletId}`,
    });
    return res.json(buildChatFriendAnchorResponse(anchor, { walletId: peerWalletId }));
  });

  app.post('/api/chat/friend/delete', walletAuthRequired, async (req, res) => {
    const state = buildChatServiceState(req, { includeLocalState: false });
    const peerWalletId = String(req.body?.walletId || '').trim();
    if (!peerWalletId) return fail(res, 'walletId is required');
    const self = ensureSelfChatIdentity(state, req);
    const anchor = await tryChatFriendAnchor(req, state, 'chat_friend_reject', {
      fromWalletId: String(self.walletId || ''),
      toWalletId: peerWalletId,
      action: 'delete',
    }, {
      updatedAt: new Date().toISOString(),
    });
    if (shouldFailChatFriendAnchor(anchor)) return fail(res, String(anchor.error || 'Anchor failed'), 400);
    await chatDomain.emitChatEvent('chat.friend.rejected', {
      selfWalletId: String(self.walletId || ''),
      peerWalletId,
      action: 'delete',
    }, {
      producer: 'chat_api',
      entityType: 'chat_friend',
      entityId: `${String(self.walletId || '')}:${peerWalletId}`,
    });
    return res.json(buildChatFriendAnchorResponse(anchor, { walletId: peerWalletId, deleted: true }));
  });

  app.post('/api/chat/block', walletAuthRequired, async (req, res) => {
    const state = buildChatServiceState(req, { includeLocalState: false });
    const peerWalletId = String(req.body?.walletId || '').trim();
    if (!peerWalletId) return fail(res, 'walletId is required');
    const self = ensureSelfChatIdentity(state, req);
    await chatDomain.emitChatEvent('chat.peer.blocked', {
      selfWalletId: String(self.walletId || ''),
      peerWalletId,
    }, {
      producer: 'chat_api',
      entityType: 'chat_peer',
      entityId: `${String(self.walletId || '')}:${peerWalletId}`,
    });
    return res.json({ success: true, walletId: peerWalletId, blocked: true });
  });

  app.post('/api/chat/unblock', walletAuthRequired, async (req, res) => {
    const state = buildChatServiceState(req, { includeLocalState: false });
    const peerWalletId = String(req.body?.walletId || '').trim();
    if (!peerWalletId) return fail(res, 'walletId is required');
    const self = ensureSelfChatIdentity(state, req);
    await chatDomain.emitChatEvent('chat.peer.unblocked', {
      selfWalletId: String(self.walletId || ''),
      peerWalletId,
    }, {
      producer: 'chat_api',
      entityType: 'chat_peer',
      entityId: `${String(self.walletId || '')}:${peerWalletId}`,
    });
    return res.json({ success: true, walletId: peerWalletId, blocked: false });
  });

  app.post('/api/chat/thread/read', walletAuthRequired, async (req, res) => {
    const walletId = String(req.body?.walletId || '').trim();
    if (!walletId) return fail(res, 'walletId is required');
    return proxyChatWorker(res, 'mark_read', [walletId]);
  });

  app.get('/api/chat/unread', walletAuthRequired, async (req, res) => {
    const startedAt = Date.now();
    const runtime = getLiveChatRuntimeState(req, {
      includeLocalState: false,
      allowBuildFallback: false,
      lightweight: true,
    });
    const runtimeState = runtime?.state;
    if (runtimeState && typeof runtimeState === 'object') {
      rebuildChatUiSummary(runtimeState);
      const byWalletId = {};
      Object.entries(runtimeState.chatThreads || {}).forEach(([walletId, thread]) => {
        const unread = Math.max(0, Number(thread?.unreadCount || 0));
        if (unread > 0) byWalletId[String(walletId || '').trim()] = unread;
      });
      const elapsedMs = Date.now() - startedAt;
      if (typeof appendMarketDebug === 'function' && elapsedMs >= 100) {
        appendMarketDebug('chat_unread_perf', {
          totalMs: elapsedMs,
          source: runtime?.source || 'runtime',
          threadCount: Object.keys(runtimeState.chatThreads || {}).length,
        });
      }
      return res.json({
        success: true,
        unreadTotal: Math.max(0, Number(runtimeState?.chatUi?.chatUnreadTotal || 0)),
        buttonHasUnread: Boolean(runtimeState?.chatUi?.buttonHasUnread),
        byWalletId,
      });
    }
    if (typeof appendMarketDebug === 'function') {
      appendMarketDebug('chat_unread_fast_empty', {
        totalMs: Date.now() - startedAt,
        source: runtime?.source || 'none',
      });
    }
    return res.json({
      success: true,
      unreadTotal: 0,
      buttonHasUnread: false,
      byWalletId: {},
    });
  });

  app.get('/api/chat/status', walletAuthRequired, async (req, res) => {
    const walletId = String(req.query?.walletId || '').trim();
    if (!walletId) return fail(res, 'walletId is required');
    return proxyChatWorker(res, 'get_status', [walletId]);
  });

  app.post('/api/chat/connect/test', walletAuthRequired, async (req, res) => {
    const walletId = String(req.body?.walletId || req.query?.walletId || '').trim();
    if (!walletId) return fail(res, 'walletId is required');
    return proxyChatWorker(res, 'connect', [walletId], { timeoutMs: 180000 });
  });

  app.post('/api/chat/disconnect', walletAuthRequired, async (req, res) => {
    const walletId = String(req.body?.walletId || req.query?.walletId || '').trim();
    if (!walletId) return fail(res, 'walletId is required');
    return proxyChatWorker(res, 'disconnect', [walletId], { timeoutMs: 15000 });
  });

  app.post('/api/chat/signal', async (req, res) => {
    return proxyChatWorker(res, 'receive_signal', [req.body || {}, {
      source: 'http_signal',
      remoteAddress: String(req?.socket?.remoteAddress || req?.ip || ''),
    }], { timeoutMs: 180000 });
  });

  app.post('/api/chat/send', walletAuthRequired, async (req, res) => {
    const body = req.body || {};
    const forceOnchain = body.forceOnchain === true || String(body.forceOnchain || '').toLowerCase() === 'true';
    const timeoutMs = forceOnchain
      ? Math.max(30000, Number(process.env.BSV_MARKET_CHAT_ONCHAIN_SEND_TIMEOUT_MS || 180000))
      : 30000;
    return proxyChatWorker(res, 'send', [body], { timeoutMs });
  });

  app.post('/api/chat/attachment/upload', walletAuthRequired, async (req, res) => {
    if (!chatAttachmentService || typeof chatAttachmentService.storeUploadedAttachment !== 'function') {
      return fail(res, 'chat attachment service unavailable', 503);
    }
    try {
      const attachment = chatAttachmentService.storeUploadedAttachment(req.body || {});
      return res.json({ success: true, attachment });
    } catch (error) {
      return fail(res, String(error?.message || error || 'attachment upload failed'), 400);
    }
  });

  app.get('/api/chat/attachment/:attachmentId', walletAuthRequired, (req, res) => {
    if (!chatAttachmentService || typeof chatAttachmentService.sendAttachment !== 'function') {
      return fail(res, 'chat attachment service unavailable', 503);
    }
    return chatAttachmentService.sendAttachment(req, res);
  });

  app.get('/api/chat/users', (_req, res) => {
    return res.status(410).json({
      success: false,
      error: 'Deprecated chat API; use /api/chat/threads instead',
      code: 'DEPRECATED_CHAT_API',
    });
  });

}

module.exports = {
  registerChatRoutes,
};
