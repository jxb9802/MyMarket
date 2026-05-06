const crypto = require('crypto');
const { createAuthStateService } = require('./auth_state_service');
const messageQueue = require('./lib/message_queue');
const serverMarket = require('./server_market');
const wallet = require('./wallet');
const { createChatTransportV2Service } = require('./chat_transport_v2_service');

const authStateService = createAuthStateService();
const workerAppendMarketDebug = typeof serverMarket.getAppendMarketDebug === 'function'
  ? serverMarket.getAppendMarketDebug()
  : (() => {});

const ALLOWED_METHODS = new Set([
  'health',
  'get_config',
  'update_config',
  'get_peer_endpoints',
  'set_peer_endpoint',
  'get_status',
  'connect',
  'disconnect',
  'receive_signal',
  'send',
  'get_open',
  'get_thread',
  'mark_read',
]);

let chatTransportV2 = null;

function safeSend(payload = {}) {
  if (typeof process.send !== 'function' || process.connected === false) return;
  try {
    process.send(payload);
  } catch (_) {}
}

function emitWorkerEvent(eventType, domain, payload = {}) {
  safeSend({
    type: 'chat_worker_event',
    eventType: String(eventType || '').trim(),
    domain: String(domain || '').trim(),
    payload: payload && typeof payload === 'object' ? payload : {},
  });
}

