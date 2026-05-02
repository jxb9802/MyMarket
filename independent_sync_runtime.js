const serverMarket = require('./server_market');
const wallet = require('./wallet');
const p2pNodeRuntime = require('./p2p_node_runtime');

function nowIso() {
  return new Date().toISOString();
}

function emitEvent(logger, event, payload = {}) {
  if (typeof logger !== 'function') return;
  try {
    logger(event, payload);
  } catch (_) {}
}

function buildSyncCancelledError() {
  const err = new Error('sync cancelled');
  err.code = 'SYNC_CANCELLED';
  return err;
}

function defaultStatus() {
  return {
    version: 1,
    phase: 'idle',
    active: false,
    startedAt: '',
    updatedAt: '',
    startHeight: 0,
    targetHeight: 0,
    localHeight: 0,
    completedCount: 0,
    failedCount: 0,
    activeNodeCount: 0,
    activeNodes: [],
    successNodeCount: 0,
    successNodes: [],
    lastWindow: null,
    lastError: '',
    windows: [],
  };
}

let runtimeStatus = defaultStatus();
const syncPeerSessions = new Map();
const EVENT_LOOP_YIELD_INTERVAL = Math.max(50, Number(process.env.BSV_MARKET_SYNC_EVENT_LOOP_YIELD_INTERVAL || 250));

function yieldToEventLoop() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function maybeYieldToEventLoop(lastYieldAt, intervalMs = EVENT_LOOP_YIELD_INTERVAL) {
  const now = Date.now();
  if ((now - Number(lastYieldAt || 0)) < Math.max(0, Number(intervalMs || 0))) return now;
  await yieldToEventLoop();
  return Date.now();
}

function loadStatus() {
  return {
    ...runtimeStatus,
    activeNodes: Array.isArray(runtimeStatus.activeNodes) ? runtimeStatus.activeNodes.slice() : [],
    successNodes: Array.isArray(runtimeStatus.successNodes) ? runtimeStatus.successNodes.slice() : [],
    windows: Array.isArray(runtimeStatus.windows) ? runtimeStatus.windows.slice() : [],
  };
}

function saveStatus(next) {
  runtimeStatus = {
    ...defaultStatus(),
    ...(next || {}),
    activeNodes: Array.isArray(next?.activeNodes) ? next.activeNodes.slice() : [],
    successNodes: Array.isArray(next?.successNodes) ? next.successNodes.slice() : [],
    windows: Array.isArray(next?.windows) ? next.windows.slice() : [],
  };
  return loadStatus();
}

async function releaseSyncPeerSession(node, outcome = 'sync_done') {
  const endpoint = String(node || '').trim();
  if (!endpoint) return;
  const session = syncPeerSessions.get(endpoint);
  if (!session) return;
  syncPeerSessions.delete(endpoint);
  try {
    await session.release({ outcome });
  } catch (_) {}
}

async function releaseAllSyncPeerSessions(outcome = 'sync_done') {
  const nodes = Array.from(syncPeerSessions.keys());
  for (const node of nodes) {
    // eslint-disable-next-line no-await-in-loop
    await releaseSyncPeerSession(node, outcome);
  }
}

async function getOrCreateSyncPeerSession(node, options = {}) {
  const endpoint = String(node || '').trim();
  if (!endpoint) throw new Error('invalid sync node');
  const existing = syncPeerSessions.get(endpoint);
  if (existing && typeof existing.isConnected === 'function' && existing.isConnected()) {
    return existing;
  }
  if (existing) await releaseSyncPeerSession(endpoint, 'stale_sync_session');
  const session = await p2pNodeRuntime.connectSession(
    null,
    {
      node: endpoint,
      purpose: 'sync_block',
      mode: 'persistent',
      connectTimeoutMs: Math.max(1000, Number(options.connectTimeoutMs || 8000)),
      stream: true,
    },
  );
  syncPeerSessions.set(endpoint, session);
  return session;
}

function normalizeSyncState(state) {
  const next = state && typeof state === 'object' ? state : serverMarket.buildProjectionBackedState();
  if (!next.sync || typeof next.sync !== 'object') next.sync = {};
  if (!Array.isArray(next.anchors)) next.anchors = [];
  next.sync.localHeight = Math.max(0, Number(next.sync.localHeight || 0));
  next.sync.fixedSyncLastHeight = Math.max(0, Number(next.sync.fixedSyncLastHeight || 0));
  next.sync.p2pGapHeights = Array.isArray(next.sync.p2pGapHeights) ? next.sync.p2pGapHeights : [];
  return next;
}

