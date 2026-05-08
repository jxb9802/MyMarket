const marketDb = require('./market_db');
const bhsDomain = require('./bhs_domain');
const messageQueue = require('./lib/message_queue');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SYNC_CONSUMER = 'sync_projection_writer_v1';
const SYNC_SCOPE = 'main';
const SYNC_COMMAND_QUEUE = 'sync.command';
const FINAL_COMMAND_STATUSES = new Set(['done', 'failed', 'interrupted']);
const ALLOW_SYNC_PROJECTION_CATCHUP = String(process.env.BSV_MARKET_ALLOW_SYNC_PROJECTION_CATCHUP || (process.env.BSV_MARKET_HEADLESS_RUNTIME === '1' ? '0' : '1')) === '1';
const USE_PARENT_PROXY = process.env.BSV_MARKET_SYNC_PARENT_PROXY === '1' && typeof process.send === 'function';
const parentProxyRequests = new Map();
let parentProxyListenerAttached = false;
let syncProjectionCache = null;
let projectionPersistTimer = null;
let projectionPersistPending = false;
let projectionPersistPromise = null;
let projectionPersistLastSignature = '';
const SYNC_JOB_UPDATE_DEBOUNCE_MS = Math.max(50, Number(process.env.BSV_MARKET_SYNC_JOB_UPDATE_DEBOUNCE_MS || 250));
const SYNC_JOB_UPDATE_THROTTLE_MS = Math.max(250, Number(process.env.BSV_MARKET_SYNC_JOB_UPDATE_THROTTLE_MS || 1500));
const SYNC_PROJECTION_COMMAND_DEBOUNCE_MS = Math.max(
  SYNC_JOB_UPDATE_THROTTLE_MS,
  Number(process.env.BSV_MARKET_SYNC_PROJECTION_COMMAND_DEBOUNCE_MS || SYNC_JOB_UPDATE_THROTTLE_MS),
);
const SYNC_PROJECTION_PERSIST_MAX_WAIT_MS = Math.max(
  SYNC_JOB_UPDATE_DEBOUNCE_MS,
  Number(process.env.BSV_MARKET_SYNC_PROJECTION_PERSIST_MAX_WAIT_MS || 2000),
);
const SYNC_FINAL_COMMAND_HISTORY_LIMIT = Math.max(20, Number(process.env.BSV_MARKET_SYNC_FINAL_COMMAND_HISTORY_LIMIT || 80));
let lastSyncJobUpdateSignature = '';
let lastSyncJobUpdateAt = 0;
let projectionPersistPendingSinceMs = 0;
let syncDomainAdapters = {};
let syncDomainStarted = false;
let runtimeBhsSubscribed = false;
let runtimeControlSubscribed = false;
let syncRuntimeState = null;
const runtimeListeners = new Set();
let runtimeRefreshTimer = null;
let runtimeRefreshPendingReason = '';
let runtimeRefreshInFlight = null;
let runtimeSummaryTimer = null;
let runtimeSummaryPendingReason = '';

function appendSyncProjectionTrace(event, payload = {}) {
  try {
    const file = path.join(marketDb.getLogDir(), 'market_db_trace.log');
    fs.appendFileSync(file, `${JSON.stringify({
      ts: new Date().toISOString(),
      source: 'sync_domain',
      pid: process.pid,
      event,
      ...payload,
    })}\n`);
  } catch (_) {}
}

function nowIso() {
  return new Date().toISOString();
}

function hashProjectionPersistPayload(payload) {
  try {
    return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
  } catch (_) {
    return '';
  }
}

