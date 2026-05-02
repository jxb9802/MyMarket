const fs = require('fs');
const path = require('path');
const express = require('express');
const wallet = require('./wallet');
const p2pNodeRuntime = require('./p2p_node_runtime');
const marketDb = require('./market_db');
const {
  BSV_MARKET_RELEASE_BOOTSTRAP_HEIGHT,
  BSV_MARKET_RELEASE_BOOTSTRAP_PREV_HEIGHT,
  BSV_MARKET_RELEASE_BOOTSTRAP_PREV_HASH,
} = require('./protocol_release');

function loadLocalEnvFile() {
  if (process.platform !== 'win32') return;
  const envPath = path.join(__dirname, '.env.market');
  if (!fs.existsSync(envPath)) return;
  try {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const raw of lines) {
      const line = String(raw || '').trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) continue;
      process.env[key] = line.slice(eq + 1).trim();
    }
  } catch (_) {}
}

loadLocalEnvFile();

function requireWithFallback(name) {
  try {
    return require(name);
  } catch (firstErr) {
    const fallbackRoots = [
      path.join(__dirname, 'node_modules'),
      path.join(__dirname, '..', 'node_modules'),
      path.join(__dirname, '..', 'bsv2', 'node_modules'),
    ];
    for (const root of fallbackRoots) {
      try {
        return require(path.join(root, name));
      } catch (_) {}
    }
    throw firstErr;
  }
}

const DATA_DIR = path.join(__dirname, 'data');
const LOG_DIR = path.join(__dirname, 'log');
const STATE_FILE = path.join(DATA_DIR, 'bhs_state.json');
const LOG_FILE = path.join(LOG_DIR, 'bhs.log');
const SPV_NODES_FILE = path.join(__dirname, 'spv_nodes.txt');