async function commitSuccessfulBlock(state, blockState, options = {}) {
  const startedAt = Date.now();
  const onEvent = typeof options?.onEvent === 'function' ? options.onEvent : null;
  const deferSave = options?.deferSave !== false;
  const shouldCancel = typeof options?.shouldCancel === 'function' ? options.shouldCancel : null;
  const winner = blockState?.winner || null;
  const block = winner?.block || null;
  const streamed = winner?.streamed || null;
  if (!winner || (!block && !streamed)) {
    throw new Error(`missing winner block for height ${Number(blockState?.height || 0)}`);
  }
  if (shouldCancel && shouldCancel()) throw buildSyncCancelledError();
  const height = Number(blockState.height || 0);
  const node = String(winner.node || '');
  const hash = String(blockState.hash || '').trim().toLowerCase();
  const fallbackTs = nowIso();
  let lastYieldAt = startedAt;
  let extracted = streamed;
  let extractElapsedMs = 0;
  if (!extracted) {
    const extractStartedAt = Date.now();
    extracted = await serverMarket.extractAnchorRowsFromP2PBlock(block, fallbackTs, height, node);
    extractElapsedMs = Date.now() - extractStartedAt;
  } else {
    extractElapsedMs = Math.max(0, Number(winner?.extractElapsedMs || 0));
  }
  if (winner && typeof winner === 'object') {
    delete winner.stream;
    delete winner.block;
    delete winner.streamed;
    delete winner.processor;
  }
  lastYieldAt = await maybeYieldToEventLoop(lastYieldAt);
  const rows = Array.isArray(extracted?.rows) ? extracted.rows : [];
  const txCount = Math.max(0, Number(extracted?.txCount || 0));
  const walletTxSummaries = Array.isArray(extracted?.walletTxSummaries) ? extracted.walletTxSummaries : [];
  if (shouldCancel && shouldCancel()) throw buildSyncCancelledError();

  let walletAppliedCount = 0;
  let walletSummarySortElapsedMs = 0;
  let walletSummaryApplyElapsedMs = 0;
  let walletSummaryCount = walletTxSummaries.length;
  let walletSummaryWithOutputsCount = 0;
  let walletSummaryWithInputsCount = 0;
  if (walletTxSummaries.length > 0 && typeof wallet.applyConfirmedTxSummaryToSpvIndex === 'function') {
    const walletSummarySortStartedAt = Date.now();
    const sortedWalletTxSummaries = walletTxSummaries.slice().sort((a, b) => Number(a?.txIndex || 0) - Number(b?.txIndex || 0));
    walletSummarySortElapsedMs = Date.now() - walletSummarySortStartedAt;
    walletSummaryWithOutputsCount = sortedWalletTxSummaries.reduce(
      (sum, summary) => sum + (((Array.isArray(summary?.walletOutputs) ? summary.walletOutputs.length : 0) > 0) ? 1 : 0),
      0,
    );
    walletSummaryWithInputsCount = sortedWalletTxSummaries.reduce(
      (sum, summary) => sum + (((Array.isArray(summary?.inputs) ? summary.inputs.length : 0) > 0) ? 1 : 0),
      0,
    );
    const walletSummaryApplyStartedAt = Date.now();
    let walletSummaryIndex = 0;
    for (const summary of sortedWalletTxSummaries) {
      if (wallet.applyConfirmedTxSummaryToSpvIndex(summary, {
        confirmed: true,
        source: 'independent_sync_commit',
      })) {
        walletAppliedCount += 1;
      }
      walletSummaryIndex += 1;
      if ((walletSummaryIndex % 256) === 0) {
        lastYieldAt = await maybeYieldToEventLoop(lastYieldAt);
      }
    }
    walletSummaryApplyElapsedMs = Date.now() - walletSummaryApplyStartedAt;
  }

  lastYieldAt = await maybeYieldToEventLoop(lastYieldAt);
  const mergeStartedAt = Date.now();
  const addedAnchors = serverMarket.mergeRowsIntoStateAnchors(state, rows);
  if (rows.length > 0) serverMarket.mergeIntoGlobalAnchorCache(rows);
  serverMarket.cacheP2PHeightHash(state, height, hash);
  let receipts = null;
  if (!deferSave) {
    const perHeight = {
      [String(height)]: {
        hash,
        persistedAt: fallbackTs,
        rowsFound: rows.length,
        txCount,
      },
    };
    receipts = serverMarket.recordPersistedP2PSyncRound({
      bootstrapHeight: Number(state?.sync?.bootstrapHeight || 0),
      committedHeight: height,
      perHeight,
    });
  }
  const mergeElapsedMs = Date.now() - mergeStartedAt;
  lastYieldAt = await maybeYieldToEventLoop(lastYieldAt);
  const saveStartedAt = Date.now();
  state.sync.fixedSyncLastHeight = Math.max(Number(state.sync.fixedSyncLastHeight || 0), Number(receipts?.committedHeight || height));
  state.sync.localHeight = Math.max(Number(state.sync.localHeight || 0), height);
  state.sync.lastP2PAdvanceAt = fallbackTs;
  state.sync.manualQuickstartPending = false;
  state.sync.p2pGapHeights = Array.isArray(state.sync.p2pGapHeights)
    ? state.sync.p2pGapHeights.filter((gap) => Number(gap) > Number(state.sync.localHeight || 0))
    : [];
  serverMarket.trimP2PHeightHashCache(state, Math.max(0, Number(state.sync.localHeight || 0) - 8000));
  let saveElapsedMs = 0;
  if (!deferSave) {
    if (shouldCancel && shouldCancel()) throw buildSyncCancelledError();
    await serverMarket.commitSyncStateNow(state, {
      reason: 'independent_sync_commit_block_saved',
      refresh: false,
      writeJson: true,
      walletImpact: {
        walletAppliedCount,
        walletSummaryCount,
      },
    });
    saveElapsedMs = Date.now() - saveStartedAt;
  }
  const totalElapsedMs = Date.now() - startedAt;
  if (walletSummaryCount > 0 && (walletSummaryApplyElapsedMs >= 100 || walletSummarySortElapsedMs >= 50)) {
    emitEvent(onEvent, 'independent_sync_wallet_summary_profile', {
      height,
      node,
      txCount,
      walletSummaryCount,
      walletSummaryWithOutputsCount,
      walletSummaryWithInputsCount,
      walletAppliedCount,
      walletSummarySortElapsedMs,
      walletSummaryApplyElapsedMs,
      walletSummaryAvgApplyMs: walletSummaryCount > 0
        ? Number((walletSummaryApplyElapsedMs / walletSummaryCount).toFixed(3))
        : 0,
    });
  }
  if (totalElapsedMs >= 500 || extractElapsedMs >= 300 || mergeElapsedMs >= 300 || saveElapsedMs >= 200) {
    emitEvent(onEvent, 'independent_sync_commit_block_profile', {
      height,
      node,
      txCount,
      rowsFound: rows.length,
      addedAnchors,
      walletSummaryCount,
      walletSummaryWithOutputsCount,
      walletSummaryWithInputsCount,
      walletAppliedCount,
      walletSummarySortElapsedMs,
      walletSummaryApplyElapsedMs,
      extractElapsedMs,
      mergeElapsedMs,
      saveElapsedMs,
      totalElapsedMs,
    });
  }
  return {
    height,
    hash,
    persistedAt: fallbackTs,
    txCount,
    rowsFound: rows.length,
    addedAnchors,
    walletAppliedCount,
    extractElapsedMs,
    mergeElapsedMs,
    saveElapsedMs,
    totalElapsedMs,
  };
}