function nextProxyRequestId() {
  return `sync-domain-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function attachParentProxyListener() {
  if (parentProxyListenerAttached || !USE_PARENT_PROXY) return;
  parentProxyListenerAttached = true;
  process.on('message', (message) => {
    if (String(message?.type || '') !== 'sync_domain_proxy_response') return;
    const requestId = String(message?.requestId || '');
    const pending = parentProxyRequests.get(requestId);
    if (!pending) return;
    parentProxyRequests.delete(requestId);
    clearTimeout(pending.timer);
    if (message?.ok) {
      pending.resolve(message.data);
      return;
    }
    const error = new Error(String(message?.error || 'sync_domain parent proxy failed'));
    error.code = String(message?.code || 'SYNC_PARENT_PROXY_FAILED');
    pending.reject(error);
  });
  process.on('disconnect', () => {
    for (const pending of parentProxyRequests.values()) {
      clearTimeout(pending.timer);
      const error = new Error('sync_domain parent proxy disconnected');
      error.code = 'SYNC_PARENT_PROXY_DISCONNECTED';
      pending.reject(error);
    }
    parentProxyRequests.clear();
  });
}

function sendParentProxyRequest(action, payload = {}, timeoutMs = 30000) {
  if (!USE_PARENT_PROXY || typeof process.send !== 'function') {
    return Promise.reject(new Error('sync_domain parent proxy unavailable'));
  }
  attachParentProxyListener();
  return new Promise((resolve, reject) => {
    const requestId = nextProxyRequestId();
    const timer = setTimeout(() => {
      parentProxyRequests.delete(requestId);
      const error = new Error(`sync_domain parent proxy timed out: ${action}`);
      error.code = 'SYNC_PARENT_PROXY_TIMEOUT';
      reject(error);
    }, Math.max(1000, Number(timeoutMs || 0) || 30000));
    parentProxyRequests.set(requestId, { resolve, reject, timer });
    try {
      process.send({
        type: 'sync_domain_proxy_request',
        requestId,
        action,
        payload,
        timeoutMs: Math.max(1000, Number(timeoutMs || 0) || 30000),
      });
    } catch (error) {
      clearTimeout(timer);
      parentProxyRequests.delete(requestId);
      reject(error);
    }
  });
}

function defaultCommandQueueState() {
  return {
    version: 1,
    nextSeq: 1,
    commands: [],
  };
}

function defaultJobState() {
  return {
    version: 1,
    currentJob: null,
    recentJobs: [],
  };
}

function defaultSyncState() {
  return {
    scope: SYNC_SCOPE,
    bootstrapHeight: 0,
    localHeight: 0,
    fixedSyncLastHeight: 0,
    p2pTipHeight: 0,
    p2pTipHash: '',
    p2pHeaderCursorHeight: -1,
    p2pHeaderCursorHash: '',
    online: false,
    mode: '',
    lag: 0,
    sessionEpoch: 0,
    scannedFrom: 0,
    initialSyncCompleted: false,
    manualQuickstartPending: false,
    retries: 0,
    lastP2PForwardProbeAt: '',
    lastP2PAdvanceAt: '',
    lastP2PGoodNodes: 0,
    emptyBackfillTried: false,
    chainSources: [],
    sourceStats: {},
    p2pHeightHashCache: {},
    p2pGapHeights: [],
    p2pNodeStats: {},
    updatedAt: '',
  };
}

function defaultRuntimeState() {
  return {
    lifecycle: {
      loaded: false,
      started: false,
      online: false,
      paused: false,
      autoSyncEnabled: true,
      mode: 'idle',
      ownerProcess: process.pid,
      updatedAt: '',
    },
    bhs: {
      tipHeight: 0,
      tipHash: '',
      ok: false,
      updatedAt: '',
    },
    control: {
      pauseReason: '',
      lastManualTriggerAt: '',
      lastManualTriggerReason: '',
      lastResetAt: '',
      lastResetReason: '',
    },
    queue: {
      pendingCount: 0,
      claimedCount: 0,
      lastCommand: null,
      commands: [],
    },
    job: {
      currentJob: null,
      recentJobs: [],
    },
    progress: {
      bootstrapHeight: 0,
      localHeight: 0,
      highestBlock: 0,
      fixedSyncLastHeight: 0,
      p2pTipHeight: 0,
      p2pHeaderCursorHeight: -1,
      lag: 0,
      targetHeight: 0,
      receiptCommittedHeight: 0,
      syncStartHeight: 0,
      syncedBlocks: 0,
      independentPhase: '',
      independentUpdatedAt: '',
      independentLocalHeight: 0,
      independentTargetHeight: 0,
    },
    nodes: {
      connectedCount: 0,
      activeSyncNodeCount: 0,
      activeSyncNodeList: [],
      nodePool: [],
      syncWorkerNodes: 0,
      syncWorkerNodeList: [],
      spvWorkingNodes: 0,
      onlineNodeList: [],
      candidateNodeList: [],
      candidateNodes: 0,
      totalNodes: 0,
    },
    runtime: {
      lagPolicy: null,
      wallet: null,
      stewardObservedP2P: null,
    },
    status: {
      sync: null,
      runtime: null,
      jobState: null,
      commandQueue: null,
    },
  };
}

function cloneJsonSafe(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return fallback;
  }
}

function summarizeCommand(row = null) {
  if (!row || typeof row !== 'object') return null;
  return {
    id: String(row.id || ''),
    commandType: String(row.commandType || ''),
    status: String(row.status || ''),
    createdAt: String(row.createdAt || ''),
    claimedAt: String(row.claimedAt || ''),
    finishedAt: String(row.finishedAt || ''),
    workerId: String(row.workerId || ''),
    error: String(row.error || ''),
    updatedAt: String(row.updatedAt || ''),
  };
}

function summarizeJob(row = null) {
  const normalized = normalizeJob(row);
  if (!normalized) return null;
  return {
    jobId: String(normalized.jobId || ''),
    jobType: String(normalized.jobType || ''),
    status: String(normalized.status || ''),
    stage: String(normalized.stage || ''),
    progressCurrent: Math.max(0, Number(normalized.progressCurrent || 0)),
    progressTotal: Math.max(0, Number(normalized.progressTotal || 0)),
    lastError: String(normalized.lastError || ''),
    startedAt: String(normalized.startedAt || ''),
    updatedAt: String(normalized.updatedAt || ''),
    finishedAt: String(normalized.finishedAt || ''),
    workerId: String(normalized.workerId || ''),
  };
}

function compactNodePool(rows = []) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 24).map((row) => {
    if (row && typeof row === 'object') {
      return {
        endpoint: String(row.endpoint || ''),
        role: String(row.role || row.purpose || ''),
        score: Number.isFinite(Number(row.score)) ? Number(row.score) : undefined,
        active: row.active === true,
      };
    }
    return String(row || '').trim();
  });
}

function pruneCommandRows(rows = []) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const normalized = rows.map((row) => normalizeCommand(row)).filter((row) => row && row.id);
  const active = normalized.filter((row) => ['pending', 'claimed'].includes(String(row.status || '')));
  const finalized = normalized
    .filter((row) => !['pending', 'claimed'].includes(String(row.status || '')))
    .sort((a, b) => {
      const ta = Date.parse(String(a.updatedAt || a.finishedAt || a.createdAt || '')) || 0;
      const tb = Date.parse(String(b.updatedAt || b.finishedAt || b.createdAt || '')) || 0;
      if (tb !== ta) return tb - ta;
      return String(b.id || '').localeCompare(String(a.id || ''));
    })
    .slice(0, SYNC_FINAL_COMMAND_HISTORY_LIMIT);
  const merged = [...active, ...finalized];
  merged.sort((a, b) => {
    const ta = Date.parse(String(a.createdAt || a.updatedAt || '')) || 0;
    const tb = Date.parse(String(b.createdAt || b.updatedAt || '')) || 0;
    if (ta !== tb) return ta - tb;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
  return merged;
}

function compactRuntimeState(state = null) {
  const source = state && typeof state === 'object' ? state : defaultRuntimeState();
  return {
    lifecycle: { ...(source.lifecycle || {}) },
    bhs: { ...(source.bhs || {}) },
    control: { ...(source.control || {}) },
    queue: {
      pendingCount: Math.max(0, Number(source?.queue?.pendingCount || 0)),
      claimedCount: Math.max(0, Number(source?.queue?.claimedCount || 0)),
      lastCommand: summarizeCommand(source?.queue?.lastCommand || null),
      commands: [],
    },
    job: {
      currentJob: summarizeJob(source?.job?.currentJob || null),
      recentJobs: [],
    },
    progress: { ...(source.progress || {}) },
    nodes: {
      connectedCount: Math.max(0, Number(source?.nodes?.connectedCount || 0)),
      activeSyncNodeCount: Math.max(0, Number(source?.nodes?.activeSyncNodeCount || 0)),
      activeSyncNodeList: Array.isArray(source?.nodes?.activeSyncNodeList) ? source.nodes.activeSyncNodeList.slice(0, 24) : [],
      nodePool: compactNodePool(source?.nodes?.nodePool || []),
      syncWorkerNodes: Math.max(0, Number(source?.nodes?.syncWorkerNodes || 0)),
      syncWorkerNodeList: Array.isArray(source?.nodes?.syncWorkerNodeList) ? source.nodes.syncWorkerNodeList.slice(0, 24) : [],
      spvWorkingNodes: Math.max(0, Number(source?.nodes?.spvWorkingNodes || 0)),
      onlineNodeList: Array.isArray(source?.nodes?.onlineNodeList) ? source.nodes.onlineNodeList.slice(0, 24) : [],
      candidateNodeList: Array.isArray(source?.nodes?.candidateNodeList) ? source.nodes.candidateNodeList.slice(0, 24) : [],
      candidateNodes: Math.max(0, Number(source?.nodes?.candidateNodes || 0)),
      totalNodes: Math.max(0, Number(source?.nodes?.totalNodes || 0)),
    },
    runtime: cloneJsonSafe(source?.runtime || {}, {}),
    status: {
      sync: cloneJsonSafe(source?.status?.sync || null, null),
      runtime: cloneJsonSafe(source?.status?.runtime || null, null),
      jobState: {
        currentJob: summarizeJob(source?.job?.currentJob || source?.status?.jobState?.currentJob || null),
        recentJobs: [],
      },
      commandQueue: {
        pendingCount: Math.max(0, Number(source?.queue?.pendingCount || source?.status?.commandQueue?.pendingCount || 0)),
        claimedCount: Math.max(0, Number(source?.queue?.claimedCount || source?.status?.commandQueue?.claimedCount || 0)),
        lastCommand: summarizeCommand(source?.queue?.lastCommand || source?.status?.commandQueue?.lastCommand || null),
      },
    },
  };
}

function cloneRuntimeState(state = null) {
  return compactRuntimeState(state && typeof state === 'object' ? state : defaultRuntimeState());
}

function ensureRuntimeState() {
  if (!syncRuntimeState || typeof syncRuntimeState !== 'object') {
    syncRuntimeState = defaultRuntimeState();
  }
  return syncRuntimeState;
}

function resetRuntimeStateForSync(syncState = {}, options = {}) {
  const normalizedSyncState = normalizeSyncState(syncState);
  const runtimeState = defaultRuntimeState();
  runtimeState.lifecycle.loaded = true;
  runtimeState.lifecycle.started = syncDomainStarted === true;
  runtimeState.lifecycle.paused = options?.paused === true;
  runtimeState.lifecycle.autoSyncEnabled = options?.autoSyncEnabled === false
    ? false
    : (runtimeState.lifecycle.paused === true ? false : true);
  runtimeState.lifecycle.updatedAt = nowIso();
  runtimeState.control.pauseReason = String(options?.pauseReason || '');
  runtimeState.control.lastResetAt = nowIso();
  runtimeState.control.lastResetReason = String(options?.reason || 'projection.reset');
  syncRuntimeState = runtimeState;
  return buildRuntimeStateFromProjection({ syncState: normalizedSyncState });
}

function setSyncDomainAdapters(next = {}) {
  syncDomainAdapters = next && typeof next === 'object' ? { ...next } : {};
}

function notifyRuntimeListeners(snapshot, meta = {}) {
  for (const listener of runtimeListeners) {
    try {
      listener(snapshot, meta);
    } catch (_) {}
  }
}

async function broadcastRuntimeSummary(reason = 'runtime.updated', snapshot = null) {
  const state = compactRuntimeState(snapshot || ensureRuntimeState());
  const summary = {
    reason: String(reason || 'runtime.updated'),
    lifecycle: state.lifecycle,
    bhs: state.bhs,
    progress: state.progress,
    queue: {
      pendingCount: Number(state.queue.pendingCount || 0),
      claimedCount: Number(state.queue.claimedCount || 0),
      lastCommand: state.queue.lastCommand || null,
    },
    job: {
      currentJob: state.job.currentJob || null,
    },
    nodes: {
      connectedCount: Number(state.nodes.connectedCount || 0),
      activeSyncNodeCount: Number(state.nodes.activeSyncNodeCount || 0),
      activeSyncNodeList: Array.isArray(state.nodes.activeSyncNodeList) ? state.nodes.activeSyncNodeList : [],
      nodePool: Array.isArray(state.nodes.nodePool) ? state.nodes.nodePool : [],
    },
  };
  notifyRuntimeListeners(summary, { reason });
  try {
    await messageQueue.publish('sync.runtime.updated', summary, {
      mode: messageQueue.MODE_TRANSIENT,
      source: 'sync_domain.runtime',
    });
  } catch (_) {}
}

function stripTrustedBhsHeightsFromCache(cacheLike) {
  const cache = cacheLike && typeof cacheLike === 'object' ? cacheLike : {};
  const projected = typeof bhsDomain.getBhsStatusSync === 'function'
    ? (
      bhsDomain.getBhsStatusSync(SYNC_SCOPE, { allowCache: true, allowLoad: false })
      || bhsDomain.getBhsStatusSync(SYNC_SCOPE)
    )
    : null;
  const trustedHeaders = projected?.headers && typeof projected.headers === 'object'
    ? projected.headers
    : {};
  const trustedHeights = trustedHeaders && typeof trustedHeaders === 'object'
    ? Object.keys(trustedHeaders)
    : [];
  if (trustedHeights.length === 0) return { ...cache };
  const stripped = { ...cache };
  for (const height of trustedHeights) {
    delete stripped[String(height)];
  }
  return stripped;
}

function normalizeCommand(row = {}) {
  return {
    id: String(row.id || ''),
    commandType: String(row.commandType || ''),
    payload: row.payload && typeof row.payload === 'object' ? { ...row.payload } : {},
    result: row.result && typeof row.result === 'object' ? { ...row.result } : null,
    status: ['pending', 'claimed', 'done', 'failed', 'interrupted'].includes(String(row.status || '')) ? String(row.status) : 'pending',
    createdAt: String(row.createdAt || ''),
    claimedAt: String(row.claimedAt || ''),
    finishedAt: String(row.finishedAt || ''),
    workerId: String(row.workerId || ''),
    error: String(row.error || ''),
    sourceEventSeq: Math.max(0, Number(row.sourceEventSeq || 0)),
    updatedAt: String(row.updatedAt || ''),
  };
}

function syncCommandPriority(commandType) {
  const type = String(commandType || '').trim();
  if (type === 'wallet_send') return 0;
  if (type === 'rebuild_chain_indexes') return 1;
  if (type === 'run_chain_sync') return 2;
  if (type === 'wallet_refresh_cache') return 3;
  if (type === 'import_wallet_bootstrap') return 4;
  return 5;
}

function durableMessageToCommand(row = {}) {
  return normalizeCommand({
    id: row.messageId,
    commandType: row.topic,
    payload: row.payload,
    result: row.result,
    status: row.status,
    createdAt: row.createdAt,
    claimedAt: row.claimedAt,
    finishedAt: row.finishedAt,
    workerId: row.workerId,
    error: row.error,
    sourceEventSeq: 0,
    updatedAt: row.updatedAt,
  });
}

function normalizeJob(row = null) {
  if (!row || typeof row !== 'object') return null;
  return {
    ...row,
    jobId: String(row.jobId || ''),
    jobType: String(row.jobType || ''),
    status: String(row.status || ''),
    stage: String(row.stage || ''),
    lastError: String(row.lastError || ''),
    startedAt: String(row.startedAt || ''),
    updatedAt: String(row.updatedAt || ''),
    workerId: String(row.workerId || ''),
  };
}

function buildJobUpdateComparable(job = null) {
  const normalized = normalizeJob(job);
  if (!normalized) return null;
  return {
    jobId: String(normalized.jobId || ''),
    jobType: String(normalized.jobType || ''),
    status: String(normalized.status || ''),
    stage: String(normalized.stage || ''),
    progressCurrent: Math.max(0, Number(normalized.progressCurrent || 0)),
    progressTotal: Math.max(0, Number(normalized.progressTotal || 0)),
    lastError: String(normalized.lastError || ''),
    workerId: String(normalized.workerId || ''),
  };
}

function buildJobUpdateSignature(job = null) {
  const comparable = buildJobUpdateComparable(job);
  if (!comparable) return '';
  try {
    return JSON.stringify(comparable);
  } catch (_) {
    return '';
  }
}

function scheduleRuntimeSummary(reason = 'runtime.updated') {
  runtimeSummaryPendingReason = String(reason || runtimeSummaryPendingReason || 'runtime.updated');
  if (runtimeSummaryTimer) return;
  runtimeSummaryTimer = setTimeout(() => {
    runtimeSummaryTimer = null;
    const pendingReason = runtimeSummaryPendingReason || 'runtime.updated';
    runtimeSummaryPendingReason = '';
    void broadcastRuntimeSummary(pendingReason, ensureRuntimeState()).catch(() => {});
  }, Math.max(50, SYNC_JOB_UPDATE_DEBOUNCE_MS));
  runtimeSummaryTimer.unref?.();
}

function scheduleRuntimeRefresh(reason = 'runtime.refresh', options = {}) {
  runtimeRefreshPendingReason = String(reason || runtimeRefreshPendingReason || 'runtime.refresh');
  const delayMs = Math.max(25, Number(options.delayMs || SYNC_JOB_UPDATE_DEBOUNCE_MS || 50));
  if (runtimeRefreshTimer) return;
  runtimeRefreshTimer = setTimeout(() => {
    runtimeRefreshTimer = null;
    const pendingReason = runtimeRefreshPendingReason || 'runtime.refresh';
    runtimeRefreshPendingReason = '';
    runtimeRefreshInFlight = Promise.resolve()
      .then(() => refreshRuntimeState(pendingReason, options))
      .catch(() => {})
      .finally(() => {
        runtimeRefreshInFlight = null;
      });
  }, delayMs);
  runtimeRefreshTimer.unref?.();
}

function applyRuntimeJobStateFromProjectionState(state) {
  const runtimeState = ensureRuntimeState();
  const projection = state && typeof state === 'object' ? state : getProjectionState();
  const jobState = projection?.jobState && typeof projection.jobState === 'object'
    ? projection.jobState
    : defaultJobState();
  const queueState = projection?.queueState && typeof projection.queueState === 'object'
    ? projection.queueState
    : defaultCommandQueueState();
  runtimeState.queue = {
    pendingCount: Array.isArray(queueState.commands)
      ? queueState.commands.filter((row) => String(row?.status || '') === 'pending').length
      : 0,
    claimedCount: Array.isArray(queueState.commands)
      ? queueState.commands.filter((row) => String(row?.status || '') === 'claimed').length
      : 0,
    lastCommand: summarizeCommand(Array.isArray(queueState.commands) ? (queueState.commands.slice(-1)[0] || null) : null),
    commands: [],
  };
  runtimeState.job = {
    currentJob: summarizeJob(jobState.currentJob),
    recentJobs: [],
  };
  runtimeState.status = {
    ...(runtimeState.status && typeof runtimeState.status === 'object' ? runtimeState.status : {}),
    jobState: {
      currentJob: runtimeState.job.currentJob,
      recentJobs: [],
    },
    commandQueue: {
      pendingCount: runtimeState.queue.pendingCount,
      claimedCount: runtimeState.queue.claimedCount,
      lastCommand: runtimeState.queue.lastCommand,
    },
  };
  runtimeState.lifecycle.updatedAt = nowIso();
  return runtimeState;
}

function normalizeSyncState(row = {}) {
  return {
    scope: String(row.scope || SYNC_SCOPE),
    bootstrapHeight: Math.max(0, Number(row.bootstrapHeight || 0)),
    localHeight: Math.max(0, Number(row.localHeight || 0)),
    fixedSyncLastHeight: Math.max(0, Number(row.fixedSyncLastHeight || 0)),
    p2pTipHeight: Math.max(0, Number(row.p2pTipHeight || 0)),
    p2pTipHash: String(row.p2pTipHash || ''),
    p2pHeaderCursorHeight: Number.isFinite(Number(row.p2pHeaderCursorHeight)) ? Number(row.p2pHeaderCursorHeight) : -1,
    p2pHeaderCursorHash: String(row.p2pHeaderCursorHash || ''),
    online: row.online === true,
    mode: String(row.mode || ''),
    lag: Math.max(0, Number(row.lag || 0)),
    sessionEpoch: Math.max(0, Number(row.sessionEpoch || 0)),
    scannedFrom: Math.max(0, Number(row.scannedFrom || 0)),
    initialSyncCompleted: row.initialSyncCompleted === true,
    manualQuickstartPending: row.manualQuickstartPending === true,
    retries: Math.max(0, Number(row.retries || 0)),
    lastP2PForwardProbeAt: String(row.lastP2PForwardProbeAt || ''),
    lastP2PAdvanceAt: String(row.lastP2PAdvanceAt || ''),
    lastP2PGoodNodes: Math.max(0, Number(row.lastP2PGoodNodes || 0)),
    emptyBackfillTried: row.emptyBackfillTried === true,
    chainSources: Array.isArray(row.chainSources) ? row.chainSources : [],
    sourceStats: row.sourceStats && typeof row.sourceStats === 'object' ? { ...row.sourceStats } : {},
    p2pHeightHashCache: stripTrustedBhsHeightsFromCache(row.p2pHeightHashCache),
    p2pGapHeights: Array.isArray(row.p2pGapHeights) ? row.p2pGapHeights : [],
    p2pNodeStats: row.p2pNodeStats && typeof row.p2pNodeStats === 'object' ? { ...row.p2pNodeStats } : {},
    updatedAt: String(row.updatedAt || nowIso()),
  };
}

function readProjectionState() {
  const db = marketDb.openReadDb();
  try {
    const queue = defaultCommandQueueState();
    let commands = [];
    try {
      commands = db.prepare(`
        WITH active_messages AS (
          SELECT
            message_id,
            topic,
            payload_json,
            result_json,
            status,
            priority,
            created_at,
            claimed_at,
            finished_at,
            worker_id,
            error,
            dedupe_key,
            updated_at
          FROM durable_queue_messages
          WHERE queue_name = ?
            AND status IN ('pending', 'claimed')
        ),
        finalized_recent AS (
          SELECT
            message_id,
            topic,
            payload_json,
            result_json,
            status,
            priority,
            created_at,
            claimed_at,
            finished_at,
            worker_id,
            error,
            dedupe_key,
            updated_at
          FROM durable_queue_messages
          WHERE queue_name = ?
            AND status NOT IN ('pending', 'claimed')
          ORDER BY updated_at DESC, message_id DESC
          LIMIT ?
        ),
        retained_messages AS (
          SELECT * FROM active_messages
          UNION ALL
          SELECT * FROM finalized_recent
        )
        SELECT
          message_id,
          topic,
          payload_json,
          result_json,
          status,
          priority,
          created_at,
          claimed_at,
          finished_at,
          worker_id,
          error,
          dedupe_key,
          updated_at
        FROM retained_messages
        ORDER BY created_at ASC, message_id ASC
      `).all(SYNC_COMMAND_QUEUE, SYNC_COMMAND_QUEUE, SYNC_FINAL_COMMAND_HISTORY_LIMIT).map((row) => {
        let payload = {};
        let result = null;
        try { payload = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
        try { result = JSON.parse(String(row.result_json || 'null')); } catch (_) {}
        return durableMessageToCommand({
          queueName: SYNC_COMMAND_QUEUE,
          messageId: row.message_id,
          topic: row.topic,
          dedupeKey: row.dedupe_key,
          priority: row.priority,
          payload,
          result: result && typeof result === 'object' ? result : null,
          status: row.status,
          createdAt: row.created_at,
          claimedAt: row.claimed_at,
          finishedAt: row.finished_at,
          workerId: row.worker_id,
          error: row.error,
          updatedAt: row.updated_at,
        });
      });
    } catch (_) {}
    queue.commands = pruneCommandRows(commands);
    queue.nextSeq = commands.reduce((maxSeq, row) => {
      const match = /^cmd-(\d+)$/.exec(String(row.id || '').trim());
      if (!match) return maxSeq;
      return Math.max(maxSeq, Number(match[1] || 0) + 1);
    }, 1);

    let jobRow = null;
    try {
      jobRow = db.prepare(`
        SELECT current_job_json, recent_jobs_json
        FROM sync_job_state_projection
        WHERE scope = ?
        LIMIT 1
      `).get(SYNC_SCOPE);
    } catch (_) {}
    const jobState = defaultJobState();
    if (jobRow) {
      let currentJob = null;
      let recentJobs = [];
      try { currentJob = JSON.parse(String(jobRow.current_job_json || 'null')); } catch (_) {}
      try { recentJobs = JSON.parse(String(jobRow.recent_jobs_json || '[]')); } catch (_) {}
      jobState.currentJob = normalizeJob(currentJob);
      jobState.recentJobs = Array.isArray(recentJobs) ? recentJobs.map((row) => normalizeJob(row)).filter(Boolean).slice(-20) : [];
    }
    let syncState = defaultSyncState();
    try {
      const row = db.prepare('SELECT * FROM sync_state WHERE scope = ? LIMIT 1').get(SYNC_SCOPE);
      if (row) {
        let chainSources = [];
        let sourceStats = {};
        let p2pHeightHashCache = {};
        let p2pGapHeights = [];
        let p2pNodeStats = {};
        try { chainSources = JSON.parse(String(row.chain_sources_json || '[]')); } catch (_) {}
        try { sourceStats = JSON.parse(String(row.source_stats_json || '{}')); } catch (_) {}
        try { p2pHeightHashCache = JSON.parse(String(row.p2p_height_hash_cache_json || '{}')); } catch (_) {}
        try { p2pGapHeights = JSON.parse(String(row.p2p_gap_heights_json || '[]')); } catch (_) {}
        try { p2pNodeStats = JSON.parse(String(row.p2p_node_stats_json || '{}')); } catch (_) {}
        syncState = normalizeSyncState({
          scope: row.scope,
          bootstrapHeight: row.bootstrap_height,
          localHeight: row.local_height,
          fixedSyncLastHeight: row.fixed_sync_last_height,
          p2pTipHeight: row.p2p_tip_height,
          p2pTipHash: row.p2p_tip_hash,
          p2pHeaderCursorHeight: row.p2p_header_cursor_height,
          p2pHeaderCursorHash: row.p2p_header_cursor_hash,
          online: Number(row.online || 0) === 1,
          mode: row.mode,
          lag: row.lag,
          sessionEpoch: row.session_epoch,
          scannedFrom: row.scanned_from,
          initialSyncCompleted: Number(row.initial_sync_completed || 0) === 1,
          manualQuickstartPending: Number(row.manual_quickstart_pending || 0) === 1,
          retries: row.retries,
          lastP2PForwardProbeAt: row.last_p2p_forward_probe_at,
          lastP2PAdvanceAt: row.last_p2p_advance_at,
          lastP2PGoodNodes: row.last_p2p_good_nodes,
          emptyBackfillTried: Number(row.empty_backfill_tried || 0) === 1,
          chainSources,
          sourceStats,
          p2pHeightHashCache,
          p2pGapHeights,
          p2pNodeStats,
          updatedAt: row.updated_at,
        });
      }
    } catch (_) {}
    return { queueState: queue, jobState, syncState };
  } finally {
    db.close();
  }
}

function cloneProjectionState(state = null) {
  const source = state && typeof state === 'object' ? state : {
    queueState: defaultCommandQueueState(),
    jobState: defaultJobState(),
    syncState: defaultSyncState(),
  };
  return {
      queueState: {
        version: 1,
        nextSeq: Math.max(1, Number(source?.queueState?.nextSeq || 1)),
      commands: pruneCommandRows(Array.isArray(source?.queueState?.commands)
        ? source.queueState.commands.map((row) => normalizeCommand(row))
        : []),
      },
    jobState: {
      version: 1,
      currentJob: normalizeJob(source?.jobState?.currentJob),
      recentJobs: Array.isArray(source?.jobState?.recentJobs)
        ? source.jobState.recentJobs.map((row) => normalizeJob(row)).filter(Boolean).slice(-20)
        : [],
    },
    syncState: normalizeSyncState(source?.syncState || {}),
  };
}

function reconcileProjectionStateConsistency(state = null) {
  const next = cloneProjectionState(state);
  const currentJob = next?.jobState?.currentJob && typeof next.jobState.currentJob === 'object'
    ? next.jobState.currentJob
    : null;
  const currentJobId = String(currentJob?.jobId || '').trim();
  if (!currentJobId) return next;
  const commands = Array.isArray(next?.queueState?.commands) ? next.queueState.commands : [];
  const matchingCommand = commands.find((row) => String(row?.id || '') === currentJobId) || null;
  const matchingStatus = String(matchingCommand?.status || '');
  if (!FINAL_COMMAND_STATUSES.has(matchingStatus)) return next;
  const recentJobs = Array.isArray(next.jobState.recentJobs) ? next.jobState.recentJobs : [];
  const exists = recentJobs.some((row) => String(row?.jobId || '') === currentJobId);
  if (!exists) {
    recentJobs.push(normalizeJob({
      ...currentJob,
      status: matchingStatus,
      lastError: String(matchingCommand?.error || currentJob?.lastError || ''),
      finishedAt: String(matchingCommand?.finishedAt || currentJob?.finishedAt || nowIso()),
      updatedAt: String(matchingCommand?.updatedAt || currentJob?.updatedAt || nowIso()),
    }));
    next.jobState.recentJobs = recentJobs.filter(Boolean).slice(-20);
  }
  next.jobState.currentJob = null;
  return next;
}

function writeProjectionCache(state) {
  syncProjectionCache = reconcileProjectionStateConsistency(state);
  return cloneProjectionState(syncProjectionCache);
}

function getProjectionState(options = {}) {
  if (options && options.syncState && typeof options.syncState === 'object') {
    const nextState = {
      queueState: options.queueState && typeof options.queueState === 'object'
        ? { ...defaultCommandQueueState(), ...options.queueState }
        : defaultCommandQueueState(),
      jobState: options.jobState && typeof options.jobState === 'object'
        ? {
          ...defaultJobState(),
          ...options.jobState,
          currentJob: normalizeJob(options.jobState.currentJob),
          recentJobs: Array.isArray(options.jobState.recentJobs)
            ? options.jobState.recentJobs.map((row) => normalizeJob(row)).filter(Boolean).slice(-20)
            : [],
        }
        : defaultJobState(),
      syncState: normalizeSyncState(options.syncState),
    };
    return writeProjectionCache(nextState);
  }
  if (options && options.fresh === true) {
    const freshState = reconcileProjectionStateConsistency(readProjectionState());
    syncProjectionCache = cloneProjectionState(freshState);
    return cloneProjectionState(syncProjectionCache);
  }
  if (USE_PARENT_PROXY) {
    const freshState = reconcileProjectionStateConsistency(readProjectionState());
    syncProjectionCache = cloneProjectionState(freshState);
    return cloneProjectionState(syncProjectionCache);
  }
  if (syncProjectionCache) return cloneProjectionState(reconcileProjectionStateConsistency(syncProjectionCache));
  if (options.allowLoad === false) {
    return cloneProjectionState(null);
  }
  return writeProjectionCache(readProjectionState());
}

function applyEventToState(state, event) {
  const eventType = String(event?.eventType || '').trim();
  const payload = event?.payload && typeof event.payload === 'object' ? event.payload : {};
  const seq = Math.max(0, Number(event?.seq || 0));
  if (eventType === 'sync.command.enqueued') {
    const command = normalizeCommand({
      id: payload.commandId,
      commandType: payload.commandType,
      payload: payload.payload,
      result: null,
      status: 'pending',
      createdAt: payload.createdAt || event.ts || nowIso(),
      updatedAt: event.ts || nowIso(),
      sourceEventSeq: seq,
    });
    if (!command.id || !command.commandType) return;
    const idx = state.queueState.commands.findIndex((row) => row.id === command.id);
    if (idx >= 0) state.queueState.commands[idx] = command;
    else state.queueState.commands.push(command);
    state.queueState.nextSeq = Math.max(state.queueState.nextSeq, Number(String(command.id).replace('cmd-', '')) + 1 || 1);
    return;
  }
  if (eventType === 'sync.command.claimed' || eventType === 'sync.command.released' || eventType === 'sync.command.finished') {
    const commandId = String(payload.commandId || '').trim();
    if (!commandId) return;
    const idx = state.queueState.commands.findIndex((row) => row.id === commandId);
    if (idx < 0) return;
    const existing = state.queueState.commands[idx];
    if (eventType === 'sync.command.claimed') {
      state.queueState.commands[idx] = normalizeCommand({
        ...existing,
        status: 'claimed',
        workerId: payload.workerId,
        claimedAt: payload.claimedAt || event.ts || nowIso(),
        updatedAt: event.ts || nowIso(),
        sourceEventSeq: seq,
      });
      return;
    }
    if (eventType === 'sync.command.released') {
      state.queueState.commands[idx] = normalizeCommand({
        ...existing,
        status: 'pending',
        workerId: '',
        claimedAt: '',
        updatedAt: event.ts || nowIso(),
        sourceEventSeq: seq,
      });
      return;
    }
    state.queueState.commands[idx] = normalizeCommand({
      ...existing,
      status: String(payload.status || existing.status || 'failed'),
      finishedAt: payload.finishedAt || event.ts || nowIso(),
      workerId: payload.resetClaim === true ? '' : String(payload.workerId || existing.workerId || ''),
      claimedAt: payload.resetClaim === true ? '' : String(existing.claimedAt || ''),
      error: String(payload.error || ''),
      result: payload.result && typeof payload.result === 'object' ? payload.result : existing.result,
      payload: payload.payload && typeof payload.payload === 'object' ? { ...(existing.payload || {}), ...payload.payload } : existing.payload,
      updatedAt: event.ts || nowIso(),
      sourceEventSeq: seq,
    });
  }
  if (eventType === 'sync.job.updated') {
    const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : {};
    const finalize = payload.finalize === true;
    const current = normalizeJob({
      ...(state.jobState.currentJob || {}),
      ...patch,
      updatedAt: event.ts || nowIso(),
    });
    if (current && !current.startedAt) current.startedAt = String(event.ts || nowIso());
    state.jobState.currentJob = current;
    if (finalize && current) {
      const finished = normalizeJob({
        ...current,
        finishedAt: String(current.finishedAt || event.ts || nowIso()),
        updatedAt: String(event.ts || nowIso()),
      });
      state.jobState.recentJobs.push(finished);
      state.jobState.recentJobs = state.jobState.recentJobs.slice(-20);
      state.jobState.currentJob = null;
    }
    return;
  }
  if (eventType === 'sync.state.snapshot_replaced') {
    state.syncState = normalizeSyncState({
      ...(payload && typeof payload === 'object' ? payload : {}),
      updatedAt: String(payload.updatedAt || event.ts || nowIso()),
    });
  }
}

async function catchUpProjection() {
  if (!ALLOW_SYNC_PROJECTION_CATCHUP) {
    appendSyncProjectionTrace('catchup_skipped_projection_disabled', {
      consumerName: SYNC_CONSUMER,
    });
    return { applied: 0, lastSeq: 0 };
  }
  const startedAt = Date.now();
  const state = readProjectionState();
  writeProjectionCache(state);
  const finishedAt = Date.now();
  appendSyncProjectionTrace('catchup_profile', {
    consumerName: SYNC_CONSUMER,
    mode: 'projection_reload',
    fromSeq: Math.max(
      ...state.queueState.commands.map((row) => Math.max(0, Number(row?.sourceEventSeq || 0))),
      Number(state.syncState?.lastEventSeq || 0),
      Number(state.jobState?.currentJob?.lastEventSeq || 0),
      0,
    ),
    commandCount: state.queueState.commands.length,
    p2pHeightHashCacheKeys: state.syncState?.p2pHeightHashCache && typeof state.syncState.p2pHeightHashCache === 'object'
      ? Object.keys(state.syncState.p2pHeightHashCache).length
      : 0,
    p2pNodeStatsKeys: state.syncState?.p2pNodeStats && typeof state.syncState.p2pNodeStats === 'object'
      ? Object.keys(state.syncState.p2pNodeStats).length
      : 0,
    totalMs: finishedAt - startedAt,
  });
  return { applied: 0, lastSeq: Math.max(
    ...state.queueState.commands.map((row) => Math.max(0, Number(row?.sourceEventSeq || 0))),
    0,
  ) };
}

function buildProjectionPersistPayload(state) {
  const safeState = cloneProjectionState(state);
  const lastEventSeq = Math.max(
    ...safeState.queueState.commands.map((row) => Math.max(0, Number(row?.sourceEventSeq || 0))),
    Number(safeState.syncState?.lastEventSeq || 0),
    Number(safeState.jobState?.currentJob?.lastEventSeq || 0),
    ...safeState.jobState.recentJobs.map((row) => Math.max(0, Number(row?.lastEventSeq || 0))),
    0,
  );
  const payload = {
    jobState: {
      scope: SYNC_SCOPE,
      currentJob: safeState.jobState.currentJob,
      recentJobs: safeState.jobState.recentJobs.slice(-20),
      lastEventSeq,
      updatedAt: nowIso(),
    },
    syncState: safeState.syncState
      ? {
        ...safeState.syncState,
        updatedAt: safeState.syncState.updatedAt || nowIso(),
      }
      : null,
    commands: safeState.queueState.commands.map((row) => ({
      ...row,
      sourceEventSeq: Math.max(0, Number(row.sourceEventSeq || 0)),
      updatedAt: row.updatedAt || nowIso(),
    })),
  };
  const signature = hashProjectionPersistPayload(payload);
  return { safeState, payload, signature };
}

async function persistProjectionState(state) {
  const { safeState, payload } = buildProjectionPersistPayload(state);
  await marketDb.applySyncProjectionBatch(payload);
  writeProjectionCache(safeState);
}

async function resetProjectionState(syncState = {}, options = {}) {
  if (projectionPersistTimer) {
    clearTimeout(projectionPersistTimer);
    projectionPersistTimer = null;
  }
  projectionPersistPending = false;
  projectionPersistPendingSinceMs = 0;
  let preservedNextSeq = 1;
  try {
    const persisted = readProjectionState();
    preservedNextSeq = Math.max(1, Number(persisted?.queueState?.nextSeq || 1));
  } catch (_) {
    preservedNextSeq = 1;
  }
  const state = {
    queueState: {
      ...defaultCommandQueueState(),
      nextSeq: preservedNextSeq,
    },
    jobState: defaultJobState(),
    syncState: normalizeSyncState(syncState),
  };
  await persistProjectionState(state);
  resetRuntimeStateForSync(state.syncState, {
    reason: String(options?.reason || 'projection.reset'),
    paused: options?.paused === true,
    autoSyncEnabled: options?.autoSyncEnabled === false ? false : true,
    pauseReason: String(options?.pauseReason || ''),
  });
  await refreshRuntimeState(String(options?.reason || 'projection.reset'));
  return writeProjectionCache(state);
}

function primeProjectionState(syncState = {}, options = {}) {
  const preservedNextSeq = Math.max(
    1,
    Number(syncProjectionCache?.queueState?.nextSeq || 0),
    Number(readProjectionState()?.queueState?.nextSeq || 1),
  );
  const state = {
    queueState: {
      ...defaultCommandQueueState(),
      nextSeq: preservedNextSeq,
    },
    jobState: defaultJobState(),
    syncState: normalizeSyncState(syncState),
  };
  writeProjectionCache(state);
  return resetRuntimeStateForSync(state.syncState, {
    reason: String(options?.reason || 'projection.prime'),
    paused: options?.paused === true,
    autoSyncEnabled: options?.autoSyncEnabled === false ? false : true,
    pauseReason: String(options?.pauseReason || ''),
  });
}

async function flushPersistProjectionStateNow() {
  if (projectionPersistTimer) {
    clearTimeout(projectionPersistTimer);
    projectionPersistTimer = null;
  }
  if (!projectionPersistPending) return;
  if (projectionPersistPromise) {
    await projectionPersistPromise;
    return;
  }
  projectionPersistPending = false;
  projectionPersistPendingSinceMs = 0;
  const state = getProjectionState();
  const { safeState, payload, signature } = buildProjectionPersistPayload(state);
  if (signature && signature === projectionPersistLastSignature) {
    writeProjectionCache(safeState);
    return;
  }
  projectionPersistPromise = marketDb.applySyncProjectionBatch(payload)
    .then(() => {
      projectionPersistLastSignature = signature;
      writeProjectionCache(safeState);
    })
    .finally(() => {
      projectionPersistPromise = null;
      if (projectionPersistPending) {
        setImmediate(() => {
          void flushPersistProjectionStateNow().catch(() => {});
        });
      }
    });
  await projectionPersistPromise;
}

function schedulePersistProjectionState(options = {}) {
  projectionPersistPending = true;
  const nowMs = Date.now();
  if (!projectionPersistPendingSinceMs) projectionPersistPendingSinceMs = nowMs;
  const requestedDelayMs = Math.max(
    0,
    Number(options?.delayMs ?? SYNC_JOB_UPDATE_DEBOUNCE_MS),
  );
  const elapsedMs = Math.max(0, nowMs - projectionPersistPendingSinceMs);
  const maxRemainingMs = Math.max(0, SYNC_PROJECTION_PERSIST_MAX_WAIT_MS - elapsedMs);
  const delayMs = Math.min(requestedDelayMs, maxRemainingMs);
  if (projectionPersistTimer) clearTimeout(projectionPersistTimer);
  projectionPersistTimer = setTimeout(() => {
    projectionPersistTimer = null;
    void flushPersistProjectionStateNow().catch(() => {});
  }, delayMs);
  projectionPersistTimer.unref?.();
}

function stageProjectionStatePersistence(state, options = {}) {
  writeProjectionCache(state);
  if (USE_PARENT_PROXY) return;
  if (options?.force === true) {
    void flushPersistProjectionStateNow().catch(() => {});
    return;
  }
  schedulePersistProjectionState(options);
}

async function emitSyncEvent(eventType, payload = {}, meta = {}) {
  if (USE_PARENT_PROXY) {
    const result = await sendParentProxyRequest('emit_sync_event', {
      eventType,
      payload,
      meta,
    }, 30000);
    syncProjectionCache = null;
    return result;
  }
  const entityId = String(meta.entityId || payload.commandId || payload.jobId || SYNC_SCOPE).trim() || SYNC_SCOPE;
  const asyncRuntimeRefresh = meta?.asyncRuntimeRefresh === true;
  const syntheticEvent = {
    eventType: String(eventType || '').trim(),
    producer: String(meta.producer || 'sync_domain'),
    entityType: String(meta.entityType || 'sync'),
    entityId,
    correlationId: String(meta.correlationId || '').trim(),
    causationId: String(meta.causationId || '').trim(),
    dedupeKey: String(meta.dedupeKey || '').trim(),
    payload: payload && typeof payload === 'object' ? { ...payload } : {},
    seq: 0,
    ts: nowIso(),
  };
  const state = getProjectionState();
  applyEventToState(state, syntheticEvent);
  if (String(eventType || '') === 'sync.job.updated' && payload?.finalize !== true) {
    stageProjectionStatePersistence(state, { delayMs: SYNC_JOB_UPDATE_THROTTLE_MS });
    applyRuntimeJobStateFromProjectionState(state);
    scheduleRuntimeSummary(`event:${String(eventType || '')}`);
  } else {
    if (USE_PARENT_PROXY) {
      writeProjectionCache(state);
    } else {
      stageProjectionStatePersistence(state);
    }
  }
  appendSyncProjectionTrace('projection_direct_update', {
    consumerName: SYNC_CONSUMER,
    eventType: String(eventType || ''),
    entityId,
    producer: syntheticEvent.producer,
  });
  if (String(eventType || '') === 'sync.job.updated' && payload?.finalize !== true) {
    if (asyncRuntimeRefresh) {
      scheduleRuntimeRefresh(`event:${String(eventType || '')}`, { delayMs: SYNC_JOB_UPDATE_THROTTLE_MS });
    }
  } else if (asyncRuntimeRefresh) {
    scheduleRuntimeRefresh(`event:${String(eventType || '')}`);
  } else {
    await refreshRuntimeState(`event:${String(eventType || '')}`);
  }
  return syntheticEvent;
}

async function emitSyncStateSnapshot(syncState = {}, meta = {}) {
  return emitSyncEvent('sync.state.snapshot_replaced', normalizeSyncState(syncState), {
    producer: String(meta.producer || 'sync_domain'),
    entityType: 'sync_state',
    entityId: String(meta.entityId || SYNC_SCOPE),
    correlationId: String(meta.correlationId || '').trim(),
    causationId: String(meta.causationId || '').trim(),
    dedupeKey: String(meta.dedupeKey || '').trim(),
  });
}

async function enqueueCommand(commandType, payload = {}, options = {}) {
  const queueState = getCommandQueueState();
  if (options?.dedupePending !== false) {
    const existing = queueState.commands.find((row) => (
      row.commandType === String(commandType || '').trim()
      && ['pending', 'claimed'].includes(String(row.status || ''))
    ));
    if (existing) return { ...existing };
  }
  const seq = Math.max(1, Number(queueState.nextSeq || 1));
  const now = nowIso();
  const command = normalizeCommand({
    id: `cmd-${String(seq).padStart(6, '0')}`,
    commandType: String(commandType || '').trim(),
    payload: payload && typeof payload === 'object' ? payload : {},
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  });
  const durableMessage = await messageQueue.publish(command.commandType, command.payload, {
    mode: messageQueue.MODE_DURABLE,
    queueName: SYNC_COMMAND_QUEUE,
    messageId: command.id,
    dedupeKey: `sync.command:${command.commandType}:${String(options?.dedupeKey || '').trim() || command.id}`,
    priority: syncCommandPriority(command.commandType),
    ts: command.createdAt,
    source: 'sync_domain.enqueue',
  });
  const nextCommand = durableMessageToCommand(durableMessage || {
    messageId: command.id,
    topic: command.commandType,
    payload: command.payload,
    status: 'pending',
    createdAt: command.createdAt,
    updatedAt: command.updatedAt,
  });
  const state = getProjectionState();
  const idx = state.queueState.commands.findIndex((row) => row.id === nextCommand.id);
  if (idx >= 0) state.queueState.commands[idx] = nextCommand;
  else state.queueState.commands.push(nextCommand);
  state.queueState.nextSeq = Math.max(state.queueState.nextSeq, seq + 1);
  writeProjectionCache(state);
  schedulePersistProjectionState({ delayMs: SYNC_PROJECTION_COMMAND_DEBOUNCE_MS });
  appendSyncProjectionTrace('durable_command_enqueued', {
    commandId: nextCommand.id,
    commandType: nextCommand.commandType,
    queueName: SYNC_COMMAND_QUEUE,
  });
  scheduleRuntimeRefresh('command.enqueued', { delayMs: 25 });
  return nextCommand;
}

async function claimNextCommand(workerId = `worker-${process.pid}`) {
  const normalizedWorkerId = String(workerId || '');
  const claimedAt = nowIso();
  let claimed = null;
  try {
    claimed = await messageQueue.claim(SYNC_COMMAND_QUEUE, {
      workerId: normalizedWorkerId,
      claimedAt,
    });
  } catch (error) {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || '');
    const isClaimTimeout = (
      code === 'PARENT_PROXY_TIMEOUT'
      || code === 'WRITER_TIMEOUT'
      || message.includes('claim_next_durable_message')
    );
    if (!isClaimTimeout) throw error;
    let recovered = null;
    try {
      const queueState = getCommandQueueState({ fresh: true });
      recovered = (Array.isArray(queueState?.commands) ? queueState.commands : []).find((row) => (
        String(row?.status || '') === 'claimed'
        && String(row?.workerId || '') === normalizedWorkerId
        && String(row?.claimedAt || '') === claimedAt
      )) || null;
    } catch (_) {
      recovered = null;
    }
    try {
      if (!recovered || !recovered.id) {
        const claimedRows = await messageQueue.listDurable(SYNC_COMMAND_QUEUE, {
          status: 'claimed',
          limit: 100,
        });
        recovered = (Array.isArray(claimedRows) ? claimedRows : []).find((row) => (
          String(row?.workerId || '') === normalizedWorkerId
          && String(row?.claimedAt || '') === claimedAt
        )) || null;
      }
    } catch (_) {
      recovered = recovered && recovered.id ? recovered : null;
    }
    const recoveredMessageId = String(recovered?.messageId || recovered?.id || '').trim();
    if (!recovered || !recoveredMessageId) throw error;
    claimed = recovered;
    appendSyncProjectionTrace('durable_command_claim_recovered_after_timeout', {
      commandId: recoveredMessageId,
      workerId: normalizedWorkerId,
      queueName: SYNC_COMMAND_QUEUE,
      claimedAt,
    });
  }
  const claimedMessageId = String(claimed?.messageId || claimed?.id || '').trim();
  if (!claimed || !claimedMessageId) return null;
  const nextCommand = (claimed && typeof claimed === 'object' && claimed.id && claimed.commandType)
    ? normalizeCommand(claimed)
    : durableMessageToCommand(claimed);
  const startAfterTs = Math.max(0, Number(nextCommand?.payload?.startAfterTs || 0));
  if (startAfterTs > Date.now()) {
    await messageQueue.release(SYNC_COMMAND_QUEUE, claimedMessageId, {
      updatedAt: nowIso(),
    }).catch(() => {});
    appendSyncProjectionTrace('durable_command_claim_deferred_until_start_after', {
      commandId: nextCommand.id,
      commandType: nextCommand.commandType,
      startAfterTs,
      waitMs: Math.max(0, startAfterTs - Date.now()),
      queueName: SYNC_COMMAND_QUEUE,
    });
    return null;
  }
  const state = getProjectionState();
  const idx = state.queueState.commands.findIndex((row) => row.id === nextCommand.id);
  if (idx >= 0) state.queueState.commands[idx] = nextCommand;
  else state.queueState.commands.push(nextCommand);
  stageProjectionStatePersistence(state, { delayMs: SYNC_PROJECTION_COMMAND_DEBOUNCE_MS });
  appendSyncProjectionTrace('durable_command_claimed', {
    commandId: nextCommand.id,
    workerId: nextCommand.workerId,
    queueName: SYNC_COMMAND_QUEUE,
  });
  scheduleRuntimeRefresh('command.claimed', { delayMs: 25 });
  return nextCommand;
}

async function markCommandFinished(commandId, status, extra = {}) {
  const current = getCommandById(commandId);
  if (!current) return null;
  const finished = await messageQueue.finish(SYNC_COMMAND_QUEUE, commandId, {
    status: String(status || ''),
    finishedAt: nowIso(),
    error: String(extra?.error || ''),
    result: extra?.result && typeof extra.result === 'object' ? extra.result : null,
    resetClaim: FINAL_COMMAND_STATUSES.has(String(status || '')),
  });
  const nextCommand = durableMessageToCommand(finished || {
    messageId: commandId,
    topic: current.commandType,
    payload: current.payload,
    status,
    finishedAt: nowIso(),
    workerId: current.workerId,
    error: String(extra?.error || ''),
    result: extra?.result && typeof extra.result === 'object' ? extra.result : null,
    updatedAt: nowIso(),
  });
  const state = getProjectionState();
  const idx = state.queueState.commands.findIndex((row) => row.id === nextCommand.id);
  if (idx >= 0) state.queueState.commands[idx] = nextCommand;
  else state.queueState.commands.push(nextCommand);
  stageProjectionStatePersistence(state, { delayMs: SYNC_PROJECTION_COMMAND_DEBOUNCE_MS });
  appendSyncProjectionTrace('durable_command_finished', {
    commandId: nextCommand.id,
    status: nextCommand.status,
    queueName: SYNC_COMMAND_QUEUE,
  });
  scheduleRuntimeRefresh('command.finished', { delayMs: 25 });
  return nextCommand;
}

async function releaseClaimedCommand(commandId) {
  const current = getCommandById(commandId);
  if (!current) return null;
  if (String(current.status || '') !== 'claimed') return current;
  const released = await messageQueue.release(SYNC_COMMAND_QUEUE, commandId, {
    updatedAt: nowIso(),
  });
  const nextCommand = durableMessageToCommand(released || {
    messageId: commandId,
    topic: current.commandType,
    payload: current.payload,
    status: 'pending',
    createdAt: current.createdAt,
    updatedAt: nowIso(),
  });
  const state = getProjectionState();
  const idx = state.queueState.commands.findIndex((row) => row.id === nextCommand.id);
  if (idx >= 0) state.queueState.commands[idx] = nextCommand;
  else state.queueState.commands.push(nextCommand);
  stageProjectionStatePersistence(state, { delayMs: SYNC_PROJECTION_COMMAND_DEBOUNCE_MS });
  appendSyncProjectionTrace('durable_command_released', {
    commandId: nextCommand.id,
    queueName: SYNC_COMMAND_QUEUE,
  });
  scheduleRuntimeRefresh('command.released', { delayMs: 25 });
  return nextCommand;
}

async function updateJobState(patch = {}, options = {}) {
  const patchObject = patch && typeof patch === 'object' ? patch : {};
  const finalize = options.finalize === true;
  const currentState = getJobState();
  const projectedNext = normalizeJob({
    ...(currentState?.currentJob || {}),
    ...patchObject,
    updatedAt: nowIso(),
  });
  const nextSignature = buildJobUpdateSignature(projectedNext);
  const currentSignature = buildJobUpdateSignature(currentState?.currentJob || null);
  if (!finalize && nextSignature && nextSignature === currentSignature) {
    appendSyncProjectionTrace('job_update_skipped_unchanged', {
      jobId: String(projectedNext?.jobId || ''),
      stage: String(projectedNext?.stage || ''),
      status: String(projectedNext?.status || ''),
    });
    return currentState;
  }
  const nowMs = Date.now();
  const currentComparable = buildJobUpdateComparable(currentState?.currentJob || null);
  const nextComparable = buildJobUpdateComparable(projectedNext);
  const onlyProgressChanged = Boolean(currentComparable && nextComparable
    && currentComparable.jobId === nextComparable.jobId
    && currentComparable.jobType === nextComparable.jobType
    && currentComparable.status === nextComparable.status
    && currentComparable.stage === nextComparable.stage
    && currentComparable.lastError === nextComparable.lastError
    && currentComparable.workerId === nextComparable.workerId
    && (
      currentComparable.progressCurrent !== nextComparable.progressCurrent
      || currentComparable.progressTotal !== nextComparable.progressTotal
    ));
  if (
    !finalize
    && onlyProgressChanged
    && nextSignature
    && lastSyncJobUpdateSignature
    && (nowMs - lastSyncJobUpdateAt) < SYNC_JOB_UPDATE_THROTTLE_MS
  ) {
    appendSyncProjectionTrace('job_update_skipped_throttled', {
      jobId: String(projectedNext?.jobId || ''),
      stage: String(projectedNext?.stage || ''),
      status: String(projectedNext?.status || ''),
      progressCurrent: Math.max(0, Number(projectedNext?.progressCurrent || 0)),
      progressTotal: Math.max(0, Number(projectedNext?.progressTotal || 0)),
    });
    return currentState;
  }
  await emitSyncEvent('sync.job.updated', {
    patch: patchObject,
    finalize,
  }, {
    producer: 'sync_domain.job',
    entityType: 'sync_job',
    entityId: String(patchObject?.jobId || SYNC_SCOPE),
  });
  if (nextSignature) {
    lastSyncJobUpdateSignature = nextSignature;
    lastSyncJobUpdateAt = nowMs;
  }
  return getJobState();
}

async function recoverStewardQueue() {
  const queueState = getCommandQueueState();
  const now = nowIso();
  let recoveredCommands = 0;
  for (const row of queueState.commands) {
    if (!['pending', 'claimed'].includes(String(row.status || ''))) continue;
    const type = String(row.commandType || '');
    if (type !== 'run_chain_sync' && type !== 'rebuild_chain_indexes' && type !== 'wallet_refresh_cache') continue;
    await messageQueue.finish(SYNC_COMMAND_QUEUE, row.id, {
      status: 'interrupted',
      finishedAt: now,
      error: 'steward worker restarted before completion',
      resetClaim: true,
    });
    recoveredCommands += 1;
  }
  if (recoveredCommands > 0) {
    syncProjectionCache = null;
    await persistProjectionState(readProjectionState());
  }
  const jobState = getJobState();
  let recoveredJob = false;
  if (jobState.currentJob && String(jobState.currentJob.status || '') === 'running') {
    await updateJobState({
      ...jobState.currentJob,
      status: 'interrupted',
      stage: 'interrupted',
      lastError: String(jobState.currentJob.lastError || 'steward worker restarted before completion'),
      updatedAt: now,
    }, { finalize: true });
    recoveredJob = true;
  }
  await refreshRuntimeState('steward.recovered');
  return { recoveredCommands, recoveredJob };
}

async function interruptCommands(matchFn, options = {}) {
  const queueState = getCommandQueueState();
  const allowedStatuses = Array.isArray(options.allowedStatuses) ? options.allowedStatuses : ['pending'];
  const reason = String(options.reason || 'command interrupted');
  let interruptedCount = 0;
  for (const row of queueState.commands) {
    if (typeof matchFn === 'function' && !matchFn(row)) continue;
    if (!allowedStatuses.includes(String(row.status || ''))) continue;
    await messageQueue.finish(SYNC_COMMAND_QUEUE, row.id, {
      status: 'interrupted',
      finishedAt: nowIso(),
      error: reason,
      resetClaim: options.resetClaim === true,
    });
    interruptedCount += 1;
  }
  if (interruptedCount > 0) {
    syncProjectionCache = null;
    await persistProjectionState(readProjectionState());
    await refreshRuntimeState('commands.interrupted');
  }
  return interruptedCount;
}

async function interruptPendingCommands(matchFn, options = {}) {
  return interruptCommands(matchFn, { ...options, allowedStatuses: ['pending'], resetClaim: false });
}

async function interruptQueuedCommands(matchFn, options = {}) {
  return interruptCommands(matchFn, { ...options, allowedStatuses: ['pending', 'claimed'], resetClaim: true });
}

async function interruptStaleClaimedCommands(matchFn, options = {}) {
  const minClaimAgeMs = Math.max(1000, Number(options?.minClaimAgeMs || 0) || 0);
  const nowMs = Date.now();
  return interruptCommands((row) => {
    if (typeof matchFn === 'function' && !matchFn(row)) return false;
    if (String(row.status || '') !== 'claimed') return false;
    const claimedAtMs = Date.parse(String(row.claimedAt || ''));
    if (!Number.isFinite(claimedAtMs)) return false;
    return (nowMs - claimedAtMs) >= minClaimAgeMs;
  }, { ...options, allowedStatuses: ['claimed'], resetClaim: true });
}

function getCommandQueueState(options = {}) {
  return getProjectionState(options).queueState;
}

function getJobState(options = {}) {
  return getProjectionState(options).jobState;
}

function getSyncStateSync(options = {}) {
  return getProjectionState(options).syncState;
}

function getCommandById(commandId, options = {}) {
  const wanted = String(commandId || '').trim();
  if (!wanted) return null;
  return getCommandQueueState(options).commands.find((row) => row.id === wanted) || null;
}

function findJobSnapshotById(jobId, options = {}) {
  const wanted = String(jobId || '').trim();
  if (!wanted) return null;
  const jobState = getJobState(options);
  if (String(jobState?.currentJob?.jobId || '') === wanted) return { ...jobState.currentJob };
  for (let i = jobState.recentJobs.length - 1; i >= 0; i -= 1) {
    if (String(jobState.recentJobs[i]?.jobId || '') === wanted) return { ...jobState.recentJobs[i] };
  }
  return null;
}

function hasPendingOrClaimedCommand(commandType, options = {}) {
  const wanted = String(commandType || '').trim();
  if (!wanted) return false;
  return getCommandQueueState(options).commands.some((row) => row.commandType === wanted && ['pending', 'claimed'].includes(String(row.status || '')));
}

function hasQueuedOrActiveChainSync(options = {}) {
  const queueState = getCommandQueueState(options);
  return queueState.commands.some((row) => (
    (row.commandType === 'run_chain_sync' || row.commandType === 'rebuild_chain_indexes')
    && ['pending', 'claimed'].includes(String(row.status || ''))
  ));
}

function buildRuntimeStateFromProjection(options = {}) {
  const projection = getProjectionState(options);
  const queueState = options?.queueState && typeof options.queueState === 'object'
    ? {
      ...defaultCommandQueueState(),
      ...options.queueState,
    }
    : projection.queueState;
  const jobState = options?.jobState && typeof options.jobState === 'object'
    ? {
      ...defaultJobState(),
      ...options.jobState,
      currentJob: normalizeJob(options.jobState.currentJob),
      recentJobs: Array.isArray(options.jobState.recentJobs)
        ? options.jobState.recentJobs.map((row) => normalizeJob(row)).filter(Boolean).slice(-20)
        : [],
    }
    : projection.jobState;
  const syncState = options?.syncState && typeof options.syncState === 'object'
    ? normalizeSyncState(options.syncState)
    : projection.syncState;
  const bhsSnapshot = typeof syncDomainAdapters.getBhsSnapshot === 'function'
    ? (syncDomainAdapters.getBhsSnapshot() || {})
    : {};
  let independentSync = typeof syncDomainAdapters.getIndependentSyncSnapshot === 'function'
    ? (syncDomainAdapters.getIndependentSyncSnapshot() || {})
    : {};
  let connectedNodes = typeof syncDomainAdapters.getConnectedNodeSnapshot === 'function'
    ? (syncDomainAdapters.getConnectedNodeSnapshot() || {})
    : {};
  const lagPolicy = typeof syncDomainAdapters.getLagPolicy === 'function'
    ? (syncDomainAdapters.getLagPolicy(syncState, bhsSnapshot) || null)
    : null;
  const localHeight = Math.max(0, Number(syncState.localHeight || 0));
  const highestBlock = Math.max(0, Number(bhsSnapshot.tipHeight || 0));
  const lag = Math.max(0, highestBlock - localHeight);
  const hasActiveQueueCommand = Array.isArray(queueState.commands)
    && queueState.commands.some((row) => ['pending', 'claimed'].includes(String(row?.status || '')));
  const hasActiveJob = Boolean(jobState.currentJob)
    && ['running', 'claimed', 'pending'].includes(String(jobState?.currentJob?.status || 'running'));
  const hasIndependentRuntimeActivity = independentSync?.active === true
    || ['running', 'round_running', 'round_committing', 'p2p_service_window'].includes(String(independentSync?.phase || ''));
  const bootstrapHeight = Math.max(0, Number(syncState.bootstrapHeight || 0));
  const syncStartLocalFloor = Math.max(0, bootstrapHeight - 1);
  const hasManagedSyncActivity = hasActiveQueueCommand || hasActiveJob || hasIndependentRuntimeActivity;
  if (!hasManagedSyncActivity && syncState.manualQuickstartPending !== true) {
    independentSync = {
      active: false,
      phase: 'idle',
      activeNodeCount: 0,
      activeNodes: [],
      successNodeCount: 0,
      successNodes: [],
      localHeight: Math.max(syncStartLocalFloor, Number(syncState.localHeight || 0)),
      targetHeight: 0,
      updatedAt: String(syncState.updatedAt || nowIso()),
    };
    connectedNodes = {
      ...(connectedNodes && typeof connectedNodes === 'object' ? connectedNodes : {}),
      activeSyncNodeCount: 0,
      activeSyncNodeList: [],
      syncWorkerNodes: 0,
      syncWorkerNodeList: [],
      onlineNodeList: Array.isArray(connectedNodes?.onlineNodeList)
        ? connectedNodes.onlineNodeList.map((row) => {
          if (!row || typeof row !== 'object') return row;
          const roles = Array.isArray(row.roles)
            ? row.roles.filter((role) => String(role || '') !== 'sync_active')
            : [];
          return { ...row, roles };
        })
        : [],
    };
  }
  const receiptCommittedHeight = hasManagedSyncActivity
    ? Math.max(
      Number(localHeight || 0),
      Number(syncDomainAdapters.getReceiptCommittedHeight?.() || 0),
    )
    : Math.max(syncStartLocalFloor, Number(syncState.localHeight || 0));
  const nodePool = typeof syncDomainAdapters.deriveSyncNodePool === 'function'
    ? (syncDomainAdapters.deriveSyncNodePool(independentSync) || [])
    : [];
  const activeSyncNodeList = Array.from(new Set(
    Array.isArray(connectedNodes.activeSyncNodeList) ? connectedNodes.activeSyncNodeList : [],
  ));
  const independentPhaseRaw = String(independentSync.phase || '');
  const displayIndependentPhase = (
    hasManagedSyncActivity
    && lag > 0
    && (!independentPhaseRaw || independentPhaseRaw === 'idle' || independentPhaseRaw === 'done')
  )
    ? 'running'
    : independentPhaseRaw;
  const syncStartHeight = bootstrapHeight;
  const syncedBlocks = Math.max(0, localHeight - syncStartLocalFloor);
  const runtimeState = ensureRuntimeState();
  runtimeState.lifecycle.loaded = true;
  runtimeState.lifecycle.started = syncDomainStarted === true;
  runtimeState.lifecycle.online = highestBlock > 0 && lag === 0;
  const storedAutoSyncEnabled = runtimeState.lifecycle.autoSyncEnabled !== false;
  const lastResetReason = String(runtimeState.control?.lastResetReason || '');
  const quickstartCompleted = (
    syncState.manualQuickstartPending !== true
    && bootstrapHeight > 0
    && localHeight >= bootstrapHeight
  );
  const restoreAutoSyncAfterQuickstart = (
    runtimeState.lifecycle.paused !== true
    && storedAutoSyncEnabled === false
    && quickstartCompleted
    && lastResetReason.includes('projection_reset')
  );
  runtimeState.lifecycle.autoSyncEnabled = runtimeState.lifecycle.paused === true
    ? false
    : (storedAutoSyncEnabled || restoreAutoSyncAfterQuickstart);
  runtimeState.lifecycle.mode = highestBlock <= 0
    ? 'OUT_OF_SYNC'
    : String((lagPolicy && lagPolicy.mode) || syncState.mode || (lag > 0 ? 'catchup_sync' : 'idle'));
  runtimeState.lifecycle.updatedAt = nowIso();
  runtimeState.bhs = {
    tipHeight: Math.max(0, Number(bhsSnapshot.tipHeight || 0)),
    tipHash: String(bhsSnapshot.tipHash || ''),
    ok: Boolean(bhsSnapshot.ok === true || Number(bhsSnapshot.tipHeight || 0) > 0),
    updatedAt: String(bhsSnapshot.updatedAt || runtimeState.lifecycle.updatedAt),
  };
  runtimeState.queue = {
    pendingCount: queueState.commands.filter((row) => String(row.status || '') === 'pending').length,
    claimedCount: queueState.commands.filter((row) => String(row.status || '') === 'claimed').length,
    lastCommand: hasActiveQueueCommand
      ? summarizeCommand(
        queueState.commands.filter((row) => ['pending', 'claimed'].includes(String(row?.status || ''))).slice(-1)[0] || null,
      )
      : null,
    commands: [],
  };
  runtimeState.job = {
    currentJob: summarizeJob(jobState.currentJob),
    recentJobs: [],
  };
  runtimeState.progress = {
    bootstrapHeight: Math.max(0, Number(syncState.bootstrapHeight || 0)),
    localHeight,
    highestBlock,
    fixedSyncLastHeight: Math.max(0, Number(syncState.fixedSyncLastHeight || 0)),
    p2pTipHeight: Math.max(0, Number(syncState.p2pTipHeight || 0)),
    p2pHeaderCursorHeight: Number.isFinite(Number(syncState.p2pHeaderCursorHeight)) ? Number(syncState.p2pHeaderCursorHeight) : -1,
    lag,
    targetHeight: Math.max(localHeight, Number(independentSync.targetHeight || 0)),
    receiptCommittedHeight,
    syncStartHeight,
    syncedBlocks,
    independentPhase: displayIndependentPhase,
    independentUpdatedAt: String(independentSync.updatedAt || ''),
    independentLocalHeight: Math.max(0, Number(independentSync.localHeight || 0)),
    independentTargetHeight: Math.max(0, Number(independentSync.targetHeight || 0)),
  };
  runtimeState.nodes = {
    connectedCount: Math.max(0, Number(connectedNodes.connectedCount || 0)),
    activeSyncNodeCount: Math.max(0, Number(connectedNodes.activeSyncNodeCount || activeSyncNodeList.length)),
    activeSyncNodeList,
    nodePool: compactNodePool(nodePool),
    syncWorkerNodes: Math.max(0, Number(connectedNodes.syncWorkerNodes || 0)),
    syncWorkerNodeList: Array.isArray(connectedNodes.syncWorkerNodeList) ? connectedNodes.syncWorkerNodeList : [],
    spvWorkingNodes: Math.max(0, Number(connectedNodes.spvWorkingNodes || 0)),
    onlineNodeList: Array.isArray(connectedNodes.onlineNodeList) ? connectedNodes.onlineNodeList : [],
    candidateNodeList: Array.isArray(connectedNodes.candidateNodeList) ? connectedNodes.candidateNodeList : [],
    candidateNodes: Math.max(0, Number(connectedNodes.candidateNodes || 0)),
    totalNodes: Math.max(0, Number(connectedNodes.totalNodes || 0)),
  };
  runtimeState.runtime = {
    lagPolicy: lagPolicy ? cloneJsonSafe(lagPolicy, null) : null,
    wallet: connectedNodes.wallet || null,
    stewardObservedP2P: connectedNodes.stewardObservedP2P || null,
  };
  runtimeState.status = {
    sync: {
      mode: runtimeState.lifecycle.mode,
      online: runtimeState.lifecycle.online,
      localHeight,
      highestBlock,
      lag,
      bootstrapHeight: runtimeState.progress.bootstrapHeight,
      sessionEpoch: Math.max(0, Number(syncState.sessionEpoch || 0)),
      fixedSyncLastHeight: runtimeState.progress.fixedSyncLastHeight,
      p2pHeaderCursorHeight: runtimeState.progress.p2pHeaderCursorHeight,
      p2pTipHeight: runtimeState.progress.p2pTipHeight,
      syncStartHeight,
      syncedBlocks,
      independentPhase: runtimeState.progress.independentPhase,
      independentUpdatedAt: runtimeState.progress.independentUpdatedAt,
      independentLocalHeight: runtimeState.progress.independentLocalHeight,
      independentTargetHeight: runtimeState.progress.independentTargetHeight,
      connectedNodes: runtimeState.nodes.connectedCount,
      activeSyncNodes: runtimeState.nodes.activeSyncNodeCount,
      activeSyncNodeList,
      nodePool: runtimeState.nodes.nodePool,
      spvWorkingNodes: runtimeState.nodes.spvWorkingNodes,
      syncWorkerNodes: runtimeState.nodes.syncWorkerNodes,
      syncWorkerNodeList: runtimeState.nodes.syncWorkerNodeList,
      candidateNodes: runtimeState.nodes.candidateNodes,
      totalNodes: runtimeState.nodes.totalNodes,
      bhs: runtimeState.bhs,
      paused: runtimeState.lifecycle.paused === true,
      autoSyncEnabled: runtimeState.lifecycle.autoSyncEnabled !== false,
      receiptCommittedHeight,
    },
    runtime: runtimeState.runtime,
    jobState: {
      currentJob: runtimeState.job.currentJob,
      recentJobs: [],
    },
    commandQueue: {
      pendingCount: runtimeState.queue.pendingCount,
      claimedCount: runtimeState.queue.claimedCount,
      lastCommand: runtimeState.queue.lastCommand,
    },
  };
  return compactRuntimeState(runtimeState);
}

async function refreshRuntimeState(reason = 'runtime.refresh', options = {}) {
  const snapshot = buildRuntimeStateFromProjection(options);
  await broadcastRuntimeSummary(reason, snapshot);
  return snapshot;
}

async function maybeAutoSync(reason = 'bhs.tip.changed', options = {}) {
  const runtime = buildRuntimeStateFromProjection({ fresh: true });
  if (runtime.lifecycle.paused === true) return { started: false, reason: 'paused', runtime };
  if (runtime.lifecycle.autoSyncEnabled === false) return { started: false, reason: 'auto_sync_disabled', runtime };
  if (runtime.progress.lag <= 0) return { started: false, reason: 'no_lag', runtime };
  if (hasQueuedOrActiveChainSync({ fresh: true })) return { started: false, reason: 'already_active', runtime };
  if (typeof syncDomainAdapters.buildAutoSyncCommandPayload !== 'function') {
    return { started: false, reason: 'no_adapter', runtime };
  }
  const commandPayload = syncDomainAdapters.buildAutoSyncCommandPayload({
    reason,
    runtime,
    syncState: runtime.status?.sync || null,
    bhs: runtime.bhs,
    options,
  }) || null;
  if (!commandPayload || typeof commandPayload !== 'object') {
    return { started: false, reason: 'empty_payload', runtime };
  }
  const row = await enqueueCommand('run_chain_sync', commandPayload.payload || {}, commandPayload.options || {});
  if (typeof syncDomainAdapters.notifySyncNow === 'function') {
    try { syncDomainAdapters.notifySyncNow(); } catch (_) {}
  }
  await refreshRuntimeState('sync.auto_enqueued');
  return { started: true, command: row, runtime: getSyncRuntimeSnapshot() };
}

function ensureRuntimeSubscriptions() {
  if (!runtimeBhsSubscribed) {
    runtimeBhsSubscribed = true;
    messageQueue.subscribe('bhs.tip.changed', (payload) => {
      void (async () => {
        const state = ensureRuntimeState();
        state.bhs.tipHeight = Math.max(0, Number(payload?.tipHeight || 0));
        state.bhs.tipHash = String(payload?.tipHash || '');
        state.bhs.ok = Number(state.bhs.tipHeight || 0) > 0;
        state.bhs.updatedAt = nowIso();
        await refreshRuntimeState('bhs.tip.changed');
        await maybeAutoSync('bhs.tip.changed');
      })().catch(() => {});
    });
  }
  if (!runtimeControlSubscribed) {
    runtimeControlSubscribed = true;
    messageQueue.subscribe('sync.command.pause', (payload) => {
      void pauseSync(String(payload?.reason || 'external_pause')).catch(() => {});
    });
    messageQueue.subscribe('sync.command.resume', (payload) => {
      void resumeSync(String(payload?.reason || 'external_resume')).catch(() => {});
    });
    messageQueue.subscribe('sync.command.sync_now', (payload) => {
      void requestSyncNow(String(payload?.reason || 'external_sync_now')).catch(() => {});
    });
  }
}

async function startSyncDomain(options = {}) {
  setSyncDomainAdapters(options.adapters || options);
  ensureRuntimeSubscriptions();
  syncDomainStarted = true;
  const state = ensureRuntimeState();
  state.lifecycle.loaded = true;
  state.lifecycle.started = true;
  state.lifecycle.updatedAt = nowIso();
  await refreshRuntimeState('sync_domain.started', { fresh: true });
  if (typeof syncDomainAdapters.primeBhsTip === 'function') {
    void Promise.resolve()
      .then(() => syncDomainAdapters.primeBhsTip())
      .then(() => refreshRuntimeState('sync_domain.prime_bhs_tip'))
      .catch(() => {});
  }
  return getSyncRuntimeSnapshot();
}

async function stopSyncDomain(reason = 'stop') {
  const state = ensureRuntimeState();
  syncDomainStarted = false;
  state.lifecycle.started = false;
  state.lifecycle.updatedAt = nowIso();
  await broadcastRuntimeSummary(`sync_domain.stopped:${reason}`, state);
  return cloneRuntimeState(state);
}

function getSyncRuntimeSnapshot() {
  return cloneRuntimeState(ensureRuntimeState());
}

function getSyncStatus(options = {}) {
  if (options.confirm === true) {
    return buildRuntimeStateFromProjection({ fresh: true }).status;
  }
  const snapshot = ensureRuntimeState();
  if (snapshot.status?.sync) return cloneJsonSafe(snapshot.status, null);
  return buildRuntimeStateFromProjection({ fresh: false }).status;
}

async function pauseSync(reason = 'pause') {
  const state = ensureRuntimeState();
  state.lifecycle.paused = true;
  state.lifecycle.autoSyncEnabled = false;
  state.control.pauseReason = String(reason || 'pause');
  state.progress.independentPhase = 'idle';
  state.progress.independentUpdatedAt = nowIso();
  state.progress.syncWorkerNodes = 0;
  state.nodes.activeSyncNodeCount = 0;
  state.nodes.connectedCount = 0;
  state.nodes.syncWorkerNodes = 0;
  state.nodes.syncWorkerNodeList = [];
  state.nodes.activeSyncNodeList = [];
  state.lifecycle.updatedAt = nowIso();
  await broadcastRuntimeSummary('sync.paused', state);
  return cloneRuntimeState(state);
}

async function resumeSync(reason = 'resume') {
  const state = ensureRuntimeState();
  state.lifecycle.paused = false;
  state.lifecycle.autoSyncEnabled = true;
  state.control.pauseReason = '';
  state.control.lastManualTriggerReason = String(reason || 'resume');
  state.lifecycle.updatedAt = nowIso();
  await refreshRuntimeState('sync.resumed', { fresh: true });
  await maybeAutoSync('resume');
  return getSyncRuntimeSnapshot();
}

async function startManualSyncMode(reason = 'manual_sync_start') {
  const state = ensureRuntimeState();
  state.lifecycle.paused = false;
  state.lifecycle.autoSyncEnabled = false;
  state.control.pauseReason = '';
  state.control.lastManualTriggerAt = nowIso();
  state.control.lastManualTriggerReason = String(reason || 'manual_sync_start');
  state.lifecycle.updatedAt = nowIso();
  await refreshRuntimeState('sync.manual_mode', { fresh: true });
  return getSyncRuntimeSnapshot();
}

async function requestSyncNow(reason = 'manual_sync_now', options = {}) {
  const state = ensureRuntimeState();
  state.control.lastManualTriggerAt = nowIso();
  state.control.lastManualTriggerReason = String(reason || 'manual_sync_now');
  await refreshRuntimeState('sync.requested', { fresh: true });
  const allowWhilePaused = options?.allowWhilePaused === true;
  const allowWhenAutoSyncDisabled = options?.allowWhenAutoSyncDisabled === true;
  if (state.lifecycle.paused === true && !allowWhilePaused) {
    return { ok: false, reason: 'paused', runtime: getSyncRuntimeSnapshot() };
  }
  if (state.lifecycle.autoSyncEnabled === false && !allowWhenAutoSyncDisabled) {
    return { ok: false, reason: 'auto_sync_disabled', runtime: getSyncRuntimeSnapshot() };
  }
  if (typeof syncDomainAdapters.buildAutoSyncCommandPayload !== 'function') {
    return { ok: false, reason: 'no_adapter', runtime: getSyncRuntimeSnapshot() };
  }
  if (hasQueuedOrActiveChainSync({ fresh: true })) {
    return { ok: true, deduped: true, runtime: getSyncRuntimeSnapshot() };
  }
  const runtime = getSyncRuntimeSnapshot();
  const commandPayload = syncDomainAdapters.buildAutoSyncCommandPayload({
    reason,
    runtime,
    syncState: runtime.status?.sync || null,
    bhs: runtime.bhs,
    options,
  }) || null;
  if (!commandPayload || typeof commandPayload !== 'object') {
    return { ok: false, reason: 'empty_payload', runtime };
  }
  const row = await enqueueCommand('run_chain_sync', commandPayload.payload || {}, commandPayload.options || {});
  if (typeof syncDomainAdapters.notifySyncNow === 'function') {
    try { syncDomainAdapters.notifySyncNow(); } catch (_) {}
  }
  await refreshRuntimeState('sync.manual_enqueued');
  return { ok: true, command: row, runtime: getSyncRuntimeSnapshot() };
}

function subscribeRuntime(listener) {
  if (typeof listener !== 'function') return () => {};
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
}

module.exports = {
  SYNC_CONSUMER,
  startSyncDomain,
  stopSyncDomain,
  setSyncDomainAdapters,
  subscribeRuntime,
  getSyncRuntimeSnapshot,
  getSyncStatus,
  pauseSync,
  resumeSync,
  startManualSyncMode,
  requestSyncNow,
  hasQueuedOrActiveChainSync,
  catchUpProjection,
  emitSyncEvent,
  emitSyncStateSnapshot,
  enqueueCommand,
  claimNextCommand,
  markCommandFinished,
  releaseClaimedCommand,
  updateJobState,
  resetProjectionState,
  primeProjectionState,
  recoverStewardQueue,
  interruptPendingCommands,
  interruptQueuedCommands,
  interruptStaleClaimedCommands,
  getCommandQueueState,
  getJobState,
  getSyncStateSync,
  getCommandById,
  findJobSnapshotById,
  hasPendingOrClaimedCommand,
};
