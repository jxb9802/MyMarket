const crypto = require('crypto');
const wallet = require('./wallet');
const { createChatWebrtcTransport } = require('./chat_webrtc_transport');
const { createChatPeerTransportRuntime } = require('./chat_peer_transport_runtime');
const { createChatTransportSessionStore } = require('./chat_transport_session_store');
const { createChatSignalService } = require('./chat_signal_service');

function normalizeString(value) {
  return String(value || '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function toStatusPayload(session = null) {
  const phase = normalizeString(session?.phase);
  return {
    walletId: normalizeString(session?.walletId),
    directConnected: phase === 'connected',
    connecting: phase === 'signaling' || phase === 'checking',
    presenceStatus: phase === 'connected' ? 'chatable' : '',
    statusLabel: phase === 'connected' ? 'chatable' : '',
    activeSessionId: normalizeString(session?.sessionId),
    phase,
    lastHeartbeatAt: normalizeString(session?.lastHeartbeatAt),
    lastMessageAt: normalizeString(session?.lastMessageAt),
    transport: phase === 'connected' ? 'p2p' : 'onchain',
  };
}

function createChatTransportV2Service(deps = {}) {
  const serverMarket = deps.serverMarket;
  if (!serverMarket) throw new Error('serverMarket is required');
  const appendDebug = typeof deps.appendDebug === 'function' ? deps.appendDebug : (() => {});
  const emitStatus = typeof deps.emitStatus === 'function' ? deps.emitStatus : (() => {});
  const emitMessage = typeof deps.emitMessage === 'function' ? deps.emitMessage : (() => {});
  const getAuthPassword = typeof deps.getAuthPassword === 'function' ? deps.getAuthPassword : (() => '');
  const getChatState = typeof deps.getChatState === 'function' ? deps.getChatState : null;
  const connectTimeoutMs = () => Math.max(15000, Number(process.env.BSV_MARKET_CHAT_CONNECT_TIMEOUT_MS || 150000));

  const sessionStore = createChatTransportSessionStore();
  const runtime = createChatPeerTransportRuntime({
    sessionStore,
    heartbeatTimeoutMs: Math.max(10000, Number(process.env.BSV_MARKET_CHAT_HEARTBEAT_TIMEOUT_MS || 30000)),
  });
  const transport = createChatWebrtcTransport();
  const handlesBySessionId = new Map();
  const walletToSessionId = new Map();
  const pendingConnects = new Map();
  const pendingDelivery = new Map();
  let heartbeatTimer = null;

  function requireState() {
    if (!getChatState) throw new Error('chat state unavailable');
    return getChatState({ allowBuildFallback: true, includeLocalState: false });
  }

  function getSelfEndpoint(state) {
    const explicit = normalizeString(process.env.BSV_MARKET_CHAT_SIGNAL_ENDPOINT);
    if (explicit) return explicit.replace(/\/+$/, '');
    const host = normalizeString(state?.chatConfig?.publicHost);
    const port = Math.max(1, Number(state?.chatConfig?.publicPort || process.env.PORT || process.env.BSV_MARKET_PORT || 8091));
    return host ? `http://${host}:${port}` : '';
  }

  function getSignalEndpointForWallet(state, walletId) {
    return normalizeString(serverMarket.getPreferredPeerEndpoint(state, walletId)).replace(/\/+$/, '');
  }

  function getIceServers() {
    try {
      const rows = typeof serverMarket.getPublicNodeIceServers === 'function'
        ? serverMarket.getPublicNodeIceServers()
        : [];
      return Array.isArray(rows) ? rows.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  function rememberSignalPeerIdentity(walletId, chatPubKey, source = 'webrtc_signal') {
    const safeWalletId = normalizeString(walletId);
    const safePubKey = normalizeString(chatPubKey);
    if (!safeWalletId || !/^[0-9a-f]{66}$/i.test(safePubKey)) return false;
    const { state } = requireState();
    serverMarket.ensureChatState(state);
    const now = nowIso();
    if (!state.chatIdentity.pubkeyBindings || typeof state.chatIdentity.pubkeyBindings !== 'object') {
      state.chatIdentity.pubkeyBindings = {};
    }
    state.chatIdentity.pubkeyBindings[safePubKey] = {
      ...(state.chatIdentity.pubkeyBindings[safePubKey] && typeof state.chatIdentity.pubkeyBindings[safePubKey] === 'object'
        ? state.chatIdentity.pubkeyBindings[safePubKey]
        : {}),
      chatPubKey: safePubKey,
      walletId: safeWalletId,
      source,
      updatedAt: now,
      status: 'signal_observed',
    };
    if (!state.chatIdentity.walletKeyIndex || typeof state.chatIdentity.walletKeyIndex !== 'object') {
      state.chatIdentity.walletKeyIndex = {};
    }
    if (!state.chatIdentity.walletKeyIndex[safeWalletId] || typeof state.chatIdentity.walletKeyIndex[safeWalletId] !== 'object') {
      state.chatIdentity.walletKeyIndex[safeWalletId] = { walletId: safeWalletId, merchantId: '', pubkeys: [] };
    }
    const index = state.chatIdentity.walletKeyIndex[safeWalletId];
    if (!Array.isArray(index.pubkeys)) index.pubkeys = [];
    if (!index.pubkeys.includes(safePubKey)) index.pubkeys.push(safePubKey);
    const thread = serverMarket.ensureChatThread(state, safeWalletId);
    if (thread) {
      if (!Array.isArray(thread.pubkeys)) thread.pubkeys = [];
      if (!thread.pubkeys.includes(safePubKey)) thread.pubkeys.push(safePubKey);
    }
    if (!state.chatDiscovery || typeof state.chatDiscovery !== 'object') state.chatDiscovery = {};
    if (!state.chatDiscovery.profiles || typeof state.chatDiscovery.profiles !== 'object') state.chatDiscovery.profiles = {};
    const profile = state.chatDiscovery.profiles[safeWalletId] && typeof state.chatDiscovery.profiles[safeWalletId] === 'object'
      ? state.chatDiscovery.profiles[safeWalletId]
      : {};
    const chatPubKeys = Array.isArray(profile.chatPubKeys) ? profile.chatPubKeys.slice() : [];
    if (!chatPubKeys.includes(safePubKey)) chatPubKeys.push(safePubKey);
    state.chatDiscovery.profiles[safeWalletId] = {
      ...profile,
      walletId: safeWalletId,
      chatPubKeys,
      source,
      updatedAt: now,
    };
    if (typeof serverMarket.commitChatRuntimeState === 'function') {
      serverMarket.commitChatRuntimeState(state, { writeJson: false });
    }
    return true;
  }

  async function postSignal(endpoint, envelope) {
    const base = normalizeString(endpoint).replace(/\/+$/, '');
    if (!base) throw new Error('peer signal endpoint unavailable');
    const response = await fetch(`${base}/api/chat/signal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(Math.max(3000, Number(process.env.BSV_MARKET_CHAT_SIGNAL_TIMEOUT_MS || 12000))),
    });
    if (!response.ok) throw new Error(`signal ${response.status}`);
    return response.json().catch(() => ({}));
  }

  const signalService = createChatSignalService({
    sendSignal: async (_wire, envelope, meta = {}) => {
      await postSignal(meta.endpoint || envelope?.payload?.returnEndpoint || '', envelope);
    },
  });

  function rankSessionPhase(phase) {
    switch (normalizeString(phase)) {
      case 'connected': return 4;
      case 'checking': return 3;
      case 'signaling': return 2;
      case 'idle': return 1;
      default: return 0;
    }
  }

  function getPeerSession(walletId) {
    const safeWalletId = normalizeString(walletId);
    const mappedId = walletToSessionId.get(safeWalletId) || '';
    const mapped = mappedId ? sessionStore.getSession(mappedId) : null;
    if (mapped) return mapped;
    const fallback = sessionStore.listSessionsByWalletId(safeWalletId)
      .sort((a, b) => {
        const phaseDelta = rankSessionPhase(b.phase) - rankSessionPhase(a.phase);
        if (phaseDelta !== 0) return phaseDelta;
        return Date.parse(String(b.updatedAt || b.createdAt || '')) - Date.parse(String(a.updatedAt || a.createdAt || ''));
      })[0] || null;
    if (fallback?.sessionId) walletToSessionId.set(safeWalletId, fallback.sessionId);
    return fallback;
  }

  function publishStatus(session) {
    const payload = toStatusPayload(session);
    if (payload.walletId) emitStatus(payload.walletId, payload);
    return payload;
  }

  function upsertSession(walletId, sessionId, phase, patch = {}) {
    const current = sessionStore.getSession(sessionId);
    const next = current
      ? runtime.transitionSession(sessionId, phase, patch)
      : runtime.createSession(walletId, { sessionId, phase, ...patch });
    walletToSessionId.set(next.walletId, next.sessionId);
    publishStatus(next);
    return next;
  }

  function currentWalletId() {
    const { state, runtimeReq } = requireState();
    const self = serverMarket.ensureSelfChatIdentity(state, runtimeReq);
    return normalizeString(self.walletId);
  }

  function markConnected(sessionId, patch = {}) {
    const current = sessionStore.getSession(sessionId);
    if (!current) return null;
    const next = runtime.markConnected(sessionId, {
      ...patch,
      channelState: 'open',
      manuallyDisconnected: false,
      lastHeartbeatAt: nowIso(),
    });
    publishStatus(next);
    const pending = pendingConnects.get(sessionId);
    if (pending) {
      pending.resolve(next);
      pendingConnects.delete(sessionId);
    }
    return next;
  }

  function markDisconnected(sessionId, reason = 'disconnect', patch = {}) {
    const current = sessionStore.getSession(sessionId);
    if (!current) return null;
    const next = runtime.markDisconnected(sessionId, {
      ...patch,
      channelState: 'closed',
      iceState: patch.iceState || 'closed',
    });
    appendDebug('chat_v2_disconnected', { walletId: next.walletId, sessionId, reason });
    publishStatus(next);
    handlesBySessionId.get(sessionId)?.close?.();
    handlesBySessionId.delete(sessionId);
    if (walletToSessionId.get(next.walletId) === sessionId) walletToSessionId.delete(next.walletId);
    const pending = pendingConnects.get(sessionId);
    if (pending) {
      pending.reject(new Error(reason));
      pendingConnects.delete(sessionId);
    }
    return next;
  }

  function bindHandle(sessionId, walletId, handle) {
    handlesBySessionId.set(sessionId, handle);
    walletToSessionId.set(walletId, sessionId);
  }

  function channelHandlers(sessionId, walletId) {
    return {
      onState: (state = {}) => {
        appendDebug('chat_v2_webrtc_state', { sessionId, walletId, ...state });
        const messageOpen = normalizeString(state.messageState) === 'open';
        const controlOpen = normalizeString(state.controlState) === 'open';
        if (messageOpen && controlOpen) markConnected(sessionId, {
          iceState: normalizeString(state.iceState || 'connected'),
        });
        if (['closed', 'failed', 'disconnected'].includes(normalizeString(state.connectionState || state.iceState))) {
          markDisconnected(sessionId, 'webrtc_closed', {
            iceState: normalizeString(state.iceState || state.connectionState),
          });
        }
      },
      onControlMessage: (raw) => handleControlFrame(sessionId, walletId, raw),
      onMessageFrame: (raw) => handleMessageFrame(sessionId, walletId, raw),
    };
  }

  function sendControl(sessionId, payload) {
    handlesBySessionId.get(sessionId)?.sendControl?.(payload);
  }

  function sendMessage(sessionId, payload) {
    handlesBySessionId.get(sessionId)?.sendMessage?.(payload);
  }

  function handleControlFrame(sessionId, walletId, raw) {
    let frame = null;
    try { frame = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return; }
    const type = normalizeString(frame?.type);
    runtime.touchHeartbeat(sessionId, nowIso());
    if (type === 'chat.control.ping') {
      sendControl(sessionId, { type: 'chat.control.pong', sessionId, ts: nowIso() });
      return;
    }
    if (type === 'chat.control.pong') return;
    if (type === 'chat.control.disconnect') {
      markDisconnected(sessionId, 'remote_disconnect', { manuallyDisconnected: true });
      return;
    }
    if (type === 'chat.message.delivered') {
      const msgId = normalizeString(frame.msgId || frame.messageId);
      const pending = pendingDelivery.get(msgId);
      if (pending) {
        pending.resolve(frame);
        pendingDelivery.delete(msgId);
      }
    }
  }

  function buildLocalMessage(walletId, text, orderId, clientMsgId = '') {
    const password = normalizeString(getAuthPassword());
    if (!password) throw new Error('wallet password unavailable');
    const mnemonic = normalizeString(wallet.getMnemonicFromPassword(password));
    if (!mnemonic) throw new Error('wallet mnemonic unavailable');
    const { state, runtimeReq } = requireState();
    const self = serverMarket.ensureSelfChatIdentity(state, runtimeReq);
    const peerPubKey = serverMarket.getPreferredPeerChatPubKey(state, walletId);
    if (!peerPubKey) throw new Error('peer chat public key unavailable');
    const encrypted = wallet.encryptChatMessage({ mnemonic, peerPublicKey: peerPubKey, text });
    const session = getPeerSession(walletId);
    const sessionId = normalizeString(session?.sessionId);
    const msgId = clientMsgId || `p2p:${crypto.randomUUID()}`;
    const ts = nowIso();
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
      fromWalletId: self.walletId,
      toWalletId: walletId,
      ts,
      orderId,
    });
    return {
      frame: {
        type: 'chat.message.send',
        msgId,
        sessionId,
        payload: {
          fromWalletId: self.walletId,
          toWalletId: walletId,
          senderPubKey: encrypted.senderPubKey,
          ciphertext: encrypted.ciphertext,
          nonce: encrypted.nonce,
          authTag: encrypted.authTag,
          signature,
          orderId,
          ts,
        },
      },
      message: {
        selfWalletId: self.walletId,
        walletId,
        peerWalletId: walletId,
        msgId,
        clientMsgId,
        sessionId,
        direction: 'out',
        transport: 'p2p',
        text,
        orderId,
        ts,
        status: 'sent',
        txid: '',
        displayName: walletId,
      },
    };
  }

  function appendRuntimeMessage(message) {
    if (typeof serverMarket.applyChatEventToRuntimeState === 'function') {
      serverMarket.applyChatEventToRuntimeState(
        message.direction === 'in' ? 'chat.message.received' : 'chat.message.sent',
        {
          selfWalletId: normalizeString(message.selfWalletId),
          peerWalletId: normalizeString(message.walletId || message.peerWalletId),
          msgId: normalizeString(message.msgId),
          sessionId: normalizeString(message.sessionId),
          direction: normalizeString(message.direction),
          transport: normalizeString(message.transport || 'p2p'),
          text: String(message.text || ''),
          orderId: normalizeString(message.orderId),
          status: normalizeString(message.status || 'delivered'),
          ts: normalizeString(message.ts || nowIso()),
          txid: '',
          displayName: normalizeString(message.displayName),
          senderPubKey: normalizeString(message.senderPubKey),
        },
      );
    }
    if (serverMarket.chatDomain && typeof serverMarket.chatDomain.emitChatEvent === 'function') {
      serverMarket.chatDomain.emitChatEvent(
        message.direction === 'in' ? 'chat.message.received' : 'chat.message.sent',
        {
          selfWalletId: normalizeString(message.selfWalletId),
          peerWalletId: normalizeString(message.walletId || message.peerWalletId),
          msgId: normalizeString(message.msgId),
          sessionId: normalizeString(message.sessionId),
          direction: normalizeString(message.direction),
          transport: normalizeString(message.transport || 'p2p'),
          text: String(message.text || ''),
          orderId: normalizeString(message.orderId),
          status: normalizeString(message.status || 'delivered'),
          ts: normalizeString(message.ts || nowIso()),
          txid: '',
          displayName: normalizeString(message.displayName),
        },
        { producer: 'chat_transport_v2' },
      ).catch((err) => {
        appendDebug('chat_v2_projection_append_failed', {
          msgId: normalizeString(message.msgId),
          walletId: normalizeString(message.walletId || message.peerWalletId),
          message: String(err?.message || err || ''),
        });
      });
    }
    emitMessage(message);
  }

  function handleMessageFrame(sessionId, walletId, raw) {
    let frame = null;
    try { frame = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) { return; }
    if (normalizeString(frame?.type) !== 'chat.message.send') return;
    const payload = frame.payload && typeof frame.payload === 'object' ? frame.payload : {};
    const { state, runtimeReq } = requireState();
    const self = serverMarket.ensureSelfChatIdentity(state, runtimeReq);
    const fromWalletId = normalizeString(payload.fromWalletId);
    const toWalletId = normalizeString(payload.toWalletId);
    const senderPubKey = normalizeString(payload.senderPubKey);
    if (toWalletId !== self.walletId) throw new Error('message target mismatch');
    const text = serverMarket.decryptChatEnvelopeWithRuntime({
      senderPubKey,
      ciphertext: normalizeString(payload.ciphertext),
      nonce: normalizeString(payload.nonce),
      authTag: normalizeString(payload.authTag),
      password: getAuthPassword(),
    });
    const signatureOk = serverMarket.verifyChatEnvelopeWithRuntime({
      senderPubKey,
      ciphertext: normalizeString(payload.ciphertext),
      nonce: normalizeString(payload.nonce),
      authTag: normalizeString(payload.authTag),
      msgId: normalizeString(frame.msgId),
      sessionId,
      fromWalletId,
      toWalletId,
      ts: normalizeString(payload.ts),
      orderId: normalizeString(payload.orderId),
      signature: normalizeString(payload.signature),
      password: getAuthPassword(),
    });
    if (!text || !signatureOk) throw new Error('p2p message verification failed');
    const message = {
      selfWalletId: self.walletId,
      walletId: fromWalletId,
      peerWalletId: fromWalletId,
      msgId: normalizeString(frame.msgId),
      sessionId,
      direction: 'in',
      transport: 'p2p',
      text,
      orderId: normalizeString(payload.orderId),
      ts: normalizeString(payload.ts) || nowIso(),
      status: 'delivered',
      txid: '',
      displayName: fromWalletId,
      senderPubKey,
    };
    runtime.touchHeartbeat(sessionId, nowIso());
    runtime.touchMessage(sessionId, message.ts);
    appendRuntimeMessage(message);
    sendControl(sessionId, { type: 'chat.message.delivered', sessionId, msgId: message.msgId, deliveredAt: nowIso() });
  }

  async function connectPeer(walletId) {
    const safeWalletId = normalizeString(walletId);
    if (!safeWalletId) throw new Error('walletId is required');
    const existing = getPeerSession(safeWalletId);
    if (existing?.phase === 'connected') return existing;
    const { state, runtimeReq } = requireState();
    const self = serverMarket.ensureSelfChatIdentity(state, runtimeReq);
    if (!self.chatPubKey) throw new Error('local chat public key unavailable');
    const peerEndpoint = getSignalEndpointForWallet(state, safeWalletId);
    if (!peerEndpoint) throw new Error('peer signal endpoint unavailable');
    const selfEndpoint = getSelfEndpoint(state);
    if (!selfEndpoint) throw new Error('local signal endpoint unavailable');
    const sessionId = `chatv2-${safeWalletId}-${crypto.randomUUID()}`;
    upsertSession(safeWalletId, sessionId, 'signaling', { iceState: 'signaling', channelState: 'opening' });
    const handle = transport.createOfferPeer({
      iceServers: getIceServers(),
      handlers: channelHandlers(sessionId, safeWalletId),
    });
    bindHandle(sessionId, safeWalletId, handle);
    const offer = await handle.createOffer(Number(process.env.BSV_MARKET_WEBRTC_SIGNAL_TIMEOUT_MS || 5000));
    await signalService.emitSignal({
      type: 'chat.signal.offer',
      sessionId,
      fromWalletId: self.walletId,
      toWalletId: safeWalletId,
      payload: {
        description: offer,
        returnEndpoint: selfEndpoint,
        chatPubKey: self.chatPubKey,
      },
    }, { endpoint: peerEndpoint });
    if (normalizeString(sessionStore.getSession(sessionId)?.phase) !== 'connected') {
      upsertSession(safeWalletId, sessionId, 'checking', { iceState: 'checking' });
    }
    await handle.waitOpen(connectTimeoutMs());
    return markConnected(sessionId, { iceState: 'connected' }) || sessionStore.getSession(sessionId);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingConnects.delete(sessionId);
        markDisconnected(sessionId, 'webrtc_connect_timeout', { iceState: 'timeout' });
        reject(new Error('WebRTC connect timeout'));
      }, connectTimeoutMs());
      timer.unref?.();
      pendingConnects.set(sessionId, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  async function handleOffer(envelope) {
    const { state, runtimeReq } = requireState();
    const self = serverMarket.ensureSelfChatIdentity(state, runtimeReq);
    rememberSignalPeerIdentity(envelope.fromWalletId, envelope.payload?.chatPubKey, 'webrtc_offer');
    if (envelope.toWalletId !== self.walletId) return { ignored: true, reason: 'target_mismatch' };
    const relation = serverMarket.getChatRelationSnapshotFast(state, runtimeReq, envelope.fromWalletId);
    const selfState = serverMarket.getChatSelfStateSnapshotFast(state, runtimeReq);
    if (relation.blocked === true || selfState.online === false) {
      await postSignal(envelope.payload?.returnEndpoint, {
        type: 'chat.signal.reject',
        sessionId: envelope.sessionId,
        fromWalletId: self.walletId,
        toWalletId: envelope.fromWalletId,
        payload: { reason: relation.blocked === true ? 'blocked' : 'offline' },
      }).catch(() => {});
      return { rejected: true };
    }
    const handle = transport.createAnswerPeer({
      iceServers: getIceServers(),
      handlers: channelHandlers(envelope.sessionId, envelope.fromWalletId),
    });
    bindHandle(envelope.sessionId, envelope.fromWalletId, handle);
    upsertSession(envelope.fromWalletId, envelope.sessionId, 'checking', { iceState: 'checking', channelState: 'opening' });
    const answer = await handle.acceptOffer(envelope.payload?.description, Number(process.env.BSV_MARKET_WEBRTC_SIGNAL_TIMEOUT_MS || 5000));
    await postSignal(envelope.payload?.returnEndpoint, {
      type: 'chat.signal.answer',
      sessionId: envelope.sessionId,
      fromWalletId: self.walletId,
      toWalletId: envelope.fromWalletId,
      payload: { description: answer, chatPubKey: self.chatPubKey },
    });
    handle.waitOpen(connectTimeoutMs())
      .then(() => markConnected(envelope.sessionId, { iceState: 'connected' }))
      .catch((err) => {
        appendDebug('chat_v2_answer_wait_open_failed', {
          sessionId: envelope.sessionId,
          walletId: envelope.fromWalletId,
          message: String(err?.message || err || ''),
        });
      });
    return { accepted: true, sessionId: envelope.sessionId };
  }

  async function handleAnswer(envelope) {
    const session = sessionStore.getSession(envelope.sessionId);
    const handle = handlesBySessionId.get(envelope.sessionId);
    if (!session || !handle) return { ignored: true, reason: 'unknown_session' };
    rememberSignalPeerIdentity(envelope.fromWalletId, envelope.payload?.chatPubKey, 'webrtc_answer');
    await handle.acceptAnswer(envelope.payload?.description);
    await handle.waitOpen(connectTimeoutMs());
    markConnected(envelope.sessionId, { iceState: 'connected' });
    return { accepted: true, sessionId: envelope.sessionId };
  }

  async function handleReject(envelope) {
    markDisconnected(envelope.sessionId, normalizeString(envelope.payload?.reason) || 'remote_reject');
    return { rejected: true };
  }

  signalService.registerHandler('chat.signal.offer', handleOffer);
  signalService.registerHandler('chat.signal.answer', handleAnswer);
  signalService.registerHandler('chat.signal.reject', handleReject);

  async function receiveSignal(envelope = {}, meta = {}) {
    appendDebug('chat_v2_signal_received', {
      type: normalizeString(envelope.type),
      sessionId: normalizeString(envelope.sessionId),
      fromWalletId: normalizeString(envelope.fromWalletId),
      toWalletId: normalizeString(envelope.toWalletId),
      source: normalizeString(meta.source),
    });
    return signalService.receiveSignal(envelope, meta);
  }

  async function disconnectPeer(walletId, options = {}) {
    const session = getPeerSession(walletId);
    if (!session) return { walletId: normalizeString(walletId), disconnected: true, acknowledged: false };
    try {
      sendControl(session.sessionId, { type: 'chat.control.disconnect', sessionId: session.sessionId, requestedAt: nowIso() });
      await delay(Math.max(50, Number(process.env.BSV_MARKET_CHAT_DISCONNECT_GRACE_MS || 300)));
    } catch (_) {}
    const next = markDisconnected(session.sessionId, 'manual_disconnect', { manuallyDisconnected: options.manual !== false });
    return { walletId: normalizeString(walletId), disconnected: true, acknowledged: true, sessionId: normalizeString(next?.sessionId) };
  }

  async function sendDirectMessage(body = {}) {
    const walletId = normalizeString(body.walletId);
    const text = String(body.text || '');
    const orderId = normalizeString(body.orderId);
    const clientMsgId = normalizeString(body.clientMsgId || body.clientMessageId);
    if (!walletId) throw new Error('walletId is required');
    if (!text.trim()) throw new Error('text is required');
    const session = getPeerSession(walletId);
    if (!session || session.phase !== 'connected') {
      const error = new Error('direct chat not connected');
      error.code = 'CHAT_DIRECT_NOT_CONNECTED';
      throw error;
    }
    const { frame, message } = buildLocalMessage(walletId, text, orderId, clientMsgId);
    await new Promise((resolve, reject) => {
      const timeoutMs = Math.max(15000, Number(process.env.BSV_MARKET_CHAT_DELIVERY_ACK_MS || 30000));
      const timer = setTimeout(() => {
        pendingDelivery.delete(message.msgId);
        reject(new Error('delivery ack timeout'));
      }, timeoutMs);
      timer.unref?.();
      pendingDelivery.set(message.msgId, {
        resolve(value) {
          clearTimeout(timer);
          resolve(value);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      try { sendMessage(session.sessionId, frame); } catch (error) {
        clearTimeout(timer);
        pendingDelivery.delete(message.msgId);
        reject(error);
      }
    });
    runtime.touchMessage(session.sessionId, message.ts);
    message.status = 'delivered';
    appendRuntimeMessage(message);
    return { success: true, transport: 'p2p', directConnected: true, message };
  }

  function getStatus(walletId) {
    const session = getPeerSession(walletId);
    if (!session) return {
      walletId: normalizeString(walletId),
      directConnected: false,
      connecting: false,
      presenceStatus: '',
      statusLabel: '',
      activeSessionId: '',
      transport: 'onchain',
    };
    return toStatusPayload(session);
  }

  function getSendPreview(walletId) {
    const status = getStatus(walletId);
    return {
      walletId: normalizeString(walletId),
      transport: status.directConnected ? 'p2p' : 'onchain',
      directConnected: status.directConnected === true,
      requiresFeeConfirm: status.directConnected !== true,
      feeSat: status.directConnected ? 0 : 12,
    };
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      for (const session of sessionStore.listSessions()) {
        if (session.phase !== 'connected') continue;
        try {
          sendControl(session.sessionId, { type: 'chat.control.ping', sessionId: session.sessionId, ts: nowIso() });
        } catch (_) {
          markDisconnected(session.sessionId, 'heartbeat_send_failed');
        }
      }
      runtime.disconnectTimedOutSessions(Date.now()).forEach((session) => markDisconnected(session.sessionId, 'heartbeat_timeout'));
    }, Math.max(3000, Number(process.env.BSV_MARKET_CHAT_HEARTBEAT_INTERVAL_MS || 8000)));
    heartbeatTimer.unref?.();
  }

  function stop() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    for (const handle of handlesBySessionId.values()) handle.close?.();
    handlesBySessionId.clear();
    walletToSessionId.clear();
  }

  startHeartbeat();

  return {
    sessionStore,
    runtime,
    connectPeer,
    disconnectPeer,
    sendDirectMessage,
    receiveSignal,
    getStatus,
    getSendPreview,
    stop,
  };
}

module.exports = {
  createChatTransportV2Service,
};
