const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFreshMarketDb() {
  const readDbPoolPath = require.resolve('../read_db_pool');
  delete require.cache[readDbPoolPath];
  const modulePath = require.resolve('../market_db');
  delete require.cache[modulePath];
  return require('../market_db');
}

test('market_db writer initializes schema and upserts sync state', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-db-test-'));
  const dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const prevDataDir = process.env.BSV_MARKET_DATA_DIR;
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  const marketDb = loadFreshMarketDb();

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    if (prevDataDir === undefined) delete process.env.BSV_MARKET_DATA_DIR;
    else process.env.BSV_MARKET_DATA_DIR = prevDataDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const ready = await marketDb.ensureWriterService();
  assert.equal(typeof ready.dbFile, 'string');
  assert.equal(fs.existsSync(marketDb.getDbFilePath()), true);

  const health = await marketDb.healthCheck();
  assert.equal(health.isOpen, true);
  assert.equal(health.dbFile, marketDb.getDbFilePath());

  await marketDb.upsertSyncState({
    scope: 'main',
    bootstrapHeight: 938250,
    localHeight: 938260,
    fixedSyncLastHeight: 938260,
    p2pTipHeight: 938300,
    p2pTipHash: 'tip-hash',
    p2pHeaderCursorHeight: 938260,
    p2pHeaderCursorHash: 'cursor-hash',
    online: false,
    mode: 'catchup',
    lag: 40,
    sessionEpoch: 7,
    updatedAt: '2026-03-31T12:00:00.000Z',
  });

  const row = await marketDb.getSyncState('main');
  assert.equal(row.scope, 'main');
  assert.equal(row.local_height, 938260);
  assert.equal(row.p2p_tip_height, 938300);
  assert.equal(row.mode, 'catchup');
  assert.equal(row.session_epoch, 7);

  const readDb = marketDb.openReadDb();
  try {
    const meta = readDb.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version');
    assert.equal(meta.value, '1');
  } finally {
    readDb.close();
  }
});

test('market_db writer removes stale rawtx pending files on startup', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-db-test-'));
  const dataDir = path.join(tmpRoot, 'data');
  const pendingDir = path.join(dataDir, 'rawtx', 'pending');
  fs.mkdirSync(pendingDir, { recursive: true });
  const staleFile = path.join(pendingDir, 'stale.rawtx');
  fs.writeFileSync(staleFile, 'deadbeef');
  const staleAt = Date.now() - (7 * 60 * 60 * 1000);
  fs.utimesSync(staleFile, staleAt / 1000, staleAt / 1000);

  const prevDataDir = process.env.BSV_MARKET_DATA_DIR;
  const prevPendingAge = process.env.BSV_MARKET_RAWTX_PENDING_MAX_AGE_MS;
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_RAWTX_PENDING_MAX_AGE_MS = String(60 * 60 * 1000);
  const marketDb = loadFreshMarketDb();

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    if (prevDataDir === undefined) delete process.env.BSV_MARKET_DATA_DIR;
    else process.env.BSV_MARKET_DATA_DIR = prevDataDir;
    if (prevPendingAge === undefined) delete process.env.BSV_MARKET_RAWTX_PENDING_MAX_AGE_MS;
    else process.env.BSV_MARKET_RAWTX_PENDING_MAX_AGE_MS = prevPendingAge;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const ready = await marketDb.ensureWriterService();
  assert.equal(ready.cleanedPendingCount, 1);
  assert.equal(fs.existsSync(staleFile), false);
});

test('market_db writer replaces and reads catalog snapshot', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-db-test-'));
  const dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const prevDataDir = process.env.BSV_MARKET_DATA_DIR;
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  const marketDb = loadFreshMarketDb();

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    if (prevDataDir === undefined) delete process.env.BSV_MARKET_DATA_DIR;
    else process.env.BSV_MARKET_DATA_DIR = prevDataDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();
  await marketDb.replaceCatalogSnapshot({
    categories: [
      {
        id: 'cat-1',
        merchantId: 'm-1',
        name: 'Cat 1',
        ownedByCurrentWallet: true,
        localStatus: 'synced',
        localUpdatedAt: '2026-03-31T00:00:00.000Z',
      },
    ],
    products: [
      {
        id: 'prod-1',
        merchantId: 'm-1',
        categoryId: 'cat-1',
        title: 'Prod 1',
        description: 'Desc',
        imageUrl: 'https://example.com/p.png',
        price: 123,
        stock: 4,
        soldCount: 2,
        deleted: false,
        ownedByCurrentWallet: true,
        localStatus: 'synced',
        localUpdatedAt: '2026-03-31T00:00:00.000Z',
      },
    ],
  });

  const categories = marketDb.listCategoriesFromReadDb();
  const products = marketDb.listProductsFromReadDb();
  assert.equal(categories.length, 1);
  assert.equal(products.length, 1);
  assert.equal(categories[0].category_id, 'cat-1');
  assert.equal(products[0].product_id, 'prod-1');
  assert.equal(products[0].owned_by_current_wallet, 1);
});

