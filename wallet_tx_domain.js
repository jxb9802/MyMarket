const marketDb = require('./market_db');
const messageQueue = require('./lib/message_queue');
const fs = require('fs');
const path = require('path');

const WALLET_TX_CONSUMER = 'wallet_tx_projection_writer_v1';
let runtimeReservationState = null;

function appendWalletTxTrace(event, payload = {}) {
  try {
    const file = path.join(marketDb.getLogDir(), 'market_db_trace.log');
    fs.appendFileSync(file, `${JSON.stringify({
      ts: new Date().toISOString(),
      source: 'wallet_tx_domain',
      pid: process.pid,
      event,
      ...payload,
    })}\n`);
  } catch (_) {}
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeReservation(row = {}) {
  return {
    reservationId: String(row.reservationId || '').trim(),
    reservationType: String(row.reservationType || '').trim(),
    ownerId: String(row.ownerId || '').trim(),
    txid: String(row.txid || '').trim().toLowerCase(),
    status: String(row.status || 'active').trim(),
    outpoints: Array.isArray(row.outpoints)
      ? row.outpoints.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
      : [],
    lastEventSeq: Math.max(0, Number(row.lastEventSeq || 0)),
    updatedAt: String(row.updatedAt || nowIso()),
  };
}

function cloneReservation(reservation = null) {
  return reservation ? normalizeReservation(reservation) : null;
}

function makeRuntimeState() {
  return {
    loaded: false,
    reservationMap: new Map(),
    outpointSet: new Set(),
    updatedAt: '',
  };
}

function cloneRuntimeState(state = null) {
  const current = state && typeof state === 'object' ? state : makeRuntimeState();
  return {
    loaded: current.loaded === true,
    reservationMap: new Map(
      Array.from(current.reservationMap instanceof Map ? current.reservationMap.entries() : [])
        .map(([key, value]) => [String(key || '').trim(), cloneReservation(value)]),
    ),
    outpointSet: new Set(
      Array.from(current.outpointSet instanceof Set ? current.outpointSet.values() : [])
        .map((item) => String(item || '').trim().toLowerCase())
        .filter(Boolean),
    ),
    updatedAt: String(current.updatedAt || ''),
  };
}

function rebuildRuntimeOutpointSet(state) {
  const next = new Set();
  if (!(state?.reservationMap instanceof Map)) return next;
  for (const reservation of state.reservationMap.values()) {
    const status = String(reservation?.status || '').trim().toLowerCase();
    if (status && status !== 'active') continue;
    for (const outpoint of (Array.isArray(reservation?.outpoints) ? reservation.outpoints : [])) {
      const safe = String(outpoint || '').trim().toLowerCase();
      if (safe) next.add(safe);
    }
  }
  return next;
}

function buildProjectionBatchFromRuntimeState(state) {
  const reservations = Array.from(state?.reservationMap instanceof Map ? state.reservationMap.values() : [])
    .map((row) => normalizeReservation(row))
    .filter((row) => row.reservationId);
  const outpointRows = reservations.flatMap((row) => row.outpoints.map((outpoint) => ({
    reservationId: row.reservationId,
    outpoint,
    reservationType: row.reservationType,
    ownerId: row.ownerId,
    txid: row.txid,
    status: row.status,
    lastEventSeq: row.lastEventSeq,
    updatedAt: row.updatedAt,
  })));
  return { reservations, outpointRows };
}

function buildProjectionBatchForEvent(eventType, payload = {}) {
  const eventName = String(eventType || '').trim();
  if (eventName === 'wallet_tx.reservation.upsert') {
    const reservation = normalizeReservation({
      reservationId: payload.reservationId,
      reservationType: payload.reservationType,
      ownerId: payload.ownerId,
      txid: payload.txid,
      status: payload.status || 'active',
      outpoints: payload.outpoints,
      lastEventSeq: payload.lastEventSeq || 0,
      updatedAt: payload.updatedAt || nowIso(),
    });
    if (!reservation.reservationId) {
      return {
        reservations: [],
        outpointRows: [],
        deleteReservationIds: [],
      };
    }
    return {
      reservations: [reservation],
      outpointRows: reservation.outpoints.map((outpoint) => ({
        reservationId: reservation.reservationId,
        outpoint,
        reservationType: reservation.reservationType,
        ownerId: reservation.ownerId,
        txid: reservation.txid,
        status: reservation.status,
        lastEventSeq: reservation.lastEventSeq,
        updatedAt: reservation.updatedAt,
      })),
      deleteReservationIds: [],
    };
  }
  if (eventName === 'wallet_tx.reservation.released') {
    const reservationId = String(payload.reservationId || '').trim();
    return {
      reservations: [],
      outpointRows: [],
      deleteReservationIds: reservationId ? [reservationId] : [],
    };
  }
  return {
    reservations: [],
    outpointRows: [],
    deleteReservationIds: [],
  };
}

async function loadProjectionState() {
  const rows = await marketDb.listWalletTxReservationProjection();
  const reservationMap = new Map();
  rows.forEach((row) => {
    const normalized = normalizeReservation(row);
    if (!normalized.reservationId) return;
    reservationMap.set(normalized.reservationId, normalized);
  });
  return {
    reservationMap,
    outpointSet: rebuildRuntimeOutpointSet({ reservationMap }),
    updatedAt: nowIso(),
  };
}

async function catchUpProjection() {
  appendWalletTxTrace('catchup_profile', {
    consumerName: WALLET_TX_CONSUMER,
    mode: 'projection_direct',
    fromSeq: 0,
    toSeq: 0,
    eventCount: 0,
    walletTxEventCount: 0,
    reservationCount: 0,
    outpointRowCount: 0,
    getConsumerMs: 0,
    listEventsMs: 0,
    writeProjectionMs: 0,
    commitConsumerMs: 0,
    totalMs: 0,
  });
  return { applied: 0, lastSeq: 0 };
}

async function ensureWalletTxRuntimeLoaded(options = {}) {
  if (runtimeReservationState?.loaded === true && options.forceReload !== true) {
    return cloneRuntimeState(runtimeReservationState);
  }
  const projected = await loadProjectionState();
  runtimeReservationState = {
    loaded: true,
    reservationMap: projected.reservationMap instanceof Map ? projected.reservationMap : new Map(),
    outpointSet: projected.outpointSet instanceof Set ? projected.outpointSet : rebuildRuntimeOutpointSet(projected),
    updatedAt: String(projected.updatedAt || nowIso()),
  };
  appendWalletTxTrace('runtime_state_loaded', {
    consumerName: WALLET_TX_CONSUMER,
    reservationCount: runtimeReservationState.reservationMap.size,
    outpointCount: runtimeReservationState.outpointSet.size,
    forceReload: options.forceReload === true,
  });
  return cloneRuntimeState(runtimeReservationState);
}

function applyWalletTxEventToRuntime(eventType, payload = {}) {
  if (!runtimeReservationState || runtimeReservationState.loaded !== true) {
    runtimeReservationState = makeRuntimeState();
    runtimeReservationState.loaded = true;
  }
  const eventName = String(eventType || '').trim();
  if (eventName === 'wallet_tx.reservation.upsert') {
    const reservation = normalizeReservation({
      reservationId: payload.reservationId,
      reservationType: payload.reservationType,
      ownerId: payload.ownerId,
      txid: payload.txid,
      status: payload.status || 'active',
      outpoints: payload.outpoints,
      lastEventSeq: 0,
      updatedAt: nowIso(),
    });
    if (!reservation.reservationId) return null;
    runtimeReservationState.reservationMap.set(reservation.reservationId, reservation);
  } else if (eventName === 'wallet_tx.reservation.released') {
    const reservationId = String(payload.reservationId || '').trim();
    if (!reservationId) return null;
    runtimeReservationState.reservationMap.delete(reservationId);
  } else {
    return null;
  }
  runtimeReservationState.outpointSet = rebuildRuntimeOutpointSet(runtimeReservationState);
  runtimeReservationState.updatedAt = nowIso();
  return cloneRuntimeState(runtimeReservationState);
}

async function emitWalletTxEvent(eventType, payload = {}, meta = {}) {
  const eventName = String(eventType || '').trim();
  const entityId = String(meta.entityId || payload.reservationId || payload.txid || 'wallet_tx').trim() || 'wallet_tx';
  await messageQueue.publish(eventName, payload && typeof payload === 'object' ? payload : {}, {
    mode: messageQueue.MODE_TRANSIENT,
    source: String(meta.producer || 'wallet_tx_domain'),
  });
  const state = applyWalletTxEventToRuntime(eventName, payload);
  if (!state) return null;
  const batch = buildProjectionBatchForEvent(eventName, payload);
  appendWalletTxTrace('projection_direct_update', {
    consumerName: WALLET_TX_CONSUMER,
    eventType: eventName,
    entityId,
    reservationCount: batch.reservations.length,
    outpointRowCount: batch.outpointRows.length,
    deletedReservationCount: batch.deleteReservationIds.length,
    producer: String(meta.producer || 'wallet_tx_domain'),
  });
  await marketDb.applyWalletTxProjectionBatch({
    reservations: batch.reservations,
    outpointRows: batch.outpointRows,
    deleteReservationIds: batch.deleteReservationIds,
  });
  return { eventType: eventName, entityId, payload };
}

async function reserveOutpoints(reservationId, reservationType, outpoints, options = {}) {
  const safeOutpoints = Array.isArray(outpoints)
    ? outpoints.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (!reservationId || safeOutpoints.length <= 0) return null;
  return emitWalletTxEvent('wallet_tx.reservation.upsert', {
    reservationId: String(reservationId || '').trim(),
    reservationType: String(reservationType || '').trim(),
    ownerId: String(options.ownerId || '').trim(),
    txid: String(options.txid || '').trim().toLowerCase(),
    status: String(options.status || 'active').trim(),
    outpoints: Array.from(new Set(safeOutpoints)),
  }, {
    producer: String(options.producer || 'wallet_tx_domain.reserve'),
    entityType: 'wallet_tx_reservation',
    entityId: String(reservationId || '').trim(),
    dedupeKey: String(options.dedupeKey || '').trim(),
  });
}

async function releaseReservation(reservationId, options = {}) {
  const safeReservationId = String(reservationId || '').trim();
  if (!safeReservationId) return null;
  return emitWalletTxEvent('wallet_tx.reservation.released', {
    reservationId: safeReservationId,
    reason: String(options.reason || '').trim(),
  }, {
    producer: String(options.producer || 'wallet_tx_domain.release'),
    entityType: 'wallet_tx_reservation',
    entityId: safeReservationId,
    dedupeKey: String(options.dedupeKey || '').trim(),
  });
}

async function resetWalletTxProjection() {
  runtimeReservationState = {
    loaded: true,
    reservationMap: new Map(),
    outpointSet: new Set(),
    updatedAt: nowIso(),
  };
  appendWalletTxTrace('projection_reset', {
    consumerName: WALLET_TX_CONSUMER,
  });
  await marketDb.applyWalletTxProjectionBatch({
    reservations: [],
    outpointRows: [],
    deleteReservationIds: [],
    resetAll: true,
  });
  return true;
}

async function listReservations() {
  const state = await ensureWalletTxRuntimeLoaded();
  return Array.from(state.reservationMap.values()).map((row) => cloneReservation(row));
}

async function listReservedOutpoints() {
  const state = await ensureWalletTxRuntimeLoaded();
  return Array.from(state.outpointSet.values()).sort();
}

function listReservedOutpointsSync() {
  if (runtimeReservationState?.loaded !== true) return [];
  return Array.from(runtimeReservationState.outpointSet.values()).sort();
}

async function rehydrateWalletTxRuntimeFromProjection() {
  const state = await ensureWalletTxRuntimeLoaded({ forceReload: true });
  return {
    reservationCount: state.reservationMap.size,
    outpointCount: state.outpointSet.size,
    updatedAt: state.updatedAt,
  };
}

module.exports = {
  WALLET_TX_CONSUMER,
  catchUpProjection,
  ensureWalletTxRuntimeLoaded,
  emitWalletTxEvent,
  rehydrateWalletTxRuntimeFromProjection,
  reserveOutpoints,
  releaseReservation,
  resetWalletTxProjection,
  listReservations,
  listReservedOutpoints,
  listReservedOutpointsSync,
};
