const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const readDbPool = require('./read_db_pool');

const WRITER_ENTRY = path.join(__dirname, 'market_db_writer.js');
const DEFAULT_REQUEST_TIMEOUT_MS = Math.max(500, Number(process.env.BSV_MARKET_DB_TIMEOUT_MS || 5000));
const RESTART_DELAY_MS = Math.max(100, Number(process.env.BSV_MARKET_DB_RESTART_DELAY_MS || 300));
const DB_TRACE_SLOW_MS = Math.max(50, Number(process.env.BSV_MARKET_DB_TRACE_SLOW_MS || 250));
const SOFTEN_PARENT_PROXY_TIMEOUTS = String(process.env.BSV_MARKET_SOFTEN_PARENT_PROXY_TIMEOUTS || '1') === '1';
const PARENT_PROXY_BEST_EFFORT_ACTIONS = new Set([
  'apply_sync_projection_batch',
  'apply_wallet_tx_projection_batch',
  'apply_wallet_read_projection_batch',
  'apply_order_projection_batch',
  'write_state_json_snapshot',
  'write_p2p_sync_receipts_snapshot',
  'write_text_file_snapshot',
  'replace_catalog_snapshot',
  'finish_durable_message',
]);

let writerProcess = null;
let writerReadyPromise = null;
let restartTimer = null;
let manualStop = false;
const pendingRequests = new Map();
const parentProxyRequests = new Map();
let parentProxyListenerAttached = false;

function estimatePayloadBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch (_) {
    return -1;
  }
}

const TRACE_SKIP_PAYLOAD_BYTES_ACTIONS = new Set([
  'upsert_sync_state',
  'apply_sync_projection_batch',
  'write_sync_node_stats_snapshot',
  'write_p2p_sync_receipts_snapshot',
]);

