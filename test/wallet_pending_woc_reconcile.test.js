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

test('manual WOC pending reconcile quarantines stale local-only pending txs', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-pending-'));
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

  const axios = require('axios');
  const originalGet = axios.get;
  axios.get = async () => ({ data: { result: [] } });

  t.after(() => {
    axios.get = originalGet;
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const wallet = loadFresh('../wallet');
  const address = '14GsPhLX89V3xak62RpcietMNL2zoDv53v';
  const staleTxid = 'e'.repeat(64);
  const parentTxid = 'd'.repeat(64);
  const oldSeenAt = '2026-01-01T00:00:00.000Z';
  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: new Date().toISOString(),
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {
      [`${staleTxid}:1`]: {
        txId: staleTxid,
        vout: 1,
        address,
        satoshis: 5000,
        confirmed: false,
        ancestorDepth: 1,
        seenAt: oldSeenAt,
        updatedAt: oldSeenAt,
      },
    },
    ownedOutpoints: {
      [`${staleTxid}:1`]: 5000,
    },
    spentOutpoints: {
      [`${parentTxid}:0`]: {
        spentBy: staleTxid,
        spentAt: oldSeenAt,
      },
    },
    txs: {
      [staleTxid]: {
        txid: staleTxid,
        receivedSat: 5000,
        spentSat: 10000,
        netSat: -5000,
        confirmed: false,
        ancestorDepth: 1,
        firstSeenAt: oldSeenAt,
        lastSeenAt: oldSeenAt,
        applied: true,
      },
    },
    updatedAt: oldSeenAt,
  }, null, 2));

  const result = await wallet.reconcilePendingWalletIndexWithWoc({
    addresses: [{ address, index: 0 }],
  }, {
    allowDisabled: true,
    pruneLocalOnly: true,
    keepRecentMs: 0,
  });

  assert.equal(result.localOnlyPendingTxCount, 1);
  assert.equal(result.prunedTxCount, 1);
  assert.equal(result.prunedUtxoCount, 1);
  assert.equal(result.restoredSpentOutpointCount, 1);

  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(index.txs[staleTxid], undefined);
  assert.equal(index.utxos[`${staleTxid}:1`], undefined);
  assert.equal(index.ownedOutpoints[`${staleTxid}:1`], undefined);
  assert.equal(index.spentOutpoints[`${parentTxid}:0`], undefined);
  assert.equal(index.stalePendingTxs[staleTxid].staleReason, 'manual_woc_pending_reconcile');
});

test('manual WOC pending reconcile prunes expired protected local-only txs', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-protected-pending-'));
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

  const axios = require('axios');
  const originalGet = axios.get;
  axios.get = async () => ({ data: { result: [] } });

  t.after(() => {
    axios.get = originalGet;
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const wallet = loadFresh('../wallet');
  const address = '14GsPhLX89V3xak62RpcietMNL2zoDv53v';
  const staleTxid = 'f'.repeat(64);
  const oldSeenAt = '2026-01-01T00:00:00.000Z';
  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: new Date().toISOString(),
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {
      [`${staleTxid}:1`]: {
        txId: staleTxid,
        vout: 1,
        address,
        satoshis: 982780,
        confirmed: false,
        ancestorDepth: 1,
        seenAt: oldSeenAt,
        updatedAt: oldSeenAt,
      },
    },
    ownedOutpoints: {
      [`${staleTxid}:1`]: 982780,
    },
    spentOutpoints: {},
    txs: {
      [staleTxid]: {
        txid: staleTxid,
        receivedSat: 982780,
        spentSat: 985106,
        netSat: -2326,
        confirmed: false,
        ancestorDepth: 1,
        firstSeenAt: oldSeenAt,
        lastSeenAt: oldSeenAt,
        applied: true,
      },
    },
    updatedAt: oldSeenAt,
  }, null, 2));

  const result = await wallet.reconcilePendingWalletIndexWithWoc({
    addresses: [{ address, index: 0 }],
  }, {
    allowDisabled: true,
    pruneLocalOnly: true,
    protectedTxids: [staleTxid],
    keepRecentMs: 10 * 60 * 1000,
    protectedKeepRecentMs: 10 * 60 * 1000,
  });

  assert.equal(result.expiredProtectedLocalTxs, 1);
  assert.equal(result.localOnlyPendingTxCount, 1);
  assert.equal(result.prunedTxCount, 1);
  assert.equal(result.prunedUtxoCount, 1);

  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(index.txs[staleTxid], undefined);
  assert.equal(index.utxos[`${staleTxid}:1`], undefined);
  assert.equal(index.stalePendingTxs[staleTxid].staleReason, 'manual_woc_pending_reconcile');
});
