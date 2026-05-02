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
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const value = await predicate();
    if (value) return value;
    if ((Date.now() - startedAt) >= timeoutMs) {
      throw new Error('waitFor timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

test('saveState persists sync core fields into SQLite and strips them from state.json', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-sync-sqlite-'));
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
  await marketDb.ensureWriterService();

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const state = serverMarket.loadLegacyStateSnapshot();
  state.sync.localHeight = 938321;
  state.sync.fixedSyncLastHeight = 938320;
  state.sync.p2pTipHeight = 938400;
  state.sync.p2pTipHash = 'tip-hash-1';
  state.sync.p2pHeaderCursorHeight = 938322;
  state.sync.p2pHeaderCursorHash = 'cursor-hash-1';
  state.sync.sessionEpoch = 9;
  state.sync.retries = 3;
  state.sync.manualQuickstartPending = true;
  serverMarket.saveState(state);

  const syncRow = await waitFor(async () => {
    const row = await marketDb.getSyncState('main').catch(() => null);
    return row && Number(row.local_height || 0) === 938321 ? row : null;
  });

  assert.equal(syncRow.local_height, 938321);
  assert.equal(syncRow.fixed_sync_last_height, 938320);
  assert.equal(syncRow.p2p_tip_height, 938400);
  assert.equal(syncRow.session_epoch, 9);

  const rawState = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.equal(Object.prototype.hasOwnProperty.call(rawState.sync || {}, 'localHeight'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rawState.sync || {}, 'networkHeight'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rawState.sync || {}, 'fixedSyncLastHeight'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rawState.sync || {}, 'retries'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(rawState.sync || {}, 'manualQuickstartPending'), false);

  const reloaded = serverMarket.loadLegacyStateSnapshot();
  assert.equal(reloaded.sync.localHeight, 938321);
  assert.equal(reloaded.sync.fixedSyncLastHeight, 938320);
  assert.equal(reloaded.sync.p2pTipHeight, 938400);
  assert.equal(reloaded.sync.sessionEpoch, 9);
  assert.equal(reloaded.sync.retries, 3);
  assert.equal(reloaded.sync.manualQuickstartPending, true);
});
