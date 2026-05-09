'use strict';

function normalizeOutpoint(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{64}:\d+$/i.test(text) ? text : '';
}

function createReservationLedger(initial = {}) {
  const reservations = new Map();
  const spent = new Map();
  for (const row of (Array.isArray(initial.reservations) ? initial.reservations : [])) {
    if (!row?.id) continue;
    reservations.set(String(row.id), {
      id: String(row.id),
      status: String(row.status || 'reserved'),
      outpoints: (Array.isArray(row.outpoints) ? row.outpoints : []).map(normalizeOutpoint).filter(Boolean),
      txid: String(row.txid || '').trim().toLowerCase(),
    });
  }
  for (const [outpoint, txid] of Object.entries(initial.spent || {})) {
    const safe = normalizeOutpoint(outpoint);
    if (safe) spent.set(safe, String(txid || '').trim().toLowerCase());
  }

  function assertAvailable(outpoints = []) {
    for (const outpoint of outpoints.map(normalizeOutpoint).filter(Boolean)) {
      if (spent.has(outpoint)) {
        const err = new Error(`Outpoint already spent: ${outpoint}`);
        err.code = 'OUTPOINT_ALREADY_SPENT';
        err.outpoint = outpoint;
        throw err;
      }
      for (const reservation of reservations.values()) {
        if (
          (reservation.status === 'reserved' || reservation.status === 'pending' || reservation.status === 'uncertain')
          && reservation.outpoints.includes(outpoint)
        ) {
          const err = new Error(`Outpoint already reserved: ${outpoint}`);
          err.code = 'OUTPOINT_ALREADY_RESERVED';
          err.outpoint = outpoint;
          err.reservationId = reservation.id;
          throw err;
        }
      }
    }
  }

  return {
    reserve(id, outpoints = [], meta = {}) {
      const safeId = String(id || '').trim();
      if (!safeId) throw new Error('reservation id is required');
      const safeOutpoints = outpoints.map(normalizeOutpoint).filter(Boolean);
      assertAvailable(safeOutpoints);
      const row = {
        id: safeId,
        status: 'reserved',
        outpoints: safeOutpoints,
        txid: String(meta.txid || '').trim().toLowerCase(),
      };
      reservations.set(safeId, row);
      return { ...row, outpoints: row.outpoints.slice() };
    },
    markPending(id) {
      const row = reservations.get(String(id || '').trim());
      if (!row) return false;
      row.status = 'pending';
      return true;
    },
    markUncertain(id) {
      const row = reservations.get(String(id || '').trim());
      if (!row) return false;
      row.status = 'uncertain';
      return true;
    },
    confirm(id, txid = '') {
      const row = reservations.get(String(id || '').trim());
      if (!row) return false;
      row.status = 'confirmed';
      row.txid = String(txid || row.txid || '').trim().toLowerCase();
      for (const outpoint of row.outpoints) spent.set(outpoint, row.txid);
      return true;
    },
    release(id) {
      const row = reservations.get(String(id || '').trim());
      if (!row) return false;
      if (row.status === 'confirmed') return false;
      reservations.delete(row.id);
      return true;
    },
    snapshot() {
      return {
        reservations: Array.from(reservations.values()).map((row) => ({ ...row, outpoints: row.outpoints.slice() })),
        spent: Object.fromEntries(spent.entries()),
      };
    },
  };
}

module.exports = {
  createReservationLedger,
  normalizeOutpoint,
};
