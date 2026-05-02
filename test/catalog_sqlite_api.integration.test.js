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

async function requestJson(baseUrl, pathname) {
  const res = await fetch(`${baseUrl}${pathname}`, { headers: { connection: 'close' } });
  const text = await res.text();
  return {
    status: res.status,
    json: text ? JSON.parse(text) : null,
  };
}

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

test('/api/state serves catalog from SQLite snapshot without rebuilding from anchors on read', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-catalog-api-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
    BSV_MARKET_DISABLE_BHS: process.env.BSV_MARKET_DISABLE_BHS,
    BSV_MARKET_DISABLE_STEWARD_WORKER: process.env.BSV_MARKET_DISABLE_STEWARD_WORKER,
    BSV_MARKET_DISABLE_CATALOG_WORKER: process.env.BSV_MARKET_DISABLE_CATALOG_WORKER,
    BSV_MARKET_DISABLE_CHAT_STEWARD: process.env.BSV_MARKET_DISABLE_CHAT_STEWARD,
    BSV_MARKET_DISABLE_CHAT_SERVICE: process.env.BSV_MARKET_DISABLE_CHAT_SERVICE,
    BSV_MARKET_DISABLE_SPV_LISTENER: process.env.BSV_MARKET_DISABLE_SPV_LISTENER,
    BSV_MARKET_DISABLE_VIEW_STATE_WORKER: process.env.BSV_MARKET_DISABLE_VIEW_STATE_WORKER,
    BSV_MARKET_DISABLE_STARTUP_CHAIN_SYNC: process.env.BSV_MARKET_DISABLE_STARTUP_CHAIN_SYNC,
  };
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;
  process.env.BSV_MARKET_DISABLE_BHS = '1';
  process.env.BSV_MARKET_DISABLE_STEWARD_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_CATALOG_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_CHAT_STEWARD = '1';
  process.env.BSV_MARKET_DISABLE_CHAT_SERVICE = '1';
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';
  process.env.BSV_MARKET_DISABLE_VIEW_STATE_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_STARTUP_CHAIN_SYNC = '1';

  const marketDb = loadFresh('../market_db');
  const serverMarket = loadFresh('../server_market');
  await marketDb.ensureWriterService();

  const port = await getFreePort();
  const server = await serverMarket.startServer({ port, host: '127.0.0.1' });
  const baseUrl = `http://127.0.0.1:${port}`;

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
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.replaceCatalogSnapshot({
    categories: [
      {
        id: 'cat-sqlite',
        merchantId: 'm-sqlite',
        name: 'SQLite Cat',
        ownedByCurrentWallet: true,
        localStatus: 'synced',
        localUpdatedAt: '2026-03-31T00:00:00.000Z',
      },
    ],
    products: [
      {
        id: 'prod-sqlite',
        merchantId: 'm-sqlite',
        categoryId: 'cat-sqlite',
        title: 'SQLite Product',
        description: 'From sqlite',
        imageUrl: '',
        price: 999,
        stock: 8,
        soldCount: 1,
        deleted: false,
        ownedByCurrentWallet: true,
        localStatus: 'synced',
        localUpdatedAt: '2026-03-31T00:00:00.000Z',
      },
    ],
    resetAll: true,
  });

  const staleState = serverMarket.loadLegacyStateSnapshot();
  const staleJson = {
    ...staleState,
    categories: [{ id: 'cat-json', merchantId: 'm-json', name: 'JSON Cat' }],
    products: [{ id: 'prod-json', merchantId: 'm-json', title: 'JSON Product' }],
  };
  fs.writeFileSync(path.join(dataDir, 'state.json'), JSON.stringify(staleJson, null, 2));

  const reloaded = serverMarket.loadLegacyStateSnapshot();
  assert.equal(reloaded.categories[0].id, 'cat-sqlite');
  assert.equal(reloaded.products[0].id, 'prod-sqlite');

  const persistedJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(persistedJson.categories[0].id, 'cat-json');
  assert.equal(persistedJson.products[0].id, 'prod-json');

  serverMarket.saveState(reloaded);
  await new Promise((resolve) => setTimeout(resolve, 500));
  const strippedJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(strippedJson.categories, []);
  assert.deepEqual(strippedJson.products, []);

  const stateRes = await requestJson(baseUrl, '/api/bootstrap-lite?domains=catalog');
  assert.equal(stateRes.status, 200);
  assert.equal(stateRes.json.domains.catalog.categories[0].id, 'cat-sqlite');
  assert.equal(stateRes.json.domains.catalog.products[0].id, 'prod-sqlite');

  await marketDb.replaceCatalogSnapshot({
    categories: [],
    products: [],
    resetAll: true,
  });
  await marketDb.upsertAnchorEvents([
    {
      txid: 'a'.repeat(64),
      height: 938250,
      eventType: 'category_add',
      ts: '2026-04-09T00:00:00.000Z',
      confirmed: true,
      node: 'node-1',
      payload: {
        id: 'cat-anchor',
        merchantId: 'm-anchor',
        name: 'Anchor Category',
        version: 1,
      },
    },
    {
      txid: 'b'.repeat(64),
      height: 938251,
      eventType: 'product_add',
      ts: '2026-04-09T00:00:01.000Z',
      confirmed: true,
      node: 'node-1',
      payload: {
        id: 'prod-anchor',
        merchantId: 'm-anchor',
        categoryId: 'cat-anchor',
        title: 'Anchor Product',
        description: 'From anchors',
        imageUrl: '',
        price: 321,
        stock: 4,
        soldCount: 0,
        version: 1,
      },
    },
  ]);

  const anchorStateRes = await requestJson(baseUrl, '/api/bootstrap-lite?domains=catalog');
  assert.equal(anchorStateRes.status, 200);
  assert.deepEqual(anchorStateRes.json.domains.catalog.categories, []);
  assert.deepEqual(anchorStateRes.json.domains.catalog.products, []);
});
