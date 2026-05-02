const marketDb = require('./market_db');
const messageQueue = require('./lib/message_queue');
const fs = require('fs');
const path = require('path');

const ORDER_CONSUMER = 'order_projection_writer_v1';

function appendOrderTrace(event, payload = {}) {
  try {
    const file = path.join(marketDb.getLogDir(), 'market_db_trace.log');
    fs.appendFileSync(file, `${JSON.stringify({
      ts: new Date().toISOString(),
      source: 'order_domain',
      pid: process.pid,
      event,
      ...payload,
    })}\n`);
  } catch (_) {}
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeOrder(row = {}) {
  const funds = row.funds && typeof row.funds === 'object' ? { ...row.funds } : {};
  const settlement = funds.settlement && typeof funds.settlement === 'object' ? { ...funds.settlement } : null;
  if (settlement) {
    if (!Number.isFinite(Number(funds.buyerRefundSats))) funds.buyerRefundSats = Number(settlement.buyerRefundSats || 0);
    if (!Number.isFinite(Number(funds.sellerRefundSats))) funds.sellerRefundSats = Number(settlement.sellerRefundSats || 0);
    if (!Number.isFinite(Number(funds.sellerCreditSats))) funds.sellerCreditSats = Number(settlement.sellerCreditSats || 0);
  }
  const chain = row.chain && typeof row.chain === 'object' ? { ...row.chain } : {};
  if (!String(chain.completedSettlementTxid || '').trim() && String(row.status || '').trim() === 'COMPLETED') {
    chain.completedSettlementTxid = String(chain.settleTxid || '').trim();
  }
  if (!String(chain.refundSettlementTxid || '').trim() && String(row.status || '').trim() === 'REFUNDED') {
    chain.refundSettlementTxid = String(chain.settleTxid || '').trim();
  }
  return {
    ...row,
    id: String(row.id || row.orderId || '').trim(),
    status: String(row.status || '').trim(),
    snapshot: row.snapshot && typeof row.snapshot === 'object' ? { ...row.snapshot } : {},
    funds,
    chain,
    transitionIds: Array.isArray(row.transitionIds) ? row.transitionIds.slice(0, 200) : [],
    tip: String(row.tip || '').trim(),
    updatedAt: String(row.updatedAt || nowIso()),
    lastEventSeq: Math.max(0, Number(row.lastEventSeq || 0)),
  };
}

async function loadProjectionState() {
  const rows = await marketDb.listOrderProjection();
  const orderMap = new Map();
  rows.forEach((row) => {
    const order = normalizeOrder(row);
    if (!order.id) return;
    orderMap.set(order.id, order);
  });
  return { orderMap };
}

async function catchUpProjection() {
  appendOrderTrace('catchup_profile', {
    consumerName: ORDER_CONSUMER,
    mode: 'projection_direct',
    fromSeq: 0,
    toSeq: 0,
    eventCount: 0,
    orderEventCount: 0,
    getConsumerMs: 0,
    listEventsMs: 0,
    writeProjectionMs: 0,
    commitConsumerMs: 0,
    totalMs: 0,
  });
  return { applied: 0, lastSeq: 0 };
}

async function emitOrderUpsert(order, meta = {}) {
  const normalized = normalizeOrder(order);
  if (!normalized.id) throw new Error('order id is required');
  await messageQueue.publish('order.updated', normalized, {
    mode: messageQueue.MODE_TRANSIENT,
    source: String(meta.producer || 'order_domain'),
  });
  appendOrderTrace('projection_direct_update', {
    orderId: normalized.id,
    producer: String(meta.producer || 'order_domain'),
  });
  await marketDb.applyOrderProjectionBatch({
    orders: [normalized],
  });
  return normalized;
}

async function resetOrdersProjection() {
  appendOrderTrace('projection_reset', {
    consumerName: ORDER_CONSUMER,
  });
  await marketDb.applyOrderProjectionBatch({
    orders: [],
    resetAll: true,
  });
  return true;
}

async function listOrders() {
  await catchUpProjection();
  return marketDb.listOrderProjection();
}

function listOrdersSync() {
  const db = marketDb.openReadDb();
  try {
    return db.prepare(`
      SELECT payload_json
      FROM order_projection
      ORDER BY updated_at DESC, order_id ASC
    `).all().map((row) => {
      try {
        return normalizeOrder(JSON.parse(String(row.payload_json || '{}')));
      } catch (_) {
        return null;
      }
    }).filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    db.close();
  }
}

function getOrderByIdSync(orderId) {
  const wanted = String(orderId || '').trim();
  if (!wanted) return null;
  return listOrdersSync().find((row) => row.id === wanted) || null;
}

module.exports = {
  ORDER_CONSUMER,
  catchUpProjection,
  emitOrderUpsert,
  resetOrdersProjection,
  listOrders,
  listOrdersSync,
  getOrderByIdSync,
};
