const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const PASSWORD = 'chat-module-v1-password';
const FRIEND_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const RECENT_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';
const SEARCH_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => resolve(addr.port));
    });
    server.on('error', reject);
  });
}

function parseSetCookie(headers) {
  const setCookie = headers.get('set-cookie') || '';
  return String(setCookie || '').split(';')[0];
}

async function waitForListening(server) {
  if (server.listening) return;
  await new Promise((resolve, reject) => {
    const onListening = () => {
      cleanup();
      resolve();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      server.off('listening', onListening);
      server.off('error', onError);
    };
    server.once('listening', onListening);
    server.once('error', onError);
  });
}

async function requestJson(baseUrl, pathname, { method = 'GET', body = null, cookie = '' } = {}) {
  const headers = { connection: 'close' };
  if (body !== null) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }
  return { status: res.status, json, headers: res.headers };
}

test('chat module v1 supports grouped threads, self-state, search, pagination, and block purge', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-chat-v1-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;
  process.env.BSV_MARKET_ENABLE_CHAT = '1';
  process.env.BSV_MARKET_DISABLE_BHS = '1';
  process.env.BSV_MARKET_DISABLE_STEWARD_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_CHAT_STEWARD = '1';
  process.env.BSV_MARKET_DISABLE_CATALOG_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_VIEW_STATE_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_STARTUP_CHAIN_SYNC = '1';
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';

  const wallet = require('../wallet');
  const serverMarket = require('../server_market');
  const chatDomain = require('../chat_domain');
  const port = await getFreePort();
  const server = await serverMarket.startServer({ port, host: '127.0.0.1' });
  await waitForListening(server);
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
    delete process.env.BSV_MARKET_DATA_DIR;
    delete process.env.BSV_MARKET_LOG_DIR;
    delete process.env.BSV_MARKET_ENABLE_CHAT;
    delete process.env.BSV_MARKET_DISABLE_BHS;
    delete process.env.BSV_MARKET_DISABLE_STEWARD_WORKER;
    delete process.env.BSV_MARKET_DISABLE_CHAT_STEWARD;
    delete process.env.BSV_MARKET_DISABLE_CATALOG_WORKER;
    delete process.env.BSV_MARKET_DISABLE_VIEW_STATE_WORKER;
    delete process.env.BSV_MARKET_DISABLE_STARTUP_CHAIN_SYNC;
    delete process.env.BSV_MARKET_DISABLE_SPV_LISTENER;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const createRes = await requestJson(baseUrl, '/api/wallet/create', {
    method: 'POST',
    body: { password: PASSWORD },
  });
  assert.equal(createRes.status, 200);
  const cookie = parseSetCookie(createRes.headers);

  const identityRes = await requestJson(baseUrl, '/api/chat/identity', { cookie });
  assert.equal(identityRes.status, 200);
  const selfWalletId = String(identityRes.json?.identity?.walletId || '');
  assert.ok(selfWalletId);

  const friendPubKey = wallet.deriveChatPublicKeyFromMnemonic(FRIEND_MNEMONIC);
  const recentPubKey = wallet.deriveChatPublicKeyFromMnemonic(RECENT_MNEMONIC);
  const searchPubKey = wallet.deriveChatPublicKeyFromMnemonic(SEARCH_MNEMONIC);
  const bindRows = [
    {
      walletId: 'wallet-friend',
      merchantId: 'Friend Alpha',
      chatPubKey: friendPubKey,
      mnemonic: FRIEND_MNEMONIC,
      ts: '2026-04-09T11:40:00.000Z',
      txid: '1'.repeat(64),
    },
    {
      walletId: 'wallet-recent',
      merchantId: 'Recent Beta',
      chatPubKey: recentPubKey,
      mnemonic: RECENT_MNEMONIC,
      ts: '2026-04-09T11:41:00.000Z',
      txid: '2'.repeat(64),
    },
    {
      walletId: 'wallet-search',
      merchantId: 'Search Gamma',
      chatPubKey: searchPubKey,
      mnemonic: SEARCH_MNEMONIC,
      ts: '2026-04-09T11:42:00.000Z',
      txid: '3'.repeat(64),
    },
  ].map((row) => ({
    ts: row.ts,
    eventType: 'wallet_key_bind',
    payload: {
      walletId: row.walletId,
      merchantId: row.merchantId,
      chatPubKey: row.chatPubKey,
      endpointHints: [],
      relayHints: [],
      signature: wallet.signWalletKeyBind({
        mnemonic: row.mnemonic,
        walletId: row.walletId,
        merchantId: row.merchantId,
        chatPubKey: row.chatPubKey,
        endpointHints: [],
        relayHints: [],
        createdAt: row.ts,
      }),
      _v: 3,
      _updatedAt: row.ts,
    },
    txid: row.txid,
    node: 'test',
    confirmed: false,
    publicVisible: true,
  }));
  fs.writeFileSync(path.join(dataDir, 'anchors_global.json'), JSON.stringify(bindRows, null, 2));

  await chatDomain.emitChatEvent('chat.self.status.changed', {
    selfWalletId,
    online: false,
    storageLimitBytes: 104857600,
  }, { producer: 'test' });

  await chatDomain.emitChatEvent('chat.friend.accepted', {
    selfWalletId,
    peerWalletId: 'wallet-friend',
  }, { producer: 'test' });

  await chatDomain.emitChatEvent('chat.message.received', {
    selfWalletId,
    peerWalletId: 'wallet-friend',
    msgId: 'friend-msg-1',
    threadId: `chat:${selfWalletId}:wallet-friend`,
    direction: 'in',
    transport: 'p2p',
    text: 'hello-friend',
    ts: '2026-04-09T12:00:00.000Z',
    status: 'delivered',
    displayName: 'Friend Alpha',
  }, { producer: 'test' });

  for (let i = 0; i < 12; i += 1) {
    await chatDomain.emitChatEvent('chat.message.received', {
      selfWalletId,
      peerWalletId: 'wallet-recent',
      msgId: `recent-msg-${i}`,
      threadId: `chat:${selfWalletId}:wallet-recent`,
      direction: 'in',
      transport: i % 2 === 0 ? 'p2p' : 'onchain',
      text: `hello-recent-${i}`,
      ts: `2026-04-09T12:${String(i).padStart(2, '0')}:00.000Z`,
      status: 'delivered',
      displayName: 'Recent Beta',
    }, { producer: 'test' });
  }

  const threadsRes = await requestJson(baseUrl, '/api/chat/threads', { cookie });
  assert.equal(threadsRes.status, 200);
  assert.equal(threadsRes.json?.success, true);
  assert.equal(threadsRes.json?.selfState?.online, false);
  assert.equal(Array.isArray(threadsRes.json?.friends), true);
  assert.equal(Array.isArray(threadsRes.json?.recent), true);
  assert.equal(threadsRes.json.friends.some((row) => row.walletId === 'wallet-friend' && row.isFriend === true), true);
  assert.equal(threadsRes.json.recent.some((row) => row.walletId === 'wallet-recent'), true);

  const searchRes = await requestJson(baseUrl, '/api/chat/search?q=search', { cookie });
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.json?.results?.some((row) => row.walletId === 'wallet-search'), true);
  assert.equal(searchRes.json?.results?.some((row) => row.walletId === 'wallet-friend'), false);

  const page1 = await requestJson(baseUrl, '/api/chat/thread?walletId=wallet-recent&pageSize=10&page=1', { cookie });
  assert.equal(page1.status, 200);
  assert.equal(Array.isArray(page1.json?.messages), true);
  assert.equal(page1.json.messages.length, 10);

  const blockRes = await requestJson(baseUrl, '/api/chat/block', {
    method: 'POST',
    cookie,
    body: { walletId: 'wallet-recent' },
  });
  assert.equal(blockRes.status, 200);
  assert.equal(blockRes.json?.blocked, true);

  const blockedThread = await requestJson(baseUrl, '/api/chat/thread?walletId=wallet-recent&pageSize=10&page=1', { cookie });
  assert.equal(blockedThread.status, 200);
  assert.equal(Array.isArray(blockedThread.json?.messages), true);
  assert.equal(blockedThread.json.messages.length, 0);

  const selfStateRes = await requestJson(baseUrl, '/api/chat/self-state', { cookie });
  assert.equal(selfStateRes.status, 200);
  assert.equal(selfStateRes.json?.selfState?.online, false);
});
