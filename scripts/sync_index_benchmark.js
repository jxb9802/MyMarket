#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { performance } = require('perf_hooks');
const { DatabaseSync } = require('node:sqlite');
const axios = require('axios');
const bsv = require('bsv');
const bsvSdk = require('@bsv/sdk');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.BSV_MARKET_DATA_DIR
  ? path.resolve(process.env.BSV_MARKET_DATA_DIR)
  : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'market.db');
const BHS_FILE = path.join(DATA_DIR, 'bhs_state.json');
const SPOOL_FILE = path.join(DATA_DIR, 'chain_spool.ndjson');
const OUT_DIR = path.join(DATA_DIR, 'bootstrap_index');
const CHAIN_MARKER = 'BMMKT2';
const CHAIN_PREFIX = `${CHAIN_MARKER}|`;
const WOC_BASE = process.env.WOC_BASE || 'https://api.whatsonchain.com/v1/bsv/main';

function usage() {
  console.log(`Usage:
  node scripts/sync_index_benchmark.js build-index [--from 947110] [--to latest] [--out file.json] [--gzip]
  node scripts/sync_index_benchmark.js backfill-index --index file.json[.gz] [--out file.json.gz] [--limit 0]
  node scripts/sync_index_benchmark.js replay-index --index file.json[.gz]
  node scripts/sync_index_benchmark.js sample-full-blocks [--from 947110] [--to latest] [--sample 50] [--out file.json]
  node scripts/sync_index_benchmark.js report [--index file.json[.gz]] [--sample file.json]

Notes:
  build-index reads anchor_events, tx_contexts, chain_spool.ndjson and bhs_state.json.
  backfill-index fetches missing rawtx and TSC merkle proofs from Whatsonchain.
  replay-index validates local BHS block hashes, rawtx txids when rawtx exists, and BMMKT2 marker presence.
  sample-full-blocks uses Whatsonchain block metadata to estimate full-block download size.`);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === 'gzip' || key === 'json') {
      out[key] = true;
      continue;
    }
    out[key] = argv[i + 1];
    i += 1;
  }
  return out;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

