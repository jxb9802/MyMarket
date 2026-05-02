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
    const row = db.prepare(`
      SELECT rawtx_hex
      FROM tx_contexts
      WHERE txid = ?
      LIMIT 1
    `).get(txid);
    return String(row?.rawtx_hex || '').trim();
  } finally {
    db.close();
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

async function main() {
  const txid = String(process.argv[2] || DEFAULT_TXID).trim().toLowerCase();
  const walletId = String(process.argv[3] || 'wallet-m53cada73f2').trim();
  const sourceDb = path.resolve(process.argv[4] || path.join(__dirname, '..', 'data', 'market.db'));
  if (!/^[0-9a-f]{64}$/i.test(txid)) throw new Error(`invalid txid: ${txid}`);
  if (!walletId) throw new Error('walletId is required');

  const rawtx = readRawtxFromDb(txid, sourceDb);
  if (!/^[0-9a-f]+$/i.test(rawtx) || rawtx.length % 2 !== 0) {
    throw new Error(`rawtx not found for ${txid} in ${sourceDb}`);
  }

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-listener-probe-'));
  const tmpData = path.join(tmpRoot, 'data');
  const tmpLog = path.join(tmpRoot, 'log');
  fs.mkdirSync(tmpData, { recursive: true });
  fs.mkdirSync(tmpLog, { recursive: true });

  const firstAddress = String(process.env.PROBE_WATCH_ADDRESS || '1BoatSLRHtKNngkdXEeobR76b53LETtpyT').trim();
  fs.writeFileSync(path.join(tmpData, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    walletId,
    addresses: [{ index: 0, address: firstAddress, balance: 0 }],
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

  const bsv = require('bsv');
  const wallet = require('../wallet');
  const server = require('../server_market');
  const protocol = require('../order_protocol_v3');

  const tx = new bsv.Transaction(rawtx);
  const outputRows = [];
  for (let vout = 0; vout < tx.outputs.length; vout += 1) {
    const output = tx.outputs[vout];
    const parsed = server.parseAnchorFromOutput(output)?.parsed || null;
    const eventType = String(parsed?.eventType || '').trim();
    const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : null;
    const row = {
      vout,
      satoshis: Number(output?.satoshis || 0),
      scriptBytes: Math.floor(String(output?.script?.toHex?.() || '').length / 2),
      eventType,
      hasPayload: Boolean(payload),
      payloadKeys: payload ? Object.keys(payload).sort() : [],
      buyerWalletId: String(payload?.bw || payload?.buyerWalletId || '').trim(),
      sellerWalletId: String(payload?.sw || payload?.sellerWalletId || '').trim(),
      protocolVersion: Number(payload?.v || payload?.orderProtocolVersion || 0),
      validatePlacePayload: null,
    };
    if (eventType === 'order_place' && payload) {
      try {
        protocol.validatePlacePayload(payload);
        row.validatePlacePayload = true;
      } catch (err) {
        row.validatePlacePayload = String(err?.message || err || 'validation failed');
      }
    }
    outputRows.push(row);
  }

  const mentionsCurrentWalletId = wallet._test.transactionMentionsCurrentWalletId(rawtx);
  const touchesWallet = wallet.transactionTouchesWallet(rawtx);
  const appliedUnconfirmed = wallet._test.applyTxToSpvIndex(rawtx, {
    confirmed: false,
    trackOutputs: true,
    firstSeenHeight: 0,
    localHeight: 0,
  });

  await new Promise((resolve) => setTimeout(resolve, 250));
  let txContext = null;
  try {
    txContext = await wallet.getTxContextByTxid(txid);
  } catch (err) {
    txContext = { error: String(err?.message || err || 'get tx context failed') };
  }

  console.log(JSON.stringify({
    txid,
    rawtxBytes: Math.floor(rawtx.length / 2),
    walletId,
    tmpData,
    txParsed: {
      id: String(tx.id || '').trim(),
      inputCount: tx.inputs.length,
      outputCount: tx.outputs.length,
    },
    listenerRelevantChecks: {
      touchesWallet,
      mentionsCurrentWalletId,
      applyTxToSpvIndexReturned: appliedUnconfirmed,
      expectedListenerHitCountIncrement: appliedUnconfirmed ? 1 : 0,
      expectedTxContextSaved: Boolean(mentionsCurrentWalletId || touchesWallet),
    },
    txContextAfterApply: txContext ? {
      txid: String(txContext.txid || ''),
      kind: String(txContext.kind || ''),
      confirmed: txContext.confirmed === true || txContext.confirmed === 1,
      rawtxBytes: Math.floor(String(txContext.rawtx || txContext.rawtx_hex || '').length / 2),
      source: String(txContext.source || ''),
    } : null,
    outputs: outputRows,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ success: false, error: String(err?.stack || err?.message || err) }, null, 2));
  process.exit(1);
});
