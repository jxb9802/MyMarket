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
  return {
    status: res.status,
    headers: res.headers,
    json: text ? JSON.parse(text) : null,
  };
}

function parseSetCookie(headers) {
  return String(headers.get('set-cookie') || '').split(';')[0];
}

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

test('/api/state shows the updated profile name immediately after /api/profile saves', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-profile-api-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
    BSV_MARKET_DISABLE_BHS: process.env.BSV_MARKET_DISABLE_BHS,
    BSV_MARKET_DISABLE_STEWARD_WORKER: process.env.BSV_MARKET_DISABLE_STEWARD_WORKER,
    BSV_MARKET_DISABLE_CHAT_STEWARD: process.env.BSV_MARKET_DISABLE_CHAT_STEWARD,
    BSV_MARKET_DISABLE_SPV_LISTENER: process.env.BSV_MARKET_DISABLE_SPV_LISTENER,
  };
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;
  process.env.BSV_MARKET_DISABLE_BHS = '1';
  process.env.BSV_MARKET_DISABLE_STEWARD_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_CHAT_STEWARD = '1';
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';

  const serverMarket = loadFresh('../server_market');
  const port = await getFreePort();
  const server = serverMarket.startServer({ port, host: '127.0.0.1' });

  t.after(async () => {
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    if (typeof server.unref === 'function') server.unref();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      timer.unref?.();
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    setImmediate(() => process.exit(0));
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const createRes = await requestJson(baseUrl, '/api/wallet/create', {
    method: 'POST',
    body: { password: 'profile-api-password' },
  });
  assert.equal(createRes.status, 200);
  const cookie = parseSetCookie(createRes.headers);

  const saveRes = await requestJson(baseUrl, '/api/profile', {
    method: 'POST',
    cookie,
    body: { name: 'Immediate Profile Name' },
  });
  assert.equal(saveRes.status, 200);

  const stateRes = await requestJson(baseUrl, '/api/state', { cookie });
  assert.equal(stateRes.status, 200);
  assert.equal(String(stateRes.json?.state?.profile?.name || ''), 'Immediate Profile Name');
});