const PORT = Math.max(1, Number(process.env.BSV_BHS_PORT || 8092));
const CONNECT_TIMEOUT_MS = Math.max(1000, Number(process.env.BSV_BHS_CONNECT_TIMEOUT_MS || 8000));
const HEADERS_TIMEOUT_MS = Math.max(2000, Number(process.env.BSV_BHS_HEADERS_TIMEOUT_MS || 12000));
const LOOP_INTERVAL_MS = Math.max(1000, Number(process.env.BSV_BHS_LOOP_INTERVAL_MS || 15000));
const IDLE_SLOW_INTERVAL_MS = Math.max(LOOP_INTERVAL_MS, Number(process.env.BSV_BHS_IDLE_SLOW_INTERVAL_MS || 60000));
const IDLE_SLOW_AFTER_ROUNDS = Math.max(1, Number(process.env.BSV_BHS_IDLE_SLOW_AFTER_ROUNDS || 2));
const NODE_CONCURRENCY = Math.max(1, Number(process.env.BSV_BHS_NODE_CONCURRENCY || 4));
const IDLE_NODE_LIMIT = Math.max(1, Number(process.env.BSV_BHS_IDLE_NODE_LIMIT || 4));
const IDLE_PREFERRED_NODE_LIMIT = Math.max(0, Number(process.env.BSV_BHS_IDLE_PREFERRED_NODE_LIMIT || 2));
const DEFAULT_MARKET_BOOTSTRAP_HEIGHT = BSV_MARKET_RELEASE_BOOTSTRAP_HEIGHT;
const ENV_MARKET_BOOTSTRAP_HEIGHT = Number(process.env.BSV_MARKET_BOOTSTRAP_HEIGHT);
const MARKET_BOOTSTRAP_HEIGHT = Math.max(
  0,
  DEFAULT_MARKET_BOOTSTRAP_HEIGHT,
  Number.isFinite(ENV_MARKET_BOOTSTRAP_HEIGHT) ? ENV_MARKET_BOOTSTRAP_HEIGHT : 0,
);
const DEFAULT_BOOTSTRAP_PREV_HEIGHT = Math.max(0, MARKET_BOOTSTRAP_HEIGHT - 1);
const DEFAULT_BOOTSTRAP_PREV_HASH = (
  DEFAULT_BOOTSTRAP_PREV_HEIGHT === BSV_MARKET_RELEASE_BOOTSTRAP_PREV_HEIGHT
    ? BSV_MARKET_RELEASE_BOOTSTRAP_PREV_HASH
    : ''
);
const ENV_BOOTSTRAP_PREV_HASH = String(process.env.BSV_MARKET_BOOTSTRAP_PREV_HASH || '').trim().toLowerCase();
const SHOULD_USE_ENV_BOOTSTRAP_PREV_HASH = (
  Number.isFinite(ENV_MARKET_BOOTSTRAP_HEIGHT)
  && Number(ENV_MARKET_BOOTSTRAP_HEIGHT) === MARKET_BOOTSTRAP_HEIGHT
  && MARKET_BOOTSTRAP_HEIGHT !== BSV_MARKET_RELEASE_BOOTSTRAP_HEIGHT
);
const CHECKPOINT_HEIGHT = DEFAULT_BOOTSTRAP_PREV_HEIGHT;
const CHECKPOINT_HASH = String(
  (SHOULD_USE_ENV_BOOTSTRAP_PREV_HASH ? ENV_BOOTSTRAP_PREV_HASH : '')
  || DEFAULT_BOOTSTRAP_PREV_HASH
).trim().toLowerCase();
const HAS_VALID_CHECKPOINT_HASH = /^[0-9a-f]{64}$/i.test(CHECKPOINT_HASH);
const MAX_HEADERS_PER_ROUND = Math.max(2000, Number(process.env.BSV_BHS_MAX_HEADERS_PER_ROUND || 12000));
const RECOVERY_MAX_ROLLBACK = Math.max(8, Number(process.env.BSV_BHS_RECOVERY_MAX_ROLLBACK || 64));
const RECOVERY_NODE_LIMIT = Math.max(1, Number(process.env.BSV_BHS_RECOVERY_NODE_LIMIT || 24));
const RETAINED_HEADER_WINDOW = Math.max(
  RECOVERY_MAX_ROLLBACK + 8,
  Number(process.env.BSV_BHS_RETAINED_HEADER_WINDOW || (RECOVERY_MAX_ROLLBACK * 2)),
);
const STATE_PERSIST_DEBOUNCE_MS = Math.max(1000, Number(process.env.BSV_BHS_STATE_PERSIST_DEBOUNCE_MS || 30000));
let statePersistInFlight = false;
let statePersistQueued = null;
let statePersistLastSerialized = '';
let statePersistTimer = null;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function appendLog(event, payload = {}) {
  ensureDirs();
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...payload,
    });
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch (_) {}
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return safeJsonParse(fs.readFileSync(file, 'utf8'), fallback);
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureDirs();
  const serialized = JSON.stringify(data, null, 2);
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, serialized);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    const code = String(err?.code || '').toUpperCase();
    const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
    if (!transient) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
      throw err;
    }
    try {
      fs.copyFileSync(tmp, file);
      fs.unlinkSync(tmp);
      appendLog('write_json_rename_fallback_copy', {
        file,
        code: code || 'UNKNOWN',
        message: String(err?.message || 'rename failed'),
      });
    } catch (copyErr) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
      throw copyErr;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createRoundProfiler() {
  const sections = {};
  const counts = {};
  const startedAt = Date.now();
  const addTime = (name, elapsedMs) => {
    if (!name) return;
    if (!sections[name]) sections[name] = 0;
    sections[name] += Math.max(0, Number(elapsedMs || 0));
  };
  const addCount = (name, value = 1) => {
    if (!name) return;
    if (!counts[name]) counts[name] = 0;
    counts[name] += Math.max(0, Number(value || 0));
  };
  return {
    addTime,
    addCount,
    measure(name, fn) {
      const started = Date.now();
      const result = fn();
      addTime(name, Date.now() - started);
      return result;
    },
    async measureAsync(name, fn) {
      const started = Date.now();
      const result = await fn();
      addTime(name, Date.now() - started);
      return result;
    },
    flush(extra = {}) {
      appendLog('sync_round_profile', {
        totalElapsedMs: Date.now() - startedAt,
        sections,
        counts,
        ...(extra || {}),
      });
    },
  };
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message || 'timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseNodesText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => /^[^:\s]+:\d+$/.test(line));
}

function loadNodeCandidates() {
  const envNodes = parseNodesText(String(process.env.BSV_BHS_NODES || '').replace(/,/g, '\n'));
  const fileNodes = fs.existsSync(SPV_NODES_FILE)
    ? parseNodesText(fs.readFileSync(SPV_NODES_FILE, 'utf8'))
    : [];
  const hardcoded = [
    '104.248.81.232:8333',
    '107.210.90.217:8333',
    '100.7.12.142:8333',
    '141.95.126.79:8333',
    '135.125.170.182:8333',
    '15.235.232.121:8333',
    '157.143.83.144:8333',
    '159.89.105.214:8333',
  ];
  return Array.from(new Set([...envNodes, ...fileNodes, ...hardcoded]));
}

function bitsBufferToTarget(bitsBuffer) {
  if (!Buffer.isBuffer(bitsBuffer) || bitsBuffer.length < 4) return 0n;
  const compact = bitsBuffer.readUInt32BE(0);
  const exponent = (compact >>> 24) & 0xff;
  const mantissa = compact & 0x007fffff;
  if ((compact & 0x00800000) !== 0) return 0n;
  if (exponent <= 3) {
    return BigInt(mantissa) >> BigInt(8 * (3 - exponent));
  }
  return BigInt(mantissa) << BigInt(8 * (exponent - 3));
}

