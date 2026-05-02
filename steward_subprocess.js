const fs = require('fs');
const path = require('path');

function loadLocalEnvFile() {
  if (process.platform !== 'win32') return;
  const envPath = path.join(__dirname, '.env.market');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = String(raw || '').trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"'))
        || (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  } catch (_) {}
}
loadLocalEnvFile();

process.env.BSV_MARKET_HEADLESS_RUNTIME = '1';

const serverMarket = require('./server_market');
const wallet = require('./wallet');
const independentSyncRuntime = require('./independent_sync_runtime');
const independentSyncService = require('./independent_sync_service');
const syncDomain = require('./sync_domain');
const messageQueue = require('./lib/message_queue');
const { createSyncAuthRuntime } = require('./sync_auth_runtime');

const PORT = Number(process.env.BSV_MARKET_PORT || 8091);
const DATA_DIR = path.join(__dirname, 'data');
const LOG_DIR = path.join(__dirname, 'log');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'steward_worker.json');
const LOG_FILE = path.join(LOG_DIR, 'steward-worker.log');
const SYNC_TIMEOUT_MS = Math.max(30000, Number(process.env.BSV_MARKET_STEWARD_SYNC_TIMEOUT_MS || 600000));
const CONFIRMED_SYNC_STATUS_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.BSV_MARKET_STEWARD_STATUS_TIMEOUT_MS || 5000),
);

let pollSec = Math.max(5, Number(process.env.BSV_MARKET_STEWARD_POLL_SEC || 15));
const FAST_POLL_SEC = Math.max(2, Number(process.env.BSV_MARKET_STEWARD_FAST_POLL_SEC || 10));
const CATCHUP_POLL_SEC = Math.max(1, Number(process.env.BSV_MARKET_STEWARD_CATCHUP_POLL_SEC || 1));
const CATCHUP_LAG_BLOCKS = Math.max(1, Number(process.env.BSV_MARKET_STEWARD_CATCHUP_LAG_BLOCKS || 100));
const HEARTBEAT_PROGRESS_MS = Math.max(2000, Number(process.env.BSV_MARKET_STEWARD_HEARTBEAT_PROGRESS_MS || 5000));
let timer = null;
let inFlight = false;
let progressHeartbeatTimer = null;
const sensitiveCommands = new Map();
let initialEpochReceived = false;
let initialTickStarted = false;
let pendingSyncNow = false;
let bootstrapTimer = null;
let transientBackoffUntilMs = 0;
const syncAuthRuntime = createSyncAuthRuntime();

function detectTransientQueueBackoffMs(error) {
  const message = String(error?.message || '');
  if (
    message.includes('claim_next_durable_message')
    || message.includes('finish_durable_message')
    || message.includes('market_db parent proxy timed out')
    || message.includes('market_db request timed out')
    || message.includes('sync_domain parent proxy timed out')
  ) {
    return 15000;
  }
  return 0;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(event, payload = {}) {
  try {
    ensureDataDir();
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      event,
      ...payload,
    });
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch (_) {}
}

function readProcStatusMemorySummary() {
  if (process.platform === 'win32') return {};
  try {
    const text = fs.readFileSync('/proc/self/status', 'utf8');
    const pickKb = (label) => {
      const match = text.match(new RegExp(`^${label}:\\s+(\\d+)\\s+kB$`, 'm'));
      return match ? Number(match[1] || 0) : 0;
    };
    return {
      vmRssMb: Number((pickKb('VmRSS') / 1024).toFixed(1)),
      rssAnonMb: Number((pickKb('RssAnon') / 1024).toFixed(1)),
      rssFileMb: Number((pickKb('RssFile') / 1024).toFixed(1)),
      rssShmemMb: Number((pickKb('RssShmem') / 1024).toFixed(1)),
      vmSwapMb: Number((pickKb('VmSwap') / 1024).toFixed(1)),
    };
  } catch (_) {
    return {};
  }
}

