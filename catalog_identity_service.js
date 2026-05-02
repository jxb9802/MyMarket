function createCatalogIdentityService(deps = {}) {
  const {
    sanitizeMerchantId,
    getEffectiveAnchorRows,
    payloadUpdatedAtMs,
  } = deps;

  function isLegacyMerchantId(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s) return true;
    if (s === 'm-local') return true;
    return /^m-\d+$/.test(s);
  }

  function resolveMerchantIdByOwnership(anchorLike, merchantIdRaw, currentMerchantId, walletTxidSet) {
    const merchantId = String(merchantIdRaw || '').trim();
    const current = sanitizeMerchantId(currentMerchantId);
    const txid = String(anchorLike?.txid || '').trim();
    const txOwnedByCurrentWallet = Boolean(txid && walletTxidSet && walletTxidSet.has(txid));
    if (txOwnedByCurrentWallet && current && isLegacyMerchantId(merchantId)) return current;
    return sanitizeMerchantId(merchantId) || merchantId || '';
  }

  function isAnchorOwnedByCurrentWallet(anchorLike, walletTxidSet) {
    const txid = String(anchorLike?.txid || '').trim();
    return Boolean(txid && walletTxidSet instanceof Set && walletTxidSet.has(txid));
  }

  function inferOwnedMerchantIdFromAnchors(state, walletTxidSet, fallbackMerchantId = '') {
    const current = sanitizeMerchantId(fallbackMerchantId);
    if (!(walletTxidSet instanceof Set) || walletTxidSet.size === 0) return current;
    const votes = new Map();
    const anchors = getEffectiveAnchorRows(state);
    anchors.forEach((a) => {
      const txid = String(a?.txid || '').trim();
      if (!txid || !walletTxidSet.has(txid)) return;
      const payloadMerchantId = sanitizeMerchantId(a?.payload?.merchantId || '');
      if (!payloadMerchantId) return;
      const prev = votes.get(payloadMerchantId) || { count: 0, lastTs: 0 };
      const ts = payloadUpdatedAtMs(a?.payload || {}, String(a?.ts || ''));
      votes.set(payloadMerchantId, {
        count: prev.count + 1,
        lastTs: Math.max(prev.lastTs, Number.isFinite(ts) ? ts : 0),
      });
    });
    if (!votes.size) return current;
    const ranked = Array.from(votes.entries()).sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      if (b[1].lastTs !== a[1].lastTs) return b[1].lastTs - a[1].lastTs;
      const aLegacy = isLegacyMerchantId(a[0]) ? 1 : 0;
      const bLegacy = isLegacyMerchantId(b[0]) ? 1 : 0;
      if (aLegacy !== bLegacy) return aLegacy - bLegacy;
      return String(a[0]).localeCompare(String(b[0]));
    });
    return String(ranked[0]?.[0] || current || '');
  }

  function inferLegacyCurrentMerchantIdFromCatalog(state, fallbackMerchantId = '') {
    const fallback = sanitizeMerchantId(fallbackMerchantId);
    const merchants = Array.isArray(state?.merchants) ? state.merchants : [];
    const categories = Array.isArray(state?.categories) ? state.categories : [];
    const products = Array.isArray(state?.products) ? state.products : [];
    if (fallback && merchants.some((m) => sanitizeMerchantId(m?.id) === fallback)) return fallback;

    const stats = new Map();
    const touch = (merchantId, kind, tsRaw) => {
      const id = sanitizeMerchantId(merchantId);
      if (!id || !isLegacyMerchantId(id)) return;
      const prev = stats.get(id) || { products: 0, categories: 0, lastTs: 0 };
      const next = { ...prev };
      if (kind === 'product') next.products += 1;
      if (kind === 'category') next.categories += 1;
      const ts = Date.parse(String(tsRaw || ''));
      if (Number.isFinite(ts)) next.lastTs = Math.max(next.lastTs, ts);
      stats.set(id, next);
    };
    categories.forEach((c) => touch(c?.merchantId, 'category', c?.localUpdatedAt));
    products.forEach((p) => {
      if (p?.deleted) return;
      touch(p?.merchantId, 'product', p?.localUpdatedAt);
    });
    const ranked = Array.from(stats.entries()).sort((a, b) => {
      if (b[1].products !== a[1].products) return b[1].products - a[1].products;
      if (b[1].categories !== a[1].categories) return b[1].categories - a[1].categories;
      const aLocal = a[0] === 'm-local' ? 1 : 0;
      const bLocal = b[0] === 'm-local' ? 1 : 0;
      if (aLocal !== bLocal) return aLocal - bLocal;
      if (b[1].lastTs !== a[1].lastTs) return b[1].lastTs - a[1].lastTs;
      return String(a[0]).localeCompare(String(b[0]));
    });
    return String(ranked[0]?.[0] || fallback || '');
  }

  function merchantDisplayName(merchantId, rawName) {
    const id = String(merchantId || '').trim();
    const name = String(rawName || '').trim();
    if (name && name !== id) return name;
    if (!id) return '未命名商家';
    if (id === 'm-local') return '本地商家';
    const shortId = id.replace(/^m-/, '').slice(0, 6) || id;
    return `未命名商家(${shortId})`;
  }

  function getOrCreateSellerUser(state, merchantId, fallbackName = '') {
    const safe = String(merchantId || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const id = `seller-${safe || 'unknown'}`;
    const preferredName = fallbackName ? String(fallbackName) : String(merchantId);
    let user = (state.users || []).find((u) => u.id === id);
    if (!user) {
      user = {
        id,
        name: preferredName,
        role: 'seller',
        merchantId,
      };
      state.users.push(user);
      return user;
    }
    const currentName = String(user?.name || '').trim();
    const placeholderNames = new Set([
      String(merchantId),
      String(merchantDisplayName(merchantId, '')),
      `${merchantId}客服`,
      `${merchantDisplayName(merchantId, '')}客服`,
    ]);
    if (fallbackName && (!currentName || placeholderNames.has(currentName))) {
      user.name = preferredName;
    }
    return user;
  }

  return {
    isLegacyMerchantId,
    resolveMerchantIdByOwnership,
    isAnchorOwnedByCurrentWallet,
    inferOwnedMerchantIdFromAnchors,
    inferLegacyCurrentMerchantIdFromCatalog,
    merchantDisplayName,
    getOrCreateSellerUser,
  };
}

module.exports = {
  createCatalogIdentityService,
};
