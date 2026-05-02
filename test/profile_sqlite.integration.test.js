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

test('saveState persists profile into SQLite and strips it from state.json', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-profile-sqlite-'));
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
    setImmediate(() => process.exit(0));
  });

  const state = serverMarket.loadLegacyStateSnapshot();
  state.currentMerchantId = 'm-local';
  state.profile.name = 'SQLite Profile';
  state.profile.localStatus = 'modified';
  state.profile.localUpdatedAt = '2026-03-31T00:00:00.000Z';
  serverMarket.saveState(state);

  await new Promise((resolve) => setTimeout(resolve, 300));
  const row = await marketDb.getProfileSnapshot('self');
  assert.equal(row.name, 'SQLite Profile');

  const persistedJson = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'));
  assert.deepEqual(persistedJson.profile, {});

  const reloaded = serverMarket.loadLegacyStateSnapshot();
  assert.equal(reloaded.profile.name, 'SQLite Profile');
  assert.equal(reloaded.profile.localStatus, 'modified');
});
