const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const paramsStart = source.indexOf('(', start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') parenDepth -= 1;
    if (parenDepth === 0) {
      bodyStart = source.indexOf('{', i);
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `missing function body ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function loadChatMessageHooks() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const module = { exports: {} };
  const state = {
    chat: {
      activeWalletId: 'wallet-peer',
      activeOrderId: '',
      mode: 'global',
      pendingLocalMessages: [],
      threadCache: {},
      nextMessageSequence: 1,
    },
  };
  const code = [
    'function chatThreadCacheKey(walletId, mode, orderId) { return `${walletId}::${mode || "global"}::${orderId || ""}`; }',
    'function getChatThreadCacheEntry(walletId = state.chat.activeWalletId, mode = state.chat.mode, orderId = null) { return state.chat.threadCache[chatThreadCacheKey(walletId, mode, orderId)] || null; }',
    extractFunction(source, 'allocateChatMessageSequence'),
    extractFunction(source, 'normalizeChatMessageForOrder'),
    extractFunction(source, 'resequenceChatMessagesForPrepend'),
    extractFunction(source, 'mergeChatMessagesSorted'),
    'function setChatThreadCacheEntry(messages, options = {}) { const walletId = String(options.walletId || state.chat.activeWalletId || ""); const mode = String(options.mode || state.chat.mode || "global"); const orderId = mode === "order" ? String(options.orderId || "") : ""; const entry = { walletId, mode, orderId, loaded: options.loaded === true, page: 1, lastFetchedCount: Array.isArray(messages) ? messages.length : 0, messages: mergeChatMessagesSorted(messages || []) }; state.chat.threadCache[chatThreadCacheKey(walletId, mode, orderId)] = entry; return entry; }',
    extractFunction(source, 'buildRenderableChatMessages'),
    extractFunction(source, 'chatMessagesDataSignature'),
    extractFunction(source, 'upsertChatMessageInCache'),
    extractFunction(source, 'replaceChatMessageInCache'),
    extractFunction(source, 'findMatchingPendingLocalMessage'),
    extractFunction(source, 'reconcilePendingLocalMessage'),
    'module.exports = { state, buildRenderableChatMessages, upsertChatMessageInCache, replaceChatMessageInCache, reconcilePendingLocalMessage, mergeChatMessagesSorted, resequenceChatMessagesForPrepend };',
  ].join('\n\n');
  vm.runInNewContext(code, { module, state, Date, Math, Number, Object, String, Array, Set, Map });
  return module.exports;
}

test('chat send server echo replaces and removes local pending message', () => {
  const {
    state,
    buildRenderableChatMessages,
    upsertChatMessageInCache,
    replaceChatMessageInCache,
    reconcilePendingLocalMessage,
  } = loadChatMessageHooks();
  const tempMsgId = 'local:send-1';
  const pending = {
    msgId: tempMsgId,
    clientMsgId: tempMsgId,
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'second message',
    ts: '2026-04-22T12:00:00.000Z',
    status: 'sending',
    __sortTs: '2026-04-22T12:00:00.000Z',
    __orderSeq: 1,
  };
  state.chat.pendingLocalMessages.push(pending);
  upsertChatMessageInCache(pending, { walletId: 'wallet-peer', mode: 'global' });

  const serverMessage = {
    msgId: 'p2p:server-1',
    clientMsgId: tempMsgId,
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'second message',
    ts: '2026-04-22T12:00:01.000Z',
    status: 'delivered',
  };

  assert.equal(reconcilePendingLocalMessage(serverMessage, { walletId: 'wallet-peer', mode: 'global' }), true);
  assert.equal(state.chat.pendingLocalMessages.length, 0);

  let rows = buildRenderableChatMessages();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].msgId, 'p2p:server-1');
  assert.equal(rows[0].text, 'second message');

  replaceChatMessageInCache(tempMsgId, serverMessage, { walletId: 'wallet-peer', mode: 'global' });
  rows = buildRenderableChatMessages();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].msgId, 'p2p:server-1');
});

test('chat display follows queue sequence instead of message timestamp', () => {
  const { state, buildRenderableChatMessages, upsertChatMessageInCache, replaceChatMessageInCache } = loadChatMessageHooks();
  const tempMsgId = 'local:future-send';
  const pending = {
    msgId: tempMsgId,
    clientMsgId: tempMsgId,
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'local future',
    ts: '2026-04-22T12:10:00.000Z',
    status: 'sending',
    __sortTs: '2026-04-22T12:10:00.000Z',
    __orderSeq: 1,
  };
  upsertChatMessageInCache(pending, { walletId: 'wallet-peer', mode: 'global' });
  replaceChatMessageInCache(tempMsgId, {
    msgId: 'p2p:server-out',
    clientMsgId: tempMsgId,
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'local future',
    ts: '2026-04-22T12:10:00.000Z',
    status: 'delivered',
    sourceEventSeq: 10,
  }, { walletId: 'wallet-peer', mode: 'global' });
  upsertChatMessageInCache({
    msgId: 'p2p:server-in',
    walletId: 'wallet-peer',
    direction: 'in',
    transport: 'p2p',
    text: 'incoming after send',
    ts: '2026-04-22T12:00:02.000Z',
    status: 'delivered',
    sourceEventSeq: 11,
  }, { walletId: 'wallet-peer', mode: 'global' });

  assert.deepEqual(buildRenderableChatMessages().map((row) => row.msgId), ['p2p:server-out', 'p2p:server-in']);
});

test('chat message sort keeps current queue order for same timestamp persisted rows', () => {
  const { state, buildRenderableChatMessages, upsertChatMessageInCache } = loadChatMessageHooks();
  const ts = '2026-04-22T12:00:00.000Z';

  upsertChatMessageInCache({
    msgId: 'p2p:c',
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'third',
    ts,
    sourceEventSeq: 3,
  }, { walletId: 'wallet-peer', mode: 'global' });
  upsertChatMessageInCache({
    msgId: 'p2p:a',
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'first',
    ts,
    sourceEventSeq: 1,
  }, { walletId: 'wallet-peer', mode: 'global' });
  upsertChatMessageInCache({
    msgId: 'p2p:b',
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'second',
    ts,
    sourceEventSeq: 2,
  }, { walletId: 'wallet-peer', mode: 'global' });

  assert.deepEqual(buildRenderableChatMessages().map((row) => row.msgId), ['p2p:c', 'p2p:a', 'p2p:b']);

  state.chat.threadCache = {};
  upsertChatMessageInCache({
    msgId: 'p2p:c',
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'third',
    ts,
  }, { walletId: 'wallet-peer', mode: 'global' });
  upsertChatMessageInCache({
    msgId: 'p2p:a',
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'first',
    ts,
  }, { walletId: 'wallet-peer', mode: 'global' });
  upsertChatMessageInCache({
    msgId: 'p2p:b',
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'p2p',
    text: 'second',
    ts,
  }, { walletId: 'wallet-peer', mode: 'global' });

  assert.deepEqual(buildRenderableChatMessages().map((row) => row.msgId), ['p2p:c', 'p2p:a', 'p2p:b']);
});

test('onchain server echo keeps the optimistic send queue position', () => {
  const { buildRenderableChatMessages, upsertChatMessageInCache, replaceChatMessageInCache } = loadChatMessageHooks();
  upsertChatMessageInCache({
    msgId: 'chain:old-1',
    walletId: 'wallet-peer',
    direction: 'in',
    transport: 'onchain',
    text: 'old 1',
    ts: '2026-04-22T12:00:00.000Z',
    sourceEventSeq: 100,
  }, { walletId: 'wallet-peer', mode: 'global' });
  upsertChatMessageInCache({
    msgId: 'chain:old-2',
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'onchain',
    text: 'old 2',
    ts: '2026-04-22T12:00:01.000Z',
    sourceEventSeq: 101,
  }, { walletId: 'wallet-peer', mode: 'global' });
  upsertChatMessageInCache({
    msgId: 'local:onchain-send',
    clientMsgId: 'local:onchain-send',
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'onchain',
    text: 'new onchain',
    ts: '2026-04-22T12:00:02.000Z',
    status: 'sending',
  }, { walletId: 'wallet-peer', mode: 'global' });

  replaceChatMessageInCache('local:onchain-send', {
    msgId: 'chain:new-low-event-seq',
    clientMsgId: 'local:onchain-send',
    walletId: 'wallet-peer',
    direction: 'out',
    transport: 'onchain',
    text: 'new onchain',
    ts: '2026-04-22T12:00:03.000Z',
    status: 'broadcasted',
    sourceEventSeq: 1,
  }, { walletId: 'wallet-peer', mode: 'global' });

  assert.deepEqual(buildRenderableChatMessages().map((row) => row.msgId), [
    'chain:old-1',
    'chain:old-2',
    'chain:new-low-event-seq',
  ]);
});

test('loading older chat page prepends rows before current cache', () => {
  const {
    mergeChatMessagesSorted,
    resequenceChatMessagesForPrepend,
  } = loadChatMessageHooks();

  const currentRows = [
    {
      msgId: 'p2p:new-1',
      walletId: 'wallet-peer',
      direction: 'in',
      transport: 'p2p',
      text: 'new 1',
      ts: '2026-04-22T12:00:10.000Z',
      __orderSeq: 1,
    },
    {
      msgId: 'p2p:new-2',
      walletId: 'wallet-peer',
      direction: 'out',
      transport: 'p2p',
      text: 'new 2',
      ts: '2026-04-22T12:00:11.000Z',
      __orderSeq: 2,
    },
  ];
  const olderRows = [
    {
      msgId: 'p2p:old-1',
      walletId: 'wallet-peer',
      direction: 'in',
      transport: 'p2p',
      text: 'old 1',
      ts: '2026-04-22T11:59:58.000Z',
    },
    {
      msgId: 'p2p:old-2',
      walletId: 'wallet-peer',
      direction: 'out',
      transport: 'p2p',
      text: 'old 2',
      ts: '2026-04-22T11:59:59.000Z',
    },
  ];

  const merged = mergeChatMessagesSorted(resequenceChatMessagesForPrepend(olderRows, currentRows));
  assert.deepEqual(merged.map((row) => row.msgId), ['p2p:old-1', 'p2p:old-2', 'p2p:new-1', 'p2p:new-2']);
});
