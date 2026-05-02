function createCatalogPendingService(deps = {}) {
  const {
    sanitizeMerchantId,
    normalizeEventPayload,
    appendMarketDebug,
    withSchemaMeta,
    defaultState,
    getEffectiveAnchorRows,
  } = deps;

  function applyPendingChangesOnTop(state) {
    const currentMerchantId = sanitizeMerchantId(state.currentMerchantId) || 'm-local';
    const hasPayloadField = (payload, field) => Object.prototype.hasOwnProperty.call(payload || {}, field);
    const queue = Array.isArray(state?.localChanges?.queue) ? state.localChanges.queue : [];
    const overlayStatuses = new Set(['pending', 'queued', 'broadcasted', 'failed']);
    const pending = queue
      .filter((q) => overlayStatuses.has(String(q?.status || '').trim()))
      .slice()
      .sort((a, b) => {
        const ta = Date.parse(String(a?.ts || ''));
        const tb = Date.parse(String(b?.ts || ''));
        if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
        return Number(a?.seq || 0) - Number(b?.seq || 0);
      });

    pending.forEach((item) => {
      const p = normalizeEventPayload(item.eventType, item.payload || {}, String(item.ts || ''));
      if (item.eventType === 'profile_set') {
        const nextName = String(p.name || '').trim();
        if (!nextName) return;
        state.profile.name = nextName;
        state.profile.localStatus = 'modified';
        state.profile.localUpdatedAt = String(p._updatedAt || item.ts || new Date().toISOString());
        const buyer = state.users.find((u) => u.id === 'buyer');
        if (buyer) {
          buyer.name = nextName;
          buyer.localStatus = 'modified';
          buyer.localUpdatedAt = state.profile.localUpdatedAt;
        }
        return;
      }

      if (item.eventType === 'category_add') {
        const id = String(p.id || '');
        if (!id) return;
        const merchantId = sanitizeMerchantId(p.merchantId || currentMerchantId) || currentMerchantId;
        if (merchantId !== currentMerchantId) return;
        const existing = state.categories.find((c) => c.id === id);
        if (existing) {
          existing.name = String(p.name || existing.name || id);
          existing.version = Number(p.version || existing.version || 1);
          existing.deleted = false;
          existing.ownedByCurrentWallet = true;
          existing.localStatus = 'new';
          existing.localUpdatedAt = String(p._updatedAt || item.ts || new Date().toISOString());
        } else {
          state.categories.push({
            id,
            name: String(p.name || id),
            merchantId,
            version: Number(p.version || 1),
            deleted: false,
            ownedByCurrentWallet: true,
            localStatus: 'new',
            localUpdatedAt: String(p._updatedAt || item.ts || new Date().toISOString()),
          });
        }
        return;
      }
      if (item.eventType === 'category_edit') {
        const id = String(p.id || '');
        const row = state.categories.find((c) => c.id === id);
        if (!row) return;
        const rowMerchantId = sanitizeMerchantId(row.merchantId || p.merchantId || currentMerchantId) || currentMerchantId;
        if (rowMerchantId !== currentMerchantId) return;
        row.name = String(p.name || row.name || id);
        row.version = Number(p.version || row.version || 1);
        row.deleted = false;
        row.localStatus = row.localStatus === 'new' ? 'new' : 'modified';
        row.localUpdatedAt = String(p._updatedAt || item.ts || new Date().toISOString());
        return;
      }
      if (item.eventType === 'category_delete') {
        const id = String(p.id || '');
        if (!id) return;
        const row = state.categories.find((c) => c.id === id);
        if (!row) return;
        const rowMerchantId = sanitizeMerchantId(row.merchantId || p.merchantId || currentMerchantId) || currentMerchantId;
        if (rowMerchantId !== currentMerchantId) return;
        row.version = Number(p.version || row.version || 1);
        row.deleted = true;
        row.localStatus = row.localStatus === 'new' ? 'new' : 'modified';
        row.localUpdatedAt = String(p._updatedAt || item.ts || new Date().toISOString());
        return;
      }

      if (item.eventType === 'product_add') {
        const id = String(p.id || '');
        if (!id) return;
        const merchantId = sanitizeMerchantId(p.merchantId || currentMerchantId) || currentMerchantId;
        if (merchantId !== currentMerchantId) return;
        const existing = state.products.find((x) => x.id === id);
        const next = {
          id,
          merchantId,
          ownedByCurrentWallet: true,
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
          localStatus: 'new',
          localUpdatedAt: String(p._updatedAt || item.ts || new Date().toISOString()),
        };
        if (existing) Object.assign(existing, next);
        else state.products.push(next);
        return;
      }
      if (item.eventType === 'product_edit' || item.eventType === 'product_bump') {
        const id = String(p.id || '');
        const row = state.products.find((x) => x.id === id);
        if (!row) return;
        const rowMerchantId = sanitizeMerchantId(row.merchantId || p.merchantId || currentMerchantId) || currentMerchantId;
        const payloadMerchantId = p.merchantId ? (sanitizeMerchantId(p.merchantId) || rowMerchantId) : rowMerchantId;
        if (rowMerchantId !== currentMerchantId || payloadMerchantId !== currentMerchantId) return;
        row.merchantId = currentMerchantId;
        row.ownedByCurrentWallet = true;
        if (hasPayloadField(p, 'categoryId')) row.categoryId = String(p.categoryId || '');
        if (hasPayloadField(p, 'title')) row.title = String(p.title ?? row.title ?? id);
        if (hasPayloadField(p, 'price')) row.price = Number(p.price ?? row.price);
        if (hasPayloadField(p, 'stock')) row.stock = Number(p.stock ?? row.stock);
        if (hasPayloadField(p, 'soldCount')) row.soldCount = Number(p.soldCount ?? row.soldCount ?? 0);
        if (hasPayloadField(p, 'imageUrl')) row.imageUrl = String(p.imageUrl || '');
        if (hasPayloadField(p, 'description')) row.description = String(p.description || '');
        row.version = Number(p.version || row.version + 1);
        row.deleted = false;
        row.localStatus = row.localStatus === 'new' ? 'new' : 'modified';
        row.localUpdatedAt = String(p._updatedAt || item.ts || new Date().toISOString());
        return;
      }
      if (item.eventType === 'product_delete') {
        const id = String(p.id || '');
        const row = state.products.find((x) => x.id === id);
        if (!row) return;
        const rowMerchantId = sanitizeMerchantId(row.merchantId || p.merchantId || currentMerchantId) || currentMerchantId;
        if (rowMerchantId !== currentMerchantId) return;
        row.ownedByCurrentWallet = true;
        row.deleted = true;
        row.deleteSync = { acked: 0, total: 1 };
        row.localStatus = row.localStatus === 'new' ? 'new' : 'modified';
        row.localUpdatedAt = String(p._updatedAt || item.ts || new Date().toISOString());
      }
    });
  }

  function mergeQueuedChange(prev, next) {
    const prevEvent = String(prev?.eventType || '');
    const nextEvent = String(next?.eventType || '');
    const prevAdd = prevEvent.endsWith('_add');
    const nextDelete = nextEvent.endsWith('_delete');
    const prevDelete = prevEvent.endsWith('_delete');

    if (nextDelete && prevAdd) return null;
    if (prevAdd && !nextDelete) {
      return {
        eventType: prevEvent,
        payload: { ...(prev.payload || {}), ...(next.payload || {}) },
      };
    }
    if (prevDelete && !nextDelete) {
      return {
        eventType: nextEvent,
        payload: { ...(next.payload || {}) },
      };
    }
    return {
      eventType: nextEvent,
      payload: { ...(next.payload || {}) },
    };
  }

  function payloadHasOwn(payload, key) {
    return Object.prototype.hasOwnProperty.call(payload || {}, key);
  }

  function comparableProductValue(field, value) {
    if (field === 'price' || field === 'stock' || field === 'soldCount' || field === 'version') {
      const n = Number(value || 0);
      return Number.isFinite(n) ? n : 0;
    }
    return String(value ?? '').trim();
  }

  function mergeProductPayload(base, payload, eventType) {
    if (!payload || typeof payload !== 'object') return base;
    if (eventType === 'product_add') {
      return {
        id: String(payload.id || ''),
        merchantId: String(payload.merchantId || ''),
        categoryId: String(payload.categoryId || ''),
        title: String(payload.title || payload.id || ''),
        price: Number(payload.price || 0),
        stock: Number(payload.stock || 0),
        soldCount: Number(payload.soldCount || 0),
        imageUrl: String(payload.imageUrl || ''),
        description: String(payload.description || ''),
        version: Number(payload.version || 1),
      };
    }
    const next = base ? { ...base } : {
      id: String(payload.id || ''),
      merchantId: String(payload.merchantId || ''),
      categoryId: '',
      title: String(payload.id || ''),
      price: 0,
      stock: 0,
      soldCount: 0,
      imageUrl: '',
      description: '',
      version: 1,
    };
    ['merchantId', 'categoryId', 'title', 'imageUrl', 'description'].forEach((field) => {
      if (payloadHasOwn(payload, field)) next[field] = String(payload[field] ?? '');
    });
    ['price', 'stock', 'soldCount', 'version'].forEach((field) => {
      if (payloadHasOwn(payload, field)) next[field] = Number(payload[field] || 0);
    });
    return next;
  }

  function productBaselineFromAnchors(state, productId, fallbackProduct) {
    const id = String(productId || '').trim();
    if (!id || typeof getEffectiveAnchorRows !== 'function') return { ...fallbackProduct };
    const rows = getEffectiveAnchorRows(state)
      .filter((row) => ['product_add', 'product_edit', 'product_bump', 'product_delete'].includes(String(row?.eventType || '')))
      .map((row) => ({
        ...row,
        payload: normalizeEventPayload(row.eventType, row.payload || {}, String(row?.ts || '')),
      }))
      .filter((row) => String(row?.payload?.id || '').trim() === id)
      .sort((a, b) => {
        const ta = Date.parse(String(a?.payload?._updatedAt || a?.ts || '')) || 0;
        const tb = Date.parse(String(b?.payload?._updatedAt || b?.ts || '')) || 0;
        if (ta !== tb) return ta - tb;
        return String(a?.txid || '').localeCompare(String(b?.txid || ''));
      });
    let baseline = null;
    rows.forEach((row) => {
      if (row.eventType === 'product_delete') {
        if (baseline) baseline.deleted = true;
        return;
      }
      baseline = mergeProductPayload(baseline, row.payload, row.eventType);
    });
    return baseline || { ...fallbackProduct };
  }

  function sparseProductEditPayload(state, product) {
    const baseline = productBaselineFromAnchors(state, product?.id, product);
    const payload = {
      id: String(product?.id || ''),
      merchantId: String(product?.merchantId || ''),
      version: Number(product?.version || 1),
    };
    ['categoryId', 'title', 'price', 'stock', 'soldCount', 'imageUrl', 'description'].forEach((field) => {
      if (comparableProductValue(field, baseline?.[field]) !== comparableProductValue(field, product?.[field])) {
        payload[field] = product[field];
      }
    });
    return payload;
  }

  function compactQueuedProductEdits(state, currentMerchantId) {
    const queue = Array.isArray(state?.localChanges?.queue) ? state.localChanges.queue : [];
    let compacted = 0;
    queue.forEach((item) => {
      if (!['pending', 'queued'].includes(String(item?.status || '').trim())) return;
      if (String(item?.eventType || '') !== 'product_edit') return;
      const id = String(item?.targetId || item?.payload?.id || '').trim();
      if (!id) return;
      const product = (state.products || []).find((p) => String(p?.id || '') === id);
      if (!product) return;
      const merchantId = sanitizeMerchantId(product.merchantId || item?.payload?.merchantId || '');
      if (merchantId !== currentMerchantId) return;
      const sparse = sparseProductEditPayload(state, product);
      const changedKeys = Object.keys(sparse).filter((key) => !['id', 'merchantId', 'version'].includes(key));
      if (!changedKeys.length) {
        item.status = 'discarded';
        product.localStatus = 'synced';
        compacted += 1;
        return;
      }
      const nextPayload = withSchemaMeta(item.eventType, sparse, String(item?.payload?._updatedAt || item.ts || new Date().toISOString()));
      const beforeKeys = Object.keys(item.payload || {}).sort().join(',');
      const afterKeys = Object.keys(nextPayload || {}).sort().join(',');
      if (beforeKeys !== afterKeys || JSON.stringify(item.payload || {}) !== JSON.stringify(nextPayload || {})) {
        item.payload = nextPayload;
        compacted += 1;
      }
    });
    if (compacted > 0) {
      appendMarketDebug('product_edit_queue_compacted', { compacted });
    }
  }

  function queueLocalChange(state, eventType, payload, targetType = '', targetId = '') {
    if (!state.localChanges || typeof state.localChanges !== 'object') {
      state.localChanges = { seq: 1, queue: [] };
    }
    const now = new Date().toISOString();
    const nextPayload = withSchemaMeta(eventType, payload || {}, now);
    const queue = Array.isArray(state.localChanges.queue) ? state.localChanges.queue : [];
    const beforeSize = queue.length;
    const lastPendingIndex = (() => {
      for (let i = queue.length - 1; i >= 0; i -= 1) {
        const q = queue[i];
        if (q?.status !== 'pending') continue;
        if (String(q?.targetType || '') !== String(targetType || '')) continue;
        if (String(q?.targetId || '') !== String(targetId || '')) continue;
        return i;
      }
      return -1;
    })();
    if (lastPendingIndex >= 0) {
      const prev = queue[lastPendingIndex];
      const merged = mergeQueuedChange(prev, { eventType, payload: nextPayload, targetType, targetId });
      if (merged === null) {
        queue.splice(lastPendingIndex, 1);
        appendMarketDebug('queue_merge_drop', {
          eventType,
          targetType,
          targetId,
          beforeSize,
          afterSize: queue.length,
        });
        return null;
      }
      prev.eventType = merged.eventType;
      prev.payload = withSchemaMeta(merged.eventType, merged.payload || {}, now);
      prev.ts = now;
      prev.status = 'pending';
      delete prev.txid;
      delete prev.anchoredAt;
      delete prev.failedAt;
      prev.attempts = 0;
      appendMarketDebug('queue_merge_update', {
        eventType: prev.eventType,
        targetType,
        targetId,
        beforeSize,
        afterSize: queue.length,
        changeId: prev.id,
      });
      return prev;
    }
    const seq = Math.max(1, Number(state.localChanges.seq || 1));
    const row = {
      id: `chg-${String(seq).padStart(6, '0')}`,
      seq,
      ts: now,
      eventType,
      payload: nextPayload,
      targetType,
      targetId,
      status: 'pending',
    };
    state.localChanges.seq = seq + 1;
    state.localChanges.queue.push(row);
    appendMarketDebug('queue_push', {
      eventType,
      targetType,
      targetId,
      beforeSize,
      afterSize: state.localChanges.queue.length,
      changeId: row.id,
    });
    return row;
  }

  function rebuildPendingQueueFromLocalState(state) {
    if (!state.localChanges || typeof state.localChanges !== 'object') {
      state.localChanges = { seq: 1, queue: [] };
    }
    if (!Array.isArray(state.localChanges.queue)) state.localChanges.queue = [];
    const queue = state.localChanges.queue;
    const beforeSize = queue.length;
    let recovered = 0;
    const currentMerchantId = sanitizeMerchantId(state.currentMerchantId) || 'm-local';
    compactQueuedProductEdits(state, currentMerchantId);
    // "anchored" only means this node once believed the change was published.
    // If the entity is still locally marked as new/modified, that anchored entry
    // is stale and must not block queue regeneration, otherwise the UI gets
    // stuck in a state where local changes exist but pendingUploads stays 0.
    const hasPending = (targetType, targetId) =>
      queue.some((q) => ['pending', 'queued', 'broadcasted'].includes(String(q?.status || ''))
        && String(q?.targetType || '') === String(targetType || '')
        && String(q?.targetId || '') === String(targetId || ''));
    const hasPublishedAnchor = (eventType, targetId) => {
      if (typeof getEffectiveAnchorRows !== 'function') return false;
      const safeEventType = String(eventType || '').trim();
      const safeTargetId = String(targetId || '').trim();
      if (!safeEventType || !safeTargetId) return false;
      return getEffectiveAnchorRows(state).some((row) => {
        if (String(row?.eventType || '').trim() !== safeEventType) return false;
        if (String(row?.entityId || '').trim() === safeTargetId) return true;
        const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
        return String(payload.id || '').trim() === safeTargetId;
      });
    };

    const profileName = String(state.profile?.name || '').trim();
    queue.forEach((item) => {
      if (String(item?.eventType || '') !== 'profile_set') return;
      if (String(item?.targetType || '') !== 'profile') return;
      if (String(item?.targetId || '') !== 'buyer') return;
      if (!item.payload || typeof item.payload !== 'object') item.payload = {};
      if (!String(item.payload.name || '').trim() && profileName) item.payload.name = profileName;
      if (!sanitizeMerchantId(item.payload.merchantId || '') && currentMerchantId !== 'm-local') {
        item.payload.merchantId = currentMerchantId;
      }
    });

    (state.categories || []).forEach((c) => {
      const id = String(c?.id || '');
      if (!id) return;
      const categoryMerchantId = sanitizeMerchantId(c?.merchantId || '');
      if (categoryMerchantId && categoryMerchantId !== currentMerchantId) {
        c.ownedByCurrentWallet = false;
        if (String(c?.localStatus || '').trim() !== 'synced') c.localStatus = 'synced';
        return;
      }
      const status = String(c?.localStatus || '').trim() || 'modified';
      if (status === 'synced' || hasPending('category', id)) return;
      const deleted = Boolean(c?.deleted);
      const eventType = deleted ? 'category_delete' : (status === 'new' ? 'category_add' : 'category_edit');
      if (hasPublishedAnchor(eventType, id)) {
        c.localStatus = 'synced';
        recovered += 1;
        return;
      }
      const ch = queueLocalChange(state, eventType, {
        id,
        name: String(c?.name || id),
        merchantId: String(c?.merchantId || state.currentMerchantId || 'm-local'),
        version: Number(c?.version || 1),
      }, 'category', id);
      if (ch && c?.localUpdatedAt) ch.ts = String(c.localUpdatedAt);
      if (ch) recovered += 1;
    });

    (state.products || []).forEach((p) => {
      const id = String(p?.id || '');
      if (!id) return;
      const productMerchantId = sanitizeMerchantId(p?.merchantId || '');
      if (productMerchantId && productMerchantId !== currentMerchantId) {
        p.ownedByCurrentWallet = false;
        if (String(p?.localStatus || '').trim() !== 'synced') p.localStatus = 'synced';
        return;
      }
      const status = String(p?.localStatus || '').trim() || 'modified';
      if (status === 'synced' || hasPending('product', id)) return;
      const deleted = Boolean(p?.deleted);
      const eventType = deleted ? 'product_delete' : (status === 'new' ? 'product_add' : 'product_edit');
      if (hasPublishedAnchor(eventType, id)) {
        p.localStatus = 'synced';
        recovered += 1;
        return;
      }
      const payload = deleted
        ? { id }
        : eventType === 'product_edit'
          ? sparseProductEditPayload(state, p)
        : {
            id,
            merchantId: String(p?.merchantId || 'm-local'),
            categoryId: String(p?.categoryId || ''),
            title: String(p?.title || id),
            price: Number(p?.price || 0),
            stock: Number(p?.stock || 0),
            version: Number(p?.version || 1),
          };
      if (eventType === 'product_edit' && Object.keys(payload).every((key) => ['id', 'merchantId', 'version'].includes(key))) {
        p.localStatus = 'synced';
        recovered += 1;
        return;
      }
      const ch = queueLocalChange(state, eventType, payload, 'product', id);
      if (ch && p?.localUpdatedAt) ch.ts = String(p.localUpdatedAt);
      if (ch) recovered += 1;
    });
    if (recovered > 0 || queue.length !== beforeSize) {
      appendMarketDebug('queue_rebuild_from_local', {
        beforeSize,
        afterSize: queue.length,
        recovered,
        pending: queue.filter((q) => q?.status === 'pending').length,
      });
    }
  }

  return {
    applyPendingChangesOnTop,
    mergeQueuedChange,
    queueLocalChange,
    rebuildPendingQueueFromLocalState,
  };
}

module.exports = {
  createCatalogPendingService,
};
