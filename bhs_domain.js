const marketDb = require('./market_db');
const fs = require('fs');
const path = require('path');

const BHS_CONSUMER = 'bhs_projection_writer_v1';
const BHS_SCOPE = 'main';
const bhsStateCache = new Map();

function appendBhsTrace(event, payload = {}) {
  try {
    const file = path.join(marketDb.getLogDir(), 'market_db_trace.log');
    fs.appendFileSync(file, `${JSON.stringify({
      ts: new Date().toISOString(),
      source: 'bhs_domain',
      pid: process.pid,
      event,
      ...payload,
    })}\n`);
  } catch (_) {}
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(row = {}) {
  return {
    scope: String(row.scope || BHS_SCOPE).trim(),
    ok: row.ok === true,
    checkpointHeight: Math.max(0, Number(row.checkpointHeight || 0)),
    checkpointHash: String(row.checkpointHash || '').trim().toLowerCase(),
    tipHeight: Math.max(0, Number(row.tipHeight || 0)),
    tipHash: String(row.tipHash || '').trim().toLowerCase(),
    headerCount: Math.max(0, Number(row.headerCount || 0)),
    headers: row.headers && typeof row.headers === 'object' ? { ...row.headers } : {},
    lastRound: row.lastRound && typeof row.lastRound === 'object' ? { ...row.lastRound } : {},
    lastEventSeq: Math.max(0, Number(row.lastEventSeq || 0)),
    updatedAt: String(row.updatedAt || nowIso()),
  };
}

function cloneStatus(status = null, options = {}) {
  if (!status || typeof status !== 'object') return null;
  const includeHeaders = options.includeHeaders !== false;
  return {
    ...status,
    headers: includeHeaders && status.headers && typeof status.headers === 'object' ? { ...status.headers } : {},
    lastRound: status.lastRound && typeof status.lastRound === 'object' ? { ...status.lastRound } : {},
  };
}

function writeCache(scope, status) {
  const safeScope = String(scope || BHS_SCOPE).trim() || BHS_SCOPE;
  if (!status) {
    bhsStateCache.delete(safeScope);
    return null;
  }
  const normalized = normalizeStatus({
    ...status,
    scope: safeScope,
  });
  bhsStateCache.set(safeScope, normalized);
  return cloneStatus(normalized);
}

function getCachedStatus(scope = BHS_SCOPE, options = {}) {
  const safeScope = String(scope || BHS_SCOPE).trim() || BHS_SCOPE;
  if (options.allowLoad === false && options.allowCache === true) {
    const cached = bhsStateCache.get(safeScope);
    return cached ? cloneStatus(cached, options) : null;
  }
  const loaded = readProjectionState(safeScope);
  if (!loaded) {
    bhsStateCache.delete(safeScope);
    return null;
  }
  const cached = writeCache(safeScope, loaded);
  return cloneStatus(cached, options);
}

function readProjectionState(scope = BHS_SCOPE) {
  const db = marketDb.openReadDb();
  try {
    try {
      const row = db.prepare(`
        SELECT
          scope,
          ok,
          checkpoint_height,
          checkpoint_hash,
          tip_height,
          tip_hash,
          header_count,
          headers_json,
          last_round_json,
          last_event_seq,
          updated_at
        FROM bhs_status_projection
        WHERE scope = ?
        LIMIT 1
      `).get(String(scope || BHS_SCOPE).trim());
      if (!row) return null;
      let headers = {};
      let lastRound = {};
      try { headers = JSON.parse(String(row.headers_json || '{}')); } catch (_) {}
      try { lastRound = JSON.parse(String(row.last_round_json || '{}')); } catch (_) {}
      return normalizeStatus({
        scope: row.scope,
        ok: Number(row.ok || 0) === 1,
        checkpointHeight: row.checkpoint_height,
        checkpointHash: row.checkpoint_hash,
        tipHeight: row.tip_height,
        tipHash: row.tip_hash,
        headerCount: row.header_count,
        headers,
        lastRound,
        lastEventSeq: row.last_event_seq,
        updatedAt: row.updated_at,
      });
    } catch (_) {
      return null;
    }
  } finally {
    db.close();
  }
}

async function catchUpProjection(scope = BHS_SCOPE) {
  appendBhsTrace('catchup_profile', {
    consumerName: BHS_CONSUMER,
    scope: String(scope || BHS_SCOPE).trim() || BHS_SCOPE,
    fromSeq: 0,
    toSeq: 0,
    eventCount: 0,
    bhsEventCount: 0,
    getConsumerMs: 0,
    listEventsMs: 0,
    writeProjectionMs: 0,
    commitConsumerMs: 0,
    totalMs: 0,
    mode: 'projection_direct',
  });
  return { applied: 0, lastSeq: 0 };
}

async function emitBhsStatusSnapshot(snapshot = {}, meta = {}) {
  const payload = normalizeStatus(snapshot);
  appendBhsTrace('projection_direct_update', {
    scope: payload.scope,
    tipHeight: Number(payload.tipHeight || 0),
    headerCount: Number(payload.headerCount || 0),
    producer: String(meta.producer || 'bhs_domain'),
  });
  await marketDb.applyBhsProjectionBatch({ status: payload });
  return writeCache(payload.scope, payload);
}

async function getBhsStatus(scope = BHS_SCOPE, options = {}) {
  return getCachedStatus(scope, options);
}

function getBhsStatusSync(scope = BHS_SCOPE, options = {}) {
  return getCachedStatus(scope, options);
}

function setBhsStatusMemory(snapshot = {}) {
  const payload = normalizeStatus(snapshot);
  return writeCache(payload.scope, payload);
}

module.exports = {
  BHS_CONSUMER,
  catchUpProjection,
  emitBhsStatusSnapshot,
  getBhsStatus,
  getBhsStatusSync,
  setBhsStatusMemory,
};
