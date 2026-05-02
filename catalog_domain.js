const marketDb = require('./market_db');
const messageQueue = require('./lib/message_queue');
const fs = require('fs');
const path = require('path');

const CATALOG_CONSUMER = 'catalog_projection_writer_v1';
let runtimeCatalogState = null;

function appendCatalogTrace(event, payload = {}) {
  try {
    const file = path.join(marketDb.getLogDir(), 'market_db_trace.log');
    fs.appendFileSync(file, `${JSON.stringify({
      ts: new Date().toISOString(),
      source: 'catalog_domain',
      pid: process.pid,
      event,
      ...payload,
    })}\n`);
  } catch (_) {}
}

function normalizeCategory(row = {}) {
  return {
    id: String(row.id || '').trim(),
    merchantId: String(row.merchantId || '').trim(),
    name: String(row.name || '').trim(),
    version: Math.max(1, Number(row.version || 1)),
    deleted: row.deleted === true,
    ownedByCurrentWallet: row.ownedByCurrentWallet === true,
    localStatus: String(row.localStatus || 'synced').trim(),
    localUpdatedAt: String(row.localUpdatedAt || '').trim(),
  };
}

function normalizeProduct(row = {}) {
  return {
    id: String(row.id || '').trim(),
    merchantId: String(row.merchantId || '').trim(),
    categoryId: String(row.categoryId || '').trim(),
    title: String(row.title || '').trim(),
    description: String(row.description || '').trim(),
    imageUrl: String(row.imageUrl || '').trim(),
    price: Math.max(0, Number(row.price || 0)),
    stock: Math.max(0, Number(row.stock || 0)),
    soldCount: Math.max(0, Number(row.soldCount || 0)),
    version: Math.max(1, Number(row.version || 1)),
    deleted: row.deleted === true,
    ownedByCurrentWallet: row.ownedByCurrentWallet === true,
    localStatus: String(row.localStatus || 'synced').trim(),
    localUpdatedAt: String(row.localUpdatedAt || '').trim(),
  };
}

function normalizeCatalogSnapshot(payload = {}) {
  return {
    categories: Array.isArray(payload.categories) ? payload.categories.map((row) => normalizeCategory(row)).filter((row) => row.id) : [],
    products: Array.isArray(payload.products) ? payload.products.map((row) => normalizeProduct(row)).filter((row) => row.id) : [],
  };
}

function cloneCatalogSnapshot(snapshot = null) {
  const normalized = normalizeCatalogSnapshot(snapshot || {});
  return {
    categories: normalized.categories.map((row) => ({ ...row })),
    products: normalized.products.map((row) => ({ ...row })),
  };
}

function catalogSnapshotEntityTotal(snapshot = null) {
  const normalized = normalizeCatalogSnapshot(snapshot || {});
  return Number(normalized.categories.length || 0) + Number(normalized.products.length || 0);
}

function makeRuntimeState() {
  return {
    loaded: false,
    snapshot: cloneCatalogSnapshot(),
    updatedAt: '',
  };
}

function cloneRuntimeState(state = null) {
  const current = state && typeof state === 'object' ? state : makeRuntimeState();
  return {
    loaded: current.loaded === true,
    snapshot: cloneCatalogSnapshot(current.snapshot),
    updatedAt: String(current.updatedAt || ''),
  };
}

function readProjectionSnapshot() {
  try {
    const categories = marketDb.listCategoriesFromReadDb();
    const products = marketDb.listProductsFromReadDb();
    return cloneCatalogSnapshot({
      categories: Array.isArray(categories) ? categories.map((row) => ({
        id: String(row.category_id || ''),
        merchantId: String(row.merchant_id || ''),
        name: String(row.name || ''),
        version: Math.max(1, Number(row.version || 1)),
        deleted: String(row.status || '') === 'deleted',
        ownedByCurrentWallet: Number(row.owned_by_current_wallet || 0) === 1,
        localStatus: String(row.local_status || 'synced'),
        localUpdatedAt: String(row.updated_at || ''),
      })) : [],
      products: Array.isArray(products) ? products.map((row) => ({
        id: String(row.product_id || ''),
        merchantId: String(row.merchant_id || ''),
        categoryId: String(row.category_id || ''),
        title: String(row.title || ''),
        description: String(row.description || ''),
        imageUrl: String(row.image_url || ''),
        price: Math.max(0, Number(row.price || 0)),
        stock: Math.max(0, Number(row.stock || 0)),
        soldCount: Math.max(0, Number(row.sold_count || 0)),
        version: Math.max(1, Number(row.version || 1)),
        deleted: String(row.status || '') === 'deleted',
        ownedByCurrentWallet: Number(row.owned_by_current_wallet || 0) === 1,
        localStatus: String(row.local_status || 'synced'),
        localUpdatedAt: String(row.updated_at || ''),
      })) : [],
    });
  } catch (_) {
    return cloneCatalogSnapshot();
  }
}

