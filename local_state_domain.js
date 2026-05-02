const marketDb = require('./market_db');
const messageQueue = require('./lib/message_queue');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LOCAL_STATE_CONSUMER = 'local_state_projection_writer_v1';
const LOCAL_STATE_SCOPE = 'main';
let runtimeLocalState = new Map();
const localStatePersistControl = {
  nextSeq: 0,
  pending: null,
  active: false,
  waiters: [],
  lastPersistedHash: '',
};

function appendLocalStateTrace(event, payload = {}) {
  try {
    const file = path.join(marketDb.getLogDir(), 'market_db_trace.log');
    fs.appendFileSync(file, `${JSON.stringify({
      ts: new Date().toISOString(),
      source: 'local_state_domain',
      pid: process.pid,
      event,
      ...payload,
    })}\n`);
  } catch (_) {}
}

function nowIso() {
  return new Date().toISOString();
}

function hashLocalStateSnapshot(snapshot = {}) {
  try {
    const normalized = normalizeSnapshot(snapshot);
    const stable = {
      ...normalized,
      updatedAt: '',
    };
    return crypto.createHash('sha1').update(JSON.stringify(stable)).digest('hex');
  } catch (_) {
    return '';
  }
}

function queueCoalescedLatestValue(control, payload, writer) {
  if (!control || typeof control !== 'object' || typeof writer !== 'function') {
    return Promise.reject(new Error('invalid latest-value control'));
  }
  const seq = Math.max(1, Number(control.nextSeq || 0) + 1);
  control.nextSeq = seq;
  control.pending = { seq, payload };
  const promise = new Promise((resolve, reject) => {
    control.waiters.push({ seq, resolve, reject });
  });
  if (control.active) return promise;
  control.active = true;
  void (async () => {
    while (control.pending) {
      const current = control.pending;
      control.pending = null;
      try {
        await new Promise((resolve) => setImmediate(resolve));
        const result = await writer(current.payload);
        const waiters = Array.isArray(control.waiters) ? control.waiters.splice(0, control.waiters.length) : [];
        const deferred = [];
        waiters.forEach((entry) => {
          if (Number(entry?.seq || 0) <= current.seq) entry.resolve(result);
          else deferred.push(entry);
        });
        control.waiters = deferred;
      } catch (error) {
        const waiters = Array.isArray(control.waiters) ? control.waiters.splice(0, control.waiters.length) : [];
        const deferred = [];
        waiters.forEach((entry) => {
          if (Number(entry?.seq || 0) <= current.seq) entry.reject(error);
          else deferred.push(entry);
        });
        control.waiters = deferred;
      }
    }
    control.active = false;
  })();
  return promise;
}

function normalizeLocalChange(row = {}) {
  return {
    id: String(row.id || '').trim(),
    seq: Math.max(0, Number(row.seq || 0)),
    eventType: String(row.eventType || '').trim(),
    payload: row.payload && typeof row.payload === 'object' ? { ...row.payload } : {},
    targetType: String(row.targetType || '').trim(),
    targetId: String(row.targetId || '').trim(),
    status: String(row.status || 'pending').trim(),
    txid: String(row.txid || '').trim(),
    ts: String(row.ts || '').trim(),
    updatedAt: String(row.updatedAt || row.ts || nowIso()).trim(),
  };
}

function normalizeRecentRawtx(row = {}) {
  return {
    txid: String(row.txid || '').trim().toLowerCase(),
    ts: String(row.ts || '').trim(),
    eventType: String(row.eventType || '').trim(),
    note: String(row.note || '').trim(),
    rawtx: String(row.rawtx || '').trim(),
    updatedAt: String(row.updatedAt || row.ts || nowIso()).trim(),
  };
}

function normalizePendingAnchor(row = {}) {
  const payload = row.payload && typeof row.payload === 'object' ? { ...row.payload } : {};
  return {
    anchorKey: String(row.anchorKey || '').trim(),
    ts: String(row.ts || '').trim(),
    txid: String(row.txid || '').trim().toLowerCase(),
    eventType: String(row.eventType || '').trim(),
    payload,
    node: String(row.node || '').trim(),
    confirmed: row.confirmed === true,
    height: Math.max(0, Number(row.height || 0)),
    updatedAt: String(row.updatedAt || row.ts || nowIso()).trim(),
  };
}

function normalizeSnapshot(snapshot = {}) {
  return {
    scope: String(snapshot.scope || LOCAL_STATE_SCOPE).trim() || LOCAL_STATE_SCOPE,
    seq: Math.max(1, Number(snapshot.seq || 1)),
    localChanges: (Array.isArray(snapshot.localChanges) ? snapshot.localChanges : [])
      .map((row) => normalizeLocalChange(row))
      .filter((row) => row.id),
    recentRawtxs: (Array.isArray(snapshot.recentRawtxs) ? snapshot.recentRawtxs : [])
      .map((row) => normalizeRecentRawtx(row))
      .filter((row) => row.txid),
    pendingAnchors: (Array.isArray(snapshot.pendingAnchors) ? snapshot.pendingAnchors : [])
      .map((row) => normalizePendingAnchor(row))
      .filter((row) => row.anchorKey || row.txid),
    updatedAt: String(snapshot.updatedAt || nowIso()),
    lastEventSeq: Math.max(0, Number(snapshot.lastEventSeq || 0)),
  };
}