function fail(message, statusCode = 400) {
  const error = new Error(String(message || 'chat worker request failed'));
  error.statusCode = Number(statusCode || 400);
  return error;
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

function getAuthPassword() {
  return String(authStateService.getSnapshot({ includeSecret: true })?.walletPassword || '').trim();
}

function syncServerMarketAuth(snapshot = {}) {
  const password = String(snapshot?.walletPassword || '').trim();
  if (password) {
    serverMarket.setRuntimeWalletPassword(password, {
      propagate: false,
      refreshViews: false,
      reconnectChat: false,
      source: 'chat_service_worker_auth',
      reason: String(snapshot?.reason || 'auth_snapshot'),
      requestId: String(snapshot?.requestId || ''),
    });
    return;
  }
  serverMarket.clearRuntimeWalletPassword({
    propagate: false,
    refreshViews: false,
    source: 'chat_service_worker_auth',
    reason: String(snapshot?.reason || 'auth_snapshot'),
    requestId: String(snapshot?.requestId || ''),
  });
}

function buildReq({ body = {}, query = {} } = {}) {
  return {
    body: body && typeof body === 'object' ? { ...body } : {},
    query: query && typeof query === 'object' ? { ...query } : {},
    session: {
      walletPassword: getAuthPassword(),
    },
  };
}

function getChatState({ allowBuildFallback = true, includeLocalState = false } = {}) {
  const runtimeReq = serverMarket.buildRuntimeAuthReq();
  let state = serverMarket.getRuntimeChatOnlyStateSnapshot(runtimeReq);
  if ((!state || typeof state !== 'object') && allowBuildFallback) {
    state = serverMarket.buildChatServiceState(runtimeReq, { includeLocalState });
  }
  if (!state || typeof state !== 'object') {
    throw fail('chat runtime unavailable', 503);
  }
  serverMarket.ensureChatState(state, runtimeReq);
  return { state, runtimeReq };
}

function countChatProfiles(state = null) {
  const profiles = state?.chatDiscovery?.profiles;
  return profiles && typeof profiles === 'object' ? Object.keys(profiles).length : 0;
}

function buildNoHttpChatStatus(walletId = '') {
  return {
    walletId: String(walletId || '').trim(),
    directConnected: false,
    connecting: false,
    presenceStatus: '',
    statusLabel: '',
    activeSessionId: '',
    transport: 'onchain',
  };
}

function getChatTransportV2() {
  if (chatTransportV2) return chatTransportV2;
  chatTransportV2 = createChatTransportV2Service({
    serverMarket,
    getAuthPassword,
    getChatState,
    appendDebug: workerAppendMarketDebug,
    emitStatus(walletId, payload = {}) {
      emitWorkerEvent('chat.status.updated', 'chat', {
        walletId: String(walletId || ''),
        ...(payload && typeof payload === 'object' ? payload : {}),
      });
    },
    emitMessage(message = {}) {
      emitWorkerEvent('chat.message.appended', 'chat', {
        message: message && typeof message === 'object' ? message : {},
      });
    },
  });
  return chatTransportV2;
}

function nowIso() {
  return new Date().toISOString();
}

async function sendOnchainMessage(body = {}) {
  const walletId = String(body?.walletId || '').trim();
  const text = String(body?.text || '');
  const orderId = String(body?.orderId || '').trim();
  const clientMsgId = String(body?.clientMsgId || body?.clientMessageId || '').trim();
  if (!walletId) throw fail('walletId is required');
  if (!text.trim()) throw fail('text is required');
  const password = getAuthPassword();
  if (!password) throw fail('wallet password unavailable', 401);
  const mnemonic = String(wallet.getMnemonicFromPassword(password) || '').trim();
  if (!mnemonic) throw fail('wallet mnemonic unavailable', 401);
  const { state, runtimeReq } = getChatState({ allowBuildFallback: true, includeLocalState: false });
  const self = serverMarket.ensureSelfChatIdentity(state, runtimeReq);
  const peerPubKey = serverMarket.getPreferredPeerChatPubKey(state, walletId);
  if (!peerPubKey) throw fail('peer chat public key unavailable', 409);
  const ts = nowIso();
  const msgId = `onchain:${crypto.randomUUID()}`;
  const sessionId = '';
  const encrypted = wallet.encryptChatMessage({
    mnemonic,
    peerPublicKey: peerPubKey,
    text,
  });
  const signature = wallet.signChatEnvelope({
    mnemonic,
    peerPublicKey: peerPubKey,
    senderPubKey: encrypted.senderPubKey,
    recipientPubKey: peerPubKey,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    msgId,
    sessionId,
    fromWalletId: String(self.walletId || ''),
    toWalletId: walletId,
    ts,
    orderId,
  });
  const payload = {
    fromWalletId: String(self.walletId || ''),
    toWalletId: walletId,
    fromPubKey: encrypted.senderPubKey,
    peerPubKey,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    msgId,
    sessionId,
    ts,
    orderId,
    signature,
  };
  const anchor = await serverMarket.tryAnchorEvent(runtimeReq, state, 'chat_message', payload, {
    password,
    updatedAt: ts,
    requireVisibility: true,
  });
  if (anchor?.error) throw fail(String(anchor.error || 'Anchor failed'), 500);
  workerAppendMarketDebug('chat_onchain_message_signal_skipped_policy', {
    walletId,
    msgId,
    txid: String(anchor?.txid || ''),
    reason: 'formal_nodes_must_learn_onchain_messages_from_chain',
  });
  const peerProfile = state?.chatDiscovery?.profiles?.[walletId] || {};
  const peerDisplayName = firstUsefulDisplayName(walletId, [
    peerProfile.displayName,
    peerProfile.name,
    state?.chatThreads?.[walletId]?.displayName,
    peerProfile.merchantId,
    walletId,
  ]);
  return {
    success: true,
    transport: 'onchain',
    directConnected: false,
    message: {
      selfWalletId: String(self.walletId || ''),
      walletId,
      peerWalletId: walletId,
      msgId,
      clientMsgId,
      sessionId,
      direction: 'out',
      transport: 'onchain',
      text,
      orderId,
      ts,
      status: 'broadcasted',
      txid: String(anchor?.txid || ''),
      displayName: peerDisplayName || walletId,
    },
  };
}

function getChatRuntimeStateForRead(query = {}) {
  const req = buildReq({ query: query && typeof query === 'object' ? query : {} });
  let stateSource = 'runtime';
  let state = null;
  try {
    state = getChatState({ allowBuildFallback: false, includeLocalState: false }).state;
    if (countChatProfiles(state) <= 0) {
      const hydratedState = serverMarket.buildChatReadState(req, { includeLocalState: false });
      serverMarket.ensureChatState(hydratedState, req);
      if (countChatProfiles(hydratedState) > 0) {
        state = hydratedState;
        stateSource = 'sqlite_hydrate';
        try {
          serverMarket.commitChatRuntimeState(state, {
            writeJson: false,
            refresh: false,
            reason: 'chat_read_profiles_sqlite_hydrate',
          });
        } catch (_) {}
      }
    }
  } catch (_) {
    stateSource = 'build';
    state = serverMarket.buildChatReadState(req, { includeLocalState: false });
    serverMarket.ensureChatState(state, req);
  }
  return { req, state, stateSource };
}

function applyLiveStatusToChatRows(payload = {}) {
  const applyLiveStatus = (row) => {
    const walletId = String(row?.walletId || '').trim();
    const status = getChatTransportV2().getStatus(walletId) || buildNoHttpChatStatus(walletId);
    row.directConnected = status.directConnected === true;
    row.connecting = status.connecting === true;
    row.presenceStatus = status.presenceStatus;
    row.statusLabel = status.statusLabel;
    row.activeSessionId = status.activeSessionId;
    return row;
  };
  (Array.isArray(payload.people) ? payload.people : []).forEach(applyLiveStatus);
  (Array.isArray(payload.friends) ? payload.friends : []).forEach(applyLiveStatus);
  (Array.isArray(payload.recent) ? payload.recent : []).forEach(applyLiveStatus);
  return payload;
}

function filterLiveMessagesByOrder(messages = [], query = {}) {
  const orderFilterEnabled = query && Object.prototype.hasOwnProperty.call(query, 'orderId');
  const orderFilter = orderFilterEnabled ? String(query.orderId || '').trim() : null;
  return (Array.isArray(messages) ? messages : []).filter((row) => {
    if (!orderFilterEnabled) return true;
    return String(row?.orderId || '').trim() === orderFilter;
  });
}

function listLiveMessagesForWallet(state = {}, walletId = '') {
  const safeWalletId = String(walletId || '').trim();
  if (!safeWalletId) return [];
  return Object.values(state?.chatMessages || {})
    .filter((row) => String(row?.walletId || row?.peerWalletId || '').trim() === safeWalletId)
    .sort((a, b) => Date.parse(String(a?.ts || '')) - Date.parse(String(b?.ts || '')))
    .map((row) => ({ ...(row && typeof row === 'object' ? row : {}) }));
}

function mergeLiveMessagesIntoThreadPayload(payload = {}, liveMessages = [], walletId = '') {
  const peerDisplayName = String(payload?.thread?.displayName || walletId);
  if (!Array.isArray(payload.messages)) payload.messages = [];
  if (liveMessages.length <= 0) return payload;
  const byMsgId = new Map();
  for (const row of payload.messages) {
    const msgId = String(row?.msgId || '').trim();
    if (msgId) byMsgId.set(msgId, row);
  }
  for (const row of liveMessages) {
    const msgId = String(row?.msgId || '').trim();
    if (!msgId || byMsgId.has(msgId)) continue;
    const decoratedRow = {
      ...row,
      displayName: peerDisplayName,
    };
    payload.messages.push(decoratedRow);
    byMsgId.set(msgId, decoratedRow);
  }
  payload.messages.sort((a, b) => Date.parse(String(a?.ts || 0)) - Date.parse(String(b?.ts || 0)));
  return payload;
}

function applyLiveStatusToThreadPayload(payload = {}, walletId = '') {
  const liveStatus = getChatTransportV2().getStatus(walletId) || buildNoHttpChatStatus(walletId);
  if (payload.thread && typeof payload.thread === 'object') {
    payload.thread.directConnected = liveStatus.directConnected === true;
    payload.thread.connecting = liveStatus.connecting === true;
    payload.thread.presenceStatus = String(liveStatus.presenceStatus || payload.thread.presenceStatus || '');
    payload.thread.statusLabel = String(liveStatus.statusLabel || payload.thread.statusLabel || '');
    payload.thread.activeSessionId = String(liveStatus.activeSessionId || payload.thread.activeSessionId || '');
  }
  return payload;
}

async function handleGetOpen(query = {}) {
  const startedAt = Date.now();
  const { req, state, stateSource } = getChatRuntimeStateForRead(query);
  const afterStateAt = Date.now();
  const payload = await serverMarket.getChatPayloadService().buildChatDomainOpenPayloadFromState(state, req, {
    peopleLimit: Number(req.query?.limit || 5),
  });
  const afterPayloadAt = Date.now();
  applyLiveStatusToChatRows(payload);
  workerAppendMarketDebug('chat_open_worker_timing', {
    elapsedMs: Date.now() - startedAt,
    stateMs: afterStateAt - startedAt,
    payloadMs: afterPayloadAt - afterStateAt,
    liveStatusMs: Date.now() - afterPayloadAt,
    stateSource,
    peopleCount: Array.isArray(payload.people) ? payload.people.length : 0,
  });
  return {
    success: true,
    threads: [],
    people: payload.people,
    friends: payload.friends,
    recent: payload.recent,
    unreadTotal: payload.unreadTotal,
    selfState: payload.selfState,
    identity: payload.identity,
  };
}

async function handleGetThread(walletIdRaw, query = {}) {
  const walletId = String(walletIdRaw || '').trim();
  if (!walletId) throw fail('walletId is required');
  const startedAt = Date.now();
  const { req, state, stateSource } = getChatRuntimeStateForRead(query);
  const afterStateAt = Date.now();
  const payload = await serverMarket.getChatPayloadService().buildChatDomainThreadPayloadFromState(state, req, walletId);
  const afterPayloadAt = Date.now();
  const liveMessages = filterLiveMessagesByOrder(listLiveMessagesForWallet(state, walletId), query);
  mergeLiveMessagesIntoThreadPayload(payload, liveMessages, walletId);
  applyLiveStatusToThreadPayload(payload, walletId);
  workerAppendMarketDebug('chat_thread_worker_timing', {
    elapsedMs: Date.now() - startedAt,
    stateMs: afterStateAt - startedAt,
    payloadMs: afterPayloadAt - afterStateAt,
    liveMergeMs: Date.now() - afterPayloadAt,
    stateSource,
    walletId,
    messageCount: Array.isArray(payload.messages) ? payload.messages.length : 0,
    liveMessageCount: liveMessages.length,
  });
  return payload;
}

async function runMethod(method, args = []) {
  if (method === 'health') {
    return {
      ok: true,
      pid: Number(process.pid || 0),
      auth: authStateService.getSnapshot({ includeSecret: false }),
    };
  }

  if (method === 'get_config') {
    serverMarket.getChatRuntimeGate().assertEnabled();
    const req = buildReq();
    const state = serverMarket.chatRouteStateService.getServiceState(req, { includeLocalState: false });
    return { success: true, config: state.chatConfig };
  }

  if (method === 'update_config') {
    const [body] = args;
    serverMarket.getChatRuntimeGate().assertEnabled();
    const req = buildReq({ body: body && typeof body === 'object' ? body : {} });
    const config = serverMarket.chatRouteStateService.updateConfig(req, req.body || {});
    return { success: true, config };
  }

  if (method === 'get_peer_endpoints') {
    serverMarket.getChatRuntimeGate().assertEnabled();
    const req = buildReq();
    const state = serverMarket.chatRouteStateService.getServiceState(req, { includeLocalState: false });
    const manualPeerEndpoints = state.chatConfig?.manualPeerEndpoints && typeof state.chatConfig.manualPeerEndpoints === 'object'
      ? Object.fromEntries(
        Object.entries(state.chatConfig.manualPeerEndpoints)
          .map(([walletId, endpoint]) => [String(walletId || '').trim(), serverMarket.normalizeChatHttpEndpoint(endpoint)])
          .filter(([walletId, endpoint]) => walletId && endpoint),
      )
      : {};
    return { success: true, manualPeerEndpoints };
  }

  if (method === 'set_peer_endpoint') {
    const [walletIdRaw, endpointLike] = args;
    const walletId = String(walletIdRaw || '').trim();
    if (!walletId) throw fail('walletId is required');
    serverMarket.getChatRuntimeGate().assertEnabled();
    const req = buildReq({ body: { walletId, endpoint: endpointLike } });
    const result = serverMarket.chatRouteStateService.setPeerEndpoint(req, walletId, endpointLike || '');
    return { success: true, ...result };
  }

  if (method === 'get_status') {
    const [walletIdRaw] = args;
    const walletId = String(walletIdRaw || '').trim();
    if (!walletId) throw fail('walletId is required');
    const { state, runtimeReq } = getChatState({ allowBuildFallback: true, includeLocalState: false });
    const preview = await serverMarket.getChatDomainPreview(state, runtimeReq, walletId);
    const statusPayload = getChatTransportV2().getStatus(walletId) || buildNoHttpChatStatus(walletId);
    return {
      success: true,
      walletId,
      ...preview,
      ...statusPayload,
      transport: statusPayload.directConnected ? 'p2p' : String(preview.transport || 'onchain'),
      requiresFeeConfirm: statusPayload.directConnected !== true && Boolean(preview.requiresFeeConfirm),
      feeSat: statusPayload.directConnected ? 0 : Number(preview.feeSat || 12),
    };
  }

  if (method === 'connect') {
    const [walletIdRaw] = args;
    const walletId = String(walletIdRaw || '').trim();
    if (!walletId) throw fail('walletId is required');
    const session = await getChatTransportV2().connectPeer(walletId);
    return { success: true, ...getChatTransportV2().getStatus(walletId), session };
  }

  if (method === 'disconnect') {
    const [walletIdRaw] = args;
    const walletId = String(walletIdRaw || '').trim();
    if (!walletId) throw fail('walletId is required');
    return { success: true, ...(await getChatTransportV2().disconnectPeer(walletId, { manual: true })) };
  }

  if (method === 'receive_signal') {
    const [body, meta] = args;
    const signalBody = body && typeof body === 'object' ? body : {};
    return { success: true, ...(await getChatTransportV2().receiveSignal(signalBody, meta && typeof meta === 'object' ? meta : {})) };
  }

  if (method === 'send') {
    const [body] = args;
    const safeBody = body && typeof body === 'object' ? body : {};
    const hasAttachments = Array.isArray(safeBody.attachmentIds) && safeBody.attachmentIds.length > 0;
    const directOnly = safeBody.directOnly === true;
    if (safeBody.forceOnchain === true) {
      if (hasAttachments || directOnly) throw fail('chat_direct_only_requires_p2p', 400);
      return await sendOnchainMessage(safeBody);
    }
    const walletId = String(safeBody.walletId || '').trim();
    const directStatus = walletId ? getChatTransportV2().getStatus(walletId) : null;
    if (directStatus?.directConnected === true) return await getChatTransportV2().sendDirectMessage(safeBody);
    if (hasAttachments || directOnly) throw fail('P2P direct chat is not connected', 409);
    return await sendOnchainMessage(safeBody);
  }

  if (method === 'get_open') {
    const [query] = args;
    return handleGetOpen(query && typeof query === 'object' ? query : {});
  }

  if (method === 'get_thread') {
    const [walletIdRaw, query] = args;
    return handleGetThread(walletIdRaw, query && typeof query === 'object' ? query : {});
  }

  if (method === 'mark_read') {
    const [walletIdRaw] = args;
    const walletId = String(walletIdRaw || '').trim();
    if (!walletId) throw fail('walletId is required');
    const req = buildReq({ body: { walletId } });
    const { state } = getChatState({ allowBuildFallback: false, includeLocalState: false });
    const self = serverMarket.ensureSelfChatIdentity(state, req);
    const readAt = new Date().toISOString();
    if (self?.walletId && serverMarket.chatDomain?.emitChatEvent) {
      await serverMarket.chatDomain.emitChatEvent('chat.thread.read_marked', {
        selfWalletId: String(self.walletId || ''),
        peerWalletId: walletId,
        readAt,
      }, {
        producer: 'chat_worker',
        entityType: 'chat_thread',
        entityId: `${String(self.walletId || '')}:${walletId}`,
      }).catch((error) => {
        workerAppendMarketDebug('chat_thread_read_projection_failed', {
          walletId,
          selfWalletId: String(self.walletId || ''),
          message: String(error?.message || error || 'projection_failed'),
        });
      });
    }
    const updated = serverMarket.markExistingChatThreadRead(state, walletId, req);
    if (updated) {
      if (typeof serverMarket.applyChatEventToRuntimeState === 'function') {
        serverMarket.applyChatEventToRuntimeState('chat.thread.read_marked', {
          selfWalletId: String(self?.walletId || ''),
          peerWalletId: walletId,
          readAt,
        });
      }
      serverMarket.commitChatRuntimeState(state, {
        reason: 'chat_thread_read_marked',
        writeJson: false,
        refresh: false,
      });
    }
    return {
      success: true,
      walletId,
      unreadTotal: Math.max(0, Number(state?.chatUi?.chatUnreadTotal || 0)),
    };
  }

  throw fail(`unsupported chat worker method: ${method}`, 400);
}

async function handleChatWorkerRequest(message) {
  const requestId = String(message?.requestId || '').trim();
  const method = String(message?.method || '').trim();
  const args = Array.isArray(message?.args) ? message.args : [];
  if (!requestId || !ALLOWED_METHODS.has(method)) {
    safeSend({
      type: 'chat_worker_response',
      requestId,
      ok: false,
      error: `unsupported chat worker method: ${method || 'unknown'}`,
    });
    return;
  }
  try {
    const result = await runMethod(method, args);
    safeSend({
      type: 'chat_worker_response',
      requestId,
      ok: true,
      result,
    });
  } catch (error) {
    safeSend({
      type: 'chat_worker_response',
      requestId,
      ok: false,
      error: String(error?.message || error || `${method} failed`),
      statusCode: Number(error?.statusCode || 500),
    });
  }
}

process.on('message', (message) => {
  if (messageQueue.handleChildProcessMessage(process, message)) return;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'auth.snapshot' || message.type === 'auth.logged_in' || message.type === 'auth.logged_out') {
    const snapshot = message.snapshot || {};
    authStateService.applySnapshot(snapshot, {
      source: String(message?.source || message.type || 'auth_snapshot'),
    });
    syncServerMarketAuth(snapshot);
    return;
  }
  if (String(message.type || '') !== 'chat_worker_request') return;
  void handleChatWorkerRequest(message);
});

process.on('disconnect', () => {
  try { chatTransportV2?.stop?.(); } catch (_) {}
  process.exit(0);
});

safeSend({
  type: 'auth.query',
  source: 'chat_worker_startup',
});

safeSend({
  type: 'chat_worker_ready',
  pid: Number(process.pid || 0),
});
