function createSyncWorkerRuntime(deps = {}) {
  const {
    appendMarketDebug,
    createDebugPhaseTimer,
    getStateWithRuntimeSync,
    getTrustedSyncSnapshot,
    applyDerivedSyncOnline,
    loadProjectionState,
    isSyncSessionEpochCurrent,
    getSyncSessionEpoch,
    summarizeJobStage,
    updateJobState,
    commitSyncState,
    mergeAnchorsFromChain,
    reconcileBroadcastedLocalChanges,
    reconcileBroadcastedChatMessages,
    rebuildCatalogFromAnchors,
    mergeLatestPendingQueueIntoState,
    applyPendingChangesOnTop,
    syncBusinessPipeline,
    buildSyncBusinessPipelineDeps,
    getSyncFinalFollowupDelayMs,
    processLocalChangeQueueInBackground,
    getQueuedPushPassword,
  } = deps;

  let catalogSyncInFlightPromise = null;
  let catalogSyncInFlightEpoch = null;
  const NOOP_SYNC_FASTPATH_WINDOW_MS = Math.max(
    5000,
    Number(process.env.BSV_MARKET_NOOP_SYNC_FASTPATH_WINDOW_MS || 45000),
  );

  function hasPendingLocalSyncWork(state = null) {
    const queue = Array.isArray(state?.localChanges?.queue) ? state.localChanges.queue : [];
    return queue.some((item) => {
      const status = String(item?.status || '').trim().toLowerCase();
      return status === 'pending'
        || status === 'queued'
        || status === 'broadcasted'
        || status === 'anchored';
    });
  }

  function hasPendingChatSyncWork(state = null) {
    const messages = state?.chatMessages && typeof state.chatMessages === 'object'
      ? Object.values(state.chatMessages)
      : [];
    return messages.some((row) => (
      String(row?.transport || '').trim().toLowerCase() === 'onchain'
      && String(row?.status || '').trim().toLowerCase() === 'broadcasted'
    ));
  }

  function shouldFastPathRecentNoopSync(state = null, trustedSync = null) {
    if (!state?.sync || typeof state.sync !== 'object') return false;
    if (state?.sync?.manualQuickstartPending === true) return false;
    if (hasPendingLocalSyncWork(state) || hasPendingChatSyncWork(state)) return false;
    const localHeight = Math.max(
      0,
      Number(trustedSync?.localHeight || state?.sync?.localHeight || 0),
      Number(trustedSync?.fixedSyncLastHeight || state?.sync?.fixedSyncLastHeight || 0),
    );
    const observedTip = Math.max(
      Number(trustedSync?.networkHeight || state?.sync?.networkHeight || 0),
      Number(trustedSync?.targetHeight || state?.sync?.targetHeight || 0),
      Number(trustedSync?.p2pTipHeight || state?.sync?.p2pTipHeight || 0),
      Number(trustedSync?.p2pHeaderCursorHeight || state?.sync?.p2pHeaderCursorHeight || 0),
    );
    if (observedTip <= 0 || localHeight < observedTip) return false;
    const now = Date.now();
    const lastProbeMs = Date.parse(String(state?.sync?.lastP2PForwardProbeAt || ''));
    const lastAdvanceMs = Date.parse(String(state?.sync?.lastP2PAdvanceAt || ''));
    const recentProbe = Number.isFinite(lastProbeMs) && ((now - lastProbeMs) <= NOOP_SYNC_FASTPATH_WINDOW_MS);
    const recentAdvance = Number.isFinite(lastAdvanceMs) && ((now - lastAdvanceMs) <= NOOP_SYNC_FASTPATH_WINDOW_MS);
    return recentProbe || recentAdvance;
  }

  const interruptedResult = (roundEpoch, reason, stage) => {
    appendMarketDebug('catalog_sync_interrupted', {
      roundEpoch,
      currentEpoch: getSyncSessionEpoch(),
      stage: String(stage || 'unknown'),
      reason: String(reason || 'interrupted'),
    });
    return {
      interrupted: true,
      reason: String(reason || 'interrupted'),
      state: loadProjectionState(),
    };
  };

  async function runCatalogSyncSerial(req, options = {}) {
    if (catalogSyncInFlightPromise) {
      const inFlightEpoch = Number(catalogSyncInFlightEpoch);
      const sameEpoch = Number.isFinite(inFlightEpoch) && isSyncSessionEpochCurrent(inFlightEpoch);
      appendMarketDebug(sameEpoch ? 'catalog_sync_join_inflight' : 'catalog_sync_preempt_inflight', {
        inFlightEpoch: Number.isFinite(inFlightEpoch) ? inFlightEpoch : null,
        currentEpoch: getSyncSessionEpoch(),
        sameEpoch,
      });
      if (sameEpoch) {
        await catalogSyncInFlightPromise;
        return loadProjectionState();
      }
    }
    const roundEpoch = getSyncSessionEpoch();
    catalogSyncInFlightEpoch = roundEpoch;
    const currentPromise = (async () => {
      const phaseTimer = createDebugPhaseTimer({
        scope: 'catalog_sync',
        roundEpoch,
      });
      const updateSyncStage = (stage, extra = {}) => {
        const summary = summarizeJobStage('run_chain_sync', stage, extra);
        void updateJobState({
          stage: summary.stage,
          progressCurrent: summary.progressCurrent,
          progressTotal: summary.progressTotal,
        }).catch(() => {});
        if (typeof options?.onStage === 'function') {
          try {
            options.onStage(stage, extra, summary);
          } catch (_) {}
        }
      };
      const shouldAbortForHigherPriorityWork = async (stage) => {
        if (typeof options?.shouldAbort !== 'function') return false;
        let shouldAbort = false;
        try {
          shouldAbort = await options.shouldAbort(stage) === true;
        } catch (_) {
          shouldAbort = false;
        }
        if (!shouldAbort) return false;
        appendMarketDebug('catalog_sync_preempted_for_priority_command', {
          roundEpoch,
          stage: String(stage || 'unknown'),
          reason: 'wallet_send_pending',
        });
        return true;
      };
      const state = getStateWithRuntimeSync(loadProjectionState());
      const requestedBootstrapHeight = Math.max(0, Number(options?.bootstrapHeight || state?.sync?.bootstrapHeight || 0));
      const requestedResetEpoch = Math.max(0, Number(options?.resetEpoch || 0));
      const resetLocalFloor = Math.max(0, requestedBootstrapHeight - 1);
      if (requestedBootstrapHeight > 0) {
        const stateSessionEpoch = Math.max(0, Number(state?.sync?.sessionEpoch || 0));
        const stateLocalHeight = Math.max(
          0,
          Number(state?.sync?.localHeight || 0),
          Number(state?.sync?.fixedSyncLastHeight || 0),
        );
        const shouldReinitializeFromReset = (
          requestedResetEpoch > 0
          && stateSessionEpoch <= requestedResetEpoch
          && stateLocalHeight > resetLocalFloor
        );
        if (shouldReinitializeFromReset) {
          state.sync.bootstrapHeight = requestedBootstrapHeight;
          state.sync.localHeight = resetLocalFloor;
          state.sync.fixedSyncLastHeight = 0;
          state.sync.p2pTipHeight = Math.max(0, Number(state.sync.p2pTipHeight || 0));
          state.sync.p2pHeaderCursorHeight = Number.isFinite(Number(state.sync.p2pHeaderCursorHeight))
            ? Math.min(Number(state.sync.p2pHeaderCursorHeight || -1), resetLocalFloor)
            : -1;
          state.sync.manualQuickstartPending = true;
          state.sync.sessionEpoch = Math.max(stateSessionEpoch, requestedResetEpoch);
          appendMarketDebug('catalog_sync_reset_baseline_reapplied', {
            roundEpoch,
            requestedResetEpoch,
            requestedBootstrapHeight,
            priorLocalHeight: stateLocalHeight,
            resetLocalFloor,
          });
        }
      }
      if (state?.sync && typeof state.sync === 'object') {
        const trustedSync = options?.trustedSyncSnapshot && typeof options.trustedSyncSnapshot === 'object'
          ? getTrustedSyncSnapshot(options.trustedSyncSnapshot)
          : getTrustedSyncSnapshot(state.sync);
        state.sync.bootstrapHeight = trustedSync.bootstrapHeight;
        state.sync.localHeight = trustedSync.localHeight;
        state.sync.networkHeight = trustedSync.networkHeight;
        state.sync.p2pTipHeight = trustedSync.p2pTipHeight;
        state.sync.p2pHeaderCursorHeight = trustedSync.p2pHeaderCursorHeight;
        applyDerivedSyncOnline(state.sync);
        state.__trustedSyncSnapshot = trustedSync;
      }
      if (!isSyncSessionEpochCurrent(roundEpoch)) {
        appendMarketDebug('catalog_sync_skip_stale_epoch', {
          stage: 'before_prepare',
          roundEpoch,
          currentEpoch: getSyncSessionEpoch(),
        });
        return interruptedResult(roundEpoch, 'stale sync epoch before prepare', 'before_prepare');
      }
      if (Number(state.sync.networkHeight || 0) < Number(state.sync.localHeight || 0)) {
        state.sync.networkHeight = Number(state.sync.localHeight || 0);
      }
      applyDerivedSyncOnline(state.sync);
      if (!isSyncSessionEpochCurrent(roundEpoch)) {
        appendMarketDebug('catalog_sync_skip_stale_epoch', {
          stage: 'before_prepare_save',
          roundEpoch,
          currentEpoch: getSyncSessionEpoch(),
        });
        return interruptedResult(roundEpoch, 'stale sync epoch before prepare save', 'before_prepare_save');
      }
      if (await shouldAbortForHigherPriorityWork('before_prepare_save')) {
        return interruptedResult(roundEpoch, 'wallet send pending', 'before_prepare_save');
      }
      commitSyncState(state, { writeJson: true, refresh: false });
      phaseTimer.mark('prepare_saved');
      updateSyncStage('prepare_saved');
      if (await shouldAbortForHigherPriorityWork('after_prepare_saved')) {
        return interruptedResult(roundEpoch, 'wallet send pending', 'after_prepare_saved');
      }
      const epochSkipHeaderSync = Number(state?.sync?.skipHeaderSyncEpoch);
      const effectiveSkipHeaderSync = options?.skipHeaderSync === true
        || (Number.isFinite(epochSkipHeaderSync) && epochSkipHeaderSync === roundEpoch);
      const skipHeaderSyncReason = options?.skipHeaderSync === true
        ? String(options?.skipHeaderSyncReason || 'manual_sync_bhs')
        : ((Number.isFinite(epochSkipHeaderSync) && epochSkipHeaderSync === roundEpoch) ? 'manual_sync_bhs_epoch' : '');
      const epochSkipForwardProbe = Number(state?.sync?.skipForwardProbeEpoch);
      const effectiveSkipForwardProbe = options?.skipForwardProbe === true
        || (Number.isFinite(epochSkipForwardProbe) && epochSkipForwardProbe === roundEpoch);
      const skipForwardProbeReason = options?.skipForwardProbe === true
        ? String(options?.skipForwardProbeReason || 'manual_sync')
        : ((Number.isFinite(epochSkipForwardProbe) && epochSkipForwardProbe === roundEpoch) ? 'manual_sync_epoch' : '');
      const trustedSyncSnapshot = state.__trustedSyncSnapshot || options?.trustedSyncSnapshot || null;
      const mergeResult = shouldFastPathRecentNoopSync(state, trustedSyncSnapshot)
        ? (() => {
            appendMarketDebug('catalog_sync_fastpath_skip_noop_round', {
              roundEpoch,
              localHeight: Math.max(0, Number(state?.sync?.localHeight || 0)),
              networkHeight: Math.max(0, Number(state?.sync?.networkHeight || 0)),
              targetHeight: Math.max(0, Number(state?.sync?.targetHeight || 0)),
              p2pTipHeight: Math.max(0, Number(state?.sync?.p2pTipHeight || 0)),
              p2pHeaderCursorHeight: Number.isFinite(Number(state?.sync?.p2pHeaderCursorHeight))
                ? Number(state?.sync?.p2pHeaderCursorHeight)
                : -1,
              lastP2PForwardProbeAt: String(state?.sync?.lastP2PForwardProbeAt || ''),
              lastP2PAdvanceAt: String(state?.sync?.lastP2PAdvanceAt || ''),
              fastpathWindowMs: NOOP_SYNC_FASTPATH_WINDOW_MS,
            });
            return {
              scannedBlocks: 0,
              scannedTx: 0,
              addedAnchors: 0,
              skipped: 'recent_noop_sync',
            };
          })()
        : await mergeAnchorsFromChain(req, state, {
            includeFixedHeight: true,
            includeGlobalCache: true,
            trustedSyncSnapshot: options?.trustedSyncSnapshot,
            syncEpoch: roundEpoch,
            skipHeaderSync: effectiveSkipHeaderSync,
            skipHeaderSyncReason,
            skipForwardProbe: effectiveSkipForwardProbe,
            skipForwardProbeReason,
            onStage: (stage, extra = {}) => {
              const summary = summarizeJobStage('run_chain_sync', stage, extra);
              void updateJobState({
                stage: summary.stage,
                progressCurrent: summary.progressCurrent,
                progressTotal: summary.progressTotal,
              }).catch(() => {});
              if (typeof options?.onStage === 'function') {
                try {
                  options.onStage(stage, extra, summary);
                } catch (_) {}
              }
            },
          });
      if (mergeResult?.cancelled === true) {
        return interruptedResult(roundEpoch, 'sync cancelled by newer epoch', 'merge_anchors');
      }
      phaseTimer.mark('merge_anchors_done');
      updateSyncStage('merge_anchors_done');
      if (await shouldAbortForHigherPriorityWork('after_merge_anchors')) {
        return interruptedResult(roundEpoch, 'wallet send pending', 'after_merge_anchors');
      }
      await reconcileBroadcastedLocalChanges(state);
      phaseTimer.mark('reconcile_local_changes_done');
      updateSyncStage('reconcile_local_changes_done');
      if (await shouldAbortForHigherPriorityWork('after_reconcile_local_changes')) {
        return interruptedResult(roundEpoch, 'wallet send pending', 'after_reconcile_local_changes');
      }
      await reconcileBroadcastedChatMessages(state);
      phaseTimer.mark('reconcile_chat_messages_done');
      updateSyncStage('reconcile_chat_messages_done');
      if (await shouldAbortForHigherPriorityWork('after_reconcile_chat_messages')) {
        return interruptedResult(roundEpoch, 'wallet send pending', 'after_reconcile_chat_messages');
      }
      if (getQueuedPushPassword()) {
        processLocalChangeQueueInBackground(req, getQueuedPushPassword()).catch((err) => {
          appendMarketDebug('push_worker_crashed', {
            message: String(err?.message || 'push worker crashed'),
          });
        });
      }
      if (!isSyncSessionEpochCurrent(roundEpoch)) {
        appendMarketDebug('catalog_sync_skip_stale_epoch', {
          stage: 'after_merge',
          roundEpoch,
          currentEpoch: getSyncSessionEpoch(),
        });
        return interruptedResult(roundEpoch, 'stale sync epoch after merge', 'after_merge');
      }
      rebuildCatalogFromAnchors(state, req);
      mergeLatestPendingQueueIntoState(state);
      applyPendingChangesOnTop(state);
      phaseTimer.mark('catalog_rebuilt');
      updateSyncStage('catalog_rebuilt');
      if (await shouldAbortForHigherPriorityWork('after_catalog_rebuilt')) {
        return interruptedResult(roundEpoch, 'wallet send pending', 'after_catalog_rebuilt');
      }
      if (!isSyncSessionEpochCurrent(roundEpoch)) {
        appendMarketDebug('catalog_sync_skip_stale_epoch', {
          stage: 'before_final_save',
          roundEpoch,
          currentEpoch: getSyncSessionEpoch(),
        });
        return interruptedResult(roundEpoch, 'stale sync epoch before final save', 'before_final_save');
      }
      const latestRuntimeState = getStateWithRuntimeSync(loadProjectionState());
      phaseTimer.mark('final_state_merged');
      updateSyncStage('final_state_merged');
      const finalState = await syncBusinessPipeline.finalizeSyncBusinessState({
        roundEpoch,
        latestRuntimeState,
        state,
        syncFinalFollowupDelayMs: getSyncFinalFollowupDelayMs(),
        phaseTimer,
        updateSyncStage,
      }, buildSyncBusinessPipelineDeps());
      return {
        interrupted: false,
        state: finalState,
      };
    })();
    catalogSyncInFlightPromise = currentPromise;
    let result;
    try {
      result = await currentPromise;
    } finally {
      if (catalogSyncInFlightPromise === currentPromise) {
        catalogSyncInFlightPromise = null;
        catalogSyncInFlightEpoch = null;
      }
    }
    if (result?.interrupted === true) return result;
    if (result?.state && typeof result.state === 'object') return result.state;
    return loadProjectionState();
  }

  return {
    runCatalogSyncSerial,
  };
}

module.exports = {
  createSyncWorkerRuntime,
};