function summarizePayloadForTrace(action, payload = {}) {
  const safeAction = String(action || '').trim();
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const summary = {
    payloadBytes: TRACE_SKIP_PAYLOAD_BYTES_ACTIONS.has(safeAction)
      ? -1
      : estimatePayloadBytes(safePayload),
  };
  switch (safeAction) {
    case 'append_events': {
      const events = Array.isArray(safePayload.events) ? safePayload.events : [];
      summary.eventCount = events.length;
      summary.eventTypes = Array.from(new Set(events.map((row) => String(row?.eventType || '').trim()).filter(Boolean))).slice(0, 8);
      summary.dedupeKeyCount = events.filter((row) => String(row?.dedupeKey || '').trim()).length;
      summary.maxEventPayloadBytes = events.reduce((max, row) => {
        const bytes = estimatePayloadBytes(row?.payload && typeof row.payload === 'object' ? row.payload : {});
        return Math.max(max, bytes);
      }, 0);
      break;
    }
    case 'list_events_after':
      summary.afterSeq = Math.max(0, Number(safePayload.afterSeq || 0));
      summary.limit = Math.max(0, Number(safePayload.limit || 0));
      break;
    case 'get_event_consumer':
    case 'set_event_consumer':
      summary.consumerName = String(safePayload.consumerName || '').trim();
      if (String(action || '').trim() === 'set_event_consumer') {
        summary.lastSeq = Math.max(0, Number(safePayload.lastSeq || 0));
      }
      break;
    case 'apply_sync_projection_batch': {
      const syncState = safePayload.syncState && typeof safePayload.syncState === 'object' ? safePayload.syncState : null;
      const commands = Array.isArray(safePayload.commands) ? safePayload.commands : [];
      summary.hasSyncState = Boolean(syncState);
      summary.commandCount = commands.length;
      summary.syncStateBytes = -1;
      summary.chainSourceCount = Array.isArray(syncState?.chainSources) ? syncState.chainSources.length : 0;
      summary.sourceStatsKeys = syncState?.sourceStats && typeof syncState.sourceStats === 'object'
        ? Object.keys(syncState.sourceStats).length
        : 0;
      summary.p2pHeightHashCacheKeys = syncState?.p2pHeightHashCache && typeof syncState.p2pHeightHashCache === 'object'
        ? Object.keys(syncState.p2pHeightHashCache).length
        : 0;
      summary.p2pNodeStatsKeys = syncState?.p2pNodeStats && typeof syncState.p2pNodeStats === 'object'
        ? Object.keys(syncState.p2pNodeStats).length
        : 0;
      break;
    }
    case 'upsert_sync_state':
      summary.scope = String(safePayload.scope || 'main').trim() || 'main';
      summary.localHeight = Math.max(0, Number(safePayload.localHeight || 0));
      summary.fixedSyncLastHeight = Math.max(0, Number(safePayload.fixedSyncLastHeight || 0));
      summary.chainSourceCount = Array.isArray(safePayload.chainSources) ? safePayload.chainSources.length : 0;
      summary.sourceStatsKeys = safePayload.sourceStats && typeof safePayload.sourceStats === 'object'
        ? Object.keys(safePayload.sourceStats).length
        : 0;
      summary.p2pHeightHashCacheKeys = safePayload.p2pHeightHashCache && typeof safePayload.p2pHeightHashCache === 'object'
        ? Object.keys(safePayload.p2pHeightHashCache).length
        : 0;
      summary.p2pNodeStatsKeys = safePayload.p2pNodeStats && typeof safePayload.p2pNodeStats === 'object'
        ? Object.keys(safePayload.p2pNodeStats).length
        : 0;
      break;
    case 'write_sync_node_stats_snapshot':
    case 'write_p2p_sync_receipts_snapshot':
      summary.file = String(safePayload.file || '').trim();
      summary.serializedBytes = Buffer.byteLength(String(safePayload.serialized || ''), 'utf8');
      if (safeAction === 'write_p2p_sync_receipts_snapshot') {
        try {
          const parsed = JSON.parse(String(safePayload.serialized || '{}'));
          summary.committedHeight = Math.max(0, Number(parsed?.committedHeight || 0));
          summary.entryCount = parsed?.entries && typeof parsed.entries === 'object'
            ? Object.keys(parsed.entries).length
            : 0;
        } catch (_) {}
      }
      break;
    default:
      break;
  }
  return summary;
}

function getTraceLogFile() {
  return path.join(getLogDir(), 'market_db_trace.log');
}

function appendDbTrace(event, payload = {}) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      source: 'market_db',
      pid: process.pid,
      event,
      ...payload,
    });
    fs.appendFileSync(getTraceLogFile(), `${line}\n`);
  } catch (_) {}
}

function writerUnavailableError(message = 'market_db writer unavailable') {
  const error = new Error(message);
  error.code = 'WRITER_UNAVAILABLE';
  return error;
}

function usingParentProxy() {
  return process.env.BSV_MARKET_DB_PARENT_PROXY === '1' && typeof process.send === 'function';
}

