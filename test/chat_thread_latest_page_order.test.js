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

test('chat thread first page uses message time before event sequence', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-chat-page-order-'));
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

  await chatDomain.emitChatEvent('chat.message.sent', {
    selfWalletId: 'wallet-self',
    peerWalletId: 'wallet-peer',
    msgId: 'msg-new',
    direction: 'out',
    transport: 'onchain',
    text: 'new message',
    ts: '2026-04-23T04:05:00.000Z',
    status: 'broadcasted',
  }, {
    producer: 'chat_page_order_test',
    entityType: 'chat_message',
    entityId: 'msg-new',
  });

  await chatDomain.emitChatEvent('chat.message.received', {
    selfWalletId: 'wallet-self',
    peerWalletId: 'wallet-peer',
    msgId: 'msg-old-late-event',
    direction: 'in',
    transport: 'onchain',
    text: 'old late event',
    ts: '2026-04-23T02:54:00.000Z',
    status: 'visible',
  }, {
    producer: 'chat_page_order_test',
    entityType: 'chat_message',
    entityId: 'msg-old-late-event',
  });

  const firstPage = await chatDomain.getThread('wallet-self', 'wallet-peer', 1, 1);
  assert.deepEqual(firstPage.messages.map((row) => row.msgId), ['msg-new']);

  const secondPage = await chatDomain.getThread('wallet-self', 'wallet-peer', 1, 2);
  assert.deepEqual(secondPage.messages.map((row) => row.msgId), ['msg-old-late-event']);
});
