const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

test('wallet sync asyncProgress returns queued command instead of blocking on worker completion', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-sync-async-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;
  process.env.BSV_MARKET_DISABLE_BHS = '1';
  process.env.BSV_MARKET_DISABLE_STEWARD_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_CHAT_STEWARD = '1';
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';

  const serverMarket = require('../server_market');
  const { startServer } = serverMarket;
  const port = await getFreePort();
  const server = startServer({ port, host: '127.0.0.1' });

  t.after(async () => {
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    delete process.env.BSV_MARKET_DATA_DIR;
    delete process.env.BSV_MARKET_LOG_DIR;
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
    body: { password: 'wallet-sync-async-password' },
  });
  assert.equal(createRes.status, 200);
  assert.equal(createRes.json?.success, true);
  const cookie = parseSetCookie(createRes.headers);
  assert.ok(cookie.includes('connect.sid='));

  const syncRes = await requestJson(baseUrl, '/api/wallet/sync?forceBootstrap=1&clearLocalFirst=1', {
    method: 'POST',
    cookie,
    body: {
      source: 'wallet_sync_async_test',
      forceBootstrap: true,
      clearLocalFirst: true,
      asyncProgress: true,
    },
  });
  assert.equal(syncRes.status, 200);
  assert.equal(syncRes.json?.success, true);
  assert.equal(syncRes.json?.queued, true);
  assert.equal(syncRes.json?.inProgress, true);
  assert.match(String(syncRes.json?.commandId || ''), /^cmd-\d+$/);
  assert.equal(String(syncRes.json?.command?.status || ''), 'pending');

  const statusRes = await requestJson(baseUrl, `/api/command-status/${encodeURIComponent(syncRes.json.commandId)}`, {
    cookie,
  });
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.json?.success, true);
  assert.equal(String(statusRes.json?.command?.status || ''), 'pending');
});
