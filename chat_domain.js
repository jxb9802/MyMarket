const messageQueue = require('./lib/message_queue');
const eventBus = require('./lib/event_bus');
const marketDb = require('./market_db');
const { chatAttachmentPreview } = require('./chat_attachment_service');
const CHAT_CONSUMER = 'chat_projection_writer_v1';
let chatRuntimeSeq = 1;

function nowIso() {
  return new Date().toISOString();
}

function defaultPresence(selfWalletId, peerWalletId) {
  return {
    selfWalletId,
    peerWalletId,
    status: 'offline',
    lastEventSeq: 0,
    lastEventType: '',
    lastSeenAt: '',
    lastHandshakeAt: '',
    lastFailureAt: '',
    lastError: '',
    updatedAt: nowIso(),
  };
}

function defaultThread(selfWalletId, peerWalletId) {
  return {
    selfWalletId,
    peerWalletId,
    threadId: `chat:${selfWalletId}:${peerWalletId}`,
    displayName: peerWalletId,
    unreadCount: 0,
    lastMessageId: '',
    lastMessageAt: '',
    lastMessagePreview: '',
    lastTransport: '',
    lastReadAt: '',
    lastEventSeq: 0,
    updatedAt: nowIso(),
  };
}

function looksLikeGeneratedChatName(value = '', walletId = '') {
  const name = String(value || '').trim();
  const peerWalletId = String(walletId || '').trim();
  if (!name) return true;
  if (peerWalletId && name === peerWalletId) return true;
  return /^wallet-[a-z0-9_-]+$/i.test(name) || /^m-[a-z0-9_-]+$/i.test(name);
}

function mergeThreadDisplayName(thread, peerWalletId, incoming = '') {
  const current = String(thread?.displayName || '').trim();
  const next = String(incoming || '').trim();
  if (!next) return current || String(peerWalletId || '').trim();
  if (looksLikeGeneratedChatName(next, peerWalletId) && current && !looksLikeGeneratedChatName(current, peerWalletId)) {
    return current;
  }
  return next;
}

function defaultContact(selfWalletId, peerWalletId) {
  return {
    selfWalletId,
    peerWalletId,
    isFriend: false,
    friendStatus: 'none',
    blocked: false,
    updatedAt: nowIso(),
  };
}

function defaultSelfState(selfWalletId) {
  return {
    selfWalletId,
    online: true,
    storageLimitBytes: 104857600,
    updatedAt: nowIso(),
  };
}

function upsertMapRow(map, key, createRow) {
  if (!map.has(key)) map.set(key, createRow());
  return map.get(key);
}

