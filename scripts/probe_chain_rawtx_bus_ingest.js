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

function listRows(dbPath, table) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (table === 'anchor_events') {
      return db.prepare(`
        SELECT txid, event_type, confirmed, source_node, payload_json
        FROM anchor_events
        ORDER BY event_id DESC
      `).all().map((row) => {
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
    }
    if (table === 'order_projection') {
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
        };
      });
    }
    return [];
  } finally {
    db.close();
  }
}

async function main() {
  const txid = String(process.argv[2] || DEFAULT_TXID).trim().toLowerCase();
  const walletId = String(process.argv[3] || 'wallet-m53cada73f2').trim();
  const sourceDb = path.resolve(process.argv[4] || path.join(__dirname, '..', 'data', 'market.db'));
  const rawtx = readRawtxFromDb(txid, sourceDb);
  if (!/^[0-9a-f]+$/i.test(rawtx) || rawtx.length % 2 !== 0) {
    throw new Error(`rawtx not found for ${txid} in ${sourceDb}`);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-chain-bus-probe-'));
  const tmpData = path.join(tmpRoot, 'data');
  const tmpLog = path.join(tmpRoot, 'log');
  fs.mkdirSync(tmpData, { recursive: true });
  fs.mkdirSync(tmpLog, { recursive: true });
  fs.writeFileSync(path.join(tmpData, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    walletId,
    addresses: [{ index: 0, address: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT', balance: 0 }],
    lastReceiveIndex: 0,
    addressCursor: 1,
    updatedAt: new Date().toISOString(),
    balance: 0,
  }, null, 2));

  process.env.BSV_MARKET_DATA_DIR = tmpData;
  process.env.BSV_MARKET_DB_DIR = tmpData;
  process.env.BSV_MARKET_LOG_DIR = tmpLog;
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';
  process.env.BSV_MARKET_DB_TIMEOUT_MS = '15000';
  process.env.BSV_MARKET_DB_RESTART_DELAY_MS = '100';

  const marketDb = require('../market_db');
  const messageQueue = require('../lib/message_queue');
  require('../server_market');
  await marketDb.initSchema();

  messageQueue.publish('chain.rawtx.seen', {
    txid,
    rawtx,
    confirmed: false,
    node: 'probe_listener',
    walletRelevant: false,
    firstSeenAt: new Date().toISOString(),
  }, {
    mode: messageQueue.MODE_TRANSIENT,
    source: 'probe_chain_rawtx_bus_ingest',
  });

  await new Promise((resolve) => setTimeout(resolve, 1000));
  const dbPath = marketDb.getDbFilePath();
  console.log(JSON.stringify({
    txid,
    walletId,
    tmpData,
    anchors: listRows(dbPath, 'anchor_events'),
    orders: listRows(dbPath, 'order_projection'),
  }, null, 2));
  if (typeof marketDb.stopWriterService === 'function') {
    await marketDb.stopWriterService();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ success: false, error: String(err?.stack || err?.message || err) }, null, 2));
  process.exit(1);
});