function getCatalogSnapshotSync() {
  if (runtimeCatalogState?.loaded === true) return cloneCatalogSnapshot(runtimeCatalogState.snapshot);
  const loaded = readProjectionSnapshot();
  runtimeCatalogState = {
    loaded: true,
    snapshot: cloneCatalogSnapshot(loaded),
    updatedAt: new Date().toISOString(),
  };
  return cloneCatalogSnapshot(runtimeCatalogState.snapshot);
}

function writeCatalogCache(snapshot) {
  runtimeCatalogState = {
    loaded: true,
    snapshot: cloneCatalogSnapshot(snapshot),
    updatedAt: new Date().toISOString(),
  };
  return getCatalogSnapshotSync();
}

async function ensureCatalogRuntimeLoaded(options = {}) {
  if (runtimeCatalogState?.loaded === true && options.forceReload !== true) {
    return cloneRuntimeState(runtimeCatalogState);
  }
  const snapshot = readProjectionSnapshot();
  runtimeCatalogState = {
    loaded: true,
    snapshot: cloneCatalogSnapshot(snapshot),
    updatedAt: new Date().toISOString(),
  };
  appendCatalogTrace('runtime_state_loaded', {
    consumerName: CATALOG_CONSUMER,
    categoryCount: runtimeCatalogState.snapshot.categories.length,
    productCount: runtimeCatalogState.snapshot.products.length,
    forceReload: options.forceReload === true,
  });
  return cloneRuntimeState(runtimeCatalogState);
}

function applyCatalogSnapshotToRuntime(snapshot = {}) {
  const normalized = normalizeCatalogSnapshot(snapshot);
  runtimeCatalogState = {
    loaded: true,
    snapshot: cloneCatalogSnapshot(normalized),
    updatedAt: new Date().toISOString(),
  };
  return cloneCatalogSnapshot(runtimeCatalogState.snapshot);
}

function sameCatalogEntity(a = {}, b = {}) {
  try {
    return JSON.stringify(a || {}) === JSON.stringify(b || {});
  } catch (_) {
    return false;
  }
}

function buildCatalogEntityBatch(snapshot, meta = {}) {
  const nextSnapshot = normalizeCatalogSnapshot(snapshot);
  // Persistence diff must compare against durable projection truth, not
  // in-process runtime state. Runtime can legitimately be ahead of projection
  // after resets, reloads, or partial failures; diffing against runtime would
  // incorrectly produce an empty batch and leave projection stale.
  const currentSnapshot = readProjectionSnapshot();
  const nextCategories = new Map(nextSnapshot.categories.map((row) => [row.id, row]));
  const nextProducts = new Map(nextSnapshot.products.map((row) => [row.id, row]));
  const currentCategories = new Map(currentSnapshot.categories.map((row) => [row.id, row]));
  const currentProducts = new Map(currentSnapshot.products.map((row) => [row.id, row]));
  const categories = [];
  const products = [];

  if (meta.resetAll === true) {
    nextSnapshot.categories.forEach((row) => categories.push({ ...row }));
    nextSnapshot.products.forEach((row) => products.push({ ...row }));
    return {
      categories,
      products,
      resetAll: true,
    };
  }

  nextCategories.forEach((row, id) => {
    const existing = currentCategories.get(id);
    if (!existing || !sameCatalogEntity(existing, row)) categories.push({ ...row });
  });
  currentCategories.forEach((row, id) => {
    if (nextCategories.has(id)) return;
    categories.push({
      ...row,
      deleted: true,
      localStatus: String(row.localStatus || 'synced'),
      localUpdatedAt: String(row.localUpdatedAt || new Date().toISOString()),
    });
  });

  nextProducts.forEach((row, id) => {
    const existing = currentProducts.get(id);
    if (!existing || !sameCatalogEntity(existing, row)) products.push({ ...row });
  });
  currentProducts.forEach((row, id) => {
    if (nextProducts.has(id)) return;
    products.push({
      ...row,
      deleted: true,
      localStatus: String(row.localStatus || 'synced'),
      localUpdatedAt: String(row.localUpdatedAt || new Date().toISOString()),
    });
  });

  return {
    categories,
    products,
    resetAll: false,
  };
}

