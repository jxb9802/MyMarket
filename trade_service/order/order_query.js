const marketDb = require('../../market_db');
const orderDomain = require('../../order_domain');
const {
  applyTransition,
  ensureOrderShape,
  coerceLegacyStatus,
  DEFAULT_BUYER_DEPOSIT_BPS,
  DEFAULT_SELLER_DEPOSIT_BPS,
  DEFAULT_MIN_CONFIRMATIONS,
} = require('../../order_state_machine');

const ORDER_ACTION_META = Object.freeze({
  order_ship: { machineAction: 'ship', tip: 'order_tip_ship' },
  order_confirm: { machineAction: 'confirm', tip: 'order_tip_confirm_receipt' },
  order_cancel_before_ship: { machineAction: 'cancel_before_ship', tip: 'order_tip_buyer_cancel_before_ship' },
  order_return_request: { machineAction: 'return_request', tip: 'order_tip_return_request' },
  order_return_accept: { machineAction: 'return_accept', tip: 'order_tip_return_accept' },
  order_dispute_lock: { machineAction: 'dispute_lock', tip: 'order_tip_dispute_lock' },
});

function orderMachineConfig() {
  return {
    buyerDepositRateBps: DEFAULT_BUYER_DEPOSIT_BPS,
    sellerDepositRateBps: DEFAULT_SELLER_DEPOSIT_BPS,
    minConfirmations: DEFAULT_MIN_CONFIRMATIONS,
  };
}

function migrateOrderModel(orderLike) {
  const order = orderLike && typeof orderLike === 'object' ? { ...orderLike } : {};
  const normalizedStatus = coerceLegacyStatus(order.status);
  order.status = normalizedStatus;
  if (!order.snapshot || typeof order.snapshot !== 'object') order.snapshot = {};
  order.funds = ensureOrderShape(
    {
      snapshot: order.snapshot,
      status: normalizedStatus,
      funds: order.funds || {},
      transitionIds: order.transitionIds || [],
    },
    orderMachineConfig(),
  ).funds;
  if (!Array.isArray(order.transitionIds)) order.transitionIds = [];
  if (!Number.isFinite(Number(order.updatedAt))) order.updatedAt = Date.now();
  return order;
}

function listOrderAnchors() {
  return marketDb.listAnchorEventsFromReadDb({
    eventTypes: [
      'order_open',
      'order_place',
      'order_ship',
      'order_confirm',
      'order_cancel_before_ship',
      'order_return_request',
      'order_return_accept',
      'order_dispute_lock',
    ],
  });
}

function buildOrderSnapshotFromAnchorPayload(payload) {
  const productId = String(payload?.productId || payload?.entityId || '').trim();
  const price = Math.max(0, Number(payload?.price || payload?.priceSats || 0));
  const buyerLockSats = Math.max(
    0,
    Number(payload?.buyerLockSats || payload?.funds?.buyerLockedSats || 0),
  );
  const sellerLockedSats = Math.max(0, Number(payload?.funds?.sellerLockedSats || 0));
  return {
    snapshot: {
      product_id: productId,
      product_version: Math.max(1, Number(payload?.productVersion || 1)),
      price_snapshot: price,
      stock_snapshot: Math.max(0, Number(payload?.stock || payload?.stockSnapshot || 0)),
    },
    status: 'NEW',
    funds: {
      priceSats: price,
      buyerLockedSats: buyerLockSats,
      sellerLockedSats,
    },
    transitionIds: [],
  };
}

function rebuildOrdersFromAnchors() {
  const orderMap = new Map();
  for (const row of orderDomain.listOrdersSync()) {
    const migrated = migrateOrderModel(row);
    if (migrated?.id) orderMap.set(migrated.id, migrated);
  }
  const anchorRows = listOrderAnchors().sort((a, b) => {
    const ta = Date.parse(String(a?.ts || '')) || 0;
    const tb = Date.parse(String(b?.ts || '')) || 0;
    if (ta !== tb) return ta - tb;
    return String(a?.txid || '').localeCompare(String(b?.txid || ''));
  });
  for (const row of anchorRows) {
    const eventType = String(row?.eventType || '').trim();
    const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
    const orderId = String(payload?.orderId || '').trim();
    if (!orderId) continue;
    if (eventType === 'order_open' || eventType === 'order_place') {
      const baseOrder = buildOrderSnapshotFromAnchorPayload(payload);
      try {
        const opened = applyTransition(baseOrder, 'open', {
          config: orderMachineConfig(),
          confirmations: DEFAULT_MIN_CONFIRMATIONS,
          transitionId: `${eventType}:${String(row?.txid || orderId).trim()}`,
          nowMs: Date.parse(String(row?.ts || '')) || Date.now(),
        });
        opened.id = orderId;
        opened.tip = 'order_tip_place';
        orderMap.set(orderId, opened);
      } catch (_) {}
      continue;
    }
    const existing = orderMap.get(orderId);
    const actionMeta = ORDER_ACTION_META[eventType];
    if (!existing || !actionMeta) continue;
    try {
      const next = applyTransition(existing, actionMeta.machineAction, {
        config: orderMachineConfig(),
        confirmations: DEFAULT_MIN_CONFIRMATIONS,
        transitionId: `${eventType}:${String(row?.txid || orderId).trim()}`,
        nowMs: Date.parse(String(row?.ts || '')) || Date.now(),
      });
      next.id = orderId;
      next.tip = actionMeta.tip;
      if (payload?.funds && typeof payload.funds === 'object') {
        next.funds = {
          ...next.funds,
          ...payload.funds,
        };
      }
      orderMap.set(orderId, next);
    } catch (_) {}
  }
  return Array.from(orderMap.values()).sort((a, b) => Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0));
}

function listOrderSummary() {
  return {
    orders: rebuildOrdersFromAnchors(),
  };
}

function getOrderById(orderId) {
  const wanted = String(orderId || '').trim();
  if (!wanted) return null;
  return rebuildOrdersFromAnchors().find((row) => String(row?.id || '').trim() === wanted) || null;
}

function listOrderTimeline(orderId) {
  const wanted = String(orderId || '').trim();
  if (!wanted) return [];
  const rows = listOrderAnchors();
  return rows.filter((row) => String(row?.payload?.orderId || '').trim() === wanted);
}

module.exports = {
  listOrderSummary,
  getOrderById,
  listOrderTimeline,
};