function headerWork(bitsBuffer) {
  const target = bitsBufferToTarget(bitsBuffer);
  if (target <= 0n) return 0n;
  return (1n << 256n) / (target + 1n);
}

function headerHashHex(header) {
  return String(header?.getHash?.().toString('hex') || '').trim().toLowerCase();
}

function toHeaderRow(header, height) {
  const hash = headerHashHex(header);
  const prevHash = Buffer.isBuffer(header?.prevHash)
    ? header.prevHash.toString('hex').toLowerCase()
    : String(header?.prevHash || '').trim().toLowerCase();
  return {
    height,
    hash,
    prevHash,
    time: Number(header?.time || 0),
    nonce: Number(header?.nonce || 0),
    bits: Buffer.isBuffer(header?.bits) ? header.bits.toString('hex') : '',
    work: headerWork(header?.bits).toString(),
  };
}

function makeFreshState() {
  return {
    version: 1,
    checkpoint: {
      height: CHECKPOINT_HEIGHT,
      hash: CHECKPOINT_HASH,
    },
    tip: {
      height: CHECKPOINT_HEIGHT,
      hash: CHECKPOINT_HASH,
      cumulativeWork: '0',
      updatedAt: null,
    },
    retainedBase: {
      height: CHECKPOINT_HEIGHT,
      cumulativeWork: '0',
    },
    headers: {
      [String(CHECKPOINT_HEIGHT)]: {
        height: CHECKPOINT_HEIGHT,
        hash: CHECKPOINT_HASH,
        prevHash: '',
        time: 0,
        nonce: 0,
        bits: '',
        work: '0',
      },
    },
    nodeStats: {},
    lastRound: {
      scannedNodes: 0,
      progress: false,
      updatedAt: null,
    },
  };
}

function loadState() {
  const curr = readJson(STATE_FILE, null);
  if (!curr || typeof curr !== 'object') return makeFreshState();
  if (String(curr?.checkpoint?.hash || '').toLowerCase() !== CHECKPOINT_HASH || Number(curr?.checkpoint?.height || 0) !== CHECKPOINT_HEIGHT) {
    return makeFreshState();
  }
  if (!curr.headers || typeof curr.headers !== 'object') curr.headers = {};
  if (!curr.headers[String(CHECKPOINT_HEIGHT)]) {
    curr.headers[String(CHECKPOINT_HEIGHT)] = {
      height: CHECKPOINT_HEIGHT,
      hash: CHECKPOINT_HASH,
      prevHash: '',
      time: 0,
      nonce: 0,
      bits: '',
      work: '0',
    };
  }
  if (!curr.retainedBase || typeof curr.retainedBase !== 'object') {
    curr.retainedBase = {
      height: CHECKPOINT_HEIGHT,
      cumulativeWork: '0',
    };
  }
  curr.retainedBase.height = Math.max(0, Number(curr.retainedBase.height || CHECKPOINT_HEIGHT));
  curr.retainedBase.cumulativeWork = String(curr.retainedBase.cumulativeWork || '0');
  const tipHeight = Math.max(CHECKPOINT_HEIGHT, Number(curr?.tip?.height || CHECKPOINT_HEIGHT));
  const headerHeights = Object.keys(curr.headers || {})
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= CHECKPOINT_HEIGHT)
    .sort((a, b) => a - b);
  const expectedRangeCount = Math.max(1, tipHeight - CHECKPOINT_HEIGHT + 1);
  const hasCoverageGap = headerHeights.length > 0 && headerHeights.length < expectedRangeCount;
  const looksLikeLegacyPrunedState = (
    tipHeight > CHECKPOINT_HEIGHT + RETAINED_HEADER_WINDOW
    && hasCoverageGap
    && curr.retainedBase.height > CHECKPOINT_HEIGHT
  );
  if (looksLikeLegacyPrunedState) {
    appendLog('state_reinitialized_for_hash_coverage', {
      tipHeight,
      retainedBaseHeight: curr.retainedBase.height,
      retainedHeaderCount: headerHeights.length,
      expectedRangeCount,
    });
    const fresh = makeFreshState();
    fresh.nodeStats = curr.nodeStats && typeof curr.nodeStats === 'object' ? { ...curr.nodeStats } : {};
    return fresh;
  }
  return curr;
}