function cloneSnapshot(snapshot = {}) {
  return JSON.parse(JSON.stringify(normalizeSnapshot(snapshot)));
}

function buildAnchorKey(row = {}) {
  const txid = String(row.txid || '').trim().toLowerCase();
  const eventType = String(row.eventType || '').trim();
  const ts = String(row.ts || '').trim();
  if (txid && eventType && ts) return `${txid}:${eventType}:${ts}`;
  return '';
}

async function catchUpProjection(scope = LOCAL_STATE_SCOPE) {
  const safeScope = String(scope || LOCAL_STATE_SCOPE).trim() || LOCAL_STATE_SCOPE;
  appendLocalStateTrace('catchup_skipped_event_driven', {
    consumerName: LOCAL_STATE_CONSUMER,
    scope: safeScope,
    hasCache: runtimeLocalState.has(safeScope),
  });
  return { applied: 0, lastSeq: Math.max(0, Number(runtimeLocalState.get(safeScope)?.lastEventSeq || 0)) };
}

function applyLocalStateToRuntime(snapshot = {}) {
  const normalized = normalizeSnapshot(snapshot);
  runtimeLocalState.set(normalized.scope, cloneSnapshot(normalized));
  return cloneSnapshot(normalized);
}

async function applyLocalStateSnapshot(snapshot = {}, meta = {}) {
  const normalized = normalizeSnapshot({
    ...snapshot,
    pendingAnchors: (Array.isArray(snapshot.pendingAnchors) ? snapshot.pendingAnchors : []).map((row) => ({
      ...row,
      anchorKey: String(row?.anchorKey || buildAnchorKey(row)).trim(),
    })),
  });
  const payloadHash = String(meta.payloadHash || hashLocalStateSnapshot(normalized));
  const forcePersist = meta.forcePersist === true;
  const startedAt = Date.now();
  if (!forcePersist && payloadHash && payloadHash === localStatePersistControl.lastPersistedHash) {
    applyLocalStateToRuntime(normalized);
    appendLocalStateTrace('projection_skipped_unchanged', {
      consumerName: LOCAL_STATE_CONSUMER,
      scope: normalized.scope,
      localChangeCount: normalized.localChanges.length,
      recentRawtxCount: normalized.recentRawtxs.length,
      pendingAnchorCount: normalized.pendingAnchors.length,
      source: String(meta.source || 'local_state_domain'),
      seq: Math.max(0, Number(meta.seq || 0)),
    });
    return normalized;
  }
  await marketDb.applyLocalStateProjectionBatch(normalized);
  const finishedAt = Date.now();
  applyLocalStateToRuntime(normalized);
  if (payloadHash) localStatePersistControl.lastPersistedHash = payloadHash;
  appendLocalStateTrace('projection_applied', {
    consumerName: LOCAL_STATE_CONSUMER,
    scope: normalized.scope,
    localChangeCount: normalized.localChanges.length,
    recentRawtxCount: normalized.recentRawtxs.length,
    pendingAnchorCount: normalized.pendingAnchors.length,
    payloadBytes: Buffer.byteLength(JSON.stringify(normalized), 'utf8'),
    source: String(meta.source || 'local_state_domain'),
    seq: Math.max(0, Number(meta.seq || 0)),
    elapsedMs: finishedAt - startedAt,
  });
  return normalized;
}

async function ensureLocalStateRuntimeLoaded(scope = LOCAL_STATE_SCOPE, options = {}) {
  const safeScope = String(scope || LOCAL_STATE_SCOPE).trim() || LOCAL_STATE_SCOPE;
  if (runtimeLocalState.has(safeScope) && options.forceReload !== true) {
    return cloneSnapshot(runtimeLocalState.get(safeScope));
  }
  const snapshot = getLocalStateSync(safeScope, { forceProjection: true });
  runtimeLocalState.set(safeScope, cloneSnapshot(snapshot));
  appendLocalStateTrace('runtime_state_loaded', {
    consumerName: LOCAL_STATE_CONSUMER,
    scope: safeScope,
    localChangeCount: snapshot.localChanges.length,
    recentRawtxCount: snapshot.recentRawtxs.length,
    pendingAnchorCount: snapshot.pendingAnchors.length,
    forceReload: options.forceReload === true,
  });
  return cloneSnapshot(snapshot);
}

