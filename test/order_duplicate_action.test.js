const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createOrderActionPreflightReport,
  findPendingOrderActionTx,
} = require('../order/order_application_service');

test('finds pending accept tx by order action note', () => {
  const txid = 'a'.repeat(64);
  const rawtx = '00ff';
  const state = {
    recentRawtxs: [
      { txid: 'b'.repeat(64), rawtx: '0011', note: 'other' },
      { txid, rawtx, note: 'order_accept_seller_lock:order:test' },
    ],
  };
  const found = findPendingOrderActionTx(state, {
    orderId: 'order:test',
    action: 'accept',
  });
  assert.equal(found.txid, txid);
  assert.equal(found.rawtx, rawtx);
});

test('preflight report fails closed on duplicate pending tx', () => {
  const report = createOrderActionPreflightReport({
    orderStateOk: true,
    actorOk: true,
    walletOk: true,
    utxoOk: true,
    feeOk: true,
    payloadOk: true,
    duplicatePendingTx: true,
  });
  assert.equal(report.ok, false);
  assert.equal(report.duplicatePendingTx, true);
});