function getSortedRetainedHeights(state, options = {}) {
  const includeCheckpoint = options.includeCheckpoint === true;
  return Object.keys(state.headers || {})
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= CHECKPOINT_HEIGHT && (includeCheckpoint || x > CHECKPOINT_HEIGHT))
    .sort((a, b) => a - b);
}

function getRetainedBaseWork(state) {
  return BigInt(String(state?.retainedBase?.cumulativeWork || '0'));
}

function recomputeCumulativeWork(state, profiler = null, targetHeight = null) {
  const started = Date.now();
  let total = getRetainedBaseWork(state);
  const heights = getSortedRetainedHeights(state);
  const target = targetHeight == null ? Number(state?.tip?.height || CHECKPOINT_HEIGHT) : Number(targetHeight || CHECKPOINT_HEIGHT);
  for (const height of heights) {
    if (height > target) break;
    const row = state.headers[String(height)];
    total += BigInt(String(row?.work || '0'));
  }
  if (target === Number(state?.tip?.height || CHECKPOINT_HEIGHT)) {
    state.tip.cumulativeWork = total.toString();
  }
  profiler?.addTime('recomputeCumulativeWork', Date.now() - started);
  profiler?.addCount('headersInCumulativeWork', heights.length);
  return total;
}

function compactStateForPersistence(state, profiler = null) {
  const started = Date.now();
  const tipHeight = Math.max(CHECKPOINT_HEIGHT, Number(state?.tip?.height || CHECKPOINT_HEIGHT));
  const keepFloor = Math.max(CHECKPOINT_HEIGHT + 1, tipHeight - RETAINED_HEADER_WINDOW + 1);
  const heights = getSortedRetainedHeights(state);
  const nextHeaders = {};
  const checkpointRow = state?.headers?.[String(CHECKPOINT_HEIGHT)];
  if (checkpointRow) nextHeaders[String(CHECKPOINT_HEIGHT)] = checkpointRow;
  let newBaseWork = 0n;
  let newBaseHeight = CHECKPOINT_HEIGHT;
  if (keepFloor > CHECKPOINT_HEIGHT + 1) {
    newBaseWork = recomputeCumulativeWork(state, profiler, keepFloor - 1);
    newBaseHeight = keepFloor - 1;
  }
  for (const height of heights) {
    const row = state.headers[String(height)];
    if (!row || !row.hash) continue;
    nextHeaders[String(height)] = height < keepFloor
      ? {
          height: Number(row.height || height),
          hash: String(row.hash || '').toLowerCase(),
        }
      : row;
  }
  state.headers = nextHeaders;
  state.retainedBase = {
    height: newBaseHeight,
    cumulativeWork: newBaseWork.toString(),
  };
  profiler?.addTime('compactStateForPersistence', Date.now() - started);
  profiler?.addCount('retainedHeadersAfterCompaction', Object.keys(nextHeaders).length);
}

function appendRowsAndUpdateTip(state, rows = []) {
  const tipStarted = Math.max(CHECKPOINT_HEIGHT, Number(state?.tip?.height || CHECKPOINT_HEIGHT));
  let total = BigInt(String(state?.tip?.cumulativeWork || '0'));
  for (const row of rows) {
    state.headers[String(row.height)] = row;
    if (Number(row?.height || 0) > tipStarted) {
      total += BigInt(String(row?.work || '0'));
    }
  }
  if (rows.length > 0) {
    const last = rows[rows.length - 1];
    state.tip.height = Number(last.height || tipStarted);
    state.tip.hash = String(last.hash || state.tip.hash || '').toLowerCase();
  }
  state.tip.cumulativeWork = total.toString();
}

function saveState(state, profiler = null) {
  const started = Date.now();
  if (!/^\d+$/.test(String(state?.tip?.cumulativeWork || ''))) {
    recomputeCumulativeWork(state, profiler);
  }
  compactStateForPersistence(state, profiler);
  const writeStarted = Date.now();
  const serialized = JSON.stringify(state);
  statePersistQueued = {
    serialized,
    state,
  };
  if (statePersistTimer) clearTimeout(statePersistTimer);
  statePersistTimer = setTimeout(() => {
    statePersistTimer = null;
    void flushStatePersistQueue();
  }, STATE_PERSIST_DEBOUNCE_MS);
  statePersistTimer.unref?.();
  profiler?.addTime('writeJsonState', Date.now() - writeStarted);
  profiler?.addTime('saveState', Date.now() - started);
}

async function flushStatePersistQueue() {
  if (statePersistInFlight) return;
  statePersistInFlight = true;
  try {
    while (statePersistQueued) {
      const next = statePersistQueued;
      statePersistQueued = null;
      const serialized = String(next?.serialized || '');
      if (!serialized || serialized === statePersistLastSerialized) continue;
      try {
        await fs.promises.writeFile(STATE_FILE, serialized, 'utf8');
      } catch (_) {
        try {
          writeJson(STATE_FILE, next?.state || {});
        } catch (_) {}
      }
      statePersistLastSerialized = serialized;
    }
  } finally {
    statePersistInFlight = false;
    if (statePersistQueued) {
      setImmediate(() => {
        void flushStatePersistQueue();
      });
    }
  }
}

