const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocket } = require('ws');

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

function waitForMessage(messages, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      const found = messages.find(predicate);
      if (found) {
        clearInterval(timer);
        resolve(found);
        return;
      }
      if ((Date.now() - start) >= timeoutMs) {
        clearInterval(timer);
        reject(new Error('timed out waiting for websocket message'));
      }
    }, 25);
    timer.unref?.();
  });
}

test('frontend bootstrap and websocket push are available and sync-active display shrinks when inactive', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-frontend-event-test-'));
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

  const serverMarket = require('../server_market');
  const { startServer, buildDisplayedActiveSyncNodeList } = serverMarket;

  assert.deepEqual(
    buildDisplayedActiveSyncNodeList(
      { active: false, activeNodes: ['162.19.222.167:8333'] },
      { nodes: [{ endpoint: '99.127.49.102:8333', roles: ['sync_active'] }] },
    ),
    [],
  );

  const port = await getFreePort();
  const server = startServer({ port, host: '127.0.0.1' });
  const closeServer = async () => {
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
  };

  t.after(async () => {
    await closeServer();
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
    body: { password: 'frontend-event-password' },
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.json?.success, true);
  const cookie = parseSetCookie(createRes.headers);
  assert.ok(cookie.includes('connect.sid='));

  const bootstrapRes = await requestJson(baseUrl, '/api/bootstrap', { cookie });
  assert.equal(bootstrapRes.status, 200);
  assert.equal(bootstrapRes.json?.success, true);
  assert.ok(bootstrapRes.json?.state?.sync);
  assert.ok(bootstrapRes.json?.views?.walletBalance);
  assert.ok(bootstrapRes.json?.views?.chatThreads);
  assert.ok(bootstrapRes.json?.domains?.catalog);
  assert.equal(typeof bootstrapRes.json?.state?.chatConfig, 'object');

  const wsMessages = [];
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, {
    headers: {
      Cookie: cookie,
    },
  });
  ws.on('message', (raw) => {
    try {
      wsMessages.push(JSON.parse(String(raw)));
    } catch (_) {}
  });
  await waitForMessage(wsMessages, (msg) => msg?.type === 'system.bootstrap');
  await waitForMessage(wsMessages, (msg) => msg?.type === 'sync.snapshot.updated');
  await waitForMessage(wsMessages, (msg) => msg?.type === 'wallet.snapshot.updated');
  await waitForMessage(wsMessages, (msg) => msg?.type === 'chat.snapshot.updated');

  const beforeProfileSeq = wsMessages.length;
  const profileRes = await requestJson(baseUrl, '/api/profile', {
    method: 'POST',
    cookie,
    body: { name: 'Frontend Event Test' },
  });
  assert.equal(profileRes.status, 200);
  assert.equal(profileRes.json?.success, true);
  const profileEvent = await waitForMessage(
    wsMessages,
    (msg) => msg?.type === 'profile.snapshot.updated' && String(msg?.payload?.profile?.name || '') === 'Frontend Event Test',
  );
  assert.equal(String(profileEvent?.payload?.profile?.name || ''), 'Frontend Event Test');

  ws.close();
});