async function fetchStreamedBlockFresh(node, hash, options = {}) {
  const startedAt = Date.now();
  const connectTimeoutMs = Math.max(1000, Number(options.connectTimeoutMs || 8000));
  try {
    const session = await getOrCreateSyncPeerSession(node, { connectTimeoutMs });
    const peer = session.peer;
    const extractStartedAt = Date.now();
    const streamed = await serverMarket.extractAnchorRowsFromStreamedPeer(
      peer,
      hash,
      nowIso(),
      Number(options.height || 0),
      node,
      {
        idleTimeoutMs: Number(options.idleTimeoutMs || 10000),
        hardTimeoutMs: Number(options.hardTimeoutMs || 1800000),
        minStreamBytesPerSec: Number(options.minStreamBytesPerSec || 0),
        streamSpeedGraceMs: Number(options.streamSpeedGraceMs || 15000),
        abortSignal: options.abortSignal || null,
        onEvent: typeof options.onEvent === 'function' ? options.onEvent : null,
        label: `sync_stream_h${Number(options.height || 0)}`,
      },
    );
    const extractElapsedMs = Date.now() - extractStartedAt;
    const firstDataElapsedMs = Number(streamed?.stream?.firstDataElapsedMs || 0);
    const streamPayloadBytesPerSec = Number(streamed?.stream?.streamPayloadBytesPerSec || 0);
    const scoringLatencyMs = firstDataElapsedMs > 0 ? firstDataElapsedMs : (Date.now() - startedAt);
    await session.reportSuccess({
      latencyMs: scoringLatencyMs,
      purpose: 'sync_block',
      downloadBytesPerSec: streamPayloadBytesPerSec,
    });
    return {
      ok: true,
      node,
      streamed,
      connectElapsedMs: Number(session.connectElapsedMs || 0),
      firstDataElapsedMs,
      getBlockElapsedMs: Number(streamed?.stream?.elapsedMs || extractElapsedMs),
      extractElapsedMs,
      totalElapsedMs: Date.now() - startedAt,
      streamPayloadBytes: Number(streamed?.stream?.streamPayloadBytes || 0),
      streamPayloadElapsedMs: Number(streamed?.stream?.streamPayloadElapsedMs || 0),
      streamPayloadBytesPerSec,
      txCount: Number(streamed?.txCount || 0),
      rowsFound: Array.isArray(streamed?.rows) ? streamed.rows.length : 0,
    };
  } catch (err) {
    await releaseSyncPeerSession(node, 'sync_block_failed');
    return {
      ok: false,
      node,
      connectElapsedMs: 0,
      totalElapsedMs: Date.now() - startedAt,
      error: String(err?.message || 'stream sync failed'),
    };
  }
}