async function applyCatalogEntityBatch(batch, meta = {}) {
  const payload = {
    categories: Array.isArray(batch?.categories) ? batch.categories.map((row) => normalizeCategory(row)).filter((row) => row.id) : [],
    products: Array.isArray(batch?.products) ? batch.products.map((row) => normalizeProduct(row)).filter((row) => row.id) : [],
  };
  const startedAt = Date.now();
  await marketDb.replaceCatalogSnapshot({
    ...payload,
    resetAll: meta.resetAll === true || batch?.resetAll === true,
  });
  const finishedAt = Date.now();
  if (meta.resetAll === true || batch?.resetAll === true) {
    writeCatalogCache({
      categories: Array.isArray(payload.categories) ? payload.categories : [],
      products: Array.isArray(payload.products) ? payload.products : [],
    });
  } else {
    writeCatalogCache(readProjectionSnapshot());
  }
  appendCatalogTrace('entity_batch_applied', {
    categories: payload.categories.length,
    products: payload.products.length,
    payloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    source: String(meta.source || 'catalog_domain'),
    resetAll: meta.resetAll === true || batch?.resetAll === true,
    seq: Math.max(0, Number(meta.seq || 0)),
    elapsedMs: finishedAt - startedAt,
  });
  return payload;
}

async function applyCatalogSnapshot(snapshot, meta = {}) {
  const batch = buildCatalogEntityBatch(snapshot, meta);
  return applyCatalogEntityBatch(batch, meta);
}

async function catchUpProjection() {
  const snapshot = getCatalogSnapshotSync();
  appendCatalogTrace('catchup_skipped_event_driven', {
    consumerName: CATALOG_CONSUMER,
    categories: snapshot.categories.length,
    products: snapshot.products.length,
  });
  return {
    applied: 0,
    lastSeq: 0,
  };
}

async function emitCatalogSnapshot(snapshot, meta = {}) {
  const payload = normalizeCatalogSnapshot(snapshot);
  const resetAll = meta.resetAll === true;
  const currentSnapshot = readProjectionSnapshot();
  const incomingTotal = catalogSnapshotEntityTotal(payload);
  const currentTotal = catalogSnapshotEntityTotal(currentSnapshot);
  if (!resetAll && currentTotal > incomingTotal) {
    appendCatalogTrace('emit_snapshot_skipped_stale', {
      categories: payload.categories.length,
      products: payload.products.length,
      currentCategories: currentSnapshot.categories.length,
      currentProducts: currentSnapshot.products.length,
      producer: String(meta.producer || 'catalog_domain'),
      resetAll: false,
    });
    return cloneCatalogSnapshot(currentSnapshot);
  }
  await ensureCatalogRuntimeLoaded();
  const batch = buildCatalogEntityBatch(payload, meta);
  appendCatalogTrace('emit_snapshot', {
    categories: payload.categories.length,
    products: payload.products.length,
    payloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    producer: String(meta.producer || 'catalog_domain'),
    resetAll,
  });
  appendCatalogTrace('emit_entity_batch', {
    categoryOps: batch.categories.length,
    productOps: batch.products.length,
    producer: String(meta.producer || 'catalog_domain'),
    resetAll: resetAll || batch.resetAll === true,
  });
  for (const row of batch.categories) {
    await messageQueue.publish(row.deleted ? 'catalog.category.deleted' : 'catalog.category.upserted', row, {
      mode: messageQueue.MODE_TRANSIENT,
      source: String(meta.producer || 'catalog_domain'),
    });
  }
  for (const row of batch.products) {
    await messageQueue.publish(row.deleted ? 'catalog.product.deleted' : 'catalog.product.upserted', row, {
      mode: messageQueue.MODE_TRANSIENT,
      source: String(meta.producer || 'catalog_domain'),
    });
  }
  applyCatalogSnapshotToRuntime(payload);
  await applyCatalogEntityBatch(batch, {
    source: String(meta.producer || 'catalog_domain'),
    resetAll,
    seq: 0,
  });
  return payload;
}

async function resetCatalogSnapshot() {
  return emitCatalogSnapshot({
    categories: [],
    products: [],
  }, {
    producer: 'catalog_domain.reset',
    resetAll: true,
  });
}

async function rehydrateCatalogRuntimeFromProjection() {
  const state = await ensureCatalogRuntimeLoaded({ forceReload: true });
  return cloneCatalogSnapshot(state.snapshot);
}

module.exports = {
  CATALOG_CONSUMER,
  applyCatalogSnapshot,
  applyCatalogEntityBatch,
  catchUpProjection,
  ensureCatalogRuntimeLoaded,
  emitCatalogSnapshot,
  getCatalogSnapshotSync,
  rehydrateCatalogRuntimeFromProjection,
  resetCatalogSnapshot,
};