async function emitLocalStateSnapshot(snapshot = {}, meta = {}) {
  const normalized = normalizeSnapshot({
    ...snapshot,
    pendingAnchors: (Array.isArray(snapshot.pendingAnchors) ? snapshot.pendingAnchors : []).map((row) => ({
      ...row,
      anchorKey: String(row?.anchorKey || buildAnchorKey(row)).trim(),
    })),
  });
  await messageQueue.publish('local_state.updated', normalized, {
    mode: messageQueue.MODE_TRANSIENT,
    source: String(meta.producer || 'local_state_domain'),
  });
  const runtimeSnapshot = {
    ...normalized,
    lastEventSeq: 0,
    updatedAt: String(normalized.updatedAt || nowIso()),
  };
  applyLocalStateToRuntime(runtimeSnapshot);
  const payloadHash = hashLocalStateSnapshot(runtimeSnapshot);
  await queueCoalescedLatestValue(localStatePersistControl, {
    snapshot: runtimeSnapshot,
    meta: {
      source: String(meta.producer || 'local_state_domain'),
      seq: 0,
      payloadHash,
      forcePersist: meta.forcePersist === true,
    },
  }, (nextPayload) => applyLocalStateSnapshot(nextPayload.snapshot, nextPayload.meta));
  return normalized;
}

async function resetLocalState(scope = LOCAL_STATE_SCOPE) {
  const safeScope = String(scope || LOCAL_STATE_SCOPE).trim() || LOCAL_STATE_SCOPE;
  return emitLocalStateSnapshot({
    scope: safeScope,
    seq: 1,
    localChanges: [],
    recentRawtxs: [],
    pendingAnchors: [],
    updatedAt: nowIso(),
    lastEventSeq: 0,
  }, {
    producer: 'local_state_domain.reset',
    forcePersist: true,
  });
}

async function getLocalState(scope = LOCAL_STATE_SCOPE) {
  await catchUpProjection(scope);
  return marketDb.getLocalStateProjection(scope);
}

function getLocalStateSync(scope = LOCAL_STATE_SCOPE, options = {}) {
  const safeScope = String(scope || LOCAL_STATE_SCOPE).trim() || LOCAL_STATE_SCOPE;
  if (runtimeLocalState.has(safeScope) && options.forceProjection !== true) {
    return cloneSnapshot(runtimeLocalState.get(safeScope));
  }
  const db = marketDb.openReadDb();
  try {
    let meta = null;
    let localChanges = [];
    let recentRawtxs = [];
    let pendingAnchors = [];
    try {
      meta = db.prepare(`
      SELECT scope, seq, updated_at, last_event_seq
      FROM local_change_meta_projection
      WHERE scope = ?
      LIMIT 1
      `).get(safeScope);
      localChanges = db.prepare(`
      SELECT change_id, seq, event_type, payload_json, target_type, target_id,
        status, txid, ts, updated_at
      FROM local_change_projection
      ORDER BY seq ASC, change_id ASC
      `).all().map((row) => {
      let payloadJson = {};
      try { payloadJson = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
      return normalizeLocalChange({
        id: row.change_id,
        seq: row.seq,
        eventType: row.event_type,
        payload: payloadJson,
        targetType: row.target_type,
        targetId: row.target_id,
        status: row.status,
        txid: row.txid,
        ts: row.ts,
        updatedAt: row.updated_at,
      });
      });
      recentRawtxs = db.prepare(`
      SELECT txid, ts, event_type, note, rawtx, updated_at
      FROM recent_rawtx_projection
      ORDER BY ts ASC, txid ASC
      `).all().map((row) => normalizeRecentRawtx({
      txid: row.txid,
      ts: row.ts,
      eventType: row.event_type,
      note: row.note,
      rawtx: row.rawtx,
      updatedAt: row.updated_at,
      }));
      pendingAnchors = db.prepare(`
      SELECT anchor_key, ts, txid, event_type, payload_json, node, confirmed, height, updated_at
      FROM pending_anchor_projection
      ORDER BY ts ASC, txid ASC, anchor_key ASC
      `).all().map((row) => {
      let payloadJson = {};
      try { payloadJson = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
      return normalizePendingAnchor({
        anchorKey: row.anchor_key,
        ts: row.ts,
        txid: row.txid,
        eventType: row.event_type,
        payload: payloadJson,
        node: row.node,
        confirmed: Number(row.confirmed || 0) === 1,
        height: row.height,
        updatedAt: row.updated_at,
      });
      });
    } catch (_) {
      meta = null;
      localChanges = [];
      recentRawtxs = [];
      pendingAnchors = [];
    }
    const snapshot = {
      scope: safeScope,
      seq: Math.max(1, Number(meta?.seq || 1)),
      updatedAt: String(meta?.updated_at || ''),
      lastEventSeq: Math.max(0, Number(meta?.last_event_seq || 0)),
      localChanges,
      recentRawtxs,
      pendingAnchors,
    };
    if (options.forceProjection !== true) runtimeLocalState.set(safeScope, cloneSnapshot(snapshot));
    return cloneSnapshot(snapshot);
  } finally {
    db.close();
  }
}

async function rehydrateLocalStateRuntimeFromProjection(scope = LOCAL_STATE_SCOPE) {
  return ensureLocalStateRuntimeLoaded(scope, { forceReload: true });
}

module.exports = {
  LOCAL_STATE_CONSUMER,
  applyLocalStateSnapshot,
  catchUpProjection,
  ensureLocalStateRuntimeLoaded,
  emitLocalStateSnapshot,
  getLocalState,
  getLocalStateSync,
  rehydrateLocalStateRuntimeFromProjection,
  resetLocalState,
};