async function commitWindow({ windowStart, windowEnd, blocks, preferredNodes, onEvent, shouldCancel }) {
  if (typeof shouldCancel === 'function' && shouldCancel()) throw buildSyncCancelledError();
  const loadStartedAt = Date.now();
  const state = normalizeSyncState(serverMarket.buildProjectionBackedState());
  const loadElapsedMs = Date.now() - loadStartedAt;
  const bootstrapHeight = Math.max(1, Number(state?.sync?.bootstrapHeight || 1));
  const initialCommittedHeight = Math.max(
    bootstrapHeight - 1,
    Number(state?.sync?.fixedSyncLastHeight || 0),
    Number(state?.sync?.localHeight || 0),
  );
  const committed = [];
  const commitStartedAt = Date.now();
  for (const blockState of (Array.isArray(blocks) ? blocks : []).slice().sort((a, b) => Number(a.height || 0) - Number(b.height || 0))) {
    if (!blockState || blockState.success !== true) continue;
    if (typeof shouldCancel === 'function' && shouldCancel()) throw buildSyncCancelledError();
    // eslint-disable-next-line no-await-in-loop
    committed.push(await commitSuccessfulBlock(state, blockState, {
      onEvent,
      deferSave: true,
      shouldCancel,
    }));
  }
  const committedByHeight = new Map(
    committed.map((row) => [Number(row?.height || 0), row]),
  );
  let receiptCommittedHeight = initialCommittedHeight;
  const contiguousReceiptMeta = {};
  for (let height = initialCommittedHeight + 1; committedByHeight.has(height); height += 1) {
    const row = committedByHeight.get(height);
    receiptCommittedHeight = height;
    contiguousReceiptMeta[String(height)] = {
      hash: String(row?.hash || '').trim().toLowerCase(),
      persistedAt: String(row?.persistedAt || nowIso()),
      rowsFound: Math.max(0, Number(row?.rowsFound || 0)),
      txCount: Math.max(0, Number(row?.txCount || 0)),
    };
  }
  let receipts = null;
  if (receiptCommittedHeight > initialCommittedHeight) {
    receipts = serverMarket.recordPersistedP2PSyncRound({
      bootstrapHeight,
      committedHeight: receiptCommittedHeight,
      perHeight: contiguousReceiptMeta,
    });
  }
  state.sync.fixedSyncLastHeight = Math.max(
    initialCommittedHeight,
    Number(receipts?.committedHeight || receiptCommittedHeight || initialCommittedHeight),
  );
  state.sync.localHeight = Math.max(
    initialCommittedHeight,
    Number(state?.sync?.localHeight || 0),
    Number(state?.sync?.fixedSyncLastHeight || 0),
  );
  if (Number(state.sync.localHeight || 0) > Number(state.sync.fixedSyncLastHeight || 0)) {
    state.sync.localHeight = Number(state.sync.fixedSyncLastHeight || state.sync.localHeight || 0);
  }
  if (Number(state.sync.fixedSyncLastHeight || 0) > Number(state.sync.localHeight || 0)) {
    state.sync.localHeight = Number(state.sync.fixedSyncLastHeight || 0);
  }
  const commitElapsedMs = Date.now() - commitStartedAt;
  const stateSaveStartedAt = Date.now();
  if (typeof shouldCancel === 'function' && shouldCancel()) throw buildSyncCancelledError();
  const totalWalletAppliedCount = committed.reduce((sum, row) => sum + Number(row?.walletAppliedCount || 0), 0);
  const totalWalletSummaryCount = committed.reduce((sum, row) => sum + Number(row?.walletSummaryCount || 0), 0);
  serverMarket.commitSyncState(state, {
    reason: 'independent_sync_commit_window_saved',
    refresh: false,
    writeJson: true,
    walletImpact: {
      walletAppliedCount: totalWalletAppliedCount,
      walletSummaryCount: totalWalletSummaryCount,
    },
  });
  const stateSaveElapsedMs = Date.now() - stateSaveStartedAt;
  const walletStatsStartedAt = Date.now();
  let walletIndexStats = null;
  try {
    walletIndexStats = typeof wallet.getLocalIndexStats === 'function' ? wallet.getLocalIndexStats() : null;
  } catch (_) {
    walletIndexStats = null;
  }
  const walletStatsElapsedMs = Date.now() - walletStatsStartedAt;
  const statusSaveStartedAt = Date.now();
  if (typeof shouldCancel === 'function' && shouldCancel()) throw buildSyncCancelledError();
  const status = loadStatus();
  status.phase = 'window_committed';
  status.active = true;
  status.updatedAt = nowIso();
  status.localHeight = Number(state?.sync?.localHeight || 0);
  status.completedCount += committed.length;
  status.successNodes = Array.isArray(preferredNodes) ? preferredNodes.slice(0, 64) : [];
  status.successNodeCount = status.successNodes.length;
  status.lastWindow = {
    startHeight: Number(windowStart || 0),
    endHeight: Number(windowEnd || 0),
    committedCount: committed.length,
    localHeight: status.localHeight,
    walletIndexStats: walletIndexStats ? {
      spendableCount: Number(walletIndexStats.spendableCount || 0),
      confirmedUtxoCount: Number(walletIndexStats.confirmedUtxoCount || 0),
      contextReadyCount: Number(walletIndexStats.contextReadyCount || 0),
      totalKnownTxs: Number(walletIndexStats.totalKnownTxs || 0),
      updatedAt: String(walletIndexStats.updatedAt || ''),
    } : null,
  };
  status.windows.push(status.lastWindow);
  saveStatus(status);
  const statusSaveElapsedMs = Date.now() - statusSaveStartedAt;
  const totalElapsedMs = loadElapsedMs + commitElapsedMs + walletStatsElapsedMs + statusSaveElapsedMs;
  emitEvent(onEvent, 'independent_sync_commit_window_profile', {
    windowStart: Number(windowStart || 0),
    windowEnd: Number(windowEnd || 0),
    committedCount: committed.length,
    receiptCommittedHeight,
    initialCommittedHeight,
    loadElapsedMs,
    commitElapsedMs,
    stateSaveElapsedMs,
    walletStatsElapsedMs,
    statusSaveElapsedMs,
    totalElapsedMs: totalElapsedMs + stateSaveElapsedMs,
    totalRowsFound: committed.reduce((sum, row) => sum + Number(row?.rowsFound || 0), 0),
    totalTxCount: committed.reduce((sum, row) => sum + Number(row?.txCount || 0), 0),
    totalAddedAnchors: committed.reduce((sum, row) => sum + Number(row?.addedAnchors || 0), 0),
    totalWalletAppliedCount,
    totalWalletSummaryCount,
    slowBlocks: committed
      .filter((row) => Number(row?.totalElapsedMs || 0) >= 500)
      .slice(0, 8)
      .map((row) => ({
        height: Number(row?.height || 0),
        totalElapsedMs: Number(row?.totalElapsedMs || 0),
        extractElapsedMs: Number(row?.extractElapsedMs || 0),
        mergeElapsedMs: Number(row?.mergeElapsedMs || 0),
        saveElapsedMs: Number(row?.saveElapsedMs || 0),
        txCount: Number(row?.txCount || 0),
        rowsFound: Number(row?.rowsFound || 0),
        addedAnchors: Number(row?.addedAnchors || 0),
      })),
  });
  return {
    state,
    status,
    committed,
    stateSaveElapsedMs,
  };
}