async function withP2PPeer(node, fn) {
  return p2pNodeRuntime.withFreshPeer(
    wallet.getWalletP2PNodeSelector(),
    {
      node,
      purpose: 'sync_header',
      mode: 'fresh',
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
    },
    async (peer) => fn(peer),
  );
}

function validateHeaderRows(anchorHash, rows) {
  let prev = String(anchorHash || '').trim().toLowerCase();
  for (const row of rows) {
    if (!/^[0-9a-f]{64}$/i.test(String(row?.hash || ''))) {
      return { ok: false, error: `invalid hash at ${row?.height}` };
    }
    if (String(row?.prevHash || '').toLowerCase() !== prev) {
      return { ok: false, error: `prev mismatch at ${row?.height}` };
    }
    prev = String(row.hash).toLowerCase();
  }
  return { ok: true };
}

async function fetchNodeHeaders(node, startHeight, startHash, profiler = null) {
  const started = Date.now();
  const rows = [];
  let currentHash = String(startHash || '').trim().toLowerCase();
  let currentHeight = Number(startHeight || 0);
  while (rows.length < MAX_HEADERS_PER_ROUND) {
    const batch = await profiler.measureAsync('withP2PPeer.getHeaders', async () => (
      withP2PPeer(node, async (peer) => (
        withTimeout(peer.getHeaders({ from: [currentHash] }), HEADERS_TIMEOUT_MS, `headers timeout: ${node}`)
      ))
    ));
    const headers = Array.isArray(batch) ? batch : [];
    if (!headers.length) break;
    profiler?.addCount('headersFetched', headers.length);
    const chunkStarted = Date.now();
    const chunk = headers.map((header, index) => toHeaderRow(header, currentHeight + index + 1));
    profiler?.addTime('headersToRows', Date.now() - chunkStarted);
    profiler?.addCount('headerRowsBuilt', chunk.length);
    const validationStarted = Date.now();
    const validation = validateHeaderRows(currentHash, chunk);
    profiler?.addTime('validateHeaderRows', Date.now() - validationStarted);
    if (!validation.ok) {
      profiler?.addTime('fetchNodeHeaders', Date.now() - started);
      return {
        ok: false,
        node,
        rows,
        error: validation.error,
      };
    }
    rows.push(...chunk);
    currentHeight = rows[rows.length - 1].height;
    currentHash = rows[rows.length - 1].hash;
    if (headers.length < 2000) break;
  }
  profiler?.addTime('fetchNodeHeaders', Date.now() - started);
  return {
    ok: true,
    node,
    rows,
    tipHeight: rows.length ? rows[rows.length - 1].height : startHeight,
    tipHash: rows.length ? rows[rows.length - 1].hash : startHash,
  };
}

function getRecoveryAnchors(state) {
  const heights = Object.keys(state.headers || {})
    .map((x) => Number(x))
    .filter((x) => Number.isFinite(x) && x >= CHECKPOINT_HEIGHT)
    .sort((a, b) => b - a);
  const tipHeight = Number(state.tip?.height || CHECKPOINT_HEIGHT);
  const anchors = [];
  for (const height of heights) {
    if (height >= tipHeight) continue;
    const distance = tipHeight - height;
    if (distance > RECOVERY_MAX_ROLLBACK) continue;
    const row = state.headers[String(height)];
    if (!row?.hash) continue;
    anchors.push({
      height,
      hash: String(row.hash).toLowerCase(),
      distance,
    });
  }
  return anchors.sort((a, b) => a.distance - b.distance);
}

async function tryRecoverFork(state, nodes, profiler = null) {
  const anchors = getRecoveryAnchors(state);
  if (!anchors.length) return null;
  const candidateNodes = Array.isArray(nodes) ? nodes.slice(0, RECOVERY_NODE_LIMIT) : [];
  for (const anchor of anchors) {
    for (const node of candidateNodes) {
      try {
        const result = await fetchNodeHeaders(node, anchor.height, anchor.hash, profiler);
        if (!result?.ok || !Array.isArray(result.rows) || result.rows.length <= 0) continue;
        appendLog('fork_recovery_success', {
          node,
          rollbackFromHeight: Number(state.tip?.height || CHECKPOINT_HEIGHT),
          rollbackToHeight: anchor.height,
          rollbackToHash: anchor.hash,
          added: result.rows.length,
          recoveredTipHeight: Number(result.tipHeight || anchor.height),
          recoveredTipHash: String(result.tipHash || anchor.hash),
        });
        return {
          anchor,
          node,
          result,
        };
      } catch (err) {
        appendLog('fork_recovery_probe_failed', {
          node,
          rollbackToHeight: anchor.height,
          rollbackToHash: anchor.hash,
          error: String(err?.message || err || 'recovery probe failed'),
        });
      }
    }
  }
  return null;
}