function makePeerKey(selfWalletId, peerWalletId) {
  return `${selfWalletId}::${peerWalletId}`;
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

async function loadProjectionState(selfWalletIdFilter = null) {
  const selfWalletIds = [];
  if (selfWalletIdFilter) selfWalletIds.push(String(selfWalletIdFilter || '').trim());
  const presenceRows = [];
  const threadRows = [];
  const contactRows = [];
  const selfStateRows = [];
  const messageRows = [];
  if (selfWalletIds.length > 0) {
    for (const selfWalletId of selfWalletIds) {
      presenceRows.push(...await marketDb.listChatPresenceProjection(selfWalletId));
      threadRows.push(...await marketDb.listChatThreadStatusProjection(selfWalletId));
      contactRows.push(...await marketDb.listChatContactProjection(selfWalletId));
      selfStateRows.push(await marketDb.getChatSelfStateProjection(selfWalletId));
    }
  }
  const presenceMap = new Map();
  const threadMap = new Map();
  const contactMap = new Map();
  const selfStateMap = new Map();
  presenceRows.forEach((row) => {
    presenceMap.set(makePeerKey(row.selfWalletId, row.peerWalletId), { ...row });
  });
  threadRows.forEach((row) => {
    threadMap.set(makePeerKey(row.selfWalletId, row.peerWalletId), { ...row });
  });
  contactRows.forEach((row) => {
    contactMap.set(makePeerKey(row.selfWalletId, row.peerWalletId), { ...row });
  });
  selfStateRows.forEach((row) => {
    if (row?.selfWalletId) selfStateMap.set(String(row.selfWalletId), { ...row });
  });
  return {
    presenceMap,
    threadMap,
    contactMap,
    selfStateMap,
    messageRows,
  };
}

function nextRuntimeSeq() {
  const current = Math.max(1, Number(chatRuntimeSeq || 1));
  chatRuntimeSeq = current + 1;
  return current;
}

function buildRuntimeEvent(eventType, payload = {}, meta = {}) {
  return {
    eventType: String(eventType || '').trim(),
    payload: payload && typeof payload === 'object' ? payload : {},
    seq: nextRuntimeSeq(),
    ts: String(meta.ts || nowIso()),
  };
}

function inferChatEventEntityId(eventType, payload = {}) {
  const direct = String(payload.msgId || payload.threadId || payload.peerWalletId || payload.walletId || '').trim();
  if (direct) return direct;
  const parts = [
    payload.selfWalletId || payload.fromWalletId || '',
    payload.peerWalletId || payload.toWalletId || '',
  ].map((part) => String(part || '').trim()).filter(Boolean);
  if (parts.length > 0) return parts.join(':');
  return String(eventType || 'chat_event').trim();
}

function buildChatFactEventInput(eventType, payload = {}, meta = {}) {
  const normalizedPayload = payload && typeof payload === 'object' ? payload : {};
  return {
    eventType: String(eventType || '').trim(),
    producer: String(meta.producer || 'chat_domain').trim(),
    entityType: String(meta.entityType || 'chat_event').trim(),
    entityId: String(meta.entityId || inferChatEventEntityId(eventType, normalizedPayload)).trim(),
    ts: String(meta.ts || nowIso()),
    schemaVersion: Math.max(1, Number(meta.schemaVersion || 1)),
    causationId: String(meta.causationId || '').trim(),
    correlationId: String(meta.correlationId || '').trim(),
    dedupeKey: String(meta.dedupeKey || '').trim(),
    payload: normalizedPayload,
  };
}

function collectTargetSelfWalletIds(eventType, payload = {}) {
  const ids = new Set();
  const add = (value) => {
    const normalized = String(value || '').trim();
    if (normalized) ids.add(normalized);
  };
  add(payload.selfWalletId);
  if (eventType === 'chat.friend.requested') {
    add(payload.fromWalletId);
    add(payload.toWalletId);
  }
  if (eventType === 'chat.friend.accepted' || eventType === 'chat.friend.rejected') {
    add(payload.selfWalletId);
    add(payload.peerWalletId);
  }
  return Array.from(ids);
}

function buildProjectionPayload(state) {
  return {
    selfStates: Array.from(state.selfStateMap.values()),
    contacts: Array.from(state.contactMap.values()),
    presences: Array.from(state.presenceMap.values()),
    threads: Array.from(state.threadMap.values()),
    messages: state.messageRows,
    deleteMessageKeys: [],
    deleteThreadKeys: state.deleteThreadKeys,
  };
}

async function applyEventDirectly(eventType, payload = {}, meta = {}) {
  const targetSelfWalletIds = collectTargetSelfWalletIds(eventType, payload);
  const merged = {
    presenceMap: new Map(),
    threadMap: new Map(),
    contactMap: new Map(),
    selfStateMap: new Map(),
    messageRows: [],
    deleteThreadKeys: [],
  };
  for (const selfWalletId of targetSelfWalletIds) {
    const loaded = await loadProjectionState(selfWalletId);
    loaded.presenceMap.forEach((value, key) => merged.presenceMap.set(key, value));
    loaded.threadMap.forEach((value, key) => merged.threadMap.set(key, value));
    loaded.contactMap.forEach((value, key) => merged.contactMap.set(key, value));
    loaded.selfStateMap.forEach((value, key) => merged.selfStateMap.set(key, value));
  }
  const event = meta?.event && typeof meta.event === 'object'
    ? meta.event
    : buildRuntimeEvent(eventType, payload, meta);
  applyEventToProjection(merged, event);
  await marketDb.applyChatProjectionBatch(buildProjectionPayload(merged));
  return event;
}

function normalizeThreadContext(payload = {}) {
  const selfWalletId = String(payload.selfWalletId || payload.toWalletId || '').trim();
  const peerWalletId = String(payload.peerWalletId || payload.fromWalletId || payload.walletId || '').trim();
  if (!selfWalletId || !peerWalletId) return null;
  return {
    selfWalletId,
    peerWalletId,
    threadId: String(payload.threadId || `chat:${selfWalletId}:${peerWalletId}`).trim(),
    displayName: String(payload.displayName || peerWalletId).trim(),
  };
}

function applyEventToProjection(state, event) {
  const eventType = String(event?.eventType || '').trim();
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const seq = Math.max(0, Number(event?.seq || 0));
  if (eventType === 'chat.handshake.started' || eventType === 'chat.handshake.succeeded' || eventType === 'chat.handshake.failed') {
    const ctx = normalizeThreadContext(payload);
    if (!ctx) return;
    const key = makePeerKey(ctx.selfWalletId, ctx.peerWalletId);
    const presence = upsertMapRow(state.presenceMap, key, () => defaultPresence(ctx.selfWalletId, ctx.peerWalletId));
    const thread = upsertMapRow(state.threadMap, key, () => defaultThread(ctx.selfWalletId, ctx.peerWalletId));
    if (payload.displayName) thread.displayName = mergeThreadDisplayName(thread, ctx.peerWalletId, ctx.displayName);
    presence.lastEventSeq = seq;
    presence.lastEventType = eventType;
    presence.updatedAt = String(event.ts || nowIso());
    thread.lastEventSeq = seq;
    thread.updatedAt = String(event.ts || nowIso());
    if (eventType === 'chat.handshake.started') {
      if (presence.status === 'offline') presence.status = 'connecting';
    } else if (eventType === 'chat.handshake.succeeded') {
      presence.status = 'chatable';
      presence.lastHandshakeAt = String(event.ts || nowIso());
      presence.lastError = '';
    } else {
      presence.status = 'reachable_failed';
      presence.lastFailureAt = String(event.ts || nowIso());
      presence.lastError = String(payload.error || '').trim();
    }
    return;
  }
  if (eventType === 'chat.self.status.changed') {
    const selfWalletId = String(payload.selfWalletId || '').trim();
    if (!selfWalletId) return;
    const selfState = upsertMapRow(state.selfStateMap, selfWalletId, () => defaultSelfState(selfWalletId));
    selfState.online = payload.online !== false;
    selfState.storageLimitBytes = Math.max(1024, Number(payload.storageLimitBytes || selfState.storageLimitBytes || 104857600));
    selfState.updatedAt = String(event.ts || nowIso());
    return;
  }
  if (eventType === 'chat.peer.blocked' || eventType === 'chat.peer.unblocked') {
    const selfWalletId = String(payload.selfWalletId || '').trim();
    const peerWalletId = String(payload.peerWalletId || '').trim();
    if (!selfWalletId || !peerWalletId) return;
    const key = makePeerKey(selfWalletId, peerWalletId);
    const contact = upsertMapRow(state.contactMap, key, () => defaultContact(selfWalletId, peerWalletId));
    contact.blocked = eventType === 'chat.peer.blocked';
    contact.updatedAt = String(event.ts || nowIso());
    if (contact.blocked) {
      state.messageRows = state.messageRows.filter((row) => !(row.selfWalletId === selfWalletId && row.peerWalletId === peerWalletId));
      state.deleteThreadKeys = Array.isArray(state.deleteThreadKeys) ? state.deleteThreadKeys : [];
      state.deleteThreadKeys.push({ selfWalletId, peerWalletId });
    }
    return;
  }
  if (eventType === 'chat.friend.requested') {
    const fromWalletId = String(payload.fromWalletId || payload.selfWalletId || '').trim();
    const toWalletId = String(payload.toWalletId || payload.peerWalletId || '').trim();
    if (!fromWalletId || !toWalletId) return;
    const outgoing = upsertMapRow(state.contactMap, makePeerKey(fromWalletId, toWalletId), () => defaultContact(fromWalletId, toWalletId));
    outgoing.isFriend = false;
    outgoing.friendStatus = 'outgoing_pending';
    outgoing.updatedAt = String(event.ts || nowIso());
    const incoming = upsertMapRow(state.contactMap, makePeerKey(toWalletId, fromWalletId), () => defaultContact(toWalletId, fromWalletId));
    incoming.isFriend = false;
    incoming.friendStatus = 'incoming_pending';
    incoming.updatedAt = String(event.ts || nowIso());
    return;
  }
  if (eventType === 'chat.friend.accepted') {
    const selfWalletId = String(payload.selfWalletId || '').trim();
    const peerWalletId = String(payload.peerWalletId || '').trim();
    if (!selfWalletId || !peerWalletId) return;
    const a = upsertMapRow(state.contactMap, makePeerKey(selfWalletId, peerWalletId), () => defaultContact(selfWalletId, peerWalletId));
    a.isFriend = true;
    a.friendStatus = 'friend';
    a.updatedAt = String(event.ts || nowIso());
    const b = upsertMapRow(state.contactMap, makePeerKey(peerWalletId, selfWalletId), () => defaultContact(peerWalletId, selfWalletId));
    b.isFriend = true;
    b.friendStatus = 'friend';
    b.updatedAt = String(event.ts || nowIso());
    return;
  }
  if (eventType === 'chat.friend.rejected') {
    const selfWalletId = String(payload.selfWalletId || '').trim();
    const peerWalletId = String(payload.peerWalletId || '').trim();
    if (!selfWalletId || !peerWalletId) return;
    const action = String(payload.action || 'reject').trim().toLowerCase();
    const a = upsertMapRow(state.contactMap, makePeerKey(selfWalletId, peerWalletId), () => defaultContact(selfWalletId, peerWalletId));
    a.isFriend = false;
    a.friendStatus = 'none';
    a.updatedAt = String(event.ts || nowIso());
    const b = upsertMapRow(state.contactMap, makePeerKey(peerWalletId, selfWalletId), () => defaultContact(peerWalletId, selfWalletId));
    b.isFriend = false;
    b.friendStatus = action === 'delete' ? 'none' : 'rejected';
    b.updatedAt = String(event.ts || nowIso());
    return;
  }
  if (eventType === 'chat.presence.received' || eventType === 'chat.presence.expired' || eventType === 'chat.presence.offline') {
    const ctx = normalizeThreadContext(payload);
    if (!ctx) return;
    const key = makePeerKey(ctx.selfWalletId, ctx.peerWalletId);
    const presence = upsertMapRow(state.presenceMap, key, () => defaultPresence(ctx.selfWalletId, ctx.peerWalletId));
    const thread = upsertMapRow(state.threadMap, key, () => defaultThread(ctx.selfWalletId, ctx.peerWalletId));
    if (payload.displayName) thread.displayName = mergeThreadDisplayName(thread, ctx.peerWalletId, ctx.displayName);
    presence.lastEventSeq = seq;
    presence.lastEventType = eventType;
    presence.updatedAt = String(event.ts || nowIso());
    if (eventType === 'chat.presence.received') {
      presence.status = 'online';
      presence.lastSeenAt = String(event.ts || nowIso());
    } else {
      presence.status = 'offline';
      if (eventType === 'chat.presence.offline') presence.lastSeenAt = String(event.ts || presence.lastSeenAt || '');
    }
    return;
  }
  if (eventType === 'chat.message.sent' || eventType === 'chat.message.received' || eventType === 'chat.message.anchored') {
    const selfWalletId = String(payload.selfWalletId || '').trim();
    const peerWalletId = String(payload.peerWalletId || '').trim();
    const msgId = String(payload.msgId || '').trim();
    if (!selfWalletId || !peerWalletId || !msgId) return;
    const key = makePeerKey(selfWalletId, peerWalletId);
    const contact = upsertMapRow(state.contactMap, key, () => defaultContact(selfWalletId, peerWalletId));
    if (contact.blocked) return;
    const thread = upsertMapRow(state.threadMap, key, () => defaultThread(selfWalletId, peerWalletId));
    const presence = upsertMapRow(state.presenceMap, key, () => defaultPresence(selfWalletId, peerWalletId));
    const payloadTransport = String(payload.transport || '').trim();
    const displayTransport = eventType === 'chat.message.anchored' && msgId.startsWith('p2p:') && payloadTransport === 'onchain'
      ? 'p2p'
      : payloadTransport;
    const messageTs = String(payload.ts || event.ts || nowIso());
    thread.displayName = mergeThreadDisplayName(thread, peerWalletId, payload.displayName || thread.displayName || peerWalletId);
    if (shouldUpdateThreadLastMessage(thread, messageTs, msgId)) {
      thread.lastMessageId = msgId;
      thread.lastMessageAt = messageTs;
      if (String(payload.text || '').trim()) {
        thread.lastMessagePreview = chatAttachmentPreview(String(payload.text || '')).slice(0, 280);
      }
      thread.lastTransport = String(displayTransport || thread.lastTransport || '');
    }
    thread.lastEventSeq = seq;
    thread.updatedAt = String(event.ts || nowIso());
    if (String(payload.direction || '') === 'in') {
      thread.unreadCount = Math.max(0, Number(thread.unreadCount || 0)) + 1;
    }
    if (eventType === 'chat.message.received') {
      presence.status = presence.status === 'offline' ? 'online' : presence.status;
      presence.lastSeenAt = String(payload.ts || event.ts || nowIso());
      presence.updatedAt = String(event.ts || nowIso());
      presence.lastEventSeq = Math.max(presence.lastEventSeq || 0, seq);
      presence.lastEventType = eventType;
    }
    state.messageRows.push({
      selfWalletId,
      peerWalletId,
      msgId,
      threadId: String(payload.threadId || thread.threadId),
      direction: String(payload.direction || ''),
      transport: String(displayTransport || ''),
      text: String(payload.text || ''),
      orderId: String(payload.orderId || ''),
      ts: String(payload.ts || event.ts || nowIso()),
      status: String(payload.status || ''),
      txid: String(payload.txid || ''),
      sourceEventSeq: seq,
      updatedAt: String(event.ts || nowIso()),
    });
    return;
  }
  if (eventType === 'chat.thread.read_marked') {
    const selfWalletId = String(payload.selfWalletId || '').trim();
    const peerWalletId = String(payload.peerWalletId || '').trim();
    if (!selfWalletId || !peerWalletId) return;
    const key = makePeerKey(selfWalletId, peerWalletId);
    const thread = upsertMapRow(state.threadMap, key, () => defaultThread(selfWalletId, peerWalletId));
    thread.unreadCount = 0;
    thread.lastReadAt = String(payload.readAt || event.ts || nowIso());
    thread.lastEventSeq = seq;
    thread.updatedAt = String(event.ts || nowIso());
  }
}

async function catchUpProjection() {
  return { applied: 0, lastSeq: Math.max(0, Number(chatRuntimeSeq || 1) - 1) };
}

function startProjectionCatchUp() {
  return Promise.resolve({ applied: 0, lastSeq: Math.max(0, Number(chatRuntimeSeq || 1) - 1) });
}

function scheduleProjectionCatchUp() {
  return undefined;
}

async function flushProjection() {
  return { applied: 0, lastSeq: Math.max(0, Number(chatRuntimeSeq || 1) - 1) };
}

async function emitChatEvent(eventType, payload = {}, meta = {}) {
  const event = await eventBus.appendEvent(buildChatFactEventInput(eventType, payload, meta));
  await messageQueue.publish(String(event.eventType || '').trim(), event.payload, {
    mode: messageQueue.MODE_TRANSIENT,
    source: String(event.producer || meta.producer || 'chat_domain'),
    ts: String(event.ts || nowIso()),
  });
  await applyEventDirectly(String(event.eventType || '').trim(), event.payload, { ...meta, event });
  return event;
}

async function listThreads(selfWalletId) {
  return marketDb.listChatThreadStatusProjection(selfWalletId);
}

async function getThreadBundle(selfWalletId) {
  const threadRows = await marketDb.listChatThreadStatusProjection(selfWalletId);
  const presenceRows = await marketDb.listChatPresenceProjection(selfWalletId);
  const contactRows = await marketDb.listChatContactProjection(selfWalletId);
  const selfState = await marketDb.getChatSelfStateProjection(selfWalletId);
  const presenceByPeerWalletId = Object.fromEntries(
    (Array.isArray(presenceRows) ? presenceRows : []).map((row) => [String(row?.peerWalletId || '').trim(), row]),
  );
  const contactByPeerWalletId = Object.fromEntries(
    (Array.isArray(contactRows) ? contactRows : []).map((row) => [String(row?.peerWalletId || '').trim(), row]),
  );
  return {
    threadRows: Array.isArray(threadRows) ? threadRows : [],
    presenceByPeerWalletId,
    contactByPeerWalletId,
    selfState,
  };
}

async function getThread(selfWalletId, peerWalletId, pageSize = 10, page = 1) {
  const threads = await marketDb.listChatThreadStatusProjection(selfWalletId);
  const thread = threads.find((row) => String(row.peerWalletId || '') === String(peerWalletId || '')) || null;
  const messages = await marketDb.listChatMessageIndexProjection(selfWalletId, peerWalletId, pageSize, page);
  return { thread, messages };
}

async function getStatus(selfWalletId, peerWalletId) {
  const rows = await marketDb.listChatPresenceProjection(selfWalletId);
  return rows.find((row) => String(row.peerWalletId || '') === String(peerWalletId || '')) || defaultPresence(selfWalletId, peerWalletId);
}

async function getContacts(selfWalletId) {
  return marketDb.listChatContactProjection(selfWalletId);
}

async function getSelfState(selfWalletId) {
  return marketDb.getChatSelfStateProjection(selfWalletId);
}

module.exports = {
  CHAT_CONSUMER,
  catchUpProjection,
  scheduleProjectionCatchUp,
  flushProjection,
  emitChatEvent,
  listThreads,
  getThreadBundle,
  getThread,
  getStatus,
  getContacts,
  getSelfState,
};
