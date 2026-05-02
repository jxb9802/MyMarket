const ORDER_STATUS = Object.freeze({
  NEW: 'NEW',
  PLACED: 'PLACED',
  LOCKED: 'LOCKED',
  SHIPPED: 'SHIPPED',
  REFUND_REQUESTED: 'REFUND_REQUESTED',
  COMPLETED: 'COMPLETED',
  CANCELED: 'CANCELED',
  TIMED_OUT: 'TIMED_OUT',
  REFUNDED: 'REFUNDED',
});

const DEFAULT_BUYER_DEPOSIT_BPS = 2000;
const DEFAULT_SELLER_DEPOSIT_BPS = 1000;
const DEFAULT_TIMEOUT_HOURS = 24;
const MIN_ORDER_ESCROW_OUTPUT_SATS = Math.max(1000, Number(process.env.BSV_MARKET_MIN_ORDER_ESCROW_OUTPUT_SATS || 1000));

const TERMINAL_STATES = new Set([
  ORDER_STATUS.COMPLETED,
  ORDER_STATUS.CANCELED,
  ORDER_STATUS.TIMED_OUT,
  ORDER_STATUS.REFUNDED,
]);

const LEGAL_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.NEW]: new Set([ORDER_STATUS.PLACED]),
  [ORDER_STATUS.PLACED]: new Set([ORDER_STATUS.LOCKED, ORDER_STATUS.CANCELED, ORDER_STATUS.TIMED_OUT]),
  [ORDER_STATUS.LOCKED]: new Set([ORDER_STATUS.SHIPPED]),
  [ORDER_STATUS.SHIPPED]: new Set([ORDER_STATUS.COMPLETED, ORDER_STATUS.REFUND_REQUESTED]),
  [ORDER_STATUS.REFUND_REQUESTED]: new Set([ORDER_STATUS.REFUNDED]),
  [ORDER_STATUS.COMPLETED]: new Set(),
  [ORDER_STATUS.CANCELED]: new Set(),
  [ORDER_STATUS.TIMED_OUT]: new Set(),
  [ORDER_STATUS.REFUNDED]: new Set(),
});

const ACTION_TO_STATUS = Object.freeze({
  place: ORDER_STATUS.PLACED,
  accept: ORDER_STATUS.LOCKED,
  ship: ORDER_STATUS.SHIPPED,
  confirm_receipt: ORDER_STATUS.COMPLETED,
  cancel_by_seller: ORDER_STATUS.CANCELED,
  timeout_cancel: ORDER_STATUS.TIMED_OUT,
  request_refund: ORDER_STATUS.REFUND_REQUESTED,
  confirm_refund: ORDER_STATUS.REFUNDED,
});

function toInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function normalizeConfig(cfg = {}) {
  const buyerDepositRateBps = Math.max(0, toInt(cfg.buyerDepositRateBps, DEFAULT_BUYER_DEPOSIT_BPS));
  const sellerDepositRateBps = Math.max(0, toInt(cfg.sellerDepositRateBps, DEFAULT_SELLER_DEPOSIT_BPS));
  const timeoutHours = Math.max(1, toInt(cfg.timeoutHours, DEFAULT_TIMEOUT_HOURS));
  return { buyerDepositRateBps, sellerDepositRateBps, timeoutHours };
}

function deriveEscrowNumbers(priceSats, buyerDepositRateBps, sellerDepositRateBps) {
  const safePrice = Math.max(0, toInt(priceSats, 0));
  const buyerDepositSats = Math.floor((safePrice * buyerDepositRateBps) / 10000);
  const sellerDepositRawSats = Math.floor((safePrice * sellerDepositRateBps) / 10000);
  const sellerDepositSats = safePrice > 0
    ? Math.max(MIN_ORDER_ESCROW_OUTPUT_SATS, sellerDepositRawSats)
    : 0;
  return {
    priceSats: safePrice,
    buyerDepositSats,
    sellerDepositSats,
    buyerLockTotalSats: safePrice + buyerDepositSats,
    sellerLockTotalSats: sellerDepositSats,
  };
}

