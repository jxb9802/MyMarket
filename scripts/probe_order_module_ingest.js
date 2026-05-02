#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_TXID = '40ccb951dacea802a6256d7b2e431ac75cb15143c1f43df90ccdbe2b9cdfb17d';

function readRawtxFromDb(txid, dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT rawtx_hex FROM tx_contexts WHERE txid = ? LIMIT 1').get(txid);
    return String(row?.rawtx_hex || '').trim();
  } finally {
    db.close();
  }
}

function listOrders(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT order_id, status, payload_json
      FROM order_projection
      ORDER BY updated_at DESC
    `).all().map((row) => {
      let payload = {};
      try { payload = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
      return {
        orderId: String(row.order_id || ''),
        status: String(row.status || ''),
        buyerWalletId: String(payload.buyerWalletId || ''),
        sellerWalletId: String(payload.sellerWalletId || ''),
        placeTxid: String(payload?.chain?.placeTxid || ''),
        buyerLockSats: Number(payload?.chain?.buyerLockSats || 0),
        buyerLockRedeemScriptHexBytes: Math.floor(String(payload?.chain?.buyerLockRedeemScriptHex || '').length / 2),
      };
    });
  } finally {
    db.close();
  }
}

function listAnchors(dbPath, txid) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT txid, event_type, confirmed, source_node, payload_json
      FROM anchor_events
      WHERE txid = ? OR payload_json LIKE ?
      ORDER BY event_id DESC
    `).all(txid, `%${txid}%`).map((row) => {
      let payload = {};
      try { payload = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
      return {
        txid: String(row.txid || ''),
        eventType: String(row.event_type || ''),
        confirmed: row.confirmed === 1,
        sourceNode: String(row.source_node || ''),
        buyerWalletId: String(payload.bw || payload.buyerWalletId || ''),
        sellerWalletId: String(payload.sw || payload.sellerWalletId || ''),
      };
    });
  } finally {
    db.close();
  }
}

async function main() {
  const txid = String(process.argv[2] || DEFAULT_TXID).trim().toLowerCase();
  const sourceDb = path.resolve(process.argv[3] || path.join(__dirname, '..', 'data', 'market.db'));
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-order-module-probe-'));
  const tmpData = path.join(tmpRoot, 'data');
  const tmpLog = path.join(tmpRoot, 'log');
  fs.mkdirSync(tmpData, { recursive: true });
  fs.mkdirSync(tmpLog, { recursive: true });

  process.env.BSV_MARKET_DATA_DIR = tmpData;
  process.env.BSV_MARKET_DB_DIR = tmpData;
  process.env.BSV_MARKET_LOG_DIR = tmpLog;
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';
  process.env.BSV_MARKET_DB_TIMEOUT_MS = '15000';
  process.env.BSV_MARKET_DB_RESTART_DELAY_MS = '100';

  const bsv = require('bsv');
  const marketDb = require('../market_db');
  const server = require('../server_market');
  await marketDb.initSchema();

  const rawtx = readRawtxFromDb(txid, sourceDb);
  if (!/^[0-9a-f]+$/i.test(rawtx) || rawtx.length % 2 !== 0) {
    throw new Error(`rawtx not found for ${txid} in ${sourceDb}`);
  }

  const tx = new bsv.Transaction(rawtx);
  const rows = [];
  const parseResults = [];
  for (let vout = 0; vout < tx.outputs.length; vout += 1) {
    const parsed = server.parseAnchorFromOutput(tx.outputs[vout])?.parsed || null;
    const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : null;
    parseResults.push({
      vout,
      eventType: String(parsed?.eventType || ''),
      hasPayload: Boolean(payload),
      buyerWalletId: String(payload?.bw || payload?.buyerWalletId || ''),
      sellerWalletId: String(payload?.sw || payload?.sellerWalletId || ''),
    });
    if (String(parsed?.eventType || '') === 'order_place' && payload) {
      rows.push({
        ts: new Date().toISOString(),
        eventType: 'order_place',
        payload,
        txid,
        rawtx,
        node: 'probe_listener',
        height: 0,
        confirmed: false,
      });
    }
  }

  const forceSqliteReq = { session: { walletPassword: 'probe' } };
  let state = server.buildProjectionBackedState(forceSqliteReq);
  const addedPending = server.mergeRowsIntoStateAnchors(state, rows);
  const pendingState = {
    ...state,
    orders: [],
  };
  server.mergeRowsIntoStateAnchors(pendingState, rows);
  const rebuiltFromPending = server.buildProjectionBackedState(forceSqliteReq);
  await new Promise((resolve) => setTimeout(resolve, 500));

  const anchorEvents = rows.map((row) => ({
    txid: row.txid,
    blockHeight: 0,
    blockHash: '',
    eventIndex: 0,
    eventType: row.eventType,
    merchantId: String(row.payload?.sm || ''),
    entityId: String(row.payload?.pid || ''),
    walletId: String(row.payload?.sw || ''),
    ts: row.ts,
    confirmed: false,
    sourceNode: row.node,
    payload: row.payload,
    dedupeKey: `${row.txid}|${row.eventType}`,
  }));
  await marketDb.upsertAnchorEvents(anchorEvents);
  await new Promise((resolve) => setTimeout(resolve, 500));
  state = server.buildProjectionBackedState(forceSqliteReq);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(JSON.stringify({
    txid,
    tmpData,
    rawtxBytes: Math.floor(rawtx.length / 2),
    parseResults,
    extractedOrderRows: rows.length,
    pendingOverlayPath: {
      addedPending,
      orders: (rebuiltFromPending.orders || []).map((order) => ({
        id: order.id,
        status: order.status,
        buyerWalletId: order.buyerWalletId,
        sellerWalletId: order.sellerWalletId,
        placeTxid: order.chain?.placeTxid,
      })),
    },
    sqlitePath: {
      anchors: listAnchors(marketDb.getDbFilePath(), txid),
      stateOrders: (state.orders || []).map((order) => ({
        id: order.id,
        status: order.status,
        buyerWalletId: order.buyerWalletId,
        sellerWalletId: order.sellerWalletId,
        placeTxid: order.chain?.placeTxid,
      })),
      projectionOrders: listOrders(marketDb.getDbFilePath()),
    },
  }, null, 2));

  if (typeof marketDb.stopWriterService === 'function') {
    await marketDb.stopWriterService();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ success: false, error: String(err?.stack || err?.message || err) }, null, 2));
  process.exit(1);
});
