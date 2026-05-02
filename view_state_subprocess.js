const fs = require('fs');
const path = require('path');
process.env.BSV_MARKET_PROCESS_ROLE = 'view_state_worker';
const serverMarket = require('./server_market');
const { createViewAuthRuntime } = require('./view_auth_runtime');

const DATA_DIR = path.join(__dirname, 'data');
const LOG_DIR = path.join(__dirname, 'log');
const HEARTBEAT_FILE = path.join(DATA_DIR, 'view_state_worker.json');
const LOG_FILE = path.join(LOG_DIR, 'view_state_worker.log');

let rebuildTimer = null;
let inFlight = false;
let pendingReason = 'startup';
let lastUpdatedAt = null;
const viewAuthRuntime = createViewAuthRuntime();

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(event, payload = {}) {
  try {
    ensureDirs();
    fs.appendFileSync(LOG_FILE, `${JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      event,
      ...payload,
    })}\n`);
  } catch (_) {}
}

function heartbeat(extra = {}) {
  try {
    ensureDirs();
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify({
      ts: new Date().toISOString(),
      pid: process.pid,
      inFlight,
      pendingReason,
      lastUpdatedAt,
      ...extra,
    }, null, 2));
  } catch (_) {}
}

function emitUpdated(envelope) {
  if (!process.send || !process.connected) return;
  try {
    process.send({
      type: 'publicStateCacheUpdated',
      envelope,
    }, (err) => {
      if (!err) return;
      const code = String(err?.code || '');
      if (code === 'EPIPE' || code === 'ERR_IPC_CHANNEL_CLOSED') return;
      log('emit_updated_failed', {
        message: String(err?.message || 'emit_updated_failed'),
        code,
      });
    });
  } catch (_) {}
}

async function rebuildNow(reason = pendingReason) {
  if (inFlight) {
    scheduleRebuild(`coalesced:${reason}`, 250);
    return;
  }
  inFlight = true;
  heartbeat({ phase: 'rebuild_start', reason });
  const startedAt = Date.now();
  try {
    const envelope = await serverMarket.rebuildPublicStateCache({
      source: reason,
      req: viewAuthRuntime.getRuntimeReq(),
    });
    lastUpdatedAt = String(envelope?.updatedAt || new Date().toISOString());
    emitUpdated(envelope);
    log('rebuild_done', {
      reason,
      elapsedMs: Date.now() - startedAt,
      updatedAt: lastUpdatedAt,
    });
    heartbeat({ phase: 'rebuild_done', reason, elapsedMs: Date.now() - startedAt });
  } catch (err) {
    log('rebuild_failed', {
      reason,
      elapsedMs: Date.now() - startedAt,
      message: String(err?.message || 'rebuild_failed'),
    });
    heartbeat({
      phase: 'rebuild_failed',
      reason,
      elapsedMs: Date.now() - startedAt,
      message: String(err?.message || 'rebuild_failed'),
    });
  } finally {
    inFlight = false;
  }
}

function scheduleRebuild(reason = 'runtime', delayMs = 120) {
  pendingReason = String(reason || 'runtime');
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuildNow(pendingReason).catch(() => {});
  }, Math.max(0, Number(delayMs || 0)));
  heartbeat({
    phase: 'rebuild_scheduled',
    reason: pendingReason,
    delayMs: Math.max(0, Number(delayMs || 0)),
  });
}

process.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'auth.snapshot' || msg.type === 'auth.logged_in' || msg.type === 'auth.logged_out') {
    viewAuthRuntime.applySnapshot(msg.snapshot || {}, {
      source: String(msg?.source || msg.type || 'auth_snapshot'),
    });
    return;
  }
  if (msg.type === 'rebuild') {
    scheduleRebuild(String(msg.reason || 'runtime'));
    return;
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
process.on('error', (err) => {
  const code = String(err?.code || '');
  if (code === 'EPIPE' || code === 'ERR_IPC_CHANNEL_CLOSED') return;
  log('process_error', {
    message: String(err?.message || 'process_error'),
    code,
  });
});
process.on('disconnect', () => {
  heartbeat({ phase: 'parent_disconnected' });
  process.exit(0);
});

ensureDirs();
if (typeof process.send === 'function') {
  try {
    process.send({ type: 'auth.query', source: 'view_state_startup' });
  } catch (_) {}
}
try {
  const envelope = serverMarket.loadPublicStateCache();
  if (envelope?.updatedAt) lastUpdatedAt = String(envelope.updatedAt || '');
} catch (_) {}
log('worker_started', {});
heartbeat({ phase: 'started' });
scheduleRebuild('startup', 10);
