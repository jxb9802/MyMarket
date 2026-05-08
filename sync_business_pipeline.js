function stringifyError(error, fallback = 'sync_business_pipeline_failed') {
  return String(error?.message || error || fallback);
}

const syncPublicRefreshControl = {
  lastAtMs: 0,
  lastSignature: '',
};

function buildSyncPublicRefreshSignature(state = {}) {
  const sync = state?.sync && typeof state.sync === 'object' ? state.sync : {};
  return JSON.stringify({
    online: sync.online === true,
    mode: String(sync.mode || ''),
    lag: Math.max(0, Number(sync.lag || 0)),
    localHeight: Math.max(0, Number(sync.localHeight || 0)),
    highestBlock: Math.max(0, Number(sync.highestBlock || sync.targetHeight || sync.p2pTipHeight || 0)),
    initialSyncCompleted: sync.initialSyncCompleted === true,
  });
}

function shouldScheduleSyncPublicRefresh(state, options = {}, deps = {}) {
  if (options.forcePublicRefresh === true) return true;
  if (options.refresh !== true) return false;
  const nowMs = Date.now();
  const signature = buildSyncPublicRefreshSignature(state);
  const changed = signature !== syncPublicRefreshControl.lastSignature;
  const minIntervalMs = Math.max(5000, Number(options.minRefreshIntervalMs || 10000));
  if (!changed && (nowMs - Number(syncPublicRefreshControl.lastAtMs || 0)) < minIntervalMs) {
    deps.appendMarketDebug?.('sync_public_refresh_suppressed', {
      reason: String(options.refreshReason || options.reason || 'sync_state_saved'),
      changed: false,
      minIntervalMs,
    });
    return false;
  }
  syncPublicRefreshControl.lastAtMs = nowMs;
  syncPublicRefreshControl.lastSignature = signature;
  return true;
}

function shouldScheduleProfilePublicRefresh(state, options = {}, deps = {}) {
  if (options.refresh !== true) return false;
  if (options.forcePublicRefresh === true) return true;
  if (String(options.publicRefreshScope || '').trim() === 'self') return true;
  deps.appendMarketDebug?.('profile_public_refresh_suppressed', {
    reason: String(options.refreshReason || options.reason || 'profile_state_saved'),
    scope: String(options.publicRefreshScope || 'global'),
  });
  return false;
}

function shouldScheduleCatalogPublicRefresh(options = {}, deps = {}) {
  if (options.refresh !== true) return false;
  if (options.allowGlobalPublicRefresh === true) return true;
  deps.appendMarketDebug?.('catalog_public_refresh_suppressed', {
    reason: String(options.refreshReason || options.reason || 'catalog_state_saved'),
  });
  return false;
}

function shouldScheduleLocalPublicRefresh(options = {}, deps = {}) {
  if (options.refresh !== true) return false;
  if (options.allowGlobalPublicRefresh === true) return true;
  deps.appendMarketDebug?.('local_public_refresh_suppressed', {
    reason: String(options.refreshReason || options.reason || 'local_state_saved'),
  });
  return false;
}

function scheduleDetachedFollowup(task, delayMs = 0) {
  const safeDelayMs = Math.max(0, Number(delayMs || 0));
  const runner = () => {
    void Promise.resolve()
      .then(task)
      .catch(() => {});
  };
  if (safeDelayMs <= 0) {
    setImmediate(runner);
    return;
  }
  const timer = setTimeout(runner, safeDelayMs);
  timer.unref?.();
}

function commitSyncProjectionState(state, options = {}, deps = {}) {
  deps.prepareStateForCommit?.(state);
  const immediate = options.immediate === true;
  if (immediate) {
    deps.cancelSqliteSnapshotPersist?.('sync');
    void deps.persistSyncStateNow?.(state.sync, {
      reason: String(options.reason || 'sync_state_saved'),
      source: String(options.source || 'commitSyncState'),
    }).catch(() => {});
  } else {
    deps.persistSyncStateAsync?.(state.sync);
  }
  deps.maybeRefreshWalletForCommittedSyncState?.(state, {
    reason: String(options.reason || 'sync_state_saved'),
  });
  if (options.writeJson !== false) {
    void deps.writeStateJsonSnapshot?.(state, {
      reason: String(options.reason || 'sync_state_saved'),
    }).catch(() => {});
  }
  if (shouldScheduleSyncPublicRefresh(state, options, deps)) {
    deps.schedulePublicStateRefresh?.(
      String(options.refreshReason || options.reason || 'sync_state_saved'),
      state,
    );
  }
}

async function commitSyncProjectionStateNow(state, options = {}, deps = {}) {
  deps.prepareStateForCommit?.(state);
  await deps.persistSyncStateNow?.(state.sync, {
    reason: String(options.reason || 'sync_state_saved'),
    source: String(options.source || 'commitSyncStateNow'),
  });
  deps.maybeRefreshWalletForCommittedSyncState?.(state, {
    reason: String(options.reason || 'sync_state_saved'),
  });
  if (options.writeJson !== false) {
    await deps.writeStateJsonSnapshot?.(state, {
      reason: String(options.reason || 'sync_state_saved'),
    });
  }
  if (shouldScheduleSyncPublicRefresh(state, options, deps)) {
    deps.schedulePublicStateRefresh?.(
      String(options.refreshReason || options.reason || 'sync_state_saved'),
      state,
    );
  }
}