function nextRequestId() {
  return `market-db-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function getDataDir() {
  return path.resolve(process.env.BSV_MARKET_DATA_DIR || path.join(__dirname, 'data'));
}

function getLogDir() {
  return path.resolve(process.env.BSV_MARKET_LOG_DIR || path.join(__dirname, 'log'));
}

function getDbDir() {
  return path.resolve(process.env.BSV_MARKET_DB_DIR || getDataDir());
}

function clearPendingRequests(error) {
  for (const entry of pendingRequests.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pendingRequests.clear();
}

function scheduleWriterRestart(reason = 'writer_restart') {
  if (manualStop || writerProcess) return;
  clearRestartTimer();
  restartTimer = setTimeout(() => {
    restartTimer = null;
    writerReadyPromise = null;
    void ensureWriterService().catch(() => {});
  }, RESTART_DELAY_MS);
  restartTimer.unref?.();
}

function restartWriterAfterTimeout(action, requestId, payloadSummary = {}) {
  if (usingParentProxy()) return;
  const child = writerProcess;
  if (!child) return;
  appendDbTrace('writer_restart_after_request_timeout', {
    requestId,
    action,
    writerPid: Number(child.pid || 0) || null,
    pendingCount: pendingRequests.size,
    ...payloadSummary,
  });
  writerProcess = null;
  writerReadyPromise = null;
  clearPendingRequests(writerUnavailableError(`market_db writer restarted after timeout: ${action}`));
  try {
    child.kill('SIGKILL');
  } catch (_) {
    try {
      child.kill('SIGTERM');
    } catch (_) {}
  }
  scheduleWriterRestart('request_timeout');
}

function clearParentProxyRequests(error) {
  for (const entry of parentProxyRequests.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  parentProxyRequests.clear();
}

function attachParentProxyListener() {
  if (parentProxyListenerAttached || !usingParentProxy()) return;
  parentProxyListenerAttached = true;
  process.on('message', (message) => {
    if (String(message?.type || '') !== 'market_db_proxy_response') return;
    const requestId = String(message?.requestId || '');
    const pending = parentProxyRequests.get(requestId);
    if (!pending) return;
    parentProxyRequests.delete(requestId);
    clearTimeout(pending.timer);
    if (message?.ok) {
      pending.resolve(message.data);
      return;
    }
    const error = new Error(String(message?.error || 'market_db parent proxy failed'));
    error.code = String(message?.code || 'PARENT_PROXY_FAILED');
    pending.reject(error);
  });
  process.on('disconnect', () => {
    clearParentProxyRequests(writerUnavailableError('market_db parent proxy disconnected'));
  });
}

function getRuntimeDiagnostics() {
  return {
    usingParentProxy: usingParentProxy(),
    pendingWriterRequests: pendingRequests.size,
    pendingParentProxyRequests: parentProxyRequests.size,
    writerPid: Number(writerProcess?.pid || 0) || null,
    writerConnected: Boolean(writerProcess && writerProcess.connected !== false),
    writerReady: Boolean(writerProcess && writerReadyPromise),
  };
}

function clearRestartTimer() {
  if (!restartTimer) return;
  clearTimeout(restartTimer);
  restartTimer = null;
}

function handleWriterMessage(message) {
  const type = String(message?.type || '');
  if (type === 'writer_online') return;
  if (type !== 'writer_response') return;
  const responseHandledAtMs = Date.now();
  const requestId = String(message.requestId || '');
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  pendingRequests.delete(requestId);
  clearTimeout(pending.timer);
  const totalElapsedMs = responseHandledAtMs - pending.startedAtMs;
  const writerReceiveLagMs = Number.isFinite(message.receivedAtMs) && Number.isFinite(message.sentAtMs)
    ? Math.max(0, message.receivedAtMs - message.sentAtMs)
    : null;
  const writerQueueElapsedMs = Number.isFinite(message.startedAtMs) && Number.isFinite(message.receivedAtMs)
    ? Math.max(0, message.startedAtMs - message.receivedAtMs)
    : null;
  const writerExecElapsedMs = Number.isFinite(message.finishedAtMs) && Number.isFinite(message.startedAtMs)
    ? Math.max(0, message.finishedAtMs - message.startedAtMs)
    : null;
  const responseDeliveryLagMs = Number.isFinite(message.finishedAtMs)
    ? Math.max(0, responseHandledAtMs - message.finishedAtMs)
    : null;
  if (message.ok) {
    pending.resolve(message.data);
  } else {
    const error = new Error(String(message.error || 'Writer request failed'));
    error.code = String(message.code || 'WRITER_REQUEST_FAILED');
    pending.reject(error);
  }
  if (
    totalElapsedMs >= DB_TRACE_SLOW_MS ||
    (writerReceiveLagMs !== null && writerReceiveLagMs >= DB_TRACE_SLOW_MS) ||
    (writerExecElapsedMs !== null && writerExecElapsedMs >= DB_TRACE_SLOW_MS) ||
    (writerQueueElapsedMs !== null && writerQueueElapsedMs >= DB_TRACE_SLOW_MS) ||
    (responseDeliveryLagMs !== null && responseDeliveryLagMs >= DB_TRACE_SLOW_MS) ||
    !message.ok
  ) {
    setImmediate(() => {
      appendDbTrace('request_response', {
        requestId,
        action: pending.action,
        ok: !!message.ok,
        code: String(message.code || ''),
        totalElapsedMs,
        writerReceiveLagMs,
        writerQueueElapsedMs,
        writerExecElapsedMs,
        responseDeliveryLagMs,
        pendingCount: pendingRequests.size,
        ...(pending.payloadSummary || {}),
        error: message.ok ? '' : String(message.error || ''),
      });
    });
  }
}

function attachWriterLifecycle(child, readyResolve, readyReject) {
  let settled = false;
  child.on('message', (message) => {
    if (String(message?.type || '') === 'writer_online') {
      if (!settled) {
        settled = true;
        readyResolve(message.data || {});
      }
      return;
    }
    handleWriterMessage(message);
  });
  child.once('error', (error) => {
    if (!settled) {
      settled = true;
      readyReject(error);
    }
  });
  child.once('exit', (code, signal) => {
    if (writerProcess === child) writerProcess = null;
    if (!settled) {
      settled = true;
      readyReject(writerUnavailableError(`market_db writer exited before ready (${signal || code || 'unknown'})`));
    }
    clearPendingRequests(writerUnavailableError('market_db writer exited'));
    if (manualStop) return;
    clearRestartTimer();
    restartTimer = setTimeout(() => {
      restartTimer = null;
      writerReadyPromise = null;
      void ensureWriterService().catch(() => {});
    }, RESTART_DELAY_MS);
    restartTimer.unref?.();
  });
}

function launchWriterProcess() {
  manualStop = false;
  clearRestartTimer();
  const child = fork(WRITER_ENTRY, {
    cwd: __dirname,
    env: process.env,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  });
  writerProcess = child;
  writerReadyPromise = new Promise((resolve, reject) => {
    attachWriterLifecycle(child, resolve, reject);
  });
  return writerReadyPromise;
}

function ensureWriterService() {
  if (usingParentProxy()) {
    return Promise.resolve({ proxy: 'parent' });
  }
  if (writerProcess && writerReadyPromise) return writerReadyPromise;
  return launchWriterProcess();
}

async function stopWriterService() {
  manualStop = true;
  clearRestartTimer();
  const child = writerProcess;
  writerProcess = null;
  writerReadyPromise = null;
  if (!child) return;
  const exitPromise = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once('exit', finish);
    setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (_) {}
      finish();
    }, 1500);
  });
  try {
    await sendRequest('terminate', {}, { timeoutMs: 1000, ensureReady: false, processOverride: child });
  } catch (_) {
    try {
      child.kill('SIGTERM');
    } catch (_) {}
  }
  await exitPromise;
}

async function sendRequest(action, payload = {}, options = {}) {
  const timeoutMs = Math.max(100, Number(options.timeoutMs || DEFAULT_REQUEST_TIMEOUT_MS));
  if (usingParentProxy() && !options.processOverride) {
    attachParentProxyListener();
    const requestId = nextRequestId();
    const startedAtMs = Date.now();
    return new Promise((resolve, reject) => {
      const payloadSummary = summarizePayloadForTrace(action, payload);
      const timer = setTimeout(() => {
        parentProxyRequests.delete(requestId);
        appendDbTrace('request_timeout', {
          requestId,
          action,
          timeoutMs,
          elapsedMs: Date.now() - startedAtMs,
          pendingCount: parentProxyRequests.size,
          proxyMode: 'parent',
          ...payloadSummary,
        });
        if (SOFTEN_PARENT_PROXY_TIMEOUTS && PARENT_PROXY_BEST_EFFORT_ACTIONS.has(String(action || '').trim())) {
          appendDbTrace('request_timeout_softened', {
            requestId,
            action,
            timeoutMs,
            elapsedMs: Date.now() - startedAtMs,
            pendingCount: parentProxyRequests.size,
            proxyMode: 'parent',
            ...payloadSummary,
          });
          resolve(null);
          return;
        }
        const error = new Error(`market_db parent proxy timed out: ${action}`);
        error.code = 'PARENT_PROXY_TIMEOUT';
        reject(error);
      }, timeoutMs);
      timer.unref?.();
      parentProxyRequests.set(requestId, { resolve, reject, timer, action, startedAtMs, payloadSummary });
      if (
        action === 'append_events'
        || action === 'list_events_after'
        || action === 'apply_sync_projection_batch'
      ) {
        appendDbTrace('request_sent', {
          requestId,
          action,
          pendingCount: parentProxyRequests.size,
          proxyMode: 'parent',
          ...payloadSummary,
        });
      }
      try {
        process.send({
          type: 'market_db_proxy_request',
          requestId,
          action,
          payload,
          timeoutMs,
          sentAtMs: startedAtMs,
        });
      } catch (error) {
        parentProxyRequests.delete(requestId);
        clearTimeout(timer);
        appendDbTrace('request_send_failed', {
          requestId,
          action,
          elapsedMs: Date.now() - startedAtMs,
          proxyMode: 'parent',
          ...payloadSummary,
          error: String(error?.message || error || 'unknown send failure'),
        });
        reject(error);
      }
    });
  }
  if (!options.processOverride && options.ensureReady !== false) {
    await ensureWriterService();
  }
  const child = options.processOverride || writerProcess;
  if (!child || child.connected !== true) throw writerUnavailableError();
  const requestId = nextRequestId();
  const startedAtMs = Date.now();
  return new Promise((resolve, reject) => {
    const payloadSummary = summarizePayloadForTrace(action, payload);
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      appendDbTrace('request_timeout', {
        requestId,
        action,
        timeoutMs,
        elapsedMs: Date.now() - startedAtMs,
        pendingCount: pendingRequests.size,
        ...payloadSummary,
      });
      if (!options.processOverride) {
        restartWriterAfterTimeout(action, requestId, payloadSummary);
      }
      if (PARENT_PROXY_BEST_EFFORT_ACTIONS.has(String(action || '').trim())) {
        appendDbTrace('request_timeout_softened', {
          requestId,
          action,
          timeoutMs,
          elapsedMs: Date.now() - startedAtMs,
          pendingCount: pendingRequests.size,
          ...payloadSummary,
        });
        resolve(null);
        return;
      }
      const error = new Error(`market_db request timed out: ${action}`);
      error.code = 'WRITER_TIMEOUT';
      reject(error);
    }, timeoutMs);
    timer.unref?.();
    pendingRequests.set(requestId, { resolve, reject, timer, action, startedAtMs, payloadSummary });
    if (
      action === 'append_events'
      || action === 'list_events_after'
      || action === 'apply_sync_projection_batch'
    ) {
      appendDbTrace('request_sent', {
        requestId,
        action,
        pendingCount: pendingRequests.size,
        ...payloadSummary,
      });
    }
    try {
      child.send({
        requestId,
        action,
        payload,
        timeoutMs,
        sentAtMs: startedAtMs,
      });
    } catch (error) {
      pendingRequests.delete(requestId);
      clearTimeout(timer);
      appendDbTrace('request_send_failed', {
        requestId,
        action,
        elapsedMs: Date.now() - startedAtMs,
        ...payloadSummary,
        error: String(error?.message || error || 'unknown send failure'),
      });
      reject(error);
    }
  });
}

async function initSchema() {
  return sendRequest('init_schema');
}

async function healthCheck() {
  return sendRequest('health_check');
}

async function upsertSyncState(payload) {
  return sendRequest('upsert_sync_state', payload);
}

async function getSyncState(scope = 'main') {
  return sendRequest('get_sync_state', { scope });
}

async function replaceCatalogSnapshot(payload) {
  return sendRequest('replace_catalog_snapshot', payload, { timeoutMs: 15000 });
}

async function getCatalogSnapshot() {
  return sendRequest('get_catalog_snapshot');
}

async function replaceProfileSnapshot(payload) {
  return sendRequest('replace_profile_snapshot', payload);
}

async function getProfileSnapshot(profileKey = 'self') {
  return sendRequest('get_profile_snapshot', { profileKey });
}

async function writeStateJsonSnapshot(payload) {
  return sendRequest('write_state_json_snapshot', payload, { timeoutMs: 15000 });
}

async function writeSyncNodeStatsSnapshot(payload) {
  return sendRequest('write_sync_node_stats_snapshot', payload, { timeoutMs: 15000 });
}

async function writeTextFileSnapshot(payload) {
  return sendRequest('write_text_file_snapshot', payload, { timeoutMs: 15000 });
}

async function writeP2PSyncReceiptsSnapshot(payload) {
  return sendRequest('write_p2p_sync_receipts_snapshot', payload, { timeoutMs: 15000 });
}

async function writeChainSpoolStateSnapshot(payload) {
  return sendRequest('write_chain_spool_state_snapshot', payload, { timeoutMs: 15000 });
}

async function appendChainSpoolRecords(payload) {
  return sendRequest('append_chain_spool_records', payload, { timeoutMs: 15000 });
}

async function appendEvents(events) {
  return sendRequest('append_events', { events }, { timeoutMs: 15000 });
}

async function listEventsAfter(afterSeq = 0, limit = 100) {
  return sendRequest('list_events_after', { afterSeq, limit }, { timeoutMs: 15000 });
}

async function getEventConsumer(consumerName) {
  return sendRequest('get_event_consumer', { consumerName });
}

async function setEventConsumer(consumerName, lastSeq, updatedAt = '') {
  return sendRequest('set_event_consumer', { consumerName, lastSeq, updatedAt });
}

async function enqueueDurableMessage(payload) {
  return sendRequest('enqueue_durable_message', payload, { timeoutMs: 15000 });
}

async function claimNextDurableMessage(payload) {
  return sendRequest('claim_next_durable_message', payload, { timeoutMs: 60000 });
}

async function finishDurableMessage(payload) {
  return sendRequest('finish_durable_message', payload, { timeoutMs: 60000 });
}

async function releaseDurableMessage(payload) {
  return sendRequest('release_durable_message', payload, { timeoutMs: 15000 });
}

async function listDurableMessages(payload) {
  return sendRequest('list_durable_messages', payload, { timeoutMs: 15000 });
}

async function applyChatProjectionBatch(payload) {
  return sendRequest('apply_chat_projection_batch', payload, { timeoutMs: 15000 });
}

async function applySyncProjectionBatch(payload) {
  return sendRequest('apply_sync_projection_batch', payload, { timeoutMs: 15000 });
}

async function applyWalletTxProjectionBatch(payload) {
  return sendRequest('apply_wallet_tx_projection_batch', payload, { timeoutMs: 15000 });
}

async function applyWalletReadProjectionBatch(payload) {
  return sendRequest('apply_wallet_read_projection_batch', payload, { timeoutMs: 15000 });
}

async function applyBhsProjectionBatch(payload) {
  return sendRequest('apply_bhs_projection_batch', payload, { timeoutMs: 15000 });
}

async function applyOrderProjectionBatch(payload) {
  return sendRequest('apply_order_projection_batch', payload, { timeoutMs: 15000 });
}

async function applyLocalStateProjectionBatch(payload) {
  return sendRequest('apply_local_state_projection_batch', payload, { timeoutMs: 15000 });
}

async function listChatPresenceProjection(selfWalletId) {
  return sendRequest('list_chat_presence_projection', { selfWalletId });
}

async function listChatThreadStatusProjection(selfWalletId) {
  return sendRequest('list_chat_thread_status_projection', { selfWalletId });
}

async function listChatMessageIndexProjection(selfWalletId, peerWalletId) {
  const pageSize = arguments.length > 2 ? arguments[2] : 10;
  const page = arguments.length > 3 ? arguments[3] : 1;
  return sendRequest('list_chat_message_index_projection', { selfWalletId, peerWalletId, pageSize, page });
}

async function listChatContactProjection(selfWalletId) {
  return sendRequest('list_chat_contact_projection', { selfWalletId });
}

async function getChatSelfStateProjection(selfWalletId) {
  return sendRequest('get_chat_self_state_projection', { selfWalletId });
}

async function listWalletTxReservationProjection() {
  return sendRequest('list_wallet_tx_reservation_projection', {});
}

async function listWalletOutpointReservationProjection(onlyActive = true) {
  return sendRequest('list_wallet_outpoint_reservation_projection', { onlyActive });
}

async function getWalletIndexStatusProjection(walletKey) {
  return sendRequest('get_wallet_index_status_projection', { walletKey });
}

async function getWalletReadModelProjection(walletKey) {
  return sendRequest('get_wallet_read_model_projection', { walletKey });
}

async function listWalletHistoryProjection(walletKey) {
  return sendRequest('list_wallet_history_projection', { walletKey });
}

async function getBhsStatusProjection(scope = 'main') {
  return sendRequest('get_bhs_status_projection', { scope });
}

async function listOrderProjection() {
  return sendRequest('list_order_projection', {});
}

async function getLocalStateProjection(scope = 'main') {
  return sendRequest('get_local_state_projection', { scope });
}

async function upsertTxContext(payload) {
  return sendRequest('upsert_tx_context', payload);
}

async function getTxContext(txid) {
  return sendRequest('get_tx_context', { txid });
}

async function deleteTxContext(txid) {
  return sendRequest('delete_tx_context', { txid });
}

async function clearTxContexts() {
  return sendRequest('clear_tx_contexts');
}

async function upsertAnchorEvents(events) {
  return sendRequest('upsert_anchor_events', { events }, { timeoutMs: 15000 });
}

async function markAnchorEventsConfirmed(txids) {
  return sendRequest('mark_anchor_events_confirmed', { txids });
}

async function clearAnchorEvents() {
  return sendRequest('clear_anchor_events');
}

async function clearOrderData() {
  return sendRequest('clear_order_data', {}, { timeoutMs: 15000 });
}

function listCategoriesFromReadDb() {
  const db = openReadDb();
  try {
    return db.prepare(`
      SELECT
        category_id,
        merchant_id,
        name,
        version,
        status,
        owned_by_current_wallet,
        local_status,
        updated_at
      FROM categories
      ORDER BY category_id ASC
    `).all();
  } finally {
    db.close();
  }
}

function listProductsFromReadDb() {
  const db = openReadDb();
  try {
    return db.prepare(`
      SELECT
        product_id,
        merchant_id,
        category_id,
        title,
        description,
        image_url,
        price,
        stock,
        sold_count,
        version,
        status,
        owned_by_current_wallet,
        local_status,
        updated_at
      FROM products
      ORDER BY product_id ASC
    `).all();
  } finally {
    db.close();
  }
}

function openReadDb() {
  return readDbPool.openReadDb();
}

function listAnchorEventsFromReadDb(options = {}) {
  const db = openReadDb();
  try {
    const where = [];
    const params = [];
    if (Array.isArray(options.eventTypes) && options.eventTypes.length > 0) {
      where.push(`event_type IN (${options.eventTypes.map(() => '?').join(', ')})`);
      params.push(...options.eventTypes.map((item) => String(item || '').trim()));
    }
    if (options.walletId) {
      where.push('wallet_id = ?');
      params.push(String(options.walletId).trim());
    }
    if (options.merchantId) {
      where.push('merchant_id = ?');
      params.push(String(options.merchantId).trim());
    }
    if (options.txid) {
      where.push('txid = ?');
      params.push(String(options.txid).trim().toLowerCase());
    }
    if (options.confirmed === true) where.push('confirmed = 1');
    if (options.confirmed === false) where.push('confirmed = 0');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const orderSql = options.desc === true
      ? 'ORDER BY ts DESC, event_id DESC'
      : 'ORDER BY ts ASC, event_id ASC';
    const limitSql = Number.isFinite(Number(options.limit)) && Number(options.limit) > 0
      ? `LIMIT ${Math.max(1, Number(options.limit))}`
      : '';
    const rows = db.prepare(`
      SELECT
        event_id,
        txid,
        block_height,
        block_hash,
        event_index,
        event_type,
        merchant_id,
        entity_id,
        wallet_id,
        ts,
        confirmed,
        source_node,
        payload_json,
        payload_hash,
        dedupe_key,
        inserted_at
      FROM anchor_events
      ${whereSql}
      ${orderSql}
      ${limitSql}
    `).all(...params);
    return rows.map((row) => {
      let payload = {};
      try {
        payload = JSON.parse(String(row.payload_json || '{}'));
      } catch (_) {}
      return {
        eventId: Number(row.event_id || 0),
        txid: String(row.txid || ''),
        height: Number(row.block_height || 0),
        blockHash: String(row.block_hash || ''),
        eventIndex: Number(row.event_index || 0),
        eventType: String(row.event_type || ''),
        merchantId: String(row.merchant_id || ''),
        entityId: String(row.entity_id || ''),
        walletId: String(row.wallet_id || ''),
        ts: String(row.ts || ''),
        confirmed: Number(row.confirmed || 0) === 1,
        node: String(row.source_node || ''),
        payload,
        payloadHash: String(row.payload_hash || ''),
        dedupeKey: String(row.dedupe_key || ''),
        insertedAt: String(row.inserted_at || ''),
      };
    });
  } finally {
    db.close();
  }
}

function getDbFilePath() {
  return path.join(getDbDir(), 'market.db');
}

module.exports = {
  getDataDir,
  getLogDir,
  getDbDir,
  ensureWriterService,
  stopWriterService,
  sendRequest,
  initSchema,
  healthCheck,
  upsertSyncState,
  getSyncState,
  replaceCatalogSnapshot,
  getCatalogSnapshot,
  replaceProfileSnapshot,
  getProfileSnapshot,
  writeStateJsonSnapshot,
  writeSyncNodeStatsSnapshot,
  writeTextFileSnapshot,
  writeP2PSyncReceiptsSnapshot,
  writeChainSpoolStateSnapshot,
  appendChainSpoolRecords,
  appendEvents,
  listEventsAfter,
  getEventConsumer,
  setEventConsumer,
  enqueueDurableMessage,
  claimNextDurableMessage,
  finishDurableMessage,
  releaseDurableMessage,
  listDurableMessages,
  applyChatProjectionBatch,
  applySyncProjectionBatch,
  applyWalletTxProjectionBatch,
  applyWalletReadProjectionBatch,
  applyBhsProjectionBatch,
  getRuntimeDiagnostics,
  applyOrderProjectionBatch,
  applyLocalStateProjectionBatch,
  listChatPresenceProjection,
  listChatThreadStatusProjection,
  listChatMessageIndexProjection,
  listChatContactProjection,
  getChatSelfStateProjection,
  listWalletTxReservationProjection,
  listWalletOutpointReservationProjection,
  getWalletIndexStatusProjection,
  getWalletReadModelProjection,
  listWalletHistoryProjection,
  getBhsStatusProjection,
  listOrderProjection,
  getLocalStateProjection,
  upsertTxContext,
  getTxContext,
  deleteTxContext,
  clearTxContexts,
  upsertAnchorEvents,
  markAnchorEventsConfirmed,
  clearAnchorEvents,
  clearOrderData,
  listCategoriesFromReadDb,
  listProductsFromReadDb,
  listAnchorEventsFromReadDb,
  openReadDb,
  withReadDb: readDbPool.withReadDb,
  getReadDbPoolStats: readDbPool.getPoolStats,
  getDbFilePath,
};
