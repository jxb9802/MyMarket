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

test('wallet tx reservation runtime and projection stay consistent', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-event-bus-wallet-tx-'));
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
  const walletTxDomain = loadFresh('../wallet_tx_domain');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();

  await walletTxDomain.reserveOutpoints('chg-1', 'local_change', [
    'aaa:0',
    'bbb:1',
  ], {
    ownerId: 'product-1',
    txid: 'tx-1',
    producer: 'wallet_tx_test',
    dedupeKey: 'wallet-tx-test:chg-1',
  });

  let reservedSync = walletTxDomain.listReservedOutpointsSync();
  assert.deepEqual(reservedSync, ['aaa:0', 'bbb:1']);

  let reserved = await walletTxDomain.listReservedOutpoints();
  assert.deepEqual(reserved, ['aaa:0', 'bbb:1']);

  await walletTxDomain.releaseReservation('chg-1', {
    reason: 'test_release',
    producer: 'wallet_tx_test',
    dedupeKey: 'wallet-tx-test:chg-1:release',
  });

  reservedSync = walletTxDomain.listReservedOutpointsSync();
  assert.deepEqual(reservedSync, []);

  reserved = await walletTxDomain.listReservedOutpoints();
  assert.deepEqual(reserved, []);

  await walletTxDomain.reserveOutpoints('chg-2', 'local_change', [
    'ccc:0',
  ], {
    ownerId: 'product-2',
    txid: 'tx-2',
    producer: 'wallet_tx_test',
    dedupeKey: 'wallet-tx-test:chg-2',
  });

  reservedSync = walletTxDomain.listReservedOutpointsSync();
  assert.deepEqual(reservedSync, ['ccc:0']);

  await walletTxDomain.resetWalletTxProjection();

  reservedSync = walletTxDomain.listReservedOutpointsSync();
  assert.deepEqual(reservedSync, []);

  reserved = await walletTxDomain.listReservedOutpoints();
  assert.deepEqual(reserved, []);

  const db = marketDb.openReadDb();
  try {
    const projectionRows = db.prepare(`
      SELECT outpoint
      FROM wallet_outpoint_reservation_projection
      WHERE status = 'active'
      ORDER BY updated_at ASC, outpoint ASC
    `).all();
    assert.deepEqual(projectionRows, []);
  } finally {
    db.close();
  }

  await walletTxDomain.reserveOutpoints('chg-3', 'local_change', [
    'ddd:1',
  ], {
    ownerId: 'product-3',
    txid: 'tx-3',
    producer: 'wallet_tx_test',
    dedupeKey: 'wallet-tx-test:chg-3',
  });

  const reloaded = loadFresh('../wallet_tx_domain');
  const summary = await reloaded.rehydrateWalletTxRuntimeFromProjection();
  assert.equal(summary.reservationCount, 1);
  assert.equal(summary.outpointCount, 1);
  assert.deepEqual(reloaded.listReservedOutpointsSync(), ['ddd:1']);
});
