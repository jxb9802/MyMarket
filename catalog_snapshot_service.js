const fs = require('fs');

function createCatalogSnapshotService(deps = {}) {
  const { marketDb } = deps;

  function buildCatalogSnapshotPayload(state) {
    return {
      categories: Array.isArray(state?.categories) ? state.categories : [],
      products: Array.isArray(state?.products) ? state.products : [],
    };
  }

  function loadCatalogSnapshotFromSqlite() {
    try {
      const dbFile = marketDb.getDbFilePath();
      if (!fs.existsSync(dbFile)) return null;
      const categories = marketDb.listCategoriesFromReadDb();
      const products = marketDb.listProductsFromReadDb();
      if ((!Array.isArray(categories) || categories.length === 0) && (!Array.isArray(products) || products.length === 0)) {
        return null;
      }
      return {
        categories: (Array.isArray(categories) ? categories : []).map((row) => ({
          id: String(row.category_id || ''),
          merchantId: String(row.merchant_id || ''),
          name: String(row.name || ''),
          version: Math.max(1, Number(row.version || 1)),
          deleted: String(row.status || '') === 'deleted',
          ownedByCurrentWallet: Boolean(row.owned_by_current_wallet),
          localStatus: String(row.local_status || 'synced'),
          localUpdatedAt: String(row.updated_at || ''),
        })),
        products: (Array.isArray(products) ? products : []).map((row) => ({
          id: String(row.product_id || ''),
          merchantId: String(row.merchant_id || ''),
          categoryId: String(row.category_id || ''),
          title: String(row.title || ''),
          price: Math.max(0, Number(row.price || 0)),
          stock: Math.max(0, Number(row.stock || 0)),
          soldCount: Math.max(0, Number(row.sold_count || 0)),
          version: Math.max(1, Number(row.version || 1)),
          imageUrl: String(row.image_url || ''),
          description: String(row.description || ''),
          deleted: String(row.status || '') === 'deleted',
          ownedByCurrentWallet: Boolean(row.owned_by_current_wallet),
          localStatus: String(row.local_status || 'synced'),
          localUpdatedAt: String(row.updated_at || ''),
        })),
      };
    } catch (_) {
      return null;
    }
  }

  return {
    buildCatalogSnapshotPayload,
    loadCatalogSnapshotFromSqlite,
  };
}

module.exports = {
  createCatalogSnapshotService,
};
