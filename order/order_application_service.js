'use strict';

function findRecentOrderRawtxByNote(state, note) {
  const safeNote = String(note || '').trim();
  if (!safeNote || !Array.isArray(state?.recentRawtxs)) return null;
  for (let i = state.recentRawtxs.length - 1; i >= 0; i -= 1) {
    const row = state.recentRawtxs[i];
    const txid = String(row?.txid || '').trim().toLowerCase();
    const rawtx = String(row?.rawtx || '').trim();
    if (
      String(row?.note || '').trim() === safeNote
      && /^[0-9a-f]{64}$/i.test(txid)
      && rawtx
    ) {
      return { ...row, txid, rawtx };
    }
  }
  return null;
}

function findPendingOrderActionTx(state, { orderId = '', action = '' } = {}) {
  const safeOrderId = String(orderId || '').trim();
  const safeAction = String(action || '').trim();
  if (!safeOrderId || !safeAction) return null;
  const note = safeAction === 'accept'
    ? `order_accept_seller_lock:${safeOrderId}`
    : `order_${safeAction}:${safeOrderId}`;
  return findRecentOrderRawtxByNote(state, note);
}

function createOrderActionPreflightReport(checks = {}) {
  const report = {
    orderStateOk: checks.orderStateOk !== false,
    actorOk: checks.actorOk !== false,
    walletOk: checks.walletOk !== false,
    utxoOk: checks.utxoOk !== false,
    feeOk: checks.feeOk !== false,
    payloadOk: checks.payloadOk !== false,
    duplicatePendingTx: checks.duplicatePendingTx === true,
  };
  report.ok = Object.entries(report)
    .filter(([key]) => key !== 'duplicatePendingTx')
    .every(([, value]) => value === true)
    && report.duplicatePendingTx === false;
  return report;
}

module.exports = {
  createOrderActionPreflightReport,
  findPendingOrderActionTx,
  findRecentOrderRawtxByNote,
};