function parseHeight(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

function loadJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function loadBhs() {
  const raw = loadJson(BHS_FILE, {});
  const headers = raw?.headers && typeof raw.headers === 'object' ? raw.headers : {};
  const tipHeight = parseHeight(raw?.tip?.height || raw?.tipHeight || 0, 0);
  const tipHash = String(raw?.tip?.hash || raw?.tipHash || '').trim().toLowerCase();
  return { raw, headers, tipHeight, tipHash };
}

function headerHashAt(bhs, height) {
  return String(bhs?.headers?.[String(height)]?.hash || '').trim().toLowerCase();
}

function parseChainText(text) {
  const raw = String(text || '').trim();
  if (!raw.startsWith(CHAIN_PREFIX)) return null;
  const secondBar = raw.indexOf('|', CHAIN_PREFIX.length);
  if (secondBar < 0) return null;
  const eventType = raw.slice(CHAIN_PREFIX.length, secondBar).trim();
  const payloadText = raw.slice(secondBar + 1).trim();
  let payload = null;
  try {
    payload = JSON.parse(payloadText);
  } catch (_) {
    payload = { raw: payloadText };
  }
  return { eventType, payload, payloadText, text: raw };
}

function rawtxTxid(rawtx) {
  const hex = String(rawtx || '').trim().toLowerCase();
  if (!hex) return '';
  try {
    return String(new bsv.Transaction(hex).id || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function markerHexFor(eventType) {
  return Buffer.from(`${CHAIN_PREFIX}${String(eventType || '').trim()}|`, 'utf8').toString('hex').toLowerCase();
}

function openDb() {
  return new DatabaseSync(DB_FILE, { readOnly: true });
}

function loadTxContexts(db) {
  const map = new Map();
  try {
    const rows = db.prepare(`
      SELECT
        txid,
        rawtx_hex,
        proof_type,
        proof_source,
        proof_hex,
        proof_encoding,
        proof_verified,
        proof_block_height,
        proof_block_hash,
        proof_merkle_root,
        updated_at
      FROM tx_contexts
    `).all();
    for (const row of rows) {
      const txid = String(row.txid || '').trim().toLowerCase();
      if (/^[0-9a-f]{64}$/.test(txid)) map.set(txid, row);
    }
  } catch (_) {}
  return map;
}

function loadAnchorEvents(db, fromHeight, toHeight) {
  try {
    return db.prepare(`
      SELECT
        txid,
        block_height,
        block_hash,
        event_index,
        event_type,
        merchant_id,
        entity_id,
        wallet_id,
        payload_json,
        payload_hash,
        confirmed,
        source_node,
        ts,
        inserted_at
      FROM anchor_events
      WHERE txid <> ''
        AND block_height >= ?
        AND block_height <= ?
      ORDER BY block_height ASC, event_index ASC, txid ASC
    `).all(fromHeight, toHeight);
  } catch (_) {
    return [];
  }
}

function loadSpoolEvents(fromHeight, toHeight, bhs) {
  if (!fs.existsSync(SPOOL_FILE)) return [];
  const out = [];
  const text = fs.readFileSync(SPOOL_FILE, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let row = null;
    try { row = JSON.parse(line); } catch (_) { continue; }
    const height = parseHeight(row.height || row.blockHeight || 0, 0);
    if (height < fromHeight || height > toHeight) continue;
    const txid = String(row.txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(txid)) continue;
    const parsed = parseChainText(row.text || '');
    if (!parsed) continue;
    out.push({
      txid,
      block_height: height,
      block_hash: headerHashAt(bhs, height),
      event_index: Number(row.outputIndex || 0),
      event_type: parsed.eventType,
      merchant_id: '',
      entity_id: '',
      wallet_id: '',
      payload_json: JSON.stringify(parsed.payload),
      payload_hash: '',
      confirmed: 1,
      source_node: String(row.node || ''),
      ts: String(row.ts || ''),
      inserted_at: String(row.ts || ''),
      chain_text: parsed.text,
      source_kind: 'chain_spool',
    });
  }
  return out;
}

function indexRowFromEvent(row, txContexts, bhs) {
  const txid = String(row.txid || '').trim().toLowerCase();
  const height = parseHeight(row.block_height, 0);
  const eventType = String(row.event_type || '').trim();
  let payload = null;
  try { payload = JSON.parse(String(row.payload_json || '{}')); } catch (_) { payload = {}; }
  const payloadCanonical = canonicalize(payload);
  const ctx = txContexts.get(txid) || {};
  const rawtx = String(ctx.rawtx_hex || '').trim().toLowerCase();
  const rawtxHash = rawtx ? sha256Hex(Buffer.from(rawtx, 'hex')) : '';
  const computedTxid = rawtx ? rawtxTxid(rawtx) : '';
  const blockHash = String(row.block_hash || headerHashAt(bhs, height) || '').trim().toLowerCase();
  return {
    height,
    blockHash,
    txid,
    txIndex: Math.max(0, Number(row.event_index || 0)),
    eventType,
    entityId: String(row.entity_id || ''),
    merchantId: String(row.merchant_id || ''),
    walletId: String(row.wallet_id || ''),
    payloadHash: String(row.payload_hash || '') || sha256Hex(payloadCanonical),
    rawtxHash,
    hasRawtx: Boolean(rawtx),
    rawtx: rawtx || undefined,
    rawtxTxidMatched: rawtx ? computedTxid === txid : false,
    proofType: String(ctx.proof_type || ''),
    proofHex: String(ctx.proof_hex || '').trim().toLowerCase(),
    proofEncoding: String(ctx.proof_encoding || ''),
    proofVerified: Number(ctx.proof_verified || 0) === 1,
    proofBlockHeight: parseHeight(ctx.proof_block_height, 0),
    proofBlockHash: String(ctx.proof_block_hash || '').trim().toLowerCase(),
    proofMerkleRoot: String(ctx.proof_merkle_root || '').trim().toLowerCase(),
    source: String(row.source_kind || 'anchor_events'),
    sourceNode: String(row.source_node || ''),
    firstSeenAt: String(row.ts || row.inserted_at || ''),
    updatedAt: String(ctx.updated_at || row.inserted_at || row.ts || ''),
  };
}

function summarizeIndex(entries, fromHeight, toHeight, bhs = null) {
  const blocks = new Set(entries.map((row) => row.height).filter(Boolean));
  const txids = new Set(entries.map((row) => row.txid).filter(Boolean));
  const rawtxBytes = entries.reduce((sum, row) => sum + (row.rawtx ? row.rawtx.length / 2 : 0), 0);
  const proofCount = entries.filter((row) => row.proofHex).length;
  const rawtxCount = entries.filter((row) => row.rawtx).length;
  const eventTypes = {};
  for (const row of entries) eventTypes[row.eventType] = (eventTypes[row.eventType] || 0) + 1;
  const totalBlocks = Math.max(0, toHeight - fromHeight + 1);
  return {
    network: 'mainnet',
    marker: CHAIN_MARKER,
    fromHeight,
    toHeight,
    tipHash: bhs ? headerHashAt(bhs, toHeight) || bhs.tipHash || '' : '',
    totalBlocks,
    relevantBlockCount: blocks.size,
    relevantBlockRatio: totalBlocks > 0 ? Number((blocks.size / totalBlocks).toFixed(6)) : 0,
    eventCount: entries.length,
    txCount: txids.size,
    rawtxCount,
    missingRawtxCount: entries.length - rawtxCount,
    proofCount,
    missingProofCount: entries.length - proofCount,
    rawtxBytes,
    rawtxMb: Number((rawtxBytes / 1024 / 1024).toFixed(4)),
    eventTypes,
  };
}

function writeIndexFile(payload, outFile, gzip) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const json = JSON.stringify(payload, null, 2);
  if (gzip || outFile.endsWith('.gz')) {
    fs.writeFileSync(outFile.endsWith('.gz') ? outFile : `${outFile}.gz`, zlib.gzipSync(json));
    return outFile.endsWith('.gz') ? outFile : `${outFile}.gz`;
  }
  fs.writeFileSync(outFile, json);
  return outFile;
}

function readIndexFile(file) {
  const buf = fs.readFileSync(file);
  const text = file.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return JSON.parse(text);
}

async function wocGet(pathname, options = {}) {
  const attempts = Math.max(1, Number(options.attempts || 5));
  const timeout = Math.max(1000, Number(options.timeoutMs || 15000));
  const url = `${WOC_BASE}${pathname}`;
  let lastErr = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await axios.get(url, { timeout });
      return res?.data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status || 0;
      if (status === 404) return null;
      if (i < attempts - 1 && (status === 429 || status === 503 || status === 504 || !status)) {
        await sleep(Math.min(5000, 350 * (2 ** i)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error(`WOC request failed: ${url}`);
}

async function wocGetRawtx(txid) {
  const data = await wocGet(`/tx/${txid}/hex`);
  const hex = String(data || '').trim().toLowerCase();
  return /^[0-9a-f]+$/.test(hex) ? hex : '';
}

async function wocGetTxInfo(txid) {
  const data = await wocGet(`/tx/hash/${txid}`);
  return data && typeof data === 'object' ? data : null;
}

async function wocGetTscProof(txid) {
  const data = await wocGet(`/tx/${txid}/proof/tsc`);
  return Array.isArray(data) ? data : [];
}

async function wocGetBlockHeaderByHeight(height) {
  const data = await wocGet(`/block/${height}/header`);
  return data && typeof data === 'object' ? data : null;
}

function normalizeTscNode(node) {
  if (node == null || node === '*' || node === 'duplicate') return { duplicate: true };
  if (typeof node === 'string') return { hash: String(node).trim().toLowerCase() };
  if (typeof node === 'object') {
    if (node.duplicate === true) return { duplicate: true };
    const hash = String(node.hash || node.txOrId || '').trim().toLowerCase();
    if (hash) return { hash };
  }
  return { hash: '' };
}

function merklePathFromTscProof(txid, blockHeight, proofRows) {
  const MerklePath = bsvSdk?.MerklePath || bsvSdk?.default?.MerklePath;
  if (!MerklePath) return null;
  const safeTxid = String(txid || '').trim().toLowerCase();
  const rows = Array.isArray(proofRows) ? proofRows : [];
  const row = rows.find((item) => String(item?.txOrId || '').trim().toLowerCase() === safeTxid) || rows[0];
  if (!row || !Number.isFinite(Number(row.index))) return null;
  const index = Number(row.index);
  const nodes = Array.isArray(row.nodes) ? row.nodes : [];
  const pathRows = [];
  if (!nodes.length) {
    pathRows.push([{ offset: index, txid: true, hash: safeTxid }]);
    return new MerklePath(Number(blockHeight), pathRows);
  }
  const level0 = [{ offset: index, txid: true, hash: safeTxid }];
  const node0 = normalizeTscNode(nodes[0]);
  const siblingOffset0 = index ^ 1;
  level0.push(node0.duplicate === true
    ? { offset: siblingOffset0, duplicate: true }
    : { offset: siblingOffset0, hash: node0.hash });
  level0.sort((a, b) => a.offset - b.offset);
  pathRows.push(level0);
  for (let i = 1; i < nodes.length; i += 1) {
    const node = normalizeTscNode(nodes[i]);
    const offset = (index >> i) ^ 1;
    pathRows.push([node.duplicate === true ? { offset, duplicate: true } : { offset, hash: node.hash }]);
  }
  return new MerklePath(Number(blockHeight), pathRows);
}

async function fetchVerifiedProof(txid, bhs) {
  const txInfo = await wocGetTxInfo(txid);
  const blockHeight = parseHeight(txInfo?.blockheight, 0);
  const blockHash = String(txInfo?.blockhash || '').trim().toLowerCase();
  if (!blockHeight || !/^[0-9a-f]{64}$/.test(blockHash)) return null;
  const bhsHash = headerHashAt(bhs, blockHeight);
  if (bhsHash && bhsHash !== blockHash) {
    throw new Error(`BHS block hash mismatch at ${blockHeight}: ${bhsHash} != ${blockHash}`);
  }
  const proofRows = await wocGetTscProof(txid);
  if (!proofRows.length) return null;
  const merklePath = merklePathFromTscProof(txid, blockHeight, proofRows);
  if (!merklePath) return null;
  const header = await wocGetBlockHeaderByHeight(blockHeight);
  const merkleRoot = String(header?.merkleroot || '').trim().toLowerCase();
  const computedRoot = String(merklePath.computeRoot(txid) || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(merkleRoot) || computedRoot !== merkleRoot) {
    throw new Error(`Merkle root mismatch for ${txid}: ${computedRoot} != ${merkleRoot}`);
  }
  return {
    proofType: 'merkle-path-tsc',
    proofSource: 'woc-tsc',
    proofHex: merklePath.toHex(),
    proofEncoding: 'bump',
    proofVerified: true,
    proofVerifiedAt: new Date().toISOString(),
    proofBlockHeight: blockHeight,
    proofBlockHash: blockHash,
    proofMerkleRoot: merkleRoot,
  };
}

async function buildIndex(args) {
  const bhs = loadBhs();
  const fromHeight = parseHeight(args.from, 947110);
  const toHeight = String(args.to || '').toLowerCase() === 'latest' || !args.to
    ? bhs.tipHeight
    : parseHeight(args.to, bhs.tipHeight);
  const db = openDb();
  let entries = [];
  try {
    const txContexts = loadTxContexts(db);
    const anchorRows = loadAnchorEvents(db, fromHeight, toHeight);
    const spoolRows = loadSpoolEvents(fromHeight, toHeight, bhs);
    const byKey = new Map();
    for (const row of [...anchorRows, ...spoolRows]) {
      const txid = String(row.txid || '').trim().toLowerCase();
      const eventType = String(row.event_type || '').trim();
      const key = `${txid}:${eventType}`;
      const prev = byKey.get(key);
      if (!prev || String(prev.source_kind || '') === 'chain_spool') byKey.set(key, row);
    }
    entries = Array.from(byKey.values())
      .map((row) => indexRowFromEvent(row, txContexts, bhs))
      .sort((a, b) => (a.height - b.height) || a.txid.localeCompare(b.txid) || a.eventType.localeCompare(b.eventType));
  } finally {
    db.close();
  }

  const manifest = summarizeIndex(entries, fromHeight, toHeight, bhs);
  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    manifest,
    entries,
  };
  const jsonForHash = JSON.stringify(payload);
  payload.manifest.indexSha256 = sha256Hex(jsonForHash);
  payload.manifest.indexBytes = Buffer.byteLength(JSON.stringify(payload));
  const defaultOut = path.join(OUT_DIR, `bmmkt2-index-mainnet-${toHeight}.json`);
  const outFile = path.resolve(args.out || defaultOut);
  const written = writeIndexFile(payload, outFile, Boolean(args.gzip));
  const manifestFile = written.replace(/\.json(?:\.gz)?$/, '.manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(payload.manifest, null, 2));
  console.log(JSON.stringify({ ok: true, index: written, manifest: manifestFile, ...payload.manifest }, null, 2));
}

async function replayIndex(args) {
  if (!args.index) throw new Error('--index is required');
  const bhs = loadBhs();
  const started = performance.now();
  const payload = readIndexFile(path.resolve(args.index));
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const result = {
    index: path.resolve(args.index),
    entries: entries.length,
    validBlockHash: 0,
    missingLocalHeader: 0,
    invalidBlockHash: 0,
    rawtxChecked: 0,
    rawtxTxidOk: 0,
    rawtxMarkerOk: 0,
    rawtxFailures: [],
    proofPresent: 0,
    proofVerifiedFlag: 0,
    elapsedMs: 0,
  };
  for (const row of entries) {
    const height = parseHeight(row.height, 0);
    const localHash = headerHashAt(bhs, height);
    if (!localHash) result.missingLocalHeader += 1;
    else if (localHash === String(row.blockHash || '').trim().toLowerCase()) result.validBlockHash += 1;
    else result.invalidBlockHash += 1;

    if (row.proofHex) result.proofPresent += 1;
    if (row.proofVerified === true) result.proofVerifiedFlag += 1;

    const rawtx = String(row.rawtx || '').trim().toLowerCase();
    if (!rawtx) continue;
    result.rawtxChecked += 1;
    const txid = rawtxTxid(rawtx);
    if (txid === String(row.txid || '').trim().toLowerCase()) result.rawtxTxidOk += 1;
    else result.rawtxFailures.push({ txid: row.txid, reason: 'txid_mismatch' });
    if (rawtx.includes(markerHexFor(row.eventType))) result.rawtxMarkerOk += 1;
    else result.rawtxFailures.push({ txid: row.txid, reason: 'marker_missing', eventType: row.eventType });
  }
  result.elapsedMs = Number((performance.now() - started).toFixed(3));
  result.estimatedApplyRatePerSec = result.elapsedMs > 0 ? Math.round((entries.length / result.elapsedMs) * 1000) : 0;
  console.log(JSON.stringify({ ok: result.invalidBlockHash === 0 && result.rawtxFailures.length === 0, ...result }, null, 2));
}

async function backfillIndex(args) {
  if (!args.index) throw new Error('--index is required');
  const bhs = loadBhs();
  const inputFile = path.resolve(args.index);
  const payload = readIndexFile(inputFile);
  const entries = Array.isArray(payload.entries) ? payload.entries : [];
  const limit = Math.max(0, Number(args.limit || 0));
  const delayMs = Math.max(0, Number(args.delayMs || 120));
  const started = performance.now();
  const stats = {
    entries: entries.length,
    rawtxFetched: 0,
    rawtxAlreadyPresent: 0,
    rawtxFailed: 0,
    proofFetched: 0,
    proofAlreadyPresent: 0,
    proofFailed: 0,
    skippedByLimit: 0,
    errors: [],
  };
  let touched = 0;
  for (const row of entries) {
    if (limit > 0 && touched >= limit) {
      stats.skippedByLimit += 1;
      continue;
    }
    const txid = String(row.txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(txid)) continue;
    let changed = false;
    try {
      if (String(row.rawtx || '').trim()) {
        stats.rawtxAlreadyPresent += 1;
      } else {
        const rawtx = await wocGetRawtx(txid);
        if (!rawtx) throw new Error('rawtx not found');
        const computed = rawtxTxid(rawtx);
        if (computed !== txid) throw new Error(`rawtx txid mismatch: ${computed}`);
        row.rawtx = rawtx;
        row.hasRawtx = true;
        row.rawtxHash = sha256Hex(Buffer.from(rawtx, 'hex'));
        row.rawtxTxidMatched = true;
        stats.rawtxFetched += 1;
        changed = true;
        await sleep(delayMs);
      }
    } catch (err) {
      stats.rawtxFailed += 1;
      stats.errors.push({ txid, stage: 'rawtx', error: String(err?.message || err || 'rawtx failed') });
    }

    try {
      if (String(row.proofHex || '').trim()) {
        stats.proofAlreadyPresent += 1;
      } else {
        const proof = await fetchVerifiedProof(txid, bhs);
        if (!proof) throw new Error('proof not found or not confirmed');
        Object.assign(row, proof);
        stats.proofFetched += 1;
        changed = true;
        await sleep(delayMs);
      }
    } catch (err) {
      stats.proofFailed += 1;
      stats.errors.push({ txid, stage: 'proof', error: String(err?.message || err || 'proof failed') });
    }
    if (changed) touched += 1;
  }
  const fromHeight = parseHeight(payload?.manifest?.fromHeight, entries[0]?.height || 0);
  const toHeight = parseHeight(payload?.manifest?.toHeight, entries[entries.length - 1]?.height || bhs.tipHeight);
  payload.manifest = {
    ...summarizeIndex(entries, fromHeight, toHeight, bhs),
    indexSourceFile: inputFile,
    backfilledAt: new Date().toISOString(),
  };
  const jsonForHash = JSON.stringify(payload);
  payload.manifest.indexSha256 = sha256Hex(jsonForHash);
  payload.manifest.indexBytes = Buffer.byteLength(JSON.stringify(payload));
  const defaultOut = inputFile.replace(/\.json(?:\.gz)?$/, '.backfilled.json.gz');
  const outFile = path.resolve(args.out || defaultOut);
  const written = writeIndexFile(payload, outFile, true);
  const manifestFile = written.replace(/\.json(?:\.gz)?$/, '.manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(payload.manifest, null, 2));
  stats.elapsedMs = Number((performance.now() - started).toFixed(3));
  console.log(JSON.stringify({
    ok: stats.rawtxFailed === 0 && stats.proofFailed === 0,
    index: written,
    manifest: manifestFile,
    ...payload.manifest,
    backfill: {
      ...stats,
      errors: stats.errors.slice(0, 20),
      errorCount: stats.errors.length,
    },
  }, null, 2));
}

function chooseSampleHeights(fromHeight, toHeight, sampleSize) {
  const total = Math.max(0, toHeight - fromHeight + 1);
  if (total <= 0) return [];
  const n = Math.max(1, Math.min(sampleSize, total));
  if (n === total) return Array.from({ length: total }, (_, i) => fromHeight + i);
  const out = new Set([fromHeight, toHeight]);
  for (let i = 1; out.size < n && i <= n * 3; i += 1) {
    const h = fromHeight + Math.floor((i * (total - 1)) / Math.max(1, n - 1));
    out.add(h);
  }
  return Array.from(out).sort((a, b) => a - b).slice(0, n);
}

async function fetchBlockMetaByHeight(height) {
  const url = `${WOC_BASE}/block/height/${height}`;
  const { data } = await axios.get(url, { timeout: 15000 });
  return {
    height: parseHeight(data?.height, height),
    hash: String(data?.hash || '').trim().toLowerCase(),
    size: Math.max(0, Number(data?.size || 0)),
    txCount: Math.max(0, Number(data?.txcount || data?.num_tx || 0)),
  };
}

async function sampleFullBlocks(args) {
  const bhs = loadBhs();
  const fromHeight = parseHeight(args.from, 947110);
  const toHeight = String(args.to || '').toLowerCase() === 'latest' || !args.to
    ? bhs.tipHeight
    : parseHeight(args.to, bhs.tipHeight);
  const sampleSize = Math.max(1, Number(args.sample || 50));
  const heights = chooseSampleHeights(fromHeight, toHeight, sampleSize);
  const rows = [];
  const started = performance.now();
  for (const height of heights) {
    const t0 = performance.now();
    try {
      const meta = await fetchBlockMetaByHeight(height);
      rows.push({ ...meta, ok: true, elapsedMs: Number((performance.now() - t0).toFixed(3)) });
    } catch (err) {
      rows.push({ height, ok: false, error: String(err?.message || err || 'fetch failed'), elapsedMs: Number((performance.now() - t0).toFixed(3)) });
    }
  }
  const okRows = rows.filter((row) => row.ok);
  const avgSize = okRows.length ? okRows.reduce((sum, row) => sum + row.size, 0) / okRows.length : 0;
  const avgTxCount = okRows.length ? okRows.reduce((sum, row) => sum + row.txCount, 0) / okRows.length : 0;
  const avgMetaMs = okRows.length ? okRows.reduce((sum, row) => sum + row.elapsedMs, 0) / okRows.length : 0;
  const totalBlocks = Math.max(0, toHeight - fromHeight + 1);
  const report = {
    createdAt: new Date().toISOString(),
    fromHeight,
    toHeight,
    totalBlocks,
    requestedSampleSize: sampleSize,
    okSampleCount: okRows.length,
    failedSampleCount: rows.length - okRows.length,
    avgBlockSizeBytes: Math.round(avgSize),
    avgTxCount: Math.round(avgTxCount),
    avgMetadataFetchMs: Number(avgMetaMs.toFixed(3)),
    estimatedFullBlockBytes: Math.round(avgSize * totalBlocks),
    estimatedFullBlockMb: Number(((avgSize * totalBlocks) / 1024 / 1024).toFixed(3)),
    elapsedMs: Number((performance.now() - started).toFixed(3)),
    rows,
  };
  const outFile = path.resolve(args.out || path.join(OUT_DIR, `full-block-sample-${fromHeight}-${toHeight}.json`));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, sample: outFile, ...report, rows: undefined }, null, 2));
}

async function report(args) {
  const bhs = loadBhs();
  let indexPayload = null;
  let indexFile = args.index ? path.resolve(args.index) : '';
  if (!indexFile) {
    try {
      const files = fs.existsSync(OUT_DIR)
        ? fs.readdirSync(OUT_DIR)
          .filter((name) => /^bmmkt2-index-mainnet-.*\.json(?:\.gz)?$/.test(name))
          .map((name) => path.join(OUT_DIR, name))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
        : [];
      indexFile = files[0] || '';
    } catch (_) {}
  }
  if (indexFile) indexPayload = readIndexFile(indexFile);
  const entries = Array.isArray(indexPayload?.entries) ? indexPayload.entries : [];
  const manifest = indexPayload?.manifest || {};
  let sample = null;
  if (args.sample) sample = loadJson(path.resolve(args.sample), null);
  const indexBytes = indexFile && fs.existsSync(indexFile) ? fs.statSync(indexFile).size : 0;
  const rawtxBytes = entries.reduce((sum, row) => sum + (row.rawtx ? row.rawtx.length / 2 : 0), 0);
  const proofBytes = entries.reduce((sum, row) => sum + (row.proofHex ? row.proofHex.length / 2 : 0), 0);
  const fromHeight = parseHeight(manifest.fromHeight, 947110);
  const toHeight = parseHeight(manifest.toHeight, bhs.tipHeight);
  const totalBlocks = Math.max(0, toHeight - fromHeight + 1);
  const relevantBlockCount = new Set(entries.map((row) => row.height).filter(Boolean)).size;
  const estimatedFullBlockBytes = Number(sample?.estimatedFullBlockBytes || 0);
  const estimatedSavings = estimatedFullBlockBytes > 0
    ? Math.max(0, estimatedFullBlockBytes - indexBytes)
    : 0;
  const out = {
    index: indexFile || '',
    fromHeight,
    toHeight,
    totalBlocks,
    relevantBlockCount,
    relevantBlockRatio: totalBlocks ? Number((relevantBlockCount / totalBlocks).toFixed(6)) : 0,
    eventCount: entries.length,
    txCount: new Set(entries.map((row) => row.txid).filter(Boolean)).size,
    indexFileBytes: indexBytes,
    indexFileMb: Number((indexBytes / 1024 / 1024).toFixed(4)),
    embeddedRawtxBytes: rawtxBytes,
    embeddedProofBytes: proofBytes,
    missingRawtxCount: entries.filter((row) => !row.rawtx).length,
    missingProofCount: entries.filter((row) => !row.proofHex).length,
    fullBlockSample: sample ? {
      sampleFile: path.resolve(args.sample),
      okSampleCount: sample.okSampleCount,
      avgBlockSizeBytes: sample.avgBlockSizeBytes,
      estimatedFullBlockMb: sample.estimatedFullBlockMb,
      estimatedSavingsMb: Number((estimatedSavings / 1024 / 1024).toFixed(3)),
      estimatedSizeReductionRatio: estimatedFullBlockBytes > 0 ? Number((1 - (indexBytes / estimatedFullBlockBytes)).toFixed(6)) : 0,
    } : null,
    note: sample ? '' : 'Run sample-full-blocks to estimate full-block download MB.',
  };
  console.log(JSON.stringify(out, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || cmd === '--help') {
    usage();
    return;
  }
  if (cmd === 'build-index') return buildIndex(args);
  if (cmd === 'backfill-index') return backfillIndex(args);
  if (cmd === 'replay-index') return replayIndex(args);
  if (cmd === 'sample-full-blocks') return sampleFullBlocks(args);
  if (cmd === 'report') return report(args);
  throw new Error(`Unknown command: ${cmd}`);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err || 'failed') }, null, 2));
  process.exitCode = 1;
});
