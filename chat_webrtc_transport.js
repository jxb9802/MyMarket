'use strict';

let werift = null;
try {
  werift = require('werift');
} catch (_) {
  werift = null;
}

const DEFAULT_ICE_SERVERS = Object.freeze([
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
]);
const CHANNEL_CHUNK_PREFIX = '__bsv_chat_channel_chunk_v1__:';
const DEFAULT_CHANNEL_CHUNK_BYTES = 12 * 1024;
const DEFAULT_CHANNEL_MAX_FRAME_BYTES = 12 * 1024 * 1024;

function cloneIceServers(iceServers) {
  const input = Array.isArray(iceServers) ? iceServers.filter(Boolean) : [];
  const merged = input.length > 0
    ? [...input, ...DEFAULT_ICE_SERVERS]
    : DEFAULT_ICE_SERVERS;
  const seen = new Set();
  return merged.map((entry) => ({ ...entry })).filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeString(value) {
  return String(value || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function waitFor(predicate, timeoutMs, intervalMs = 50) {
  const deadline = Date.now() + Math.max(100, Number(timeoutMs || 0) || 1000);
  return new Promise((resolve, reject) => {
    const tick = () => {
      try {
        if (predicate()) return resolve(true);
      } catch (error) {
        return reject(error);
      }
      if (Date.now() >= deadline) return resolve(false);
      setTimeout(tick, Math.max(10, Number(intervalMs || 50))).unref?.();
    };
    tick();
  });
}

function hasCandidate(sdp) {
  return /^a=candidate:/im.test(String(sdp || ''));
}

function hasReflexiveOrRelayCandidate(sdp) {
  return /^a=candidate:.*\styp\s+(srflx|relay)\s/im.test(String(sdp || ''));
}

function makePeerConnection(options = {}) {
  const RTCPeerConnectionCtor = options.RTCPeerConnection
    || globalThis.RTCPeerConnection
    || werift?.RTCPeerConnection
    || null;
  if (!RTCPeerConnectionCtor) {
    throw new Error('RTCPeerConnection unavailable; install werift or provide a WebRTC implementation');
  }
  return new RTCPeerConnectionCtor({
    iceServers: cloneIceServers(options.iceServers),
  });
}

function subscribeEvent(target, name, handler) {
  const event = target?.[name];
  if (event && typeof event.subscribe === 'function') {
    const sub = event.subscribe(handler);
    return () => {
      try { sub?.unSubscribe?.(); } catch (_) {}
      try { sub?.unsubscribe?.(); } catch (_) {}
    };
  }
  return () => {};
}

function bindDataChannel(channel, handlers = {}) {
  if (!channel) return;
  const onOpen = typeof handlers.onOpen === 'function' ? handlers.onOpen : (() => {});
  const onClose = typeof handlers.onClose === 'function' ? handlers.onClose : (() => {});
  const onMessage = typeof handlers.onMessage === 'function' ? handlers.onMessage : (() => {});
  const chunkState = new Map();

  function cleanupExpiredChunks() {
    const cutoff = Date.now() - 2 * 60 * 1000;
    for (const [id, entry] of chunkState.entries()) {
      if (Number(entry?.createdAt || 0) < cutoff) chunkState.delete(id);
    }
  }

  function handleChunk(rawText) {
    if (!rawText.startsWith(CHANNEL_CHUNK_PREFIX)) return false;
    cleanupExpiredChunks();
    let chunk = null;
    try {
      chunk = JSON.parse(rawText.slice(CHANNEL_CHUNK_PREFIX.length));
    } catch (_) {
      return true;
    }
    const id = normalizeString(chunk?.id);
    const index = Math.max(0, Number(chunk?.index || 0));
    const count = Math.max(0, Number(chunk?.count || 0));
    const totalBytes = Math.max(0, Number(chunk?.totalBytes || 0));
    const data = String(chunk?.data || '');
    if (!id || count <= 0 || index >= count || !data) return true;
    const maxFrameBytes = Math.max(
      1024 * 1024,
      Number(process.env.BSV_MARKET_WEBRTC_CHANNEL_MAX_FRAME_BYTES || DEFAULT_CHANNEL_MAX_FRAME_BYTES),
    );
    if (totalBytes > maxFrameBytes) {
      chunkState.delete(id);
      return true;
    }
    let entry = chunkState.get(id);
    if (!entry) {
      entry = {
        count,
        totalBytes,
        createdAt: Date.now(),
        parts: new Array(count),
        received: 0,
      };
      chunkState.set(id, entry);
    }
    if (entry.count !== count || entry.totalBytes !== totalBytes || entry.parts[index]) return true;
    entry.parts[index] = data;
    entry.received += 1;
    if (entry.received < entry.count) return true;
    chunkState.delete(id);
    try {
      const body = Buffer.concat(entry.parts.map((part) => Buffer.from(part, 'base64')));
      if (entry.totalBytes > 0 && body.length !== entry.totalBytes) return true;
      onMessage(body.toString('utf8'), channel);
    } catch (_) {}
    return true;
  }

  subscribeEvent(channel, 'onopen', onOpen);
  subscribeEvent(channel, 'onclose', onClose);
  subscribeEvent(channel, 'onMessage', (raw) => {
    const value = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
    if (handleChunk(value)) return;
    onMessage(value, channel);
  });
}

async function waitForIceGathering(peerConnection, timeoutMs) {
  const timeout = Math.max(250, Number(timeoutMs || 2500));
  const startedAt = Date.now();
  const candidateGraceMs = Math.min(1200, Math.max(250, timeout));
  await Promise.race([
    waitFor(() => {
      const state = normalizeString(peerConnection?.iceGatheringState || peerConnection?.iceGatheringStateChange?.state);
      if (state === 'complete') return true;
      const sdp = String(peerConnection?.localDescription?.sdp || '');
      if (hasReflexiveOrRelayCandidate(sdp)) return true;
      return hasCandidate(sdp) && Date.now() - startedAt >= candidateGraceMs;
    }, timeout, 50),
    sleep(timeout),
  ]);
}

async function waitForChannelOpen(channel, timeoutMs) {
  const ok = await waitFor(() => normalizeString(channel?.readyState) === 'open', timeoutMs || 15000, 50);
  if (!ok) throw new Error('WebRTC data channel open timeout');
}

function createChatWebrtcTransport(deps = {}) {
  function createOfferPeer(options = {}) {
    const peerConnection = makePeerConnection({
      ...deps,
      ...options,
    });
    const controlChannel = peerConnection.createDataChannel('control', { negotiated: true, id: 0 });
    const messageChannel = peerConnection.createDataChannel('message', { negotiated: true, id: 1 });
    return createSessionHandle(peerConnection, {
      controlChannel,
      messageChannel,
      role: 'offerer',
      handlers: options.handlers,
    });
  }

  function createAnswerPeer(options = {}) {
    const peerConnection = makePeerConnection({
      ...deps,
      ...options,
    });
    const controlChannel = peerConnection.createDataChannel('control', { negotiated: true, id: 0 });
    const messageChannel = peerConnection.createDataChannel('message', { negotiated: true, id: 1 });
    const handle = createSessionHandle(peerConnection, {
      controlChannel,
      messageChannel,
      role: 'answerer',
      handlers: options.handlers,
    });
    return handle;
  }

  function createSessionHandle(peerConnection, options = {}) {
    let controlChannel = options.controlChannel || null;
    let messageChannel = options.messageChannel || null;
    const handlers = options.handlers && typeof options.handlers === 'object' ? options.handlers : {};
    const onState = typeof handlers.onState === 'function' ? handlers.onState : (() => {});
    const onControlMessage = typeof handlers.onControlMessage === 'function' ? handlers.onControlMessage : (() => {});
    const onMessageFrame = typeof handlers.onMessageFrame === 'function' ? handlers.onMessageFrame : (() => {});
    let controlBound = false;
    let messageBound = false;

    function emitState(patch = {}) {
      onState({
        role: normalizeString(options.role),
        iceState: normalizeString(peerConnection?.iceConnectionState || ''),
        connectionState: normalizeString(peerConnection?.connectionState || ''),
        controlState: normalizeString(controlChannel?.readyState || ''),
        messageState: normalizeString(messageChannel?.readyState || ''),
        ...patch,
      });
    }

    function bindChannels() {
      if (controlChannel && !controlBound) {
        controlBound = true;
        bindDataChannel(controlChannel, {
          onOpen: () => emitState({ channel: 'control', event: 'open' }),
          onClose: () => emitState({ channel: 'control', event: 'close' }),
          onMessage: onControlMessage,
        });
      }
      if (messageChannel && !messageBound) {
        messageBound = true;
        bindDataChannel(messageChannel, {
          onOpen: () => emitState({ channel: 'message', event: 'open' }),
          onClose: () => emitState({ channel: 'message', event: 'close' }),
          onMessage: onMessageFrame,
        });
      }
    }

    subscribeEvent(peerConnection, 'iceConnectionStateChange', () => emitState({ event: 'ice_state' }));
    subscribeEvent(peerConnection, 'connectionStateChange', () => emitState({ event: 'connection_state' }));
    bindChannels();

    return {
      peerConnection,
      get controlChannel() { return controlChannel; },
      get messageChannel() { return messageChannel; },
      setControlChannel(channel) {
        controlChannel = channel;
        bindChannels();
        emitState({ channel: 'control', event: 'bound' });
      },
      setMessageChannel(channel) {
        messageChannel = channel;
        bindChannels();
        emitState({ channel: 'message', event: 'bound' });
      },
      async createOffer(timeoutMs) {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        await waitForIceGathering(peerConnection, timeoutMs || 2500);
        return peerConnection.localDescription || offer;
      },
      async acceptOffer(offer, timeoutMs) {
        await peerConnection.setRemoteDescription(offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await waitForIceGathering(peerConnection, timeoutMs || 2500);
        return peerConnection.localDescription || answer;
      },
      async acceptAnswer(answer) {
        await peerConnection.setRemoteDescription(answer);
      },
      async waitOpen(timeoutMs) {
        const ok = await waitFor(
          () => normalizeString(controlChannel?.readyState) === 'open'
            && normalizeString(messageChannel?.readyState) === 'open',
          timeoutMs || 15000,
          50,
        );
        if (!ok) throw new Error('WebRTC data channel open timeout');
      },
      sendControl(payload) {
        sendChannelFrame(controlChannel, payload);
      },
      sendMessage(payload) {
        sendChannelFrame(messageChannel, payload);
      },
      close() {
        try { controlChannel?.close?.(); } catch (_) {}
        try { messageChannel?.close?.(); } catch (_) {}
        try { peerConnection?.close?.(); } catch (_) {}
      },
    };
  }

  return {
    DEFAULT_ICE_SERVERS,
    createOfferPeer,
    createAnswerPeer,
    sendChannelFrame,
  };
}

function sendChannelFrame(channel, payload) {
  if (!channel || normalizeString(channel.readyState) !== 'open') {
    throw new Error('WebRTC data channel is not open');
  }
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const body = Buffer.from(text, 'utf8');
  const maxFrameBytes = Math.max(
    1024 * 1024,
    Number(process.env.BSV_MARKET_WEBRTC_CHANNEL_MAX_FRAME_BYTES || DEFAULT_CHANNEL_MAX_FRAME_BYTES),
  );
  if (body.length > maxFrameBytes) {
    throw new Error(`WebRTC data channel frame exceeds ${maxFrameBytes} bytes`);
  }
  const chunkBytes = Math.max(
    4096,
    Math.min(64 * 1024, Number(process.env.BSV_MARKET_WEBRTC_CHANNEL_CHUNK_BYTES || DEFAULT_CHANNEL_CHUNK_BYTES)),
  );
  if (body.length <= chunkBytes) {
    channel.send(text);
    return;
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  const count = Math.ceil(body.length / chunkBytes);
  for (let index = 0; index < count; index += 1) {
    const start = index * chunkBytes;
    const end = Math.min(body.length, start + chunkBytes);
    channel.send(`${CHANNEL_CHUNK_PREFIX}${JSON.stringify({
      id,
      index,
      count,
      totalBytes: body.length,
      data: body.subarray(start, end).toString('base64'),
    })}`);
  }
}

module.exports = {
  DEFAULT_ICE_SERVERS,
  createChatWebrtcTransport,
  CHANNEL_CHUNK_PREFIX,
};
