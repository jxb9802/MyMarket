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

test('wallet read snapshots update runtime cache and durable projections', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-event-bus-wallet-read-'));
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
  const walletReadDomain = loadFresh('../wallet_read_domain');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();

  await walletReadDomain.emitWalletIndexSnapshot({
    walletKey: 'wallet-1',
    walletScanCursorHeight: 100,
    walletRelevantTxCount: 3,
    walletUtxoCount: 2,
    contextReadyCount: 2,
    beefReadyUtxoCount: 2,
    sendPreflightStatus: 'ready',
    syncProgressActive: false,
    syncProgressStage: 'done',
    syncProgressMessage: 'wallet refreshed',
    syncProgressError: '',
    lastIndexedAt: '2026-04-04T10:00:00.000Z',
    recentRawtxCount: 1,
    recentRawtxLatestTxid: 'a'.repeat(64),
    recentRawtxLatestTs: '2026-04-04T09:59:00.000Z',
    source: 'wallet_read_test',
  }, {
    producer: 'wallet_read_test',
    dedupeKey: 'wallet-read-test:index',
  });

  await walletReadDomain.emitWalletReadModelSnapshot({
    walletKey: 'wallet-1',
    receiveAddress: 'wallet-1',
    confirmed: 1250,
    unconfirmed: 50,
    pendingDelta: 50,
    incomeSat: 2000,
    expenseSat: 700,
    total: 1300,
    totalBsv: 0.000013,
    balanceUpdatedAt: '2026-04-04T10:00:02.000Z',
    source: 'wallet_read_test',
    historyItems: [
      {
        txid: 'tx-2',
        note: 'second',
        notedAt: '2026-04-04T10:00:02.000Z',
        confirmed: false,
        netSat: -300,
        lastSeenAt: '2026-04-04T10:00:02.000Z',
      },
      {
        txid: 'tx-1',
        note: 'first',
        notedAt: '2026-04-04T10:00:01.000Z',
        confirmed: true,
        netSat: 1600,
        lastSeenAt: '2026-04-04T10:00:01.000Z',
      },
    ],
  }, {
    producer: 'wallet_read_test',
    dedupeKey: 'wallet-read-test:read-model',
  });
  await walletReadDomain.flushWalletReadProjection('wallet-1');

  const projectedIndex = await marketDb.getWalletIndexStatusProjection('wallet-1');
  assert.equal(projectedIndex.walletScanCursorHeight, 100);
  assert.equal(projectedIndex.sendPreflightStatus, 'ready');

  const projectedReadModel = await marketDb.getWalletReadModelProjection('wallet-1');
  assert.equal(projectedReadModel.receiveAddress, 'wallet-1');
  assert.equal(projectedReadModel.total, 1300);

  const projectedHistory = await marketDb.listWalletHistoryProjection('wallet-1');
  assert.equal(projectedHistory.length, 2);
  assert.equal(projectedHistory[0].txid, 'tx-2');
  assert.equal(projectedHistory[1].txid, 'tx-1');

  const indexStatus = await walletReadDomain.getWalletIndexStatus('wallet-1');
  assert.equal(indexStatus.walletScanCursorHeight, 100);
  assert.equal(indexStatus.sendPreflightStatus, 'ready');
  assert.equal(indexStatus.syncProgressStage, 'done');

  const readModel = await walletReadDomain.getWalletReadModel('wallet-1');
  assert.equal(readModel.receiveAddress, 'wallet-1');
  assert.equal(readModel.total, 1300);

  const history = await walletReadDomain.getWalletHistory('wallet-1', 1, 10);
  assert.equal(history.total, 2);
  assert.equal(history.items[0].txid, 'tx-2');
  assert.equal(history.items[1].txid, 'tx-1');
});
