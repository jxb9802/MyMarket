const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTxBuildResult } = require('../order/order_tx_builder');

test('normalizes tx build result and rejects invalid shape', () => {
  const txid = 'a'.repeat(64);
  const rawtx = '01000000';
  assert.deepEqual(normalizeTxBuildResult({
    txid: txid.toUpperCase(),
    rawtx,
    kind: 'order_accept_seller_lock',
    extra: true,
  }), {
    txid,
    rawtx,
    kind: 'order_accept_seller_lock',
    rawtxBytes: 4,
    extra: true,
  });

  assert.throws(() => normalizeTxBuildResult({ txid, rawtx: 'abc', kind: 'x' }), {
    code: 'INVALID_TX_BUILD_RESULT',
  });
});

