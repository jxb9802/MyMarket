const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ORDER_STATUS,
  applyTransition,
  deriveEscrowNumbers,
  ensureOrderShape,
} = require('../order_state_machine');

function mkBaseOrder(priceSats = 100000) {
  return ensureOrderShape({
    id: 'order:test',
    status: ORDER_STATUS.NEW,
    snapshot: { price_snapshot: priceSats },
    funds: { priceSats },
    transitionIds: [],
  });
}

test('v3 happy path NEW -> PLACED -> LOCKED -> SHIPPED -> COMPLETED', () => {
  let order = mkBaseOrder(100000);
  order = applyTransition(order, 'place', { transitionId: 'p1' });
  assert.equal(order.status, ORDER_STATUS.PLACED);
  assert.equal(order.funds.buyerLockedSats, 120000);
  assert.equal(order.funds.sellerLockedSats, 0);

  order = applyTransition(order, 'accept', { transitionId: 'a1' });
  assert.equal(order.status, ORDER_STATUS.LOCKED);
  assert.equal(order.funds.sellerLockedSats, 10000);

  order = applyTransition(order, 'ship', { transitionId: 's1' });
  assert.equal(order.status, ORDER_STATUS.SHIPPED);

  order = applyTransition(order, 'confirm_receipt', { transitionId: 'c1' });
  assert.equal(order.status, ORDER_STATUS.COMPLETED);
  assert.deepEqual(order.funds.settlement, {
    sellerCreditSats: 100000,
    buyerRefundSats: 20000,
    sellerRefundSats: 10000,
    mode: 'COMPLETED',
  });
});

test('v3 refund path uses exact buyer and seller refund amounts', () => {
  let order = mkBaseOrder(50000);
  order = applyTransition(order, 'place', { transitionId: 'p2' });
  order = applyTransition(order, 'accept', { transitionId: 'a2' });
  order = applyTransition(order, 'ship', { transitionId: 's2' });
  order = applyTransition(order, 'request_refund', { transitionId: 'r1' });
  assert.equal(order.status, ORDER_STATUS.REFUND_REQUESTED);

  order = applyTransition(order, 'confirm_refund', { transitionId: 'r2' });
  assert.equal(order.status, ORDER_STATUS.REFUNDED);
  assert.deepEqual(order.funds.settlement, {
    buyerRefundSats: 60000,
    sellerRefundSats: 5000,
    sellerCreditSats: 0,
    mode: 'REFUNDED',
  });
});

test('v3 buyer cancel is disabled for release flow', () => {
  let order = mkBaseOrder(25000);
  order = applyTransition(order, 'place', { transitionId: 'p3' });
  assert.throws(() => applyTransition(order, 'cancel_by_buyer', { transitionId: 'x1' }), {
    code: 'UNSUPPORTED_ORDER_ACTION',
  });
});

test('v3 seller can cancel a placed order before accepting', () => {
  let order = mkBaseOrder(25000);
  order = applyTransition(order, 'place', { transitionId: 'p4' });
  order = applyTransition(order, 'cancel_by_seller', { transitionId: 'seller-cancel-1' });
  assert.equal(order.status, ORDER_STATUS.CANCELED);
  assert.equal(order.funds.buyerLockedSats, 0);
  assert.equal(order.funds.sellerLockedSats, 0);
  assert.deepEqual(order.funds.settlement, {
    buyerRefundSats: 30000,
    sellerRefundSats: 0,
    sellerCreditSats: 0,
    mode: 'SELLER_CANCEL',
  });
});

test('illegal jumps and duplicate transitions are rejected', () => {
  const order = mkBaseOrder(100000);
  assert.throws(() => applyTransition(order, 'confirm_receipt', { transitionId: 'bad' }), {
    code: 'ILLEGAL_ORDER_TRANSITION',
  });

  let placed = applyTransition(order, 'place', { transitionId: 'dup' });
  assert.throws(() => applyTransition(placed, 'accept', { transitionId: 'dup' }), {
    code: 'DUPLICATE_TRANSITION',
  });
});

test('v3 escrow math uses 20 percent buyer deposit and 10 percent seller deposit', () => {
  assert.deepEqual(deriveEscrowNumbers(12345, 2000, 1000), {
    priceSats: 12345,
    buyerDepositSats: 2469,
    sellerDepositSats: 1234,
    buyerLockTotalSats: 14814,
    sellerLockTotalSats: 1234,
  });
  assert.equal(deriveEscrowNumbers(1000, 2000, 1000).sellerDepositSats, 1000);
});
