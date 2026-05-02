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

function setupWalletIndex(t, { visible = false } = {}) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-stale-'));
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

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const address = '14GsPhLX89V3xak62RpcietMNL2zoDv53v';
  const pendingTxid = visible ? 'b'.repeat(64) : 'a'.repeat(64);
  const parentTxid = visible ? 'd'.repeat(64) : 'c'.repeat(64);
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
      [`${pendingTxid}:1`]: {
        txId: pendingTxid,
        vout: 1,
        address,
        satoshis: 9000,
        confirmed: false,
        ancestorDepth: 1,
        seenAt: oldSeenAt,
        updatedAt: oldSeenAt,
      },
    },
    ownedOutpoints: {
      [`${pendingTxid}:1`]: 9000,
    },
    spentOutpoints: {
      [`${parentTxid}:0`]: {
        spentBy: pendingTxid,
        spentAt: oldSeenAt,
        txId: parentTxid,
        vout: 0,
        address,
        satoshis: 10000,
        confirmed: true,
        ancestorDepth: 0,
        seenAt: oldSeenAt,
      },
    },
    txs: {
      [parentTxid]: {
        txid: parentTxid,
        receivedSat: 10000,
        spentSat: 0,
        netSat: 10000,
        confirmed: true,
        ancestorDepth: 0,
        firstSeenAt: oldSeenAt,
        lastSeenAt: oldSeenAt,
        applied: true,
      },
      [pendingTxid]: {
        txid: pendingTxid,
        receivedSat: 9000,
        spentSat: 10000,
        netSat: -1000,
        confirmed: false,
        ancestorDepth: 1,
        firstSeenAt: oldSeenAt,
        lastSeenAt: oldSeenAt,
        firstSeenHeight: 100,
        lastSeenHeight: 100,
        applied: true,
      },
    },
    updatedAt: oldSeenAt,
  }, null, 2));

  return { dataDir, pendingTxid, parentTxid };
}

test('SPV stale pending reconcile releases occupied UTXO after one block when tx is not visible', async (t) => {
  const { dataDir, pendingTxid, parentTxid } = setupWalletIndex(t);
  const wallet = loadFresh('../wallet');

  const result = await wallet.reconcileStalePendingWalletTxs({
    source: 'test_stale_pending',
    localHeight: 101,
    minBlocks: 1,
    visibilityProbe: async () => ({ checked: 3, txids: [] }),
  });

  assert.equal(result.prunedTxCount, 1);
  assert.equal(result.prunedUtxoCount, 1);
  assert.equal(result.restoredSpentOutpointCount, 1);
  assert.equal(result.restoredUtxoCount, 1);
  assert.deepEqual(result.staleTxids, [pendingTxid]);

  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(index.txs[pendingTxid], undefined);
  assert.equal(index.utxos[`${pendingTxid}:1`], undefined);
  assert.equal(index.spentOutpoints[`${parentTxid}:0`], undefined);
  assert.equal(index.utxos[`${parentTxid}:0`].satoshis, 10000);
  assert.equal(index.utxos[`${parentTxid}:0`].confirmed, true);
  assert.equal(index.stalePendingTxs[pendingTxid].staleReason, 'spv_mempool_not_visible_after_block');
});

test('SPV stale pending reconcile keeps pending tx when a node still sees it', async (t) => {
  const { dataDir, pendingTxid, parentTxid } = setupWalletIndex(t, { visible: true });
  const wallet = loadFresh('../wallet');

  const result = await wallet.reconcileStalePendingWalletTxs({
    source: 'test_stale_pending_visible',
    localHeight: 101,
    minBlocks: 1,
    visibilityProbe: async () => ({ checked: 3, txids: [pendingTxid] }),
  });

  assert.equal(result.prunedTxCount || 0, 0);
  assert.deepEqual(result.staleTxids, []);

  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.ok(index.txs[pendingTxid]);
  assert.ok(index.utxos[`${pendingTxid}:1`]);
  assert.equal(index.spentOutpoints[`${parentTxid}:0`].spentBy, pendingTxid);
  assert.equal(index.stalePendingTxs?.[pendingTxid], undefined);
});