function assertCanTransition(fromStatus, toStatus) {
  const normalizedFrom = String(fromStatus || '').trim().toUpperCase();
  const normalizedTo = String(toStatus || '').trim().toUpperCase();
  const allowed = LEGAL_TRANSITIONS[normalizedFrom];
  if (!allowed || !allowed.has(normalizedTo)) {
    const err = new Error(`Illegal order transition: ${normalizedFrom || String(fromStatus)} -> ${normalizedTo || String(toStatus)}`);
    err.code = 'ILLEGAL_ORDER_TRANSITION';
    throw err;
  }
}

function ensureOrderShape(orderLike, cfg) {
  const config = normalizeConfig(cfg);
  const base = orderLike && typeof orderLike === 'object' ? orderLike : {};
  const funds = base.funds && typeof base.funds === 'object' ? base.funds : {};
  const snapshot = base.snapshot && typeof base.snapshot === 'object' ? { ...base.snapshot } : {};
  const replay = Array.isArray(base.transitionIds) ? base.transitionIds.slice(0, 200) : [];

  const priceFromFunds = toInt(funds.priceSats, NaN);
  const priceFromSnapshot = toInt(snapshot.price_snapshot, 0);
  const priceSats = Number.isFinite(priceFromFunds) ? Math.max(0, priceFromFunds) : Math.max(0, priceFromSnapshot);
  const metrics = deriveEscrowNumbers(priceSats, config.buyerDepositRateBps, config.sellerDepositRateBps);

  return {
    ...base,
    snapshot,
    status: String(base.status || ORDER_STATUS.NEW).trim().toUpperCase(),
    funds: {
      priceSats: metrics.priceSats,
      buyerDepositRateBps: config.buyerDepositRateBps,
      sellerDepositRateBps: config.sellerDepositRateBps,
      buyerDepositSats: metrics.buyerDepositSats,
      sellerDepositSats: metrics.sellerDepositSats,
      buyerLockedSats: Math.max(0, toInt(funds.buyerLockedSats, 0)),
      sellerLockedSats: Math.max(0, toInt(funds.sellerLockedSats, 0)),
      settlement: funds.settlement && typeof funds.settlement === 'object'
        ? { ...funds.settlement }
        : null,
    },
    chain: {
      ...(base?.chain && typeof base.chain === 'object' ? { ...base.chain } : {}),
      placeTxid: String(base?.chain?.placeTxid || '').trim(),
      buyerLockTxid: String(base?.chain?.buyerLockTxid || '').trim(),
      sellerLockTxid: String(base?.chain?.sellerLockTxid || '').trim(),
      shipTxid: String(base?.chain?.shipTxid || '').trim(),
      refundRequestTxid: String(base?.chain?.refundRequestTxid || '').trim(),
      settleTxid: String(base?.chain?.settleTxid || '').trim(),
      cancelTxid: String(base?.chain?.cancelTxid || '').trim(),
      stateAnchorTxid: String(base?.chain?.stateAnchorTxid || '').trim(),
    },
    transitionIds: replay,
  };
}

