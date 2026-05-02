function createChatPayloadService(deps = {}) {
  const {
    CHAT_MODULE_ENABLED,
    marketDb,
    defaultChatIdentity,
    buildChatReadState,
    ensureChatState,
    syncChatThreadsFromUsers,
    rebuildChatUiSummary,
    ensureSelfChatIdentity,
    getSelfChatIdentity,
    ensureChatThread,
    getThreadConnectionSummary,
    listChatMessagesForWallet,
    getSendPreviewForWallet,
    getPreferredPeerChatPubKey,
    isPeerManuallyDisconnected,
    appendMarketDebug,
    allowNodeHttpDiscovery = false,
  } = deps;

  const remoteProfileCache = new Map();

  function normalizeHttpEndpoint(value = '') {
    const raw = String(value || '').trim();
    if (!raw || raw === 'null' || raw === 'undefined') return '';
    try {
      const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
      const url = new URL(withProtocol);
      if (!/^https?:$/i.test(url.protocol)) return '';
      url.hash = '';
      url.search = '';
      url.pathname = url.pathname.replace(/\/+$/, '');
      return url.toString().replace(/\/+$/, '');
    } catch (_) {
      return '';
    }
  }

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

  function merchantIdFromWalletId(walletId = '') {
    const peerWalletId = String(walletId || '').trim();
    if (!peerWalletId.startsWith('wallet-')) return '';
    const raw = peerWalletId.slice('wallet-'.length).trim();
    return raw ? raw.replace(/^m/i, 'm-') : '';
  }

  function merchantNameFromState(state, merchantId = '') {
    const targetId = String(merchantId || '').trim();
    if (!targetId) return '';
    const merchants = Array.isArray(state?.merchants) ? state.merchants : [];
    const found = merchants.find((merchant) => String(merchant?.id || '').trim() === targetId);
    return firstUsefulDisplayName('', [
      found?.displayName,
      found?.name,
    ]);
  }

  function getManualPeerEndpoint(state, walletId = '') {
    const peerWalletId = String(walletId || '').trim();
    const endpoint = peerWalletId && state?.chatConfig?.manualPeerEndpoints
      && typeof state.chatConfig.manualPeerEndpoints === 'object'
      ? state.chatConfig.manualPeerEndpoints[peerWalletId]
      : '';
    return normalizeHttpEndpoint(endpoint);
  }

  async function fetchRemoteProfileFromEndpoint(walletId, endpoint) {
    const peerWalletId = String(walletId || '').trim();
    const normalizedEndpoint = normalizeHttpEndpoint(endpoint);
    if (!peerWalletId || !normalizedEndpoint || typeof fetch !== 'function') return null;
    if (allowNodeHttpDiscovery !== true) {
      if (typeof appendMarketDebug === 'function') {
        appendMarketDebug('chat_remote_profile_http_disabled', {
          walletId: peerWalletId,
          endpoint: normalizedEndpoint,
        });
      }
      return null;
    }
    const cacheKey = `${peerWalletId}|${normalizedEndpoint}`;
    const cached = remoteProfileCache.get(cacheKey);
    const now = Date.now();
    const cacheTtlMs = cached?.profile ? 10 * 60 * 1000 : 15 * 1000;
    if (cached && now - Number(cached.cachedAt || 0) < cacheTtlMs) {
      return cached.profile || null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(250, Number(process.env.BSV_MARKET_CHAT_REMOTE_PROFILE_TIMEOUT_MS || 2000)));
    try {
      let response = await fetch(`${normalizedEndpoint}/api/chat/public-profile`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      let payload = null;
      if (response.ok) {
        payload = await response.json();
      } else if (response.status === 404 || response.status === 410) {
        response = await fetch(`${normalizedEndpoint}/api/state-lite`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
      }
      if (!response.ok) throw new Error(`state-lite ${response.status}`);
      if (!payload) payload = await response.json();
      const publicProfile = payload?.profile && typeof payload.profile === 'object' ? payload.profile : null;
      const remoteState = payload?.state && typeof payload.state === 'object' ? payload.state : payload;
      const remoteWalletId = String(
        publicProfile?.walletId
        || remoteState?.chatIdentity?.self?.walletId
        || walletIdFromMerchantId(publicProfile?.merchantId || remoteState?.currentMerchantId || '')
        || '',
      ).trim();
      const merchantId = String(publicProfile?.merchantId || remoteState?.currentMerchantId || '').trim();
      const merchantWalletId = walletIdFromMerchantId(merchantId);
      if ((remoteWalletId && remoteWalletId !== peerWalletId) || (merchantWalletId && merchantWalletId !== peerWalletId)) {
        if (typeof appendMarketDebug === 'function') {
          appendMarketDebug('chat_remote_profile_identity_mismatch', {
            requestedWalletId: peerWalletId,
            endpoint: normalizedEndpoint,
            remoteWalletId,
            remoteMerchantId: merchantId,
            remoteMerchantWalletId: merchantWalletId,
          });
        }
        remoteProfileCache.set(cacheKey, { cachedAt: now, profile: null });
        return null;
      }
      const name = String(publicProfile?.displayName || publicProfile?.name || remoteState?.profile?.name || remoteState?.chatConfig?.displayName || '').trim();
      const profile = {
        walletId: peerWalletId,
        merchantId,
        displayName: firstUsefulDisplayName(peerWalletId, [name, merchantId, peerWalletId]),
        name,
        endpoint: normalizedEndpoint,
      };
      remoteProfileCache.set(cacheKey, { cachedAt: now, profile });
      return profile;
    } catch (error) {
      remoteProfileCache.set(cacheKey, { cachedAt: now, profile: null });
      if (typeof appendMarketDebug === 'function') {
        appendMarketDebug('chat_remote_profile_fetch_failed', {
          walletId: peerWalletId,
          endpoint: normalizedEndpoint,
          name: String(error?.name || ''),
          cause: String(error?.cause?.message || error?.cause || ''),
          message: String(error?.message || error || 'fetch_failed'),
        });
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function hydrateManualEndpointDisplayNames(state, peerRowsByWalletId, threadMap) {
    const entries = [];
    for (const [walletId, row] of peerRowsByWalletId.entries()) {
      const currentName = String(row?.displayName || threadMap.get(walletId)?.displayName || walletId).trim();
      if (!looksLikeGeneratedChatName(currentName, walletId)) continue;
      const endpoint = getManualPeerEndpoint(state, walletId);
      if (!endpoint) continue;
      entries.push({ walletId, endpoint });
    }
    if (entries.length <= 0) return;
    const profiles = await Promise.all(entries.map((entry) => fetchRemoteProfileFromEndpoint(entry.walletId, entry.endpoint)));
    profiles.forEach((profile) => {
      if (!profile?.walletId) return;
      const existing = peerRowsByWalletId.get(profile.walletId) || { walletId: profile.walletId };
      const displayName = firstUsefulDisplayName(profile.walletId, [
        existing.displayName,
        profile.displayName,
        profile.name,
        profile.merchantId,
        profile.walletId,
      ]);
      peerRowsByWalletId.set(profile.walletId, {
        ...existing,
        merchantId: String(existing.merchantId || profile.merchantId || '').trim(),
        displayName,
      });
      if (!state.chatDiscovery || typeof state.chatDiscovery !== 'object') state.chatDiscovery = { profiles: {}, invites: {} };
      if (!state.chatDiscovery.profiles || typeof state.chatDiscovery.profiles !== 'object') state.chatDiscovery.profiles = {};
      const existingProfile = state.chatDiscovery.profiles[profile.walletId] || {};
      state.chatDiscovery.profiles[profile.walletId] = {
        ...existingProfile,
        ...profile,
        displayName: firstUsefulDisplayName(profile.walletId, [
          existingProfile.displayName,
          existingProfile.name,
          displayName,
          profile.displayName,
          profile.name,
          profile.merchantId,
          profile.walletId,
        ]),
      };
    });
  }

  function getChatThreadsPayload(state, req = null) {
    ensureChatState(state, req);
    syncChatThreadsFromUsers(state, req);
    rebuildChatUiSummary(state);
    return Object.values(state.chatThreads || {})
      .map((thread) => {
        const conn = getThreadConnectionSummary(state, thread.walletId);
        const messages = typeof listChatMessagesForWallet === 'function'
          ? listChatMessagesForWallet(state, thread.walletId)
          : [];
        const latest = Array.isArray(messages) && messages.length ? messages[messages.length - 1] : null;
        const threadMs = Date.parse(String(thread.lastMessageAt || '')) || 0;
        const latestMs = Date.parse(String(latest?.ts || '')) || 0;
        const lastMessageAt = latestMs > threadMs ? String(latest.ts || '') : String(thread.lastMessageAt || '');
        return {
          walletId: String(thread.walletId || ''),
          merchantId: String(thread.merchantId || ''),
          displayName: resolvePeerDisplayName(state, thread.walletId, thread.displayName || thread.walletId),
          unreadCount: Math.max(0, Number(thread.unreadCount || 0)),
          lastMessageAt,
          directConnected: conn.directConnected,
          connecting: conn.connecting,
          hasInvite: Boolean(thread.hasInvite),
        };
      })
      .sort((a, b) => Date.parse(String(b.lastMessageAt || '')) - Date.parse(String(a.lastMessageAt || '')));
  }

  function readChatThreadBundleDirect(selfWalletId) {
    const walletId = String(selfWalletId || '').trim();
    if (!walletId) {
      return {
        threadRows: [],
        presenceByPeerWalletId: {},
        contactByPeerWalletId: {},
        selfState: null,
      };
    }
    const db = marketDb.openReadDb();
    try {
      const latestMessage = db.prepare(`
        SELECT
          msg_id,
          ts,
          text,
          transport,
          source_event_seq,
          updated_at
        FROM chat_message_index_projection
        WHERE self_wallet_id = ? AND peer_wallet_id = ?
        ORDER BY ts DESC, msg_id DESC
        LIMIT 1
      `);
      const threadRows = db.prepare(`
        SELECT
          self_wallet_id,
          peer_wallet_id,
          thread_id,
          display_name,
          unread_count,
          last_message_id,
          last_message_at,
          last_message_preview,
          last_transport,
          last_read_at,
          last_event_seq,
          updated_at
        FROM chat_thread_status_projection
        WHERE self_wallet_id = ?
        ORDER BY last_message_at DESC, peer_wallet_id ASC
      `).all(walletId).map((row) => ({
        selfWalletId: String(row.self_wallet_id || ''),
        peerWalletId: String(row.peer_wallet_id || ''),
        threadId: String(row.thread_id || ''),
        displayName: String(row.display_name || ''),
        unreadCount: Math.max(0, Number(row.unread_count || 0)),
        lastMessageId: String(row.last_message_id || ''),
        lastMessageAt: String(row.last_message_at || ''),
        lastMessagePreview: String(row.last_message_preview || ''),
        lastTransport: String(row.last_transport || ''),
        lastReadAt: String(row.last_read_at || ''),
        lastEventSeq: Math.max(0, Number(row.last_event_seq || 0)),
        updatedAt: String(row.updated_at || ''),
      })).map((row) => {
        const latest = latestMessage.get(walletId, row.peerWalletId);
        if (!latest) return row;
        const currentMs = Date.parse(String(row.lastMessageAt || '')) || 0;
        const latestMs = Date.parse(String(latest.ts || '')) || 0;
        const currentId = String(row.lastMessageId || '');
        const latestId = String(latest.msg_id || '');
        const isNewer = latestMs > currentMs || (latestMs === currentMs && latestId && currentId && latestId.localeCompare(currentId) > 0);
        if (!isNewer) return row;
        return {
          ...row,
          lastMessageId: latestId,
          lastMessageAt: String(latest.ts || row.lastMessageAt || ''),
          lastMessagePreview: String(latest.text || row.lastMessagePreview || '').slice(0, 280),
          lastTransport: String(latest.transport || row.lastTransport || ''),
          lastEventSeq: Math.max(row.lastEventSeq || 0, Number(latest.source_event_seq || 0)),
          updatedAt: String(latest.updated_at || row.updatedAt || ''),
        };
      }).sort((a, b) => {
        const ta = Date.parse(String(a.lastMessageAt || '')) || 0;
        const tb = Date.parse(String(b.lastMessageAt || '')) || 0;
        if (ta !== tb) return tb - ta;
        return String(a.peerWalletId || '').localeCompare(String(b.peerWalletId || ''));
      });
      const presenceRows = db.prepare(`
        SELECT
          self_wallet_id,
          peer_wallet_id,
          status,
          updated_at
        FROM chat_presence_projection
        WHERE self_wallet_id = ?
      `).all(walletId).map((row) => ({
        selfWalletId: String(row.self_wallet_id || ''),
        peerWalletId: String(row.peer_wallet_id || ''),
        status: String(row.status || ''),
        updatedAt: String(row.updated_at || ''),
      }));
      const contactRows = db.prepare(`
        SELECT
          self_wallet_id,
          peer_wallet_id,
          is_friend,
          friend_status,
          blocked,
          updated_at
        FROM chat_contact_projection
        WHERE self_wallet_id = ?
      `).all(walletId).map((row) => ({
        selfWalletId: String(row.self_wallet_id || ''),
        peerWalletId: String(row.peer_wallet_id || ''),
        isFriend: Number(row.is_friend || 0) === 1,
        friendStatus: String(row.friend_status || 'none'),
        blocked: Number(row.blocked || 0) === 1,
        updatedAt: String(row.updated_at || ''),
      }));
      const selfStateRow = db.prepare(`
        SELECT
          self_wallet_id,
          online,
          storage_limit_bytes,
          updated_at
        FROM chat_self_state_projection
        WHERE self_wallet_id = ?
      `).get(walletId);
      return {
        threadRows,
        presenceByPeerWalletId: Object.fromEntries(presenceRows.map((row) => [row.peerWalletId, row])),
        contactByPeerWalletId: Object.fromEntries(contactRows.map((row) => [row.peerWalletId, row])),
        selfState: selfStateRow
          ? {
              selfWalletId: String(selfStateRow.self_wallet_id || ''),
              online: Number(selfStateRow.online || 0) === 1,
              storageLimitBytes: Math.max(1024, Number(selfStateRow.storage_limit_bytes || 104857600)),
              updatedAt: String(selfStateRow.updated_at || ''),
            }
          : null,
      };
    } finally {
      db.close();
    }
  }

  function buildChatMessageOrderFilter(orderId = null) {
    const safeOrderId = orderId == null ? null : String(orderId || '').trim();
    if (safeOrderId == null) return { sql: '', params: [] };
    if (!safeOrderId) return { sql: " AND COALESCE(order_id, '') = ''", params: [] };
    return { sql: ' AND order_id = ?', params: [safeOrderId] };
  }

  function getThreadOrderQueryFilter(req = {}) {
    if (!req?.query || !Object.prototype.hasOwnProperty.call(req.query, 'orderId')) return null;
    return String(req.query.orderId || '').trim();
  }

  function readChatMessagePageDirect(selfWalletId, peerWalletId, pageSize = 10, page = 1, orderId = null) {
    const selfId = String(selfWalletId || '').trim();
    const peerId = String(peerWalletId || '').trim();
    if (!selfId || !peerId) return [];
    const safePageSize = Math.max(1, Math.min(100, Number(pageSize || 10)));
    const safePage = Math.max(1, Number(page || 1));
    const offset = (safePage - 1) * safePageSize;
    const orderFilter = buildChatMessageOrderFilter(orderId);
    const db = marketDb.openReadDb();
    try {
      const params = [selfId, peerId, ...orderFilter.params, safePageSize, offset];
      return db.prepare(`
        SELECT
          self_wallet_id,
          peer_wallet_id,
          msg_id,
          thread_id,
          direction,
          transport,
          text,
          order_id,
          ts,
          status,
          txid,
          source_event_seq,
          updated_at
        FROM (
          SELECT
            self_wallet_id,
            peer_wallet_id,
            msg_id,
            thread_id,
            direction,
            transport,
            text,
            order_id,
            ts,
            status,
          txid,
          source_event_seq,
          updated_at
        FROM chat_message_index_projection
          WHERE self_wallet_id = ? AND peer_wallet_id = ?
          ${orderFilter.sql}
          ORDER BY ts DESC, source_event_seq DESC, msg_id DESC
          LIMIT ? OFFSET ?
        )
        ORDER BY ts ASC, source_event_seq ASC, msg_id ASC
      `).all(...params).map((row) => ({
        selfWalletId: String(row.self_wallet_id || ''),
        peerWalletId: String(row.peer_wallet_id || ''),
        msgId: String(row.msg_id || ''),
        threadId: String(row.thread_id || ''),
        direction: String(row.direction || ''),
        transport: String(row.transport || ''),
        text: String(row.text || ''),
        orderId: String(row.order_id || ''),
        ts: String(row.ts || ''),
        status: String(row.status || ''),
        txid: String(row.txid || ''),
        sourceEventSeq: Math.max(0, Number(row.source_event_seq || 0)),
        updatedAt: String(row.updated_at || ''),
      }));
    } finally {
      db.close();
    }
  }

  function resolvePeerDisplayName(state, walletId, fallback = '') {
    const peerWalletId = String(walletId || '').trim();
    const profile = peerWalletId
      ? (state?.chatDiscovery?.profiles?.[peerWalletId] || null)
      : null;
    const manualName = peerWalletId && state?.chatConfig?.manualPeerNames
      && typeof state.chatConfig.manualPeerNames === 'object'
      ? String(state.chatConfig.manualPeerNames[peerWalletId] || '').trim()
      : '';
    const merchantId = String(profile?.merchantId || '').trim();
    const expectedMerchantId = merchantIdFromWalletId(peerWalletId);
    const expectedMerchantName = merchantNameFromState(state, expectedMerchantId);
    const profileMerchantName = merchantId && merchantId === expectedMerchantId
      ? merchantNameFromState(state, merchantId)
      : '';
    return firstUsefulDisplayName(peerWalletId, [
      manualName,
      expectedMerchantName,
      profileMerchantName,
      profile?.displayName,
      profile?.name,
      fallback,
      merchantId,
      peerWalletId,
    ]);
  }

  function walletIdFromMerchantId(merchantId = '') {
    const safe = String(merchantId || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    return safe ? `wallet-${safe}` : '';
  }

  function getSelfWalletIdFast(state) {
    return String(
      state?.chatIdentity?.self?.walletId
      || walletIdFromMerchantId(state?.currentMerchantId)
      || '',
    ).trim();
  }

  function decorateMessageDisplayNames(state, walletId, messages) {
    if (!Array.isArray(messages)) return [];
    const peerWalletId = String(walletId || '').trim();
    const peerDisplayName = resolvePeerDisplayName(state, peerWalletId, peerWalletId);
    return messages.map((message) => {
      if (!message || typeof message !== 'object') return message;
      const direction = String(message.direction || '').trim();
      const messageWalletId = String(message.walletId || message.peerWalletId || peerWalletId).trim();
      if (direction === 'in' || messageWalletId === peerWalletId) {
        return {
          ...message,
          displayName: peerDisplayName,
        };
      }
      return message;
    });
  }

  function getChatThreadPayload(state, walletId, req = null) {
    ensureChatState(state, req);
    syncChatThreadsFromUsers(state, req);
    const thread = ensureChatThread(state, walletId);
    const conn = getThreadConnectionSummary(state, walletId);
    const displayName = resolvePeerDisplayName(state, walletId, thread?.displayName || walletId);
    return {
      thread: {
        walletId: String(thread?.walletId || walletId || ''),
        merchantId: String(thread?.merchantId || ''),
        displayName,
        directConnected: conn.directConnected,
        connecting: conn.connecting,
      },
      messages: listChatMessagesForWallet(state, walletId),
    };
  }

  function markChatThreadRead(state, walletId) {
    const thread = ensureChatThread(state, walletId);
    if (!thread) return false;
    thread.unreadCount = 0;
    thread.lastReadAt = new Date().toISOString();
    rebuildChatUiSummary(state);
    return true;
  }

  function markExistingChatThreadRead(state, walletId, req = null) {
    ensureChatState(state, req);
    syncChatThreadsFromUsers(state, req);
    const key = String(walletId || '').trim();
    if (!key) return false;
    const thread = state?.chatThreads?.[key];
    if (!thread || typeof thread !== 'object') {
      rebuildChatUiSummary(state);
      return false;
    }
    thread.unreadCount = 0;
    thread.lastReadAt = new Date().toISOString();
    rebuildChatUiSummary(state);
    return true;
  }

  function mapChatPresenceToPreview(presenceStatus = '') {
    const status = String(presenceStatus || '').trim().toLowerCase();
    const directConnected = status === 'chatable';
    const connecting = status === 'connecting';
    return {
      presenceStatus: status || 'offline',
      transport: directConnected ? 'p2p' : 'onchain',
      requiresFeeConfirm: !directConnected,
      directConnected,
      connecting,
      feeSat: directConnected ? 0 : 12,
    };
  }

  function getChatUiPreview(state, walletId, persistedPresenceStatus = '') {
    const runtimePreview = {
      walletId: String(walletId || '').trim(),
      ...getSendPreviewForWallet(state, walletId),
      hasPeerPubKey: Boolean(getPreferredPeerChatPubKey(state, walletId)),
    };
    const runtimePresenceStatus = runtimePreview.directConnected
      ? 'chatable'
      : (runtimePreview.connecting ? 'connecting' : 'offline');
    if (
      runtimePreview.directConnected === true
      || runtimePreview.connecting === true
      || isPeerManuallyDisconnected(state, walletId)
    ) {
      return {
        ...runtimePreview,
        presenceStatus: runtimePresenceStatus,
      };
    }
    const storedPreview = mapChatPresenceToPreview(persistedPresenceStatus);
    const storedPresenceStatus = String(storedPreview.presenceStatus || '').trim().toLowerCase();
    return {
      ...runtimePreview,
      presenceStatus: (
        storedPresenceStatus === 'chatable'
        || storedPresenceStatus === 'connecting'
        ? runtimePresenceStatus
        : (storedPresenceStatus || runtimePresenceStatus)
      ),
    };
  }

  function getChatListPreview(state, walletId, persistedPresenceStatus = '') {
    const peerWalletId = String(walletId || '').trim();
    const conn = getThreadConnectionSummary(state, peerWalletId);
    const storedStatus = String(persistedPresenceStatus || '').trim().toLowerCase();
    const directConnected = conn?.directConnected === true;
    const connecting = conn?.connecting === true;
    const persistedStatus = (storedStatus === 'chatable' || storedStatus === 'connecting')
      ? 'offline'
      : storedStatus;
    const presenceStatus = directConnected
      ? 'chatable'
      : (connecting ? 'connecting' : (persistedStatus || 'offline'));
    return {
      walletId: peerWalletId,
      directConnected,
      connecting,
      presenceStatus,
    };
  }

  function mapPresenceStatusLabel(presenceStatus = '', relation = {}) {
    if (relation?.blocked === true) return 'blocked';
    const status = String(presenceStatus || '').trim().toLowerCase();
    if (status === 'chatable') return 'chatable';
    if (status === 'connecting') return 'connecting';
    if (status === 'online') return 'online';
    if (status === 'reachable_failed') return 'direct_failed';
    return 'offline';
  }

  function splitChatThreadRows(rows = []) {
    const all = Array.isArray(rows) ? rows : [];
    const friends = all.filter((row) => row?.isFriend === true && row?.blocked !== true);
    const recent = all.filter((row) => row?.isFriend !== true && row?.blocked !== true).slice(0, 5);
    return { friends, recent };
  }

  async function getChatDomainThreadsPayload(state, req) {
    if (!CHAT_MODULE_ENABLED) {
      return {
        threads: [],
        people: [],
        unreadTotal: 0,
        buttonHasUnread: false,
      };
    }
    const startedAt = Date.now();
    const self = typeof getSelfChatIdentity === 'function'
      ? getSelfChatIdentity(state, req)
      : ensureSelfChatIdentity(state, req);
    const afterSelfAt = Date.now();
    const rows = getChatThreadsPayload(state, req);
    const afterRowsAt = Date.now();
    const selfState = {
      selfWalletId: String(self.walletId || ''),
      online: state?.chatUi?.selfOnline !== false,
      storageLimitBytes: Math.max(1024, Number(state?.chatUi?.storageLimitBytes || 104857600)),
    };
    let unreadTotal = 0;
    const threads = [];
    for (const row of rows) {
      const walletId = String(row?.walletId || '').trim();
      if (!walletId || walletId === String(self.walletId || '').trim()) continue;
      const preview = getChatUiPreview(state, walletId);
      const presenceStatus = String(preview.presenceStatus || 'offline');
      const relation = state?.chatThreads?.[walletId] && typeof state.chatThreads[walletId] === 'object'
        ? state.chatThreads[walletId]
        : { isFriend: false, friendStatus: 'none', blocked: false };
      const unreadCount = Math.max(0, Number(row?.unreadCount || 0));
      unreadTotal += unreadCount;
      threads.push({
        walletId,
        merchantId: String(row?.merchantId || ''),
        displayName: resolvePeerDisplayName(state, walletId, row?.displayName || walletId),
        unreadCount,
        lastMessageAt: String(row?.lastMessageAt || ''),
        directConnected: Boolean(preview.directConnected),
        connecting: Boolean(preview.connecting),
        presenceStatus,
        statusLabel: mapPresenceStatusLabel(presenceStatus, relation),
        isFriend: relation.isFriend === true,
        friendStatus: String(relation.friendStatus || 'none'),
        blocked: relation.blocked === true,
        hasInvite: Boolean(row?.hasInvite),
      });
    }
    const afterThreadsAt = Date.now();
    threads.sort((a, b) => {
      const ta = Date.parse(String(a?.lastMessageAt || '')) || 0;
      const tb = Date.parse(String(b?.lastMessageAt || '')) || 0;
      if (ta !== tb) return tb - ta;
      return String(a?.walletId || '').localeCompare(String(b?.walletId || ''));
    });
    const people = [];
    const profileRows = state.chatDiscovery?.profiles && typeof state.chatDiscovery.profiles === 'object'
      ? Object.values(state.chatDiscovery.profiles)
      : [];
    const threadByWalletId = new Map();
    threads.forEach((row) => {
      threadByWalletId.set(String(row?.walletId || ''), row);
    });
    for (const profile of profileRows) {
      const walletId = String(profile?.walletId || '').trim();
      if (!walletId || walletId === String(self.walletId || '').trim()) continue;
      const merchantId = String(profile?.merchantId || '').trim();
      const thread = threadByWalletId.get(walletId) || null;
      const displayName = resolvePeerDisplayName(state, walletId, thread?.displayName || merchantId || walletId);
      if (!merchantId && !displayName && !walletId) continue;
      const preview = getChatUiPreview(state, walletId, thread?.presenceStatus || '');
      const presenceStatus = String(preview.presenceStatus || 'offline');
      const relation = state?.chatThreads?.[walletId] && typeof state.chatThreads[walletId] === 'object'
        ? state.chatThreads[walletId]
        : { isFriend: false, friendStatus: 'none', blocked: false };
      people.push({
        walletId,
        merchantId,
        displayName: displayName || walletId,
        unreadCount: Math.max(0, Number(thread?.unreadCount || 0)),
        lastMessageAt: String(thread?.lastMessageAt || ''),
        directConnected: Boolean(preview.directConnected),
        connecting: Boolean(preview.connecting),
        presenceStatus,
        statusLabel: mapPresenceStatusLabel(presenceStatus, relation),
        isFriend: relation.isFriend === true,
        friendStatus: String(relation.friendStatus || 'none'),
        blocked: relation.blocked === true,
        hasInvite: false,
        verified: profile?.verified === true,
      });
    }
    const afterPeopleAt = Date.now();
    people.sort((a, b) => {
      const af = a?.isFriend === true ? 1 : 0;
      const bf = b?.isFriend === true ? 1 : 0;
      if (af !== bf) return bf - af;
      const ta = Date.parse(String(a?.lastMessageAt || '')) || 0;
      const tb = Date.parse(String(b?.lastMessageAt || '')) || 0;
      if (ta !== tb) return tb - ta;
      return String(a?.displayName || a?.walletId || '').localeCompare(String(b?.displayName || b?.walletId || ''));
    });
    const friends = people.filter((row) => row?.isFriend === true);
    const grouped = splitChatThreadRows(threads);
    appendMarketDebug('chat_threads_payload_timing', {
      elapsedMs: Date.now() - startedAt,
      ensureSelfMs: afterSelfAt - startedAt,
      baseRowsMs: afterRowsAt - afterSelfAt,
      threadDecorateMs: afterThreadsAt - afterRowsAt,
      peopleDecorateMs: afterPeopleAt - afterThreadsAt,
      sortAndGroupMs: Date.now() - afterPeopleAt,
      rowCount: Array.isArray(rows) ? rows.length : 0,
      profileCount: Array.isArray(profileRows) ? profileRows.length : 0,
    });
    return {
      threads,
      people,
      friends,
      recent: grouped.recent,
      unreadTotal,
      buttonHasUnread: unreadTotal > 0,
      selfState: {
        selfWalletId: String(selfState.selfWalletId || self.walletId || ''),
        online: selfState.online !== false,
        storageLimitBytes: Math.max(1024, Number(selfState.storageLimitBytes || 104857600)),
      },
    };
  }

  async function buildChatDomainOpenPayloadFromState(state, req, options = {}) {
    const startedAt = Date.now();
    if (!CHAT_MODULE_ENABLED) {
      return {
        people: [],
        friends: [],
        recent: [],
        unreadTotal: 0,
        buttonHasUnread: false,
        selfState: null,
        identity: defaultChatIdentity().self,
      };
    }
    if (!req?.session?.walletPassword) {
      return {
        people: [],
        friends: [],
        recent: [],
        unreadTotal: 0,
        buttonHasUnread: false,
        selfState: null,
        identity: null,
        code: 'AUTH_REQUIRED',
      };
    }
    const selfIdentity = typeof getSelfChatIdentity === 'function'
      ? getSelfChatIdentity(state, req)
      : ensureSelfChatIdentity(state, req);
    const selfWalletId = getSelfWalletIdFast(state) || String(selfIdentity?.walletId || '').trim();
    const self = state?.chatIdentity?.self && typeof state.chatIdentity.self === 'object'
      ? state.chatIdentity.self
      : {
          ...defaultChatIdentity().self,
          walletId: selfWalletId,
        };
    const afterSelfAt = Date.now();
    const bundle = readChatThreadBundleDirect(selfWalletId);
    const afterBundleAt = Date.now();
    const threadRows = Array.isArray(bundle?.threadRows) ? bundle.threadRows : [];
    const presenceByPeerWalletId = bundle?.presenceByPeerWalletId && typeof bundle.presenceByPeerWalletId === 'object'
      ? bundle.presenceByPeerWalletId
      : {};
    const contactByPeerWalletId = bundle?.contactByPeerWalletId && typeof bundle.contactByPeerWalletId === 'object'
      ? bundle.contactByPeerWalletId
      : {};
    const selfState = bundle?.selfState && typeof bundle.selfState === 'object'
      ? bundle.selfState
      : {
          selfWalletId,
          online: state?.chatUi?.selfOnline !== false,
          storageLimitBytes: Math.max(1024, Number(state?.chatUi?.storageLimitBytes || 104857600)),
        };
    let unreadTotal = 0;
    const threadMap = new Map();
    for (const row of threadRows) {
      const walletId = String(row?.peerWalletId || '').trim();
      if (!walletId) continue;
      const unreadCount = Math.max(0, Number(row?.unreadCount || 0));
      unreadTotal += unreadCount;
      threadMap.set(walletId, {
        unreadCount,
        lastMessageAt: String(row?.lastMessageAt || ''),
        displayName: resolvePeerDisplayName(state, walletId, row?.displayName || walletId),
      });
    }
    const profileRows = state.chatDiscovery?.profiles && typeof state.chatDiscovery.profiles === 'object'
      ? Object.values(state.chatDiscovery.profiles)
      : [];
    const people = [];
    const peerRowsByWalletId = new Map();
    for (const profile of profileRows) {
      const walletId = String(profile?.walletId || '').trim();
      if (!walletId || walletId === selfWalletId) continue;
      peerRowsByWalletId.set(walletId, {
        walletId,
        merchantId: String(profile?.merchantId || '').trim(),
        displayName: resolvePeerDisplayName(state, walletId, String(profile?.merchantId || walletId)),
        verified: profile?.verified === true,
      });
    }
    for (const row of threadRows) {
      const walletId = String(row?.peerWalletId || '').trim();
      if (!walletId || walletId === selfWalletId || peerRowsByWalletId.has(walletId)) continue;
      peerRowsByWalletId.set(walletId, {
        walletId,
        merchantId: '',
        displayName: resolvePeerDisplayName(state, walletId, row?.displayName || walletId),
        verified: false,
      });
    }
    Object.keys(contactByPeerWalletId).forEach((walletIdRaw) => {
      const walletId = String(walletIdRaw || '').trim();
      if (!walletId || walletId === selfWalletId || peerRowsByWalletId.has(walletId)) return;
      peerRowsByWalletId.set(walletId, {
        walletId,
        merchantId: '',
        displayName: resolvePeerDisplayName(state, walletId, walletId),
        verified: false,
      });
    });
    const afterPeerRowsAt = Date.now();
    await hydrateManualEndpointDisplayNames(state, peerRowsByWalletId, threadMap);
    const afterHydrateAt = Date.now();
    for (const profile of peerRowsByWalletId.values()) {
      const walletId = String(profile?.walletId || '').trim();
      if (!walletId || walletId === selfWalletId) continue;
      const thread = threadMap.get(walletId) || null;
      const presence = presenceByPeerWalletId[walletId] || null;
      const preview = getChatListPreview(state, walletId, presence?.status || '');
      const relation = contactByPeerWalletId[walletId] && typeof contactByPeerWalletId[walletId] === 'object'
        ? contactByPeerWalletId[walletId]
        : { isFriend: false, friendStatus: 'none', blocked: false };
      const presenceStatus = String(preview.presenceStatus || 'offline');
      people.push({
        walletId,
        merchantId: String(profile?.merchantId || '').trim(),
        displayName: resolvePeerDisplayName(state, walletId, thread?.displayName || profile?.displayName || profile?.name || profile?.merchantId || walletId),
        unreadCount: Math.max(0, Number(thread?.unreadCount || 0)),
        lastMessageAt: String(thread?.lastMessageAt || ''),
        directConnected: Boolean(preview.directConnected),
        connecting: Boolean(preview.connecting),
        presenceStatus,
        statusLabel: mapPresenceStatusLabel(presenceStatus, relation),
        isFriend: relation.isFriend === true,
        friendStatus: String(relation.friendStatus || 'none'),
        blocked: relation.blocked === true,
        hasInvite: false,
        verified: profile?.verified === true,
      });
    }
    const afterDecorateAt = Date.now();
    people.sort((a, b) => {
      const af = a?.isFriend === true ? 1 : 0;
      const bf = b?.isFriend === true ? 1 : 0;
      if (af !== bf) return bf - af;
      const au = Math.max(0, Number(a?.unreadCount || 0));
      const bu = Math.max(0, Number(b?.unreadCount || 0));
      if (au !== bu) return bu - au;
      const ta = Date.parse(String(a?.lastMessageAt || '')) || 0;
      const tb = Date.parse(String(b?.lastMessageAt || '')) || 0;
      if (ta !== tb) return tb - ta;
      return String(a?.displayName || a?.walletId || '').localeCompare(String(b?.displayName || b?.walletId || ''));
    });
    const limit = Math.max(1, Math.min(50, Number(options?.peopleLimit || req?.query?.limit || 5)));
    const limitedPeople = people.slice(0, limit);
    const friends = limitedPeople.filter((row) => row?.isFriend === true);
    const recent = limitedPeople.filter((row) => row?.isFriend !== true).slice(0, 5);
    appendMarketDebug('chat_open_payload_timing', {
      elapsedMs: Date.now() - startedAt,
      selfMs: afterSelfAt - startedAt,
      bundleMs: afterBundleAt - afterSelfAt,
      peerRowsMs: afterPeerRowsAt - afterBundleAt,
      hydrateMs: afterHydrateAt - afterPeerRowsAt,
      decorateMs: afterDecorateAt - afterHydrateAt,
      sortMs: Date.now() - afterDecorateAt,
      threadCount: threadRows.length,
      profileCount: profileRows.length,
      peerSourceCount: peerRowsByWalletId.size,
      peopleCount: limitedPeople.length,
    });
    return {
      people: limitedPeople,
      friends,
      recent,
      unreadTotal,
      buttonHasUnread: unreadTotal > 0,
      selfState: {
        selfWalletId: String(selfState.selfWalletId || selfWalletId),
        online: selfState.online !== false,
        storageLimitBytes: Math.max(1024, Number(selfState.storageLimitBytes || 104857600)),
      },
      identity: self,
    };
  }

  async function getChatDomainOpenPayload(req, options = {}) {
    const state = buildChatReadState(req, { includeLocalState: false });
    return buildChatDomainOpenPayloadFromState(state, req, options);
  }

  function buildChatDomainThreadPayloadFromState(state, req, walletId) {
    if (!CHAT_MODULE_ENABLED) {
      return {
        thread: {
          walletId: String(walletId || ''),
          merchantId: '',
          displayName: String(walletId || ''),
          directConnected: false,
          connecting: false,
        },
        messages: [],
      };
    }
    const startedAt = Date.now();
    const selfIdentity = typeof getSelfChatIdentity === 'function'
      ? getSelfChatIdentity(state, req)
      : ensureSelfChatIdentity(state, req);
    const selfWalletId = getSelfWalletIdFast(state) || String(selfIdentity?.walletId || '').trim();
    const pageSize = Math.max(1, Math.min(100, Number(req?.query?.pageSize || 10)));
    const page = Math.max(1, Number(req?.query?.page || 1));
    const safeWalletId = String(walletId || '').trim();
    const summaryThread = state?.chatThreads?.[safeWalletId] && typeof state.chatThreads[safeWalletId] === 'object'
      ? state.chatThreads[safeWalletId]
      : {};
    const conn = getThreadConnectionSummary(state, safeWalletId);
    const afterThreadAt = Date.now();
    const messages = decorateMessageDisplayNames(
      state,
      safeWalletId,
      readChatMessagePageDirect(
        selfWalletId,
        safeWalletId,
        pageSize,
        page,
        getThreadOrderQueryFilter(req),
      ),
    );
    const afterMessagesAt = Date.now();
    const discovery = state.chatDiscovery?.profiles?.[safeWalletId] || {};
    const relation = summaryThread && typeof summaryThread === 'object'
      ? {
          isFriend: summaryThread.isFriend === true,
          friendStatus: String(summaryThread.friendStatus || 'none'),
          blocked: summaryThread.blocked === true,
        }
      : null;
    const payload = {
      thread: {
        walletId: safeWalletId,
        merchantId: String(discovery?.merchantId || ''),
        displayName: resolvePeerDisplayName(state, safeWalletId, summaryThread?.displayName || safeWalletId),
        directConnected: Boolean(conn.directConnected),
        connecting: Boolean(conn.connecting),
        presenceStatus: String(summaryThread?.presenceStatus || (conn.directConnected ? 'chatable' : (conn.connecting ? 'connecting' : 'offline'))),
        isFriend: relation?.isFriend === true,
        friendStatus: String(relation?.friendStatus || 'none'),
        blocked: relation?.blocked === true,
      },
      messages,
      page,
      pageSize,
    };
    appendMarketDebug('chat_thread_payload_timing', {
      elapsedMs: Date.now() - startedAt,
      selfAndThreadMs: afterThreadAt - startedAt,
      messageReadMs: afterMessagesAt - afterThreadAt,
      decorateMs: Date.now() - afterMessagesAt,
      walletId: safeWalletId,
      messageCount: messages.length,
      page,
      pageSize,
    });
    return payload;
  }

  async function getChatDomainThreadPayload(state, req, walletId) {
    return buildChatDomainThreadPayloadFromState(state, req, walletId);
  }

  return {
    getChatThreadsPayload,
    readChatThreadBundleDirect,
    readChatMessagePageDirect,
    getChatThreadPayload,
    markChatThreadRead,
    markExistingChatThreadRead,
    mapChatPresenceToPreview,
    getChatUiPreview,
    mapPresenceStatusLabel,
    splitChatThreadRows,
    getChatDomainThreadsPayload,
    buildChatDomainOpenPayloadFromState,
    getChatDomainOpenPayload,
    buildChatDomainThreadPayloadFromState,
    getChatDomainThreadPayload,
  };
}

module.exports = {
  createChatPayloadService,
};