async function runWithConcurrency(items, worker, concurrency) {
  const queue = Array.isArray(items) ? items.slice() : [];
  const out = [];
  async function runOne() {
    while (queue.length > 0) {
      const item = queue.shift();
      out.push(await worker(item));
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => runOne()));
  return out;
}

function selectSyncRoundNodes(state, nodes) {
  const allNodes = Array.isArray(nodes) ? nodes.filter(Boolean) : [];
  if (allNodes.length <= IDLE_NODE_LIMIT) {
    return {
      nodes: allNodes,
      limited: false,
      nextIdleProbeOffset: 0,
    };
  }
  const lastRound = state?.lastRound && typeof state.lastRound === 'object' ? state.lastRound : {};
  const consecutiveIdle = Math.max(0, Number(lastRound.consecutiveIdle || 0));
  const shouldLimit = lastRound.updatedAt && lastRound.progress === false && consecutiveIdle >= 1;
  if (!shouldLimit) {
    return {
      nodes: allNodes,
      limited: false,
      nextIdleProbeOffset: Math.max(0, Number(lastRound.idleProbeOffset || 0)) % allNodes.length,
    };
  }

  const selected = [];
  const selectedSet = new Set();
  const addNode = (node) => {
    const normalized = String(node || '').trim();
    if (!normalized || selectedSet.has(normalized)) return false;
    selectedSet.add(normalized);
    selected.push(normalized);
    return true;
  };

  const stats = state?.nodeStats && typeof state.nodeStats === 'object' ? state.nodeStats : {};
  const preferred = allNodes
    .map((node) => ({ node, stat: stats[node] || {} }))
    .filter((item) => item.stat && item.stat.ok === true)
    .sort((a, b) => {
      const ar = Math.max(0, Number(a.stat.rows || 0));
      const br = Math.max(0, Number(b.stat.rows || 0));
      if (ar !== br) return br - ar;
      const ah = Math.max(0, Number(a.stat.tipHeight || 0));
      const bh = Math.max(0, Number(b.stat.tipHeight || 0));
      if (ah !== bh) return bh - ah;
      return String(b.stat.updatedAt || '').localeCompare(String(a.stat.updatedAt || ''));
    });
  for (const item of preferred) {
    if (selected.length >= Math.min(IDLE_PREFERRED_NODE_LIMIT, IDLE_NODE_LIMIT)) break;
    addNode(item.node);
  }

  const offset = Math.max(0, Number(lastRound.idleProbeOffset || 0)) % allNodes.length;
  let consumedRotating = 0;
  for (let i = 0; i < allNodes.length && selected.length < IDLE_NODE_LIMIT; i += 1) {
    const node = allNodes[(offset + i) % allNodes.length];
    consumedRotating += 1;
    addNode(node);
  }

  return {
    nodes: selected.length ? selected : allNodes.slice(0, IDLE_NODE_LIMIT),
    limited: true,
    nextIdleProbeOffset: (offset + Math.max(1, consumedRotating)) % allNodes.length,
  };
}