function getMemoryUsageSummary() {
  try {
    const usage = process.memoryUsage();
    return {
      rssMb: Number((Number(usage.rss || 0) / (1024 * 1024)).toFixed(1)),
      heapUsedMb: Number((Number(usage.heapUsed || 0) / (1024 * 1024)).toFixed(1)),
      heapTotalMb: Number((Number(usage.heapTotal || 0) / (1024 * 1024)).toFixed(1)),
      externalMb: Number((Number(usage.external || 0) / (1024 * 1024)).toFixed(1)),
      arrayBuffersMb: Number((Number(usage.arrayBuffers || 0) / (1024 * 1024)).toFixed(1)),
      ...readProcStatusMemorySummary(),
    };
  } catch (_) {
    return {};
  }
}

function logMemoryProfile(event, payload = {}) {
  log(event, {
    ...getMemoryUsageSummary(),
    ...(payload && typeof payload === 'object' ? payload : {}),
  });
}

function heartbeat(extra = {}) {
  const memBefore = process.memoryUsage();
  let spvSnapshot = null;
  try {
    spvSnapshot = wallet.getSpvNodeSnapshot(8);
    const runtimeSnapshot = typeof wallet.getSpvRuntimeSnapshot === 'function'
      ? wallet.getSpvRuntimeSnapshot()
      : null;
    const runtimeConnected = Array.isArray(runtimeSnapshot?.connectedNodes)
      ? runtimeSnapshot.connectedNodes.map((row) => String(row || '').trim()).filter(Boolean)
      : [];
    if (
      spvSnapshot
      && Number(spvSnapshot.connectedCount || 0) > 0
      && (!Array.isArray(spvSnapshot.connected) || spvSnapshot.connected.length === 0)
      && runtimeConnected.length > 0
    ) {
      const candidateRows = Array.isArray(spvSnapshot.candidates) ? spvSnapshot.candidates : [];
      const candidateByEndpoint = new Map(
        candidateRows
          .map((row) => [String(row?.endpoint || '').trim(), row])
          .filter(([endpoint]) => Boolean(endpoint)),
      );
      spvSnapshot = {
        ...spvSnapshot,
        connected: runtimeConnected.slice(0, 20).map((endpoint, idx) => {
          const row = candidateByEndpoint.get(endpoint);
          return {
            rank: idx + 1,
            endpoint,
            ...(row && typeof row === 'object' ? row : {}),
          };
        }),
      };
    }
  } catch (_) {}
  try {
    ensureDataDir();
    const memory = getMemoryUsageSummary();
    const payload = {
      ts: new Date().toISOString(),
      pid: process.pid,
      pollSec,
      inFlight,
      ...memory,
      ...extra,
      ...(spvSnapshot ? { spvSnapshot } : {}),
    };
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(payload, null, 2));
    if (typeof process.send === 'function') {
      process.send({
        type: 'stewardHeartbeat',
        ...payload,
      });
    }
    const memAfter = process.memoryUsage();
    log('memory_profile_steward_heartbeat', {
      ...memory,
      phase: String(extra?.phase || ''),
      connectedCount: Number(spvSnapshot?.connectedCount || 0),
      candidateCount: Number(spvSnapshot?.candidateCount || 0),
      rssDeltaMb: Number(((Number(memAfter.rss || 0) - Number(memBefore.rss || 0)) / (1024 * 1024)).toFixed(1)),
      heapDeltaMb: Number(((Number(memAfter.heapUsed || 0) - Number(memBefore.heapUsed || 0)) / (1024 * 1024)).toFixed(1)),
    });
  } catch (_) {}
}

