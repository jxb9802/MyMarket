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

test('BHS runtime and projection stay consistent', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-event-bus-bhs-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
  };

  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;

  const marketDb = loadFresh('../market_db');
  const bhsDomain = loadFresh('../bhs_domain');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();

  await bhsDomain.emitBhsStatusSnapshot({
    scope: 'main',
    ok: true,
    checkpointHeight: 938249,
    checkpointHash: 'a'.repeat(64),
    tipHeight: 943250,
    tipHash: 'b'.repeat(64),
    headerCount: 5001,
    headers: {
      '938249': { height: 938249, hash: 'a'.repeat(64), prevHash: ''.padEnd(64, '0') },
      '938250': { height: 938250, hash: 'c'.repeat(64), prevHash: 'a'.repeat(64) },
    },
    lastRound: { bestNode: 'node-1', rows: 12 },
  }, {
    producer: 'bhs_test',
    dedupeKey: 'bhs-test:main',
  });

  const status = await bhsDomain.getBhsStatus('main');
  assert.equal(status.ok, true);
  assert.equal(status.tipHeight, 943250);
  assert.equal(status.checkpointHeight, 938249);
  assert.equal(status.lastRound.bestNode, 'node-1');
  assert.equal(status.headers['938250']?.hash, 'c'.repeat(64));

  const statusSync = bhsDomain.getBhsStatusSync('main');
  assert.equal(statusSync.tipHeight, 943250);

  const reloadedBhsDomain = loadFresh('../bhs_domain');
  const reloadedStatus = await reloadedBhsDomain.getBhsStatus('main');
  assert.equal(reloadedStatus.tipHeight, 943250);
});