test('SPV stale pending reconcile does not prune when too few nodes were checked', async (t) => {
  const { dataDir, pendingTxid, parentTxid } = setupWalletIndex(t);
  const wallet = loadFresh('../wallet');

  const result = await wallet.reconcileStalePendingWalletTxs({
    source: 'test_stale_pending_no_nodes',
    localHeight: 101,
    minBlocks: 1,
    minProbeNodes: 2,
    visibilityProbe: async () => ({ checked: 0, txids: [] }),
  });

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'insufficient_spv_visibility_checks');

  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.ok(index.txs[pendingTxid]);
  assert.ok(index.utxos[`${pendingTxid}:1`]);
  assert.equal(index.spentOutpoints[`${parentTxid}:0`].spentBy, pendingTxid);
});

test('wallet display summary excludes residual stale pending change from available balance', async (t) => {
  const { pendingTxid } = setupWalletIndex(t);
  const wallet = loadFresh('../wallet');
  const indexPath = path.join(process.env.BSV_MARKET_DATA_DIR, 'spv_index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.stalePendingTxs = index.stalePendingTxs || {};
  index.stalePendingTxs[pendingTxid] = {
    txid: pendingTxid,
    staleReason: 'test_residue',
    staleAt: new Date().toISOString(),
  };
  delete index.txs[pendingTxid];
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  const summary = wallet._test.buildWalletDisplayUtxoSummary();
  assert.equal(summary.selfChangePending, 0);
  assert.equal(summary.available, 0);
  assert.equal(summary.total, 0);
});

test('wallet spendable selection excludes residual stale pending change', async (t) => {
  const { pendingTxid } = setupWalletIndex(t);
  const wallet = loadFresh('../wallet');
  const indexPath = path.join(process.env.BSV_MARKET_DATA_DIR, 'spv_index.json');
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
  index.stalePendingTxs = index.stalePendingTxs || {};
  index.stalePendingTxs[pendingTxid] = {
    txid: pendingTxid,
    staleReason: 'test_spendable_residue',
    staleAt: new Date().toISOString(),
  };
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));

  const state = JSON.parse(fs.readFileSync(path.join(process.env.BSV_MARKET_DATA_DIR, 'wallet_state.json'), 'utf8'));
  const spendable = wallet._test.listSpendableUtxosForState(state, {
    deriveChild() {
      throw new Error('stale UTXO should be filtered before key derivation');
    },
  }, {
    includeUnconfirmed: true,
    index,
  });

  assert.deepEqual(spendable, []);
});

test('reverting the same stale pending tx twice is idempotent', async (t) => {
  const { pendingTxid, parentTxid } = setupWalletIndex(t);
  const wallet = loadFresh('../wallet');
  const address = '14GsPhLX89V3xak62RpcietMNL2zoDv53v';
  const oldSeenAt = '2026-01-01T00:00:00.000Z';
  const index = {
    version: 1,
    utxos: {
      [`${pendingTxid}:1`]: {
        txId: pendingTxid,
        vout: 1,
        address,
        satoshis: 9000,
        confirmed: false,
        ancestorDepth: 1,
        seenAt: oldSeenAt,
        updatedAt: oldSeenAt,
      },
    },
    ownedOutpoints: {
      [`${pendingTxid}:1`]: 9000,
    },
    spentOutpoints: {
      [`${parentTxid}:0`]: {
        spentBy: pendingTxid,
        spentAt: oldSeenAt,
        txId: parentTxid,
        vout: 0,
        address,
        satoshis: 10000,
        confirmed: true,
        ancestorDepth: 0,
        seenAt: oldSeenAt,
      },
    },
    txs: {
      [pendingTxid]: {
        txid: pendingTxid,
        receivedSat: 9000,
        spentSat: 10000,
        netSat: -1000,
        confirmed: false,
        ancestorDepth: 1,
        firstSeenAt: oldSeenAt,
        lastSeenAt: oldSeenAt,
        applied: true,
      },
    },
    stalePendingTxs: {},
  };

  const first = wallet._test.revertPendingTxInSpvIndex(index, pendingTxid, { reason: 'test_idempotent' });
  const afterFirst = JSON.parse(JSON.stringify(index));
  const second = wallet._test.revertPendingTxInSpvIndex(index, pendingTxid, { reason: 'test_idempotent' });

  assert.equal(first.prunedTxCount, 1);
  assert.equal(first.prunedUtxoCount, 1);
  assert.equal(first.restoredSpentOutpointCount, 1);
  assert.equal(first.restoredUtxoCount, 1);
  assert.equal(second.prunedTxCount, 0);
  assert.equal(second.prunedUtxoCount, 0);
  assert.equal(second.restoredSpentOutpointCount, 0);
  assert.equal(second.restoredUtxoCount, 0);
  assert.deepEqual(index, afterFirst);
});