async function fetchConfirmedSyncStatus() {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = setTimeout(() => {
    try { controller?.abort?.(); } catch (_) {}
  }, CONFIRMED_SYNC_STATUS_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/api/sync/status`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller?.signal,
    });
    if (!response.ok) {
      throw new Error(`sync status http ${response.status}`);
    }
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') {
      throw new Error('invalid sync status payload');
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

function notifyParentSyncLagRemaining(lag, source = 'steward_sync', error = '') {
  const normalizedLag = Math.max(0, Number(lag || 0));
  if (normalizedLag <= 0) return;
  if (typeof process.send === 'function') {
    try {
      process.send({
        type: 'syncLagRemaining',
        lag: normalizedLag,
        source: String(source || 'steward_sync'),
        error: String(error || ''),
        ts: new Date().toISOString(),
      });
      return;
    } catch (_) {}
  }
  messageQueue.publish('sync.lag.remaining', {
    lag: normalizedLag,
    source: String(source || 'steward_sync'),
    error: String(error || ''),
  }, {
    mode: 'transient',
    source: 'steward_worker',
  });
}

function startProgressHeartbeat() {
  if (progressHeartbeatTimer) return;
  progressHeartbeatTimer = setInterval(() => {
    heartbeat({ phase: 'sync_progress' });
  }, HEARTBEAT_PROGRESS_MS);
}

function stopProgressHeartbeat() {
  if (!progressHeartbeatTimer) return;
  clearInterval(progressHeartbeatTimer);
  progressHeartbeatTimer = null;
}

function kickoffInitialTick(reason = 'startup') {
  if (initialTickStarted) return;
  initialTickStarted = true;
  if (bootstrapTimer) {
    clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
  }
  const startNow = pendingSyncNow || reason === 'sync_epoch';
  pendingSyncNow = false;
  log('initial_tick_started', { reason, startNow });
  heartbeat({ phase: 'initial_tick_started', reason, startNow });
  if (startNow) {
    tick().catch(() => {});
  } else {
    schedule(pollSec);
  }
}

async function runNextCommand() {
  const memBefore = process.memoryUsage();
  let runtimeSnapshot = serverMarket.getStewardRuntimeSnapshot({ confirm: true });
  let queueState = runtimeSnapshot?.commandQueue || { commands: [] };
  let jobState = runtimeSnapshot?.jobState || {};
  const activeType = String(jobState?.currentJob?.jobType || '');
  const activeStatus = String(jobState?.currentJob?.status || '');
  const hasChainSyncInFlight = (
    (activeType === 'run_chain_sync' || activeType === 'rebuild_chain_indexes')
    && activeStatus === 'running'
  );
  if (!hasChainSyncInFlight) {
    const staleClaimedRecovered = await serverMarket.interruptStaleClaimedCommands((row) => {
      const type = String(row?.commandType || '');
      return type === 'run_chain_sync' || type === 'rebuild_chain_indexes';
    }, {
      minClaimAgeMs: 45000,
      reason: 'stale claimed chain sync recovered by steward',
    });
    if (staleClaimedRecovered > 0) {
      log('stale_claimed_chain_sync_recovered', {
        count: staleClaimedRecovered,
      });
      runtimeSnapshot = serverMarket.getStewardRuntimeSnapshot({ confirm: true });
      queueState = runtimeSnapshot?.commandQueue || { commands: [] };
      jobState = runtimeSnapshot?.jobState || {};
    }
  }
  const hasQueuedChainSync = Array.isArray(queueState?.commands)
    && queueState.commands.some((row) => {
      const type = String(row?.commandType || '');
      const status = String(row?.status || '');
      return (type === 'run_chain_sync' || type === 'rebuild_chain_indexes')
        && (status === 'pending' || status === 'claimed');
    });
  const hasPendingCommands = (
    (Array.isArray(queueState?.commands)
      && queueState.commands.some((row) => String(row?.status || '') === 'pending'))
    || Math.max(0, Number(queueState?.pendingCount || 0)) > 0
  );
  if (!hasPendingCommands) {
    logMemoryProfile('memory_profile_steward_run_next_idle', {
      pendingCount: Math.max(0, Number(queueState?.pendingCount || 0)),
      claimedCount: Math.max(0, Number(queueState?.claimedCount || 0)),
      rssDeltaMb: Number(((Number(process.memoryUsage().rss || 0) - Number(memBefore.rss || 0)) / (1024 * 1024)).toFixed(1)),
      heapDeltaMb: Number(((Number(process.memoryUsage().heapUsed || 0) - Number(memBefore.heapUsed || 0)) / (1024 * 1024)).toFixed(1)),
    });
    return runtimeSnapshot;
  }
  const command = await serverMarket.claimNextCommand(`steward-${process.pid}`);
  if (!command) {
    logMemoryProfile('memory_profile_steward_claim_empty', {
      pendingCount: Math.max(0, Number(queueState?.pendingCount || 0)),
      claimedCount: Math.max(0, Number(queueState?.claimedCount || 0)),
      rssDeltaMb: Number(((Number(process.memoryUsage().rss || 0) - Number(memBefore.rss || 0)) / (1024 * 1024)).toFixed(1)),
      heapDeltaMb: Number(((Number(process.memoryUsage().heapUsed || 0) - Number(memBefore.heapUsed || 0)) / (1024 * 1024)).toFixed(1)),
    });
    return runtimeSnapshot;
  }
  const secretPayload = sensitiveCommands.get(String(command.id || '')) || null;
  if (secretPayload) sensitiveCommands.delete(String(command.id || ''));
  if (String(command.commandType || '') === 'import_wallet_bootstrap' && !secretPayload) {
    await serverMarket.releaseClaimedCommand(command.id);
    logMemoryProfile('memory_profile_steward_release_import_without_secret', {
      commandId: String(command.id || ''),
      commandType: String(command.commandType || ''),
      rssDeltaMb: Number(((Number(process.memoryUsage().rss || 0) - Number(memBefore.rss || 0)) / (1024 * 1024)).toFixed(1)),
      heapDeltaMb: Number(((Number(process.memoryUsage().heapUsed || 0) - Number(memBefore.heapUsed || 0)) / (1024 * 1024)).toFixed(1)),
    });
    return serverMarket.getStewardRuntimeSnapshot({ confirm: true });
  }
  const result = await serverMarket.runStewardCommand(command, {
    workerId: `steward-${process.pid}`,
    timeoutMs: SYNC_TIMEOUT_MS,
    secretPayload,
  });
  logMemoryProfile('memory_profile_steward_run_next_done', {
    commandId: String(command.id || ''),
    commandType: String(command.commandType || ''),
    rssDeltaMb: Number(((Number(process.memoryUsage().rss || 0) - Number(memBefore.rss || 0)) / (1024 * 1024)).toFixed(1)),
    heapDeltaMb: Number(((Number(process.memoryUsage().heapUsed || 0) - Number(memBefore.heapUsed || 0)) / (1024 * 1024)).toFixed(1)),
  });
  return result;
}

async function tick() {
  if (inFlight) {
    pendingSyncNow = true;
    return;
  }
  inFlight = true;
  pendingSyncNow = false;
  const t0 = Date.now();
  const memBefore = process.memoryUsage();
  heartbeat({ phase: 'sync_start' });
  startProgressHeartbeat();
  let finalHeartbeat = { phase: 'sync_idle' };
  try {
    await runNextCommand();
    let runtimeSnapshot = serverMarket.getStewardRuntimeSnapshot({ confirm: true }) || {};
    let statusSnapshot = runtimeSnapshot?.status && typeof runtimeSnapshot.status === 'object'
      ? runtimeSnapshot.status
      : {};
    let syncSnapshot = statusSnapshot?.sync && typeof statusSnapshot.sync === 'object'
      ? statusSnapshot.sync
      : {};
    let queueSnapshot = statusSnapshot?.commandQueue && typeof statusSnapshot.commandQueue === 'object'
      ? statusSnapshot.commandQueue
      : {};
    let jobSnapshot = statusSnapshot?.jobState && typeof statusSnapshot.jobState === 'object'
      ? statusSnapshot.jobState
      : {};
    try {
      const confirmedStatus = await fetchConfirmedSyncStatus();
      if (confirmedStatus && typeof confirmedStatus === 'object') {
        statusSnapshot = confirmedStatus;
        syncSnapshot = confirmedStatus.sync && typeof confirmedStatus.sync === 'object'
          ? confirmedStatus.sync
          : syncSnapshot;
        queueSnapshot = confirmedStatus.commandQueue && typeof confirmedStatus.commandQueue === 'object'
          ? confirmedStatus.commandQueue
          : queueSnapshot;
        jobSnapshot = confirmedStatus.jobState && typeof confirmedStatus.jobState === 'object'
          ? confirmedStatus.jobState
          : jobSnapshot;
      }
    } catch (error) {
      log('confirmed_sync_status_fetch_failed', {
        error: String(error?.message || error || 'unknown'),
      });
    }
    const lag = Math.max(
      0,
      Number(syncSnapshot?.lag || (Number(syncSnapshot?.highestBlock || syncSnapshot?.networkHeight || 0) - Number(syncSnapshot?.localHeight || 0))),
    );
    const activeJobType = String(jobSnapshot?.currentJob?.jobType || '');
    const activeJobStatus = String(jobSnapshot?.currentJob?.status || '');
    const hasActiveChainSync = (
      (activeJobType === 'run_chain_sync' || activeJobType === 'rebuild_chain_indexes')
      && activeJobStatus === 'running'
    );
    const queueBusy = Math.max(0, Number(queueSnapshot?.pendingCount || 0)) > 0
      || Math.max(0, Number(queueSnapshot?.claimedCount || 0)) > 0;
    const syncPaused = syncSnapshot?.paused === true;
    const autoSyncEnabled = syncSnapshot?.autoSyncEnabled !== false;
    if (lag > 0 && !queueBusy && !hasActiveChainSync && !syncPaused && autoSyncEnabled) {
      const policyBudget = Math.max(2, Number(runtimeSnapshot?.runtime?.lagPolicy?.syncNodeBudget || 2));
      await serverMarket.enqueueCommand('run_chain_sync', {
        source: 'steward_idle_lag_recovery',
        options: {
          syncNodeBudget: policyBudget,
          leasesPerBlock: 1,
          backupLeasesPerBlock: 2,
          parallelBlocks: policyBudget,
          dynamicTargetHeight: true,
          trustedSyncSnapshot: syncSnapshot,
        },
      }, {
        dedupePending: true,
        dedupeKey: `steward_idle_lag_recovery:${Number(syncSnapshot?.localHeight || 0)}:${Number(syncSnapshot?.highestBlock || syncSnapshot?.networkHeight || 0)}`,
      });
      log('steward_idle_lag_recovery_enqueued', {
        lag,
        localHeight: Number(syncSnapshot?.localHeight || 0),
        highestBlock: Number(syncSnapshot?.highestBlock || syncSnapshot?.networkHeight || 0),
        policyBudget,
      });
    }
    const nextDelaySec = lag >= CATCHUP_LAG_BLOCKS
      ? Math.min(pollSec, FAST_POLL_SEC, CATCHUP_POLL_SEC)
      : (lag > 0 ? Math.min(pollSec, FAST_POLL_SEC) : pollSec);
    log('sync_ok', { elapsedMs: Date.now() - t0, lag, nextDelaySec });
    heartbeat({ phase: 'sync_ok', elapsedMs: Date.now() - t0, lag, nextDelaySec });
    finalHeartbeat = {
      phase: 'idle',
      lastPhase: 'sync_ok',
      elapsedMs: Date.now() - t0,
      lag,
      nextDelaySec,
    };
    if (lag > 0) notifyParentSyncLagRemaining(lag, 'steward_sync_ok');
    schedule(nextDelaySec);
  } catch (err) {
    let remainingLag = 0;
    try {
      const runtimeSnapshot = serverMarket.getStewardRuntimeSnapshot({ confirm: true });
      const sync = runtimeSnapshot?.sync || {};
      remainingLag = Math.max(
        0,
        Number(sync?.lag || (Number(sync?.networkHeight || 0) - Number(sync?.localHeight || 0))),
      );
    } catch (_) {
      remainingLag = 0;
    }
    const transientBackoffMs = detectTransientQueueBackoffMs(err);
    if (transientBackoffMs > 0) transientBackoffUntilMs = Date.now() + transientBackoffMs;
    const nextDelaySec = transientBackoffMs > 0
      ? Math.max(pollSec, Math.ceil(transientBackoffMs / 1000))
      : Math.min(pollSec, FAST_POLL_SEC);
    log('sync_failed', { elapsedMs: Date.now() - t0, error: err.message || 'sync failed', nextDelaySec });
    heartbeat({ phase: 'sync_failed', elapsedMs: Date.now() - t0, error: err.message || 'sync failed', nextDelaySec });
    finalHeartbeat = {
      phase: 'idle',
      lastPhase: 'sync_failed',
      elapsedMs: Date.now() - t0,
      error: err.message || 'sync failed',
      lag: remainingLag,
      nextDelaySec,
    };
    if (remainingLag > 0) notifyParentSyncLagRemaining(remainingLag, 'steward_sync_failed', err.message || 'sync failed');
    schedule(nextDelaySec);
  } finally {
    const memAfter = process.memoryUsage();
    logMemoryProfile('memory_profile_steward_tick', {
      elapsedMs: Date.now() - t0,
      rssDeltaMb: Number(((Number(memAfter.rss || 0) - Number(memBefore.rss || 0)) / (1024 * 1024)).toFixed(1)),
      heapDeltaMb: Number(((Number(memAfter.heapUsed || 0) - Number(memBefore.heapUsed || 0)) / (1024 * 1024)).toFixed(1)),
    });
    stopProgressHeartbeat();
    inFlight = false;
    heartbeat(finalHeartbeat);
    if (pendingSyncNow) {
      pendingSyncNow = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      setImmediate(() => {
        tick().catch(() => {});
      });
    }
  }
}

function schedule(delaySec = pollSec) {
  if (timer) clearTimeout(timer);
  const baseWaitMs = Math.max(1, Number(delaySec || pollSec)) * 1000;
  const now = Date.now();
  const extraBackoffMs = Math.max(0, transientBackoffUntilMs - now);
  const waitMs = Math.max(baseWaitMs, extraBackoffMs);
  timer = setTimeout(() => {
    tick().catch(() => {});
  }, waitMs);
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'auth.snapshot' || msg.type === 'auth.logged_in' || msg.type === 'auth.logged_out') {
    const snapshot = syncAuthRuntime.applySnapshot(msg.snapshot || {}, {
      source: String(msg?.source || msg.type || 'auth_snapshot'),
    });
    const password = String(snapshot.walletPassword || '');
    if (password) serverMarket.setRuntimeWalletPassword(password, { propagate: false, refreshViews: false });
    else serverMarket.clearRuntimeWalletPassword({ propagate: false, refreshViews: false });
    log('auth_snapshot_updated', {
      loggedIn: snapshot.loggedIn === true,
      authEpoch: Number(snapshot.authEpoch || 0),
      loginEpoch: Number(snapshot.loginEpoch || 0),
    });
    heartbeat({
      phase: 'auth_snapshot_updated',
      loggedIn: snapshot.loggedIn === true,
      authEpoch: Number(snapshot.authEpoch || 0),
    });
    return;
  }
  if (msg.type === 'setPollSec') {
    const next = Math.max(5, Number(msg.pollSec || pollSec));
    pollSec = next;
    if (!inFlight) schedule(pollSec);
    log('poll_sec_updated', { pollSec });
    heartbeat({ phase: 'poll_sec_updated' });
    return;
  }
  if (msg.type === 'syncEpoch') {
    const epoch = Math.max(0, Number(msg.epoch || 0));
    if (typeof serverMarket.forceSyncSessionEpoch === 'function') {
      serverMarket.forceSyncSessionEpoch(epoch, 'steward_ipc');
    }
    initialEpochReceived = true;
    log('sync_epoch_updated', { epoch, inFlight });
    heartbeat({ phase: 'sync_epoch_updated', epoch, inFlight });
    return;
  }
  if (msg.type === 'resetSyncArtifacts') {
    const bootstrapHeight = Math.max(0, Number(msg.bootstrapHeight || 0));
    const localHeight = Math.max(
      0,
      Number(msg.localHeight ?? (bootstrapHeight > 0 ? (bootstrapHeight - 1) : 0)),
    );
    const targetHeight = Math.max(0, Number(msg.targetHeight || 0));
    const resetEpoch = Math.max(0, Number(msg.resetEpoch || 0));
    const manualQuickstartPending = msg.manualQuickstartPending === true;
    try {
      if (typeof independentSyncService?.cancelActiveRun === 'function') {
        independentSyncService.cancelActiveRun('sync reset');
      }
    } catch (_) {}
    try {
      if (typeof independentSyncService?.resetServiceState === 'function') {
        independentSyncService.resetServiceState();
      }
    } catch (_) {}
    try {
      if (typeof independentSyncRuntime?.resetStatus === 'function') {
        independentSyncRuntime.resetStatus({
          bootstrapHeight,
          localHeight,
          targetHeight,
        });
      }
    } catch (_) {}
    try {
      if (typeof serverMarket?.resetP2PSyncReceiptsState === 'function') {
        serverMarket.resetP2PSyncReceiptsState({
          bootstrapHeight,
          committedHeight: localHeight,
        });
      }
    } catch (_) {}
    try {
      if (typeof serverMarket?.reinitializeRuntimeProjectionStateForSyncReset === 'function') {
        serverMarket.reinitializeRuntimeProjectionStateForSyncReset({
          syncState: {
            bootstrapHeight,
            localHeight,
            fixedSyncLastHeight: 0,
            p2pTipHeight: targetHeight,
            p2pHeaderCursorHeight: localHeight,
            targetHeight,
            independentTargetHeight: targetHeight,
            manualQuickstartPending,
            sessionEpoch: resetEpoch,
          },
          reason: 'steward_sync_reset',
        });
      }
    } catch (_) {}
    try {
      if (typeof syncDomain?.primeProjectionState === 'function') {
        syncDomain.primeProjectionState({
          bootstrapHeight,
          localHeight,
          fixedSyncLastHeight: 0,
          p2pTipHeight: targetHeight,
          p2pHeaderCursorHeight: localHeight,
          sessionEpoch: resetEpoch,
          manualQuickstartPending,
        }, {
          reason: 'steward_sync_reset',
          paused: manualQuickstartPending !== true,
          autoSyncEnabled: false,
          pauseReason: manualQuickstartPending === true ? '' : 'manual_sync_state_reset',
        });
      }
    } catch (_) {}
    log('sync_artifacts_reset', {
      bootstrapHeight,
      localHeight,
      targetHeight,
      resetEpoch,
      manualQuickstartPending,
      inFlight,
    });
    heartbeat({
      phase: 'sync_reset',
      bootstrapHeight,
      localHeight,
      targetHeight,
      inFlight,
    });
    return;
  }
  if (msg.type === 'syncNow') {
    log('sync_now_signal', { inFlight });
    if (!initialTickStarted) {
      pendingSyncNow = true;
      if (initialEpochReceived) kickoffInitialTick('sync_now');
      return;
    }
    if (inFlight) {
      pendingSyncNow = true;
      return;
    }
    tick().catch(() => {});
    return;
  }
  if (msg.type === 'queueImportWalletBootstrap') {
    const commandId = String(msg.commandId || '').trim();
    if (!commandId) return;
    sensitiveCommands.set(commandId, {
      mnemonic: String(msg.mnemonic || ''),
      password: String(msg.password || ''),
      bootstrapMode: String(msg.bootstrapMode || 'lightweight'),
      addressCount: Number(msg.addressCount || 50),
    });
    log('import_wallet_bootstrap_buffered', {
      commandId,
      bootstrapMode: String(msg.bootstrapMode || 'lightweight'),
      addressCount: Number(msg.addressCount || 50),
    });
    tick().catch(() => {});
  }
});

messageQueue.subscribe('sync.now', () => {
  log('sync_now_signal', { inFlight, source: 'runtime_bus' });
  if (!initialTickStarted) {
    pendingSyncNow = true;
    if (initialEpochReceived) kickoffInitialTick('sync_now');
    return;
  }
  if (inFlight) {
    pendingSyncNow = true;
    return;
  }
  tick().catch(() => {});
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('disconnect', () => {
  heartbeat({ phase: 'parent_disconnected' });
  process.exit(0);
});

ensureDataDir();
if (typeof process.send === 'function') {
  try {
    process.send({ type: 'auth.query', source: 'steward_startup' });
  } catch (_) {}
}
void serverMarket.recoverStewardQueue();
// Do not start the wallet SPV listener inside the steward worker.
// This subprocess should be dedicated to queued sync work; otherwise it opens
// a second node pool that competes with the sync service for the same public peers.
log('worker_started', { port: PORT, pollSec, fastPollSec: FAST_POLL_SEC });
heartbeat({ phase: 'started' });
bootstrapTimer = setTimeout(() => {
  kickoffInitialTick('startup_fallback');
}, 1500);
