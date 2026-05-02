function createPublicViewCacheService(deps = {}) {
  const {
    publicStateCacheFile,
    stateFile,
    defaultPublicStateCacheEnvelope,
    trimStateToCoreDomains,
    loadParsedJsonFileCached,
    writeJsonFile,
    getFileMtimeMsSafe,
    appendMarketDebug,
    getRuntimeProjectionStateVersion,
  } = deps;

  let publicStateCacheEnvelope = null;
  let stateLiteSnapshotCache = null;

  function invalidateStateLiteSnapshotCache(reason = 'runtime_projection_state_updated') {
    stateLiteSnapshotCache = null;
    appendMarketDebug('state_lite_cache_invalidated', {
      reason: String(reason || 'runtime_projection_state_updated'),
      runtimeProjectionStateVersion: Number(getRuntimeProjectionStateVersion?.() || 0),
    });
  }

  function trimPublicStateCacheEnvelopeToCore(envelope = null) {
    const safe = {
      ...defaultPublicStateCacheEnvelope(),
      ...(envelope || {}),
    };
    const state = safe?.state && typeof safe.state === 'object' ? safe.state : null;
    safe.state = state
      ? {
          ...trimStateToCoreDomains(state),
          wallet: state?.wallet && typeof state.wallet === 'object' ? state.wallet : {},
          sync: state?.sync && typeof state.sync === 'object'
            ? { ...trimStateToCoreDomains(state).sync, ...state.sync }
            : trimStateToCoreDomains(state).sync,
        }
      : null;
    const views = safe?.views && typeof safe.views === 'object' ? safe.views : {};
    safe.views = {
      walletStatus: views.walletStatus && typeof views.walletStatus === 'object' ? views.walletStatus : undefined,
      walletBalance: views.walletBalance && typeof views.walletBalance === 'object' ? views.walletBalance : undefined,
      walletReceiveAddress: views.walletReceiveAddress && typeof views.walletReceiveAddress === 'object' ? views.walletReceiveAddress : undefined,
      walletHistoryPage1: views.walletHistoryPage1 && typeof views.walletHistoryPage1 === 'object' ? views.walletHistoryPage1 : undefined,
    };
    Object.keys(safe.views).forEach((key) => {
      if (!safe.views[key]) delete safe.views[key];
    });
    return safe;
  }

  function getEnvelope() {
    return publicStateCacheEnvelope;
  }

  function setEnvelope(envelope, options = {}) {
    publicStateCacheEnvelope = options.trim === false ? envelope : trimPublicStateCacheEnvelopeToCore(envelope);
    return publicStateCacheEnvelope;
  }

  function loadPublicStateCache() {
    let raw = null;
    try {
      raw = loadParsedJsonFileCached(publicStateCacheFile);
    } catch (_) {
      raw = null;
    }
    const merged = trimPublicStateCacheEnvelopeToCore(raw || {});
    if (!merged.state || typeof merged.state !== 'object') merged.state = null;
    if (!merged.views || typeof merged.views !== 'object') merged.views = {};
    publicStateCacheEnvelope = merged;
    return merged;
  }

  function isPublicStateCacheEnvelopeStale(envelope) {
    if (!envelope || typeof envelope !== 'object') return true;
    const updatedAtMs = Date.parse(String(envelope.updatedAt || '')) || 0;
    if (!updatedAtMs) return true;
    const sourceMtimeMs = getFileMtimeMsSafe(stateFile);
    return sourceMtimeMs > updatedAtMs;
  }

  function savePublicStateCache(envelope) {
    const safe = {
      ...defaultPublicStateCacheEnvelope(),
      ...(envelope || {}),
    };
    writeJsonFile(publicStateCacheFile, safe);
    publicStateCacheEnvelope = trimPublicStateCacheEnvelopeToCore(safe);
    invalidateStateLiteSnapshotCache('public_state_cache_saved');
    return publicStateCacheEnvelope;
  }

  function getStateLiteSnapshotCache() {
    return stateLiteSnapshotCache;
  }

  function setStateLiteSnapshotCache(entry = null) {
    stateLiteSnapshotCache = entry;
    return stateLiteSnapshotCache;
  }

  return {
    invalidateStateLiteSnapshotCache,
    trimPublicStateCacheEnvelopeToCore,
    getEnvelope,
    setEnvelope,
    loadPublicStateCache,
    isPublicStateCacheEnvelopeStale,
    savePublicStateCache,
    getStateLiteSnapshotCache,
    setStateLiteSnapshotCache,
  };
}

module.exports = {
  createPublicViewCacheService,
};
