function createChatAnchorBridgeService(deps = {}) {
  const {
    CHAT_MODULE_ENABLED,
    DATA_DIR,
    normalizeEventPayload,
    ensureChatState,
    getCurrentWalletIdentity,
    buildRuntimeAuthReq,
    getSessionPassword,
    getRuntimeAuthPassword,
    verifyWalletKeyBindPayload,
    compareWalletKeyBindPriority,
    getChatRelevantAnchorRows,
    upsertWalletKeyBinding,
    getWalletIdForChatPubKey,
    ensureChatThread,
    threadByWalletIdSafe,
    appendChatMessage,
    syncChatThreadsFromUsers,
    verifyChatEnvelopeWithRuntime,
    decryptChatEnvelopeWithRuntime,
    decryptChatEnvelopeWithPeerPubKey,
    chatDomain,
    buildChatServiceState,
    commitChatRuntimeState,
    appendMarketDebug,
    rebuildCatalogFromAnchors,
    yieldToEventLoop,
    rebuildChatUiSummary,
    persistChatRuntimeProjectionFromState,
    writeStateJsonSnapshot,
    persistCatalogSnapshotAsync,
    persistProfileSnapshotAsync,
    rebuildPublicStateCache,
    buildProjectionBackedState,
    withHotPathDebug,
    getPendingAnchorOverlay,
  } = deps;

  const getRuntimeReq = typeof buildRuntimeAuthReq === 'function'
    ? buildRuntimeAuthReq
    : deps.buildRuntimeWalletReq;

  function looksLikeGeneratedChatName(value = '', walletId = '') {
    const name = String(value || '').trim();
    const peerWalletId = String(walletId || '').trim();
    if (!name) return true;
    if (peerWalletId && name === peerWalletId) return true;
    return /^wallet-[a-z0-9_-]+$/i.test(name) || /^m-[a-z0-9_-]+$/i.test(name);
  }

  function firstUsefulDisplayName(walletId, values = []) {
    const peerWalletId = String(walletId || '').trim();
    const normalized = values.map((value) => String(value || '').trim()).filter(Boolean);
    const useful = normalized.find((value) => !looksLikeGeneratedChatName(value, peerWalletId));
    return useful || normalized[0] || peerWalletId;
  }
  const readRuntimePassword = typeof getRuntimeAuthPassword === 'function'
    ? getRuntimeAuthPassword
    : deps.getRuntimeWalletPassword;

  let chatAnchorBridgeTimer = null;
  let chatAnchorBridgeRunning = false;
  let chatAnchorBridgeQueued = false;
  let chatAnchorBridgeLastCursorMemory = '';
  let chatAnchorBridgeLastCursorDataDir = '';

  function getChatAnchorBridgeState(state) {
    if (!state || typeof state !== 'object') return { lastCursor: '' };
    const currentDataDir = DATA_DIR;
    if (chatAnchorBridgeLastCursorDataDir !== currentDataDir) {
      chatAnchorBridgeLastCursorDataDir = currentDataDir;
      chatAnchorBridgeLastCursorMemory = '';
    }
    if (!state.chatBridgeState || typeof state.chatBridgeState !== 'object') {
      state.chatBridgeState = { lastCursor: '' };
    }
    if (typeof state.chatBridgeState.lastCursor !== 'string') {
      state.chatBridgeState.lastCursor = String(state.chatBridgeState.lastCursor || '');
    }
    if (compareChatAnchorCursor(chatAnchorBridgeLastCursorMemory, state.chatBridgeState.lastCursor) > 0) {
      state.chatBridgeState.lastCursor = chatAnchorBridgeLastCursorMemory;
    }
    return state.chatBridgeState;
  }

  function buildChatAnchorCursor(row, payload = null) {
    const safePayload = payload && typeof payload === 'object' ? payload : {};
    return [
      String(row?.ts || ''),
      String(row?.txid || '').trim().toLowerCase(),
      String(row?.eventType || '').trim(),
      String(safePayload.msgId || safePayload.walletId || safePayload.fromWalletId || ''),
    ].join('|');
  }

  function compareChatAnchorCursor(a = '', b = '') {
    return String(a || '').localeCompare(String(b || ''));
  }

  function buildChatThreadOverlayMessageFromAnchorRow(state, req, row, options = {}) {
    const current = options?.current || getCurrentWalletIdentity(state, req || getRuntimeReq());
    const currentWalletId = String(current?.walletId || '').trim();
    if (!currentWalletId) return null;
    const eventType = String(row?.eventType || '').trim();
    if (eventType !== 'chat_message') return null;
    const payload = normalizeEventPayload(eventType, row?.payload || {}, String(row?.ts || ''));
    const fromWalletId = String(payload.fromWalletId || '').trim();
    const toWalletId = String(payload.toWalletId || '').trim();
    if (!fromWalletId || !toWalletId) return null;
    if (fromWalletId !== currentWalletId && toWalletId !== currentWalletId) return null;
    const peerWalletId = fromWalletId === currentWalletId ? toWalletId : fromWalletId;
    if (options?.peerWalletId && String(options.peerWalletId || '').trim() !== peerWalletId) return null;
    const peerPubKey = String(payload.fromPubKey || payload.peerPubKey || '').trim();
    const boundSenderWalletId = getWalletIdForChatPubKey(state, peerPubKey);
    if (!boundSenderWalletId || boundSenderWalletId !== fromWalletId) return null;
    const ts = String(payload._updatedAt || row?.ts || new Date().toISOString());
    const msgId = String(payload.msgId || `onchain:${String(row?.txid || '')}`).trim();
    const password = (() => {
      try {
        return req ? String(getSessionPassword(req) || '') : String(readRuntimePassword() || '');
      } catch (_) {
        return String(readRuntimePassword() || '');
      }
    })();
    const signatureOk = verifyChatEnvelopeWithRuntime({
      senderPubKey: peerPubKey,
      recipientPubKey: String(payload.peerPubKey || ''),
      ciphertext: String(payload.ciphertext || ''),
      nonce: String(payload.nonce || ''),
      authTag: String(payload.authTag || ''),
      msgId,
      sessionId: String(payload.sessionId || ''),
      fromWalletId,
      toWalletId,
      ts,
      orderId: String(payload.orderId || ''),
      signature: String(payload.signature || ''),
      password,
    });
    let plainText = String(payload.previewText || '');
    const decryptedInboxText = currentWalletId === toWalletId && payload.ciphertext && payload.nonce && payload.authTag
      ? decryptChatEnvelopeWithRuntime({
        senderPubKey: peerPubKey,
        ciphertext: String(payload.ciphertext || ''),
        nonce: String(payload.nonce || ''),
        authTag: String(payload.authTag || ''),
        password,
      })
      : '';
    const decryptedSentText = currentWalletId === fromWalletId && payload.ciphertext && payload.nonce && payload.authTag && payload.peerPubKey
      ? decryptChatEnvelopeWithPeerPubKey({
        peerPubKey: String(payload.peerPubKey || ''),
        ciphertext: String(payload.ciphertext || ''),
        nonce: String(payload.nonce || ''),
        authTag: String(payload.authTag || ''),
        password,
      })
      : '';
    const decryptedText = decryptedInboxText || decryptedSentText;
    if (!signatureOk && !decryptedText) return null;
    if (decryptedText) plainText = decryptedText;
    return {
      selfWalletId: currentWalletId,
      peerWalletId,
      msgId,
      threadId: `chat:${currentWalletId}:${peerWalletId}`,
      direction: fromWalletId === currentWalletId ? 'out' : 'in',
      transport: 'onchain',
      text: plainText,
      orderId: String(payload.orderId || ''),
      ts,
      status: row?.confirmed === true || row?.publicVisible === true ? 'visible' : 'broadcasted',
      txid: String(row?.txid || ''),
      sourceEventSeq: 0,
      updatedAt: ts,
    };
  }

  function mergeChatThreadOverlayMessages(baseMessages, overlayMessages, page, pageSize) {
    const merged = [];
    const seen = new Set();
    for (const message of [...(Array.isArray(baseMessages) ? baseMessages : []), ...(Array.isArray(overlayMessages) ? overlayMessages : [])]) {
      if (!message || typeof message !== 'object') continue;
      const key = `${String(message.msgId || '')}|${String(message.txid || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(message);
    }
    merged.sort((a, b) => {
      const ta = Date.parse(String(a?.ts || '')) || 0;
      const tb = Date.parse(String(b?.ts || '')) || 0;
      if (ta !== tb) return ta - tb;
      return String(a?.msgId || '').localeCompare(String(b?.msgId || ''));
    });
    const safePage = Math.max(1, Number(page || 1));
    const safePageSize = Math.max(1, Number(pageSize || 10));
    const totalItems = merged.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
    const boundedPage = Math.min(safePage, totalPages);
    const start = Math.max(0, totalItems - (boundedPage * safePageSize));
    return merged.slice(start, start + safePageSize);
  }

  function scheduleChatAnchorBridge(reason = 'runtime', delayMs = 40) {
    if (!CHAT_MODULE_ENABLED) return;
    chatAnchorBridgeQueued = true;
    if (chatAnchorBridgeTimer) clearTimeout(chatAnchorBridgeTimer);
    chatAnchorBridgeTimer = setTimeout(() => {
      chatAnchorBridgeTimer = null;
      if (chatAnchorBridgeRunning) return;
      chatAnchorBridgeQueued = false;
      chatAnchorBridgeRunning = true;
      const runtimeReq = getRuntimeReq();
      const state = buildChatServiceState(runtimeReq, { includeLocalState: true });
      bridgeChatFactsToDomain(state, runtimeReq, {
        incremental: true,
        reason,
      })
        .then((result) => {
          if (result?.stateChanged) {
            commitChatRuntimeState(state, {
              writeJson: true,
              refresh: false,
              reason: `chat_anchor_bridge:${String(reason || 'runtime')}`,
            });
          }
          chatDomain.scheduleProjectionCatchUp?.(0);
        })
        .catch((error) => {
          appendMarketDebug('chat_anchor_bridge_failed', {
            reason: String(reason || ''),
            message: String(error?.message || error || 'chat_anchor_bridge_failed'),
          });
        })
        .finally(() => {
          chatAnchorBridgeRunning = false;
          if (chatAnchorBridgeQueued) scheduleChatAnchorBridge('requeued', 40);
        });
    }, Math.max(0, Number(delayMs || 0)));
  }

  async function maybeBridgeChatFactsForColdRead(state, req, options = {}) {
    if (!CHAT_MODULE_ENABLED) return false;
    const relevantRows = getChatRelevantAnchorRows(state, {
      sqlite: { eventTypes: ['wallet_key_bind', 'chat_message', 'chat_friend_request', 'chat_friend_accept', 'chat_friend_reject'] },
      req,
    });
    const hasRelevantAnchors = relevantRows.length > 0;
    const needsBridge = options?.force === true || hasRelevantAnchors;
    if (!needsBridge) return false;
    const result = await bridgeChatFactsToDomain(state, req, {
      incremental: true,
      reason: String(options?.reason || 'cold_read'),
    });
    if (result?.stateChanged) {
      commitChatRuntimeState(state, {
        writeJson: true,
        refresh: false,
        reason: `chat_anchor_bridge:${String(options?.reason || 'cold_read')}`,
      });
    }
    await chatDomain.flushProjection?.();
    return true;
  }

  async function bridgeChatFactsToDomain(state, req = null, options = {}) {
    if (!CHAT_MODULE_ENABLED) return;
    ensureChatState(state, req);
    const current = getCurrentWalletIdentity(state, req || getRuntimeReq());
    const bridgePassword = (() => {
      try {
        return req ? String(getSessionPassword(req) || '') : String(readRuntimePassword() || '');
      } catch (_) {
        return String(readRuntimePassword() || '');
      }
    })();
    const bridgeState = getChatAnchorBridgeState(state);
    const incremental = options?.incremental !== false;
    const lastCursor = incremental ? String(bridgeState.lastCursor || '') : '';
    let stateChanged = false;
    let lastProcessedCursor = lastCursor;
    const sorted = getChatRelevantAnchorRows(state).sort((a, b) => {
      const ta = Date.parse(String(a?.ts || '')) || 0;
      const tb = Date.parse(String(b?.ts || '')) || 0;
      if (ta !== tb) return ta - tb;
      const txCmp = String(a?.txid || '').localeCompare(String(b?.txid || ''));
      if (txCmp !== 0) return txCmp;
      return String(a?.eventType || '').localeCompare(String(b?.eventType || ''));
    });
    const winningBindByPubKey = new Map();
    for (const row of sorted) {
      if (String(row?.eventType || '').trim() !== 'wallet_key_bind') continue;
      const payload = normalizeEventPayload('wallet_key_bind', row?.payload || {}, String(row?.ts || ''));
      const chatPubKey = String(payload.chatPubKey || '').trim();
      const walletId = String(payload.walletId || '').trim();
      if (!chatPubKey || !walletId) continue;
      if (!verifyWalletKeyBindPayload(payload)) continue;
      const candidate = {
        chatPubKey,
        walletId,
        merchantId: String(payload.merchantId || '').trim(),
        firstBindTxid: String(row?.txid || ''),
        firstBindHeight: Math.max(0, Number(row?.height || 0)),
        firstBindConfirmed: row?.confirmed === true,
        firstBindCreatedAt: String(payload._updatedAt || row?.ts || ''),
        signature: String(payload.signature || ''),
      };
      const existing = winningBindByPubKey.get(chatPubKey);
      if (!existing || compareWalletKeyBindPriority(candidate, existing) < 0) {
        winningBindByPubKey.set(chatPubKey, candidate);
      }
    }
    for (const row of sorted) {
      const eventType = String(row?.eventType || '').trim();
      const payload = normalizeEventPayload(eventType, row?.payload || {}, String(row?.ts || ''));
      const cursor = buildChatAnchorCursor(row, payload);
      if (incremental && compareChatAnchorCursor(cursor, lastCursor) <= 0) continue;
      lastProcessedCursor = cursor;
      if (eventType === 'wallet_key_bind') {
        const walletId = String(payload.walletId || '').trim();
        const merchantId = String(payload.merchantId || '').trim();
        const chatPubKey = String(payload.chatPubKey || '').trim();
        if (!walletId || !chatPubKey) continue;
        if (!verifyWalletKeyBindPayload(payload)) continue;
        const winner = winningBindByPubKey.get(chatPubKey);
        if (!winner || String(winner.walletId || '') !== walletId || String(winner.firstBindTxid || '') !== String(row?.txid || '')) {
          continue;
        }
        const bindResult = upsertWalletKeyBinding(state, winner);
        const nextProfile = {
          walletId,
          merchantId,
          chatPubKeys: [chatPubKey],
          endpointHints: Array.isArray(payload.endpointHints) ? payload.endpointHints.slice(0, 8) : [],
          relayHints: Array.isArray(payload.relayHints) ? payload.relayHints.slice(0, 8) : [],
          updatedAt: String(payload._updatedAt || row?.ts || ''),
          verified: true,
        };
        const prevProfile = state.chatDiscovery.profiles[walletId];
        state.chatDiscovery.profiles[walletId] = nextProfile;
        const profileChanged = JSON.stringify(prevProfile || null) !== JSON.stringify(nextProfile);
        stateChanged = stateChanged || bindResult?.changed === true || profileChanged;
        continue;
      }
      if (eventType === 'chat_friend_request' || eventType === 'chat_friend_accept' || eventType === 'chat_friend_reject') {
        const fromWalletId = String(payload.fromWalletId || '').trim();
        const toWalletId = String(payload.toWalletId || '').trim();
        if (!fromWalletId || !toWalletId) continue;
        if (fromWalletId !== current.walletId && toWalletId !== current.walletId) continue;
        if (eventType === 'chat_friend_request') {
          await chatDomain.emitChatEvent('chat.friend.requested', {
            fromWalletId,
            toWalletId,
          }, {
            producer: 'anchor_bridge',
            entityType: 'chat_friend',
            entityId: `${fromWalletId}:${toWalletId}`,
            dedupeKey: `chat_friend_requested:${fromWalletId}:${toWalletId}:${String(row?.txid || '')}`,
          });
        } else if (eventType === 'chat_friend_accept') {
          await chatDomain.emitChatEvent('chat.friend.accepted', {
            selfWalletId: fromWalletId,
            peerWalletId: toWalletId,
          }, {
            producer: 'anchor_bridge',
            entityType: 'chat_friend',
            entityId: `${fromWalletId}:${toWalletId}`,
            dedupeKey: `chat_friend_accepted:${fromWalletId}:${toWalletId}:${String(row?.txid || '')}`,
          });
        } else {
          await chatDomain.emitChatEvent('chat.friend.rejected', {
            selfWalletId: fromWalletId,
            peerWalletId: toWalletId,
            action: String(payload.action || 'reject'),
          }, {
            producer: 'anchor_bridge',
            entityType: 'chat_friend',
            entityId: `${fromWalletId}:${toWalletId}`,
            dedupeKey: `chat_friend_rejected:${fromWalletId}:${toWalletId}:${String(row?.txid || '')}`,
          });
        }
        stateChanged = true;
        continue;
      }
      if (eventType !== 'chat_message') continue;
      const fromWalletId = String(payload.fromWalletId || '').trim();
      const toWalletId = String(payload.toWalletId || '').trim();
      if (!fromWalletId || !toWalletId) continue;
      if (fromWalletId !== current.walletId && toWalletId !== current.walletId) continue;
      const selfWalletId = fromWalletId === current.walletId ? fromWalletId : toWalletId;
      const peerWalletId = fromWalletId === current.walletId ? toWalletId : fromWalletId;
      const peerPubKey = String(payload.fromPubKey || payload.peerPubKey || '').trim();
      const boundSenderWalletId = getWalletIdForChatPubKey(state, peerPubKey);
      if (!boundSenderWalletId || boundSenderWalletId !== fromWalletId) continue;
      const ts = String(payload._updatedAt || row?.ts || new Date().toISOString());
      const msgId = String(payload.msgId || `onchain:${String(row?.txid || '')}`).trim();
      const signatureOk = verifyChatEnvelopeWithRuntime({
        senderPubKey: peerPubKey,
        recipientPubKey: String(payload.peerPubKey || ''),
        ciphertext: String(payload.ciphertext || ''),
        nonce: String(payload.nonce || ''),
        authTag: String(payload.authTag || ''),
        msgId,
        sessionId: String(payload.sessionId || ''),
        fromWalletId,
        toWalletId,
        ts,
        orderId: String(payload.orderId || ''),
        signature: String(payload.signature || ''),
        password: bridgePassword,
      });
      let plainText = String(payload.previewText || '');
      const decryptedInboxText = current.walletId === toWalletId && payload.ciphertext && payload.nonce && payload.authTag
        ? decryptChatEnvelopeWithRuntime({
          senderPubKey: peerPubKey,
          ciphertext: String(payload.ciphertext || ''),
          nonce: String(payload.nonce || ''),
          authTag: String(payload.authTag || ''),
          password: bridgePassword,
        })
        : '';
      const decryptedSentText = current.walletId === fromWalletId && payload.ciphertext && payload.nonce && payload.authTag && payload.peerPubKey
        ? decryptChatEnvelopeWithPeerPubKey({
          peerPubKey: String(payload.peerPubKey || ''),
          ciphertext: String(payload.ciphertext || ''),
          nonce: String(payload.nonce || ''),
          authTag: String(payload.authTag || ''),
          password: bridgePassword,
        })
        : '';
      const decryptedText = decryptedInboxText || decryptedSentText;
      if (!signatureOk && !decryptedText) continue;
      if (decryptedText) plainText = decryptedText;
      await chatDomain.emitChatEvent('chat.message.anchored', {
        selfWalletId,
        peerWalletId,
        msgId,
        sessionId: String(payload.sessionId || ''),
        direction: fromWalletId === current.walletId ? 'out' : 'in',
        transport: 'onchain',
        text: plainText,
        orderId: String(payload.orderId || ''),
        ts,
        status: row?.confirmed === true || row?.publicVisible === true ? 'visible' : 'broadcasted',
        txid: String(row?.txid || ''),
        displayName: firstUsefulDisplayName(peerWalletId, [
          state.chatDiscovery?.profiles?.[peerWalletId]?.displayName,
          state.chatDiscovery?.profiles?.[peerWalletId]?.name,
          threadByWalletIdSafe(state, peerWalletId)?.displayName,
          state.chatDiscovery?.profiles?.[peerWalletId]?.merchantId,
          peerWalletId,
        ]),
      }, {
        producer: 'anchor_bridge',
        entityType: 'chat_message',
        entityId: msgId,
        dedupeKey: `chat_message_anchored:${selfWalletId}:${peerWalletId}:${msgId}:${String(row?.txid || '')}`,
      });
      stateChanged = true;
    }
    if (incremental && lastProcessedCursor !== lastCursor) {
      bridgeState.lastCursor = lastProcessedCursor;
      if (compareChatAnchorCursor(lastProcessedCursor, chatAnchorBridgeLastCursorMemory) > 0) {
        chatAnchorBridgeLastCursorMemory = lastProcessedCursor;
      }
      stateChanged = true;
    }
    return {
      stateChanged,
      lastCursor: String(bridgeState.lastCursor || lastProcessedCursor || ''),
    };
  }

  function rebuildWalletKeyBindingsFromAnchors(state, req = null) {
    ensureChatState(state, req);
    state.chatIdentity.pubkeyBindings = {};
    state.chatIdentity.walletKeyIndex = {};
    state.chatIdentity.conflicts = [];
    const profiles = state.chatDiscovery?.profiles && typeof state.chatDiscovery.profiles === 'object'
      ? state.chatDiscovery.profiles
      : {};
    Object.keys(profiles).forEach((walletId) => {
      const existing = profiles[walletId];
      profiles[walletId] = {
        ...(existing && typeof existing === 'object' ? existing : {}),
        chatPubKeys: [],
        endpointHints: Array.isArray(existing?.endpointHints) ? existing.endpointHints.slice(0, 8) : [],
        relayHints: Array.isArray(existing?.relayHints) ? existing.relayHints.slice(0, 8) : [],
      };
    });
    const sorted = getChatRelevantAnchorRows(state).filter((row) => String(row?.eventType || '').trim() === 'wallet_key_bind').sort((a, b) => {
      const ta = Date.parse(String(a?.ts || '')) || 0;
      const tb = Date.parse(String(b?.ts || '')) || 0;
      if (ta !== tb) return ta - tb;
      return String(a?.txid || '').localeCompare(String(b?.txid || ''));
    });
    const winningBindByPubKey = new Map();
    sorted.forEach((row) => {
      const payload = normalizeEventPayload('wallet_key_bind', row?.payload || {}, String(row?.ts || ''));
      const walletId = String(payload.walletId || '').trim();
      const merchantId = String(payload.merchantId || '').trim();
      const chatPubKey = String(payload.chatPubKey || '').trim();
      if (!walletId || !chatPubKey || !verifyWalletKeyBindPayload(payload)) return;
      const candidate = {
        chatPubKey,
        walletId,
        merchantId,
        firstBindTxid: String(row?.txid || ''),
        firstBindHeight: Math.max(0, Number(row?.height || 0)),
        firstBindConfirmed: row?.confirmed === true,
        firstBindCreatedAt: String(payload._updatedAt || row?.ts || ''),
        signature: String(payload.signature || ''),
      };
      const existing = winningBindByPubKey.get(chatPubKey);
      if (!existing || compareWalletKeyBindPriority(candidate, existing) < 0) winningBindByPubKey.set(chatPubKey, candidate);
    });
    sorted.forEach((row) => {
      if (String(row?.eventType || '').trim() !== 'wallet_key_bind') return;
      const payload = normalizeEventPayload('wallet_key_bind', row?.payload || {}, String(row?.ts || ''));
      const walletId = String(payload.walletId || '').trim();
      const merchantId = String(payload.merchantId || '').trim();
      const chatPubKey = String(payload.chatPubKey || '').trim();
      if (!walletId || !chatPubKey || !verifyWalletKeyBindPayload(payload)) return;
      const winner = winningBindByPubKey.get(chatPubKey);
      if (!winner || String(winner.walletId || '') !== walletId || String(winner.firstBindTxid || '') !== String(row?.txid || '')) return;
      const result = upsertWalletKeyBinding(state, {
        chatPubKey,
        walletId,
        merchantId,
        firstBindTxid: String(row?.txid || ''),
        firstBindHeight: Math.max(0, Number(row?.height || 0)),
        firstBindConfirmed: row?.confirmed === true,
        firstBindCreatedAt: String(payload._updatedAt || row?.ts || ''),
        signature: String(payload.signature || ''),
      });
      if (!result?.ok) return;
      state.chatDiscovery.profiles[walletId] = {
        ...(state.chatDiscovery.profiles[walletId] || {}),
        walletId,
        merchantId,
        chatPubKeys: [chatPubKey],
        endpointHints: Array.isArray(payload.endpointHints) ? payload.endpointHints.slice(0, 8) : [],
        relayHints: Array.isArray(payload.relayHints) ? payload.relayHints.slice(0, 8) : [],
        updatedAt: String(payload._updatedAt || row?.ts || ''),
        verified: true,
      };
    });
  }

  function rebuildRegisteredPeerProfilesFromAnchors(state, req = null) {
    ensureChatState(state, req);
    const profiles = state.chatDiscovery?.profiles && typeof state.chatDiscovery.profiles === 'object'
      ? state.chatDiscovery.profiles
      : {};
    const profileNameByMerchant = new Map();
    const profileNameByWalletId = new Map();
    const sorted = getChatRelevantAnchorRows(state).sort((a, b) => {
      const ta = Date.parse(String(a?.ts || '')) || 0;
      const tb = Date.parse(String(b?.ts || '')) || 0;
      if (ta !== tb) return ta - tb;
      return String(a?.txid || '').localeCompare(String(b?.txid || ''));
    });
    sorted.forEach((row) => {
      if (String(row?.eventType || '').trim() !== 'profile_set') return;
      const payload = normalizeEventPayload('profile_set', row?.payload || {}, String(row?.ts || ''));
      const merchantId = String(payload.merchantId || row?.merchant_id || '').trim();
      const name = String(payload.name || '').trim();
      if (!merchantId || !name) return;
      profileNameByMerchant.set(merchantId, name);
    });
    Object.keys(profiles).forEach((walletId) => {
      const row = profiles[walletId];
      const merchantId = String(row?.merchantId || '').trim();
      const name = merchantId ? String(profileNameByMerchant.get(merchantId) || '').trim() : '';
      profileNameByWalletId.set(walletId, name);
    });
    Object.keys(profiles).forEach((walletId) => {
      const existing = profiles[walletId];
      const merchantId = String(existing?.merchantId || '').trim();
      const name = String(profileNameByWalletId.get(walletId) || '').trim();
      profiles[walletId] = {
        ...(existing && typeof existing === 'object' ? existing : {}),
        walletId,
        merchantId,
        displayName: firstUsefulDisplayName(walletId, [
          existing?.displayName,
          existing?.name,
          name,
          merchantId,
          walletId,
        ]),
        name: name || String(existing?.name || ''),
      };
    });
  }

  function mergeChatArtifactsFromAnchors(state, req = null, options = {}) {
    ensureChatState(state, req);
    syncChatThreadsFromUsers(state, req);
    const current = getCurrentWalletIdentity(state, req);
    const incremental = options?.incremental === true;
    const bridgeState = incremental ? getChatAnchorBridgeState(state) : null;
    const lastCursor = incremental ? String(bridgeState?.lastCursor || '') : '';
    let lastProcessedCursor = lastCursor;
    const sorted = getChatRelevantAnchorRows(state).sort((a, b) => {
      const ta = Date.parse(String(a?.ts || '')) || 0;
      const tb = Date.parse(String(b?.ts || '')) || 0;
      if (ta !== tb) return ta - tb;
      return String(a?.txid || '').localeCompare(String(b?.txid || ''));
    });
    const winningBindByPubKey = new Map();
    sorted.forEach((a) => {
      if (String(a?.eventType || '').trim() !== 'wallet_key_bind') return;
      const payload = normalizeEventPayload('wallet_key_bind', a?.payload || {}, String(a?.ts || ''));
      const walletId = String(payload.walletId || '').trim();
      const merchantId = String(payload.merchantId || '').trim();
      const chatPubKey = String(payload.chatPubKey || '').trim();
      if (!walletId || !chatPubKey || !verifyWalletKeyBindPayload(payload)) return;
      const candidate = {
        chatPubKey,
        walletId,
        merchantId,
        firstBindTxid: String(a?.txid || ''),
        firstBindHeight: Math.max(0, Number(a?.height || 0)),
        firstBindConfirmed: a?.confirmed === true,
        firstBindCreatedAt: String(payload._updatedAt || a?.ts || ''),
        signature: String(payload.signature || ''),
      };
      const existing = winningBindByPubKey.get(chatPubKey);
      if (!existing || compareWalletKeyBindPriority(candidate, existing) < 0) winningBindByPubKey.set(chatPubKey, candidate);
    });
    sorted.forEach((a) => {
      const payload = normalizeEventPayload(a.eventType, a.payload || {}, String(a.ts || ''));
      const cursor = buildChatAnchorCursor(a, payload);
      if (a.eventType === 'wallet_key_bind') {
        const walletId = String(payload.walletId || '').trim();
        const merchantId = String(payload.merchantId || '').trim();
        const chatPubKey = String(payload.chatPubKey || '').trim();
        if (!walletId || !chatPubKey) return;
        if (!verifyWalletKeyBindPayload(payload)) {
          appendMarketDebug('chat_bind_signature_invalid', {
            walletId,
            merchantId,
            chatPubKey,
            txid: String(a.txid || ''),
          });
          return;
        }
        const winner = winningBindByPubKey.get(chatPubKey);
        if (!winner || String(winner.walletId || '') !== walletId || String(winner.firstBindTxid || '') !== String(a.txid || '')) return;
        const bind = upsertWalletKeyBinding(state, {
          chatPubKey,
          walletId,
          merchantId,
          firstBindTxid: String(a.txid || ''),
          firstBindHeight: Math.max(0, Number(a.height || 0)),
          firstBindConfirmed: a.confirmed === true,
          firstBindCreatedAt: String(payload._updatedAt || a.ts || ''),
          signature: String(payload.signature || ''),
        });
        if (bind.ok) {
          const thread = ensureChatThread(state, walletId, {
            merchantId,
            displayName: firstUsefulDisplayName(walletId, [
              merchantId === current.merchantId ? state.profile?.name : '',
              threadByWalletIdSafe(state, walletId)?.displayName,
              merchantId,
              walletId,
            ]),
          });
          if (thread && !thread.pubkeys.includes(chatPubKey)) thread.pubkeys.push(chatPubKey);
          state.chatDiscovery.profiles[walletId] = {
            walletId,
            merchantId,
            chatPubKeys: [chatPubKey],
            endpointHints: Array.isArray(payload.endpointHints) ? payload.endpointHints.slice(0, 8) : [],
            relayHints: Array.isArray(payload.relayHints) ? payload.relayHints.slice(0, 8) : [],
            updatedAt: String(payload._updatedAt || a.ts || ''),
            verified: true,
          };
        }
        return;
      }
      if (a.eventType !== 'chat_message') return;
      if (incremental && compareChatAnchorCursor(cursor, lastCursor) <= 0) return;
      lastProcessedCursor = cursor;
      const fromWalletId = String(payload.fromWalletId || '').trim();
      const toWalletId = String(payload.toWalletId || '').trim();
      if (!fromWalletId || !toWalletId) return;
      if (fromWalletId !== current.walletId && toWalletId !== current.walletId) return;
      const peerWalletId = fromWalletId === current.walletId ? toWalletId : fromWalletId;
      const peerPubKey = String(payload.fromPubKey || payload.peerPubKey || '').trim();
      const boundSenderWalletId = getWalletIdForChatPubKey(state, peerPubKey);
      if (!boundSenderWalletId || boundSenderWalletId !== fromWalletId) {
        appendMarketDebug('chat_onchain_sender_mismatch', {
          txid: String(a.txid || ''),
          fromWalletId,
          boundSenderWalletId,
          peerPubKey,
        });
        return;
      }
      const txid = String(a.txid || '');
      const ts = String(payload._updatedAt || a.ts || new Date().toISOString());
      const msgId = String(payload.msgId || `onchain:${txid}`).trim();
      const signatureOk = verifyChatEnvelopeWithRuntime({
        senderPubKey: peerPubKey,
        recipientPubKey: String(payload.peerPubKey || ''),
        ciphertext: String(payload.ciphertext || ''),
        nonce: String(payload.nonce || ''),
        authTag: String(payload.authTag || ''),
        msgId,
        sessionId: String(payload.sessionId || ''),
        fromWalletId,
        toWalletId,
        ts,
        orderId: String(payload.orderId || ''),
        signature: String(payload.signature || ''),
      });
      let plainText = String(payload.previewText || '');
      const decryptedInboxText = current.walletId === toWalletId && payload.ciphertext && payload.nonce && payload.authTag
        ? decryptChatEnvelopeWithRuntime({
          senderPubKey: peerPubKey,
          ciphertext: String(payload.ciphertext || ''),
          nonce: String(payload.nonce || ''),
          authTag: String(payload.authTag || ''),
        })
        : '';
      const decryptedSentText = current.walletId === fromWalletId && payload.ciphertext && payload.nonce && payload.authTag && payload.peerPubKey
        ? decryptChatEnvelopeWithPeerPubKey({
          peerPubKey: String(payload.peerPubKey || ''),
          ciphertext: String(payload.ciphertext || ''),
          nonce: String(payload.nonce || ''),
          authTag: String(payload.authTag || ''),
        })
        : '';
      const decryptedText = decryptedInboxText || decryptedSentText;
      if (!signatureOk && !decryptedText) {
        appendMarketDebug('chat_onchain_signature_invalid', {
          txid,
          fromWalletId,
          toWalletId,
          peerWalletId,
        });
        return;
      }
      if (!signatureOk && decryptedText) {
        appendMarketDebug('chat_onchain_signature_fallback', {
          txid,
          fromWalletId,
          toWalletId,
          peerWalletId,
        });
      }
      if (decryptedText) plainText = decryptedText;
      ensureChatThread(state, peerWalletId, {
        merchantId: String(state.chatIdentity?.walletKeyIndex?.[peerWalletId]?.merchantId || ''),
        displayName: firstUsefulDisplayName(peerWalletId, [
          threadByWalletIdSafe(state, peerWalletId)?.displayName,
          state.chatDiscovery?.profiles?.[peerWalletId]?.displayName,
          state.chatDiscovery?.profiles?.[peerWalletId]?.name,
          peerWalletId,
        ]),
      });
      appendChatMessage(state, {
        msgId,
        sessionId: String(payload.sessionId || ''),
        walletId: peerWalletId,
        peerPubKey,
        transport: 'onchain',
        direction: fromWalletId === current.walletId ? 'out' : 'in',
        text: plainText,
        ciphertext: String(payload.ciphertext || ''),
        nonce: String(payload.nonce || ''),
        authTag: String(payload.authTag || ''),
        signature: String(payload.signature || ''),
        txid,
        status: a.confirmed === true || a.publicVisible === true ? 'visible' : 'broadcasted',
        ts,
        feeSat: Math.max(0, Number(a.feeSat || 0)),
      });
    });
    if (incremental && lastProcessedCursor !== lastCursor) {
      bridgeState.lastCursor = lastProcessedCursor;
      if (compareChatAnchorCursor(lastProcessedCursor, chatAnchorBridgeLastCursorMemory) > 0) {
        chatAnchorBridgeLastCursorMemory = lastProcessedCursor;
      }
    }
  }

  async function rebuildDataFromLocalAnchors(state, req = null, options = {}) {
    const effectiveState = state && typeof state === 'object' ? state : buildProjectionBackedState(req);
    const reason = String(options.reason || 'manual_data_rebuild');
    const source = String(options.source || 'manual_data_rebuild');
    const chatOnly = options?.chatOnly === true;
    const stageTimings = [];
    const recordStage = (stage, startedAt) => {
      const elapsedMs = Date.now() - startedAt;
      stageTimings.push({ stage, elapsedMs });
      appendMarketDebug('rebuild_data_from_local_anchors_stage', {
        reason,
        source,
        chatOnly,
        stage,
        elapsedMs,
      });
    };

    if (!chatOnly) {
      let startedAt = Date.now();
      rebuildCatalogFromAnchors(effectiveState, req, { persistSnapshot: true });
      recordStage('rebuildCatalogFromAnchors', startedAt);
      await yieldToEventLoop();
    }

    let startedAt = Date.now();
    await bridgeChatFactsToDomain(effectiveState, req, {
      incremental: chatOnly,
      reason,
    });
    recordStage('bridgeChatFactsToDomain', startedAt);
    await yieldToEventLoop();

    startedAt = Date.now();
    rebuildChatUiSummary(effectiveState);
    recordStage('rebuildChatUiSummary', startedAt);
    await yieldToEventLoop();

    startedAt = Date.now();
    await persistChatRuntimeProjectionFromState(effectiveState, req);
    recordStage('persistChatRuntimeProjectionFromState', startedAt);
    await yieldToEventLoop();

    if (!chatOnly) {
      startedAt = Date.now();
      await writeStateJsonSnapshot(effectiveState, {
        reason: String(options.reason || 'manual_data_rebuild_saved'),
      });
      recordStage('writeStateJsonSnapshot', startedAt);
      persistCatalogSnapshotAsync(effectiveState);
      persistProfileSnapshotAsync(effectiveState, { delayMs: 0 });
    }

    startedAt = Date.now();
    commitChatRuntimeState(effectiveState, {
      writeJson: false,
      refresh: false,
      reason,
    });
    recordStage('commitChatRuntimeState', startedAt);
    await yieldToEventLoop();

    startedAt = Date.now();
    await rebuildPublicStateCache({
      state: effectiveState,
      req: req || getRuntimeReq(),
      source,
      skipRuntimeCommit: true,
    });
    recordStage('rebuildPublicStateCache', startedAt);
    appendMarketDebug('rebuild_data_from_local_anchors_done', {
      reason,
      source,
      chatOnly,
      totalElapsedMs: stageTimings.reduce((sum, row) => sum + Number(row?.elapsedMs || 0), 0),
      stages: stageTimings,
    });
    return effectiveState;
  }

  function refreshChatArtifacts(state, req = null) {
    return withHotPathDebug('refreshChatArtifacts', () => {
      ensureChatState(state, req);
      const lastRefreshedAt = Math.max(0, Number(state?.chatUi?.artifactsRefreshedAt || 0));
      const now = Date.now();
      if ((now - lastRefreshedAt) < 15000) {
        return state;
      }
      state.chatUi.artifactsRefreshedAt = now;
      return state;
    }, () => ({
      anchors: getPendingAnchorOverlay(state).length,
      messages: state?.chatMessages && typeof state.chatMessages === 'object'
        ? Object.keys(state.chatMessages).length
        : 0,
      threads: state?.chatThreads && typeof state.chatThreads === 'object'
        ? Object.keys(state.chatThreads).length
        : 0,
    }));
  }

  return {
    buildChatThreadOverlayMessageFromAnchorRow,
    mergeChatThreadOverlayMessages,
    getChatAnchorBridgeState,
    buildChatAnchorCursor,
    compareChatAnchorCursor,
    scheduleChatAnchorBridge,
    maybeBridgeChatFactsForColdRead,
    bridgeChatFactsToDomain,
    rebuildWalletKeyBindingsFromAnchors,
    rebuildRegisteredPeerProfilesFromAnchors,
    mergeChatArtifactsFromAnchors,
    rebuildDataFromLocalAnchors,
    refreshChatArtifacts,
  };
}

module.exports = {
  createChatAnchorBridgeService,
};
