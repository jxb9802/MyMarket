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

async function waitFor(predicate, { timeoutMs = 3000, intervalMs = 50 } = {}) {
  const startedAt = Date.now();
  while (true) {
    const value = await predicate();
    if (value) return value;
    if ((Date.now() - startedAt) >= timeoutMs) throw new Error('waitFor timeout');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test('saveState persists local state overlays into projection and strips them from state.json', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-local-state-'));
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

  const marketDb = loadFresh('../market_db');
  const serverMarket = loadFresh('../server_market');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const state = serverMarket.loadLegacyStateSnapshot();
  state.localChanges = {
    seq: 4,
    queue: [{
      id: 'chg-1',
      seq: 3,
      eventType: 'profile_set',
      payload: { name: 'Alice' },
      targetType: 'profile',
      targetId: 'buyer',
      status: 'pending',
      txid: '',
      ts: new Date().toISOString(),
    }],
  };
  state.recentRawtxs = [{
    txid: 'a'.repeat(64),
    ts: new Date().toISOString(),
    eventType: 'manual_anchor',
    note: 'manual',
    rawtx: '010203',
  }];
  state.pendingAnchors = [{
    txid: 'b'.repeat(64),
    ts: new Date().toISOString(),
    eventType: 'manual',
    payload: { hello: 'world' },
    node: 'node-1',
    confirmed: false,
    height: 0,
  }];
  serverMarket.saveState(state);

  const projection = await waitFor(async () => {
    const row = await marketDb.getLocalStateProjection('main').catch(() => null);
    return row && row.seq === 4 ? row : null;
  });

  assert.equal(projection.seq, 4);
  assert.equal(projection.localChanges.length, 1);
  assert.equal(projection.recentRawtxs.length, 1);
  assert.equal(projection.pendingAnchors.length, 1);

  const rawState = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(rawState.pendingAnchors, []);
  assert.deepEqual(rawState.recentRawtxs, []);
  assert.equal(rawState.localChanges, null);

  const reloaded = serverMarket.loadLegacyStateSnapshot();
  assert.equal(reloaded.localChanges.seq, 4);
  assert.equal(reloaded.localChanges.queue.length, 1);
  assert.equal(reloaded.recentRawtxs.length, 1);
  assert.equal(reloaded.pendingAnchors.length, 1);
});
