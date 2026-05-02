function createSyncDomainAdapters(deps = {}) {
  const {
    getBhsTipSnapshot,
    getIndependentSyncDisplaySnapshot,
    buildSyncDomainConnectedNodeSnapshot,
    getLagDrivenSyncPolicy,
    deriveSyncNodePool,
    loadP2PSyncReceipts,
    FIXED_SYNC_BOOTSTRAP_HEIGHT,
    notifyStewardSyncNow,
    syncBhsRuntimeToDomainIfChanged,
    bhsDomain,
    messageQueue,
    getTrustedSyncSnapshot,
  } = deps;

  return {
    getBhsSnapshot: () => getBhsTipSnapshot(),
    getIndependentSyncSnapshot: () => getIndependentSyncDisplaySnapshot(),
    getConnectedNodeSnapshot: () => buildSyncDomainConnectedNodeSnapshot(),
    getLagPolicy: (syncState) => getLagDrivenSyncPolicy({ sync: syncState || {} }),
    deriveSyncNodePool: (syncWorker) => deriveSyncNodePool(syncWorker),
    getReceiptCommittedHeight: () => Number(loadP2PSyncReceipts(FIXED_SYNC_BOOTSTRAP_HEIGHT)?.committedHeight || 0),
    notifySyncNow: () => notifyStewardSyncNow(),
    primeBhsTip: async () => {
      const result = await syncBhsRuntimeToDomainIfChanged({
        forcePersistProjection: true,
        reason: 'sync_domain_startup',
      });
      const projected = result?.status || bhsDomain.getBhsStatusSync('main');
      await messageQueue.publish('bhs.tip.changed', {
        tipHeight: Math.max(0, Number(projected?.tipHeight || 0)),
        tipHash: String(projected?.tipHash || '').trim().toLowerCase(),
      }, {
        mode: 'transient',
        source: 'sync_domain_startup',
      });
    },
    buildAutoSyncCommandPayload: ({ reason, runtime }) => {
      const trustedSync = getTrustedSyncSnapshot((runtime?.status?.sync && typeof runtime.status.sync === 'object') ? runtime.status.sync : {});
      const policy = getLagDrivenSyncPolicy({ sync: trustedSync });
      return {
        payload: {
          source: String(reason || 'sync_domain'),
          options: {
            syncNodeBudget: policy.syncNodeBudget,
            adaptiveParallelism: true,
            adaptiveInitialParallelBlocks: 2,
            maxAdaptiveParallelBlocks: Math.max(2, Number(policy.syncNodeBudget || 2)),
            adaptiveEvalBlocks: 10,
            adaptiveSuccessThreshold: 0.9,
            leasesPerBlock: 1,
            backupLeasesPerBlock: 2,
            parallelBlocks: 2,
            dynamicTargetHeight: true,
            trustedSyncSnapshot: trustedSync,
          },
        },
        options: { dedupePending: true },
      };
    },
  };
}

module.exports = {
  createSyncDomainAdapters,
};
