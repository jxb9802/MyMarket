const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PASSWORD = 'chat-test-password';
const PEER_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const SPOOF_MNEMONIC = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

function getFreePort() {
  const net = require('net');
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

test('chat API integration covers recent unconfirmed merge, unread/read flow, send preview, and deprecated routes', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-chat-test-'));
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
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';

  const wallet = require('../wallet');
  const serverMarket = require('../server_market');
  const { startServer } = serverMarket;

  const port = await getFreePort();
  const server = startServer({ port, host: '127.0.0.1' });
  await t.test('bootstrap', async () => {});
  t.after(async () => {
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    if (typeof server.unref === 'function') server.unref();
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      const timer = setTimeout(finish, 500);
      timer.unref?.();
      server.close(() => {
        clearTimeout(timer);
        finish();
      });
    });
    delete process.env.BSV_MARKET_DATA_DIR;
    delete process.env.BSV_MARKET_LOG_DIR;
    delete process.env.BSV_MARKET_ENABLE_CHAT;
    delete process.env.BSV_MARKET_DISABLE_BHS;
    delete process.env.BSV_MARKET_DISABLE_STEWARD_WORKER;
    delete process.env.BSV_MARKET_DISABLE_CHAT_STEWARD;
    delete process.env.BSV_MARKET_DISABLE_SPV_LISTENER;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    setImmediate(() => process.exit(0));
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  const createRes = await requestJson(baseUrl, '/api/wallet/create', {
    method: 'POST',
    body: { password: PASSWORD },
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.json?.success, true);
  const cookie = parseSetCookie(createRes.headers);
  assert.ok(cookie.includes('connect.sid='));

  const identityRes = await requestJson(baseUrl, '/api/chat/identity', { cookie });
  assert.equal(identityRes.status, 200);
  assert.equal(identityRes.json?.success, true);
  const selfWalletId = String(identityRes.json?.identity?.walletId || '');
  const selfPubKey = String(identityRes.json?.identity?.chatPubKey || '');
  assert.ok(selfWalletId);
  assert.ok(/^[0-9a-f]{66}$/i.test(selfPubKey));

  const profileSaveRes = await requestJson(baseUrl, '/api/profile', {
    method: 'POST',
    cookie,
    body: { name: 'Chat Test Wallet' },
  });
  assert.equal(profileSaveRes.status, 200);
  assert.equal(profileSaveRes.json?.success, true);

  const publishRes = await requestJson(baseUrl, '/api/chat/profile/publish', {
    method: 'POST',
    cookie,
    body: { confirmFee: true },
  });
  assert.equal(publishRes.status, 200);
  assert.equal(publishRes.json?.success, true);
  assert.equal(publishRes.json?.queued, true);
  assert.ok(String(publishRes.json?.changeId || '').startsWith('chg-'));

  const stateAfterPublish = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.ok(Array.isArray(stateAfterPublish?.recentRawtxs));
  assert.equal(stateAfterPublish?.localChanges, null);
  const reloadedAfterPublish = serverMarket.loadLegacyStateSnapshot();
  const queuedBind = (reloadedAfterPublish?.localChanges?.queue || []).find((item) => String(item?.eventType || '') === 'wallet_key_bind');
  assert.ok(queuedBind);
  assert.equal(String(queuedBind?.status || ''), 'pending');
  assert.equal(String(queuedBind?.payload?.walletId || ''), selfWalletId);
  assert.equal(String(queuedBind?.payload?.chatPubKey || ''), selfPubKey);
  assert.equal(
    wallet.verifyWalletKeyBind({
      walletId: String(queuedBind?.payload?.walletId || ''),
      merchantId: String(queuedBind?.payload?.merchantId || ''),
      chatPubKey: String(queuedBind?.payload?.chatPubKey || ''),
      endpointHints: Array.isArray(queuedBind?.payload?.endpointHints) ? queuedBind.payload.endpointHints : [],
      relayHints: Array.isArray(queuedBind?.payload?.relayHints) ? queuedBind.payload.relayHints : [],
      createdAt: String(queuedBind?.payload?.createdAt || queuedBind?.payload?._updatedAt || ''),
      signature: String(queuedBind?.payload?.signature || ''),
    }),
    true,
  );

  const peerPubKey = wallet.deriveChatPublicKeyFromMnemonic(PEER_MNEMONIC);
  const spoofPubKey = wallet.deriveChatPublicKeyFromMnemonic(SPOOF_MNEMONIC);
  const peerWalletIdLate = 'wallet-peerlate';
  const encrypted = wallet.encryptChatMessage({
    mnemonic: PEER_MNEMONIC,
    peerPublicKey: selfPubKey,
    text: 'hello-from-peer',
  });
  const fallbackEncrypted = wallet.encryptChatMessage({
    mnemonic: PEER_MNEMONIC,
    peerPublicKey: selfPubKey,
    text: 'hello-from-peer-fallback',
  });
  const msgId = 'onchain:test-chat-msg-1';
  const fallbackMsgId = 'onchain:test-chat-msg-fallback';
  const peerWalletId = 'wallet-peeralpha';
  const sessionId = 'chat-wallet-peeralpha-session-1';
  const ts = new Date().toISOString();
  const earlierTs = new Date(Date.now() - 60 * 1000).toISOString();
  const laterTs = new Date(Date.now() - 10 * 1000).toISOString();
  const signature = wallet.signChatEnvelope({
    mnemonic: PEER_MNEMONIC,
    peerPublicKey: selfPubKey,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    authTag: encrypted.authTag,
    msgId,
    sessionId,
    fromWalletId: peerWalletId,
    toWalletId: selfWalletId,
    ts,
    orderId: '',
  });
  const fallbackSignature = '0'.repeat(64);
  const bindSignatureEarlier = wallet.signWalletKeyBind({
    mnemonic: PEER_MNEMONIC,
    walletId: peerWalletId,
    merchantId: 'm-peeralpha',
    chatPubKey: peerPubKey,
    endpointHints: ['127.0.0.1:65535'],
    relayHints: [],
    createdAt: earlierTs,
  });
  const bindSignatureLater = wallet.signWalletKeyBind({
    mnemonic: PEER_MNEMONIC,
    walletId: peerWalletIdLate,
    merchantId: 'm-peerlate',
    chatPubKey: peerPubKey,
    endpointHints: ['127.0.0.1:65535'],
    relayHints: [],
    createdAt: laterTs,
  });
  const spoofBindSignature = wallet.signWalletKeyBind({
    mnemonic: SPOOF_MNEMONIC,
    walletId: 'wallet-spoof',
    merchantId: 'm-spoof',
    chatPubKey: spoofPubKey,
    endpointHints: ['127.0.0.1:65534'],
    relayHints: [],
    createdAt: ts,
  });
  const spoofEncrypted = wallet.encryptChatMessage({
    mnemonic: SPOOF_MNEMONIC,
    peerPublicKey: selfPubKey,
    text: 'spoof-should-not-appear',
  });
  const spoofSignature = wallet.signChatEnvelope({
    mnemonic: SPOOF_MNEMONIC,
    peerPublicKey: selfPubKey,
    ciphertext: spoofEncrypted.ciphertext,
    nonce: spoofEncrypted.nonce,
    authTag: spoofEncrypted.authTag,
    msgId: 'onchain:test-chat-msg-spoof',
    sessionId,
    fromWalletId: peerWalletId,
    toWalletId: selfWalletId,
    ts,
    orderId: '',
  });

  const globalAnchors = [
    {
      ts: laterTs,
      eventType: 'wallet_key_bind',
      payload: {
        walletId: peerWalletIdLate,
        merchantId: 'm-peerlate',
        chatPubKey: peerPubKey,
        endpointHints: ['127.0.0.1:65535'],
        relayHints: [],
        signature: bindSignatureLater,
        _v: 3,
        _updatedAt: laterTs,
      },
      txid: 'a'.repeat(64),
      node: 'test',
      confirmed: false,
      publicVisible: true,
    },
    {
      ts: earlierTs,
      eventType: 'wallet_key_bind',
      payload: {
        walletId: peerWalletId,
        merchantId: 'm-peeralpha',
        chatPubKey: peerPubKey,
        endpointHints: ['127.0.0.1:65535'],
        relayHints: [],
        signature: bindSignatureEarlier,
        _v: 3,
        _updatedAt: earlierTs,
      },
      txid: '0'.repeat(64),
      node: 'test',
      confirmed: false,
      publicVisible: true,
    },
    {
      ts,
      eventType: 'wallet_key_bind',
      payload: {
        walletId: 'wallet-spoof',
        merchantId: 'm-spoof',
        chatPubKey: spoofPubKey,
        endpointHints: ['127.0.0.1:65534'],
        relayHints: [],
        signature: spoofBindSignature,
        _v: 3,
        _updatedAt: ts,
      },
      txid: 'c'.repeat(64),
      node: 'test',
      confirmed: false,
      publicVisible: true,
    },
    {
      ts,
      eventType: 'chat_message',
      payload: {
        msgId,
        sessionId,
        fromWalletId: peerWalletId,
        toWalletId: selfWalletId,
        fromPubKey: peerPubKey,
        peerPubKey: selfPubKey,
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        authTag: encrypted.authTag,
        signature,
        orderId: '',
        _v: 3,
        _updatedAt: ts,
      },
      txid: 'b'.repeat(64),
      node: 'test',
      confirmed: false,
      publicVisible: true,
    },
    {
      ts,
      eventType: 'chat_message',
      payload: {
        msgId: fallbackMsgId,
        sessionId,
        fromWalletId: peerWalletId,
        toWalletId: selfWalletId,
        fromPubKey: peerPubKey,
        peerPubKey: selfPubKey,
        ciphertext: fallbackEncrypted.ciphertext,
        nonce: fallbackEncrypted.nonce,
        authTag: fallbackEncrypted.authTag,
        signature: fallbackSignature,
        orderId: '',
        _v: 3,
        _updatedAt: ts,
      },
      txid: 'e'.repeat(64),
      node: 'test',
      confirmed: false,
      publicVisible: true,
    },
    {
      ts,
      eventType: 'chat_message',
      payload: {
        msgId: 'onchain:test-chat-msg-spoof',
        sessionId,
        fromWalletId: peerWalletId,
        toWalletId: selfWalletId,
        fromPubKey: spoofPubKey,
        peerPubKey: selfPubKey,
        ciphertext: spoofEncrypted.ciphertext,
        nonce: spoofEncrypted.nonce,
        authTag: spoofEncrypted.authTag,
        signature: spoofSignature,
        orderId: '',
        _v: 3,
        _updatedAt: ts,
      },
      txid: 'd'.repeat(64),
      node: 'test',
      confirmed: false,
      publicVisible: true,
    },
  ];
  fs.writeFileSync(path.join(dataDir, 'anchors_global.json'), JSON.stringify(globalAnchors, null, 2));

  const threadsRes = await requestJson(baseUrl, '/api/chat/threads', { cookie });
  assert.equal(threadsRes.status, 200);
  assert.equal(threadsRes.json?.success, true);
  const peerThread = (threadsRes.json?.threads || []).find((x) => String(x?.walletId || '') === peerWalletId);
  assert.ok(peerThread);
  assert.equal(Number(threadsRes.json?.unreadTotal || 0), 2);
  const persistedState = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(persistedState?.chatIdentity?.pubkeyBindings || {}, {});
  const reloadedWithBindings = serverMarket.loadLegacyStateSnapshot();
  const persistedPeerBind = reloadedWithBindings?.chatIdentity?.pubkeyBindings?.[peerPubKey];
  assert.equal(String(persistedPeerBind?.walletId || ''), peerWalletId);

  const unreadRes = await requestJson(baseUrl, '/api/chat/unread', { cookie });
  assert.equal(unreadRes.status, 200);
  assert.equal(unreadRes.json?.success, true);
  assert.equal(Number(unreadRes.json?.byWalletId?.[peerWalletId] || 0), 2);

  const threadRes = await requestJson(baseUrl, `/api/chat/thread?walletId=${encodeURIComponent(peerWalletId)}`, { cookie });
  assert.equal(threadRes.status, 200);
  assert.equal(threadRes.json?.success, true);
  const messages = Array.isArray(threadRes.json?.messages) ? threadRes.json.messages : [];
  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, 'hello-from-peer');
  assert.equal(messages[1].text, 'hello-from-peer-fallback');
  assert.equal(messages[0].transport, 'onchain');
  assert.equal(messages[0].status, 'visible');
  assert.equal(messages[1].transport, 'onchain');
  assert.equal(messages[1].status, 'visible');

  const previewRes = await requestJson(baseUrl, '/api/chat/send-preview', {
    method: 'POST',
    cookie,
    body: { walletId: peerWalletId, text: 'preview-message' },
  });
  assert.equal(previewRes.status, 200);
  assert.equal(previewRes.json?.success, true);
  assert.equal(previewRes.json?.hasPeerPubKey, true);
  assert.equal(previewRes.json?.requiresFeeConfirm, true);

  const readRes = await requestJson(baseUrl, '/api/chat/thread/read', {
    method: 'POST',
    cookie,
    body: { walletId: peerWalletId },
  });
  assert.equal(readRes.status, 200);
  assert.equal(readRes.json?.success, true);

  const unreadAfterRead = await requestJson(baseUrl, '/api/chat/unread', { cookie });
  assert.equal(Number(unreadAfterRead.json?.unreadTotal || 0), 0);

});