function commitCatalogProjectionState(state, options = {}, deps = {}) {
  deps.prepareStateForCommit?.(state);
  if (options.immediate === true) {
    const payload = deps.buildCatalogSnapshotPayload?.(state);
    void deps.catalogDomain?.emitCatalogSnapshot?.(payload, {
      producer: String(options.producer || 'commit_catalog_state'),
      dedupeKey: `catalog.snapshot:${deps.hashSnapshotPayload?.(payload)}`,
    }).catch((error) => deps.appendMarketDebug?.('sqlite_catalog_persist_failed', {
      message: stringifyError(error, 'sqlite_catalog_persist_failed'),
      categoryCount: Array.isArray(payload?.categories) ? payload.categories.length : 0,
      productCount: Array.isArray(payload?.products) ? payload.products.length : 0,
      immediate: true,
    }));
  } else {
    deps.persistCatalogSnapshotAsync?.(state, { delayMs: options.delayMs });
  }
  if (options.writeJson === true) {
    void deps.writeStateJsonSnapshot?.(state, {
      reason: String(options.reason || 'catalog_state_saved'),
    }).catch(() => {});
  }
  if (shouldScheduleCatalogPublicRefresh(options, deps)) {
    deps.schedulePublicStateRefresh?.(
      String(options.refreshReason || options.reason || 'catalog_state_saved'),
      state,
    );
  }
}

function commitProfileProjectionState(state, options = {}, deps = {}) {
  deps.prepareStateForCommit?.(state);
  if (options.immediate === true) {
    const payload = deps.buildProfileSnapshotPayload?.(state);
    void deps.profileDomain?.emitProfileUpsert?.(payload, {
      producer: String(options.producer || 'commit_profile_state'),
      dedupeKey: `profile.upsert:${payload.profileKey}:${deps.hashSnapshotPayload?.(payload)}`,
    }).catch((error) => deps.appendMarketDebug?.('sqlite_profile_persist_failed', {
      message: stringifyError(error, 'sqlite_profile_persist_failed'),
      merchantId: payload?.merchantId,
      name: payload?.name,
      immediate: true,
    }));
  } else {
    deps.persistProfileSnapshotAsync?.(state, { delayMs: options.delayMs });
  }
  if (options.writeJson === true) {
    void deps.writeStateJsonSnapshot?.(state, {
      reason: String(options.reason || 'profile_state_saved'),
    }).catch(() => {});
  }
  if (shouldScheduleProfilePublicRefresh(state, options, deps)) {
    deps.schedulePublicStateRefresh?.(
      String(options.refreshReason || options.reason || 'profile_state_saved'),
      state,
    );
  }
}

function commitLocalProjectionState(state, options = {}, deps = {}) {
  deps.prepareStateForCommit?.(state);
  if (options.immediate === true) {
    deps.cancelSqliteSnapshotPersist?.('localState');
    const payload = deps.buildLocalStateSnapshotPayload?.(state);
    void deps.localStateDomain?.emitLocalStateSnapshot?.(payload, {
      producer: String(options.producer || 'commit_local_state'),
      dedupeKey: `local_state.snapshot:${deps.hashSnapshotPayload?.(payload)}`,
    }).catch((error) => deps.appendMarketDebug?.('sqlite_local_state_persist_failed', {
      message: stringifyError(error, 'sqlite_local_state_persist_failed'),
      localChangeCount: Array.isArray(payload?.localChanges) ? payload.localChanges.length : 0,
      recentRawtxCount: Array.isArray(payload?.recentRawtxs) ? payload.recentRawtxs.length : 0,
      pendingAnchorCount: Array.isArray(payload?.pendingAnchors) ? payload.pendingAnchors.length : 0,
      immediate: true,
    }));
  } else {
    deps.scheduleSqliteSnapshotPersist?.('localState', state, { delayMs: options.delayMs });
  }
  if (options.writeJson === true) {
    void deps.writeStateJsonSnapshot?.(state, {
      reason: String(options.reason || 'local_state_saved'),
    }).catch(() => {});
  }
  if (shouldScheduleLocalPublicRefresh(options, deps)) {
    deps.schedulePublicStateRefresh?.(
      String(options.refreshReason || options.reason || 'local_state_saved'),
      state,
    );
  }
}