async function syncRound(state) {
  const profiler = createRoundProfiler();
  if (!HAS_VALID_CHECKPOINT_HASH) {
    const now = new Date().toISOString();
    appendLog('checkpoint_hash_missing', {
      checkpointHeight: CHECKPOINT_HEIGHT,
      marketBootstrapHeight: MARKET_BOOTSTRAP_HEIGHT,
      message: 'Set BSV_MARKET_BOOTSTRAP_PREV_HASH after the bootstrap previous block exists.',
    });
    if (state?.lastRound && typeof state.lastRound === 'object') {
      state.lastRound = {
        ...state.lastRound,
        progress: false,
        error: 'checkpoint_hash_missing',
        updatedAt: now,
      };
    }
    return {
      progress: false,
      best: null,
      error: 'checkpoint_hash_missing',
    };
  }
  const allNodes = loadNodeCandidates();
  const nodeSelection = selectSyncRoundNodes(state, allNodes);
  const nodes = nodeSelection.nodes;
  const startHeight = Number(state.tip.height || CHECKPOINT_HEIGHT);
  const startHash = String(state.tip.hash || CHECKPOINT_HASH).toLowerCase();
  const startedAt = new Date().toISOString();
  profiler.addCount('candidateNodes', nodes.length);
  profiler.addCount('totalCandidateNodes', allNodes.length);
  const results = await profiler.measureAsync('runWithConcurrency', async () => runWithConcurrency(nodes, async (node) => {
    try {
      const result = await fetchNodeHeaders(node, startHeight, startHash, profiler);
      state.nodeStats[node] = {
        ok: result.ok,
        tipHeight: Number(result.tipHeight || startHeight),
        tipHash: String(result.tipHash || startHash),
        rows: Array.isArray(result.rows) ? result.rows.length : 0,
        error: String(result.error || ''),
        updatedAt: startedAt,
      };
      return result;
    } catch (err) {
      const result = {
        ok: false,
        node,
        rows: [],
        error: String(err?.message || err || 'node fetch failed'),
      };
      state.nodeStats[node] = {
        ok: false,
        tipHeight: startHeight,
        tipHash: startHash,
        rows: 0,
        error: result.error,
        updatedAt: startedAt,
      };
      return result;
    }
  }, NODE_CONCURRENCY));

  const sortStarted = Date.now();
  const good = results
    .filter((x) => x && x.ok === true)
    .sort((a, b) => {
      if ((b.rows?.length || 0) !== (a.rows?.length || 0)) return (b.rows?.length || 0) - (a.rows?.length || 0);
      return Number(b.tipHeight || 0) - Number(a.tipHeight || 0);
    });
  profiler.addTime('filterSortGood', Date.now() - sortStarted);
  profiler.addCount('goodNodes', good.length);

  const best = good[0] || null;
  let progress = false;
  if (best && Array.isArray(best.rows) && best.rows.length > 0) {
    const mergeStarted = Date.now();
    appendRowsAndUpdateTip(state, best.rows);
    profiler.addTime('mergeBestRows', Date.now() - mergeStarted);
    profiler.addCount('bestRowsAdded', best.rows.length);
    state.tip.updatedAt = startedAt;
    progress = true;
    appendLog('sync_round_progress', {
      node: best.node,
      added: best.rows.length,
      tipHeight: state.tip.height,
      tipHash: state.tip.hash,
    });
  } else {
    appendLog('sync_round_idle', {
      startHeight,
      startHash,
      scannedNodes: nodes.length,
      goodNodes: good.length,
    });
    if (good.length === 0) {
      const recovered = await tryRecoverFork(state, nodes, profiler);
      if (recovered?.result?.rows?.length) {
        const pruneStarted = Date.now();
        for (const key of Object.keys(state.headers || {})) {
          const height = Number(key);
          if (Number.isFinite(height) && height > recovered.anchor.height) delete state.headers[key];
        }
        profiler?.addTime('pruneForkedHeaders', Date.now() - pruneStarted);
        const mergeStarted = Date.now();
        const rollbackWork = recomputeCumulativeWork(state, profiler, recovered.anchor.height);
        state.tip.height = recovered.anchor.height;
        state.tip.hash = recovered.anchor.hash;
        state.tip.cumulativeWork = rollbackWork.toString();
        appendRowsAndUpdateTip(state, recovered.result.rows);
        profiler?.addTime('mergeRecoveredRows', Date.now() - mergeStarted);
        profiler?.addCount('recoveredRowsAdded', recovered.result.rows.length);
        state.tip.updatedAt = startedAt;
        progress = true;
        appendLog('sync_round_recovered_progress', {
          node: recovered.node,
          rollbackToHeight: recovered.anchor.height,
          rollbackToHash: recovered.anchor.hash,
          added: recovered.result.rows.length,
          tipHeight: state.tip.height,
          tipHash: state.tip.hash,
        });
      }
    }
  }

  state.lastRound = {
    scannedNodes: nodes.length,
    totalCandidateNodes: allNodes.length,
    limitedNodeScan: nodeSelection.limited === true,
    idleProbeOffset: progress ? 0 : nodeSelection.nextIdleProbeOffset,
    consecutiveIdle: progress ? 0 : Math.max(0, Number(state?.lastRound?.consecutiveIdle || 0)) + 1,
    progress,
    updatedAt: startedAt,
  };
  saveState(state, profiler);
  notifyStatusChanged({
    checkpoint: { ...(state.checkpoint || {}) },
    tip: { ...(state.tip || {}) },
    headers: { ...(state.headers || {}) },
    lastRound: { ...(state.lastRound || {}) },
    nodeStats: { ...(state.nodeStats || {}) },
    headerCount: Object.keys(state.headers || {}).length,
    startedAt: null,
  });
  profiler.flush({
    startHeight,
    startHash,
    progress,
    goodNodes: good.length,
    bestNode: String(best?.node || ''),
    bestRows: Array.isArray(best?.rows) ? best.rows.length : 0,
    tipHeight: Number(state.tip.height || 0),
    limitedNodeScan: nodeSelection.limited === true,
    scannedNodes: nodes.length,
    totalCandidateNodes: allNodes.length,
    consecutiveIdle: Math.max(0, Number(state?.lastRound?.consecutiveIdle || 0)),
  });
  return {
    progress,
    best,
    results,
    nextDelayMs: !progress && Math.max(0, Number(state?.lastRound?.consecutiveIdle || 0)) >= IDLE_SLOW_AFTER_ROUNDS
      ? IDLE_SLOW_INTERVAL_MS
      : LOOP_INTERVAL_MS,
  };
}