async function startRun({ startHeight, targetHeight }) {
  const state = normalizeSyncState(serverMarket.buildProjectionBackedState());
  serverMarket.commitSyncState(state, {
    reason: 'independent_sync_start_saved',
    refresh: false,
    writeJson: true,
  });
  const status = defaultStatus();
  status.phase = 'running';
  status.active = true;
  status.startedAt = nowIso();
  status.updatedAt = status.startedAt;
  status.startHeight = Math.max(0, Number(startHeight || 0));
  status.targetHeight = Math.max(0, Number(targetHeight || 0));
  status.localHeight = Number(state?.sync?.localHeight || 0);
  saveStatus(status);
  return { state, status };
}

function updateTargetHeight(targetHeight) {
  const status = loadStatus();
  status.updatedAt = nowIso();
  status.targetHeight = Math.max(Number(status.targetHeight || 0), Number(targetHeight || 0));
  saveStatus(status);
  return status;
}

function updateActivity({ phase = '', activeNodes = [] } = {}) {
  const nextNodes = Array.from(new Set(
    (Array.isArray(activeNodes) ? activeNodes : [])
      .map((node) => String(node || '').trim())
      .filter(Boolean),
  ));
  const status = loadStatus();
  if (phase) status.phase = String(phase);
  status.updatedAt = nowIso();
  status.activeNodes = nextNodes;
  status.activeNodeCount = nextNodes.length;
  saveStatus(status);
  return status;
}

