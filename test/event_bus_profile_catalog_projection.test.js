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

test('profile and catalog runtime/projection stay consistent', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-event-bus-profile-catalog-'));
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
  const profileDomain = loadFresh('../profile_domain');
  const catalogDomain = loadFresh('../catalog_domain');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();

  await profileDomain.emitProfileUpsert({
    profileKey: 'self',
    merchantId: 'm-local',
    walletId: 'wallet-1',
    name: 'Evented Profile',
    localStatus: 'modified',
    localUpdatedAt: '2026-04-04T17:00:00.000Z',
    updatedAt: '2026-04-04T17:00:00.000Z',
  }, {
    producer: 'profile_catalog_test',
    dedupeKey: 'profile_catalog_test:profile',
  });

  await catalogDomain.emitCatalogSnapshot({
    categories: [{
      id: 'cat-1',
      merchantId: 'm-local',
      name: 'Cat One',
      ownedByCurrentWallet: true,
      localStatus: 'synced',
      localUpdatedAt: '2026-04-04T17:00:00.000Z',
    }],
    products: [{
      id: 'prod-1',
      merchantId: 'm-local',
      categoryId: 'cat-1',
      title: 'Prod One',
      description: 'desc',
      imageUrl: '',
      price: 123,
      stock: 4,
      soldCount: 2,
      deleted: false,
      ownedByCurrentWallet: true,
      localStatus: 'synced',
      localUpdatedAt: '2026-04-04T17:00:00.000Z',
    }],
  }, {
    producer: 'profile_catalog_test',
    dedupeKey: 'profile_catalog_test:catalog',
  });

  const profile = await marketDb.getProfileSnapshot('self');
  assert.equal(profile.name, 'Evented Profile');
  assert.equal(profileDomain.getProfileSnapshotSync('self')?.name, 'Evented Profile');

  const reloadedProfileDomain = loadFresh('../profile_domain');
  const rehydrated = await reloadedProfileDomain.rehydrateProfileRuntimeFromProjection('self');
  assert.equal(rehydrated?.name, 'Evented Profile');

  const categories = marketDb.listCategoriesFromReadDb();
  const products = marketDb.listProductsFromReadDb();
  assert.equal(categories.length, 1);
  assert.equal(products.length, 1);
  assert.equal(categories[0].category_id, 'cat-1');
  assert.equal(products[0].product_id, 'prod-1');

  const runtimeCatalog = catalogDomain.getCatalogSnapshotSync();
  assert.equal(runtimeCatalog.categories.length, 1);
  assert.equal(runtimeCatalog.products.length, 1);

  const reloadedCatalogDomain = loadFresh('../catalog_domain');
  const rehydratedCatalog = await reloadedCatalogDomain.rehydrateCatalogRuntimeFromProjection();
  assert.equal(rehydratedCatalog.categories.length, 1);
  assert.equal(rehydratedCatalog.products.length, 1);

  await marketDb.replaceCatalogSnapshot({
    categories: [],
    products: [],
    resetAll: true,
  });

  assert.equal(marketDb.listCategoriesFromReadDb().length, 0);
  assert.equal(catalogDomain.getCatalogSnapshotSync().categories.length, 1);

  await catalogDomain.emitCatalogSnapshot({
    categories: [{
      id: 'cat-1',
      merchantId: 'm-local',
      name: 'Cat One',
      ownedByCurrentWallet: true,
      localStatus: 'synced',
      localUpdatedAt: '2026-04-04T17:00:00.000Z',
    }],
    products: [{
      id: 'prod-1',
      merchantId: 'm-local',
      categoryId: 'cat-1',
      title: 'Prod One',
      description: 'desc',
      imageUrl: '',
      price: 123,
      stock: 4,
      soldCount: 2,
      deleted: false,
      ownedByCurrentWallet: true,
      localStatus: 'synced',
      localUpdatedAt: '2026-04-04T17:00:00.000Z',
    }],
  }, {
    producer: 'profile_catalog_test_recover_projection',
    dedupeKey: 'profile_catalog_test:catalog:recover',
  });

  assert.equal(marketDb.listCategoriesFromReadDb().length, 1);
  assert.equal(marketDb.listProductsFromReadDb().length, 1);
});
