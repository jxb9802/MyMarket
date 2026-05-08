async function performCatalogResyncReset(options = {}) {
  const {
    req,
    bootstrapHeight,
    resetEpoch,
    previousState,
    clearRuntimeSyncProgress,
    clearLocalCatalogArtifactsWithRetry,
    buildFreshMarketStateForBootstrap,
    withTransientResetRetries,
    writeStateJsonSnapshot,
    persistSyncStateNow,
    resetSyncArtifacts,
    rebuildPublicStateCache,
    beginSyncUiTiming,
    setRuntimeSyncProgress,
    appendMarketDebug,
    enqueueCommand,
    notifyStewardSyncEpoch,
    notifyStewardSyncNow,
    scheduleSyncNow,
    resetAnchorEvents,
    resetCatalogSnapshot,
    resetProfileSnapshot,
    resetLocalState,
    resetOrdersProjection,
    resetWalletState,
    resetWalletTxProjection,
    clearWalletLocalIndex,
    applyBootstrapIndexForBusinessSync,
    resolveWalletScanStartHeight,
    getWalletKey,
  } = options;

  if (!req) throw new Error('req is required');
  if (!Number.isFinite(Number(bootstrapHeight))) throw new Error('bootstrapHeight is required');
  if (!Number.isFinite(Number(resetEpoch))) throw new Error('resetEpoch is required');

  clearRuntimeSyncProgress();
  await clearLocalCatalogArtifactsWithRetry();

  await withTransientResetRetries('catalog_resync_reset_wallet_local_index', async () => {
    if (typeof clearWalletLocalIndex === 'function') {
      await clearWalletLocalIndex('catalog_resync_reset');
    }
  }, {
    attempts: 3,
    baseDelayMs: 150,
  });

  const fresh = buildFreshMarketStateForBootstrap(req, previousState?.steward || {}, bootstrapHeight);
  const previousSync = previousState?.sync && typeof previousState.sync === 'object' ? previousState.sync : {};
  if (previousSync.p2pHeightHashCache && typeof previousSync.p2pHeightHashCache === 'object') {
    const minHeight = Math.max(0, Number(bootstrapHeight || 0) - 1);
    const maxHeight = Math.max(
      minHeight,
      Number(previousSync.localHeight || 0),
      Number(previousSync.fixedSyncLastHeight || 0),
    );
    const preservedCache = {};
    Object.keys(previousSync.p2pHeightHashCache).forEach((key) => {
      const height = Number(key);
      const hash = String(previousSync.p2pHeightHashCache[key] || '').trim().toLowerCase();
      if (!Number.isFinite(height) || height < minHeight || height > maxHeight) return;
      if (!/^[0-9a-f]{64}$/i.test(hash)) return;
      preservedCache[String(height)] = hash;
    });
    if (Object.keys(preservedCache).length > 0) {
      fresh.sync.p2pHeightHashCache = preservedCache;
      const cursorHeight = Math.max(
        minHeight,
        Math.min(
          maxHeight,
          Number(previousSync.p2pHeaderCursorHeight || 0),
        ),
      );
      const cursorHash = String(
        preservedCache[String(cursorHeight)]
        || preservedCache[String(minHeight)]
        || ''
      ).trim().toLowerCase();
      if (/^[0-9a-f]{64}$/i.test(cursorHash)) {
        fresh.sync.p2pHeaderCursorHeight = Number.isFinite(cursorHeight) ? cursorHeight : minHeight;
        fresh.sync.p2pHeaderCursorHash = cursorHash;
      }
    }
  }
  const preservedTipHeight = Math.max(
    Number(fresh.sync.p2pTipHeight || 0),
    Number(previousState?.sync?.networkHeight || 0),
    Number(previousState?.sync?.p2pTipHeight || 0),
  );
  fresh.sync.p2pTipHeight = preservedTipHeight;
  fresh.sync.p2pTipHash = '';
  fresh.sync.independentPhase = 'idle';
  fresh.sync.independentLocalHeight = Math.max(0, Number(bootstrapHeight || 0) - 1);
  fresh.sync.independentTargetHeight = preservedTipHeight;
  fresh.sync.receiptCommittedHeight = Math.max(0, Number(bootstrapHeight || 0) - 1);
  fresh.sync.skipHeaderSyncEpoch = resetEpoch;
  fresh.sync.skipForwardProbeEpoch = resetEpoch;
  fresh.sync.manualQuickstartPending = true;
  fresh.sync.sessionEpoch = resetEpoch;

  await withTransientResetRetries('catalog_resync_save_state', async () => {
    await writeStateJsonSnapshot(fresh, { reason: 'catalog_resync_reset_saved' });
  }, {
    attempts: 4,
    baseDelayMs: 200,
  });

  await withTransientResetRetries('catalog_resync_reset_projections', async () => {
    if (typeof resetAnchorEvents === 'function') await resetAnchorEvents();
    await resetCatalogSnapshot();
    await resetProfileSnapshot('self');
    await resetLocalState('main');
    await resetOrdersProjection();
  }, {
    attempts: 3,
    baseDelayMs: 150,
  });

  let bootstrapIndexResult = null;
  await withTransientResetRetries('catalog_resync_apply_bootstrap_index', async () => {
    if (typeof applyBootstrapIndexForBusinessSync === 'function') {
      bootstrapIndexResult = await applyBootstrapIndexForBusinessSync(fresh, {
        source: 'catalog_resync_reset',
      });
    }
  }, {
    attempts: 2,
    baseDelayMs: 250,
  });

  if (bootstrapIndexResult?.applied === true) {
    await withTransientResetRetries('catalog_resync_save_bootstrap_index_state', async () => {
      await writeStateJsonSnapshot(fresh, { reason: 'catalog_resync_bootstrap_index_saved' });
    }, {
      attempts: 4,
      baseDelayMs: 200,
    });
  }

  const releaseToHeight = Math.max(0, Number(
    bootstrapIndexResult?.releaseToHeight
    || bootstrapIndexResult?.meta?.toHeight
    || fresh.sync?.bootstrapIndex?.toHeight
    || 0,
  ));
  const releaseResumeHeight = releaseToHeight > 0
    ? Math.max(Number(bootstrapHeight || 0), releaseToHeight + 1)
    : Number(bootstrapHeight || 0);
  const walletScanStartHeight = typeof resolveWalletScanStartHeight === 'function'
    ? Math.max(Number(bootstrapHeight || 0), Number(resolveWalletScanStartHeight({
      bootstrapHeight,
      releaseResumeHeight,
      source: 'catalog_resync_reset',
    }) || 0))
    : Number(bootstrapHeight || 0);
  const optimizedStartHeight = Math.max(
    Number(bootstrapHeight || 0),
    Math.min(releaseResumeHeight || Number(bootstrapHeight || 0), walletScanStartHeight || Number(bootstrapHeight || 0)),
  );
  const optimizedLocalHeight = Math.max(0, optimizedStartHeight - 1);
  let optimizedScanStart = false;
  if (optimizedLocalHeight > Math.max(0, Number(fresh.sync.fixedSyncLastHeight || 0))) {
    fresh.sync.fixedSyncLastHeight = optimizedLocalHeight;
    fresh.sync.localHeight = optimizedLocalHeight;
    fresh.sync.independentLocalHeight = optimizedLocalHeight;
    fresh.sync.receiptCommittedHeight = optimizedLocalHeight;
    optimizedScanStart = true;
  }
  if (optimizedScanStart) {
    await withTransientResetRetries('catalog_resync_save_optimized_scan_start_state', async () => {
      await writeStateJsonSnapshot(fresh, { reason: 'catalog_resync_optimized_scan_start_saved' });
    }, {
      attempts: 4,
      baseDelayMs: 200,
    });
  }

  await withTransientResetRetries('catalog_resync_persist_sync_state', async () => {
    await persistSyncStateNow(fresh.sync, {
      reason: 'catalog_resync_reset_saved',
      source: 'catalog_resync_reset',
      force: true,
    });
  }, {
    attempts: 4,
    baseDelayMs: 250,
  });

  await withTransientResetRetries('catalog_resync_reset_runtime_artifacts', async () => {
    if (typeof resetSyncArtifacts === 'function') {
      await resetSyncArtifacts({
        bootstrapHeight,
        resetEpoch,
        syncState: fresh.sync,
        reason: 'catalog_resync_reset',
      });
    }
  }, {
    attempts: 3,
    baseDelayMs: 150,
  });

  await withTransientResetRetries('catalog_resync_public_state_cache_reset', async () => {
    await rebuildPublicStateCache({
      source: 'catalog_resync_reset',
      state: fresh,
      req,
    });
  }, {
    attempts: 3,
    baseDelayMs: 150,
  });

  beginSyncUiTiming('manual_catalog_resync', {
    bootstrapHeight,
    initialLocalHeight: Number(fresh.sync.localHeight || (bootstrapHeight - 1)),
    initialNetworkHeight: preservedTipHeight,
    syncEpoch: resetEpoch,
  });
  setRuntimeSyncProgress({
    bootstrapHeight,
    fixedSyncLastHeight: Number(fresh.sync.fixedSyncLastHeight || (bootstrapHeight - 1)),
    localHeight: Number(fresh.sync.localHeight || (bootstrapHeight - 1)),
    targetHeight: preservedTipHeight,
    p2pHeaderCursorHeight: Number(fresh.sync.p2pHeaderCursorHeight || 0),
    p2pTipHeight: preservedTipHeight,
  });
  appendMarketDebug('catalog_resync_reset', {
    resetEpoch,
    bootstrapHeight,
    preservedHashCacheCount: Object.keys(fresh.sync.p2pHeightHashCache || {}).length,
    clearedLocalChanges: true,
    clearedArtifacts: ['state', 'anchors_global', 'chain_spool', 'chain_spool_state', 'wallet_local_index'],
    clearedProjections: ['catalog', 'profile', 'local_state', 'orders', 'wallet'],
    clearedStores: ['anchor_events', 'wallet_cache', 'wallet_tx_contexts'],
    preservedTipHeight,
    bootstrapIndex: bootstrapIndexResult,
    releaseResumeHeight,
    walletScanStartHeight,
    optimizedStartHeight,
  });

  const command = await enqueueCommand('run_chain_sync', {
    resetEpoch,
    bootstrapHeight,
    source: 'manual_catalog_resync',
    options: {},
  });
  notifyStewardSyncEpoch(resetEpoch);
  if (typeof scheduleSyncNow === 'function') {
    scheduleSyncNow(0);
  } else {
    notifyStewardSyncNow();
  }

  return {
    fresh,
    preservedTipHeight,
    command,
    bootstrapIndexResult,
  };
}

