function createCatalogProjectionService(deps = {}) {
  const {
    normalizeEventPayload,
    payloadUpdatedAtMs,
    shouldApplyVersionedEntityEvent,
    resolveMerchantIdByOwnership,
    isAnchorOwnedByCurrentWallet,
    inferOwnedMerchantIdFromAnchors,
    getWalletTxidSetSafe,
    ensureCurrentMerchantId,
    merchantDisplayName,
    getOrCreateSellerUser,
    getEffectiveAnchorRows,
    persistCatalogSnapshotAsync,
    appendMarketDebug,
    UNCONFIRMED_DELETE_TTL_MS,
    isLegacyMerchantId,
  } = deps;

  function rebuildCatalogFromAnchors(state, req = null, options = {}) {
    const categories = [];
    const products = [];
    const categoryMap = new Map();
    const productMap = new Map();
    const merchantMap = new Map();
    const profileNameByMerchant = new Map();
    const categoryVersionMeta = new Map();
    const productVersionMeta = new Map();
    const profileStampByMerchant = new Map();
    let profileAnyStamp = 0;
    let profileCurrentStamp = 0;
    const walletTxidSet = getWalletTxidSetSafe();
    const sessionMerchantId = ensureCurrentMerchantId(state, req || {});
    const currentMerchantId = inferOwnedMerchantIdFromAnchors(state, walletTxidSet, sessionMerchantId) || sessionMerchantId;
    const sameMerchantId = (a = '', b = '') => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    const isCurrentMerchantRow = (merchantId = '') => Boolean(currentMerchantId && merchantId && sameMerchantId(merchantId, currentMerchantId));
    const hasPayloadField = (payload, field) => Object.prototype.hasOwnProperty.call(payload || {}, field);
    state.currentMerchantId = currentMerchantId;
    let profileNameFromChain = '';
    let profileNameAny = '';
    const inferredCategoryMerchantById = new Map();

    const eventMomentMs = (x) => payloadUpdatedAtMs(x?.payload || {}, String(x?.ts || ''));
    const sorted = getEffectiveAnchorRows(state).slice().sort((a, b) => {
      const da = eventMomentMs(a);
      const db = eventMomentMs(b);
      if (da !== db) return da - db;
      const ta = Date.parse(String(a?.ts || ''));
      const tb = Date.parse(String(b?.ts || ''));
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.txid || '').localeCompare(String(b?.txid || ''));
    });

    sorted.forEach((a) => {
      const modifiedAt = Number.isFinite(eventMomentMs(a)) ? new Date(eventMomentMs(a)).toISOString() : null;
      const p = normalizeEventPayload(a.eventType, a.payload || {}, modifiedAt || String(a.ts || ''));
      const eventTs = payloadUpdatedAtMs(p, modifiedAt || String(a?.ts || ''));
      if (a.eventType === 'category_add' && p.id) {
        const id = String(p.id);
        if (!shouldApplyVersionedEntityEvent(categoryVersionMeta, id, p.version, eventTs)) return;
        const ownerMerchantId = resolveMerchantIdByOwnership(a, p.merchantId, currentMerchantId, walletTxidSet) || 'm-local';
        const ownedByCurrentWallet = isAnchorOwnedByCurrentWallet(a, walletTxidSet);
        merchantMap.set(ownerMerchantId, true);
        categoryMap.set(id, {
          id,
          name: String(p.name || id),
          merchantId: ownerMerchantId,
          version: Number(p.version || 1),
          deleted: false,
          ownedByCurrentWallet,
          localStatus: 'synced',
          localUpdatedAt: Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt,
        });
        return;
      }
      if (a.eventType === 'category_edit' && p.id) {
        const id = String(p.id);
        if (!shouldApplyVersionedEntityEvent(categoryVersionMeta, id, p.version, eventTs)) return;
        const existing = categoryMap.get(id) || {
          id,
          name: String(p.name || id),
          merchantId: resolveMerchantIdByOwnership(a, p.merchantId, currentMerchantId, walletTxidSet) || 'm-local',
          version: Number(p.version || 1),
          deleted: false,
          ownedByCurrentWallet: isAnchorOwnedByCurrentWallet(a, walletTxidSet),
          localStatus: 'synced',
          localUpdatedAt: Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt,
        };
        existing.name = String(p.name || existing.name || id);
        existing.version = Number(p.version || existing.version || 1);
        existing.deleted = false;
        existing.localUpdatedAt = Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt;
        categoryMap.set(id, existing);
        return;
      }
      if (a.eventType === 'category_delete' && p.id) {
        const id = String(p.id);
        if (!shouldApplyVersionedEntityEvent(categoryVersionMeta, id, p.version, eventTs)) return;
        const existing = categoryMap.get(id) || {
          id,
          name: String(p.name || id),
          merchantId: resolveMerchantIdByOwnership(a, p.merchantId, currentMerchantId, walletTxidSet) || 'm-local',
          version: Number(p.version || 1),
          deleted: true,
          ownedByCurrentWallet: isAnchorOwnedByCurrentWallet(a, walletTxidSet),
          localStatus: 'synced',
          localUpdatedAt: Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt,
        };
        existing.version = Number(p.version || existing.version || 1);
        existing.deleted = true;
        existing.localUpdatedAt = Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt;
        categoryMap.set(id, existing);
        return;
      }

      if (a.eventType === 'product_add' && p.id) {
        const id = String(p.id);
        if (!shouldApplyVersionedEntityEvent(productVersionMeta, id, p.version, eventTs)) return;
        const ownerMerchantId = resolveMerchantIdByOwnership(a, p.merchantId, currentMerchantId, walletTxidSet) || 'm-local';
        const ownedByCurrentWallet = isAnchorOwnedByCurrentWallet(a, walletTxidSet);
        if (p.categoryId && ownerMerchantId) inferredCategoryMerchantById.set(String(p.categoryId), ownerMerchantId);
        productMap.set(id, {
          id,
          merchantId: ownerMerchantId,
          ownedByCurrentWallet,
          categoryId: String(p.categoryId || ''),
          title: String(p.title || id),
          price: Number(p.price || 0),
          stock: Number(p.stock || 0),
          soldCount: Number(p.soldCount || 0),
          imageUrl: String(p.imageUrl || ''),
          description: String(p.description || ''),
          version: Number(p.version || 1),
          deleted: false,
          deleteSync: { acked: 1, total: 1 },
          localStatus: 'synced',
          localUpdatedAt: Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt,
        });
        merchantMap.set(ownerMerchantId, true);
        return;
      }
      if (a.eventType === 'product_edit' && p.id && productMap.has(String(p.id))) {
        const id = String(p.id);
        if (!shouldApplyVersionedEntityEvent(productVersionMeta, id, p.version, eventTs)) return;
        const row = productMap.get(id);
        const ownerMerchantId = resolveMerchantIdByOwnership(a, p.merchantId, currentMerchantId, walletTxidSet);
        const ownedByCurrentWallet = isAnchorOwnedByCurrentWallet(a, walletTxidSet);
        if (ownerMerchantId) row.merchantId = ownerMerchantId;
        row.ownedByCurrentWallet = ownedByCurrentWallet;
        if (p.categoryId && ownerMerchantId) inferredCategoryMerchantById.set(String(p.categoryId), ownerMerchantId);
        if (hasPayloadField(p, 'categoryId')) row.categoryId = String(p.categoryId || '');
        if (hasPayloadField(p, 'title')) row.title = String(p.title ?? row.title ?? id);
        if (hasPayloadField(p, 'price')) row.price = Number(p.price ?? row.price);
        if (hasPayloadField(p, 'stock')) row.stock = Number(p.stock ?? row.stock);
        if (hasPayloadField(p, 'soldCount')) row.soldCount = Number(p.soldCount ?? row.soldCount ?? 0);
        if (hasPayloadField(p, 'imageUrl')) row.imageUrl = String(p.imageUrl || '');
        if (hasPayloadField(p, 'description')) row.description = String(p.description || '');
        row.version = Number(p.version || row.version + 1);
        row.localStatus = 'synced';
        row.localUpdatedAt = Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt;
        return;
      }
      if (a.eventType === 'product_bump' && p.id && productMap.has(String(p.id))) {
        const id = String(p.id);
        if (!shouldApplyVersionedEntityEvent(productVersionMeta, id, p.version, eventTs)) return;
        const row = productMap.get(id);
        const ownerMerchantId = resolveMerchantIdByOwnership(a, p.merchantId, currentMerchantId, walletTxidSet);
        const ownedByCurrentWallet = isAnchorOwnedByCurrentWallet(a, walletTxidSet);
        if (ownerMerchantId) row.merchantId = ownerMerchantId;
        row.ownedByCurrentWallet = ownedByCurrentWallet;
        row.version = Number(p.version || row.version + 1);
        if (hasPayloadField(p, 'categoryId')) row.categoryId = String(p.categoryId || '');
        if (hasPayloadField(p, 'title')) row.title = String(p.title ?? row.title ?? id);
        if (hasPayloadField(p, 'price')) row.price = Number(p.price ?? row.price);
        if (hasPayloadField(p, 'stock')) row.stock = Number(p.stock ?? row.stock);
        if (hasPayloadField(p, 'soldCount')) row.soldCount = Number(p.soldCount ?? row.soldCount ?? 0);
        if (hasPayloadField(p, 'imageUrl')) row.imageUrl = String(p.imageUrl || '');
        if (hasPayloadField(p, 'description')) row.description = String(p.description || '');
        row.localStatus = 'synced';
        row.localUpdatedAt = Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt;
        return;
      }
      if (a.eventType === 'product_delete' && p.id && productMap.has(String(p.id))) {
        const id = String(p.id);
        if (!shouldApplyVersionedEntityEvent(productVersionMeta, id, p.version, eventTs)) return;
        if (a.confirmed !== true) {
          const ageMs = Date.now() - Number(eventTs || 0);
          if (Number.isFinite(ageMs) && ageMs > UNCONFIRMED_DELETE_TTL_MS) return;
        }
        const row = productMap.get(id);
        row.ownedByCurrentWallet = isAnchorOwnedByCurrentWallet(a, walletTxidSet);
        row.deleted = true;
        row.deleteSync = { acked: a.confirmed === true ? 1 : 0, total: 1 };
        row.localStatus = 'synced';
        row.localUpdatedAt = Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt;
        return;
      }
      if (a.eventType === 'profile_set') {
        const nextName = String(p.name || '').trim();
        const ownedByCurrentWallet = isAnchorOwnedByCurrentWallet(a, walletTxidSet);
        if (nextName && eventTs >= profileAnyStamp) {
          profileNameAny = nextName;
          profileAnyStamp = eventTs;
        }
        const ownerMerchantId = resolveMerchantIdByOwnership(a, p.merchantId, currentMerchantId, walletTxidSet);
        if (nextName && ownerMerchantId) {
          merchantMap.set(ownerMerchantId, true);
          if (shouldApplyVersionedEntityEvent(profileStampByMerchant, ownerMerchantId, 1, eventTs)) {
            profileNameByMerchant.set(ownerMerchantId, nextName);
          }
        }
        const profileMatchesCurrentWallet = ownedByCurrentWallet
          || (
            sessionMerchantId
            && !isLegacyMerchantId(sessionMerchantId)
            && ownerMerchantId
            && String(ownerMerchantId) === String(sessionMerchantId)
          );
        if (nextName && profileMatchesCurrentWallet && eventTs >= profileCurrentStamp) {
          profileNameFromChain = nextName;
          profileCurrentStamp = eventTs;
          state.profile.localUpdatedAt = Number.isFinite(eventTs) && eventTs > 0 ? new Date(eventTs).toISOString() : modifiedAt;
        }
      }
    });

    categoryMap.forEach((row, id) => {
      const merchantId = String(row?.merchantId || '').trim();
      const inferredMerchantId = String(inferredCategoryMerchantById.get(String(id)) || '').trim();
      if (!inferredMerchantId) return;
      if (merchantId && !isLegacyMerchantId(merchantId) && merchantId !== inferredMerchantId) return;
      row.merchantId = inferredMerchantId;
      merchantMap.set(inferredMerchantId, true);
    });

    categoryMap.forEach((v) => categories.push(v));
    categoryMap.forEach((v) => {
      v.ownedByCurrentWallet = Boolean(v.ownedByCurrentWallet && isCurrentMerchantRow(v.merchantId));
      if (String(v.merchantId || '').trim()) merchantMap.set(String(v.merchantId || '').trim(), true);
    });
    productMap.forEach((v) => {
      v.ownedByCurrentWallet = Boolean(v.ownedByCurrentWallet && isCurrentMerchantRow(v.merchantId));
      if (String(v.merchantId || '').trim()) merchantMap.set(String(v.merchantId || '').trim(), true);
      products.push(v);
    });

    const now = Date.now();
    let merchants = Array.from(merchantMap.keys()).map((id) => {
      const profileName = String(profileNameByMerchant.get(id) || '').trim();
      const previousMerchant = Array.isArray(state.merchants)
        ? state.merchants.find((m) => sameMerchantId(m?.id, id))
        : null;
      const previousName = String(previousMerchant?.name || '').trim();
      const name = merchantDisplayName(
        id,
        profileName || previousName || (id === currentMerchantId ? String(state.profile?.name || '').trim() : ''),
      );
      getOrCreateSellerUser(state, id, name);
      return { id, name, downloadedAt: now };
    });
    if (merchants.length === 1) {
      const only = merchants[0];
      if (only && String(only.name || '') === String(only.id || '') && profileNameAny) {
        only.name = profileNameAny;
        getOrCreateSellerUser(state, only.id, profileNameAny);
      }
    }

    state.categories = categories;
    state.products = products;
    state.merchants = merchants;
    if (profileNameFromChain) {
      state.profile.name = profileNameFromChain;
      state.profile.localStatus = 'synced';
      const buyer = state.users.find((u) => u.id === 'buyer');
      if (buyer) {
        buyer.name = profileNameFromChain;
        buyer.localStatus = 'synced';
        buyer.localUpdatedAt = state.profile.localUpdatedAt || null;
      }
    }
    appendMarketDebug('catalog_rebuild_done', {
      anchors: Array.isArray(state?.pendingAnchors) ? state.pendingAnchors.length : -1,
      merchants: Array.isArray(state.merchants) ? state.merchants.length : -1,
      users: Array.isArray(state.users) ? state.users.length : -1,
      categories: Array.isArray(state.categories) ? state.categories.length : -1,
      products: Array.isArray(state.products) ? state.products.length : -1,
      currentMerchantId,
    });
    if (options.persistSnapshot !== false) persistCatalogSnapshotAsync(state);
  }

  function catalogOwnershipFlagsMissing(state) {
    const categories = Array.isArray(state?.categories) ? state.categories : [];
    const products = Array.isArray(state?.products) ? state.products : [];
    return categories.some((c) => typeof c?.ownedByCurrentWallet !== 'boolean')
      || products.some((p) => typeof p?.ownedByCurrentWallet !== 'boolean');
  }

  return {
    rebuildCatalogFromAnchors,
    catalogOwnershipFlagsMissing,
  };
}

module.exports = {
  createCatalogProjectionService,
};