const statusListeners = new Set();
let singleton = null;

function notifyStatusChanged(snapshot) {
  const payload = snapshot && typeof snapshot === 'object' ? snapshot : getStatus();
  for (const listener of Array.from(statusListeners)) {
    try {
      listener(payload);
    } catch (_) {}
  }
}

function subscribeStatusChanged(handler) {
  if (typeof handler !== 'function') return () => {};
  statusListeners.add(handler);
  return () => {
    statusListeners.delete(handler);
  };
}

function ensureSingleton() {
  if (singleton) return singleton;
  const state = loadState();
  saveState(state);
  singleton = {
    state,
    syncLoopRunning: false,
    startedAt: null,
    serverStarted: false,
  };
  return singleton;
}

async function syncLoop() {
  const holder = ensureSingleton();
  if (holder.syncLoopRunning) return;
  holder.syncLoopRunning = true;
  try {
    while (true) {
      const result = await syncRound(holder.state);
      if (!result.progress) {
        await sleep(Math.max(1000, Number(result.nextDelayMs || LOOP_INTERVAL_MS)));
      }
    }
  } catch (err) {
    appendLog('sync_loop_error', {
      error: String(err?.stack || err?.message || err || 'sync loop failed'),
    });
    setTimeout(() => {
      const curr = ensureSingleton();
      curr.syncLoopRunning = false;
      syncLoop().catch(() => {});
    }, 3000);
  }
}

function getStatus() {
  const holder = ensureSingleton();
  return {
    checkpoint: { ...(holder.state.checkpoint || {}) },
    tip: { ...(holder.state.tip || {}) },
    headers: { ...(holder.state.headers || {}) },
    lastRound: { ...(holder.state.lastRound || {}) },
    nodeStats: { ...(holder.state.nodeStats || {}) },
    headerCount: Object.keys(holder.state.headers || {}).length,
    startedAt: holder.startedAt,
  };
}

function startBlockHeadersCore() {
  const holder = ensureSingleton();
  if (holder.startedAt) return holder;
  holder.startedAt = new Date().toISOString();
  appendLog('service_started', {
    port: PORT,
    checkpointHeight: CHECKPOINT_HEIGHT,
    checkpointHash: CHECKPOINT_HASH,
    embedded: false,
  });
  syncLoop().catch(() => {});
  return holder;
}

function startEmbeddedBlockHeadersCore() {
  const holder = ensureSingleton();
  if (holder.startedAt) return holder;
  holder.startedAt = new Date().toISOString();
  appendLog('service_started', {
    port: PORT,
    checkpointHeight: CHECKPOINT_HEIGHT,
    checkpointHash: CHECKPOINT_HASH,
    embedded: true,
  });
  syncLoop().catch(() => {});
  return holder;
}

function createApp() {
  const app = express();
  app.get('/status', (_req, res) => {
    res.json({
      success: true,
      ...getStatus(),
    });
  });
  app.post('/sync', async (_req, res) => {
    try {
      const holder = ensureSingleton();
      const result = await syncRound(holder.state);
      res.json({
        success: true,
        progress: result.progress,
        best: result.best ? {
          node: result.best.node,
          tipHeight: result.best.tipHeight,
          rows: result.best.rows.length,
        } : null,
        tip: holder.state.tip,
      });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: String(err?.message || err || 'sync failed'),
      });
    }
  });
  return app;
}

function startStandaloneServer() {
  const holder = startBlockHeadersCore();
  if (holder.serverStarted) return holder;
  holder.serverStarted = true;
  const app = createApp();
  app.listen(PORT, () => {});
  return holder;
}

if (require.main === module) {
  startStandaloneServer();
}

module.exports = {
  CHECKPOINT_HEIGHT,
  CHECKPOINT_HASH,
  STATE_FILE,
  LOG_FILE,
  startBlockHeadersCore,
  startEmbeddedBlockHeadersCore,
  startStandaloneServer,
  getBlockHeadersStatus: getStatus,
  subscribeStatusChanged,
};
