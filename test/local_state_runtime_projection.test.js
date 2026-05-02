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

test('local state runtime and projection stay consistent', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-local-state-runtime-'));
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
  const localStateDomain = loadFresh('../local_state_domain');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();

  await localStateDomain.emitLocalStateSnapshot({
    scope: 'main',
    seq: 2,
    localChanges: [{
      id: 'chg-1',
      seq: 1,
      eventType: 'product_edit',
      payload: { title: 'updated' },
      targetType: 'product',
      targetId: 'prod-1',
      status: 'pending',
      txid: '',
      ts: '2026-04-07T18:30:00.000Z',
    }],
    recentRawtxs: [{
      txid: 'aa'.repeat(32),
      ts: '2026-04-07T18:31:00.000Z',
      eventType: 'wallet.broadcast',
      note: 'test',
      rawtx: '01000000',
    }],
    pendingAnchors: [{
      txid: 'bb'.repeat(32),
      ts: '2026-04-07T18:32:00.000Z',
      eventType: 'catalog.product.updated',
      payload: { productId: 'prod-1' },
      node: 'node-1',
      confirmed: false,
      height: 0,
    }],
  }, {
    producer: 'local_state_test',
  });

  const runtimeSnapshot = localStateDomain.getLocalStateSync('main');
  assert.equal(runtimeSnapshot.localChanges.length, 1);
  assert.equal(runtimeSnapshot.recentRawtxs.length, 1);
  assert.equal(runtimeSnapshot.pendingAnchors.length, 1);

  const projected = await marketDb.getLocalStateProjection('main');
  assert.equal(projected.localChanges.length, 1);
  assert.equal(projected.recentRawtxs.length, 1);
  assert.equal(projected.pendingAnchors.length, 1);

  await localStateDomain.resetLocalState('main');
  const afterReset = localStateDomain.getLocalStateSync('main');
  assert.equal(afterReset.localChanges.length, 0);
  assert.equal(afterReset.recentRawtxs.length, 0);
  assert.equal(afterReset.pendingAnchors.length, 0);

  await localStateDomain.emitLocalStateSnapshot({
    scope: 'main',
    seq: 3,
    localChanges: [{
      id: 'chg-2',
      seq: 2,
      eventType: 'product_add',
      payload: { title: 'new' },
      targetType: 'product',
      targetId: 'prod-2',
      status: 'queued',
      txid: '',
      ts: '2026-04-07T18:33:00.000Z',
    }],
    recentRawtxs: [],
    pendingAnchors: [],
  }, {
    producer: 'local_state_test',
  });

  const reloadedLocalStateDomain = loadFresh('../local_state_domain');
  const rehydrated = await reloadedLocalStateDomain.rehydrateLocalStateRuntimeFromProjection('main');
  assert.equal(rehydrated.localChanges.length, 1);
  assert.equal(rehydrated.localChanges[0].id, 'chg-2');
});
