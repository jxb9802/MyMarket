const marketDb = require('../../market_db');

function buildMerchantNameMap() {
  const rows = marketDb.listAnchorEventsFromReadDb({
    eventTypes: ['profile_set'],
  });
  const names = new Map();
  rows.forEach((row) => {
    const merchantId = String(row?.merchantId || '').trim();
    const name = String(row?.payload?.name || '').trim();
    if (!merchantId || !name) return;
    names.set(merchantId, name);
  });
  return names;
}

function listCatalogSummary() {
  const merchantNames = buildMerchantNameMap();
  const categories = marketDb.listCategoriesFromReadDb().map((row) => ({
    id: String(row.category_id || '').trim(),
    merchantId: String(row.merchant_id || '').trim(),
    name: String(row.name || '').trim(),
    version: Math.max(1, Number(row.version || 1)),
    deleted: String(row.status || '') === 'deleted',
    ownedByCurrentWallet: Number(row.owned_by_current_wallet || 0) === 1,
    localStatus: String(row.local_status || 'synced').trim(),
    localUpdatedAt: String(row.updated_at || '').trim(),
  }));
  const products = marketDb.listProductsFromReadDb().map((row) => ({
    id: String(row.product_id || '').trim(),
    merchantId: String(row.merchant_id || '').trim(),
    categoryId: String(row.category_id || '').trim(),
    title: String(row.title || '').trim(),
    description: String(row.description || '').trim(),
    imageUrl: String(row.image_url || '').trim(),
    price: Math.max(0, Number(row.price || 0)),
    stock: Math.max(0, Number(row.stock || 0)),
    soldCount: Math.max(0, Number(row.sold_count || 0)),
    version: Math.max(1, Number(row.version || 1)),
    deleted: String(row.status || '') === 'deleted',
    ownedByCurrentWallet: Number(row.owned_by_current_wallet || 0) === 1,
    localStatus: String(row.local_status || 'synced').trim(),
    localUpdatedAt: String(row.updated_at || '').trim(),
  }));
  const merchantMap = new Map();
  for (const row of [...categories, ...products]) {
    const merchantId = String(row?.merchantId || '').trim();
    if (!merchantId || merchantMap.has(merchantId)) continue;
    merchantMap.set(merchantId, {
      id: merchantId,
      name: String(merchantNames.get(merchantId) || merchantId).trim(),
    });
  }
  return {
    merchants: Array.from(merchantMap.values()),
    categories,
    products,
  };
}

module.exports = {
  listCatalogSummary,
};