test('market_db writer upserts and clears tx contexts', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-db-test-'));
  const dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const prevDataDir = process.env.BSV_MARKET_DATA_DIR;
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  const marketDb = loadFreshMarketDb();

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    if (prevDataDir === undefined) delete process.env.BSV_MARKET_DATA_DIR;
    else process.env.BSV_MARKET_DATA_DIR = prevDataDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();
  const txid = 'b'.repeat(64);
  await marketDb.upsertTxContext({
    txid,
    rawtxHex: 'deadbeef',
    inputTxids: ['a'.repeat(64)],
    source: 'spv-index',
    kind: 'wallet_send',
    confirmed: false,
    proofType: '',
    proofSource: '',
    proofHex: '',
    proofEncoding: '',
    proofVerified: false,
    proofVerifiedAt: null,
    proofBlockHeight: null,
    proofBlockHash: '',
    proofMerkleRoot: '',
    firstSeenAt: '2026-04-01T00:00:00.000Z',
    lastSeenAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  });

  await marketDb.upsertTxContext({
    txid,
    rawtxHex: 'deadbeef',
    inputTxids: ['a'.repeat(64), 'c'.repeat(64)],
    source: 'woc',
    kind: 'sync_backfill',
    confirmed: true,
    proofType: 'merkle-path-tsc',
    proofSource: 'woc-tsc',
    proofHex: 'bead',
    proofEncoding: 'bump',
    proofVerified: true,
    proofVerifiedAt: '2026-04-01T00:01:00.000Z',
    proofBlockHeight: 938250,
    proofBlockHash: 'd'.repeat(64),
    proofMerkleRoot: 'e'.repeat(64),
    firstSeenAt: '2026-04-01T00:00:00.000Z',
    lastSeenAt: '2026-04-01T00:01:00.000Z',
    updatedAt: '2026-04-01T00:01:00.000Z',
  });

  const row = await marketDb.getTxContext(txid);
  assert.equal(row.txid, txid);
  assert.equal(row.confirmed, 1);
  assert.equal(row.proof_verified, 1);
  assert.equal(row.proof_hex, 'bead');
  assert.deepEqual(JSON.parse(row.input_txids_json), ['a'.repeat(64), 'c'.repeat(64)]);

  await marketDb.clearTxContexts();
  const cleared = await marketDb.getTxContext(txid);
  assert.equal(cleared, null);
});

test('market_db writer upserts anchor events and read db lists them', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-db-test-'));
  const dataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const prevDataDir = process.env.BSV_MARKET_DATA_DIR;
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  const marketDb = loadFreshMarketDb();

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    if (prevDataDir === undefined) delete process.env.BSV_MARKET_DATA_DIR;
    else process.env.BSV_MARKET_DATA_DIR = prevDataDir;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();
  const txid = 'f'.repeat(64);
  await marketDb.upsertAnchorEvents([
    {
      txid,
      height: 938250,
      eventType: 'profile_set',
      ts: '2026-04-01T00:00:00.000Z',
      confirmed: false,
      node: 'node-1',
      payload: {
        merchantId: 'm-1',
        walletId: 'wallet-1',
        name: 'tester',
      },
    },
  ]);

  await marketDb.markAnchorEventsConfirmed([txid]);

  const rows = marketDb.listAnchorEventsFromReadDb({ eventTypes: ['profile_set'] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].txid, txid);
  assert.equal(rows[0].eventType, 'profile_set');
  assert.equal(rows[0].merchantId, 'm-1');
  assert.equal(rows[0].walletId, 'wallet-1');
  assert.equal(rows[0].confirmed, true);
});