async function finalizeSyncBusinessState(context = {}, deps = {}) {
  const startedAtMs = Date.now();
  const roundEpoch = Number(context.roundEpoch || 0);
  const latestRuntimeState = context.latestRuntimeState && typeof context.latestRuntimeState === 'object'
    ? context.latestRuntimeState
    : {};
  const state = context.state && typeof context.state === 'object' ? context.state : {};
  const syncFinalFollowupDelayMs = Number(context.syncFinalFollowupDelayMs || 0);
  const finalState = deps.mergeStatePreservingChat?.(latestRuntimeState, state) || state;
  if (finalState?.sync && typeof finalState.sync === 'object') {
    finalState.sync = deps.mergeSyncStatePreservingProgress?.(
      (latestRuntimeState && latestRuntimeState.sync && typeof latestRuntimeState.sync === 'object')
        ? latestRuntimeState.sync
        : {},
      (state && state.sync && typeof state.sync === 'object')
        ? state.sync
        : finalState.sync,
    ) || finalState.sync;
    const trustedFinalSync = deps.getTrustedSyncSnapshot?.(finalState.sync) || finalState.sync;
    finalState.sync.bootstrapHeight = trustedFinalSync.bootstrapHeight;
    finalState.sync.fixedSyncLastHeight = Math.max(
      Number(finalState.sync.fixedSyncLastHeight || 0),
      Number(trustedFinalSync.localHeight || 0),
    );
    finalState.sync.localHeight = trustedFinalSync.localHeight;
    finalState.sync.p2pTipHeight = trustedFinalSync.p2pTipHeight;
    finalState.sync.p2pHeaderCursorHeight = trustedFinalSync.p2pHeaderCursorHeight;
    deps.applyDerivedSyncOnline?.(finalState.sync);
    deps.appendMarketDebug?.('sync_final_state_merged', {
      roundEpoch,
      latestRuntimeLocalHeight: Number(latestRuntimeState?.sync?.localHeight || 0),
      latestRuntimeFixedSyncLastHeight: Number(latestRuntimeState?.sync?.fixedSyncLastHeight || 0),
      currentStateLocalHeight: Number(state?.sync?.localHeight || 0),
      currentStateFixedSyncLastHeight: Number(state?.sync?.fixedSyncLastHeight || 0),
      finalLocalHeight: Number(finalState.sync.localHeight || 0),
      finalFixedSyncLastHeight: Number(finalState.sync.fixedSyncLastHeight || 0),
      finalHighestBlock: Number(trustedFinalSync.highestBlock || 0),
    });
  }

  await commitSyncProjectionStateNow(finalState, {
    reason: 'sync_final_state_saved',
    refresh: false,
    writeJson: true,
  }, deps);
  await deps.flushP2PSyncReceiptsSnapshot?.({ reason: 'sync_final_state_saved' });

  commitCatalogProjectionState(finalState, {
    reason: 'sync_final_state_saved_catalog',
    writeJson: false,
    refresh: false,
    delayMs: syncFinalFollowupDelayMs,
  }, deps);
  commitProfileProjectionState(finalState, {
    reason: 'sync_final_state_saved_profile',
    writeJson: false,
    refresh: false,
    delayMs: syncFinalFollowupDelayMs,
  }, deps);
  commitLocalProjectionState(finalState, {
    reason: 'sync_final_state_saved_local',
    writeJson: false,
    refresh: false,
    delayMs: syncFinalFollowupDelayMs,
  }, deps);
  if (typeof deps.refreshChatProjectionFromAnchors === 'function') {
    scheduleDetachedFollowup(async () => {
      try {
        await deps.refreshChatProjectionFromAnchors(finalState);
        deps.appendMarketDebug?.('sync_final_chat_projection_followup_done', {
          roundEpoch,
          localHeight: Number(finalState?.sync?.localHeight || 0),
        });
      } catch (error) {
        deps.appendMarketDebug?.('sync_final_chat_projection_followup_failed', {
          roundEpoch,
          message: stringifyError(error, 'sync_final_chat_projection_followup_failed'),
        });
      }
    });
  }
  deps.scheduleLocalPublicStateCacheRebuild?.(
    'sync_final_state_saved',
    syncFinalFollowupDelayMs,
    finalState,
    { domains: ['sync', 'catalog', 'profile', 'order', 'chat'] },
  );

  if (deps.shouldRefreshWalletIndexForSync?.(finalState)) {
    deps.triggerWalletIndexRefreshInBackground?.(finalState);
    context.updateSyncStage?.('wallet_index_refreshed');
  }
  if (typeof deps.refreshBusinessSummaries === 'function') {
    deps.refreshBusinessSummaries(finalState, context);
  }
  const elapsedMs = Date.now() - startedAtMs;
  if (elapsedMs >= 100) {
    deps.appendMarketDebug?.('sync_finalize_business_state_profile', {
      roundEpoch,
      elapsedMs,
      localHeight: Number(finalState?.sync?.localHeight || 0),
      fixedSyncLastHeight: Number(finalState?.sync?.fixedSyncLastHeight || 0),
      highestBlock: Number(finalState?.sync?.highestBlock || 0),
    });
  }
  return finalState;
}

module.exports = {
  commitSyncProjectionState,
  commitSyncProjectionStateNow,
  commitCatalogProjectionState,
  commitProfileProjectionState,
  commitLocalProjectionState,
  finalizeSyncBusinessState,
};