async function performLocalSyncStateReset(options = {}) {
  const {
    req,
    bootstrapHeight,
    resetEpoch,
    previousState,
    clearRuntimeSyncProgress,
    clearLocalCatalogArtifactsWithRetry,
    buildFreshMarketStateForBootstrap,
    withTransientResetRetries,
    writeStateJsonSnapshot,
    persistSyncStateNow,
    resetSyncArtifacts,
    rebuildPublicStateCache,
    appendMarketDebug,
    notifyStewardSyncEpoch,
    resetAnchorEvents,
    resetCatalogSnapshot,
    resetProfileSnapshot,
    resetLocalState,
    resetOrdersProjection,
    resetWalletState,
    resetWalletTxProjection,
    clearWalletLocalIndex,
    applyBootstrapIndexForBusinessSync,
    resolveWalletScanStartHeight,
    getWalletKey,
  } = options;

  if (!req) throw new Error('req is required');
  if (!Number.isFinite(Number(bootstrapHeight))) throw new Error('bootstrapHeight is required');
  if (!Number.isFinite(Number(resetEpoch))) throw new Error('resetEpoch is required');

  clearRuntimeSyncProgress();
  await clearLocalCatalogArtifactsWithRetry();

  await withTransientResetRetries('manual_sync_state_reset_wallet_local_index', async () => {
    if (typeof clearWalletLocalIndex === 'function') {
      await clearWalletLocalIndex('manual_sync_state_reset');
    }
  }, {
    attempts: 3,
    baseDelayMs: 150,
  });

  const fresh = buildFreshMarketStateForBootstrap(req, previousState?.steward || {}, bootstrapHeight);
  fresh.sync.p2pTipHeight = 0;
  fresh.sync.p2pTipHash = '';
  fresh.sync.p2pHeaderCursorHeight = -1;
  fresh.sync.p2pHeaderCursorHash = '';
  fresh.sync.p2pHeightHashCache = {};
  fresh.sync.p2pGapHeights = [];
  fresh.sync.independentPhase = 'idle';
  fresh.sync.independentLocalHeight = Math.max(0, Number(bootstrapHeight || 0) - 1);
  fresh.sync.independentTargetHeight = 0;
  fresh.sync.receiptCommittedHeight = Math.max(0, Number(bootstrapHeight || 0) - 1);
  fresh.sync.skipHeaderSyncEpoch = 0;
  fresh.sync.skipForwardProbeEpoch = 0;
  fresh.sync.manualQuickstartPending = false;
  fresh.sync.sessionEpoch = resetEpoch;

  await withTransientResetRetries('manual_sync_state_reset_save_state', async () => {
    await writeStateJsonSnapshot(fresh, { reason: 'manual_sync_state_reset_saved' });
  }, {
    attempts: 4,
    baseDelayMs: 200,
  });

  await withTransientResetRetries('manual_sync_state_reset_projections', async () => {
    if (typeof resetAnchorEvents === 'function') await resetAnchorEvents();
    await resetCatalogSnapshot();
    await resetProfileSnapshot('self');
    await resetLocalState('main');
    await resetOrdersProjection();
  }, {
    attempts: 3,
    baseDelayMs: 150,
  });

  let bootstrapIndexResult = null;
  await withTransientResetRetries('manual_sync_state_reset_apply_bootstrap_index', async () => {
    if (typeof applyBootstrapIndexForBusinessSync === 'function') {
      bootstrapIndexResult = await applyBootstrapIndexForBusinessSync(fresh, {
        source: 'manual_sync_state_reset',
      });
    }
  }, {
    attempts: 2,
    baseDelayMs: 250,
  });

  if (bootstrapIndexResult?.applied === true) {
    await withTransientResetRetries('manual_sync_state_reset_save_bootstrap_index_state', async () => {
      await writeStateJsonSnapshot(fresh, { reason: 'manual_sync_state_reset_bootstrap_index_saved' });
    }, {
      attempts: 4,
      baseDelayMs: 200,
    });
  }

  const releaseToHeight = Math.max(0, Number(
    bootstrapIndexResult?.releaseToHeight
    || bootstrapIndexResult?.meta?.toHeight
    || fresh.sync?.bootstrapIndex?.toHeight
    || 0,
  ));
  const releaseResumeHeight = releaseToHeight > 0
    ? Math.max(Number(bootstrapHeight || 0), releaseToHeight + 1)
    : Number(bootstrapHeight || 0);
  const walletScanStartHeight = typeof resolveWalletScanStartHeight === 'function'
    ? Math.max(Number(bootstrapHeight || 0), Number(resolveWalletScanStartHeight({
      bootstrapHeight,
      releaseResumeHeight,
      source: 'manual_sync_state_reset',
    }) || 0))
    : Number(bootstrapHeight || 0);
  const optimizedStartHeight = Math.max(
    Number(bootstrapHeight || 0),
    Math.min(releaseResumeHeight || Number(bootstrapHeight || 0), walletScanStartHeight || Number(bootstrapHeight || 0)),
  );
  const optimizedLocalHeight = Math.max(0, optimizedStartHeight - 1);
  let optimizedScanStart = false;
  if (optimizedLocalHeight > Math.max(0, Number(fresh.sync.fixedSyncLastHeight || 0))) {
    fresh.sync.fixedSyncLastHeight = optimizedLocalHeight;
    fresh.sync.localHeight = optimizedLocalHeight;
    fresh.sync.independentLocalHeight = optimizedLocalHeight;
    fresh.sync.receiptCommittedHeight = optimizedLocalHeight;
    optimizedScanStart = true;
  }
  if (optimizedScanStart) {
    await withTransientResetRetries('manual_sync_state_reset_save_optimized_scan_start_state', async () => {
      await writeStateJsonSnapshot(fresh, { reason: 'manual_sync_state_reset_optimized_scan_start_saved' });
    }, {
      attempts: 4,
      baseDelayMs: 200,
    });
  }

  await withTransientResetRetries('manual_sync_state_reset_persist_sync_state', async () => {
    await persistSyncStateNow(fresh.sync, {
      reason: 'manual_sync_state_reset_saved',
      source: 'manual_sync_state_reset',
      force: true,
    });
  }, {
    attempts: 4,
    baseDelayMs: 250,
  });

  await withTransientResetRetries('manual_sync_state_reset_runtime_artifacts', async () => {
    if (typeof resetSyncArtifacts === 'function') {
      await resetSyncArtifacts({
        bootstrapHeight,
        resetEpoch,
        syncState: fresh.sync,
        reason: 'manual_sync_state_reset',
      });
    }
  }, {
    attempts: 3,
    baseDelayMs: 150,
  });

  await withTransientResetRetries('manual_sync_state_reset_public_state_cache_reset', async () => {
    await rebuildPublicStateCache({
      source: 'manual_sync_state_reset',
      state: fresh,
      req,
    });
  }, {
    attempts: 3,
    baseDelayMs: 150,
  });

  if (typeof notifyStewardSyncEpoch === 'function') {
    notifyStewardSyncEpoch(resetEpoch);
  }

  appendMarketDebug('manual_sync_state_reset', {
    resetEpoch,
    bootstrapHeight,
    clearedLocalChanges: true,
    clearedArtifacts: ['state', 'anchors_global', 'chain_spool', 'chain_spool_state', 'p2p_sync_receipts', 'independent_sync_status', 'wallet_local_index'],
    clearedProjections: ['catalog', 'profile', 'local_state', 'orders', 'wallet'],
    clearedStores: ['anchor_events', 'wallet_cache', 'wallet_tx_contexts'],
    bootstrapIndex: bootstrapIndexResult,
    releaseResumeHeight,
    walletScanStartHeight,
    optimizedStartHeight,
  });

  return {
    fresh,
    bootstrapIndexResult,
  };
}

module.exports = {
  performCatalogResyncReset,
  performLocalSyncStateReset,
};
