const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

test('event bus appends facts and chat projection writer builds chat-only projections', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-event-bus-chat-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
  };

  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;

  const marketDb = loadFresh('../market_db');
  const eventBus = loadFresh('../lib/event_bus');
  const chatDomain = loadFresh('../chat_domain');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();

  await chatDomain.emitChatEvent('chat.handshake.started', {
    selfWalletId: 'wallet-self',
    peerWalletId: 'wallet-peer',
    displayName: 'Peer One',
  }, {
    producer: 'chat_test',
    entityType: 'chat_peer',
    entityId: 'wallet-peer',
  });

  await chatDomain.emitChatEvent('chat.handshake.succeeded', {
    selfWalletId: 'wallet-self',
    peerWalletId: 'wallet-peer',
    displayName: 'Peer One',
  }, {
    producer: 'chat_test',
    entityType: 'chat_peer',
    entityId: 'wallet-peer',
  });

  await chatDomain.emitChatEvent('chat.message.received', {
    selfWalletId: 'wallet-self',
    peerWalletId: 'wallet-peer',
    msgId: 'msg-1',
    direction: 'in',
    transport: 'p2p',
    text: 'hello over bus',
    ts: '2026-04-04T13:00:00.000Z',
    status: 'delivered',
    displayName: 'Peer One',
  }, {
    producer: 'chat_test',
    entityType: 'chat_message',
    entityId: 'msg-1',
  });

  const events = await eventBus.listEventsAfter(0, 20);
  assert.equal(events.length, 3);
  assert.equal(events[0].eventType, 'chat.handshake.started');
  assert.equal(events[2].eventType, 'chat.message.received');

  const status = await chatDomain.getStatus('wallet-self', 'wallet-peer');
  assert.equal(status.status, 'chatable');

  const threads = await chatDomain.listThreads('wallet-self');
  assert.equal(threads.length, 1);
  assert.equal(threads[0].peerWalletId, 'wallet-peer');
  assert.equal(threads[0].displayName, 'Peer One');
  assert.equal(threads[0].unreadCount, 1);
  assert.equal(threads[0].lastMessagePreview, 'hello over bus');

  const threadView = await chatDomain.getThread('wallet-self', 'wallet-peer');
  assert.equal(threadView.thread.peerWalletId, 'wallet-peer');
  assert.equal(threadView.messages.length, 1);
  assert.equal(threadView.messages[0].text, 'hello over bus');
  assert.equal(threadView.messages[0].transport, 'p2p');
});

test('chat thread summary does not move backwards when older message event arrives late', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-chat-order-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
  };

  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;

  const marketDb = loadFresh('../market_db');
  const chatDomain = loadFresh('../chat_domain');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();

  await chatDomain.emitChatEvent('chat.message.received', {
    selfWalletId: 'wallet-self',
    peerWalletId: 'wallet-peer',
    msgId: 'msg-new',
    direction: 'in',
    transport: 'p2p',
    text: 'new message',
    ts: '2026-04-04T13:10:00.000Z',
    status: 'delivered',
    displayName: 'Peer One',
  }, {
    producer: 'chat_test',
    entityType: 'chat_message',
    entityId: 'msg-new',
  });

  await chatDomain.emitChatEvent('chat.message.sent', {
    selfWalletId: 'wallet-self',
    peerWalletId: 'wallet-peer',
    msgId: 'msg-old',
    direction: 'out',
    transport: 'p2p',
    text: 'old message',
    ts: '2026-04-04T13:00:00.000Z',
    status: 'delivered',
    displayName: 'Peer One',
  }, {
    producer: 'chat_test',
    entityType: 'chat_message',
    entityId: 'msg-old',
  });

  const threads = await chatDomain.listThreads('wallet-self');
  assert.equal(threads.length, 1);
  assert.equal(threads[0].lastMessageId, 'msg-new');
  assert.equal(threads[0].lastMessageAt, '2026-04-04T13:10:00.000Z');
  assert.equal(threads[0].lastMessagePreview, 'new message');

  const threadView = await chatDomain.getThread('wallet-self', 'wallet-peer');
  assert.deepEqual(threadView.messages.map((row) => row.msgId), ['msg-old', 'msg-new']);
});