function applyTransition(orderLike, action, opts = {}) {
  const actionKey = String(action || '').trim();
  const nextStatus = ACTION_TO_STATUS[actionKey];
  if (!nextStatus) {
    const err = new Error(`Unsupported order action: ${actionKey}`);
    err.code = 'UNSUPPORTED_ORDER_ACTION';
    throw err;
  }

  const config = normalizeConfig(opts.config || {});
  const order = ensureOrderShape(orderLike, config);
  if (TERMINAL_STATES.has(order.status)) {
    const err = new Error(`Order already terminal at ${order.status}`);
    err.code = 'ORDER_ALREADY_TERMINAL';
    throw err;
  }

  const transitionId = String(opts.transitionId || '').trim();
  if (transitionId && order.transitionIds.includes(transitionId)) {
    const err = new Error(`Duplicate transition replay: ${transitionId}`);
    err.code = 'DUPLICATE_TRANSITION';
    throw err;
  }

  assertCanTransition(order.status, nextStatus);

  const updated = {
    ...order,
    status: nextStatus,
    updatedAt: Number.isFinite(Number(opts.nowMs)) ? Number(opts.nowMs) : Date.now(),
    transitionIds: transitionId ? order.transitionIds.concat([transitionId]).slice(-200) : order.transitionIds,
  };

  if (actionKey === 'place') {
    updated.funds.buyerLockedSats = updated.funds.priceSats + updated.funds.buyerDepositSats;
    updated.funds.sellerLockedSats = 0;
    updated.funds.settlement = null;
    return updated;
  }

  if (actionKey === 'accept') {
    updated.funds.sellerLockedSats = updated.funds.sellerDepositSats;
    updated.funds.settlement = null;
    return updated;
  }

  if (actionKey === 'ship') {
    return updated;
  }

  if (actionKey === 'confirm_receipt') {
    updated.funds.settlement = {
      sellerCreditSats: updated.funds.priceSats,
      buyerRefundSats: updated.funds.buyerDepositSats,
      sellerRefundSats: updated.funds.sellerDepositSats,
      mode: 'COMPLETED',
    };
    updated.funds.buyerLockedSats = 0;
    updated.funds.sellerLockedSats = 0;
    return updated;
  }

  if (actionKey === 'cancel_by_buyer' || actionKey === 'cancel_by_seller') {
    updated.funds.settlement = {
      buyerRefundSats: updated.funds.priceSats + updated.funds.buyerDepositSats,
      sellerRefundSats: 0,
      sellerCreditSats: 0,
      mode: actionKey === 'cancel_by_buyer' ? 'BUYER_CANCEL' : 'SELLER_CANCEL',
    };
    updated.funds.buyerLockedSats = 0;
    updated.funds.sellerLockedSats = 0;
    return updated;
  }

  if (actionKey === 'timeout_cancel') {
    updated.funds.settlement = {
      buyerRefundSats: updated.funds.priceSats + updated.funds.buyerDepositSats,
      sellerRefundSats: 0,
      sellerCreditSats: 0,
      mode: 'TIMED_OUT',
    };
    updated.funds.buyerLockedSats = 0;
    updated.funds.sellerLockedSats = 0;
    return updated;
  }

  if (actionKey === 'request_refund') {
    return updated;
  }

  if (actionKey === 'confirm_refund') {
    updated.funds.settlement = {
      buyerRefundSats: updated.funds.priceSats + updated.funds.buyerDepositSats,
      sellerRefundSats: updated.funds.sellerDepositSats,
      sellerCreditSats: 0,
      mode: 'REFUNDED',
    };
    updated.funds.buyerLockedSats = 0;
    updated.funds.sellerLockedSats = 0;
    return updated;
  }

  return updated;
}

function coerceLegacyStatus(rawStatus) {
  const s = String(rawStatus || '').trim().toUpperCase();
  if (!s) return ORDER_STATUS.NEW;
  if (s === 'OPENED') return ORDER_STATUS.PLACED;
  if (s === 'CONFIRMED' || s === 'DELIVERED') return ORDER_STATUS.COMPLETED;
  if (s === 'RETURN_REQUESTED') return ORDER_STATUS.REFUND_REQUESTED;
  if (s === 'RETURN_ACCEPTED') return ORDER_STATUS.REFUNDED;
  if (s === 'CANCELED_BY_BUYER' || s === 'BUYER_CANCELED') return ORDER_STATUS.CANCELED;
  if (s === 'DISPUTE_LOCKED') return ORDER_STATUS.REFUND_REQUESTED;
  if (ORDER_STATUS[s]) return s;
  return ORDER_STATUS.NEW;
}

module.exports = {
  ORDER_STATUS,
  LEGAL_TRANSITIONS,
  TERMINAL_STATES,
  ACTION_TO_STATUS,
  DEFAULT_BUYER_DEPOSIT_BPS,
  DEFAULT_SELLER_DEPOSIT_BPS,
  DEFAULT_TIMEOUT_HOURS,
  MIN_ORDER_ESCROW_OUTPUT_SATS,
  normalizeConfig,
  deriveEscrowNumbers,
  ensureOrderShape,
  assertCanTransition,
  applyTransition,
  coerceLegacyStatus,
};
