function registerCatalogRoutes(app, deps = {}) {
  const PRODUCT_IMAGE_CHAIN_MAX_CHARS = 60000;
  const {
    walletAuthRequired,
    ok,
    fail,
    buildProjectionBackedState,
    buildProjectionStateFromSqlite,
    ensureCurrentMerchantId,
    queueLocalChange,
    appendMarketDebug,
    commitCatalogState,
    commitLocalState,
    commitRuntimeProjectionState,
    syncDomain,
    defaultSyncState,
    beginSyncUiTiming,
    enqueueCommand,
    loadJobState,
    notifyStewardSyncNow,
    FIXED_SYNC_BOOTSTRAP_HEIGHT,
    getLastManualCatalogResyncAtMs,
    setLastManualCatalogResyncAtMs,
    syncSessionEpochRef,
    bumpSyncSessionEpoch,
    notifyStewardSyncEpoch,
    stopActiveSyncServices,
    interruptQueuedCommands,
    isResyncManagedCommandType,
    waitForResyncCommandsToDrain,
    clearRuntimeSyncProgress,
    clearLocalCatalogArtifactsWithRetry,
    buildFreshMarketStateForBootstrap,
    withTransientResetRetries,
    writeStateJsonSnapshot,
    persistSyncStateNow,
    buildLocalStateSnapshotPayload,
    resetSyncArtifactsForBootstrap,
    rebuildPublicStateCache,
    invalidateStateLiteSnapshotCache,
    setRuntimeSyncProgress,
    performCatalogResyncReset,
    marketDb,
    catalogDomain,
    profileDomain,
    localStateDomain,
    orderDomain,
    walletReadDomain,
    walletTxDomain,
    wallet,
    getEffectiveAnchorRows,
    normalizeEventPayload,
  } = deps;

  function loadWritableProjectionState(req) {
    if (typeof buildProjectionStateFromSqlite === 'function') {
      return buildProjectionStateFromSqlite(req);
    }
    return buildProjectionBackedState(req);
  }

  function normalizeCatalogCategoryName(name) {
    return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function normalizeProductImageUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    if (/^https?:\/\//i.test(value)) return value;
    if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,[a-z0-9+/=]+$/i.test(value)) {
      throw new Error('Invalid product image format');
    }
    if (value.length > PRODUCT_IMAGE_CHAIN_MAX_CHARS) {
      throw new Error('Product image is too large');
    }
    return value;
  }

  function payloadHasOwn(payload, key) {
    return Object.prototype.hasOwnProperty.call(payload || {}, key);
  }

  function normalizeComparableProductValue(field, value) {
    if (field === 'price' || field === 'stock' || field === 'soldCount' || field === 'version') {
      const n = Number(value || 0);
      return Number.isFinite(n) ? n : 0;
    }
    return String(value ?? '').trim();
  }

  function mergeProductPayloadIntoBaseline(baseline, payload, eventType) {
    if (!payload || typeof payload !== 'object') return baseline;
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
    const next = baseline ? { ...baseline } : {
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

  function buildProductChainBaseline(state, productId, fallbackProduct) {
    const id = String(productId || '').trim();
    if (!id || typeof getEffectiveAnchorRows !== 'function') return { ...fallbackProduct };
    const rows = getEffectiveAnchorRows(state)
      .filter((row) => ['product_add', 'product_edit', 'product_bump', 'product_delete'].includes(String(row?.eventType || '')))
      .map((row) => {
        const fallbackTs = String(row?.ts || '');
        const payload = typeof normalizeEventPayload === 'function'
          ? normalizeEventPayload(row.eventType, row.payload || {}, fallbackTs)
          : (row.payload || {});
        return { ...row, payload };
      })
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
      baseline = mergeProductPayloadIntoBaseline(baseline, row.payload, row.eventType);
    });
    return baseline || { ...fallbackProduct };
  }

  function buildSparseProductEditPayload(chainBaseline, nextProduct) {
    const payload = {
      id: String(nextProduct.id || ''),
      merchantId: String(nextProduct.merchantId || ''),
      version: Number(nextProduct.version || 1),
    };
    ['categoryId', 'title', 'price', 'stock', 'soldCount', 'imageUrl', 'description'].forEach((field) => {
      const beforeValue = normalizeComparableProductValue(field, chainBaseline?.[field]);
      const nextValue = normalizeComparableProductValue(field, nextProduct?.[field]);
      if (beforeValue !== nextValue) payload[field] = nextProduct[field];
    });
    return payload;
  }

  function merchantCategoryNameExists(state, merchantId, name, excludeId = '') {
    const wanted = normalizeCatalogCategoryName(name);
    const safeMerchantId = String(merchantId || '').trim();
    const safeExcludeId = String(excludeId || '').trim();
    if (!wanted || !safeMerchantId) return false;
    return (Array.isArray(state?.categories) ? state.categories : []).some((row) => {
      if (!row || typeof row !== 'object') return false;
      if (row.deleted === true) return false;
      if (String(row.id || '').trim() === safeExcludeId) return false;
      if (String(row.merchantId || '').trim() !== safeMerchantId) return false;
      return normalizeCatalogCategoryName(row.name) === wanted;
    });
  }

  function resolveCategoryFromStateOrPending(state, categoryId, currentMerchantId) {
    const wantedId = String(categoryId || '').trim();
    const wantedMerchantId = String(currentMerchantId || '').trim();
    if (!wantedId) return null;
    const direct = (Array.isArray(state?.categories) ? state.categories : []).find((c) => (
      String(c?.id || '').trim() === wantedId
      && c?.deleted !== true
    ));
    if (direct) return direct;
    const queue = Array.isArray(state?.localChanges?.queue) ? state.localChanges.queue : [];
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      const row = queue[i];
      if (String(row?.targetType || '') !== 'category') continue;
      if (String(row?.targetId || '').trim() !== wantedId) continue;
      const eventType = String(row?.eventType || '');
      const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
      if (eventType === 'category_delete') return null;
      if (eventType === 'category_add' || eventType === 'category_edit') {
        const merchantId = String(payload.merchantId || wantedMerchantId).trim();
        return {
          id: wantedId,
          name: String(payload.name || wantedId),
          merchantId,
          deleted: false,
          ownedByCurrentWallet: merchantId === wantedMerchantId,
        };
      }
    }
    return null;
  }

  function isCurrentMerchantCatalogOwner(row, currentMerchantId) {
    if (!row || typeof row !== 'object') return false;
    if (row.ownedByCurrentWallet === true) return true;
    return String(row.merchantId || '').trim() === String(currentMerchantId || '').trim();
  }

  async function persistCatalogProjectionNow(state, reason = 'catalog_route') {
    await catalogDomain.emitCatalogSnapshot({
      categories: Array.isArray(state?.categories) ? state.categories : [],
      products: Array.isArray(state?.products) ? state.products : [],
    }, {
      producer: `catalog_routes.${String(reason || 'catalog_route')}`,
    });
    commitRuntimeProjectionState?.(state, {
      reason: `catalog_routes.${String(reason || 'catalog_route')}`,
      hydrated: true,
    });
  }

  async function persistLocalProjectionNow(state, reason = 'catalog_route') {
    await localStateDomain.applyLocalStateSnapshot(buildLocalStateSnapshotPayload(state), {
      source: `catalog_routes.${String(reason || 'catalog_route')}`,
      seq: 0,
    });
    await writeStateJsonSnapshot(state, {
      reason: `catalog_routes.${String(reason || 'catalog_route')}`,
    });
    if (typeof invalidateStateLiteSnapshotCache === 'function') {
      invalidateStateLiteSnapshotCache(`catalog_routes.${String(reason || 'catalog_route')}`);
    }
  }

  app.post('/api/catalog/resync', walletAuthRequired, async (req, res) => {
    const requestedBootstrap = Math.floor(Number(req.body?.bootstrapHeight));
    const bootstrapHeight = Number.isFinite(requestedBootstrap) ? requestedBootstrap : NaN;
    if (!Number.isFinite(bootstrapHeight)) return fail(res, 'bootstrapHeight is required');
    if (bootstrapHeight < FIXED_SYNC_BOOTSTRAP_HEIGHT) {
      return fail(res, `bootstrapHeight must be >= ${FIXED_SYNC_BOOTSTRAP_HEIGHT}`);
    }
    if (req.body?.confirmReset !== true) {
      return fail(res, 'confirmReset is required');
    }
    const nowMs = Date.now();
    const minIntervalMs = 2000;
    const lastManualCatalogResyncAtMs = Number(getLastManualCatalogResyncAtMs?.() || 0);
    const elapsedSinceLastManualResyncMs = nowMs - Math.max(0, lastManualCatalogResyncAtMs);
    if (lastManualCatalogResyncAtMs > 0 && elapsedSinceLastManualResyncMs < minIntervalMs) {
      const waitMs = Math.max(0, minIntervalMs - elapsedSinceLastManualResyncMs);
      appendMarketDebug('catalog_resync_throttled', {
        waitMs,
        requestedBootstrap: bootstrapHeight,
        currentEpoch: Number(syncSessionEpochRef?.() || 0),
      });
      return fail(res, `Please wait ${Math.ceil(waitMs / 1000)}s before starting sync again`);
    }
    setLastManualCatalogResyncAtMs?.(nowMs);
    const previous = loadWritableProjectionState(req);
    const queueBeforeReset = deps.loadCommandQueueState({ fresh: true });
    const commandsBeforeReset = Array.isArray(queueBeforeReset?.commands) ? queueBeforeReset.commands : [];
    const jobBeforeReset = loadJobState({ fresh: true })?.currentJob || null;
    const hadActiveSyncBeforeReset = commandsBeforeReset.some((row) => (
      isResyncManagedCommandType(row?.commandType)
      && ['pending', 'claimed'].includes(String(row?.status || ''))
    )) || (
      isResyncManagedCommandType(jobBeforeReset?.jobType)
      && ['running', 'claimed', 'pending'].includes(String(jobBeforeReset?.status || 'running'))
    );
    const resetEpoch = bumpSyncSessionEpoch('manual_catalog_resync', {
      bootstrapHeight,
      pendingLocalChanges: Array.isArray(previous?.localChanges?.queue) ? previous.localChanges.queue.length : 0,
      anchorsBefore: Array.isArray(previous?.anchors) ? previous.anchors.length : 0,
      productsBefore: Array.isArray(previous?.products) ? previous.products.length : 0,
    });
    notifyStewardSyncEpoch(resetEpoch);
    const stoppedServices = await stopActiveSyncServices(`manual catalog resync epoch ${resetEpoch}`);
    const interruptedCount = await interruptQueuedCommands((row) => isResyncManagedCommandType(row?.commandType), {
      reason: `superseded by manual catalog resync epoch ${resetEpoch}`,
    });
    const drainStartedAtMs = Date.now();
    const drainResult = await waitForResyncCommandsToDrain({
      resetEpoch,
      timeoutMs: 20000,
      pollMs: 200,
      reason: `manual catalog resync epoch ${resetEpoch}`,
    });
    appendMarketDebug('catalog_resync_interrupted_existing_sync', {
      resetEpoch,
      bootstrapHeight,
      hadActiveSyncBeforeReset,
      interruptedCount,
      stoppedServiceCancelled: Boolean(stoppedServices?.serviceCancelled),
      stoppedRuntimeCancelled: Boolean(stoppedServices?.runtimeCancelled),
      drainWaitMs: Math.max(0, Date.now() - drainStartedAtMs),
      currentJobId: String(drainResult?.currentJobId || ''),
      currentJobType: String(drainResult?.currentJobType || ''),
      currentJobStatus: String(drainResult?.currentJobStatus || ''),
      pendingCount: Number(drainResult?.pendingCount || 0),
      claimedCount: Number(drainResult?.claimedCount || 0),
      serviceActive: Boolean(drainResult?.serviceActive),
      runtimeActive: Boolean(drainResult?.runtimeActive),
    });
    const getWalletKey = () => {
      try {
        return wallet.walletExists() ? String(wallet.getReceiveAddress() || '').trim() : '';
      } catch (_) {
        return '';
      }
    };
    const { fresh, command } = await performCatalogResyncReset({
      req,
      bootstrapHeight,
      resetEpoch,
      previousState: previous,
      clearRuntimeSyncProgress,
      clearLocalCatalogArtifactsWithRetry,
      buildFreshMarketStateForBootstrap,
      withTransientResetRetries,
      writeStateJsonSnapshot,
      persistSyncStateNow,
      resetSyncArtifacts: resetSyncArtifactsForBootstrap,
      rebuildPublicStateCache,
      beginSyncUiTiming,
      setRuntimeSyncProgress,
      appendMarketDebug,
      enqueueCommand,
      notifyStewardSyncEpoch,
      notifyStewardSyncNow,
      scheduleSyncNow: deps.scheduleStewardSyncNow,
      resetAnchorEvents: () => marketDb.clearAnchorEvents(),
      resetCatalogSnapshot: () => catalogDomain.resetCatalogSnapshot(),
      resetProfileSnapshot: (profileKey) => profileDomain.resetProfileSnapshot(profileKey),
      resetLocalState: (scope) => localStateDomain.resetLocalState(scope),
      resetOrdersProjection: () => orderDomain.resetOrdersProjection(),
      resetWalletState: (walletKey) => walletReadDomain.resetWalletState(walletKey),
      resetWalletTxProjection: () => walletTxDomain.resetWalletTxProjection(),
      getWalletKey,
    });
    return ok(res, fresh, req, {
      queuedSync: true,
      commandId: command.id,
      commandType: command.commandType,
      resetEpoch,
      bootstrapHeight,
      interruptedExistingSync: hadActiveSyncBeforeReset,
      interruptedCount,
      drainWaitMs: Math.max(0, Date.now() - drainStartedAtMs),
      warning: 'local catalog data cleared before resync',
    });
  });

  app.post('/api/catalog/sync', async (req, res) => {
    const state = buildProjectionBackedState(req);
    if (state?.steward?.catalogSyncEnabled === false) {
      return fail(res, 'Catalog sync is disabled in personal settings', 403, 'catalog_sync_disabled');
    }
    const syncStatus = syncDomain.getSyncStatus({ confirm: true }) || {};
    const syncSnapshot = syncStatus?.sync && typeof syncStatus.sync === 'object'
      ? syncStatus.sync
      : defaultSyncState();
    beginSyncUiTiming('catalog_sync_api', {
      bootstrapHeight: Number(syncSnapshot?.bootstrapHeight || FIXED_SYNC_BOOTSTRAP_HEIGHT),
      initialLocalHeight: Number(syncSnapshot?.localHeight || 0),
      initialNetworkHeight: Number(syncSnapshot?.targetHeight || syncSnapshot?.p2pTipHeight || 0),
      syncEpoch: syncSessionEpochRef?.(),
    });
    const command = await enqueueCommand('run_chain_sync', {
      source: 'api_catalog_sync',
      options: {},
    });
    notifyStewardSyncNow();
    return res.json({
      success: true,
      queuedSync: true,
      commandId: command.id,
      jobState: loadJobState(),
      sync: {
        bootstrapHeight: Number(syncSnapshot?.bootstrapHeight || FIXED_SYNC_BOOTSTRAP_HEIGHT),
        localHeight: Number(syncSnapshot?.localHeight || 0),
        networkHeight: Number(syncSnapshot?.networkHeight || syncSnapshot?.targetHeight || syncSnapshot?.p2pTipHeight || 0),
      },
    });
  });

  app.post('/api/catalog/category', async (req, res) => {
    const state = loadWritableProjectionState(req);
    const currentMerchantId = ensureCurrentMerchantId(state, req);
    const action = String(req.body?.action || '');

    if (action === 'add') {
      const name = String(req.body?.name || '').trim();
      if (!name) return fail(res, 'Name is required');
      if (merchantCategoryNameExists(state, currentMerchantId, name)) return fail(res, 'Category name already exists');
      const nowIso = new Date().toISOString();
      const id = `c-${String(Date.now()).slice(-6)}`;
      state.categories.push({
        id,
        name,
        merchantId: currentMerchantId,
        ownedByCurrentWallet: true,
        version: 1,
        deleted: false,
        localStatus: 'new',
        localUpdatedAt: nowIso,
      });
      queueLocalChange(state, 'category_add', { id, name, merchantId: currentMerchantId, version: 1 }, 'category', id);
      appendMarketDebug('category_add_local', { id, name, merchantId: currentMerchantId });
      await persistCatalogProjectionNow(state, 'category_add');
      await persistLocalProjectionNow(state, 'category_add');
      return ok(res, state, req, { id });
    }

    if (action === 'edit') {
      const id = String(req.body?.id || '');
      const name = String(req.body?.name || '').trim();
      const category = state.categories.find((c) => c.id === id);
      if (!category) return fail(res, 'Category not found', 404);
      if (!isCurrentMerchantCatalogOwner(category, currentMerchantId)) return fail(res, 'Cannot modify other merchant category', 403);
      if (!name) return fail(res, 'Name is required');
      if (merchantCategoryNameExists(state, currentMerchantId, name, id)) return fail(res, 'Category name already exists');
      const nowIso = new Date().toISOString();
      category.name = name;
      category.version = Math.max(1, Number(category.version || 1) + 1);
      category.deleted = false;
      category.localStatus = category.localStatus === 'new' ? 'new' : 'modified';
      category.localUpdatedAt = nowIso;
      queueLocalChange(state, 'category_edit', {
        id,
        name,
        merchantId: String(category.merchantId || currentMerchantId),
        version: Number(category.version || 1),
      }, 'category', id);
      appendMarketDebug('category_edit_local', { id, name, localStatus: category.localStatus, version: category.version });
      await persistCatalogProjectionNow(state, 'category_edit');
      await persistLocalProjectionNow(state, 'category_edit');
      return ok(res, state, req);
    }

    if (action === 'delete') {
      const id = String(req.body?.id || '');
      const category = state.categories.find((c) => c.id === id);
      if (!category) return fail(res, 'Category not found', 404);
      if (!isCurrentMerchantCatalogOwner(category, currentMerchantId)) return fail(res, 'Cannot modify other merchant category', 403);
      if (state.products.some((p) => p.categoryId === id && !p.deleted && isCurrentMerchantCatalogOwner(p, currentMerchantId))) return fail(res, 'Category has active products');
      if (String(category.localStatus || '') === 'new') {
        state.categories = state.categories.filter((c) => c.id !== id);
	        queueLocalChange(state, 'category_delete', {
	          id,
	          name: String(category.name || id),
	          merchantId: currentMerchantId,
	          version: Math.max(1, Number(category.version || 1)),
	        }, 'category', id);
        appendMarketDebug('category_delete_local_drop_unsynced', { id, merchantId: currentMerchantId });
        await persistCatalogProjectionNow(state, 'category_delete_drop_unsynced');
        await persistLocalProjectionNow(state, 'category_delete_drop_unsynced');
        return ok(res, state, req);
      }
      const nowIso = new Date().toISOString();
      category.version = Math.max(1, Number(category.version || 1) + 1);
      category.deleted = true;
      category.localStatus = category.localStatus === 'new' ? 'new' : 'modified';
      category.localUpdatedAt = nowIso;
	      queueLocalChange(state, 'category_delete', {
	        id,
	        name: String(category.name || id),
	        merchantId: currentMerchantId,
	        version: Number(category.version || 1),
	      }, 'category', id);
      appendMarketDebug('category_delete_local', { id, merchantId: currentMerchantId, version: category.version });
      await persistCatalogProjectionNow(state, 'category_delete');
      await persistLocalProjectionNow(state, 'category_delete');
      return ok(res, state, req);
    }

    return fail(res, 'Unsupported action');
  });

  app.post('/api/catalog/product', async (req, res) => {
    const state = loadWritableProjectionState(req);
    const currentMerchantId = ensureCurrentMerchantId(state, req);
    const action = String(req.body?.action || '');

    if (action === 'add') {
      const id = `p-${String(Date.now()).slice(-6)}`;
      const title = String(req.body?.title || '').trim();
      const merchantId = currentMerchantId;
      const categoryId = String(req.body?.categoryId || '');
      const price = Number(req.body?.price || 0);
      const stock = Number(req.body?.stock || 0);
      const soldCount = 0;
      let imageUrl = '';
      try {
        imageUrl = normalizeProductImageUrl(req.body?.imageUrl || '');
      } catch (err) {
        return fail(res, err?.message || 'Invalid product image');
      }
      const description = String(req.body?.description || '').trim();
      const nowIso = new Date().toISOString();
      if (!title || !categoryId) return fail(res, 'Title/category are required');
      const category = resolveCategoryFromStateOrPending(state, categoryId, currentMerchantId);
      if (!category) return fail(res, 'Category not found', 404);
      if (String(category.merchantId || '') !== String(currentMerchantId || '')) return fail(res, 'Cannot use other merchant category', 403);
      state.products.push({
        id,
        merchantId,
        categoryId,
        ownedByCurrentWallet: true,
        title,
        price,
        stock,
        soldCount,
        imageUrl,
        description,
        version: 1,
        deleted: false,
        deleteSync: { acked: state.sync.nodePool.length, total: state.sync.nodePool.length },
        localStatus: 'new',
        localUpdatedAt: nowIso,
      });
      queueLocalChange(state, 'product_add', { id, merchantId, title, categoryId, price, stock, soldCount, imageUrl, description, version: 1 }, 'product', id);
      appendMarketDebug('product_add_local', { id, categoryId, title, stock, soldCount });
      await persistCatalogProjectionNow(state, 'product_add');
      await persistLocalProjectionNow(state, 'product_add');
      return ok(res, state, req, { id });
    }

    const id = String(req.body?.id || '');
    const product = state.products.find((p) => p.id === id);
    if (!product) return fail(res, 'Product not found', 404);
    if (!isCurrentMerchantCatalogOwner(product, currentMerchantId)) return fail(res, 'Cannot modify other merchant product', 403);

    if (action === 'edit') {
      const title = String(req.body?.title || '').trim();
      const categoryIdRaw = String(req.body?.categoryId || '').trim();
      const price = Number(req.body?.price || 0);
      const stock = Number(req.body?.stock || 0);
      const soldCount = Math.max(0, Number(product.soldCount || 0));
      let imageUrl = '';
      try {
        imageUrl = normalizeProductImageUrl(req.body?.imageUrl ?? (product.imageUrl || ''));
      } catch (err) {
        return fail(res, err?.message || 'Invalid product image');
      }
      const description = String(req.body?.description ?? (product.description || '')).trim();
      if (!title) return fail(res, 'Title is required');
      let nextCategoryId = String(product.categoryId || '');
      if (categoryIdRaw) {
        const category = resolveCategoryFromStateOrPending(state, categoryIdRaw, currentMerchantId);
        if (!category) return fail(res, 'Category not found', 404);
        if (!isCurrentMerchantCatalogOwner(category, currentMerchantId)) return fail(res, 'Cannot use other merchant category', 403);
        nextCategoryId = categoryIdRaw;
      }
      const nowIso = new Date().toISOString();
      const chainBaseline = buildProductChainBaseline(state, id, product);
      const nextVersion = Number(product.version || 1) + 1;
      const nextProduct = {
        ...product,
        categoryId: nextCategoryId,
        title,
        price,
        stock,
        soldCount,
        imageUrl,
        description,
        version: nextVersion,
      };
      const editPayload = buildSparseProductEditPayload(chainBaseline, nextProduct);
      const changedFieldCount = Object.keys(editPayload).filter((key) => !['id', 'merchantId', 'version'].includes(key)).length;
      if (changedFieldCount <= 0) {
        appendMarketDebug('product_edit_noop', { id, version: Number(product.version || 1) });
        return ok(res, state, req, { unchanged: true });
      }
      product.categoryId = nextCategoryId;
      product.title = title;
      product.price = price;
      product.stock = stock;
      product.soldCount = soldCount;
      product.imageUrl = imageUrl;
      product.description = description;
      product.version = nextVersion;
      product.localStatus = product.localStatus === 'new' ? 'new' : 'modified';
      product.localUpdatedAt = nowIso;
      queueLocalChange(state, 'product_edit', editPayload, 'product', id);
      appendMarketDebug('product_edit_local', {
        id,
        changedFields: Object.keys(editPayload).filter((key) => !['id', 'merchantId', 'version'].includes(key)),
        version: product.version,
      });
      await persistCatalogProjectionNow(state, 'product_edit');
      await persistLocalProjectionNow(state, 'product_edit');
      return ok(res, state, req);
    }

    if (action === 'delete') {
      if (product.deleted) return fail(res, 'Product already deleted');
      if (String(product.localStatus || '') === 'new') {
        state.products = state.products.filter((p) => p.id !== id);
        queueLocalChange(state, 'product_delete', {
          id,
          version: Number(product.version || 1),
        }, 'product', id);
        appendMarketDebug('product_delete_local_drop_unsynced', { id });
        await persistCatalogProjectionNow(state, 'product_delete_drop_unsynced');
        await persistLocalProjectionNow(state, 'product_delete_drop_unsynced');
        return ok(res, state, req);
      }
      const nowIso = new Date().toISOString();
      product.deleted = true;
      product.deleteSync = { acked: 0, total: 1 };
      product.localStatus = product.localStatus === 'new' ? 'new' : 'modified';
      product.localUpdatedAt = nowIso;
      queueLocalChange(state, 'product_delete', {
        id,
        version: Number(product.version || 1),
      }, 'product', id);
      appendMarketDebug('product_delete_local', { id, localStatus: product.localStatus });
      await persistCatalogProjectionNow(state, 'product_delete');
      await persistLocalProjectionNow(state, 'product_delete');
      return ok(res, state, req);
    }

    if (action === 'bump') {
      const nowIso = new Date().toISOString();
      product.version += 1;
      product.price += 8;
      product.stock = Math.max(0, product.stock - 1);
      product.soldCount = Math.max(0, Number(product.soldCount || 0) + 1);
      product.localStatus = product.localStatus === 'new' ? 'new' : 'modified';
      product.localUpdatedAt = nowIso;
      queueLocalChange(state, 'product_bump', { id, merchantId: product.merchantId, categoryId: product.categoryId, title: product.title, version: product.version, price: product.price, stock: product.stock, soldCount: product.soldCount, imageUrl: product.imageUrl, description: product.description }, 'product', id);
      appendMarketDebug('product_bump_local', { id, stock: product.stock, soldCount: product.soldCount, version: product.version });
      await persistCatalogProjectionNow(state, 'product_bump');
      await persistLocalProjectionNow(state, 'product_bump');
      return ok(res, state, req);
    }

    return fail(res, 'Unsupported action');
  });
}

module.exports = {
  registerCatalogRoutes,
};