function finishRun({ summary, error = null }) {
  const status = loadStatus();
  releaseAllSyncPeerSessions(error ? 'sync_run_failed' : 'sync_run_done').catch(() => {});
  status.phase = error ? 'failed' : 'done';
  status.active = false;
  status.updatedAt = nowIso();
  status.activeNodeCount = 0;
  status.activeNodes = [];
  status.lastError = error ? String(error?.message || error) : '';
  if (summary) {
    status.completedCount = Math.max(Number(status.completedCount || 0), Number(summary.completedCount || 0));
    status.failedCount = Number(summary.failedCount || 0);
    status.successNodes = Array.isArray(summary.successNodes) ? summary.successNodes.slice(0, 64) : [];
    status.successNodeCount = status.successNodes.length;
    status.localHeight = Math.max(
      Number(status.localHeight || 0),
      Number(summary.localHeight || 0),
    );
  }
  saveStatus(status);
  return status;
}

function cancelActiveRun(reason = 'sync cancelled') {
  const status = loadStatus();
  releaseAllSyncPeerSessions('sync_run_cancelled').catch(() => {});
  status.phase = 'idle';
  status.active = false;
  status.updatedAt = nowIso();
  status.activeNodeCount = 0;
  status.activeNodes = [];
  status.lastError = String(reason || 'sync cancelled');
  saveStatus(status);
  return status;
}

function resetStatus(options = {}) {
  releaseAllSyncPeerSessions('sync_run_reset').catch(() => {});
  const bootstrapHeight = Math.max(0, Number(options?.bootstrapHeight || 0));
  const localHeight = Math.max(0, Number(options?.localHeight ?? (bootstrapHeight > 0 ? (bootstrapHeight - 1) : 0)));
  const targetHeight = Math.max(0, Number(options?.targetHeight || 0));
  return saveStatus({
    ...defaultStatus(),
    phase: 'idle',
    active: false,
    updatedAt: nowIso(),
    startHeight: bootstrapHeight,
    targetHeight,
    localHeight,
    lastError: '',
  });
}

module.exports = {
  cancelActiveRun,
  loadStatus,
  resetStatus,
  saveStatus,
  startRun,
  updateTargetHeight,
  updateActivity,
  fetchStreamedBlockFresh,
  commitWindow,
  finishRun,
};
