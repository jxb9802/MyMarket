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

test('ensureDataVersion upgrades legacy data dir to version 1 with backup', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-migrate-'));
  const dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'state.json'), '{"legacy":true}\n', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'tx_contexts.json'), '{"old":true}\n', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'anchors_global.json'), '[]\n', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'keystore.json'), '{"keep":true}\n', 'utf8');
  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), '{"keep":true}\n', 'utf8');

  const prevDataDir = process.env.BSV_MARKET_DATA_DIR;
  process.env.BSV_MARKET_DATA_DIR = dataDir;

  t.after(() => {
    if (prevDataDir === undefined) delete process.env.BSV_MARKET_DATA_DIR;
    else process.env.BSV_MARKET_DATA_DIR = prevDataDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const migration = loadFresh('../data_migration');
  const version = loadFresh('../data_version');

  const result = migration.ensureDataVersion(dataDir);
  assert.equal(result.currentVersion, 1);
  assert.equal(result.migrated, true);
  assert.equal(path.basename(result.steps[0].backupDir).includes('_v0_to_v1'), true);

  assert.equal(fs.existsSync(path.join(dataDir, 'state.json')), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'tx_contexts.json')), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'anchors_global.json')), false);
  assert.equal(fs.existsSync(path.join(dataDir, 'keystore.json')), true);
  assert.equal(fs.existsSync(path.join(dataDir, 'wallet_state.json')), true);

  const runtime = version.readRuntimeVersion(dataDir);
  assert.equal(runtime.app_data_version, 1);
  assert.equal(runtime.migration_status, 'ready');

  const meta = version.readMetaVersion(dataDir);
  assert.equal(meta.app_data_version, 1);
  assert.equal(meta.migration_status, 'ready');

  const backupRoot = path.join(dataDir, 'migration_backups');
  const backups = fs.readdirSync(backupRoot);
  assert.equal(backups.length, 1);
  const backupDir = path.join(backupRoot, backups[0]);
  assert.equal(fs.existsSync(path.join(backupDir, 'state.json')), true);
  assert.equal(fs.existsSync(path.join(backupDir, 'tx_contexts.json')), true);
  assert.equal(fs.existsSync(path.join(backupDir, 'anchors_global.json')), true);
});

test('ensureDataVersion treats an existing SQLite V1 directory as already upgraded', (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-migrate-v1-'));
  const dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const prevDataDir = process.env.BSV_MARKET_DATA_DIR;
  process.env.BSV_MARKET_DATA_DIR = dataDir;

  t.after(() => {
    if (prevDataDir === undefined) delete process.env.BSV_MARKET_DATA_DIR;
    else process.env.BSV_MARKET_DATA_DIR = prevDataDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const version = loadFresh('../data_version');
  const db = new (require('node:sqlite').DatabaseSync)(path.join(dataDir, 'market.db'));
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (scope TEXT PRIMARY KEY, local_height INTEGER);
    CREATE TABLE IF NOT EXISTS anchor_events (event_id INTEGER PRIMARY KEY AUTOINCREMENT, dedupe_key TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_anchor_events_dedupe ON anchor_events(dedupe_key);
    CREATE TABLE IF NOT EXISTS profiles (profile_key TEXT PRIMARY KEY, payload_json TEXT);
    CREATE TABLE IF NOT EXISTS tx_contexts (txid TEXT PRIMARY KEY, rawtx_hex TEXT);
    CREATE TABLE IF NOT EXISTS chat_threads (thread_id TEXT PRIMARY KEY, payload_json TEXT);
    CREATE TABLE IF NOT EXISTS chat_messages (msg_id TEXT PRIMARY KEY, payload_json TEXT);
  `);
  db.close();

  const migration = loadFresh('../data_migration');
  const result = migration.ensureDataVersion(dataDir);
  assert.equal(result.currentVersion, 1);
  assert.equal(result.migrated, false);
  assert.equal(Array.isArray(result.steps), true);
  assert.equal(result.steps.length, 0);

  const info = version.getCurrentDataVersionInfo(dataDir);
  assert.equal(info.version, 1);
  assert.equal(info.source, 'implicit_v1');
  assert.equal(fs.existsSync(path.join(dataDir, 'migration_backups')), false);
});
