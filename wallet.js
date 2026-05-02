const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const net = require('net');
const { EventEmitter } = require('events');
const { DatabaseSync } = require('node:sqlite');
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
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"'))
        || (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
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
const bsvRaw = requireWithFallback('bsv');
const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;
const bsvSdkRaw = (() => {
  try {
    return requireWithFallback('@bsv/sdk');
  } catch (_) {
    return null;
  }
})();
const BsvSdkTransaction =
  (bsvSdkRaw && bsvSdkRaw.Transaction) ||
  (bsvSdkRaw && bsvSdkRaw.default && bsvSdkRaw.default.Transaction);
const BsvSdkMerklePath =
  (bsvSdkRaw && bsvSdkRaw.MerklePath) ||
  (bsvSdkRaw && bsvSdkRaw.default && bsvSdkRaw.default.MerklePath);
const BsvHDPrivateKey =
  (bsv && bsv.HDPrivateKey) ||
  (bsvRaw && bsvRaw.HDPrivateKey) ||
  (bsvRaw && bsvRaw.default && bsvRaw.default.HDPrivateKey);
const Mnemonic = requireWithFallback('bsv-mnemonic');
const { createP2PNodeSelector } = require('./p2p_node_selector');
const p2pNodeRuntime = require('./p2p_node_runtime');
const bhsDomain = require('./bhs_domain');
const messageQueue = require('./lib/message_queue');

const NETWORK = 'livenet';
const API_NETWORK = 'main';
const PATH_BASE = "m/44'/0'/0'/0";
const FALLBACK_PATH_BASES = ["m/44'/236'/0'/0"];
const CHAT_PATH_BASE = "m/44'/0'/100'/0/0";
const DEFAULT_HISTORY_PAGE_SIZE = 10;
const DEFAULT_MARKET_FEE_DISPLAY_SAT = 1448;
const DEFAULT_FEE_RATE = Math.max(5.0, Number(process.env.BSV_MARKET_FEE_RATE || 5.0));
const FINAL_SIGNED_FEE_SAFETY_SAT = Math.max(0, Number(process.env.BSV_MARKET_FINAL_SIGNED_FEE_SAFETY_SAT || 4));
const ORDER_SETTLEMENT_FINAL_FEE_SAFETY_SAT = Math.max(
  FINAL_SIGNED_FEE_SAFETY_SAT,
  Number(process.env.BSV_MARKET_ORDER_SETTLEMENT_FINAL_FEE_SAFETY_SAT || 200),
);
const DEFAULT_RESCAN_COUNT = 20;
const LIGHTWEIGHT_IMPORT_ADDRESS_COUNT = Math.max(1, Number(process.env.BSV_MARKET_IMPORT_ADDRESS_COUNT || 50));
const MAX_ANCHOR_PAYLOAD_BYTES = Number(process.env.BSV_MARKET_MAX_ANCHOR_BYTES || 10000);

const DATA_DIR = path.resolve(process.env.BSV_MARKET_DATA_DIR || path.join(__dirname, 'data'));
const DB_DIR = path.resolve(process.env.BSV_MARKET_DB_DIR || DATA_DIR);
const LOG_DIR = path.resolve(process.env.BSV_MARKET_LOG_DIR || path.join(__dirname, 'log'));
const KEYSTORE_FILE = path.join(DATA_DIR, 'keystore.json');
const STATE_FILE = path.join(DATA_DIR, 'wallet_state.json');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const NOTES_FILE = path.join(DATA_DIR, 'tx_notes.json');
const MARKET_DB_FILE = path.join(DB_DIR, 'market.db');
const SPV_INDEX_FILE = path.join(DATA_DIR, 'spv_index.json');
const SPV_NODE_STATE_FILE = path.join(DATA_DIR, 'spv_nodes_state.json');
const BROADCAST_MONITOR_FILE = path.join(DATA_DIR, 'broadcast_monitor.json');
const RECOVER_LOG_FILE = path.join(LOG_DIR, 'recover-debug.log');
const SEND_LOG_FILE = path.join(LOG_DIR, 'send-debug.log');
const TX_CONTEXT_CACHE_LIMIT = Math.max(64, Number(process.env.BSV_MARKET_TX_CONTEXT_CACHE_LIMIT || 512));
let lastWalletExistsDiagKey = '';
let walletStateSnapshot = null;
let walletStateSnapshotLoaded = false;
let walletStateSnapshotVersion = 0;
let walletStateSnapshotUpdatedAt = 0;
let spvIndexSnapshot = null;
let spvIndexSnapshotLoaded = false;
let spvIndexSnapshotMtimeMs = 0;
let spvNodeStateSnapshot = null;
let spvNodeStateSnapshotLoaded = false;
let spvNodeStatePersistTimer = null;
let spvNodeStateLastPersistAt = 0;
let walletTouchHintsCache = null;
let walletTouchHintsCacheKey = '';
let walletBalanceHistoryCache = null;
let walletBalanceHistoryCacheKey = '';
const SPV_TX_OBSERVATION_CACHE_MAX = 20000;
const spvTxObservationCache = new Map();
const SPV_LISTENER_RELAY_FLUSH_TX_INTERVAL = Math.max(100, Number(process.env.BSV_MARKET_SPV_RELAY_FLUSH_TX_INTERVAL || 1000));
const SPV_LISTENER_RELAY_FLUSH_MS = Math.max(1000, Number(process.env.BSV_MARKET_SPV_RELAY_FLUSH_MS || 10000));
const SPV_LISTENER_RELAY_LOG_MS = Math.max(5000, Number(process.env.BSV_MARKET_SPV_RELAY_LOG_MS || 30000));
const SPV_LISTENER_SELECTOR_REPORT_MS = Math.max(5000, Number(process.env.BSV_MARKET_SPV_SELECTOR_REPORT_MS || 30000));
const spvListenerRelayState = new Map();
const BROADCAST_PENDING_MIN_NODES = Math.max(1, Number(process.env.BSV_MARKET_BROADCAST_PENDING_MIN_NODES || 3));
const BROADCAST_MONITOR_PROBE_MS = Math.max(5000, Number(process.env.BSV_MARKET_BROADCAST_MONITOR_PROBE_MS || 30000));
const BROADCAST_MONITOR_PROBE_TIMEOUT_MS = Math.max(1000, Number(process.env.BSV_MARKET_BROADCAST_MONITOR_PROBE_TIMEOUT_MS || 5000));
let broadcastMonitorTimer = null;
let unconfirmedWalletSnapshotInFlight = null;
let lastUnconfirmedWalletSnapshotAt = 0;
const walletEventBus = new EventEmitter();
walletEventBus.setMaxListeners(32);

const LEGACY_AVAILABLE_PATHS_FILE = path.join(__dirname, '..', 'bsv', 'available_paths.json');
const SPV_NODES_FILE = path.join(__dirname, 'spv_nodes.txt');
const LEGACY_OPEN_NODES_FILE = path.join(__dirname, '..', 'bsv', 'bsv_nodes_open_2026-02-27.txt');

const SPV_CONNECT_TIMEOUT_MS = 8000;
const SPV_BROADCAST_TIMEOUT_MS = 12000;
const SPV_SNAPSHOT_MS = 3500;
const SPV_AGGRESSIVE_LISTEN = String(process.env.BSV_MARKET_SPV_AGGRESSIVE || '0') === '1';
const SPV_NODE_POOL_MAX = 100;
const SPV_NODE_CONNECT_TOP = Math.max(1, Number(process.env.BSV_MARKET_SPV_NODE_CONNECT_TOP || 16));
const DISABLE_SPV_LISTENER = String(process.env.BSV_MARKET_DISABLE_SPV_LISTENER || '').trim() === '1';
const SPV_NODE_EVICT_SCORE_MARGIN = Math.max(1, Number(process.env.BSV_MARKET_SPV_NODE_EVICT_SCORE_MARGIN || 6));
const SPV_NODE_BASE_BAN_MS = 2 * 60 * 1000;
const SPV_NODE_MAX_BAN_MS = 20 * 60 * 1000;
const SPV_NODE_PROBE_TIMEOUT_MS = Math.max(500, Number(process.env.BSV_MARKET_SPV_PROBE_TIMEOUT_MS || 2500));
const SPV_NODE_PROBE_INTERVAL_MS = Math.max(5000, Number(process.env.BSV_MARKET_SPV_PROBE_INTERVAL_MS || 30000));
const SPV_NODE_PROBE_RESERVE_COUNT = Math.max(1, Number(process.env.BSV_MARKET_SPV_PROBE_RESERVE_COUNT || 3));
const SEND_CONNECT_TIMEOUT_MS = 4000;
const SEND_BROADCAST_TIMEOUT_MS = Math.max(7000, Number(process.env.BSV_MARKET_SEND_BROADCAST_TIMEOUT_MS || 20000));
const SEND_TX_SETTLE_MS = Math.max(0, Number(process.env.BSV_MARKET_SEND_TX_SETTLE_MS || 2000));
const SEND_MAX_NODE_TRIES = Math.max(1, Number(process.env.BSV_MARKET_SEND_MAX_NODE_TRIES || 16));
const SEND_MIN_SUCCESS_NODES = Math.max(1, Number(process.env.BSV_MARKET_SEND_MIN_SUCCESS_NODES || 2));
const SEND_INITIAL_NODE_TRIES = Math.max(1, Number(process.env.BSV_MARKET_SEND_INITIAL_NODE_TRIES || 2));
const SEND_RETRY_WAVE_NODE_TRIES = Math.max(1, Number(process.env.BSV_MARKET_SEND_RETRY_WAVE_NODE_TRIES || 2));
const SEND_OBSERVATION_WAIT_MS = Math.max(0, Number(process.env.BSV_MARKET_SEND_OBSERVATION_WAIT_MS || 5000));
const SEND_BROADCAST_EVIDENCE_TIMEOUT_MS = Math.max(2000, Number(process.env.BSV_MARKET_SEND_EVIDENCE_TIMEOUT_MS || 30000));
const SEND_NODE_MEMPOOL_PROBE_DELAY_MS = Math.max(0, Number(process.env.BSV_MARKET_SEND_NODE_MEMPOOL_PROBE_DELAY_MS || 0));
const SEND_NODE_MEMPOOL_PROBE_INTERVAL_MS = Math.max(250, Number(process.env.BSV_MARKET_SEND_NODE_MEMPOOL_PROBE_INTERVAL_MS || 2000));
const SEND_NODE_MEMPOOL_PROBE_TIMEOUT_MS = Math.max(500, Number(process.env.BSV_MARKET_SEND_NODE_MEMPOOL_PROBE_TIMEOUT_MS || 2500));
const SEND_CONNECTED_PEER_TRIES = Math.max(1, Number(process.env.BSV_MARKET_SEND_CONNECTED_PEER_TRIES || 4));
const SEND_PUBLIC_VISIBILITY_WAIT_MS = Math.max(0, Number(process.env.BSV_MARKET_SEND_PUBLIC_VISIBILITY_WAIT_MS || 6000));
const SEND_PUBLIC_VISIBILITY_POLL_MS = Math.max(150, Number(process.env.BSV_MARKET_SEND_PUBLIC_VISIBILITY_POLL_MS || 600));
const SEND_MAX_UNCONFIRMED_ANCESTOR_DEPTH = Math.max(0, Number(process.env.BSV_MARKET_SEND_MAX_UNCONFIRMED_DEPTH || 1));
const ANCHOR_MAX_UNCONFIRMED_ANCESTOR_DEPTH = (() => {
  const raw = String(process.env.BSV_MARKET_ANCHOR_MAX_UNCONFIRMED_DEPTH || '').trim();
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : Number.POSITIVE_INFINITY;
})();
const ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH = (() => {
  const raw = String(process.env.BSV_MARKET_ORDER_MAX_UNCONFIRMED_DEPTH || '').trim();
  if (!raw) return Number.POSITIVE_INFINITY;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : Number.POSITIVE_INFINITY;
})();
const SAFE_MIN_CHANGE_SAT = Math.max(1000, Number(process.env.BSV_MARKET_SAFE_MIN_CHANGE_SAT || 1000));
const MIN_ORDER_ESCROW_OUTPUT_SATS = Math.max(SAFE_MIN_CHANGE_SAT, Number(process.env.BSV_MARKET_MIN_ORDER_ESCROW_OUTPUT_SATS || SAFE_MIN_CHANGE_SAT));
const ORDER_SETTLEMENT_MULTISIG_INPUT_ESTIMATE_BYTES = Math.max(160, Number(process.env.BSV_MARKET_ORDER_SETTLEMENT_INPUT_ESTIMATE_BYTES || 210));
const CONSOLIDATE_SMALL_UTXO_SAT = Math.max(
  SAFE_MIN_CHANGE_SAT,
  Number(process.env.BSV_MARKET_CONSOLIDATE_SMALL_UTXO_SAT || 5000),
);
const CONSOLIDATE_TRIGGER_COUNT = Math.max(2, Number(process.env.BSV_MARKET_CONSOLIDATE_TRIGGER_COUNT || 5));
const CONSOLIDATE_TOTAL_TRIGGER_COUNT = Math.max(4, Number(process.env.BSV_MARKET_CONSOLIDATE_TOTAL_TRIGGER_COUNT || 12));
const CONSOLIDATE_MAX_EXTRA_INPUTS = Math.max(1, Number(process.env.BSV_MARKET_CONSOLIDATE_MAX_EXTRA_INPUTS || 8));
const ANCHOR_DATA_OUTPUT_SAT = Math.max(
  SAFE_MIN_CHANGE_SAT,
  Number(process.env.BSV_MARKET_ANCHOR_DATA_OUTPUT_SAT || SAFE_MIN_CHANGE_SAT),
);

const MARKET_CHAIN_MARKER_HEX = Buffer.from('BMMKT2', 'utf8').toString('hex').toLowerCase();
const WOC_BASE = `https://api.whatsonchain.com/v1/bsv/${API_NETWORK}`;
const WOC_TIMEOUT_MS = 15000;
const WOC_MIN_INTERVAL_MS = Math.max(180, Number(process.env.BSV_MARKET_WOC_MIN_INTERVAL_MS || 750));

let txContextDb = null;
let txContextSchemaReady = false;
const txContextRowCache = new Map();
const anchorEventTypeCache = new Map();
const txContextBackfillInFlight = new Map();
const ALLOW_WOC_HTTP = String(process.env.BSV_MARKET_ALLOW_WOC_FALLBACK || process.env.BSV_MARKET_ALLOW_WOC || '0') === '1';
const ALLOW_WOC_SEND_CONTEXT_FETCH = false;
const BROADCAST_CONTEXT_MAX_ANCESTORS = Math.max(0, Number(process.env.BSV_MARKET_CONTEXT_MAX_ANCESTORS || 12));
const BEEF_CONTEXT_BACKFILL_MAX_ROUNDS = Math.max(1, Number(process.env.BSV_MARKET_BEEF_BACKFILL_MAX_ROUNDS || 32));

const DEFAULT_SPV_NODES = [
  '15.235.232.121:8333',
  '135.125.170.182:8333',
  '57.129.99.214:8333',
  '162.19.222.167:8333',
  '57.128.216.248:8333',
  '47.186.181.232:8333',
];
const PREFERRED_BROADCAST_NODES = Array.from(new Set([
  ...String(process.env.BSV_MARKET_PREFERRED_BROADCAST_NODES || '')
    .split(/[,\s]+/)
    .map((node) => node.trim())
    .filter(Boolean),
  '15.235.232.121:8333',
  '47.186.181.232:8333',
]));

const spvRuntime = {
  started: false,
  maintaining: false,
  peers: new Map(),
  sessions: new Map(),
  connectingNodes: new Set(),
  nodes: [],
  nodeCursor: 0,
  lastGoodNode: null,
  maintainTimer: null,
  lastProbeSweepAt: 0,
};
const walletRuntimePolicy = {
  listenerEnabled: !DISABLE_SPV_LISTENER,
  listenerTarget: Math.min(4, SPV_NODE_CONNECT_TOP),
  sendEnabled: true,
  reason: '',
};
const walletNodeManagerRuntime = {
  nextSyncAllocatorSeq: 0,
  activeSyncLeases: new Map(),
};
const walletNodeManagerState = {
  updatedAt: null,
  candidatePool: [],
  candidateScores: {},
  probeQueue: [],
  workingPool: [],
  standbyPool: [],
  listenerAssignedTarget: [],
  listenerAssignedActual: [],
  syncAssignedTarget: [],
  syncAssignedActual: [],
  sendAssignedTarget: [],
  sendAssignedActual: [],
  walletAvailable: !DISABLE_SPV_LISTENER,
  walletReadable: !DISABLE_SPV_LISTENER,
  walletSendEnabled: true,
  availabilityReason: '',
  displayConnectedCount: 0,
  displayCandidateCount: 0,
  displayTotalCount: 0,
  displayRecentConnected: 0,
  displayConnected: [],
  displayCandidates: [],
};
let walletP2PNodeSelector = null;
let wocNextAt = 0;
let lastBalanceTotalSatForLog = null;
const walletSyncRuntime = {
  active: false,
  stage: 'idle',
  message: '',
  startedAt: null,
  updatedAt: null,
  addressCount: 0,
  scannedAddresses: 0,
  currentAddress: '',
  currentIndex: -1,
  foundUtxos: 0,
  foundTxids: 0,
  confirmed: 0,
  unconfirmed: 0,
  total: 0,
  error: '',
};

function setWalletSyncProgress(patch = {}) {
  Object.assign(walletSyncRuntime, patch, { updatedAt: new Date().toISOString() });
}

function startWalletSyncProgress(stage, patch = {}) {
  Object.assign(walletSyncRuntime, {
    active: true,
    stage,
    message: '',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    addressCount: 0,
    scannedAddresses: 0,
    currentAddress: '',
    currentIndex: -1,
    foundUtxos: 0,
    foundTxids: 0,
    confirmed: 0,
    unconfirmed: 0,
    total: 0,
    error: '',
    ...patch,
  });
}

function finishWalletSyncProgress(stage, patch = {}) {
  Object.assign(walletSyncRuntime, {
    active: false,
    stage,
    updatedAt: new Date().toISOString(),
    ...patch,
  });
}

function getWalletSyncProgress() {
  return {
    ...walletSyncRuntime,
  };
}

function computeNodeRoleScores(row = {}) {
  const baseScore = Number(row?.score || 0);
  const successCount = Number(row?.successCount || 0);
  const failCount = Number(row?.failCount || 0);
  const broadcastSuccessCount = Number(row?.broadcastSuccessCount || 0);
  const broadcastFailCount = Number(row?.broadcastFailCount || 0);
  const listenerTxHitCount = Number(row?.listenerTxHitCount || 0);
  const listenerTxSeenCount = Number(row?.listenerTxSeenCount || 0);
  const probeLatencyMs = Math.max(0, Number(row?.lastProbeLatencyMs || 0));
  const avgBroadcastLatencyMs = Math.max(0, Number(row?.avgBroadcastLatencyMs || 0));
  const consecutiveFail = Number(row?.consecutiveFail || 0);
  const probeBonus = probeLatencyMs > 0 ? Math.max(0, 12 - Math.floor(probeLatencyMs / 75)) : 0;
  const broadcastBonus = avgBroadcastLatencyMs > 0 ? Math.max(0, 10 - Math.floor(avgBroadcastLatencyMs / 200)) : 0;
  const lastListenerTxAt = row?.lastListenerTxAt ? new Date(row.lastListenerTxAt).getTime() : 0;
  const listenerRecentBonus = lastListenerTxAt > 0 && (Date.now() - lastListenerTxAt) <= 60 * 60 * 1000 ? 12 : 0;
  const listenerRelayBonus = Math.min(30, listenerTxHitCount * 8) + Math.min(12, Math.floor(listenerTxSeenCount / 25));
  return {
    listenerScore: baseScore + Math.min(12, successCount) + listenerRelayBonus + listenerRecentBonus - (consecutiveFail * 2),
    syncScore: baseScore + probeBonus + Math.min(10, successCount) - failCount,
    sendScore: baseScore + broadcastBonus + (broadcastSuccessCount * 2) - (broadcastFailCount * 3),
  };
}

function refreshWalletNodeManagerState() {
  const state = loadSpvNodeState();
  const ranked = getRankedSpvNodes({ limit: null, includeBannedFallback: true, state, role: 'listener' });
  const now = Date.now();
  const connectedNodes = Array.from(spvRuntime.peers.keys());
  const connectingNodes = Array.from(spvRuntime.connectingNodes.values());
  const syncActual = Array.from(
    new Set(Array.from(walletNodeManagerRuntime.activeSyncLeases.values()).map((row) => String(row?.node || '').trim()).filter(Boolean)),
  );
  const listenerActual = connectedNodes.slice();
  const effectiveListenerTarget = (!walletRuntimePolicy.listenerEnabled || walletRuntimePolicy.listenerTarget <= 0)
    ? []
    : ranked
      .map((row) => String(row?.endpoint || '').trim())
      .filter(Boolean)
      .slice(0, Math.max(0, Number(walletRuntimePolicy.listenerTarget || 0)));
  const candidateScores = {};
  const rowsByEndpoint = new Map();
  (state.nodes || []).forEach((row) => {
    const endpoint = String(row?.endpoint || '').trim();
    if (!endpoint) return;
    rowsByEndpoint.set(endpoint, row);
    candidateScores[endpoint] = {
      score: Number(row?.score || 0),
      successCount: Number(row?.successCount || 0),
      failCount: Number(row?.failCount || 0),
      consecutiveFail: Number(row?.consecutiveFail || 0),
      banUntil: Number(row?.banUntil || 0),
      ...computeNodeRoleScores(row),
    };
  });
  const sortedRows = (state.nodes || []).slice().sort(sortNodeRows);
  const availableRows = sortedRows.filter((row) => !Number(row?.banUntil || 0) || Number(row?.banUntil || 0) <= now);
  const recentWindowMs = 120 * 1000;
  const recentConnected = sortedRows.filter((row) => {
    const ts = row?.lastSuccessAt ? new Date(row.lastSuccessAt).getTime() : 0;
    return ts > 0 && (now - ts) <= recentWindowMs;
  }).length;
  const displayConnected = connectedNodes
    .map((endpoint, idx) => {
      const found = rowsByEndpoint.get(endpoint) || newNodeRow(endpoint, 'runtime');
      const roleScores = computeNodeRoleScores(found);
      return {
        rank: idx + 1,
        endpoint,
        score: Number(found.score || 0),
        listenerScore: Number(roleScores.listenerScore || 0),
        syncScore: Number(roleScores.syncScore || 0),
        sendScore: Number(roleScores.sendScore || 0),
        successCount: Number(found.successCount || 0),
        failCount: Number(found.failCount || 0),
        broadcastSuccessCount: Number(found.broadcastSuccessCount || 0),
        broadcastFailCount: Number(found.broadcastFailCount || 0),
        listenerTxHitCount: Number(found.listenerTxHitCount || 0),
        listenerTxSeenCount: Number(found.listenerTxSeenCount || 0),
        lastListenerTxAt: found.lastListenerTxAt || null,
        avgBroadcastLatencyMs: Math.max(0, Number(found.avgBroadcastLatencyMs || 0)),
        consecutiveFail: Number(found.consecutiveFail || 0),
        banUntil: Number(found.banUntil || 0),
        lastSuccessAt: found.lastSuccessAt || null,
        lastFailAt: found.lastFailAt || null,
        roles: [
          'listener',
          ...(syncActual.includes(endpoint) ? ['sync_active'] : []),
        ],
        broadcastEligible: !syncActual.includes(endpoint),
        available: true,
      };
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .map((row, idx) => ({ ...row, rank: idx + 1 }));
  const rankedEndpoints = ranked
    .map((row) => String(row?.endpoint || '').trim())
    .filter(Boolean);
  const candidateRows = (rankedEndpoints.length ? rankedEndpoints : sortedRows.map((row) => String(row?.endpoint || '').trim()).filter(Boolean))
    .map((endpoint, idx) => {
      const row = rowsByEndpoint.get(endpoint) || newNodeRow(endpoint, 'selector');
      const roleScores = computeNodeRoleScores(row);
      const activeSync = syncActual.includes(endpoint);
      const connectedListener = connectedNodes.includes(endpoint);
      return {
        rank: idx + 1,
        endpoint,
        score: Number(row.score || 0),
        listenerScore: Number(roleScores.listenerScore || 0),
        syncScore: Number(roleScores.syncScore || 0),
        sendScore: Number(roleScores.sendScore || 0),
        successCount: Number(row.successCount || 0),
        failCount: Number(row.failCount || 0),
      broadcastSuccessCount: Number(row.broadcastSuccessCount || 0),
      broadcastFailCount: Number(row.broadcastFailCount || 0),
      listenerTxHitCount: Number(row.listenerTxHitCount || 0),
      listenerTxSeenCount: Number(row.listenerTxSeenCount || 0),
      lastListenerTxAt: row.lastListenerTxAt || null,
      avgBroadcastLatencyMs: Math.max(0, Number(row.avgBroadcastLatencyMs || 0)),
        consecutiveFail: Number(row.consecutiveFail || 0),
        banUntil: Number(row.banUntil || 0),
        lastSuccessAt: row.lastSuccessAt || null,
        lastFailAt: row.lastFailAt || null,
        roles: [
          ...(connectedListener ? ['listener'] : []),
          ...(activeSync ? ['sync_active'] : []),
          ...(!connectedListener && !activeSync ? ['candidate'] : []),
        ],
        broadcastEligible: !activeSync,
        available: !Number(row.banUntil || 0) || Number(row.banUntil || 0) <= now,
      };
    });
  const workingPool = Array.from(new Set([
    ...connectedNodes,
    ...connectingNodes,
    ...syncActual,
    ...ranked.slice(0, SPV_NODE_CONNECT_TOP).map((row) => String(row?.endpoint || '').trim()).filter(Boolean),
  ])).filter(Boolean);
  const standbyPool = ranked
    .map((row) => String(row?.endpoint || '').trim())
    .filter(Boolean)
    .filter((endpoint) => !workingPool.includes(endpoint))
    .slice(0, SPV_NODE_POOL_MAX);
  Object.assign(walletNodeManagerState, {
    updatedAt: nowIso(),
    candidatePool: ranked.map((row) => String(row?.endpoint || '').trim()).filter(Boolean),
    candidateScores,
    probeQueue: standbyPool.slice(0, SPV_NODE_PROBE_RESERVE_COUNT),
    workingPool,
    standbyPool,
    listenerAssignedTarget: effectiveListenerTarget,
    listenerAssignedActual: listenerActual,
    syncAssignedTarget: syncActual.slice(),
    syncAssignedActual: syncActual.slice(),
    sendAssignedTarget: [],
    sendAssignedActual: [],
    walletAvailable: listenerActual.length >= 1,
    walletReadable: listenerActual.length >= 1,
    walletSendEnabled: walletRuntimePolicy.sendEnabled,
    availabilityReason: listenerActual.length >= 1
      ? String(walletRuntimePolicy.reason || '')
      : String(walletRuntimePolicy.reason || 'catchup_no_listener_capacity'),
    displayConnectedCount: displayConnected.length,
    displayCandidateCount: availableRows.length,
    displayTotalCount: sortedRows.length,
    displayRecentConnected: recentConnected,
    displayConnected,
    displayCandidates: candidateRows,
  });
  return cloneWalletNodeManagerState();
}

function cloneWalletNodeManagerState() {
  return {
    updatedAt: walletNodeManagerState.updatedAt,
    candidatePool: walletNodeManagerState.candidatePool.slice(),
    candidateScores: { ...walletNodeManagerState.candidateScores },
    probeQueue: walletNodeManagerState.probeQueue.slice(),
    workingPool: walletNodeManagerState.workingPool.slice(),
    standbyPool: walletNodeManagerState.standbyPool.slice(),
    listenerAssignedTarget: walletNodeManagerState.listenerAssignedTarget.slice(),
    listenerAssignedActual: walletNodeManagerState.listenerAssignedActual.slice(),
    syncAssignedTarget: walletNodeManagerState.syncAssignedTarget.slice(),
    syncAssignedActual: walletNodeManagerState.syncAssignedActual.slice(),
    sendAssignedTarget: walletNodeManagerState.sendAssignedTarget.slice(),
    sendAssignedActual: walletNodeManagerState.sendAssignedActual.slice(),
    walletAvailable: walletNodeManagerState.walletAvailable === true,
    walletReadable: walletNodeManagerState.walletReadable === true,
    walletSendEnabled: walletNodeManagerState.walletSendEnabled === true,
    availabilityReason: String(walletNodeManagerState.availabilityReason || ''),
    displayConnectedCount: Math.max(0, Number(walletNodeManagerState.displayConnectedCount || 0)),
    displayCandidateCount: Math.max(0, Number(walletNodeManagerState.displayCandidateCount || 0)),
    displayTotalCount: Math.max(0, Number(walletNodeManagerState.displayTotalCount || 0)),
    displayRecentConnected: Math.max(0, Number(walletNodeManagerState.displayRecentConnected || 0)),
    displayConnected: Array.isArray(walletNodeManagerState.displayConnected) ? walletNodeManagerState.displayConnected.slice() : [],
    displayCandidates: Array.isArray(walletNodeManagerState.displayCandidates) ? walletNodeManagerState.displayCandidates.slice() : [],
  };
}

function getWalletNodeManagerSnapshot() {
  refreshWalletNodeManagerState();
  return cloneWalletNodeManagerState();
}

function getWalletDisplayNodeSnapshot(limit = 20) {
  const cap = Math.max(1, Math.min(Number(limit) || 20, 100));
  const snapshot = getWalletNodeManagerSnapshot();
  return {
    connectedCount: Math.max(0, Number(snapshot.displayConnectedCount || 0)),
    candidateCount: Math.max(0, Number(snapshot.displayCandidateCount || 0)),
    totalCount: Math.max(0, Number(snapshot.displayTotalCount || 0)),
    recentConnected: Math.max(0, Number(snapshot.displayRecentConnected || 0)),
    connected: Array.isArray(snapshot.displayConnected) ? snapshot.displayConnected.slice(0, cap) : [],
    candidates: Array.isArray(snapshot.displayCandidates) ? snapshot.displayCandidates.slice(0, cap) : [],
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  removeLegacyTxContextFile();
  if (!fs.existsSync(SPV_INDEX_FILE)) resetSpvIndex();
  scheduleBroadcastMonitor(2000);
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    appendSendLog('json_read_failed', {
      file,
      message: err?.message || 'json parse failed',
    });
    return fallback;
  }
}

function fileMtimeKey(file) {
  try {
    const stat = fs.statSync(file);
    return `${Number(stat.size || 0)}:${Number(stat.mtimeMs || 0)}`;
  } catch (_) {
    return 'missing';
  }
}

function walletBalanceHistoryCacheStableKey() {
  return [
    fileMtimeKey(SPV_INDEX_FILE),
    fileMtimeKey(CACHE_FILE),
    fileMtimeKey(NOTES_FILE),
  ].join('|');
}

function rememberWalletBalanceHistoryCache(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  walletBalanceHistoryCache = snapshot;
  walletBalanceHistoryCacheKey = walletBalanceHistoryCacheStableKey();
  return walletBalanceHistoryCache;
}

function invalidateWalletBalanceHistoryCache() {
  walletBalanceHistoryCache = null;
  walletBalanceHistoryCacheKey = '';
}

function cloneWalletStateSnapshotValue(state) {
  if (!state || typeof state !== 'object') return null;
  try {
    return JSON.parse(JSON.stringify(state));
  } catch (_) {
    return null;
  }
}

function replaceWalletStateSnapshot(state, meta = {}) {
  walletStateSnapshot = cloneWalletStateSnapshotValue(state);
  walletStateSnapshotLoaded = true;
  walletStateSnapshotVersion += 1;
  walletStateSnapshotUpdatedAt = Number(meta.updatedAtMs || Date.now());
  return walletStateSnapshot;
}

function cloneSpvNodeStateValue(state) {
  if (!state || typeof state !== 'object') return { version: 1, nodes: [] };
  return {
    version: 1,
    nodes: Array.isArray(state.nodes) ? state.nodes.map((row) => ({ ...row })) : [],
  };
}

function replaceSpvNodeStateSnapshot(state) {
  spvNodeStateSnapshot = cloneSpvNodeStateValue(state);
  spvNodeStateSnapshotLoaded = true;
  return spvNodeStateSnapshot;
}

function persistSpvNodeStateSnapshotNow() {
  if (spvNodeStatePersistTimer) {
    clearTimeout(spvNodeStatePersistTimer);
    spvNodeStatePersistTimer = null;
  }
  const snapshot = spvNodeStateSnapshotLoaded ? cloneSpvNodeStateValue(spvNodeStateSnapshot) : null;
  if (!snapshot) return;
  writeJsonLocked(SPV_NODE_STATE_FILE, snapshot, {
    timeoutMs: 6000,
    retryDelayMs: 30,
    staleAfterMs: 15000,
  });
  spvNodeStateLastPersistAt = Date.now();
}

function scheduleSpvNodeStatePersist(delayMs = 15000) {
  if (spvNodeStatePersistTimer) return;
  spvNodeStatePersistTimer = setTimeout(() => {
    spvNodeStatePersistTimer = null;
    try {
      persistSpvNodeStateSnapshotNow();
    } catch (err) {
      appendSendLog('spv_node_state_deferred_write_failed', {
        message: String(err?.message || err || 'spv node state write failed'),
      });
    }
  }, Math.max(250, Number(delayMs || 0)));
  spvNodeStatePersistTimer.unref?.();
}

function invalidateWalletStateSnapshot() {
  walletStateSnapshot = null;
  walletStateSnapshotLoaded = false;
}

function clearSpvTxObservationCache() {
  spvTxObservationCache.clear();
}

function rememberSpvTxObservation(txid, patch = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return null;
  const prev = spvTxObservationCache.get(safeTxid) || {};
  const next = {
    relevant: patch.relevant === true || (patch.relevant !== false && prev.relevant === true),
    confirmedSeen: patch.confirmedSeen === true || prev.confirmedSeen === true,
    seenAt: Date.now(),
    node: String(patch.node || prev.node || ''),
  };
  spvTxObservationCache.delete(safeTxid);
  spvTxObservationCache.set(safeTxid, next);
  while (spvTxObservationCache.size > SPV_TX_OBSERVATION_CACHE_MAX) {
    const oldestKey = spvTxObservationCache.keys().next().value;
    if (!oldestKey) break;
    spvTxObservationCache.delete(oldestKey);
  }
  if (next.confirmedSeen || next.node) {
    markBroadcastMonitorSuccess(safeTxid, {
      reason: next.confirmedSeen ? 'listener_confirmed_observed' : 'listener_mempool_observed',
      node: next.node,
    });
  } else {
    appendSendLog('broadcast_monitor_listener_observation_ignored', {
      txid: safeTxid,
      reason: 'missing_external_node',
    });
  }
  return next;
}

function getSpvTxObservation(txid) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return null;
  const row = spvTxObservationCache.get(safeTxid) || null;
  if (!row) return null;
  spvTxObservationCache.delete(safeTxid);
  spvTxObservationCache.set(safeTxid, row);
  return row;
}

function getSpvTxObservationFromIndex(txid) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return null;
  const txRow = getSpvIndex()?.txs?.[safeTxid] || null;
  if (!txRow) return null;
  const relevant = Boolean(
    txRow.applied === true
    || Number(txRow.receivedSat || 0) > 0
    || Number(txRow.spentSat || 0) > 0
    || Number(txRow.netSat || 0) !== 0
  );
  if (!relevant && txRow.confirmed !== true) return null;
  if (txRow.confirmed === true) {
    markBroadcastMonitorSuccess(safeTxid, {
      reason: 'sync_confirmed_index',
      node: 'spv_index',
    });
  }
  return {
    relevant,
    confirmedSeen: Boolean(txRow.confirmed),
    seenAt: Date.now(),
    node: 'spv_index',
  };
}

async function waitForSpvTxObservation(txid, timeoutMs = SEND_OBSERVATION_WAIT_MS) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return null;
  const deadline = Date.now() + Math.max(0, Number(timeoutMs || 0));
  let row = getSpvTxObservation(safeTxid) || getSpvTxObservationFromIndex(safeTxid);
  if (row) return row;
  while (Date.now() < deadline) {
    await sleep(Math.min(250, Math.max(25, deadline - Date.now())));
    row = getSpvTxObservation(safeTxid) || getSpvTxObservationFromIndex(safeTxid);
    if (row) return row;
  }
  return getSpvTxObservation(safeTxid) || getSpvTxObservationFromIndex(safeTxid);
}

function normalizeBroadcastMonitorRecord(row = {}) {
  const txid = String(row?.txid || '').trim().toLowerCase();
  return {
    txid,
    rawtx: String(row?.rawtx || '').trim(),
    status: String(row?.status || 'broadcast_pending_confirm').trim(),
    source: String(row?.source || '').trim(),
    nodes: Array.from(new Set((Array.isArray(row?.nodes) ? row.nodes : [])
      .map((node) => String(node || '').trim())
      .filter(Boolean))).slice(0, BROADCAST_PENDING_MIN_NODES),
    createdAt: String(row?.createdAt || new Date().toISOString()),
    updatedAt: String(row?.updatedAt || row?.createdAt || new Date().toISOString()),
    lastProbeAt: String(row?.lastProbeAt || ''),
    nextProbeAt: String(row?.nextProbeAt || ''),
    successAt: String(row?.successAt || ''),
    failedAt: String(row?.failedAt || ''),
    successReason: String(row?.successReason || ''),
    failureReason: String(row?.failureReason || ''),
    retryCount: Math.max(0, Number(row?.retryCount || 0)),
    probeCount: Math.max(0, Number(row?.probeCount || 0)),
  };
}

function readBroadcastMonitorState() {
  const raw = readJson(BROADCAST_MONITOR_FILE, { version: 1, records: [] });
  const records = (Array.isArray(raw?.records) ? raw.records : [])
    .map((row) => normalizeBroadcastMonitorRecord(row))
    .filter((row) => /^[0-9a-f]{64}$/i.test(row.txid));
  return { version: 1, records };
}

function writeBroadcastMonitorState(state) {
  writeJsonLocked(BROADCAST_MONITOR_FILE, {
    version: 1,
    records: (Array.isArray(state?.records) ? state.records : [])
      .map((row) => normalizeBroadcastMonitorRecord(row))
      .filter((row) => /^[0-9a-f]{64}$/i.test(row.txid))
      .slice(-200),
  }, {
    timeoutMs: 6000,
    retryDelayMs: 30,
    staleAfterMs: 15000,
  });
}

function listBroadcastMonitorRecords(options = {}) {
  const includeRawtx = options.includeRawtx === true;
  return readBroadcastMonitorState().records
    .slice()
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .map((row) => ({
      ...row,
      rawtx: includeRawtx ? row.rawtx : '',
      rawtxBytes: Math.floor(String(row.rawtx || '').length / 2),
    }));
}

function scheduleBroadcastMonitor(delayMs = BROADCAST_MONITOR_PROBE_MS) {
  if (broadcastMonitorTimer) return;
  broadcastMonitorTimer = setTimeout(() => {
    broadcastMonitorTimer = null;
    monitorPendingBroadcasts().catch((err) => {
      appendSendLog('broadcast_monitor_tick_failed', {
        error: String(err?.message || err || 'broadcast monitor failed'),
      });
    });
  }, Math.max(1000, Number(delayMs || 0)));
  broadcastMonitorTimer.unref?.();
}

function upsertPendingBroadcastMonitor({ txid, rawtx, nodes = [], source = '' } = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  const safeRawtx = String(rawtx || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid) || !safeRawtx) return null;
  const state = readBroadcastMonitorState();
  const now = new Date().toISOString();
  const existingIndex = state.records.findIndex((row) => row.txid === safeTxid);
  const prev = existingIndex >= 0 ? state.records[existingIndex] : {};
  const next = normalizeBroadcastMonitorRecord({
    ...prev,
    txid: safeTxid,
    rawtx: safeRawtx,
    status: 'broadcast_pending_confirm',
    source,
    nodes,
    createdAt: prev.createdAt || now,
    updatedAt: now,
    nextProbeAt: new Date(Date.now() + BROADCAST_MONITOR_PROBE_MS).toISOString(),
    failureReason: '',
    failedAt: '',
  });
  if (existingIndex >= 0) state.records[existingIndex] = next;
  else state.records.push(next);
  writeBroadcastMonitorState(state);
  appendSendLog('broadcast_monitor_pending_upserted', {
    txid: safeTxid,
    source: String(source || ''),
    nodes: next.nodes,
    nextProbeAt: next.nextProbeAt,
  });
  scheduleBroadcastMonitor(BROADCAST_MONITOR_PROBE_MS);
  return next;
}

function markBroadcastMonitorSuccess(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return false;
  const state = readBroadcastMonitorState();
  const index = state.records.findIndex((row) => row.txid === safeTxid);
  if (index < 0) return false;
  const now = new Date().toISOString();
  const prev = state.records[index];
  if (String(prev.status || '') === 'broadcast_success') return false;
  state.records[index] = normalizeBroadcastMonitorRecord({
    ...prev,
    status: 'broadcast_success',
    updatedAt: now,
    successAt: now,
    successReason: String(options.reason || 'observed').trim(),
    failureReason: '',
  });
  writeBroadcastMonitorState(state);
  appendSendLog('broadcast_monitor_mark_success', {
    txid: safeTxid,
    reason: String(options.reason || 'observed'),
    node: String(options.node || ''),
  });
  return true;
}

function markBroadcastMonitorFailed(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return false;
  const state = readBroadcastMonitorState();
  const index = state.records.findIndex((row) => row.txid === safeTxid);
  if (index < 0) return false;
  const now = new Date().toISOString();
  const prev = state.records[index];
  state.records[index] = normalizeBroadcastMonitorRecord({
    ...prev,
    status: 'broadcast_failed',
    updatedAt: now,
    failedAt: now,
    failureReason: String(options.reason || 'mempool_notfound').trim(),
  });
  writeBroadcastMonitorState(state);
  try {
    revertPendingWalletTx(safeTxid, {
      reason: String(options.reason || 'broadcast_monitor_failed'),
    });
  } catch (err) {
    appendSendLog('broadcast_monitor_revert_failed', {
      txid: safeTxid,
      error: String(err?.message || err || 'revert failed'),
    });
  }
  appendSendLog('broadcast_monitor_mark_failed', {
    txid: safeTxid,
    reason: String(options.reason || 'mempool_notfound'),
  });
  return true;
}

async function monitorPendingBroadcasts(options = {}) {
  const force = options.force === true;
  const state = readBroadcastMonitorState();
  const nowMs = Date.now();
  let pendingRemain = false;
  for (let i = 0; i < state.records.length; i += 1) {
    const row = normalizeBroadcastMonitorRecord(state.records[i]);
    if (row.status !== 'broadcast_pending_confirm') continue;
    const dueMs = Date.parse(row.nextProbeAt || row.createdAt || '') || 0;
    if (!force && dueMs > nowMs) {
      pendingRemain = true;
      continue;
    }
    if (!row.nodes.length) {
      markBroadcastMonitorFailed(row.txid, { reason: 'broadcast_monitor_no_nodes' });
      continue;
    }
    const probe = await probeTxidOnBroadcastNodes(row.txid, row.nodes, {
      delayMs: 0,
      timeoutMs: BROADCAST_MONITOR_PROBE_TIMEOUT_MS,
      connectTimeoutMs: SEND_CONNECT_TIMEOUT_MS,
    });
    const hitCount = Array.isArray(probe?.hits) ? probe.hits.length : 0;
    if (hitCount > 0) {
      markBroadcastMonitorSuccess(row.txid, {
        reason: 'mempool_probe_hit',
        node: String(probe.hits[0]?.node || ''),
      });
      continue;
    }
    const missCount = Array.isArray(probe?.misses) ? probe.misses.length : 0;
    if (missCount >= row.nodes.length) {
      markBroadcastMonitorFailed(row.txid, { reason: 'mempool_notfound_on_sent_nodes' });
      continue;
    }
    const latest = readBroadcastMonitorState();
    const latestIndex = latest.records.findIndex((item) => item.txid === row.txid);
    if (latestIndex >= 0) {
      latest.records[latestIndex] = normalizeBroadcastMonitorRecord({
        ...latest.records[latestIndex],
        updatedAt: new Date().toISOString(),
        lastProbeAt: new Date().toISOString(),
        nextProbeAt: new Date(Date.now() + BROADCAST_MONITOR_PROBE_MS).toISOString(),
        probeCount: row.probeCount + 1,
        failureReason: `probe_inconclusive:${JSON.stringify((probe?.errors || []).slice(0, 3))}`,
      });
      writeBroadcastMonitorState(latest);
    }
    pendingRemain = true;
  }
  if (pendingRemain) scheduleBroadcastMonitor(BROADCAST_MONITOR_PROBE_MS);
  return listBroadcastMonitorRecords();
}

function loadWalletStateSnapshotFromDisk() {
  const state = readJson(STATE_FILE, null);
  if (!state) {
    walletStateSnapshot = null;
    walletStateSnapshotLoaded = true;
    walletStateSnapshotVersion += 1;
    walletStateSnapshotUpdatedAt = Date.now();
    return null;
  }
  return replaceWalletStateSnapshot(state, { updatedAtMs: Date.now() });
}

function getWalletStateSnapshotInternal(options = {}) {
  const forceReload = options && options.forceReload === true;
  if (forceReload) return loadWalletStateSnapshotFromDisk();
  if (!walletStateSnapshotLoaded) loadWalletStateSnapshotFromDisk();
  if (walletStateSnapshotLoaded && !walletStateSnapshot && fs.existsSync(STATE_FILE)) {
    return loadWalletStateSnapshotFromDisk();
  }
  return walletStateSnapshot;
}

function getWalletStateSnapshot(options = {}) {
  return cloneWalletStateSnapshotValue(getWalletStateSnapshotInternal(options));
}

function writeJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  const startedAt = Date.now();
  let lastError = null;
  while ((Date.now() - startedAt) < 3000) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      const code = String(err?.code || '').toUpperCase();
      const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
      if (!transient) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
        throw err;
      }
      // Windows can briefly lock target files. Copy-over is still vulnerable to
      // the same lock, so retry both paths for a short bounded window.
      lastError = err;
      try {
        fs.copyFileSync(tmp, file);
        fs.unlinkSync(tmp);
        appendSendLog('json_write_fallback_copy', {
          file,
          code: code || 'UNKNOWN',
        });
        return;
      } catch (copyErr) {
        lastError = copyErr;
        const copyCode = String(copyErr?.code || '').toUpperCase();
        const copyTransient = copyCode === 'EPERM' || copyCode === 'EACCES' || copyCode === 'EBUSY';
        if (!copyTransient) {
          try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
          throw copyErr;
        }
        sleepSync(50);
      }
    }
  }
  try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
  throw lastError || new Error(`failed to write json: ${file}`);
}

function sleepSync(ms) {
  const delay = Math.max(0, Number(ms || 0));
  if (!delay) return;
  const buf = new SharedArrayBuffer(4);
  const view = new Int32Array(buf);
  Atomics.wait(view, 0, 0, delay);
}

function withFileLock(lockFile, fn, options = {}) {
  const timeoutMs = Math.max(250, Number(options.timeoutMs || 4000));
  const retryDelayMs = Math.max(5, Number(options.retryDelayMs || 25));
  const staleAfterMs = Math.max(1000, Number(options.staleAfterMs || 15000));
  const startedAt = Date.now();
  while (true) {
    let fd = null;
    try {
      fd = fs.openSync(lockFile, 'wx');
      try {
        fs.writeFileSync(fd, JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }));
      } catch (_) {}
      try {
        return fn();
      } finally {
        try { fs.closeSync(fd); } catch (_) {}
        try { fs.unlinkSync(lockFile); } catch (_) {}
      }
    } catch (err) {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch (_) {}
      }
      const code = String(err?.code || '').toUpperCase();
      if (code !== 'EEXIST') throw err;
      try {
        const stat = fs.statSync(lockFile);
        if ((Date.now() - Number(stat.mtimeMs || 0)) > staleAfterMs) {
          try { fs.unlinkSync(lockFile); } catch (_) {}
          continue;
        }
      } catch (_) {}
      if ((Date.now() - startedAt) >= timeoutMs) {
        const timeoutErr = new Error(`file lock timeout: ${lockFile}`);
        timeoutErr.code = 'ELOCKTIMEOUT';
        throw timeoutErr;
      }
      sleepSync(retryDelayMs);
    }
  }
}

function writeJsonLocked(file, data, options = {}) {
  const lockFile = `${file}.lock`;
  return withFileLock(lockFile, () => writeJson(file, data), options);
}

function appendRecoverLog(event, payload = {}) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...payload,
    });
    fs.appendFileSync(RECOVER_LOG_FILE, `${line}\n`);
  } catch (_) {}
}

function clearRecoverLog() {
  try {
    fs.writeFileSync(RECOVER_LOG_FILE, '');
  } catch (_) {}
}

function appendSendLog(event, payload = {}) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...payload,
    });
    fs.appendFileSync(SEND_LOG_FILE, `${line}\n`);
  } catch (_) {}
}

function buildWalletBalanceAuditSnapshot(index = null) {
  const safeIndex = index || getSpvIndex() || {};
  const staleTxids = new Set(Object.keys(safeIndex?.stalePendingTxs || {})
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid)));
  let confirmed = 0;
  let selfChangePending = 0;
  let unconfirmedIncoming = 0;
  let spendableUtxoCount = 0;
  for (const [outpoint, utxo] of Object.entries(safeIndex?.utxos || {})) {
    if (safeIndex?.spentOutpoints?.[outpoint]) continue;
    const txid = String(utxo?.txId || utxo?.txid || '').trim().toLowerCase();
    if (utxo?.confirmed !== true && staleTxids.has(txid)) continue;
    const satoshis = Math.max(0, Number(utxo?.satoshis || 0));
    if (satoshis <= 0) continue;
    spendableUtxoCount += 1;
    if (utxo?.confirmed === true) {
      confirmed += satoshis;
      continue;
    }
    const row = safeIndex?.txs?.[txid] || {};
    if (Number(row?.spentSat || 0) > 0) selfChangePending += satoshis;
    else unconfirmedIncoming += satoshis;
  }
  const spentOutpointCount = Object.keys(safeIndex?.spentOutpoints || {}).length;
  const txCount = Object.keys(safeIndex?.txs || {}).length;
  const pendingDelta = selfChangePending;
  return {
    confirmed,
    unconfirmed: unconfirmedIncoming,
    selfChangePending,
    pendingDelta,
    available: confirmed + pendingDelta,
    total: confirmed + selfChangePending + unconfirmedIncoming,
    utxoCount: Object.keys(safeIndex?.utxos || {}).length,
    spendableUtxoCount,
    spentOutpointCount,
    txCount,
    stalePendingTxCount: staleTxids.size,
  };
}

function appendWalletBalanceAudit(event, before = null, after = null, payload = {}) {
  const prev = before || {};
  const next = after || {};
  appendSendLog(event, {
    ...payload,
    before: prev,
    after: next,
    delta: {
      confirmed: Number(next.confirmed || 0) - Number(prev.confirmed || 0),
      unconfirmed: Number(next.unconfirmed || 0) - Number(prev.unconfirmed || 0),
      pendingDelta: Number(next.pendingDelta || 0) - Number(prev.pendingDelta || 0),
      available: Number(next.available || 0) - Number(prev.available || 0),
      total: Number(next.total || 0) - Number(prev.total || 0),
      utxoCount: Number(next.utxoCount || 0) - Number(prev.utxoCount || 0),
      spentOutpointCount: Number(next.spentOutpointCount || 0) - Number(prev.spentOutpointCount || 0),
    },
  });
}

function txHasOpReturnOutput(txLike) {
  const tx = txFromUnknown(txLike);
  if (!tx || !Array.isArray(tx.outputs)) return false;
  return tx.outputs.some((output) => {
    try {
      const hex = String(output?.script?.toHex?.() || '').trim().toLowerCase();
      return hex.startsWith('6a') || hex.startsWith('006a');
    } catch (_) {
      return false;
    }
  });
}

function publishObservedChainRawtx(txLike, {
  confirmed = false,
  node = '',
  source = 'wallet_listener',
  walletRelevant = false,
} = {}) {
  const rawtx = rawtxHexFromUnknown(txLike);
  if (!rawtx || !txHasOpReturnOutput(txLike)) return false;
  const rawtxLower = rawtx.toLowerCase();
  const marketRelevant = rawtxLower.includes(MARKET_CHAIN_MARKER_HEX);
  if (!marketRelevant && walletRelevant !== true) return false;
  const tx = txFromUnknown(txLike);
  const txid = String(tx?.id || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) return false;
  try {
    messageQueue.publish('chain.rawtx.seen', {
      txid,
      rawtx,
      confirmed: confirmed === true,
      node: String(node || ''),
      walletRelevant: walletRelevant === true,
      firstSeenAt: new Date().toISOString(),
    }, {
      mode: messageQueue.MODE_TRANSIENT,
      source,
      dedupeKey: `chain.rawtx.seen:${txid}:${confirmed === true ? 'confirmed' : 'unconfirmed'}`,
    });
    appendSendLog('chain_rawtx_seen_published', {
      txid,
      node: String(node || ''),
      confirmed: confirmed === true,
      walletRelevant: walletRelevant === true,
      marketRelevant,
      rawtxBytes: Math.floor(rawtx.length / 2),
    });
    return true;
  } catch (err) {
    appendSendLog('chain_rawtx_seen_publish_failed', {
      txid,
      node: String(node || ''),
      error: String(err?.message || err || 'publish failed'),
    });
    return false;
  }
}

function readFileRawOrNull(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  } catch (_) {
    return null;
  }
}

function restoreFileRaw(file, raw) {
  try {
    if (raw === null) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      return;
    }
    fs.writeFileSync(file, raw);
  } catch (_) {}
}

function walletExists() {
  const keystoreExists = fs.existsSync(KEYSTORE_FILE);
  const stateExists = fs.existsSync(STATE_FILE);
  const exists = keystoreExists && stateExists;
  const diagKey = JSON.stringify({
    exists,
    keystoreExists,
    stateExists,
    dataDir: DATA_DIR,
    keystoreFile: KEYSTORE_FILE,
    stateFile: STATE_FILE,
  });
  if (diagKey !== lastWalletExistsDiagKey) {
    lastWalletExistsDiagKey = diagKey;
    try {
      console.log('[wallet-exists]', diagKey);
    } catch (_) {}
  }
  return exists;
}

function resetWalletData() {
  ensureDataDir();
  const files = [
    KEYSTORE_FILE,
    STATE_FILE,
    CACHE_FILE,
    SPV_INDEX_FILE,
    NOTES_FILE,
    RECOVER_LOG_FILE,
    SEND_LOG_FILE,
  ];
  files.forEach((file) => {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (_) {}
  });
  invalidateWalletStateSnapshot();
}

function deriveAddress(hdPrivateKey, index, pathBase = PATH_BASE) {
  const derived = hdPrivateKey.deriveChild(`${pathBase}/${index}`);
  return {
    index,
    address: derived.privateKey.toAddress(NETWORK).toString(),
    balance: 0,
  };
}

function getHdPrivateKeyFromMnemonic(mnemonic) {
  if (!BsvHDPrivateKey || typeof BsvHDPrivateKey.fromSeed !== 'function') {
    throw new Error('BSV runtime is invalid: HDPrivateKey.fromSeed is unavailable');
  }
  const seed = new Mnemonic(mnemonic).toSeed();
  return BsvHDPrivateKey.fromSeed(seed, NETWORK);
}

let cachedChatKeypairMnemonic = '';
let cachedChatKeypairValue = null;
const sharedChatSecretCache = new Map();

function deriveChatKeypairFromMnemonic(mnemonic) {
  const normalizedMnemonic = String(mnemonic || '').trim();
  if (normalizedMnemonic && cachedChatKeypairMnemonic === normalizedMnemonic && cachedChatKeypairValue) {
    return cachedChatKeypairValue;
  }
  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  const derived = hdPrivateKey.deriveChild(CHAT_PATH_BASE);
  const privateKey = derived?.privateKey || null;
  const publicKey = privateKey?.publicKey || null;
  const chatPubKey = publicKey?.toString?.() || '';
  if (!privateKey || !chatPubKey) {
    throw new Error('Failed to derive chat keypair from wallet mnemonic');
  }
  const keypair = {
    path: CHAT_PATH_BASE,
    privateKey,
    publicKey,
    chatPubKey,
  };
  cachedChatKeypairMnemonic = normalizedMnemonic;
  cachedChatKeypairValue = keypair;
  return keypair;
}

function deriveChatPublicKeyFromMnemonic(mnemonic) {
  return deriveChatKeypairFromMnemonic(mnemonic).chatPubKey;
}

function deriveSharedChatSecret(privateKeyLike, peerPublicKeyHex) {
  const privBuf = Buffer.isBuffer(privateKeyLike)
    ? privateKeyLike
    : privateKeyLike?.toBuffer?.();
  const pubHex = String(peerPublicKeyHex || '').trim();
  if (!Buffer.isBuffer(privBuf) || privBuf.length !== 32) throw new Error('Invalid chat private key');
  if (!/^[0-9a-f]{66}$/i.test(pubHex)) throw new Error('Invalid peer chat public key');
  const cacheKey = `${privBuf.toString('hex')}:${pubHex}`;
  if (sharedChatSecretCache.has(cacheKey)) return sharedChatSecretCache.get(cacheKey);
  const ecdh = crypto.createECDH('secp256k1');
  ecdh.setPrivateKey(privBuf);
  const shared = ecdh.computeSecret(Buffer.from(pubHex, 'hex'));
  const hashed = crypto.createHash('sha256').update(shared).digest();
  sharedChatSecretCache.set(cacheKey, hashed);
  if (sharedChatSecretCache.size > 32) {
    const oldestKey = sharedChatSecretCache.keys().next().value;
    if (oldestKey) sharedChatSecretCache.delete(oldestKey);
  }
  return hashed;
}

function buildChatSignaturePayload({
  senderPubKey,
  recipientPubKey,
  ciphertext,
  nonce,
  authTag,
  msgId = '',
  sessionId = '',
  fromWalletId = '',
  toWalletId = '',
  ts = '',
  orderId = '',
}) {
  return [
    String(senderPubKey || '').trim(),
    String(recipientPubKey || '').trim(),
    String(ciphertext || ''),
    String(nonce || ''),
    String(authTag || ''),
    String(msgId || ''),
    String(sessionId || ''),
    String(fromWalletId || ''),
    String(toWalletId || ''),
    String(ts || ''),
    String(orderId || ''),
  ].join('|');
}

function buildChatBindingSignaturePayload({
  walletId = '',
  merchantId = '',
  chatPubKey = '',
  endpointHints = [],
  relayHints = [],
  createdAt = '',
}) {
  const endpoints = Array.isArray(endpointHints) ? endpointHints.map((x) => String(x || '').trim()) : [];
  const relays = Array.isArray(relayHints) ? relayHints.map((x) => String(x || '').trim()) : [];
  return [
    String(walletId || '').trim(),
    String(merchantId || '').trim(),
    String(chatPubKey || '').trim(),
    JSON.stringify(endpoints),
    JSON.stringify(relays),
    String(createdAt || '').trim(),
  ].join('|');
}

function signWalletKeyBind({
  mnemonic,
  walletId = '',
  merchantId = '',
  chatPubKey = '',
  endpointHints = [],
  relayHints = [],
  createdAt = '',
}) {
  const keypair = deriveChatKeypairFromMnemonic(mnemonic);
  const claimedPubKey = String(chatPubKey || keypair.chatPubKey || '').trim();
  if (claimedPubKey !== keypair.chatPubKey) {
    throw new Error('wallet_key_bind chatPubKey does not match wallet-derived chat key');
  }
  const payload = buildChatBindingSignaturePayload({
    walletId,
    merchantId,
    chatPubKey: claimedPubKey,
    endpointHints,
    relayHints,
    createdAt,
  });
  const hash = bsv.crypto.Hash.sha256(Buffer.from(payload, 'utf8'));
  return bsv.crypto.ECDSA.sign(hash, keypair.privateKey).toString();
}

function verifyWalletKeyBind({
  walletId = '',
  merchantId = '',
  chatPubKey = '',
  endpointHints = [],
  relayHints = [],
  createdAt = '',
  signature = '',
}) {
  const pubKeyHex = String(chatPubKey || '').trim();
  const sigHex = String(signature || '').trim();
  if (!/^[0-9a-f]{66}$/i.test(pubKeyHex) || !/^[0-9a-f]+$/i.test(sigHex)) return false;
  try {
    const payload = buildChatBindingSignaturePayload({
      walletId,
      merchantId,
      chatPubKey: pubKeyHex,
      endpointHints,
      relayHints,
      createdAt,
    });
    const hash = bsv.crypto.Hash.sha256(Buffer.from(payload, 'utf8'));
    const sig = bsv.crypto.Signature.fromString(sigHex);
    const pub = new bsv.PublicKey(pubKeyHex);
    return bsv.crypto.ECDSA.verify(hash, sig, pub) === true;
  } catch (_) {
    return false;
  }
}

function signChatEnvelope({
  mnemonic,
  peerPublicKey,
  senderPubKey = '',
  recipientPubKey = '',
  ciphertext,
  nonce,
  authTag,
  msgId = '',
  sessionId = '',
  fromWalletId = '',
  toWalletId = '',
  ts = '',
  orderId = '',
}) {
  const keypair = deriveChatKeypairFromMnemonic(mnemonic);
  const key = deriveSharedChatSecret(keypair.privateKey, peerPublicKey);
  const payload = buildChatSignaturePayload({
    senderPubKey: String(senderPubKey || keypair.chatPubKey || '').trim(),
    recipientPubKey: String(recipientPubKey || peerPublicKey || '').trim(),
    ciphertext,
    nonce,
    authTag,
    msgId,
    sessionId,
    fromWalletId,
    toWalletId,
    ts,
    orderId,
  });
  return crypto.createHmac('sha256', key).update(payload, 'utf8').digest('hex');
}

function verifyChatEnvelope({
  mnemonic,
  peerPublicKey,
  senderPubKey = '',
  recipientPubKey = '',
  ciphertext,
  nonce,
  authTag,
  msgId = '',
  sessionId = '',
  fromWalletId = '',
  toWalletId = '',
  ts = '',
  orderId = '',
  signature,
}) {
  const expected = signChatEnvelope({
    mnemonic,
    peerPublicKey,
    senderPubKey,
    recipientPubKey: String(recipientPubKey || deriveChatPublicKeyFromMnemonic(mnemonic) || '').trim(),
    ciphertext,
    nonce,
    authTag,
    msgId,
    sessionId,
    fromWalletId,
    toWalletId,
    ts,
    orderId,
  });
  const given = String(signature || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(given) || !/^[0-9a-f]{64}$/i.test(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given, 'hex'));
}

function encryptChatMessage({ mnemonic, peerPublicKey, text }) {
  const plain = String(text || '');
  if (!plain) throw new Error('Chat message text is required');
  const keypair = deriveChatKeypairFromMnemonic(mnemonic);
  const key = deriveSharedChatSecret(keypair.privateKey, peerPublicKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    senderPubKey: keypair.chatPubKey,
    ciphertext: ciphertext.toString('base64'),
    nonce: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

function decryptChatMessage({ mnemonic, peerPublicKey, ciphertext, nonce, authTag }) {
  const keypair = deriveChatKeypairFromMnemonic(mnemonic);
  const key = deriveSharedChatSecret(keypair.privateKey, peerPublicKey);
  const iv = Buffer.from(String(nonce || ''), 'base64');
  const tag = Buffer.from(String(authTag || ''), 'base64');
  const enc = Buffer.from(String(ciphertext || ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function generateMnemonic() {
  return new Mnemonic().toString();
}

function encryptMnemonic(mnemonic, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    network: NETWORK,
    kdf: {
      name: 'scrypt',
      salt: salt.toString('hex'),
      keyLen: 32,
    },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      ciphertext: encrypted.toString('hex'),
    },
    createdAt: new Date().toISOString(),
  };
}

function decryptMnemonic(keystore, password) {
  const salt = Buffer.from(keystore.kdf.salt, 'hex');
  const iv = Buffer.from(keystore.cipher.iv, 'hex');
  const authTag = Buffer.from(keystore.cipher.authTag, 'hex');
  const ciphertext = Buffer.from(keystore.cipher.ciphertext, 'hex');
  const key = crypto.scryptSync(password, salt, keystore.kdf.keyLen || 32);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

let cachedMnemonicPassword = '';
let cachedMnemonicFingerprint = '';
let cachedMnemonicValue = '';

function keystoreFingerprint(keystore) {
  return [
    String(keystore?.kdf?.salt || ''),
    String(keystore?.cipher?.iv || ''),
    String(keystore?.cipher?.authTag || ''),
    String(keystore?.cipher?.ciphertext || '').length,
  ].join(':');
}

function getMnemonicFromPassword(password) {
  if (!walletExists()) throw new Error('Wallet does not exist');
  const keystore = readJson(KEYSTORE_FILE, null);
  if (!keystore) throw new Error('Keystore missing');
  const normalizedPassword = String(password || '');
  const fingerprint = keystoreFingerprint(keystore);
  if (
    cachedMnemonicValue
    && cachedMnemonicPassword === normalizedPassword
    && cachedMnemonicFingerprint === fingerprint
  ) {
    return cachedMnemonicValue;
  }
  try {
    const mnemonic = decryptMnemonic(keystore, normalizedPassword);
    cachedMnemonicPassword = normalizedPassword;
    cachedMnemonicFingerprint = fingerprint;
    cachedMnemonicValue = mnemonic;
    return mnemonic;
  } catch (_) {
    throw new Error('Invalid password');
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wocRateLimitWait(options = {}) {
  if (!ALLOW_WOC_HTTP && options.allowDisabled !== true) throw new Error('WOC_DISABLED');
  const now = Date.now();
  if (now < wocNextAt) {
    await sleep(wocNextAt - now);
  }
  wocNextAt = Date.now() + WOC_MIN_INTERVAL_MS;
}

function getSpvIndex(options = {}) {
  const forceReload = options === true || options?.forceReload === true;
  let diskMtimeMs = 0;
  try {
    if (fs.existsSync(SPV_INDEX_FILE)) {
      diskMtimeMs = Number(fs.statSync(SPV_INDEX_FILE).mtimeMs || 0);
    }
  } catch (_) {
    diskMtimeMs = 0;
  }
  if (
    !forceReload
    && spvIndexSnapshotLoaded
    && spvIndexSnapshot
    && typeof spvIndexSnapshot === 'object'
    && (!diskMtimeMs || diskMtimeMs <= spvIndexSnapshotMtimeMs)
  ) {
    return spvIndexSnapshot;
  }
  spvIndexSnapshot = readJson(SPV_INDEX_FILE, {
    version: 1,
    utxos: {},
    ownedOutpoints: {},
    spentOutpoints: {},
    txs: {},
    updatedAt: null,
  });
  spvIndexSnapshotLoaded = true;
  spvIndexSnapshotMtimeMs = diskMtimeMs || Date.now();
  walletTouchHintsCache = null;
  walletTouchHintsCacheKey = '';
  return spvIndexSnapshot;
}

function invalidateSpvIndexSnapshot() {
  spvIndexSnapshot = null;
  spvIndexSnapshotLoaded = false;
  spvIndexSnapshotMtimeMs = 0;
  walletTouchHintsCache = null;
  walletTouchHintsCacheKey = '';
  invalidateWalletBalanceHistoryCache();
}

function saveSpvIndex(index) {
  index.updatedAt = new Date().toISOString();
  writeJson(SPV_INDEX_FILE, index);
  spvIndexSnapshot = index && typeof index === 'object' ? index : {
    version: 1,
    utxos: {},
    ownedOutpoints: {},
    spentOutpoints: {},
    txs: {},
    updatedAt: null,
  };
  spvIndexSnapshotLoaded = true;
  try {
    spvIndexSnapshotMtimeMs = Number(fs.statSync(SPV_INDEX_FILE).mtimeMs || Date.now());
  } catch (_) {
    spvIndexSnapshotMtimeMs = Date.now();
  }
  walletTouchHintsCache = null;
  walletTouchHintsCacheKey = '';
  invalidateWalletBalanceHistoryCache();
  // Keep cache.json hot so UI polling can see incoming funds without manual sync.
  try {
    const nextCache = buildCacheFromSpvIndex(index);
    const prevCache = readJson(CACHE_FILE, null);
    const prevKey = prevCache ? JSON.stringify({
      confirmed: Number(prevCache.confirmed || 0),
      unconfirmed: Number(prevCache.unconfirmed || 0),
      pendingDelta: Number(prevCache.pendingDelta || 0),
      available: Number(prevCache.available || 0),
      selfChangePending: Number(prevCache.selfChangePending || 0),
      total: Number(prevCache.total || 0),
      txids: Array.isArray(prevCache.txids) ? prevCache.txids : [],
    }) : '';
    const nextKey = JSON.stringify({
      confirmed: Number(nextCache.confirmed || 0),
      unconfirmed: Number(nextCache.unconfirmed || 0),
      pendingDelta: Number(nextCache.pendingDelta || 0),
      available: Number(nextCache.available || 0),
      selfChangePending: Number(nextCache.selfChangePending || 0),
      total: Number(nextCache.total || 0),
      txids: Array.isArray(nextCache.txids) ? nextCache.txids : [],
    });
    if (prevKey !== nextKey) {
      writeJson(CACHE_FILE, nextCache);
      walletEventBus.emit('wallet.cache.changed', {
        reason: 'spv_index_save',
        walletKey: String(nextCache.receiveAddress || ''),
        cache: nextCache,
        previous: prevCache || null,
      });
    }
    rememberWalletBalanceHistoryCache(nextCache);
  } catch (_) {}
}

function onWalletCacheChanged(listener) {
  if (typeof listener !== 'function') return () => {};
  walletEventBus.on('wallet.cache.changed', listener);
  return () => walletEventBus.off('wallet.cache.changed', listener);
}

function resetSpvIndex() {
  const emptyIndex = {
    version: 1,
    utxos: {},
    ownedOutpoints: {},
    spentOutpoints: {},
    txs: {},
    updatedAt: null,
  };
  writeJson(SPV_INDEX_FILE, emptyIndex);
  spvIndexSnapshot = emptyIndex;
  spvIndexSnapshotLoaded = true;
  try {
    spvIndexSnapshotMtimeMs = Number(fs.statSync(SPV_INDEX_FILE).mtimeMs || Date.now());
  } catch (_) {
    spvIndexSnapshotMtimeMs = Date.now();
  }
  walletTouchHintsCache = null;
  walletTouchHintsCacheKey = '';
  invalidateWalletBalanceHistoryCache();
  clearSpvTxObservationCache();
}

function resetWalletCache() {
  writeJson(CACHE_FILE, {
    confirmed: 0,
    unconfirmed: 0,
    pendingDelta: 0,
    incomeSat: 0,
    expenseSat: 0,
    total: 0,
    txids: [],
    updatedAt: null,
  });
  invalidateWalletBalanceHistoryCache();
}

function resetTxContextStore() {
  if (process.env.BSV_MARKET_DB_PARENT_PROXY === '1') {
    clearTxContextCache();
    appendSendLog('wallet_tx_context_reset_skipped_proxy_child', {
      pid: process.pid,
    });
    return;
  }
  clearTxContextCache();
  const db = ensureTxContextDb();
  db.exec('DELETE FROM tx_contexts');
  removeLegacyTxContextFile();
}

function clearWalletLocalIndex(reason = 'manual_sync_reset') {
  resetSpvIndex();
  resetWalletCache();
  resetTxContextStore();
  appendSendLog('wallet_local_index_cleared', { reason });
}

function captureWalletLocalIndexBackup() {
  let cache = readFileRawOrNull(CACHE_FILE);
  try {
    const rebuilt = buildCacheFromSpvIndex(getSpvIndex({ forceReload: true }));
    cache = JSON.stringify(rebuilt, null, 2);
  } catch (err) {
    appendSendLog('wallet_local_index_backup_rebuild_failed', {
      error: String(err?.message || err || 'cache rebuild failed'),
    });
  }
  return {
    cache,
    index: readFileRawOrNull(SPV_INDEX_FILE),
  };
}

function restoreWalletLocalIndexBackup(backup = {}) {
  restoreFileRaw(CACHE_FILE, backup.cache);
  restoreFileRaw(SPV_INDEX_FILE, backup.index);
  invalidateSpvIndexSnapshot();
  clearTxContextCache();
}

function getWalletState() {
  const state = getWalletStateSnapshot();
  if (!state) throw new Error('Wallet state missing');
  if (!Array.isArray(state.addresses) || state.addresses.length === 0) throw new Error('Wallet addresses missing');
  return state;
}

function saveWalletState(state) {
  state.updatedAt = new Date().toISOString();
  writeJson(STATE_FILE, state);
  replaceWalletStateSnapshot(state, { updatedAtMs: Date.now() });
  clearSpvTxObservationCache();
}

function loadSyncStateLocalHeightFromSqlite() {
  try {
    const db = new DatabaseSync(MARKET_DB_FILE);
    try {
      const row = db.prepare(`
        SELECT local_height, p2p_tip_height, bootstrap_height
        FROM sync_state
        WHERE scope = ?
      `).get('main');
      const bootstrapFloor = Math.max(0, Number(row?.bootstrap_height || 0) - 1);
      return Math.max(
        0,
        Number(row?.local_height || 0),
        bootstrapFloor,
      );
    } finally {
      try { db.close(); } catch (_) {}
    }
  } catch (_) {
    return 0;
  }
}

function resolveRuntimeWalletLocalHeight(state = null) {
  const safeState = state && typeof state === 'object' ? state : null;
  const stateHeight = Math.max(0, Number(safeState?.sync?.localHeight || 0));
  if (stateHeight > 0) return stateHeight;
  const sqliteHeight = loadSyncStateLocalHeightFromSqlite();
  if (sqliteHeight > 0) return sqliteHeight;
  const index = getSpvIndex() || {};
  let maxSeenHeight = 0;
  for (const row of Object.values(index.txs || {})) {
    maxSeenHeight = Math.max(
      maxSeenHeight,
      Number(row?.lastSeenHeight || 0),
      Number(row?.firstSeenHeight || 0),
    );
  }
  return Math.max(0, maxSeenHeight);
}

function normalizeNodeEndpoint(node) {
  const trimmed = String(node || '').trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  // Keep parser strict to avoid binary/garbled payloads polluting node pool.
  if (!trimmed.includes(':')) {
    if (!/^[a-zA-Z0-9.-]+$/.test(trimmed)) return null;
    return `${trimmed}:8333`;
  }
  if ((trimmed.match(/:/g) || []).length !== 1) return null; // Skip IPv6/invalid for now
  const [hostRaw, portRaw] = trimmed.split(':');
  const host = String(hostRaw || '').trim();
  const port = Number(portRaw);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const isIp = net.isIP(host) !== 0;
  const isHost = /^[a-zA-Z0-9.-]+$/.test(host);
  if (!isIp && !isHost) return null;
  // For runtime peer pool, keep canonical p2p ports only.
  if (port !== 8333) return null;
  return `${host}:${port}`;
}

function parseSpvNodesText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeNodeEndpoint(line))
    .filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function getSeedSpvNodes() {
  const envNodes = parseSpvNodesText(String(process.env.BSV2_SPV_NODES || '').replace(/,/g, '\n'));
  const localFileNodes = fs.existsSync(SPV_NODES_FILE) ? parseSpvNodesText(fs.readFileSync(SPV_NODES_FILE, 'utf8')) : [];
  const legacyOpenNodes = fs.existsSync(LEGACY_OPEN_NODES_FILE) ? parseSpvNodesText(fs.readFileSync(LEGACY_OPEN_NODES_FILE, 'utf8')) : [];
  return Array.from(new Set([...envNodes, ...localFileNodes, ...legacyOpenNodes, ...DEFAULT_SPV_NODES]));
}

function newNodeRow(endpoint, source = 'seed') {
  return {
    endpoint,
    score: 0,
    successCount: 0,
    failCount: 0,
    broadcastSuccessCount: 0,
    broadcastFailCount: 0,
    listenerTxHitCount: 0,
    listenerTxSeenCount: 0,
    avgBroadcastLatencyMs: 0,
    consecutiveFail: 0,
    lastSuccessAt: null,
    lastFailAt: null,
    lastConnectedAt: null,
    lastBroadcastAt: null,
    lastListenerTxAt: null,
    lastProbeAt: null,
    lastProbeOkAt: null,
    lastProbeLatencyMs: 0,
    lastProbeError: '',
    banUntil: 0,
    source,
    updatedAt: nowIso(),
  };
}

function sortNodeRows(a, b) {
  if (Number(a.score || 0) !== Number(b.score || 0)) return Number(b.score || 0) - Number(a.score || 0);
  const aListenerHits = Number(a.listenerTxHitCount || 0);
  const bListenerHits = Number(b.listenerTxHitCount || 0);
  if (aListenerHits !== bListenerHits) return bListenerHits - aListenerHits;
  const aListenerSeen = Number(a.listenerTxSeenCount || 0);
  const bListenerSeen = Number(b.listenerTxSeenCount || 0);
  if (aListenerSeen !== bListenerSeen) return bListenerSeen - aListenerSeen;
  const al = a.lastListenerTxAt ? new Date(a.lastListenerTxAt).getTime() : 0;
  const bl = b.lastListenerTxAt ? new Date(b.lastListenerTxAt).getTime() : 0;
  if (al !== bl) return bl - al;
  const aprobe = Number(a.lastProbeLatencyMs || 0);
  const bprobe = Number(b.lastProbeLatencyMs || 0);
  if (aprobe > 0 && bprobe > 0 && aprobe !== bprobe) return aprobe - bprobe;
  const as = a.lastSuccessAt ? new Date(a.lastSuccessAt).getTime() : 0;
  const bs = b.lastSuccessAt ? new Date(b.lastSuccessAt).getTime() : 0;
  if (as !== bs) return bs - as;
  const af = a.lastFailAt ? new Date(a.lastFailAt).getTime() : 0;
  const bf = b.lastFailAt ? new Date(b.lastFailAt).getTime() : 0;
  if (af !== bf) return af - bf;
  return String(a.endpoint || '').localeCompare(String(b.endpoint || ''));
}

function sortBroadcastNodeRows(a, b) {
  const abs = Number(a.broadcastSuccessCount || 0);
  const bbs = Number(b.broadcastSuccessCount || 0);
  if (abs !== bbs) return bbs - abs;
  const alat = Number(a.avgBroadcastLatencyMs || 0);
  const blat = Number(b.avgBroadcastLatencyMs || 0);
  if (alat > 0 && blat > 0 && alat !== blat) return alat - blat;
  return sortNodeRows(a, b);
}

function sortListenerNodeRows(a, b) {
  const ar = computeNodeRoleScores(a).listenerScore;
  const br = computeNodeRoleScores(b).listenerScore;
  if (ar !== br) return br - ar;
  return sortNodeRows(a, b);
}

function isRecentListenerRelayNode(row = {}, maxAgeMs = 60 * 60 * 1000) {
  const lastListenerTxAt = row?.lastListenerTxAt ? new Date(row.lastListenerTxAt).getTime() : 0;
  return Number(row?.listenerTxSeenCount || 0) > 0
    && lastListenerTxAt > 0
    && (Date.now() - lastListenerTxAt) <= maxAgeMs;
}

function isPreferredBroadcastCandidate(row = {}, now = Date.now()) {
  if (Number(row.banUntil || 0) > now) return false;
  if (Number(row.consecutiveFail || 0) >= 4) return false;
  const lastFailAt = row.lastFailAt ? new Date(row.lastFailAt).getTime() : 0;
  const hasBroadcastSuccess = Number(row.broadcastSuccessCount || 0) > 0;
  if (
    !hasBroadcastSuccess
    && lastFailAt > 0
    && now - lastFailAt < 10 * 60 * 1000
    && isTransientBroadcastNodeFailure(row.lastProbeError || '')
  ) {
    return false;
  }
  return true;
}

function normalizeNodeState(state) {
  const map = new Map();
  for (const item of (state?.nodes || [])) {
    const endpoint = normalizeNodeEndpoint(item?.endpoint || '');
    if (!endpoint) continue;
    const prev = map.get(endpoint) || newNodeRow(endpoint, item?.source || 'seed');
    map.set(endpoint, {
      ...prev,
      ...item,
      endpoint,
      score: Number(item?.score || prev.score || 0),
      successCount: Number(item?.successCount || prev.successCount || 0),
      failCount: Number(item?.failCount || prev.failCount || 0),
      broadcastSuccessCount: Number(item?.broadcastSuccessCount || prev.broadcastSuccessCount || 0),
      broadcastFailCount: Number(item?.broadcastFailCount || prev.broadcastFailCount || 0),
      listenerTxHitCount: Number(item?.listenerTxHitCount || prev.listenerTxHitCount || 0),
      listenerTxSeenCount: Number(item?.listenerTxSeenCount || prev.listenerTxSeenCount || 0),
      avgBroadcastLatencyMs: Math.max(0, Number(item?.avgBroadcastLatencyMs || prev.avgBroadcastLatencyMs || 0)),
      consecutiveFail: Number(item?.consecutiveFail || prev.consecutiveFail || 0),
      banUntil: Number(item?.banUntil || prev.banUntil || 0),
      lastConnectedAt: item?.lastConnectedAt || prev.lastConnectedAt || null,
      lastBroadcastAt: item?.lastBroadcastAt || prev.lastBroadcastAt || null,
      lastListenerTxAt: item?.lastListenerTxAt || prev.lastListenerTxAt || null,
      lastProbeAt: item?.lastProbeAt || prev.lastProbeAt || null,
      lastProbeOkAt: item?.lastProbeOkAt || prev.lastProbeOkAt || null,
      lastProbeLatencyMs: Math.max(0, Number(item?.lastProbeLatencyMs || prev.lastProbeLatencyMs || 0)),
      lastProbeError: String(item?.lastProbeError || prev.lastProbeError || ''),
      updatedAt: item?.updatedAt || prev.updatedAt || nowIso(),
    });
  }
  return Array.from(map.values()).sort(sortNodeRows).slice(0, SPV_NODE_POOL_MAX);
}

function loadSpvNodeState() {
  if (spvNodeStateSnapshotLoaded && spvNodeStateSnapshot) {
    return cloneSpvNodeStateValue(spvNodeStateSnapshot);
  }
  const seedNodes = getSeedSpvNodes();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const state = readJson(SPV_NODE_STATE_FILE, { version: 1, nodes: [] });
  const normalizedNodes = normalizeNodeState(state);
  const map = new Map(normalizedNodes.map((n) => [n.endpoint, n]));
  let changed = normalizedNodes.length !== (Array.isArray(state?.nodes) ? state.nodes.length : 0);
  for (const endpoint of seedNodes) {
    if (!map.has(endpoint)) {
      map.set(endpoint, newNodeRow(endpoint, 'seed'));
      changed = true;
    }
  }
  const merged = {
    version: 1,
    nodes: Array.from(map.values()).sort(sortNodeRows).slice(0, SPV_NODE_POOL_MAX),
  };
  if (!changed) {
    const previousSignature = JSON.stringify(normalizedNodes.sort(sortNodeRows).slice(0, SPV_NODE_POOL_MAX));
    const nextSignature = JSON.stringify(merged.nodes);
    changed = previousSignature !== nextSignature;
  }
  const now = Date.now();
  const availableCount = merged.nodes.filter((n) => !Number(n.banUntil || 0) || Number(n.banUntil || 0) <= now).length;
  if (merged.nodes.length && availableCount === 0) {
    // Avoid deadlock: if all nodes are banned, release one round and retry with scores kept.
    merged.nodes = merged.nodes.map((n) => ({ ...n, banUntil: 0, updatedAt: nowIso() }));
    changed = true;
  }
  replaceSpvNodeStateSnapshot(merged);
  if (changed) persistSpvNodeStateSnapshotNow();
  return cloneSpvNodeStateValue(merged);
}

function mapSpvRowToSelectorStats(row = {}) {
  return {
    score: Number(row.score || 0),
    successCount: Number(row.successCount || 0),
    failCount: Number(row.failCount || 0),
    consecutiveFails: Number(row.consecutiveFail || 0),
    bannedUntil: Number(row.banUntil || 0),
    avgLatencyMs: Math.max(0, Number(row.lastProbeLatencyMs || 0)),
    lastError: String(row.lastProbeError || ''),
    lastFailureAt: row.lastFailAt ? new Date(row.lastFailAt).getTime() : 0,
    lastTimeoutAt: row.lastProbeError ? (row.lastProbeAt ? new Date(row.lastProbeAt).getTime() : 0) : 0,
    lastSuccessAt: row.lastSuccessAt ? new Date(row.lastSuccessAt).getTime() : 0,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : 0,
  };
}

function getSpvNodeSnapshotRaw(limit = 20) {
  const state = loadSpvNodeState();
  const now = Date.now();
  const rows = (state.nodes || []).slice().sort(sortNodeRows);
  const available = rows.filter((n) => !Number(n.banUntil || 0) || Number(n.banUntil || 0) <= now);
  const recentWindowMs = 120 * 1000;
  const recentConnected = rows.filter((n) => {
    const ts = n.lastSuccessAt ? new Date(n.lastSuccessAt).getTime() : 0;
    return ts > 0 && now - ts <= recentWindowMs;
  }).length;
  const cap = Math.max(1, Math.min(Number(limit) || 20, 100));
  const connectedRows = [];
  for (const endpoint of spvRuntime.peers.keys()) {
    const found = rows.find((r) => r.endpoint === endpoint) || newNodeRow(endpoint, 'runtime');
    connectedRows.push({
      endpoint,
      score: Number(found.score || 0),
      successCount: Number(found.successCount || 0),
      failCount: Number(found.failCount || 0),
      broadcastSuccessCount: Number(found.broadcastSuccessCount || 0),
      broadcastFailCount: Number(found.broadcastFailCount || 0),
      listenerTxHitCount: Number(found.listenerTxHitCount || 0),
      listenerTxSeenCount: Number(found.listenerTxSeenCount || 0),
      lastListenerTxAt: found.lastListenerTxAt || null,
      avgBroadcastLatencyMs: Math.max(0, Number(found.avgBroadcastLatencyMs || 0)),
      consecutiveFail: Number(found.consecutiveFail || 0),
      banUntil: Number(found.banUntil || 0),
      lastSuccessAt: found.lastSuccessAt || null,
      lastFailAt: found.lastFailAt || null,
    });
  }
  connectedRows.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  return {
    connectedCount: connectedRows.length,
    recentConnected,
    candidateCount: available.length,
    totalCount: rows.length,
    connected: connectedRows.slice(0, cap).map((n, idx) => ({
      rank: idx + 1,
      ...n,
    })),
    candidates: rows.slice(0, cap).map((n, idx) => ({
      rank: idx + 1,
      endpoint: n.endpoint,
      score: Number(n.score || 0),
      successCount: Number(n.successCount || 0),
      failCount: Number(n.failCount || 0),
      broadcastSuccessCount: Number(n.broadcastSuccessCount || 0),
      broadcastFailCount: Number(n.broadcastFailCount || 0),
      listenerTxHitCount: Number(n.listenerTxHitCount || 0),
      listenerTxSeenCount: Number(n.listenerTxSeenCount || 0),
      lastListenerTxAt: n.lastListenerTxAt || null,
      avgBroadcastLatencyMs: Math.max(0, Number(n.avgBroadcastLatencyMs || 0)),
      consecutiveFail: Number(n.consecutiveFail || 0),
      banUntil: Number(n.banUntil || 0),
      lastSuccessAt: n.lastSuccessAt || null,
      lastFailAt: n.lastFailAt || null,
      available: !Number(n.banUntil || 0) || Number(n.banUntil || 0) <= now,
    })),
  };
}

function getWalletP2PNodeSelector() {
  if (!walletP2PNodeSelector) {
    walletP2PNodeSelector = createP2PNodeSelector({
      snapshotLimit: 24,
      nodeStateMax: SPV_NODE_POOL_MAX,
      defaultCandidateLimit: SPV_NODE_CONNECT_TOP,
      timeoutCooldownMs: SPV_NODE_BASE_BAN_MS,
      nodeMaxConsecFail: 4,
      nodeBanMs: SPV_NODE_MAX_BAN_MS,
      walletApi: {
        getSpvNodeSnapshot: getSpvNodeSnapshotRaw,
      },
    });
  }
  const state = loadSpvNodeState();
  const stats = {};
  for (const row of (state.nodes || [])) {
    if (!row?.endpoint) continue;
    stats[row.endpoint] = mapSpvRowToSelectorStats(row);
  }
  walletP2PNodeSelector.importStats(stats);
  return walletP2PNodeSelector;
}

function wrapWalletSyncLease(lease, allocatorId) {
  if (!lease || typeof lease !== 'object') return lease;
  const trackingId = `${allocatorId}:${String(lease.id || lease.node || Date.now())}`;
  walletNodeManagerRuntime.activeSyncLeases.set(trackingId, {
    allocatorId,
    leaseId: String(lease.id || ''),
    node: String(lease.node || '').trim(),
    purpose: String(lease.purpose || 'sync_block'),
    createdAt: Date.now(),
  });
  refreshWalletNodeManagerState();
  let released = false;
  return {
    ...lease,
    release(meta = {}) {
      if (!released) {
        released = true;
        walletNodeManagerRuntime.activeSyncLeases.delete(trackingId);
        refreshWalletNodeManagerState();
      }
      if (typeof lease.release === 'function') return lease.release(meta);
      return true;
    },
  };
}

function createWalletSyncNodeAllocator(options = {}) {
  const candidateLimit = Math.max(8, Number(options.candidateLimit || SPV_NODE_POOL_MAX));
  const allocatorId = `wallet-sync-${String(walletNodeManagerRuntime.nextSyncAllocatorSeq += 1).padStart(4, '0')}`;
  const selector = createP2PNodeSelector({
    defaultCandidateLimit: candidateLimit,
    timeoutCooldownMs: SPV_NODE_BASE_BAN_MS,
    nodeMaxConsecFail: 4,
    nodeBanMs: SPV_NODE_MAX_BAN_MS,
    walletApi: {
      getSpvNodeSnapshot(limit) {
        try {
          return getSpvNodeSnapshot(limit);
        } catch (_) {
          return { connected: [], candidates: [] };
        }
      },
    },
  });
  const mergedStats = {
    ...(options.spvStats && typeof options.spvStats === 'object' ? options.spvStats : {}),
    ...(options.syncStats && typeof options.syncStats === 'object' ? options.syncStats : {}),
  };
  if (Object.keys(mergedStats).length > 0) selector.importStats(mergedStats);
  const originalAcquirePreferredLease = selector.acquirePreferredLease.bind(selector);
  const originalAcquireLease = typeof selector.acquireLease === 'function'
    ? selector.acquireLease.bind(selector)
    : null;
  selector.acquirePreferredLease = (leaseOptions = {}) => {
    const lease = originalAcquirePreferredLease({
      ...leaseOptions,
      purpose: leaseOptions?.purpose || 'sync_block',
      mode: leaseOptions?.mode || 'fresh',
    });
    return wrapWalletSyncLease(lease, allocatorId);
  };
  if (originalAcquireLease) {
    selector.acquireLease = (leaseOptions = {}) => {
      const lease = originalAcquireLease({
        ...leaseOptions,
        purpose: leaseOptions?.purpose || 'sync_block',
        mode: leaseOptions?.mode || 'fresh',
      });
      return wrapWalletSyncLease(lease, allocatorId);
    };
  }
  return selector;
}

function saveSpvNodeState(state, options = {}) {
  const normalized = {
    version: 1,
    nodes: normalizeNodeState(state),
  };
  replaceSpvNodeStateSnapshot(normalized);
  if (options?.deferPersist === true) {
    scheduleSpvNodeStatePersist(options?.delayMs || 15000);
    return;
  }
  persistSpvNodeStateSnapshotNow();
}

function upsertSpvNodes(endpoints, source = 'discovered') {
  const state = loadSpvNodeState();
  const map = new Map((state.nodes || []).map((n) => [n.endpoint, n]));
  for (const ep of endpoints || []) {
    const endpoint = normalizeNodeEndpoint(ep);
    if (!endpoint) continue;
    if (!map.has(endpoint)) map.set(endpoint, newNodeRow(endpoint, source));
  }
  saveSpvNodeState({ version: 1, nodes: Array.from(map.values()) });
}

function updateNodeRow(endpoint, mutate, source = 'runtime', options = {}) {
  const target = normalizeNodeEndpoint(endpoint);
  if (!target) return null;
  const state = loadSpvNodeState();
  const map = new Map((state.nodes || []).map((n) => [n.endpoint, n]));
  const row = { ...(map.get(target) || newNodeRow(target, source)) };
  mutate(row);
  row.updatedAt = nowIso();
  map.set(target, row);
  saveSpvNodeState({ version: 1, nodes: Array.from(map.values()) }, options);
  return row;
}

function recordSpvNodeSuccess(endpoint) {
  updateNodeRow(endpoint, (row) => {
    row.successCount = Number(row.successCount || 0) + 1;
    row.consecutiveFail = 0;
    row.lastSuccessAt = nowIso();
    row.lastConnectedAt = row.lastSuccessAt;
    row.banUntil = 0;
    row.score = Math.min(100, Number(row.score || 0) + 4);
  });
  getWalletP2PNodeSelector().reportSuccess(endpoint, { latencyMs: 0, purpose: 'wallet_connect' });
}

function recordSpvNodeFailure(endpoint, reason = 'connect_failed') {
  const row = updateNodeRow(endpoint, (next) => {
    next.failCount = Number(next.failCount || 0) + 1;
    next.consecutiveFail = Number(next.consecutiveFail || 0) + 1;
    next.lastFailAt = nowIso();
    next.score = Math.max(-100, Number(next.score || 0) - 2);
    if (next.consecutiveFail >= 4) {
      const factor = Math.min(6, next.consecutiveFail - 4);
      const banMs = Math.min(SPV_NODE_MAX_BAN_MS, SPV_NODE_BASE_BAN_MS * (2 ** factor));
      next.banUntil = Date.now() + banMs;
    }
  });
  getWalletP2PNodeSelector().reportFailure(endpoint, { error: reason, purpose: 'wallet_connect' });
  if (row) appendSendLog('spv_node_penalty', { endpoint: row.endpoint, reason, score: row.score, banUntil: row.banUntil });
}

function recordSpvBroadcastResult(endpoint, { ok = false, latencyMs = 0, reason = '' } = {}) {
  const row = updateNodeRow(endpoint, (next) => {
    const now = nowIso();
    next.lastBroadcastAt = now;
    if (ok) {
      next.broadcastSuccessCount = Number(next.broadcastSuccessCount || 0) + 1;
      const prevLatency = Math.max(0, Number(next.avgBroadcastLatencyMs || 0));
      const sampleLatency = Math.max(1, Number(latencyMs || 0));
      next.avgBroadcastLatencyMs = prevLatency > 0
        ? Math.round((prevLatency * 0.7) + (sampleLatency * 0.3))
        : sampleLatency;
      next.score = Math.min(100, Number(next.score || 0) + (sampleLatency <= 1200 ? 3 : 2));
      next.consecutiveFail = 0;
      next.banUntil = 0;
      next.lastSuccessAt = now;
    } else {
      next.broadcastFailCount = Number(next.broadcastFailCount || 0) + 1;
      next.lastFailAt = now;
      next.consecutiveFail = Number(next.consecutiveFail || 0) + 1;
      next.score = Math.max(-100, Number(next.score || 0) - 3);
      if (isTransientBroadcastNodeFailure(reason)) {
        const banMs = Math.min(SPV_NODE_MAX_BAN_MS, SPV_NODE_BASE_BAN_MS);
        next.banUntil = Math.max(Number(next.banUntil || 0), Date.now() + banMs);
      } else if (next.consecutiveFail >= 4) {
        const factor = Math.min(6, next.consecutiveFail - 4);
        const banMs = Math.min(SPV_NODE_MAX_BAN_MS, SPV_NODE_BASE_BAN_MS * (2 ** factor));
        next.banUntil = Date.now() + banMs;
      }
    }
  });
  if (row && !ok) appendSendLog('spv_broadcast_penalty', { endpoint: row.endpoint, reason, score: row.score, banUntil: row.banUntil });
}

function recordSpvListenerTxRelay(endpoint, { txCount = 0, relevantCount = 0, confirmed = false } = {}) {
  const target = normalizeNodeEndpoint(endpoint);
  if (!target) return null;
  const safeTxCount = Math.max(0, Number(txCount || 0));
  const safeRelevantCount = Math.max(0, Number(relevantCount || 0));
  if (safeTxCount <= 0 && safeRelevantCount <= 0) return null;
  const nowMs = Date.now();
  const relayState = spvListenerRelayState.get(target) || {
    pendingTxCount: 0,
    pendingRelevantCount: 0,
    lastFlushAt: 0,
    lastLogAt: 0,
    skippedLogCount: 0,
    lastSelectorReportAt: 0,
  };
  relayState.pendingTxCount += safeTxCount;
  relayState.pendingRelevantCount += safeRelevantCount;
  const shouldFlush = safeRelevantCount > 0
    || relayState.pendingRelevantCount > 0
    || relayState.pendingTxCount >= SPV_LISTENER_RELAY_FLUSH_TX_INTERVAL
    || (nowMs - Number(relayState.lastFlushAt || 0)) >= SPV_LISTENER_RELAY_FLUSH_MS;
  if (!shouldFlush) {
    spvListenerRelayState.set(target, relayState);
    return null;
  }
  const flushTxCount = Math.max(0, Number(relayState.pendingTxCount || 0));
  const flushRelevantCount = Math.max(0, Number(relayState.pendingRelevantCount || 0));
  relayState.pendingTxCount = 0;
  relayState.pendingRelevantCount = 0;
  relayState.lastFlushAt = nowMs;
  const row = updateNodeRow(target, (next) => {
    const now = nowIso();
    next.listenerTxSeenCount = Number(next.listenerTxSeenCount || 0) + flushTxCount;
    if (flushRelevantCount > 0) {
      next.listenerTxHitCount = Number(next.listenerTxHitCount || 0) + flushRelevantCount;
    }
    next.lastListenerTxAt = now;
    next.lastSuccessAt = now;
    next.consecutiveFail = 0;
    next.banUntil = 0;
    const scoreBump = flushRelevantCount > 0 ? 8 : 1;
    next.score = Math.min(100, Number(next.score || 0) + scoreBump);
  }, 'listener', {
    deferPersist: flushRelevantCount <= 0,
    delayMs: 30000,
  });
  if (row) {
    if (flushRelevantCount > 0 || (nowMs - Number(relayState.lastSelectorReportAt || 0)) >= SPV_LISTENER_SELECTOR_REPORT_MS) {
      relayState.lastSelectorReportAt = nowMs;
      getWalletP2PNodeSelector().reportSuccess(target, { latencyMs: 0, purpose: 'wallet_listener_tx' });
    }
    const shouldLog = flushRelevantCount > 0
      || (nowMs - Number(relayState.lastLogAt || 0)) >= SPV_LISTENER_RELAY_LOG_MS;
    if (shouldLog) {
      const skippedLogCount = Math.max(0, Number(relayState.skippedLogCount || 0));
      relayState.skippedLogCount = 0;
      relayState.lastLogAt = nowMs;
      appendSendLog('spv_listener_tx_relay', {
        endpoint: row.endpoint,
        txCount: flushTxCount,
        relevantCount: flushRelevantCount,
        confirmed: Boolean(confirmed),
        listenerTxHitCount: Number(row.listenerTxHitCount || 0),
        listenerTxSeenCount: Number(row.listenerTxSeenCount || 0),
        skippedLogCount,
        score: Number(row.score || 0),
      });
    } else {
      relayState.skippedLogCount = Number(relayState.skippedLogCount || 0) + 1;
    }
  }
  spvListenerRelayState.set(target, relayState);
  return row;
}

function probeSpvEndpoint(endpoint, timeoutMs = SPV_NODE_PROBE_TIMEOUT_MS) {
  const target = normalizeNodeEndpoint(endpoint);
  if (!target) {
    return Promise.resolve({ endpoint, ok: false, latencyMs: 0, error: 'invalid_endpoint' });
  }
  return p2pNodeRuntime.probeTcp(target, timeoutMs);
}

function recordSpvNodeProbeResult(endpoint, result = {}) {
  const ok = result?.ok === true;
  const latencyMs = Math.max(0, Number(result?.latencyMs || 0));
  const error = String(result?.error || '');
  const row = updateNodeRow(endpoint, (next) => {
    const now = nowIso();
    next.lastProbeAt = now;
    next.lastProbeError = ok ? '' : error;
    if (ok) {
      next.lastProbeOkAt = now;
      next.lastProbeLatencyMs = latencyMs;
      next.score = Math.min(100, Number(next.score || 0) + (latencyMs <= 300 ? 2 : 1));
      if (Number(next.consecutiveFail || 0) > 0) next.consecutiveFail = Math.max(0, Number(next.consecutiveFail || 0) - 1);
      next.banUntil = 0;
    } else {
      next.lastProbeLatencyMs = 0;
      next.score = Math.max(-100, Number(next.score || 0) - 1);
    }
  }, 'probe');
  if (ok) {
    getWalletP2PNodeSelector().reportSuccess(endpoint, { latencyMs, purpose: 'probe' });
  } else {
    getWalletP2PNodeSelector().reportFailure(endpoint, { error, purpose: 'probe' });
  }
  appendSendLog('spv_probe_result', {
    endpoint,
    ok,
    latencyMs,
    error,
    score: Number(row?.score || 0),
  });
  return row;
}

function extractNodeEndpoints(payload) {
  const out = [];
  const seen = new Set();
  function walk(v) {
    if (!v) return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (typeof v === 'string') {
      const endpoint = normalizeNodeEndpoint(v);
      if (endpoint) out.push(endpoint);
      return;
    }
    if (Buffer.isBuffer(v)) return;
    if (typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);
    const host = v.ip || v.host || v.address || v.hostname || null;
    const port = v.port || v.portNumber || v.p || null;
    if (host) {
      const endpoint = normalizeNodeEndpoint(port ? `${host}:${port}` : String(host));
      if (endpoint) out.push(endpoint);
    }
    Object.values(v).forEach(walk);
  }
  walk(payload);
  return Array.from(new Set(out));
}

function getRankedSpvNodes({ limit = null, includeBannedFallback = false, state = null, role = 'general' } = {}) {
  const selector = getWalletP2PNodeSelector();
  const effectiveState = state && typeof state === 'object' ? state : loadSpvNodeState();
  const rowsByEndpoint = new Map((effectiveState.nodes || []).map((n) => [n.endpoint, n]));
  let endpoints = selector.getCandidates({ limit: Number.isFinite(limit) && limit > 0 ? limit : SPV_NODE_POOL_MAX });
  if (!endpoints.length && includeBannedFallback) {
    endpoints = (effectiveState.nodes || []).map((n) => String(n.endpoint || '').trim()).filter(Boolean);
  }
  let rows = endpoints
    .map((endpoint) => rowsByEndpoint.get(endpoint) || newNodeRow(endpoint, 'selector'))
    .filter((row) => Boolean(row?.endpoint));
  if (!rows.length) {
    rows = getSeedSpvNodes().map((endpoint) => newNodeRow(endpoint, 'seed'));
  }
  rows = rows.slice().sort(role === 'listener' ? sortListenerNodeRows : sortNodeRows);
  if (spvRuntime.lastGoodNode && rows.some((n) => n.endpoint === spvRuntime.lastGoodNode)) {
    rows = [
      rows.find((n) => n.endpoint === spvRuntime.lastGoodNode),
      ...rows.filter((n) => n.endpoint !== spvRuntime.lastGoodNode),
    ].filter(Boolean);
  }
  if (Number.isFinite(limit) && limit > 0) return rows.slice(0, limit);
  return rows;
}

function loadSpvNodes() {
  return getRankedSpvNodes({ limit: SPV_NODE_CONNECT_TOP, includeBannedFallback: true }).map((n) => n.endpoint);
}

function getSpvNodeSnapshot(limit = 20) {
  return getWalletDisplayNodeSnapshot(limit);
}

function getSpvRuntimeSnapshot() {
  refreshWalletNodeManagerState();
  return {
    started: spvRuntime.started === true,
    maintaining: spvRuntime.maintaining === true,
    peerCount: spvRuntime.peers.size,
    sessionCount: spvRuntime.sessions.size,
    connectingCount: spvRuntime.connectingNodes.size,
    connectedNodes: Array.from(spvRuntime.peers.keys()),
    connectingNodes: Array.from(spvRuntime.connectingNodes.values()),
    policy: getWalletRuntimePolicy(),
  };
}

function disconnectSpvOverflowPeers(target) {
  const safeTarget = Math.max(0, Number(target || 0));
  const connectedEndpoints = Array.from(spvRuntime.peers.keys());
  if (connectedEndpoints.length <= safeTarget) return false;
  const ranked = getRankedSpvNodes({ limit: null, includeBannedFallback: false, role: 'listener' });
  const connectedRows = connectedEndpoints
    .map((endpoint) => ranked.find((row) => row.endpoint === endpoint) || newNodeRow(endpoint, 'runtime'))
    .sort(sortListenerNodeRows);
  const overflowRows = connectedRows.slice(safeTarget);
  overflowRows.forEach((row) => {
    const peer = spvRuntime.peers.get(row.endpoint);
    const session = spvRuntime.sessions.get(row.endpoint);
    appendSendLog('spv_node_overflow_disconnected', {
      endpoint: row.endpoint,
      target: safeTarget,
      score: Number(row.score || 0),
    });
    try {
      peer?.disconnect?.(false);
    } catch (_) {}
    Promise.resolve(session?.release?.({ outcome: 'policy_overflow_evicted' })).catch(() => {});
  });
  return overflowRows.length > 0;
}

function rebalanceSpvActivePeers(target = null) {
  const effectiveTarget = Math.max(
    1,
    Math.min(
      SPV_NODE_CONNECT_TOP,
      Number.isFinite(Number(target)) ? Number(target) : Number(getWalletRuntimePolicy().listenerTarget || SPV_NODE_CONNECT_TOP),
    ),
  );
  if (spvRuntime.peers.size < effectiveTarget) return false;
  const ranked = getRankedSpvNodes({ limit: null, includeBannedFallback: false, role: 'listener' });
  const connectedEndpoints = Array.from(spvRuntime.peers.keys());
  const connectedSet = new Set(connectedEndpoints);
  const connectedRows = connectedEndpoints
    .map((endpoint) => ranked.find((row) => row.endpoint === endpoint) || newNodeRow(endpoint, 'runtime'))
    .sort(sortListenerNodeRows);
  if (!connectedRows.length) return false;
  const bestReserve = ranked.find((row) => !connectedSet.has(row.endpoint));
  const worstActive = connectedRows[connectedRows.length - 1];
  if (!bestReserve || !worstActive) return false;
  if (isRecentListenerRelayNode(worstActive)) return false;
  if (Number(bestReserve.score || 0) < Number(worstActive.score || 0) + SPV_NODE_EVICT_SCORE_MARGIN) return false;
  const peer = spvRuntime.peers.get(worstActive.endpoint);
  const session = spvRuntime.sessions.get(worstActive.endpoint);
  if (!peer) return false;
  appendSendLog('spv_node_rebalanced', {
    evicted: worstActive.endpoint,
    evictedScore: Number(worstActive.score || 0),
    promoted: bestReserve.endpoint,
    promotedScore: Number(bestReserve.score || 0),
  });
  try {
    peer.disconnect(false);
  } catch (_) {}
  Promise.resolve(session?.release?.({ outcome: 'rebalanced_evicted' })).catch(() => {});
  return true;
}

async function maybeProbeAndRebalanceActivePeers(target = null) {
  const effectiveTarget = Math.max(
    1,
    Math.min(
      SPV_NODE_CONNECT_TOP,
      Number.isFinite(Number(target)) ? Number(target) : Number(getWalletRuntimePolicy().listenerTarget || SPV_NODE_CONNECT_TOP),
    ),
  );
  if (spvRuntime.peers.size < effectiveTarget) return false;
  const now = Date.now();
  if (spvRuntime.lastProbeSweepAt > 0 && (now - spvRuntime.lastProbeSweepAt) < SPV_NODE_PROBE_INTERVAL_MS) {
    return false;
  }
  spvRuntime.lastProbeSweepAt = now;
  const ranked = getRankedSpvNodes({ limit: null, includeBannedFallback: false, role: 'listener' });
  const connectedEndpoints = Array.from(spvRuntime.peers.keys());
  const connectedSet = new Set(connectedEndpoints);
  const connectedRows = connectedEndpoints
    .map((endpoint) => ranked.find((row) => row.endpoint === endpoint) || newNodeRow(endpoint, 'runtime'))
    .sort(sortListenerNodeRows);
  if (!connectedRows.length) return false;
  const worstActive = connectedRows[connectedRows.length - 1];
  if (isRecentListenerRelayNode(worstActive)) return false;
  const reserveRows = ranked
    .filter((row) => !connectedSet.has(row.endpoint))
    .slice(0, SPV_NODE_PROBE_RESERVE_COUNT);
  if (!worstActive?.endpoint || !reserveRows.length) return false;
  const probeTargets = [worstActive.endpoint, ...reserveRows.map((row) => row.endpoint)];
  const probeResults = await Promise.all(probeTargets.map((endpoint) => probeSpvEndpoint(endpoint)));
  const resultMap = new Map();
  for (const result of probeResults) {
    resultMap.set(result.endpoint, result);
    recordSpvNodeProbeResult(result.endpoint, result);
  }
  const worstProbe = resultMap.get(worstActive.endpoint) || { ok: false, latencyMs: 0, error: 'probe_missing' };
  const reserveProbes = reserveRows
    .map((row) => ({
      row,
      probe: resultMap.get(row.endpoint) || { ok: false, latencyMs: 0, error: 'probe_missing' },
    }))
    .filter((item) => item.probe.ok)
    .sort((a, b) => {
      const sa = Number(a.row.score || 0);
      const sb = Number(b.row.score || 0);
      if (sa !== sb) return sb - sa;
      return Number(a.probe.latencyMs || 0) - Number(b.probe.latencyMs || 0);
    });
  const bestReserve = reserveProbes[0] || null;
  if (!bestReserve) return false;
  const reserveBetterByScore = Number(bestReserve.row.score || 0) >= Number(worstActive.score || 0) + SPV_NODE_EVICT_SCORE_MARGIN;
  const reserveBetterByLatency = worstProbe.ok
    && Number(bestReserve.probe.latencyMs || 0) > 0
    && Number(worstProbe.latencyMs || 0) > 0
    && Number(bestReserve.probe.latencyMs || 0) + 150 < Number(worstProbe.latencyMs || 0)
    && Number(bestReserve.row.score || 0) >= Number(worstActive.score || 0) - 2;
  if (worstProbe.ok && !reserveBetterByScore && !reserveBetterByLatency) return false;
  const peer = spvRuntime.peers.get(worstActive.endpoint);
  const session = spvRuntime.sessions.get(worstActive.endpoint);
  if (!peer) return false;
  appendSendLog('spv_probe_rebalanced', {
    evicted: worstActive.endpoint,
    evictedScore: Number(worstActive.score || 0),
    evictedProbeOk: worstProbe.ok,
    evictedProbeLatencyMs: Number(worstProbe.latencyMs || 0),
    promoted: bestReserve.row.endpoint,
    promotedScore: Number(bestReserve.row.score || 0),
    promotedProbeLatencyMs: Number(bestReserve.probe.latencyMs || 0),
  });
  try {
    peer.disconnect(false);
  } catch (_) {}
  Promise.resolve(session?.release?.({ outcome: 'probe_rebalanced_evicted' })).catch(() => {});
  setTimeout(() => {
    if (spvRuntime.peers.has(bestReserve.row.endpoint) || spvRuntime.connectingNodes.has(bestReserve.row.endpoint)) return;
    spvRuntime.connectingNodes.add(bestReserve.row.endpoint);
    connectSpvNode(bestReserve.row.endpoint).catch(() => {});
  }, 150);
  return true;
}

function scheduleSpvMaintain(delayMs = 2000) {
  if (spvRuntime.maintainTimer) return;
  spvRuntime.maintainTimer = setTimeout(() => {
    spvRuntime.maintainTimer = null;
    maintainSpvConnections().catch(() => {});
  }, delayMs);
}

function normalizeWalletRuntimePolicy(next = {}) {
  return {
    listenerEnabled: next.listenerEnabled !== false,
    listenerTarget: Math.max(0, Math.min(
      SPV_NODE_CONNECT_TOP,
      Number.isFinite(Number(next.listenerTarget)) ? Number(next.listenerTarget) : SPV_NODE_CONNECT_TOP,
    )),
    sendEnabled: next.sendEnabled !== false,
    reason: String(next.reason || '').trim(),
  };
}

function getWalletRuntimePolicy() {
  return { ...walletRuntimePolicy };
}

function setWalletRuntimePolicy(next = {}) {
  const merged = normalizeWalletRuntimePolicy({
    ...walletRuntimePolicy,
    ...(next && typeof next === 'object' ? next : {}),
  });
  const changed = merged.listenerEnabled !== walletRuntimePolicy.listenerEnabled
    || merged.listenerTarget !== walletRuntimePolicy.listenerTarget
    || merged.sendEnabled !== walletRuntimePolicy.sendEnabled
    || merged.reason !== walletRuntimePolicy.reason;
  walletRuntimePolicy.listenerEnabled = merged.listenerEnabled;
  walletRuntimePolicy.listenerTarget = merged.listenerTarget;
  walletRuntimePolicy.sendEnabled = merged.sendEnabled;
  walletRuntimePolicy.reason = merged.reason;
  if (!changed) return { ...walletRuntimePolicy };
  if (!walletRuntimePolicy.listenerEnabled || walletRuntimePolicy.listenerTarget <= 0) {
    stopSpvListener('policy_disabled');
  } else {
    disconnectSpvOverflowPeers(walletRuntimePolicy.listenerTarget);
    scheduleSpvMaintain(50);
  }
  refreshWalletNodeManagerState();
  return { ...walletRuntimePolicy };
}

function stopSpvListener(reason = 'policy_stop') {
  if (spvRuntime.maintainTimer) {
    clearTimeout(spvRuntime.maintainTimer);
    spvRuntime.maintainTimer = null;
  }
  spvRuntime.started = false;
  Array.from(spvRuntime.peers.values()).forEach((peer) => {
    try {
      peer.disconnect(false);
    } catch (_) {}
  });
  Array.from(spvRuntime.sessions.values()).forEach((session) => {
    Promise.resolve(session?.release?.({ outcome: reason })).catch(() => {});
  });
  spvRuntime.peers.clear();
  spvRuntime.sessions.clear();
  spvRuntime.connectingNodes.clear();
  refreshWalletNodeManagerState();
}

function assertWalletSendAllowed(action = 'send') {
  if (walletRuntimePolicy.sendEnabled) return;
  const reason = walletRuntimePolicy.reason || 'wallet sending disabled while chain sync is active';
  const err = new Error(`${action} disabled: ${reason}`);
  err.code = 'WALLET_SEND_DISABLED';
  throw err;
}

function getWatchedAddresses() {
  try {
    const state = getWalletState();
    return new Set((state.addresses || []).map((a) => a.address));
  } catch (_) {
    return new Set();
  }
}

function txFromUnknown(input) {
  if (!input) return null;
  if (input instanceof bsv.Transaction) return input;
  if (typeof input === 'string') return new bsv.Transaction(input);
  if (Buffer.isBuffer(input)) return new bsv.Transaction(input.toString('hex'));
  if (typeof input.toBuffer === 'function') return new bsv.Transaction(input.toBuffer().toString('hex'));
  return null;
}

function rawtxHexFromUnknown(input) {
  if (!input) return '';
  if (typeof input === 'string') return input.trim().toLowerCase();
  if (Buffer.isBuffer(input)) return input.toString('hex').trim().toLowerCase();
  if (typeof input.toBuffer === 'function') {
    try {
      return input.toBuffer().toString('hex').trim().toLowerCase();
    } catch (_) {}
  }
  return '';
}

function ensureTxContextDb() {
  ensureDataDir();
  if (!txContextDb) {
    txContextDb = new DatabaseSync(MARKET_DB_FILE);
    txContextDb.exec('PRAGMA busy_timeout = 5000;');
  }
  if (!txContextSchemaReady) {
    txContextDb.exec(`
      CREATE TABLE IF NOT EXISTS tx_contexts (
        txid TEXT PRIMARY KEY,
        rawtx_hex TEXT NOT NULL DEFAULT '',
        input_txids_json TEXT NOT NULL DEFAULT '[]',
        source TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT '',
        confirmed INTEGER NOT NULL DEFAULT 0,
        proof_type TEXT NOT NULL DEFAULT '',
        proof_source TEXT NOT NULL DEFAULT '',
        proof_hex TEXT NOT NULL DEFAULT '',
        proof_encoding TEXT NOT NULL DEFAULT '',
        proof_verified INTEGER NOT NULL DEFAULT 0,
        proof_verified_at TEXT,
        proof_block_height INTEGER,
        proof_block_hash TEXT NOT NULL DEFAULT '',
        proof_merkle_root TEXT NOT NULL DEFAULT '',
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tx_contexts_confirmed ON tx_contexts(confirmed, last_seen_at);
    `);
    txContextSchemaReady = true;
  }
  return txContextDb;
}

function trimTxContextCache() {
  while (txContextRowCache.size > TX_CONTEXT_CACHE_LIMIT) {
    const oldestKey = txContextRowCache.keys().next().value;
    if (!oldestKey) break;
    txContextRowCache.delete(oldestKey);
  }
}

function setCachedTxContext(row) {
  const txid = String(row?.txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) return;
  txContextRowCache.delete(txid);
  txContextRowCache.set(txid, { ...row, inputTxids: Array.isArray(row.inputTxids) ? row.inputTxids.slice(0, 24) : [] });
  trimTxContextCache();
}

function clearTxContextCache() {
  txContextRowCache.clear();
}

function notifyParentTxContextUpsert(row = {}) {
  if (process.env.BSV_MARKET_DB_PARENT_PROXY !== '1') return false;
  if (typeof process.send !== 'function' || process.connected === false) return false;
  const txid = String(row?.txid || '').trim().toLowerCase();
  const rawtx = rawtxHexFromUnknown(row?.rawtx || '');
  if (!/^[0-9a-f]{64}$/i.test(txid) || !rawtx) return false;
  try {
    process.send({
      type: 'wallet_tx_context_upsert',
      txid,
      rawtx,
      patch: {
        source: String(row?.source || '').trim(),
        kind: String(row?.kind || '').trim(),
        confirmed: row?.confirmed === true,
        proofType: String(row?.proofType || '').trim(),
        proofSource: String(row?.proofSource || '').trim(),
        proofHex: String(row?.proofHex || '').trim().toLowerCase(),
        proofEncoding: String(row?.proofEncoding || '').trim(),
        proofVerified: row?.proofVerified === true,
        proofVerifiedAt: row?.proofVerifiedAt || null,
        proofBlockHeight: Number.isFinite(Number(row?.proofBlockHeight)) ? Number(row.proofBlockHeight) : null,
        proofBlockHash: String(row?.proofBlockHash || '').trim().toLowerCase(),
        proofMerkleRoot: String(row?.proofMerkleRoot || '').trim().toLowerCase(),
      },
      sentAt: new Date().toISOString(),
      pid: process.pid,
    });
    return true;
  } catch (err) {
    appendSendLog('wallet_tx_context_parent_notify_failed', {
      pid: process.pid,
      txid,
      error: String(err?.message || err || 'parent notify failed'),
    });
    return false;
  }
}

function removeLegacyTxContextFile() {
  const legacyFile = path.join(DATA_DIR, 'tx_contexts.json');
  try {
    if (fs.existsSync(legacyFile)) fs.unlinkSync(legacyFile);
  } catch (_) {}
}

function normalizeTxContextRow(row) {
  if (!row || typeof row !== 'object') return null;
  let inputTxids = [];
  try {
    inputTxids = JSON.parse(String(row.input_txids_json || '[]'));
  } catch (_) {
    inputTxids = [];
  }
  return {
    txid: String(row.txid || '').trim().toLowerCase(),
    rawtx: String(row.rawtx_hex || '').trim().toLowerCase(),
    inputTxids: Array.isArray(inputTxids) ? inputTxids.slice(0, 24) : [],
    source: String(row.source || '').trim(),
    kind: String(row.kind || '').trim(),
    confirmed: row.confirmed === 1 || row.confirmed === true,
    proofType: String(row.proof_type || '').trim(),
    proofSource: String(row.proof_source || '').trim(),
    proofHex: String(row.proof_hex || '').trim().toLowerCase(),
    proofEncoding: String(row.proof_encoding || '').trim(),
    proofVerified: row.proof_verified === 1 || row.proof_verified === true,
    proofVerifiedAt: row.proof_verified_at || null,
    proofBlockHeight: Number.isFinite(Number(row.proof_block_height)) ? Number(row.proof_block_height) : null,
    proofBlockHash: String(row.proof_block_hash || '').trim().toLowerCase(),
    proofMerkleRoot: String(row.proof_merkle_root || '').trim().toLowerCase(),
    firstSeenAt: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    updatedAt: row.updated_at || null,
  };
}

function getTxContextByTxid(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return null;
  if (options.useCache !== false && txContextRowCache.has(safeTxid)) {
    const cached = txContextRowCache.get(safeTxid);
    txContextRowCache.delete(safeTxid);
    txContextRowCache.set(safeTxid, cached);
    return { ...cached, inputTxids: Array.isArray(cached.inputTxids) ? cached.inputTxids.slice(0, 24) : [] };
  }
  const db = ensureTxContextDb();
  const row = db.prepare(`
    SELECT
      txid,
      rawtx_hex,
      input_txids_json,
      source,
      kind,
      confirmed,
      proof_type,
      proof_source,
      proof_hex,
      proof_encoding,
      proof_verified,
      proof_verified_at,
      proof_block_height,
      proof_block_hash,
      proof_merkle_root,
      first_seen_at,
      last_seen_at,
      updated_at
    FROM tx_contexts
    WHERE txid = ?
  `).get(safeTxid);
  const normalized = normalizeTxContextRow(row);
  if (normalized) setCachedTxContext(normalized);
  return normalized;
}

function getTxContextCount() {
  const db = ensureTxContextDb();
  const row = db.prepare('SELECT COUNT(*) AS count FROM tx_contexts').get();
  return Math.max(0, Number(row?.count || 0));
}

let txContextSpentOutpointCache = { count: -1, spent: new Set(), spenderByOutpoint: new Map() };

function getTxContextSpentOutpointMap() {
  const db = ensureTxContextDb();
  const count = getTxContextCount();
  if (
    txContextSpentOutpointCache.count === count
    && txContextSpentOutpointCache.spenderByOutpoint instanceof Map
  ) {
    return txContextSpentOutpointCache.spenderByOutpoint;
  }
  const spenderByOutpoint = new Map();
  const rows = db.prepare(`
    SELECT txid, rawtx_hex
    FROM tx_contexts
    WHERE rawtx_hex IS NOT NULL AND rawtx_hex != ''
      AND (
        confirmed = 1
        OR proof_verified = 1
        OR COALESCE(proof_block_height, 0) > 0
      )
  `).all();
  for (const row of rows || []) {
    const rawtx = rawtxHexFromUnknown(row?.rawtx_hex);
    const spenderTxid = String(row?.txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(spenderTxid)) continue;
    if (!rawtx) continue;
    try {
      const tx = new bsv.Transaction(rawtx);
      for (const input of tx.inputs || []) {
        const prevTxId = input.prevTxId ? Buffer.from(input.prevTxId).toString('hex') : '';
        const vout = Number(input.outputIndex);
        if (/^[0-9a-f]{64}$/i.test(prevTxId) && Number.isInteger(vout) && vout >= 0) {
          spenderByOutpoint.set(`${prevTxId.toLowerCase()}:${vout}`, spenderTxid);
        }
      }
    } catch (_) {}
  }
  txContextSpentOutpointCache = {
    count,
    spent: new Set(spenderByOutpoint.keys()),
    spenderByOutpoint,
  };
  return spenderByOutpoint;
}

function getTxContextSpentOutpoints() {
  if (
    txContextSpentOutpointCache.spent instanceof Set
    && txContextSpentOutpointCache.spenderByOutpoint instanceof Map
    && txContextSpentOutpointCache.count === getTxContextCount()
  ) {
    return txContextSpentOutpointCache.spent;
  }
  const spent = new Set(getTxContextSpentOutpointMap().keys());
  txContextSpentOutpointCache.spent = spent;
  return spent;
}

function markKnownConfirmedSpenderForOutpoint(index, outpoint, utxo = {}, options = {}) {
  const safeOutpoint = String(outpoint || '').trim().toLowerCase();
  if (!safeOutpoint) return false;
  const spentBy = String(getTxContextSpentOutpointMap().get(safeOutpoint) || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(spentBy)) return false;
  index.utxos = index.utxos || {};
  index.ownedOutpoints = index.ownedOutpoints || {};
  index.spentOutpoints = index.spentOutpoints || {};
  const previousUtxo = {
    ...(utxo || {}),
    ...(index.utxos?.[safeOutpoint] || {}),
  };
  const match = safeOutpoint.match(/^([0-9a-f]{64}):(\d+)$/i);
  delete index.utxos[safeOutpoint];
  delete index.ownedOutpoints[safeOutpoint];
  index.spentOutpoints[safeOutpoint] = {
    spentBy,
    spentAt: new Date().toISOString(),
    txId: String(previousUtxo?.txId || previousUtxo?.txid || match?.[1] || '').trim().toLowerCase(),
    vout: Number.isInteger(Number(previousUtxo?.vout)) ? Number(previousUtxo.vout) : Number(match?.[2] || 0),
    address: String(previousUtxo?.address || ''),
    satoshis: Number(previousUtxo?.satoshis || 0),
    confirmed: previousUtxo?.confirmed === true,
    ancestorDepth: Number(previousUtxo?.ancestorDepth || 0),
    seenAt: previousUtxo?.seenAt || new Date().toISOString(),
    source: String(options.source || 'confirmed_tx_context_spender'),
  };
  appendSendLog('wallet_owned_output_skipped_known_confirmed_spender', {
    source: String(options.source || 'confirmed_tx_context_spender'),
    outpoint: safeOutpoint,
    spentBy,
    satoshis: Number(previousUtxo?.satoshis || 0),
  });
  return true;
}

function reconcileKnownConfirmedSpendersInSpvIndex(index = null, options = {}) {
  const safeIndex = index || getSpvIndex();
  if (!safeIndex || typeof safeIndex !== 'object') return { removedUtxoCount: 0 };
  const auditBefore = buildWalletBalanceAuditSnapshot(safeIndex);
  const dryRun = options?.dryRun === true;
  safeIndex.utxos = safeIndex.utxos || {};
  safeIndex.ownedOutpoints = safeIndex.ownedOutpoints || {};
  safeIndex.spentOutpoints = safeIndex.spentOutpoints || {};
  safeIndex.txs = safeIndex.txs || {};

  const currentUtxoKeys = new Set(Object.keys(safeIndex.utxos || {}));
  if (!currentUtxoKeys.size) return { removedUtxoCount: 0 };

  const spenders = new Map();
  const contexts = listTxContexts({
    confirmedOnly: true,
    requireRawtx: true,
    limit: Math.max(1000, Number(options.limit || 10000)),
  });
  for (const ctx of contexts) {
    const spenderTxid = String(ctx?.txid || '').trim().toLowerCase();
    const rawtx = rawtxHexFromUnknown(ctx?.rawtx);
    if (!/^[0-9a-f]{64}$/i.test(spenderTxid) || !rawtx) continue;
    let tx = null;
    try {
      tx = new bsv.Transaction(rawtx);
    } catch (_) {
      tx = null;
    }
    if (!tx) continue;
    for (const input of tx.inputs || []) {
      const prevTxId = input.prevTxId ? Buffer.from(input.prevTxId).toString('hex').toLowerCase() : '';
      const vout = Number(input.outputIndex);
      if (!/^[0-9a-f]{64}$/i.test(prevTxId) || !Number.isInteger(vout) || vout < 0) continue;
      const outpoint = `${prevTxId}:${vout}`;
      if (currentUtxoKeys.has(outpoint)) spenders.set(outpoint, spenderTxid);
    }
  }

  if (!spenders.size) return { removedUtxoCount: 0 };
  if (dryRun) {
    return {
      removedUtxoCount: spenders.size,
      sample: Array.from(spenders.entries()).slice(0, 8).map(([outpoint, spentBy]) => ({ outpoint, spentBy })),
    };
  }
  const now = new Date().toISOString();
  let removedUtxoCount = 0;
  for (const [outpoint, spentBy] of spenders.entries()) {
    const previousUtxo = safeIndex.utxos?.[outpoint];
    if (!previousUtxo) continue;
    const ownTxid = String(previousUtxo?.txId || previousUtxo?.txid || '').trim().toLowerCase();
    if (ownTxid && ownTxid === spentBy) continue;
    delete safeIndex.utxos[outpoint];
    delete safeIndex.ownedOutpoints[outpoint];
    safeIndex.spentOutpoints[outpoint] = {
      spentBy,
      spentAt: now,
      txId: ownTxid,
      vout: Number(previousUtxo?.vout),
      address: String(previousUtxo?.address || ''),
      satoshis: Number(previousUtxo?.satoshis || 0),
      confirmed: previousUtxo?.confirmed === true,
      ancestorDepth: Number(previousUtxo?.ancestorDepth || 0),
      seenAt: previousUtxo?.seenAt || now,
      source: String(options.source || 'confirmed_tx_context_reconcile'),
    };
    removedUtxoCount += 1;
  }
  if (removedUtxoCount > 0) {
    saveSpvIndex(safeIndex);
    appendWalletBalanceAudit('wallet_balance_index_mutated', auditBefore, buildWalletBalanceAuditSnapshot(safeIndex), {
      source: String(options.source || 'confirmed_tx_context_reconcile'),
      operation: 'reconcile_known_confirmed_spenders',
      removedUtxoCount,
    });
    appendSendLog('spv_confirmed_spender_reconciled', {
      source: String(options.source || 'confirmed_tx_context_reconcile'),
      removedUtxoCount,
      sample: Array.from(spenders.entries()).slice(0, 8).map(([outpoint, spentBy]) => ({ outpoint, spentBy })),
    });
  }
  return { removedUtxoCount };
}

function deleteTxContextByTxid(txid) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return { deleted: false, txid: '' };
  txContextRowCache.delete(safeTxid);
  if (process.env.BSV_MARKET_DB_PARENT_PROXY === '1') {
    appendSendLog('wallet_tx_context_delete_skipped_proxy_child', {
      pid: process.pid,
      txid: safeTxid,
    });
    return { deleted: false, txid: safeTxid };
  }
  const db = ensureTxContextDb();
  const info = db.prepare('DELETE FROM tx_contexts WHERE txid = ?').run(safeTxid);
  const deleted = Number(info?.changes || 0) > 0;
  if (deleted) {
    appendSendLog('wallet_tx_context_deleted', {
      txid: safeTxid,
    });
  }
  return { deleted, txid: safeTxid };
}

function listTxContexts(options = {}) {
  const confirmedOnly = options.confirmedOnly === true;
  const requireRawtx = options.requireRawtx !== false;
  const limit = Math.max(1, Number(options.limit || 5000));
  const order = String(options.order || 'topological').trim().toLowerCase();
  const filters = [];
  if (confirmedOnly) filters.push('confirmed = 1');
  if (requireRawtx) filters.push("rawtx_hex <> ''");
  const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const orderSql = order === 'recent'
    ? `
    ORDER BY
      COALESCE(updated_at, first_seen_at) DESC,
      first_seen_at DESC,
      txid DESC
  `
    : `
    ORDER BY
      CASE WHEN proof_block_height IS NULL THEN 1 ELSE 0 END ASC,
      proof_block_height ASC,
      first_seen_at ASC,
      txid ASC
  `;
  const db = ensureTxContextDb();
  const rows = db.prepare(`
    SELECT
      txid,
      rawtx_hex,
      input_txids_json,
      source,
      kind,
      confirmed,
      proof_type,
      proof_source,
      proof_hex,
      proof_encoding,
      proof_verified,
      proof_verified_at,
      proof_block_height,
      proof_block_hash,
      proof_merkle_root,
      first_seen_at,
      last_seen_at,
      updated_at
    FROM tx_contexts
    ${whereSql}
    ${orderSql}
    LIMIT ?
  `).all(limit);
  return rows.map((row) => normalizeTxContextRow(row)).filter(Boolean);
}

function upsertTxContext(rawtx, patch = {}) {
  const rawtxHex = rawtxHexFromUnknown(rawtx);
  if (!rawtxHex) return null;
  const info = inspectRawTx(rawtxHex);
  const txid = String(info?.txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) return null;
  const prev = getTxContextByTxid(txid) || {};
  const row = {
    txid,
    rawtx: rawtxHex,
    inputTxids: Array.isArray(info?.inputTxids) ? info.inputTxids.slice(0, 24) : [],
    source: String(patch.source || prev.source || 'local').trim() || 'local',
    kind: String(patch.kind || prev.kind || '').trim(),
    confirmed: Boolean(prev.confirmed || patch.confirmed),
    proofType: String(patch.proofType || prev.proofType || '').trim(),
    proofSource: String(patch.proofSource || prev.proofSource || '').trim(),
    proofHex: String(patch.proofHex || prev.proofHex || '').trim().toLowerCase(),
    proofEncoding: String(patch.proofEncoding || prev.proofEncoding || '').trim(),
    proofVerified: Boolean(
      patch.proofVerified === true
      || (patch.proofVerified !== false && prev.proofVerified === true)
    ),
    proofVerifiedAt: patch.proofVerifiedAt || prev.proofVerifiedAt || null,
    proofBlockHeight: Number.isFinite(Number(patch.proofBlockHeight))
      ? Number(patch.proofBlockHeight)
      : (Number.isFinite(Number(prev.proofBlockHeight)) ? Number(prev.proofBlockHeight) : null),
    proofBlockHash: String(patch.proofBlockHash || prev.proofBlockHash || '').trim().toLowerCase(),
    proofMerkleRoot: String(patch.proofMerkleRoot || prev.proofMerkleRoot || '').trim().toLowerCase(),
    firstSeenAt: prev.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (process.env.BSV_MARKET_DB_PARENT_PROXY === '1') {
    setCachedTxContext(row);
    const parentNotified = notifyParentTxContextUpsert(row);
    appendSendLog('wallet_tx_context_write_skipped_proxy_child', {
      pid: process.pid,
      txid,
      source: row.source,
      kind: row.kind,
      confirmed: row.confirmed,
      proofType: row.proofType,
      parentNotified,
    });
    return row;
  }
  const db = ensureTxContextDb();
  db.prepare(`
    INSERT INTO tx_contexts(
      txid,
      rawtx_hex,
      input_txids_json,
      source,
      kind,
      confirmed,
      proof_type,
      proof_source,
      proof_hex,
      proof_encoding,
      proof_verified,
      proof_verified_at,
      proof_block_height,
      proof_block_hash,
      proof_merkle_root,
      first_seen_at,
      last_seen_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(txid) DO UPDATE SET
      rawtx_hex = excluded.rawtx_hex,
      input_txids_json = excluded.input_txids_json,
      source = excluded.source,
      kind = excluded.kind,
      confirmed = CASE
        WHEN tx_contexts.confirmed = 1 OR excluded.confirmed = 1 THEN 1
        ELSE 0
      END,
      proof_type = excluded.proof_type,
      proof_source = excluded.proof_source,
      proof_hex = excluded.proof_hex,
      proof_encoding = excluded.proof_encoding,
      proof_verified = CASE
        WHEN tx_contexts.proof_verified = 1 OR excluded.proof_verified = 1 THEN 1
        ELSE 0
      END,
      proof_verified_at = COALESCE(excluded.proof_verified_at, tx_contexts.proof_verified_at),
      proof_block_height = COALESCE(excluded.proof_block_height, tx_contexts.proof_block_height),
      proof_block_hash = CASE
        WHEN excluded.proof_block_hash <> '' THEN excluded.proof_block_hash
        ELSE tx_contexts.proof_block_hash
      END,
      proof_merkle_root = CASE
        WHEN excluded.proof_merkle_root <> '' THEN excluded.proof_merkle_root
        ELSE tx_contexts.proof_merkle_root
      END,
      first_seen_at = tx_contexts.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `).run(
    row.txid,
    row.rawtx,
    JSON.stringify(Array.isArray(row.inputTxids) ? row.inputTxids : []),
    row.source,
    row.kind,
    row.confirmed ? 1 : 0,
    row.proofType,
    row.proofSource,
    row.proofHex,
    row.proofEncoding,
    row.proofVerified ? 1 : 0,
    row.proofVerifiedAt,
    row.proofBlockHeight,
    row.proofBlockHash,
    row.proofMerkleRoot,
    row.firstSeenAt,
    row.lastSeenAt,
    row.updatedAt,
  );
  setCachedTxContext(row);
  return row;
}

async function wocGetTxInfo(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return null;
  const url = `${WOC_BASE}/tx/hash/${safeTxid}`;
  for (let i = 0; i < 6; i += 1) {
    try {
      await wocRateLimitWait(options);
      const res = await axios.get(url, { timeout: WOC_TIMEOUT_MS });
      return res?.data && typeof res.data === 'object' ? res.data : null;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) return null;
      appendRecoverLog('woc_txinfo_retry', { txid: safeTxid, attempt: i + 1, status: status || null, error: err.message });
      if ((status === 429 || status === 503 || status === 504 || !status) && i < 5) {
        await sleep(Math.min(4500, 300 * (2 ** i)));
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function wocGetBlockHeaderByHeight(height, options = {}) {
  const safeHeight = Number(height);
  if (!Number.isFinite(safeHeight) || safeHeight < 0) return null;
  const url = `${WOC_BASE}/block/${safeHeight}/header`;
  for (let i = 0; i < 6; i += 1) {
    try {
      await wocRateLimitWait(options);
      const res = await axios.get(url, { timeout: WOC_TIMEOUT_MS });
      return res?.data && typeof res.data === 'object' ? res.data : null;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) return null;
      appendRecoverLog('woc_block_header_retry', { height: safeHeight, attempt: i + 1, status: status || null, error: err.message });
      if ((status === 429 || status === 503 || status === 504 || !status) && i < 5) {
        await sleep(Math.min(4500, 300 * (2 ** i)));
        continue;
      }
      throw err;
    }
  }
  return null;
}

async function wocGetMerkleProofTsc(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return null;
  const url = `${WOC_BASE}/tx/${safeTxid}/proof/tsc`;
  for (let i = 0; i < 6; i += 1) {
    try {
      await wocRateLimitWait(options);
      const res = await axios.get(url, { timeout: WOC_TIMEOUT_MS });
      return res?.data ?? null;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) return null;
      appendRecoverLog('woc_tsc_proof_retry', { txid: safeTxid, attempt: i + 1, status: status || null, error: err.message });
      if ((status === 429 || status === 503 || status === 504 || !status) && i < 5) {
        await sleep(Math.min(4500, 300 * (2 ** i)));
        continue;
      }
      throw err;
    }
  }
  return null;
}

function getBhsHeaderHashAtHeight(height) {
  const safeHeight = Number(height);
  if (!Number.isFinite(safeHeight) || safeHeight < 0) return '';
  try {
    const status = typeof bhsDomain.getBhsStatusSync === 'function'
      ? bhsDomain.getBhsStatusSync('main')
      : null;
    const row = status?.headers?.[String(safeHeight)];
    return String(row?.hash || '').trim().toLowerCase();
  } catch (_) {
    return '';
  }
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
  if (!BsvSdkMerklePath) return null;
  const safeTxid = String(txid || '').trim().toLowerCase();
  const rows = Array.isArray(proofRows) ? proofRows : [];
  const row = rows.find((item) => String(item?.txOrId || '').trim().toLowerCase() === safeTxid) || rows[0];
  if (!row || !Number.isFinite(Number(row?.index))) return null;
  const index = Number(row.index);
  const nodes = Array.isArray(row.nodes) ? row.nodes : [];
  const path = [];
  if (!nodes.length) {
    path.push([{ offset: index, txid: true, hash: safeTxid }]);
    return new BsvSdkMerklePath(Number(blockHeight), path);
  }
  const level0 = [{ offset: index, txid: true, hash: safeTxid }];
  const node0 = normalizeTscNode(nodes[0]);
  const siblingOffset0 = index ^ 1;
  level0.push(node0.duplicate === true
    ? { offset: siblingOffset0, duplicate: true }
    : { offset: siblingOffset0, hash: node0.hash });
  level0.sort((a, b) => a.offset - b.offset);
  path.push(level0);
  for (let i = 1; i < nodes.length; i += 1) {
    const node = normalizeTscNode(nodes[i]);
    const offset = (index >> i) ^ 1;
    path.push([node.duplicate === true ? { offset, duplicate: true } : { offset, hash: node.hash }]);
  }
  return new BsvSdkMerklePath(Number(blockHeight), path);
}

async function fetchVerifiedMerkleProof(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return null;
  if (!ALLOW_WOC_SEND_CONTEXT_FETCH && options.allowDisabled !== true) {
    appendSendLog('proof_fetch_blocked_policy', { txid: safeTxid, source: 'woc', policy: 'send_context_woc_disabled' });
    return null;
  }
  appendSendLog('proof_fetch_start', { txid: safeTxid });
  const txInfo = await wocGetTxInfo(safeTxid, options);
  const blockHeight = Number(txInfo?.blockheight || 0);
  const blockHash = String(txInfo?.blockhash || '').trim().toLowerCase();
  if (!blockHeight || !/^[0-9a-f]{64}$/i.test(blockHash)) {
    appendSendLog('proof_fetch_skip_unconfirmed', { txid: safeTxid });
    return null;
  }
  const proofRows = await wocGetMerkleProofTsc(safeTxid, options);
  if (!Array.isArray(proofRows) || !proofRows.length) {
    appendSendLog('proof_fetch_missing', { txid: safeTxid, blockHeight, blockHash });
    return null;
  }
  const merklePath = merklePathFromTscProof(safeTxid, blockHeight, proofRows);
  if (!merklePath) {
    appendSendLog('proof_parse_failed', { txid: safeTxid, blockHeight, blockHash, reason: 'tsc_to_merkle_path_failed' });
    return null;
  }
  const computedRoot = String(merklePath.computeRoot(safeTxid) || '').trim().toLowerCase();
  const blockHeader = await wocGetBlockHeaderByHeight(blockHeight, options);
  const merkleRoot = String(blockHeader?.merkleroot || '').trim().toLowerCase();
  const bhsHash = getBhsHeaderHashAtHeight(blockHeight);
  const bhsMatched = !bhsHash || bhsHash === blockHash;
  const rootMatched = /^[0-9a-f]{64}$/i.test(merkleRoot) && merkleRoot === computedRoot;
  appendSendLog('proof_verify_result', {
    txid: safeTxid,
    blockHeight,
    blockHash,
    bhsHash,
    bhsMatched,
    merkleRoot,
    computedRoot,
    rootMatched,
    proofNodeCount: Array.isArray(proofRows?.[0]?.nodes) ? proofRows[0].nodes.length : 0,
  });
  if (!rootMatched || !bhsMatched) return null;
  return {
    txid: safeTxid,
    blockHeight,
    blockHash,
    merkleRoot,
    proofHex: merklePath.toHex(),
    proofEncoding: 'bump',
    proofType: 'merkle-path-tsc',
    proofSource: 'woc-tsc',
    proofVerified: true,
    proofVerifiedAt: new Date().toISOString(),
  };
}

async function wocGetRawTx(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return '';
  const url = `${WOC_BASE}/tx/${safeTxid}/hex`;
  for (let i = 0; i < 8; i += 1) {
    try {
      await wocRateLimitWait(options);
      const res = await axios.get(url, { timeout: WOC_TIMEOUT_MS });
      const hex = String(res?.data || '').trim().toLowerCase();
      return /^[0-9a-f]+$/i.test(hex) ? hex : '';
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) return '';
      appendRecoverLog('woc_rawtx_retry', { txid: safeTxid, attempt: i + 1, status: status || null, error: err.message });
      if ((status === 429 || status === 503 || status === 504 || !status) && i < 7) {
        await sleep(Math.min(4500, 300 * (2 ** i)));
        continue;
      }
      throw err;
    }
  }
  return '';
}

async function backfillTxContextsFromWoc(txids, options = {}) {
  if (!ALLOW_WOC_SEND_CONTEXT_FETCH && options.allowDisabled !== true) {
    appendSendLog('tx_context_backfill_blocked_policy', {
      source: 'woc',
      requested: Array.isArray(txids) ? txids.length : 0,
      policy: 'send_context_woc_disabled',
    });
    return { requested: Array.isArray(txids) ? txids.length : 0, inserted: 0, skipped: 0 };
  }
  const safeTxids = Array.from(new Set((Array.isArray(txids) ? txids : [])
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid))));
  if (!safeTxids.length) {
    return { requested: 0, inserted: 0, skipped: 0 };
  }
  let inserted = 0;
  let skipped = 0;
  const sourceLabel = String(options?.sourceLabel || 'woc').trim() || 'woc';
  const kindLabel = String(options?.kindLabel || 'sync_backfill').trim() || 'sync_backfill';
  const proofRequired = options?.proofRequired !== false;
  const shouldFetchProof = options?.fetchProof !== false && options.confirmed === true;
  const fetchRawTx = typeof options?.fetchRawTx === 'function' ? options.fetchRawTx : wocGetRawTx;
  const fetchProof = typeof options?.fetchProof === 'function' ? options.fetchProof : fetchVerifiedMerkleProof;
  for (const txid of safeTxids) {
    if (txContextBackfillInFlight.has(txid)) {
      try {
        const shared = await txContextBackfillInFlight.get(txid);
        inserted += Number(shared?.inserted || 0);
        skipped += Number(shared?.skipped || 0);
      } catch (err) {
        appendSendLog('tx_context_backfill_join_failed', {
          source: 'woc',
          txid,
          error: String(err?.message || 'backfill join failed'),
        });
      }
      continue;
    }
    const work = (async () => {
      let localInserted = 0;
      let localSkipped = 0;
      const existing = getTxContextByTxid(txid) || {};
      const proofReady = options.confirmed === true && proofRequired
        ? hasConfirmedBoundaryProof(existing, null)
        : true;
      if (options.onlyMissing !== false && existing?.rawtx && proofReady) {
        localSkipped += 1;
        return { inserted: localInserted, skipped: localSkipped };
      }
      try {
        const rawtx = existing?.rawtx ? String(existing.rawtx) : await fetchRawTx(txid, options);
        if (!rawtx) {
          appendSendLog('tx_context_backfill_missing', {
            source: sourceLabel,
            kind: kindLabel,
            txid,
          });
          return { inserted: localInserted, skipped: localSkipped };
        }
        let verifiedProof = null;
        if (shouldFetchProof) {
          verifiedProof = await fetchProof(txid, options);
        }
        upsertTxContext(rawtx, {
          source: sourceLabel,
          kind: kindLabel,
          confirmed: options.confirmed === true,
          proofType: String(verifiedProof?.proofType || ''),
          proofSource: String(verifiedProof?.proofSource || ''),
          proofHex: String(verifiedProof?.proofHex || ''),
          proofEncoding: String(verifiedProof?.proofEncoding || ''),
          proofVerified: verifiedProof?.proofVerified === true,
          proofVerifiedAt: verifiedProof?.proofVerifiedAt || null,
          proofBlockHeight: Number.isFinite(Number(verifiedProof?.blockHeight)) ? Number(verifiedProof.blockHeight) : null,
          proofBlockHash: String(verifiedProof?.blockHash || ''),
          proofMerkleRoot: String(verifiedProof?.merkleRoot || ''),
        });
        appendSendLog('tx_context_backfill_proof', {
          source: sourceLabel,
          kind: kindLabel,
          txid,
          confirmed: options.confirmed === true,
          proofVerified: verifiedProof?.proofVerified === true,
          proofType: String(verifiedProof?.proofType || ''),
          proofBlockHeight: Number(verifiedProof?.blockHeight || 0),
        });
        localInserted += 1;
      } catch (err) {
        appendSendLog('tx_context_backfill_failed', {
          source: sourceLabel,
          kind: kindLabel,
          txid,
          error: String(err?.message || 'backfill failed'),
        });
      }
      return { inserted: localInserted, skipped: localSkipped };
    })();
    txContextBackfillInFlight.set(txid, work);
    try {
      const result = await work;
      inserted += Number(result?.inserted || 0);
      skipped += Number(result?.skipped || 0);
    } finally {
      if (txContextBackfillInFlight.get(txid) === work) txContextBackfillInFlight.delete(txid);
    }
  }
  if (safeTxids.length) {
    appendSendLog('tx_context_backfill_done', {
      source: sourceLabel,
      kind: kindLabel,
      requested: safeTxids.length,
      inserted,
      skipped,
      confirmed: Boolean(options.confirmed),
    });
  }
  return {
    requested: safeTxids.length,
    inserted,
    skipped,
  };
}

function collectMissingDirectParentTxids(inputTxids = []) {
  const ZERO = '0000000000000000000000000000000000000000000000000000000000000000';
  const unique = Array.from(new Set((Array.isArray(inputTxids) ? inputTxids : [])
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid) && txid !== ZERO)));
  if (!unique.length) return [];
  return unique.filter((txid) => !getTxContextByTxid(txid)?.rawtx);
}

async function ensureDirectParentTxContexts(inputTxids = [], options = {}) {
  const missingTxids = collectMissingDirectParentTxids(inputTxids);
  if (!missingTxids.length) {
    return { requested: 0, inserted: 0, skipped: 0, missingTxids: [] };
  }
  const result = await backfillTxContextsFromWoc(missingTxids, {
    ...options,
    allowDisabled: true,
    onlyMissing: true,
    confirmed: options.confirmed === true,
    proofRequired: false,
    fetchProof: false,
    sourceLabel: String(options?.sourceLabel || 'woc').trim() || 'woc',
    kindLabel: String(options?.kindLabel || 'direct_parent_backfill').trim() || 'direct_parent_backfill',
  });
  return {
    ...result,
    missingTxids,
  };
}

function scheduleDirectParentTxContextBackfill(inputTxids = [], options = {}) {
  const missingTxids = collectMissingDirectParentTxids(inputTxids);
  if (!missingTxids.length) return Promise.resolve({ requested: 0, inserted: 0, skipped: 0, missingTxids: [] });
  const task = ensureDirectParentTxContexts(missingTxids, options)
    .catch((err) => {
      appendSendLog('direct_parent_tx_context_backfill_failed', {
        source: String(options?.source || options?.sourceLabel || 'direct_parent_backfill'),
        txidCount: missingTxids.length,
        txids: missingTxids.slice(0, 12),
        error: String(err?.message || 'direct parent tx_context backfill failed'),
      });
      return { requested: missingTxids.length, inserted: 0, skipped: 0, missingTxids, error: String(err?.message || '') };
    });
  return task;
}

function markTxContextConfirmed(txid) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return;
  const existing = getTxContextByTxid(safeTxid);
  if (!existing) return;
  upsertTxContext(existing.rawtx, {
    source: existing.source || 'local',
    kind: existing.kind || '',
    confirmed: true,
    proofType: existing.proofType || '',
    proofSource: existing.proofSource || '',
    proofHex: existing.proofHex || '',
    proofEncoding: existing.proofEncoding || '',
    proofVerified: existing.proofVerified === true,
    proofVerifiedAt: existing.proofVerifiedAt || null,
    proofBlockHeight: existing.proofBlockHeight,
    proofBlockHash: existing.proofBlockHash || '',
    proofMerkleRoot: existing.proofMerkleRoot || '',
  });
}

function inspectRawTx(rawtx) {
  const tx = txFromUnknown(rawtx);
  if (!tx) return null;
  const txid = String(tx.id || '').trim().toLowerCase();
  const inputTxids = [];
  const inputOutpoints = [];
  for (const input of (tx.inputs || [])) {
    let prevTxid = '';
    try {
      prevTxid = input?.prevTxId ? Buffer.from(input.prevTxId).toString('hex').trim().toLowerCase() : '';
    } catch (_) {
      prevTxid = '';
    }
    const outputIndex = Number(input?.outputIndex);
    if (!/^[0-9a-f]{64}$/i.test(prevTxid)) continue;
    inputTxids.push(prevTxid);
    if (Number.isInteger(outputIndex) && outputIndex >= 0) {
      inputOutpoints.push(`${prevTxid}:${outputIndex}`);
    }
  }
  return {
    txid,
    inputTxids: Array.from(new Set(inputTxids)),
    inputOutpoints: Array.from(new Set(inputOutpoints)),
  };
}

function hasConfirmedBoundaryProof(ctxRow = null, indexRow = null) {
  const proofType = String(ctxRow?.proofType || '').trim();
  const proofHex = String(ctxRow?.proofHex || '').trim();
  return Boolean(
    (ctxRow?.confirmed === true || indexRow?.confirmed === true)
    && proofType
    && proofHex
    && ctxRow?.proofVerified === true
  );
}

function buildBeefBumpFriendlyContext(rawtx, options = {}) {
  const rawtxHex = rawtxHexFromUnknown(rawtx);
  const root = inspectRawTx(rawtxHex);
  if (!root?.txid) return null;
  const maxAncestors = Math.max(0, Number(options.maxAncestors || BROADCAST_CONTEXT_MAX_ANCESTORS));
  const index = getSpvIndex();
  const visited = new Set();
  const ancestors = [];
  const missingAncestors = [];
  const bumpHints = [];
  let ancestorBudget = maxAncestors;

  function addBumpHint(txid, source) {
    const safeTxid = String(txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return;
    if (bumpHints.some((row) => row.txid === safeTxid)) return;
    const indexRow = index?.txs?.[safeTxid] || {};
    const ctxRow = getTxContextByTxid(safeTxid) || {};
    bumpHints.push({
      txid: safeTxid,
      confirmed: Boolean(ctxRow.confirmed || indexRow.confirmed),
      ancestorDepth: Number(indexRow.ancestorDepth || 0),
      source,
      firstSeenAt: ctxRow.firstSeenAt || indexRow.firstSeenAt || null,
      lastSeenAt: ctxRow.lastSeenAt || indexRow.lastSeenAt || null,
    });
  }

  function visitAncestor(txid, depth) {
    const safeTxid = String(txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return;
    if (visited.has(safeTxid)) return;
    visited.add(safeTxid);
    addBumpHint(safeTxid, 'spv-index');
    const ctxRow = getTxContextByTxid(safeTxid);
    const indexRow = index?.txs?.[safeTxid] || {};
    const ancestorConfirmed = Boolean(ctxRow?.confirmed || indexRow?.confirmed);
    const ancestorBoundarySatisfied = hasConfirmedBoundaryProof(ctxRow, indexRow);
    if (ancestorConfirmed && !ancestorBoundarySatisfied) {
      if (ctxRow?.rawtx) {
        const info = inspectRawTx(ctxRow.rawtx);
        ancestors.push({
          txid: safeTxid,
          rawtx: ctxRow.rawtx,
          confirmed: true,
          proofType: String(ctxRow?.proofType || ''),
          proofSource: String(ctxRow?.proofSource || ''),
          proofHex: String(ctxRow?.proofHex || ''),
          depth,
          inputTxids: Array.isArray(info?.inputTxids) ? info.inputTxids.slice(0, 24) : [],
          source: String(ctxRow.source || 'local'),
          kind: String(ctxRow.kind || ''),
        });
      }
      missingAncestors.push(safeTxid);
      addBumpHint(safeTxid, 'confirmed-proof-missing');
      return;
    }
    if (ancestorBudget <= 0) {
      if (!ancestorBoundarySatisfied) missingAncestors.push(safeTxid);
      return;
    }
    if (!ctxRow?.rawtx) {
      if (!ancestorBoundarySatisfied) missingAncestors.push(safeTxid);
      else addBumpHint(safeTxid, 'confirmed-boundary');
      return;
    }
    const info = inspectRawTx(ctxRow.rawtx);
    ancestorBudget -= 1;
    if (!ancestorBoundarySatisfied) {
      for (const parentTxid of info?.inputTxids || []) {
        visitAncestor(parentTxid, depth + 1);
      }
    }
    ancestors.push({
      txid: safeTxid,
      rawtx: ctxRow.rawtx,
      confirmed: ancestorConfirmed,
      proofType: String(ctxRow?.proofType || ''),
      proofSource: String(ctxRow?.proofSource || ''),
      proofHex: String(ctxRow?.proofHex || ''),
      depth,
      inputTxids: Array.isArray(info?.inputTxids) ? info.inputTxids.slice(0, 24) : [],
      source: String(ctxRow.source || 'local'),
      kind: String(ctxRow.kind || ''),
    });
    addBumpHint(safeTxid, ancestorBoundarySatisfied ? 'confirmed-boundary' : 'tx-context');
  }

  for (const parentTxid of root.inputTxids || []) {
    visitAncestor(parentTxid, 1);
  }

  const packageTxids = ancestors.map((row) => row.txid).concat(root.txid);
  return {
    format: 'beef-bump-friendly',
    version: 1,
    createdAt: new Date().toISOString(),
    root: {
      txid: root.txid,
      rawtx: rawtxHex,
      inputTxids: Array.isArray(root.inputTxids) ? root.inputTxids.slice(0, 24) : [],
    },
    ancestors,
    bumpHints,
    missingAncestors: Array.from(new Set(missingAncestors)).filter((txid) => txid !== root.txid),
    packageTxids,
  };
}

function buildLocalBroadcastContext(rawtx, options = {}) {
  const rawtxHex = rawtxHexFromUnknown(rawtx);
  const root = inspectRawTx(rawtxHex);
  if (!root?.txid) return null;
  const index = getSpvIndex();
  const visited = new Set();
  const ancestors = [];
  const missingAncestors = [];
  const allowMissingExternalInputs = options.allowMissingExternalInputs === true;

  function visitAncestor(txid, depth) {
    const safeTxid = String(txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return;
    if (visited.has(safeTxid)) return;
    visited.add(safeTxid);
    const ctxRow = getTxContextByTxid(safeTxid);
    const indexRow = index?.txs?.[safeTxid] || {};
    if (Boolean(ctxRow?.confirmed || indexRow?.confirmed)) return;
    if (!ctxRow?.rawtx) {
      if (allowMissingExternalInputs) return;
      missingAncestors.push(safeTxid);
      return;
    }
    const info = inspectRawTx(ctxRow.rawtx);
    for (const parentTxid of info?.inputTxids || []) {
      visitAncestor(parentTxid, depth + 1);
    }
    ancestors.push({
      txid: safeTxid,
      rawtx: ctxRow.rawtx,
      confirmed: false,
      depth,
      inputTxids: Array.isArray(info?.inputTxids) ? info.inputTxids.slice(0, 24) : [],
      source: String(ctxRow.source || 'local'),
      kind: String(ctxRow.kind || ''),
    });
  }

  for (const parentTxid of root.inputTxids || []) {
    visitAncestor(parentTxid, 1);
  }

  const items = ancestors.map((row) => ({
    txid: row.txid,
    rawtx: rawtxHexFromUnknown(row.rawtx),
    relation: 'ancestor',
  })).filter((row) => row.txid && row.rawtx);
  items.push({
    txid: root.txid,
    rawtx: rawtxHex,
    relation: 'root',
  });
  return {
    format: 'local-broadcast-chain',
    version: 1,
    createdAt: new Date().toISOString(),
    root: {
      txid: root.txid,
      rawtx: rawtxHex,
      inputTxids: Array.isArray(root.inputTxids) ? root.inputTxids.slice(0, 24) : [],
    },
    ancestors,
    missingAncestors: Array.from(new Set(missingAncestors)).filter((txid) => txid !== root.txid),
    items,
    complete: missingAncestors.length === 0,
  };
}

async function ensureLocalBroadcastContextReady(rawtx, options = {}) {
  const rawtxHex = rawtxHexFromUnknown(rawtx);
  if (!rawtxHex) throw new Error('Missing raw transaction for local broadcast context');
  const allowMissingExternalInputs = options.allowMissingExternalInputs === true;
  let packageResult = buildLocalBroadcastContext(rawtxHex, { allowMissingExternalInputs });
  let rounds = 0;
  while (!allowMissingExternalInputs && (packageResult?.missingAncestors || []).length && rounds < BEEF_CONTEXT_BACKFILL_MAX_ROUNDS) {
    const missingTxids = Array.from(new Set((packageResult?.missingAncestors || [])
      .map((txid) => String(txid || '').trim().toLowerCase())
      .filter((txid) => /^[0-9a-f]{64}$/i.test(txid))));
    if (!missingTxids.length) break;
    rounds += 1;
    appendSendLog('local_broadcast_context_backfill_start', {
      txid: String(packageResult?.root?.txid || ''),
      round: rounds,
      missingAncestors: missingTxids,
    });
    const backfill = await backfillTxContextsFromWoc(missingTxids, {
      ...options,
      allowDisabled: true,
      confirmed: false,
      onlyMissing: true,
    });
    appendSendLog('local_broadcast_context_backfill_round', {
      txid: String(packageResult?.root?.txid || ''),
      round: rounds,
      requested: Number(backfill.requested || 0),
      inserted: Number(backfill.inserted || 0),
      skipped: Number(backfill.skipped || 0),
    });
    packageResult = buildLocalBroadcastContext(rawtxHex, { allowMissingExternalInputs });
    if (Number(backfill.inserted || 0) <= 0) break;
  }
  const finalMissing = Array.from(new Set((packageResult?.missingAncestors || [])
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid))));
  if (Array.isArray(packageResult?.items) && packageResult.items.length > 1) {
    const rootTxid = String(packageResult?.root?.txid || '').trim().toLowerCase();
    const visibleAncestorTxids = [];
    for (const item of packageResult.items) {
      const txid = String(item?.txid || '').trim().toLowerCase();
      if (!txid || txid === rootTxid) continue;
      // Skip rebroadcasting ancestors that are already externally visible or
      // confirmed. This keeps child-order retries on the local-node path but
      // avoids fragile parent+child direct-tx package races.
      // eslint-disable-next-line no-await-in-loop
      const visible = await isTxVisibleOnPublicIndex(txid, { allowDisabled: true }).catch(() => false);
      if (visible) visibleAncestorTxids.push(txid);
    }
    if (visibleAncestorTxids.length) {
      const visibleSet = new Set(visibleAncestorTxids);
      packageResult = {
        ...packageResult,
        ancestors: Array.isArray(packageResult.ancestors)
          ? packageResult.ancestors.filter((row) => !visibleSet.has(String(row?.txid || '').trim().toLowerCase()))
          : packageResult.ancestors,
        items: packageResult.items.filter((row) => {
          const txid = String(row?.txid || '').trim().toLowerCase();
          return txid === rootTxid || !visibleSet.has(txid);
        }),
      };
      appendSendLog('local_broadcast_context_pruned_visible_ancestors', {
        txid: rootTxid,
        prunedAncestorCount: visibleAncestorTxids.length,
        prunedAncestors: visibleAncestorTxids.slice(0, 24),
        packageTxCount: Number(packageResult?.items?.length || 0),
      });
    }
  }
  if (options.rootOnlyBroadcast === true && Array.isArray(packageResult?.items) && packageResult.items.length > 1) {
    const rootTxid = String(packageResult?.root?.txid || '').trim().toLowerCase();
    const rootRawtx = String(packageResult?.root?.rawtx || rawtxHex).trim();
    packageResult = {
      ...packageResult,
      ancestors: [],
      items: [{
        txid: rootTxid,
        rawtx: rootRawtx,
        relation: 'root',
      }],
    };
    appendSendLog('local_broadcast_context_root_only', {
      txid: rootTxid,
      reason: String(options.rootOnlyReason || 'root_only_broadcast'),
    });
  }
  appendSendLog('local_broadcast_context_ready', {
    txid: String(packageResult?.root?.txid || ''),
    rounds,
    packageTxCount: Number(packageResult?.items?.length || 0),
    missingAncestorCount: finalMissing.length,
    missingAncestors: finalMissing.slice(0, 24),
  });
  if (finalMissing.length) {
    const err = new Error(`broadcast context incomplete: missing ${finalMissing.length} local ancestor tx(s)`);
    err.code = 'LOCAL_BROADCAST_CONTEXT_INCOMPLETE';
    err.missingAncestors = finalMissing;
    throw err;
  }
  return packageResult;
}

function canSpendWithLocalChain(txid, context = null) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return false;
  const index = getSpvIndex();
  if (Boolean(index?.txs?.[safeTxid]?.confirmed)) return true;
  const ctxRow = getTxContextByTxid(safeTxid);
  if (!ctxRow?.rawtx) return false;
  const built = context || buildLocalBroadcastContext(ctxRow.rawtx);
  return Boolean(built?.complete) && Array.isArray(built?.missingAncestors) && built.missingAncestors.length === 0;
}

async function ensureBeefContextReady(rawtx, options = {}) {
  const rawtxHex = rawtxHexFromUnknown(rawtx);
  if (!rawtxHex) throw new Error('Missing raw transaction for BEEF context');
  let packageResult = getContextPackageItems(rawtxHex);
  let rounds = 0;
  while ((packageResult?.context?.missingAncestors || []).length && rounds < BEEF_CONTEXT_BACKFILL_MAX_ROUNDS) {
    const missingTxids = Array.from(new Set((packageResult?.context?.missingAncestors || [])
      .map((txid) => String(txid || '').trim().toLowerCase())
      .filter((txid) => /^[0-9a-f]{64}$/i.test(txid))));
    if (!missingTxids.length) break;
    if (!ALLOW_WOC_SEND_CONTEXT_FETCH) {
      appendSendLog('beef_context_backfill_blocked', {
        txid: String(packageResult?.context?.root?.txid || ''),
        round: rounds + 1,
        reason: 'woc_disabled_by_policy',
        missingAncestors: missingTxids,
      });
      break;
    }
    rounds += 1;
    appendSendLog('beef_context_backfill_start', {
      txid: String(packageResult?.context?.root?.txid || ''),
      round: rounds,
      missingAncestors: missingTxids,
    });
    const backfill = await backfillTxContextsFromWoc(missingTxids, {
      ...options,
      confirmed: true,
      onlyMissing: true,
    });
    appendSendLog('beef_context_backfill_round', {
      txid: String(packageResult?.context?.root?.txid || ''),
      round: rounds,
      requested: Number(backfill.requested || 0),
      inserted: Number(backfill.inserted || 0),
      skipped: Number(backfill.skipped || 0),
    });
    packageResult = getContextPackageItems(rawtxHex);
    if (Number(backfill.inserted || 0) <= 0) break;
  }
  const finalMissing = Array.from(new Set((packageResult?.context?.missingAncestors || [])
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid))));
  const beefComplete = Boolean(packageResult?.beef?.complete) && finalMissing.length === 0;
  appendSendLog('beef_context_ready', {
    txid: String(packageResult?.context?.root?.txid || ''),
    rounds,
    contextFormat: String(packageResult?.context?.format || ''),
    beefFormat: String(packageResult?.beef?.format || ''),
    packageTxCount: Number(packageResult?.items?.length || 0),
    missingAncestorCount: finalMissing.length,
    missingAncestors: finalMissing,
    beefComplete,
  });
  if (!beefComplete) {
    const err = new Error(`BEEF context incomplete: missing ${finalMissing.length} ancestor tx(s)`);
    err.code = 'BEEF_CONTEXT_INCOMPLETE';
    err.missingAncestors = finalMissing;
    err.packageResult = packageResult;
    throw err;
  }
  return packageResult;
}

function getContextPackageItems(rawtx, context = null) {
  const rawtxHex = rawtxHexFromUnknown(rawtx);
  const built = context || buildBeefBumpFriendlyContext(rawtxHex);
  const seen = new Set();
  const items = [];
  for (const row of built?.ancestors || []) {
    const txid = String(row?.txid || '').trim().toLowerCase();
    const hex = rawtxHexFromUnknown(row?.rawtx);
    if (!txid || !hex || seen.has(txid)) continue;
    seen.add(txid);
    items.push({
      txid,
      rawtx: hex,
      relation: 'ancestor',
    });
  }
  const rootInfo = inspectRawTx(rawtxHex);
  if (rootInfo?.txid && !seen.has(rootInfo.txid)) {
    items.push({
      txid: rootInfo.txid,
      rawtx: rawtxHex,
      relation: 'root',
    });
  }
  return {
    context: built,
    items,
    beef: buildSdkBeefEnvelope(rawtxHex, built),
  };
}

function buildSdkBeefEnvelope(rawtx, context = null) {
  if (!BsvSdkTransaction || typeof BsvSdkTransaction.fromHex !== 'function') return null;
  const rawtxHex = rawtxHexFromUnknown(rawtx);
  if (!rawtxHex) return null;
  const built = context || buildBeefBumpFriendlyContext(rawtxHex);
  try {
    const txById = new Map();
    const rootTx = BsvSdkTransaction.fromHex(rawtxHex);
    const rootTxid = String(rootTx?.id?.('hex') || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(rootTxid)) return null;
    txById.set(rootTxid, rootTx);
    for (const row of built?.ancestors || []) {
      const ancestorHex = rawtxHexFromUnknown(row?.rawtx);
      const ancestorTxid = String(row?.txid || '').trim().toLowerCase();
      if (!ancestorHex || !/^[0-9a-f]{64}$/i.test(ancestorTxid) || txById.has(ancestorTxid)) continue;
      const ancestorTx = BsvSdkTransaction.fromHex(ancestorHex);
      const proofHex = String(row?.proofHex || getTxContextByTxid(ancestorTxid)?.proofHex || '').trim().toLowerCase();
      if (proofHex && BsvSdkMerklePath) {
        try {
          ancestorTx.merklePath = BsvSdkMerklePath.fromHex(proofHex);
        } catch (err) {
          appendSendLog('proof_attach_failed', {
            txid: ancestorTxid,
            error: String(err?.message || 'proof attach failed'),
          });
        }
      }
      txById.set(ancestorTxid, ancestorTx);
    }
    for (const tx of txById.values()) {
      for (const input of (tx.inputs || [])) {
        const sourceTxid = String(input?.sourceTXID || '').trim().toLowerCase();
        if (!sourceTxid || input.sourceTransaction || !txById.has(sourceTxid)) continue;
        input.sourceTransaction = txById.get(sourceTxid);
      }
    }
    const beefHex = typeof rootTx.toHexBEEF === 'function'
      ? String(rootTx.toHexBEEF(true) || '')
      : Buffer.from(rootTx.toBEEF(true)).toString('hex');
    const atomicBeefHex = typeof rootTx.toHexAtomicBEEF === 'function'
      ? String(rootTx.toHexAtomicBEEF(true) || '')
      : Buffer.from(rootTx.toAtomicBEEF(true)).toString('hex');
    return {
      format: 'sdk-atomic-beef',
      txid: rootTxid,
      beefHex: String(beefHex || '').trim().toLowerCase(),
      atomicBeefHex: String(atomicBeefHex || '').trim().toLowerCase(),
      ancestorLinkedCount: Array.from(txById.values()).reduce((acc, tx) => (
        acc + (tx.inputs || []).filter((input) => input?.sourceTransaction).length
      ), 0),
      txCount: txById.size,
      missingAncestorCount: Array.isArray(built?.missingAncestors) ? built.missingAncestors.length : 0,
      complete: Array.isArray(built?.missingAncestors) ? built.missingAncestors.length === 0 : false,
    };
  } catch (err) {
    appendSendLog('beef_serialize_failed', {
      txid: String(inspectRawTx(rawtxHex)?.txid || ''),
      error: String(err?.message || 'beef serialize failed'),
    });
    return null;
  }
}

function markTxConfirmedInIndex(txid) {
  appendSendLog('wallet_mark_confirmed_compat', {
    txid: String(txid || '').trim().toLowerCase(),
  });
  const index = getSpvIndex();
  if (!index.txs) index.txs = {};
  const now = new Date().toISOString();

  if (index.txs[txid]) {
    index.txs[txid].confirmed = true;
    index.txs[txid].ancestorDepth = 0;
    index.txs[txid].lastSeenAt = now;
  }
  for (const key of Object.keys(index.utxos || {})) {
    if (String(index.utxos[key]?.txId) === txid) {
      index.utxos[key].confirmed = true;
      index.utxos[key].ancestorDepth = 0;
      index.utxos[key].updatedAt = now;
    }
  }
  saveSpvIndex(index);
  markTxContextConfirmed(txid);
}

function isTxConfirmedInSpvIndex(txid) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return false;
  const index = getSpvIndex();
  const txRow = index?.txs?.[safeTxid];
  if (txRow?.confirmed === true) return true;
  return Object.values(index?.utxos || {}).some((u) => (
    String(u?.txId || '').trim().toLowerCase() === safeTxid
    && u?.confirmed === true
  ));
}

function isTxSeenInSpvIndex(txid) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return false;
  const index = getSpvIndex();
  if (index?.txs?.[safeTxid]) return true;
  return Object.values(index?.utxos || {}).some((u) => String(u?.txId || '').trim().toLowerCase() === safeTxid);
}

function transactionTouchesWallet(txLike) {
  return transactionTouchesWalletWithHints(txLike, null);
}

function getWalletTouchHints() {
  const watchSet = getWatchedAddresses();
  const watchPubKeyHashToAddress = {};
  for (const address of watchSet) {
    const safeAddress = String(address || '').trim();
    if (!safeAddress) continue;
    try {
      const parsed = bsv.Address.fromString(safeAddress);
      const hash = Buffer.isBuffer(parsed?.hashBuffer) ? parsed.hashBuffer.toString('hex') : '';
      if (/^[0-9a-f]{40}$/i.test(hash)) watchPubKeyHashToAddress[hash.toLowerCase()] = safeAddress;
    } catch (_) {}
  }
  const index = getSpvIndex();
  const cacheKey = [
    walletStateSnapshotVersion,
    String(index?.updatedAt || ''),
    Object.keys(index?.utxos && typeof index.utxos === 'object' ? index.utxos : {}).length,
    Object.keys(index?.ownedOutpoints && typeof index.ownedOutpoints === 'object' ? index.ownedOutpoints : {}).length,
    Object.keys(index?.spentOutpoints && typeof index.spentOutpoints === 'object' ? index.spentOutpoints : {}).length,
  ].join(':');
  if (walletTouchHintsCache && walletTouchHintsCacheKey === cacheKey) return walletTouchHintsCache;
  walletTouchHintsCacheKey = cacheKey;
  walletTouchHintsCache = {
    watchSet,
    watchPubKeyHashToAddress,
    utxos: index?.utxos && typeof index.utxos === 'object' ? index.utxos : {},
    ownedOutpoints: index?.ownedOutpoints && typeof index.ownedOutpoints === 'object' ? index.ownedOutpoints : {},
    spentOutpoints: index?.spentOutpoints && typeof index.spentOutpoints === 'object' ? index.spentOutpoints : {},
    blockOwnedOutpoints: {},
  };
  return walletTouchHintsCache;
}

function scriptLikeToBuffer(scriptLike) {
  if (!scriptLike) return null;
  try {
    if (Buffer.isBuffer(scriptLike)) return scriptLike;
    if (Buffer.isBuffer(scriptLike?._scriptBuffer)) return scriptLike._scriptBuffer;
    if (Buffer.isBuffer(scriptLike?.scriptBuffer)) return scriptLike.scriptBuffer;
    if (typeof scriptLike?.toBuffer === 'function') return scriptLike.toBuffer();
    if (typeof scriptLike?.toHex === 'function') {
      const hex = String(scriptLike.toHex() || '').trim();
      if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0) return Buffer.from(hex, 'hex');
    }
  } catch (_) {}
  return null;
}

function getP2PKHAddressFromOutputWithHints(outputLike, hints = null) {
  if (!outputLike || typeof outputLike !== 'object') return '';
  const watchPubKeyHashToAddress = hints?.watchPubKeyHashToAddress && typeof hints.watchPubKeyHashToAddress === 'object'
    ? hints.watchPubKeyHashToAddress
    : {};
  const scriptCandidates = [
    outputLike?.script,
    outputLike?.scriptPubKey,
    outputLike?._script,
    outputLike?._scriptBuffer,
    outputLike?.scriptBuffer,
    outputLike?.lockingScript,
    outputLike?.pkScript,
  ];
  for (const candidate of scriptCandidates) {
    const buf = scriptLikeToBuffer(candidate);
    if (!Buffer.isBuffer(buf) || buf.length !== 25) continue;
    if (buf[0] !== 0x76 || buf[1] !== 0xa9 || buf[2] !== 0x14 || buf[23] !== 0x88 || buf[24] !== 0xac) continue;
    const hash = buf.subarray(3, 23).toString('hex').toLowerCase();
    const matched = String(watchPubKeyHashToAddress[hash] || '').trim();
    if (matched) return matched;
  }
  return '';
}

function scriptLikeIsDefinitelyUnspendable(scriptLike) {
  if (!scriptLike) return false;
  try {
    const buf = Buffer.isBuffer(scriptLike)
      ? scriptLike
      : (typeof scriptLike?.toBuffer === 'function' ? scriptLike.toBuffer() : null);
    if (Buffer.isBuffer(buf) && buf.length > 0) {
      if (buf[0] === 0x6a) return true;
      if (buf.length >= 2 && buf[0] === 0x00 && buf[1] === 0x6a) return true;
    }
  } catch (_) {}
  try {
    const chunks = Array.isArray(scriptLike?.chunks) ? scriptLike.chunks : [];
    if (chunks.length > 0) {
      const first = Number(chunks?.[0]?.opcodenum);
      const second = Number(chunks?.[1]?.opcodenum);
      if (first === 106 || (first === 0 && second === 106)) return true;
    }
  } catch (_) {}
  try {
    const asm = String(scriptLike?.toASM?.() || scriptLike?.asm || '').trim();
    if (/^OP_FALSE\s+OP_RETURN\b|^OP_RETURN\b/i.test(asm)) return true;
  } catch (_) {}
  return false;
}

function outputIsDefinitelyUnspendable(outputLike) {
  if (!outputLike || typeof outputLike !== 'object') return false;
  const candidates = [
    outputLike?.script,
    outputLike?.scriptPubKey,
    outputLike?._script,
    outputLike?._scriptBuffer,
    outputLike?.scriptBuffer,
    outputLike?.lockingScript,
    outputLike?.pkScript,
  ].filter((candidate) => candidate !== undefined && candidate !== null);
  if (candidates.length <= 0) return false;
  return candidates.some((candidate) => scriptLikeIsDefinitelyUnspendable(candidate));
}

function txHasUnspendableDataOutput(txLike) {
  try {
    const tx = txLike instanceof bsv.Transaction ? txLike : txFromUnknown(txLike);
    if (!tx) return false;
    return (tx.outputs || []).some((output) => outputIsDefinitelyUnspendable(output));
  } catch (_) {
    return false;
  }
}

function isOrderSettlementFeeUtxoCandidate(utxo) {
  const txid = String(utxo?.txId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) return false;
  if (utxo?.confirmed === true) return true;
  const ctxRow = getTxContextByTxid(txid, { useCache: false });
  const rawtx = rawtxHexFromUnknown(ctxRow?.rawtx);
  if (!rawtx) return false;
  // Settlement drafts can be handed to the counterparty for final signing and
  // broadcast, so fee inputs must be independently verifiable from chain
  // context. WOC-visible unconfirmed change is acceptable; local-only
  // unconfirmed anchor change is not.
  const observation = getSpvTxObservation(txid) || getSpvTxObservationFromIndex(txid);
  const externallyVisible = observation?.relevant === true && String(observation?.node || '') !== 'spv_index';
  const localWalletChange = utxo?.confirmed !== true
    && !txHasUnspendableDataOutput(rawtx)
    && Math.max(0, Number(utxo?.ancestorDepth || 0)) <= ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH;
  return ctxRow?.confirmed === true
    || ctxRow?.proofVerified === true
    || Number(ctxRow?.proofBlockHeight || 0) > 0
    || externallyVisible
    || localWalletChange;
}

function isAnchorFeeUtxoCandidate(utxo) {
  if (utxo?.confirmed === true) return true;
  const txid = String(utxo?.txId || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) return false;
  const ctxRow = getTxContextByTxid(txid, { useCache: false });
  if (!rawtxHexFromUnknown(ctxRow?.rawtx)) return false;
  if (ctxRow?.confirmed === true || ctxRow?.proofVerified === true || Number(ctxRow?.proofBlockHeight || 0) > 0) return true;
  const observation = getSpvTxObservation(txid) || getSpvTxObservationFromIndex(txid);
  const externallyVisible = observation?.relevant === true && String(observation?.node || '') !== 'spv_index';
  return externallyVisible
    && Math.max(0, Number(utxo?.ancestorDepth || 0)) <= ANCHOR_MAX_UNCONFIRMED_ANCESTOR_DEPTH;
}

async function markExternallyVisibleSettlementFeeCandidates(utxos, options = {}) {
  const rows = Array.isArray(utxos) ? utxos : [];
  const limit = Math.max(0, Math.min(8, Number(options.limit || 4)));
  let checked = 0;
  for (const utxo of rows) {
    if (checked >= limit) break;
    const txid = String(utxo?.txId || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(txid)) continue;
    if (isOrderSettlementFeeUtxoCandidate(utxo)) continue;
    const ctxRow = getTxContextByTxid(txid, { useCache: false });
    if (!rawtxHexFromUnknown(ctxRow?.rawtx)) continue;
    checked += 1;
    try {
      const visible = await isTxVisibleOnPublicIndex(txid, { allowDisabled: true });
      if (visible) {
        rememberSpvTxObservation(txid, {
          relevant: true,
          confirmedSeen: false,
          node: 'whatsonchain',
        });
      }
      appendSendLog('order_settlement_fee_utxo_visibility_probe', {
        outpoint: `${txid}:${Number(utxo?.vout || 0)}`,
        visible: Boolean(visible),
      });
    } catch (err) {
      appendSendLog('order_settlement_fee_utxo_visibility_probe_failed', {
        outpoint: `${txid}:${Number(utxo?.vout || 0)}`,
        error: String(err?.message || err || 'visibility probe failed').slice(0, 300),
      });
    }
  }
}

function transactionTouchesWalletWithHints(txLike, hints = null) {
  const tx = txFromUnknown(txLike);
  if (!tx) return false;
  const effectiveHints = hints && typeof hints === 'object' ? hints : getWalletTouchHints();
  const watchSet = effectiveHints.watchSet instanceof Set
    ? effectiveHints.watchSet
    : getWatchedAddresses();
  if (!watchSet.size) return false;
  const utxos = effectiveHints.utxos && typeof effectiveHints.utxos === 'object' ? effectiveHints.utxos : {};
  const ownedOutpoints = effectiveHints.ownedOutpoints && typeof effectiveHints.ownedOutpoints === 'object'
    ? effectiveHints.ownedOutpoints
    : {};
  const spentOutpoints = effectiveHints.spentOutpoints && typeof effectiveHints.spentOutpoints === 'object'
    ? effectiveHints.spentOutpoints
    : {};
  const blockOwnedOutpoints = effectiveHints.blockOwnedOutpoints && typeof effectiveHints.blockOwnedOutpoints === 'object'
    ? effectiveHints.blockOwnedOutpoints
    : {};
  const inputs = Array.isArray(tx.inputs) ? tx.inputs : [];
  for (const input of inputs) {
    const prevTxId = Buffer.isBuffer(input?.prevTxId)
      ? input.prevTxId.toString('hex')
      : String(input?.prevTxId || '').trim().toLowerCase();
    const outputIndex = Number(input?.outputIndex);
    if (!/^[0-9a-f]{64}$/i.test(prevTxId) || !Number.isInteger(outputIndex) || outputIndex < 0) continue;
    const outpoint = `${prevTxId}:${outputIndex}`;
    if (utxos[outpoint] || ownedOutpoints[outpoint] || spentOutpoints[outpoint] || blockOwnedOutpoints[outpoint]) return true;
  }
  const outputs = Array.isArray(tx.outputs) ? tx.outputs : [];
  if (outputs.length > 0 && outputs.every((output) => outputIsDefinitelyUnspendable(output))) {
    return false;
  }
  for (const output of outputs) {
    let address = getP2PKHAddressFromOutputWithHints(output, effectiveHints);
    if (!address) {
      try {
        address = String(output?.script?.toAddress?.(NETWORK) || '').trim();
      } catch (_) {
        address = '';
      }
    }
    if (address && watchSet.has(address)) return true;
  }
  return false;
}

function parseOpReturnPayloadBufferFromScriptLike(scriptLike) {
  let scriptBuf = null;
  try {
    if (Buffer.isBuffer(scriptLike)) scriptBuf = scriptLike;
    else if (scriptLike && typeof scriptLike.toBuffer === 'function') scriptBuf = scriptLike.toBuffer();
    else if (scriptLike && typeof scriptLike.toHex === 'function') {
      const hex = String(scriptLike.toHex() || '').trim();
      if (/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0) scriptBuf = Buffer.from(hex, 'hex');
    }
  } catch (_) {
    scriptBuf = null;
  }
  if (!Buffer.isBuffer(scriptBuf) || scriptBuf.length <= 0) return null;
  let i = 0;
  if (scriptBuf.length >= 2 && scriptBuf[0] === 0x00 && scriptBuf[1] === 0x6a) i = 1;
  if (scriptBuf[i] !== 0x6a) return null;
  i += 1;
  const parts = [];
  while (i < scriptBuf.length) {
    const opcode = scriptBuf[i];
    i += 1;
    let pushLen = null;
    if (opcode >= 0x01 && opcode <= 0x4b) {
      pushLen = opcode;
    } else if (opcode === 0x00) {
      pushLen = 0;
    } else if (opcode === 0x4c) {
      if (i + 1 > scriptBuf.length) break;
      pushLen = scriptBuf[i];
      i += 1;
    } else if (opcode === 0x4d) {
      if (i + 2 > scriptBuf.length) break;
      pushLen = scriptBuf.readUInt16LE(i);
      i += 2;
    } else if (opcode === 0x4e) {
      if (i + 4 > scriptBuf.length) break;
      pushLen = scriptBuf.readUInt32LE(i);
      i += 4;
    } else if (opcode >= 0x51 && opcode <= 0x60) {
      parts.push(Buffer.from([opcode - 0x50]));
      continue;
    } else if (opcode === 0x4f) {
      parts.push(Buffer.from([0x81]));
      continue;
    } else {
      break;
    }
    if (!Number.isFinite(pushLen) || pushLen < 0) break;
    if ((i + pushLen) > scriptBuf.length) break;
    if (pushLen > 0) parts.push(scriptBuf.slice(i, i + pushLen));
    i += pushLen;
  }
  return parts.length > 0 ? Buffer.concat(parts) : Buffer.alloc(0);
}

function transactionMentionsCurrentWalletId(txLike) {
  const tx = txFromUnknown(txLike);
  if (!tx) return false;
  let walletId = '';
  try {
    walletId = String(getWalletState()?.walletId || '').trim();
  } catch (_) {
    walletId = '';
  }
  if (!walletId) return false;
  for (const output of (tx.outputs || [])) {
    const payloadBuf = parseOpReturnPayloadBufferFromScriptLike(output?.script);
    if (!Buffer.isBuffer(payloadBuf)) continue;
    const text = payloadBuf.toString('utf8');
    if (text && text.includes(walletId)) return true;
  }
  return false;
}

function buildConfirmedBlockTxSummary(txLike, options = {}) {
  const tx = txFromUnknown(txLike);
  if (!tx) return null;
  const hints = options?.hints && typeof options.hints === 'object'
    ? options.hints
    : getWalletTouchHints();
  const watchSet = hints.watchSet instanceof Set ? hints.watchSet : getWatchedAddresses();
  if (!watchSet.size) return null;
  const txid = String(tx.id || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) return null;
  const inputs = [];
  for (const input of (tx.inputs || [])) {
    const prevTxId = input.prevTxId ? Buffer.from(input.prevTxId).toString('hex') : null;
    const vout = Number(input.outputIndex);
    if (!prevTxId || !Number.isInteger(vout) || vout < 0) continue;
    inputs.push({
      txId: String(prevTxId).trim().toLowerCase(),
      vout,
    });
  }
  const walletOutputs = [];
  for (let vout = 0; vout < (tx.outputs || []).length; vout += 1) {
    const output = tx.outputs[vout];
    let outAddress = getP2PKHAddressFromOutputWithHints(output, hints);
    if (!outAddress) {
      try {
        outAddress = String(output?.script?.toAddress?.(NETWORK) || '').trim();
      } catch (_) {
        outAddress = '';
      }
    }
    if (!outAddress || !watchSet.has(outAddress)) continue;
    const satoshis = Number(output?.satoshis || 0);
    if (!Number.isFinite(satoshis) || satoshis <= 0) continue;
    walletOutputs.push({
      vout,
      address: outAddress,
      satoshis,
    });
  }
  return {
    txid,
    txIndex: Math.max(0, Number(options.txIndex || 0)),
    inputs,
    walletOutputs,
    // Keep rawtx only when the transaction creates wallet outputs. This keeps
    // memory bounded while still preserving contexts for incoming/change txs.
    rawtxHex: walletOutputs.length > 0 ? rawtxHexFromUnknown(txLike) : '',
  };
}

function applyConfirmedTxSummaryToSpvIndex(summary = {}, options = {}) {
  const txid = String(summary?.txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) return false;
  const confirmed = options?.confirmed !== false;
  const rawtxHex = String(summary?.rawtxHex || '').trim();
  if (rawtxHex) {
    upsertTxContext(rawtxHex, {
      source: String(options?.source || 'spv-index-summary'),
      confirmed,
    });
  }

  const watchSet = getWatchedAddresses();
  if (!watchSet.size) return false;

  const normalizedInputs = (Array.isArray(summary?.inputs) ? summary.inputs : [])
    .map((input) => ({
      txId: String(input?.txId || '').trim().toLowerCase(),
      vout: Number(input?.vout),
    }))
    .filter((input) => /^[0-9a-f]{64}$/i.test(input.txId) && Number.isInteger(input.vout) && input.vout >= 0);
  if (normalizedInputs.length) {
    void scheduleDirectParentTxContextBackfill(
      normalizedInputs.map((input) => input.txId),
      {
        confirmed,
        source: String(options?.source || 'spv-index-summary'),
        sourceLabel: 'woc',
        kindLabel: 'direct_parent_backfill',
      },
    );
  }
  const normalizedWalletOutputs = (Array.isArray(summary?.walletOutputs) ? summary.walletOutputs : [])
    .map((output) => ({
      vout: Number(output?.vout),
      address: String(output?.address || '').trim(),
      satoshis: Number(output?.satoshis || 0),
    }))
    .filter((output) => Number.isInteger(output.vout) && output.vout >= 0 && watchSet.has(output.address) && Number.isFinite(output.satoshis) && output.satoshis > 0);
  let extractedFacts = null;
  if (rawtxHex) {
    try {
      extractedFacts = extractWalletTxIoFacts(rawtxHex, null);
    } catch (_) {
      extractedFacts = null;
    }
  }

  const index = getSpvIndex();
  index.utxos = index.utxos || {};
  index.ownedOutpoints = index.ownedOutpoints || {};
  index.spentOutpoints = index.spentOutpoints || {};
  index.txs = index.txs || {};
  const auditBefore = buildWalletBalanceAuditSnapshot(index);
  const prev = index.txs[txid] || null;

  for (const [key, u] of Object.entries(index.utxos || {})) {
    if (!Number.isFinite(Number(index.ownedOutpoints[key]))) {
      index.ownedOutpoints[key] = Number(u?.satoshis || 0);
    }
  }
  for (const key of Object.keys(index.ownedOutpoints || {})) {
    if (!index.utxos[key]) delete index.ownedOutpoints[key];
  }

  const now = new Date().toISOString();
  const firstSeenHeight = Math.max(0, Number(options?.firstSeenHeight || options?.localHeight || 0));
  const pendingOwnedInputs = [];
  for (const input of normalizedInputs) {
    const outpoint = `${input.txId}:${input.vout}`;
    if (Number(index.utxos?.[outpoint]?.satoshis || 0) > 0 || Number(index.ownedOutpoints?.[outpoint] || 0) > 0) {
      pendingOwnedInputs.push(outpoint);
    }
  }
  const effectiveWalletOutputs = normalizedWalletOutputs;
  const missingWalletOutputs = effectiveWalletOutputs.filter((output) => {
    const outpoint = `${txid}:${output.vout}`;
    return !index.utxos[outpoint];
  });

  const hasStableAmounts = Boolean(
    prev && (
      prev.applied === true
      || Number(prev.receivedSat || 0) > 0
      || Number(prev.spentSat || 0) > 0
      || Number(prev.netSat || 0) !== 0
    ),
  );
  if (hasStableAmounts && pendingOwnedInputs.length === 0 && missingWalletOutputs.length === 0) {
    const canonicalReceivedSat = extractedFacts
      ? Math.max(0, Number(extractedFacts.walletOutputSat || 0))
      : Number(prev?.receivedSat || 0);
    const extractedWalletInputSat = extractedFacts
      ? Math.max(0, Number(extractedFacts.walletInputSat || 0))
      : 0;
    const canonicalSpentSat = extractedWalletInputSat > 0
      ? extractedWalletInputSat
      : Number(prev?.spentSat || 0);
    index.txs[txid] = {
      ...prev,
      receivedSat: canonicalReceivedSat,
      spentSat: canonicalSpentSat,
      netSat: canonicalReceivedSat - canonicalSpentSat,
      confirmed: Boolean(prev.confirmed || confirmed),
      ancestorDepth: Boolean(prev.confirmed || confirmed) ? 0 : Number(prev?.ancestorDepth || 0),
      firstSeenHeight: Math.max(0, Number(prev?.firstSeenHeight || firstSeenHeight || 0)),
      lastSeenHeight: Math.max(
        Number(prev?.lastSeenHeight || 0),
        Number(firstSeenHeight || 0),
      ),
      lastSeenAt: now,
    };
    if (confirmed) {
      for (const key of Object.keys(index.utxos || {})) {
        if (String(index.utxos[key]?.txId || '').trim().toLowerCase() === txid) {
          index.utxos[key].confirmed = true;
          index.utxos[key].ancestorDepth = 0;
          index.utxos[key].updatedAt = now;
        }
      }
    }
    saveSpvIndex(index);
    if (confirmed && rawtxHex) markTxContextConfirmed(txid);
    return true;
  }
  if (hasStableAmounts && pendingOwnedInputs.length === 0 && missingWalletOutputs.length > 0) {
    let addedReceivedSat = 0;
    for (const output of missingWalletOutputs) {
      const outpoint = `${txid}:${output.vout}`;
      if (markKnownConfirmedSpenderForOutpoint(index, outpoint, {
        txId: txid,
        vout: output.vout,
        address: output.address,
        satoshis: output.satoshis,
        confirmed: Boolean(prev?.confirmed || confirmed),
      }, { source: 'tx_summary_repair_owned_output' })) {
        continue;
      }
      index.ownedOutpoints[outpoint] = output.satoshis;
      index.utxos[outpoint] = {
        txId: txid,
        vout: output.vout,
        address: output.address,
        satoshis: output.satoshis,
        confirmed: Boolean(prev?.confirmed || confirmed),
        ancestorDepth: Boolean(prev?.confirmed || confirmed) ? 0 : Number(prev?.ancestorDepth || 0),
        seenAt: index.utxos[outpoint]?.seenAt || now,
        updatedAt: now,
      };
      addedReceivedSat += output.satoshis;
    }
    const canonicalReceivedSat = effectiveWalletOutputs
      .reduce((sum, output) => sum + Math.max(0, Number(output?.satoshis || 0)), 0);
    const extractedWalletInputSat = extractedFacts
      ? Math.max(0, Number(extractedFacts.walletInputSat || 0))
      : 0;
    const canonicalSpentSat = extractedWalletInputSat > 0
      ? extractedWalletInputSat
      : Number(prev?.spentSat || 0);
    index.txs[txid] = {
      ...prev,
      txid,
      receivedSat: canonicalReceivedSat,
      spentSat: canonicalSpentSat,
      netSat: canonicalReceivedSat - canonicalSpentSat,
      confirmed: Boolean(prev?.confirmed || confirmed),
      ancestorDepth: Boolean(prev?.confirmed || confirmed) ? 0 : Number(prev?.ancestorDepth || 0),
      firstSeenAt: prev?.firstSeenAt || now,
      firstSeenHeight: Math.max(0, Number(prev?.firstSeenHeight || firstSeenHeight || 0)),
      lastSeenHeight: Math.max(
        Number(prev?.lastSeenHeight || 0),
        Number(firstSeenHeight || 0),
      ),
      lastSeenAt: now,
      applied: true,
    };
    appendSendLog('tx_summary_repaired_owned_outputs', {
      txid,
      confirmed: Boolean(confirmed),
      ownedOutputCount: missingWalletOutputs.length,
      addedReceivedSat,
      canonicalReceivedSat,
      canonicalSpentSat,
      receivedSat: Number(index.txs[txid]?.receivedSat || 0),
      spentSat: Number(index.txs[txid]?.spentSat || 0),
      netSat: Number(index.txs[txid]?.netSat || 0),
    });
    saveSpvIndex(index);
    if (confirmed && rawtxHex) markTxContextConfirmed(txid);
    return true;
  }

  let receivedSat = 0;
  let spentSat = 0;
  let maxInputAncestorDepth = 0;
  let knownSpentOutputCount = 0;
  for (const input of normalizedInputs) {
    const outpoint = `${input.txId}:${input.vout}`;
    const ownedValue = Number(index.utxos?.[outpoint]?.satoshis || 0);
    if (ownedValue > 0) {
      const previousUtxo = { ...(index.utxos[outpoint] || {}) };
      spentSat += ownedValue;
      maxInputAncestorDepth = Math.max(maxInputAncestorDepth, getTxAncestorDepth(index, input.txId));
      delete index.utxos[outpoint];
      delete index.ownedOutpoints[outpoint];
      index.spentOutpoints[outpoint] = {
        spentBy: txid,
        spentAt: now,
        txId: input.txId,
        vout: input.vout,
        address: String(previousUtxo.address || ''),
        satoshis: ownedValue,
        confirmed: previousUtxo.confirmed === true,
        ancestorDepth: Number(previousUtxo.ancestorDepth || 0),
        seenAt: previousUtxo.seenAt || now,
      };
    }
  }

  for (const output of effectiveWalletOutputs) {
    const outpoint = `${txid}:${output.vout}`;
    if (markKnownConfirmedSpenderForOutpoint(index, outpoint, {
      txId: txid,
      vout: output.vout,
      address: output.address,
      satoshis: output.satoshis,
      confirmed: Boolean(confirmed),
    }, { source: 'tx_summary_apply_owned_output' })) {
      knownSpentOutputCount += 1;
      continue;
    }
    receivedSat += output.satoshis;
    index.ownedOutpoints[outpoint] = output.satoshis;
    index.utxos[outpoint] = {
      txId: txid,
      vout: output.vout,
      address: output.address,
      satoshis: output.satoshis,
      confirmed: Boolean(index.utxos[outpoint]?.confirmed || confirmed),
      ancestorDepth: Boolean(index.utxos[outpoint]?.confirmed || confirmed) ? 0 : (maxInputAncestorDepth + 1),
      seenAt: index.utxos[outpoint]?.seenAt || now,
      updatedAt: now,
    };
  }

  if (!receivedSat && !spentSat) {
    if (knownSpentOutputCount > 0) {
      saveSpvIndex(index);
      if (confirmed && rawtxHex) markTxContextConfirmed(txid);
      return true;
    }
    return false;
  }

  const prevRow = prev || {};
  index.txs[txid] = {
    txid,
    receivedSat,
    spentSat,
    netSat: receivedSat - spentSat,
    confirmed: Boolean(prevRow.confirmed || confirmed),
    ancestorDepth: Boolean(prevRow.confirmed || confirmed) ? 0 : (maxInputAncestorDepth + 1),
    firstSeenAt: prevRow.firstSeenAt || now,
    firstSeenHeight: Math.max(0, Number(prevRow.firstSeenHeight || firstSeenHeight || 0)),
    lastSeenHeight: Math.max(
      Number(prevRow.lastSeenHeight || 0),
      Number(firstSeenHeight || 0),
    ),
    lastSeenAt: now,
    applied: true,
  };

  saveSpvIndex(index);
  if (confirmed && rawtxHex) markTxContextConfirmed(txid);
  return true;
}

function ingestConfirmedBlockTransaction(txLike) {
  if (!transactionTouchesWallet(txLike)) return false;
  return applyTxToSpvIndex(txLike, { confirmed: true });
}

function applyTxToSpvIndex(txLike, { confirmed = false, trackOutputs = true, firstSeenHeight = 0, localHeight = 0 } = {}) {
  const tx = txFromUnknown(txLike);
  if (!tx) return false;
  const txid = String(tx.id || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) return false;
  const rawtxHex = rawtxHexFromUnknown(txLike);
  const index = getSpvIndex();
  index.utxos = index.utxos || {};
  index.ownedOutpoints = index.ownedOutpoints || {};
  index.spentOutpoints = index.spentOutpoints || {};
  index.txs = index.txs || {};
  const auditBefore = buildWalletBalanceAuditSnapshot(index);
  index.stalePendingTxs = index.stalePendingTxs || {};
  if (index.stalePendingTxs[txid]) delete index.stalePendingTxs[txid];
  const prev = index.txs[txid] || null;
  const previousObservation = getSpvTxObservation(txid);
  const prevAlreadyApplied = Boolean(
    prev && (
      prev.applied === true
      || Number(prev.receivedSat || 0) > 0
      || Number(prev.spentSat || 0) > 0
      || Number(prev.netSat || 0) !== 0
    ),
  );
  if (prevAlreadyApplied && !confirmed) {
    rememberSpvTxObservation(txid, {
      relevant: true,
      confirmedSeen: Boolean(prev?.confirmed || confirmed),
    });
    return false;
  }
  if (previousObservation?.relevant === false && (previousObservation.confirmedSeen === true || !confirmed)) {
    return false;
  }

  const txRelevant = transactionTouchesWallet(txLike) || transactionMentionsCurrentWalletId(txLike);
  if (!txRelevant) {
    rememberSpvTxObservation(txid, {
      relevant: false,
      confirmedSeen: Boolean(confirmed || previousObservation?.confirmedSeen),
    });
    return false;
  }
  if (rawtxHex) {
    upsertTxContext(rawtxHex, {
      source: 'spv-index',
      confirmed,
    });
  }
  const txInfo = rawtxHex ? inspectRawTx(rawtxHex) : null;
  if (Array.isArray(txInfo?.inputTxids) && txInfo.inputTxids.length) {
    void scheduleDirectParentTxContextBackfill(txInfo.inputTxids, {
      confirmed,
      source: 'spv-index',
      sourceLabel: 'woc',
      kindLabel: 'direct_parent_backfill',
    });
  }

  const watchSet = getWatchedAddresses();
  if (!watchSet.size) {
    rememberSpvTxObservation(txid, {
      relevant: true,
      confirmedSeen: Boolean(confirmed),
    });
    return false;
  }

  // Compatibility repair: older local indexes may miss ownedOutpoints entries.
  for (const [key, u] of Object.entries(index.utxos || {})) {
    if (!Number.isFinite(Number(index.ownedOutpoints[key]))) {
      index.ownedOutpoints[key] = Number(u?.satoshis || 0);
    }
  }
  // Remove stale outpoints that no longer exist in UTXO set.
  for (const key of Object.keys(index.ownedOutpoints || {})) {
    if (!index.utxos[key]) delete index.ownedOutpoints[key];
  }

  const now = new Date().toISOString();
  const seenHeight = Math.max(0, Number(firstSeenHeight || localHeight || 0));
  const pendingOwnedInputs = [];
  for (const input of tx.inputs || []) {
    const prevTxId = input.prevTxId ? Buffer.from(input.prevTxId).toString('hex') : null;
    const vout = Number(input.outputIndex);
    if (!prevTxId || !Number.isInteger(vout) || vout < 0) continue;
    const outpoint = `${prevTxId}:${vout}`;
    if (Number(index.utxos?.[outpoint]?.satoshis || 0) > 0 || Number(index.ownedOutpoints?.[outpoint] || 0) > 0) {
      pendingOwnedInputs.push(outpoint);
    }
  }
  let extractedFacts = null;
  if (rawtxHex) {
    try {
      extractedFacts = extractWalletTxIoFacts(rawtxHex, null);
    } catch (_) {
      extractedFacts = null;
    }
  }
  const missingOwnedOutputs = Array.isArray(extractedFacts?.outputs)
    ? extractedFacts.outputs.filter((output) => {
        const outpoint = String(output?.outpoint || '').trim().toLowerCase();
        return Boolean(
	          output?.isWalletOwned === true
	          && Number(output?.satoshis || 0) > 0
	          && outpoint
	          && !index.utxos[outpoint]
	          && !index.spentOutpoints?.[outpoint],
	        );
	      })
	    : [];

  // Idempotency: the same tx may be observed repeatedly (local broadcast + SPV events).
  // If we already have non-zero accounting rows, never recompute amount fields again.
  // Only refresh confirmation flags and timestamps.
  const hasStableAmounts = prevAlreadyApplied;
  if (hasStableAmounts && pendingOwnedInputs.length === 0 && missingOwnedOutputs.length === 0) {
    const canonicalReceivedSat = extractedFacts
      ? Math.max(0, Number(extractedFacts.walletOutputSat || 0))
      : Number(prev?.receivedSat || 0);
    const extractedWalletInputSat = extractedFacts
      ? Math.max(0, Number(extractedFacts.walletInputSat || 0))
      : 0;
    const canonicalSpentSat = extractedWalletInputSat > 0
      ? extractedWalletInputSat
      : Number(prev?.spentSat || 0);
    index.txs[txid] = {
      ...prev,
      receivedSat: canonicalReceivedSat,
      spentSat: canonicalSpentSat,
      netSat: canonicalReceivedSat - canonicalSpentSat,
      confirmed: Boolean(prev.confirmed || confirmed),
      ancestorDepth: Boolean(prev.confirmed || confirmed) ? 0 : Number(prev?.ancestorDepth || 0),
      firstSeenHeight: Math.max(0, Number(prev?.firstSeenHeight || seenHeight || 0)),
      lastSeenHeight: Math.max(
        Number(prev?.lastSeenHeight || 0),
        Number(seenHeight || 0),
      ),
      lastSeenAt: now,
    };
    if (confirmed) {
      for (const key of Object.keys(index.utxos || {})) {
        if (String(index.utxos[key]?.txId) === txid) {
          index.utxos[key].confirmed = true;
          index.utxos[key].ancestorDepth = 0;
          index.utxos[key].updatedAt = now;
        }
      }
    }
    appendSendLog('tx_apply_skip_recompute', {
      txid,
      confirmed: Boolean(confirmed),
      receivedSat: Number(prev?.receivedSat || 0),
      spentSat: Number(prev?.spentSat || 0),
      netSat: Number(prev?.netSat || 0),
    });
    saveSpvIndex(index);
    appendWalletBalanceAudit('wallet_balance_index_mutated', auditBefore, buildWalletBalanceAuditSnapshot(index), {
      source: 'apply_tx_to_spv_index',
      operation: 'tx_apply_skip_recompute',
      txid,
      confirmed: Boolean(confirmed),
    });
    if (confirmed) markTxContextConfirmed(txid);
    rememberSpvTxObservation(txid, {
      relevant: true,
      confirmedSeen: Boolean(prev?.confirmed || confirmed),
    });
    return true;
  }
  if (hasStableAmounts && pendingOwnedInputs.length === 0 && missingOwnedOutputs.length > 0) {
    let addedReceivedSat = 0;
    for (const output of missingOwnedOutputs) {
      const outpoint = String(output?.outpoint || '').trim().toLowerCase();
      const satoshis = Math.max(0, Number(output?.satoshis || 0));
		      const vout = Math.max(0, Number(output?.vout || 0));
		      const address = String(output?.address || '').trim();
		      if (!outpoint || !address || satoshis <= 0 || index.spentOutpoints?.[outpoint]) continue;
      if (markKnownConfirmedSpenderForOutpoint(index, outpoint, {
        txId: txid,
        vout,
        address,
        satoshis,
        confirmed: Boolean(prev?.confirmed || confirmed),
      }, { source: 'tx_apply_repair_owned_output' })) {
        continue;
      }
      index.ownedOutpoints[outpoint] = satoshis;
      index.utxos[outpoint] = {
        txId: txid,
        vout,
        address,
        satoshis,
        confirmed: Boolean(prev?.confirmed || confirmed),
        ancestorDepth: Boolean(prev?.confirmed || confirmed) ? 0 : Number(prev?.ancestorDepth || 0),
        seenAt: index.utxos[outpoint]?.seenAt || now,
        updatedAt: now,
      };
      addedReceivedSat += satoshis;
    }
    const canonicalReceivedSat = Array.isArray(extractedFacts?.outputs)
      ? extractedFacts.outputs.reduce((sum, output) => (
        output?.isWalletOwned === true
          ? sum + Math.max(0, Number(output?.satoshis || 0))
          : sum
      ), 0)
      : Number(prev?.receivedSat || 0);
    const extractedWalletInputSat = extractedFacts
      ? Math.max(0, Number(extractedFacts.walletInputSat || 0))
      : 0;
    const canonicalSpentSat = extractedWalletInputSat > 0
      ? extractedWalletInputSat
      : Number(prev?.spentSat || 0);
    index.txs[txid] = {
      ...prev,
      txid,
      receivedSat: canonicalReceivedSat,
      spentSat: canonicalSpentSat,
      netSat: canonicalReceivedSat - canonicalSpentSat,
      confirmed: Boolean(prev?.confirmed || confirmed),
      ancestorDepth: Boolean(prev?.confirmed || confirmed) ? 0 : Number(prev?.ancestorDepth || 0),
      firstSeenAt: prev?.firstSeenAt || now,
      firstSeenHeight: Math.max(0, Number(prev?.firstSeenHeight || seenHeight || 0)),
      lastSeenHeight: Math.max(
        Number(prev?.lastSeenHeight || 0),
        Number(seenHeight || 0),
      ),
      lastSeenAt: now,
      applied: true,
    };
    appendSendLog('tx_apply_repaired_owned_outputs', {
      txid,
      confirmed: Boolean(confirmed),
      ownedOutputCount: missingOwnedOutputs.length,
      addedReceivedSat,
      canonicalReceivedSat,
      canonicalSpentSat,
      receivedSat: Number(index.txs[txid]?.receivedSat || 0),
      spentSat: Number(index.txs[txid]?.spentSat || 0),
      netSat: Number(index.txs[txid]?.netSat || 0),
    });
    saveSpvIndex(index);
    appendWalletBalanceAudit('wallet_balance_index_mutated', auditBefore, buildWalletBalanceAuditSnapshot(index), {
      source: 'apply_tx_to_spv_index',
      operation: 'tx_apply_repaired_owned_outputs',
      txid,
      confirmed: Boolean(confirmed),
      ownedOutputCount: missingOwnedOutputs.length,
    });
    if (confirmed) markTxContextConfirmed(txid);
    rememberSpvTxObservation(txid, {
      relevant: true,
      confirmedSeen: Boolean(prev?.confirmed || confirmed),
    });
    return true;
  }
  if (hasStableAmounts && pendingOwnedInputs.length > 0) {
    appendSendLog('tx_apply_reconcile_owned_inputs', {
      txid,
      confirmed: Boolean(confirmed),
      ownedInputCount: pendingOwnedInputs.length,
      ownedInputs: pendingOwnedInputs.slice(0, 8),
    });
  }

  let receivedSat = 0;
  let spentSat = 0;
  let maxInputAncestorDepth = 0;
  const accountedOwnedOutpoints = new Set();
  let knownSpentOutputCount = 0;

  for (const input of tx.inputs || []) {
    const prevTxId = input.prevTxId ? Buffer.from(input.prevTxId).toString('hex') : null;
    const vout = Number(input.outputIndex);
    if (!prevTxId || !Number.isInteger(vout) || vout < 0) continue;

    const outpoint = `${prevTxId}:${vout}`;
    // Source of truth is current UTXO set. ownedOutpoints is only a mirror cache.
    const ownedValue = Number(index.utxos[outpoint]?.satoshis || 0);
    if (ownedValue > 0) {
      const previousUtxo = { ...(index.utxos[outpoint] || {}) };
      spentSat += ownedValue;
      maxInputAncestorDepth = Math.max(maxInputAncestorDepth, getTxAncestorDepth(index, prevTxId));
      delete index.utxos[outpoint];
      delete index.ownedOutpoints[outpoint];
      index.spentOutpoints[outpoint] = {
        spentBy: txid,
        spentAt: now,
        txId: prevTxId,
        vout,
        address: String(previousUtxo.address || ''),
        satoshis: ownedValue,
        confirmed: previousUtxo.confirmed === true,
        ancestorDepth: Number(previousUtxo.ancestorDepth || 0),
        seenAt: previousUtxo.seenAt || now,
      };
    }
  }

  for (let vout = 0; vout < (tx.outputs || []).length; vout += 1) {
    const output = tx.outputs[vout];
    let outAddress = null;
    try {
      outAddress = output.script.toAddress(NETWORK)?.toString() || null;
    } catch (_) {
      outAddress = null;
    }
    if (!trackOutputs || !outAddress || !watchSet.has(outAddress)) continue;

    const satoshis = Number(output.satoshis || 0);
    if (!Number.isFinite(satoshis) || satoshis <= 0) continue;

    const outpoint = `${txid}:${vout}`;
    if (markKnownConfirmedSpenderForOutpoint(index, outpoint, {
      txId: txid,
      vout,
      address: outAddress,
      satoshis,
      confirmed: Boolean(confirmed),
    }, { source: 'tx_apply_owned_output' })) {
      knownSpentOutputCount += 1;
      continue;
    }
    receivedSat += satoshis;
    accountedOwnedOutpoints.add(outpoint);
    index.ownedOutpoints[outpoint] = satoshis;
    index.utxos[outpoint] = {
      txId: txid,
      vout,
      address: outAddress,
      satoshis,
      confirmed: Boolean(index.utxos[outpoint]?.confirmed || confirmed),
      ancestorDepth: Boolean(index.utxos[outpoint]?.confirmed || confirmed) ? 0 : (maxInputAncestorDepth + 1),
      seenAt: index.utxos[outpoint]?.seenAt || now,
      updatedAt: now,
    };
  }

  if (trackOutputs && Array.isArray(extractedFacts?.outputs)) {
    for (const output of extractedFacts.outputs) {
      if (output?.isWalletOwned !== true) continue;
      const outpoint = String(output?.outpoint || '').trim().toLowerCase();
      const satoshis = Math.max(0, Number(output?.satoshis || 0));
      const address = String(output?.address || '').trim();
      const vout = Math.max(0, Number(output?.vout || 0));
      if (!outpoint || !address || satoshis <= 0) continue;
      if (markKnownConfirmedSpenderForOutpoint(index, outpoint, {
        txId: txid,
        vout,
        address,
        satoshis,
        confirmed: Boolean(confirmed),
      }, { source: 'tx_apply_extracted_owned_output' })) {
        knownSpentOutputCount += 1;
        continue;
      }
      if (!accountedOwnedOutpoints.has(outpoint)) {
        receivedSat += satoshis;
        accountedOwnedOutpoints.add(outpoint);
      }
      index.ownedOutpoints[outpoint] = satoshis;
      index.utxos[outpoint] = {
        txId: txid,
        vout,
        address,
        satoshis,
        confirmed: Boolean(index.utxos[outpoint]?.confirmed || confirmed),
        ancestorDepth: Boolean(index.utxos[outpoint]?.confirmed || confirmed) ? 0 : (maxInputAncestorDepth + 1),
        seenAt: index.utxos[outpoint]?.seenAt || now,
        updatedAt: now,
      };
    }
  }

  if (!receivedSat && !spentSat) {
    if (knownSpentOutputCount > 0) {
      index.txs[txid] = {
        txid,
        receivedSat: 0,
        spentSat: 0,
        netSat: 0,
        confirmed: Boolean(prev?.confirmed || confirmed),
        ancestorDepth: 0,
        firstSeenAt: prev?.firstSeenAt || now,
        firstSeenHeight: Math.max(0, Number(prev?.firstSeenHeight || seenHeight || 0)),
        lastSeenHeight: Math.max(
          Number(prev?.lastSeenHeight || 0),
          Number(seenHeight || 0),
        ),
        lastSeenAt: now,
        applied: true,
      };
      saveSpvIndex(index);
      appendWalletBalanceAudit('wallet_balance_index_mutated', auditBefore, buildWalletBalanceAuditSnapshot(index), {
        source: 'apply_tx_to_spv_index',
        operation: 'tx_apply_known_confirmed_spent_outputs',
        txid,
        confirmed: Boolean(confirmed),
        knownSpentOutputCount,
      });
      if (confirmed) markTxContextConfirmed(txid);
      rememberSpvTxObservation(txid, {
        relevant: true,
        confirmedSeen: Boolean(prev?.confirmed || confirmed),
      });
      return true;
    }
    rememberSpvTxObservation(txid, {
      relevant: false,
      confirmedSeen: Boolean(confirmed || previousObservation?.confirmedSeen),
    });
    return false;
  }

  const prevRow = prev || {};
  index.txs[txid] = {
    txid,
    receivedSat,
    spentSat,
    netSat: receivedSat - spentSat,
    confirmed: Boolean(prevRow.confirmed || confirmed),
    ancestorDepth: Boolean(prevRow.confirmed || confirmed) ? 0 : (maxInputAncestorDepth + 1),
    firstSeenAt: prevRow.firstSeenAt || now,
    firstSeenHeight: Math.max(0, Number(prevRow.firstSeenHeight || seenHeight || 0)),
    lastSeenHeight: Math.max(
      Number(prevRow.lastSeenHeight || 0),
      Number(seenHeight || 0),
    ),
    lastSeenAt: now,
    applied: true,
  };
  appendSendLog('tx_apply_accounted', {
    txid,
    confirmed: Boolean(confirmed),
    receivedSat,
    spentSat,
    netSat: receivedSat - spentSat,
  });

  saveSpvIndex(index);
  appendWalletBalanceAudit('wallet_balance_index_mutated', auditBefore, buildWalletBalanceAuditSnapshot(index), {
    source: 'apply_tx_to_spv_index',
    operation: 'tx_apply_accounted',
    txid,
    confirmed: Boolean(confirmed),
    receivedSat,
    spentSat,
    netSat: receivedSat - spentSat,
  });
  if (confirmed) markTxContextConfirmed(txid);
  rememberSpvTxObservation(txid, {
    relevant: true,
    confirmedSeen: Boolean(prevRow.confirmed || confirmed),
  });
  return true;
}

function upsertUtxoToSpvIndex(utxo) {
  const index = getSpvIndex();
  index.utxos = index.utxos || {};
  index.ownedOutpoints = index.ownedOutpoints || {};
  index.spentOutpoints = index.spentOutpoints || {};
  index.txs = index.txs || {};
  const auditBefore = buildWalletBalanceAuditSnapshot(index);

  const key = `${utxo.txId}:${utxo.vout}`;
  if (index.spentOutpoints[key]) {
    const spentBy = String(index.spentOutpoints[key]?.spentBy || '').trim().toLowerCase();
    const stalePendingTxids = collectKnownStalePendingTxidSet(index);
    if (spentBy && stalePendingTxids.has(spentBy)) {
      appendSendLog('utxo_upsert_cleared_stale_pending_spent_outpoint', {
        key,
        source: utxo.source || 'unknown',
        txId: utxo.txId,
        vout: Number(utxo.vout),
        satoshis: Number(utxo.satoshis || 0),
        spentBy,
      });
      delete index.spentOutpoints[key];
    } else {
	    appendSendLog('utxo_upsert_skipped_spent_outpoint', {
	      key,
	      source: utxo.source || 'unknown',
      txId: utxo.txId,
      vout: Number(utxo.vout),
      satoshis: Number(utxo.satoshis || 0),
      spentBy: String(index.spentOutpoints[key]?.spentBy || ''),
	    });
	    return false;
    }
  }
  if (markKnownConfirmedSpenderForOutpoint(index, key, utxo, { source: 'utxo_upsert_known_confirmed_spender' })) {
    saveSpvIndex(index);
    appendWalletBalanceAudit('wallet_balance_index_mutated', auditBefore, buildWalletBalanceAuditSnapshot(index), {
      source: String(utxo.source || 'upsert_utxo_to_spv_index'),
      operation: 'utxo_upsert_known_confirmed_spender',
      outpoint: key,
    });
    return false;
  }
  index.ownedOutpoints[key] = Number(utxo.satoshis);
  index.utxos[key] = {
    ...utxo,
    ancestorDepth: Boolean(utxo.confirmed) ? 0 : Number(utxo.ancestorDepth || 0),
    updatedAt: new Date().toISOString(),
    seenAt: index.utxos[key]?.seenAt || new Date().toISOString(),
  };

  if (!index.txs[utxo.txId]) {
    index.txs[utxo.txId] = {
      txid: utxo.txId,
      receivedSat: 0,
      spentSat: 0,
      netSat: 0,
      confirmed: Boolean(utxo.confirmed),
      ancestorDepth: Boolean(utxo.confirmed) ? 0 : Number(utxo.ancestorDepth || 0),
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
  }
  saveSpvIndex(index);
  appendWalletBalanceAudit('wallet_balance_index_mutated', auditBefore, buildWalletBalanceAuditSnapshot(index), {
    source: String(utxo.source || 'upsert_utxo_to_spv_index'),
    operation: 'upsert_utxo',
    txid: String(utxo.txId || ''),
    vout: Number(utxo.vout),
    satoshis: Number(utxo.satoshis || 0),
    confirmed: utxo.confirmed === true,
  });
  return true;
}

function recordTxidToSpvIndex(txid, { confirmed = true } = {}) {
  const index = getSpvIndex();
  index.txs = index.txs || {};
  const prev = index.txs[txid] || {};
  const now = new Date().toISOString();
  index.txs[txid] = {
    txid,
    receivedSat: Number(prev.receivedSat || 0),
    spentSat: Number(prev.spentSat || 0),
    netSat: Number(prev.netSat || 0),
    confirmed: Boolean(prev.confirmed || confirmed),
    ancestorDepth: Boolean(prev.confirmed || confirmed) ? 0 : Number(prev.ancestorDepth || 0),
    firstSeenAt: prev.firstSeenAt || now,
    firstSeenHeight: Math.max(0, Number(prev.firstSeenHeight || 0)),
    lastSeenHeight: Math.max(0, Number(prev.lastSeenHeight || 0)),
    lastSeenAt: now,
  };
  saveSpvIndex(index);
}

function sortTxContextsTopologically(rows = []) {
  const byTxid = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const txid = String(row?.txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(txid)) continue;
    byTxid.set(txid, row);
  }
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  function visit(txid) {
    if (!byTxid.has(txid) || visited.has(txid)) return;
    if (visiting.has(txid)) return;
    visiting.add(txid);
    const row = byTxid.get(txid);
    for (const parent of (Array.isArray(row?.inputTxids) ? row.inputTxids : [])) {
      const safeParent = String(parent || '').trim().toLowerCase();
      if (/^[0-9a-f]{64}$/i.test(safeParent)) visit(safeParent);
    }
    visiting.delete(txid);
    visited.add(txid);
    ordered.push(row);
  }
  Array.from(byTxid.keys()).forEach((txid) => visit(txid));
  return ordered;
}

function applyConfirmedWalletRawtx(rawtx, options = {}) {
  const safeRawtx = rawtxHexFromUnknown(rawtx);
  if (!safeRawtx) return false;
  const info = inspectRawTx(safeRawtx);
  if (!info?.txid) return false;
  if (options.allowCreateFromRawtx !== true && !isTxSeenInSpvIndex(info.txid)) {
    markTxContextConfirmed(info.txid);
    appendSendLog('wallet_confirm_rawtx_create_skipped', {
      txid: info.txid,
      source: String(options.source || 'wallet_confirm_rawtx'),
      reason: 'tx not previously seen in wallet index',
    });
    return false;
  }
  const changed = applyTxToSpvIndex(safeRawtx, { confirmed: true });
  if (!changed) {
    appendSendLog('wallet_confirm_rawtx_noop', {
      txid: info.txid,
      source: String(options.source || 'wallet_confirm_rawtx'),
    });
  }
  return changed;
}

function confirmWalletTransaction(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return false;
  const ctx = getTxContextByTxid(safeTxid);
  if (!ctx?.rawtx) {
    appendSendLog('wallet_confirm_missing_context', {
      txid: safeTxid,
      source: String(options.source || 'confirm_wallet_transaction'),
    });
    return false;
  }
  const changed = applyConfirmedWalletRawtx(ctx.rawtx, options);
  if (!changed) {
    appendSendLog('wallet_confirm_apply_failed', {
      txid: safeTxid,
      source: String(options.source || 'confirm_wallet_transaction'),
    });
  }
  return changed;
}

function reconcileConfirmedWalletIndex(options = {}) {
  const source = assertManualWalletRecoverySource(options?.source, 'reconcileConfirmedWalletIndex');
  const rows = sortTxContextsTopologically(listTxContexts({
    confirmedOnly: true,
    requireRawtx: true,
    limit: Number(options.limit || 20000),
  }));
  let applied = 0;
  for (const row of rows) {
    if (applyConfirmedWalletRawtx(row.rawtx, { source })) {
      applied += 1;
    }
  }
  appendSendLog('wallet_confirmed_reconcile_done', {
    source,
    txCount: rows.length,
    applied,
  });
  return { txCount: rows.length, applied };
}

async function reconcileUnconfirmedUtxosWithConfirmedChain(options = {}) {
  const source = String(options?.source || 'confirmed_chain_reconcile').trim() || 'confirmed_chain_reconcile';
  const localHeight = Math.max(0, Number(options?.localHeight || 0));
  const index = getSpvIndex();
  const unconfirmedTxids = Array.from(new Set(Object.values(index?.utxos || {})
    .filter((utxo) => utxo && utxo.confirmed !== true)
    .map((utxo) => String(utxo?.txId || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid))));
  let checked = 0;
  let proofReady = 0;
  let applied = 0;
  let skippedFuture = 0;
  let missingProof = 0;
  for (const txid of unconfirmedTxids) {
    checked += 1;
    let proof = null;
    try {
      proof = await fetchVerifiedMerkleProof(txid, {
        ...options,
        allowDisabled: options.allowDisabled === true,
      });
    } catch (err) {
      appendSendLog('confirmed_chain_reconcile_proof_failed', {
        source,
        txid,
        error: String(err?.message || 'proof fetch failed'),
      });
      proof = null;
    }
    if (!proof?.proofVerified) {
      missingProof += 1;
      continue;
    }
    const blockHeight = Math.max(0, Number(proof.blockHeight || 0));
    if (localHeight > 0 && blockHeight > localHeight) {
      skippedFuture += 1;
      continue;
    }
    const ctx = getTxContextByTxid(txid);
    const rawtx = String(ctx?.rawtx || '').trim();
    if (!rawtx) {
      missingProof += 1;
      continue;
    }
    proofReady += 1;
    upsertTxContext(rawtx, {
      source,
      kind: 'confirmed_chain_reconcile',
      confirmed: true,
      proofType: String(proof.proofType || ''),
      proofSource: String(proof.proofSource || ''),
      proofHex: String(proof.proofHex || ''),
      proofEncoding: String(proof.proofEncoding || ''),
      proofVerified: true,
      proofVerifiedAt: proof.proofVerifiedAt || new Date().toISOString(),
      proofBlockHeight: blockHeight || null,
      proofBlockHash: String(proof.blockHash || ''),
      proofMerkleRoot: String(proof.merkleRoot || ''),
    });
    if (applyConfirmedWalletRawtx(rawtx, { source })) applied += 1;
  }
  appendSendLog('confirmed_chain_reconcile_done', {
    source,
    localHeight,
    checked,
    proofReady,
    applied,
    skippedFuture,
    missingProof,
  });
  return {
    checked,
    proofReady,
    applied,
    skippedFuture,
    missingProof,
  };
}

function rebuildLocalIndexFromQueueRawtxs(rawtxs = [], options = {}) {
  const source = assertManualWalletRecoverySource(options?.source, 'rebuildLocalIndexFromQueueRawtxs');
  const current = getSpvIndex();
  const reconciled = { txCount: 0, applied: 0, source: 'existing_confirmed_base' };
  appendSendLog('spv_index_confirmed_base_preserved', {
    source,
    confirmedTxs: Object.values(current?.txs || {}).filter((row) => row?.confirmed === true).length,
    confirmedUtxos: Object.values(current?.utxos || {}).filter((utxo) => utxo?.confirmed === true).length,
    policy: 'pending_replay_only',
  });

  const queueRawtxs = dedupeConflictingPendingRawtxs(Array.isArray(rawtxs) ? rawtxs : []);
  let reapplied = 0;
  for (const rawtx of queueRawtxs) {
    const text = String(rawtx || '').trim();
    if (!text) continue;
    const info = inspectRawTx(text);
    if (!info?.txid) continue;
    const ctx = getTxContextByTxid(info.txid);
    const treatAsConfirmed = Boolean(
      current?.txs?.[info.txid]?.confirmed === true
      || ctx?.confirmed === true
      || isTxConfirmedInSpvIndex(info.txid),
    );
    if (!treatAsConfirmed && current?.stalePendingTxs?.[info.txid]) {
      appendSendLog('spv_index_pending_replay_skip_stale', {
        source,
        txid: info.txid,
        staleReason: String(current.stalePendingTxs[info.txid]?.staleReason || ''),
      });
      continue;
    }
    if (applyTxToSpvIndex(text, { confirmed: treatAsConfirmed })) reapplied += 1;
  }
  const finalIndex = getSpvIndex();
  appendSendLog('spv_index_rebuilt_from_queue_rawtxs', {
    source,
    confirmedTxs: Object.values(finalIndex.txs || {}).filter((r) => r?.confirmed === true).length,
    confirmedUtxos: Object.keys(finalIndex.utxos || {}).length,
    confirmedBaseSource: String(reconciled?.source || 'existing_confirmed_base'),
    reconciledConfirmedTxs: Number(reconciled?.txCount || 0),
    reconciledConfirmedApplied: Number(reconciled?.applied || 0),
    queueRawtxCount: queueRawtxs.length,
    droppedConflicts: Math.max(0, (Array.isArray(rawtxs) ? rawtxs.length : 0) - queueRawtxs.length),
    reapplied,
  });
  return {
    reapplied,
    reconciledConfirmedTxs: Number(reconciled?.txCount || 0),
    reconciledConfirmedApplied: Number(reconciled?.applied || 0),
  };
}

function commitWalletLocalMutation(rawtx, options = {}) {
  const source = String(options.source || 'wallet_local_mutation').trim();
  const confirmed = options.confirmed === true;
  const trackOutputs = options.trackOutputs !== false;
  const requireApplied = options.requireApplied !== false;
  const txid = String(options.txid || txidFromRaw(rawtx) || '').trim().toLowerCase();
  const firstSeenHeight = Math.max(0, Number(options.firstSeenHeight || options.broadcastHeight || options.localHeight || 0));
  const applied = applyTxToSpvIndex(rawtx, { confirmed, trackOutputs, firstSeenHeight });
  const alreadyIndexed = !applied && isTxSeenInSpvIndex(txid);
  if (requireApplied && !applied && !alreadyIndexed) {
    const err = new Error(`Wallet local index apply failed after broadcast: ${txid || 'unknown txid'}`);
    err.code = 'WALLET_LOCAL_INDEX_APPLY_FAILED';
    err.txid = txid;
    err.rawtx = String(rawtx || '');
    err.failureStage = 'post_broadcast_failed';
    appendSendLog('wallet_local_mutation_apply_failed', {
      source,
      txid,
      confirmed,
      trackOutputs,
    });
    throw err;
  }
  if (!applied && alreadyIndexed) {
    appendSendLog('wallet_local_mutation_already_indexed', {
      source,
      txid,
      confirmed,
      trackOutputs,
    });
  }
  let cache = buildCacheFromSpvIndex();
  if (walletExists()) {
    const freshState = getWalletState();
    updateAddressBalancesFromSpv(freshState);
    saveWalletState(freshState);
    cache = buildCacheFromSpvIndex();
    writeJson(CACHE_FILE, cache);
  }
  appendSendLog('wallet_local_mutation_committed', {
    source,
    txid,
    applied: Boolean(applied),
    confirmed,
    trackOutputs,
    firstSeenHeight,
    confirmedSat: Number(cache?.confirmed || 0),
    unconfirmedSat: Number(cache?.unconfirmed || 0),
    totalSat: Number(cache?.total || 0),
  });
  return {
    applied: Boolean(applied),
    txid,
    cache,
  };
}

function dedupeConflictingPendingRawtxs(rawtxs = []) {
  const txList = [];
  const latestByInput = new Map();
  let order = 0;
  for (const rawtx of (Array.isArray(rawtxs) ? rawtxs : [])) {
    const text = String(rawtx || '').trim();
    if (!text) continue;
    const tx = txFromUnknown(text);
    if (!tx) continue;
    const inputs = [];
    for (const input of tx.inputs || []) {
      const prevTxId = input.prevTxId ? Buffer.from(input.prevTxId).toString('hex') : null;
      const vout = Number(input.outputIndex);
      if (!prevTxId || !Number.isInteger(vout) || vout < 0) continue;
      const outpoint = `${prevTxId}:${vout}`;
      inputs.push(outpoint);
      latestByInput.set(outpoint, tx.id);
    }
    txList.push({ rawtx: text, txid: tx.id, inputs, order: order++ });
  }
  return txList
    .filter((row) => row.inputs.every((outpoint) => latestByInput.get(outpoint) === row.txid))
    .sort((a, b) => a.order - b.order)
    .map((row) => row.rawtx);
}

function rebuildWalletIndexFromLocalData(options = {}) {
  const source = assertManualWalletRecoverySource(options?.source, 'rebuildWalletIndexFromLocalData');
  if (options?.allowUnsafeConfirmedReplay !== true) {
    const err = new Error('Local tx-context confirmed replay is disabled; use manual WOC bootstrap or pending replay only');
    err.code = 'UNSAFE_LOCAL_REBUILD_DISABLED';
    err.source = source;
    appendSendLog('wallet_local_rebuild_blocked', {
      source,
      reason: 'unsafe_confirmed_tx_context_replay_disabled',
    });
    throw err;
  }
  resetSpvIndex();
  const reconciled = reconcileConfirmedWalletIndex({
    source,
    limit: Number(options.limit || 20000),
  });
  appendSendLog('wallet_local_rebuild_done', {
    source,
    txCount: Number(reconciled.txCount || 0),
    applied: Number(reconciled.applied || 0),
  });
  return reconciled;
}

function syncLocalIndexFromRecentRawtxs(entries = [], options = {}) {
  const source = assertManualWalletRecoverySource(options?.source, 'syncLocalIndexFromRecentRawtxs');
  const rows = Array.isArray(entries) ? entries : [];
  let storedContexts = 0;
  const rawtxs = [];
  for (const row of rows) {
    const rawtx = String(row?.rawtx || row || '').trim();
    if (!rawtx) continue;
    rawtxs.push(rawtx);
    if (upsertTxContext(rawtx, {
      source: 'local-sync',
      kind: 'recent_rawtx',
      confirmed: row?.confirmed === true,
    })) {
      storedContexts += 1;
    }
  }
  const rebuilt = options?.allowPendingReplay === true
    ? rebuildLocalIndexFromQueueRawtxs(rawtxs, { source })
    : { reapplied: 0, reconciledConfirmedTxs: 0, reconciledConfirmedApplied: 0 };
  let cache = buildCacheFromSpvIndex();
  if (walletExists()) {
    const state = getWalletState();
    updateAddressBalancesFromSpv(state);
    saveWalletState(state);
    cache = buildCacheFromSpvIndex();
    writeJson(CACHE_FILE, cache);
  }
  appendSendLog('wallet_local_sync_refreshed', {
    source,
    rawtxCount: rawtxs.length,
    storedContexts,
    reapplied: Number(rebuilt?.reapplied || 0),
    replayPolicy: options?.allowPendingReplay === true ? 'explicit_allow_pending_replay' : 'store_context_only_no_replay',
    confirmed: Number(cache?.confirmed || 0),
    unconfirmed: Number(cache?.unconfirmed || 0),
    total: Number(cache?.total || 0),
  });
  return {
    rawtxCount: rawtxs.length,
    storedContexts,
    reapplied: Number(rebuilt?.reapplied || 0),
    cache,
  };
}

function classifyWalletDisplayUtxo(utxo, contextByTxid = null) {
  const confirmed = Boolean(utxo?.confirmed);
  const satoshis = Math.max(0, Number(utxo?.satoshis || 0));
  const txid = String(utxo?.txId || utxo?.txid || '').trim().toLowerCase();
  if (confirmed) {
    return {
      displayClass: 'confirmed',
      displaySpendability: 'spendable_now',
      displayOrigin: 'confirmed',
      satoshis,
      txid,
    };
  }
  const ctx = /^[0-9a-f]{64}$/i.test(txid) ? getTxContextByTxid(txid) : null;
  const facts = ctx?.rawtx ? extractWalletTxIoFacts(ctx.rawtx, contextByTxid) : null;
  if (Number(facts?.walletInputSat || 0) > 0) {
    const origin = Number(facts?.externalOutputSat || 0) > 0 || facts?.hasDataOutput === true
      ? 'self_send_change'
      : 'self_consolidation_change';
    return {
      displayClass: 'self_change_pending',
      displaySpendability: 'spendable_now',
      displayOrigin: origin,
      satoshis,
      txid,
    };
  }
  if (Number(facts?.walletOutputSat || 0) > 0) {
    return {
      displayClass: 'external_pending',
      displaySpendability: 'spendable_after_confirm',
      displayOrigin: 'external_receive',
      satoshis,
      txid,
    };
  }
  return {
    displayClass: 'external_pending',
    displaySpendability: 'spendable_after_confirm',
    displayOrigin: 'unknown_pending',
    satoshis,
    txid,
  };
}

function collectKnownStalePendingTxidSet(index = null) {
  const safeIndex = index || getSpvIndex() || {};
  return new Set(Object.keys(safeIndex?.stalePendingTxs || {})
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid)));
}

function reconcileSpentOutpointUtxoConflicts(index = null, options = {}) {
  const safeIndex = index || getSpvIndex();
  if (!safeIndex || typeof safeIndex !== 'object') {
    return { prunedUtxoCount: 0, prunedSpentOutpointCount: 0 };
  }
  safeIndex.utxos = safeIndex.utxos || {};
  safeIndex.ownedOutpoints = safeIndex.ownedOutpoints || {};
  safeIndex.spentOutpoints = safeIndex.spentOutpoints || {};
  const staleTxids = options.staleTxids instanceof Set
    ? options.staleTxids
    : collectKnownStalePendingTxidSet(safeIndex);
  let prunedUtxoCount = 0;
  let prunedSpentOutpointCount = 0;
  for (const [outpoint, spentRow] of Object.entries(safeIndex.spentOutpoints || {})) {
    if (!safeIndex.utxos?.[outpoint]) continue;
    const spentBy = String(spentRow?.spentBy || '').trim().toLowerCase();
    if (spentBy && staleTxids.has(spentBy)) {
      delete safeIndex.spentOutpoints[outpoint];
      prunedSpentOutpointCount += 1;
      continue;
    }
    delete safeIndex.utxos[outpoint];
    delete safeIndex.ownedOutpoints[outpoint];
    prunedUtxoCount += 1;
  }
  return { prunedUtxoCount, prunedSpentOutpointCount };
}

function purgeKnownStalePendingUtxosFromIndex(index = null) {
  const safeIndex = index || getSpvIndex();
  if (!safeIndex || typeof safeIndex !== 'object') {
    return {
      prunedUtxoCount: 0,
      prunedTxCount: 0,
      prunedSpentOutpointCount: 0,
    };
  }
  safeIndex.utxos = safeIndex.utxos || {};
  safeIndex.ownedOutpoints = safeIndex.ownedOutpoints || {};
  safeIndex.spentOutpoints = safeIndex.spentOutpoints || {};
  safeIndex.txs = safeIndex.txs || {};
  const staleTxids = collectKnownStalePendingTxidSet(safeIndex);
  if (!staleTxids.size) {
    const conflictResult = reconcileSpentOutpointUtxoConflicts(safeIndex, { staleTxids });
    return {
      prunedUtxoCount: Number(conflictResult.prunedUtxoCount || 0),
      prunedTxCount: 0,
      prunedSpentOutpointCount: Number(conflictResult.prunedSpentOutpointCount || 0),
    };
  }
  let prunedUtxoCount = 0;
  let prunedTxCount = 0;
  let prunedSpentOutpointCount = 0;
  const conflictResult = reconcileSpentOutpointUtxoConflicts(safeIndex, { staleTxids });
  prunedUtxoCount += Number(conflictResult.prunedUtxoCount || 0);
  prunedSpentOutpointCount += Number(conflictResult.prunedSpentOutpointCount || 0);
  for (const [key, row] of Object.entries(safeIndex.utxos || {})) {
    const txid = String(row?.txId || row?.txid || '').trim().toLowerCase();
    if (row?.confirmed === true || !staleTxids.has(txid)) continue;
    delete safeIndex.utxos[key];
    delete safeIndex.ownedOutpoints[key];
    prunedUtxoCount += 1;
  }
  for (const [outpoint, row] of Object.entries(safeIndex.spentOutpoints || {})) {
    const spentBy = String(row?.spentBy || '').trim().toLowerCase();
    if (!staleTxids.has(spentBy)) continue;
    delete safeIndex.spentOutpoints[outpoint];
    prunedSpentOutpointCount += 1;
  }
  for (const txid of staleTxids) {
    if (!safeIndex.txs?.[txid]) continue;
    delete safeIndex.txs[txid];
    prunedTxCount += 1;
  }
  for (const [key, satoshis] of Object.entries(safeIndex.ownedOutpoints || {})) {
    if (!safeIndex.utxos[key] && Number.isFinite(Number(satoshis || 0))) delete safeIndex.ownedOutpoints[key];
  }
  const finalConflictResult = reconcileSpentOutpointUtxoConflicts(safeIndex, { staleTxids });
  prunedUtxoCount += Number(finalConflictResult.prunedUtxoCount || 0);
  prunedSpentOutpointCount += Number(finalConflictResult.prunedSpentOutpointCount || 0);
  return { prunedUtxoCount, prunedTxCount, prunedSpentOutpointCount };
}

function collectTerminalOrderProtocolTxidSet() {
  const terminalStatuses = new Set(['COMPLETED', 'REFUNDED', 'CANCELED', 'TIMED_OUT']);
  try {
    const orderDomain = require('./order_domain');
    const orders = typeof orderDomain?.listOrdersSync === 'function' ? orderDomain.listOrdersSync() : [];
    return new Set((Array.isArray(orders) ? orders : [])
      .filter((order) => terminalStatuses.has(String(order?.status || '').trim().toUpperCase()))
      .flatMap((order) => Object.values(order?.chain || {}))
      .map((value) => String(value || '').trim().toLowerCase())
      .filter((txid) => /^[0-9a-f]{64}$/i.test(txid)));
  } catch (_) {
    return new Set();
  }
}

function buildWalletDisplayUtxoSummary(givenIndex = null) {
  const index = givenIndex || getSpvIndex();
  if (!givenIndex) {
    const conflict = reconcileKnownConfirmedSpendersInSpvIndex(index, {
      source: 'wallet_display_utxo_summary',
      dryRun: true,
    });
    if (Number(conflict?.removedUtxoCount || 0) > 0) {
      appendSendLog('wallet_balance_read_detected_confirmed_spender_conflict', {
        source: 'wallet_display_utxo_summary',
        policy: 'read_only_no_reconcile',
        conflictCount: Number(conflict.removedUtxoCount || 0),
        sample: Array.isArray(conflict.sample) ? conflict.sample : [],
      });
    }
  }
  const stalePendingTxids = collectKnownStalePendingTxidSet(index);
  const utxos = Object.entries(index?.utxos || {})
    .filter(([outpoint]) => !index?.spentOutpoints?.[outpoint])
    .map(([, utxo]) => utxo)
    .filter((utxo) => {
      const txid = String(utxo?.txId || utxo?.txid || '').trim().toLowerCase();
      if (utxo?.confirmed === true) return true;
      if (!/^[0-9a-f]{64}$/i.test(txid)) return true;
      return !stalePendingTxids.has(txid);
    });
  const classified = utxos.map((utxo) => ({
    ...utxo,
    ...classifyWalletDisplayUtxo(utxo, null),
  }));
  const sumByClass = (displayClass) => classified
    .filter((row) => String(row?.displayClass || '') === displayClass)
    .reduce((acc, row) => acc + Math.max(0, Number(row?.satoshis || 0)), 0);
  const confirmed = sumByClass('confirmed');
  const selfChangePending = sumByClass('self_change_pending');
  const unconfirmedIncoming = sumByClass('external_pending');
  const total = confirmed + selfChangePending + unconfirmedIncoming;
  const available = confirmed + selfChangePending;
  return {
    confirmed,
    selfChangePending,
    unconfirmedIncoming,
    available,
    total,
    classifiedUtxos: classified,
  };
}

function buildPendingReservationSummary(givenIndex = null) {
  const index = givenIndex || getSpvIndex() || {};
  const txs = index.txs || {};
  const spentOutpoints = index.spentOutpoints || {};
  const stalePendingTxids = collectKnownStalePendingTxidSet(index);
  let reservedConfirmedSpent = 0;
  for (const row of Object.values(spentOutpoints || {})) {
    const spentBy = String(row?.spentBy || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(spentBy)) continue;
    if (stalePendingTxids.has(spentBy)) continue;
    const spenderRow = txs[spentBy];
    if (!spenderRow || spenderRow?.confirmed === true) continue;
    if (row?.confirmed === true) {
      reservedConfirmedSpent += Math.max(0, Number(row?.satoshis || 0));
    }
  }
  return {
    reservedConfirmedSpent,
  };
}

function buildCacheFromSpvIndex(givenIndex = null) {
  const index = givenIndex || getSpvIndex();
  const displaySummary = buildWalletDisplayUtxoSummary(index);
  const reservationSummary = buildPendingReservationSummary(index);
  const confirmedLive = Number(displaySummary.confirmed || 0);
  const reservedConfirmedSpent = Number(reservationSummary.reservedConfirmedSpent || 0);
  const confirmed = confirmedLive + reservedConfirmedSpent;
  const unconfirmedBalance = Number(displaySummary.unconfirmedIncoming || 0);
  const selfChangePending = Number(displaySummary.selfChangePending || 0);
  const pendingDelta = selfChangePending - reservedConfirmedSpent;
  const available = confirmed + pendingDelta;
  const txRows = Object.values(index.txs || {});
  const notes = getNotesMap();
  const adjustedNet = (row) => {
    let net = Number(row?.netSat || 0);
    const note = String(notes[String(row?.txid || "")]?.note || "");
    // Market anchor tx is expected to be fee spend; corrupted positive net should not increase balance.
    if (note.startsWith("market:") && net > 0) net = 0;
    return net;
  };
  const incomeSat = txRows.reduce((acc, t) => {
    const net = adjustedNet(t);
    return net > 0 ? (acc + net) : acc;
  }, 0);
  const expenseSat = txRows.reduce((acc, t) => {
    const net = adjustedNet(t);
    return net < 0 ? (acc + Math.abs(net)) : acc;
  }, 0);
  const utxoTotal = Number(displaySummary.total || 0);
  let safeIncomeSat = incomeSat;
  // Some historical tx rows only have txid without netSat; backfill using current UTXO balance.
  if ((safeIncomeSat - expenseSat) < utxoTotal) {
    safeIncomeSat = utxoTotal + expenseSat;
  }
  const txids = Object.values(index.txs || {})
    .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0))
    .map((t) => t.txid);
  const out = {
    confirmed,
    unconfirmed: unconfirmedBalance,
    pendingDelta,
    available,
    availableBsv: available / 100000000,
    selfChangePending,
    unconfirmedIncoming: unconfirmedBalance,
    incomeSat: safeIncomeSat,
    expenseSat,
    total: available + unconfirmedBalance,
    txids,
    updatedAt: index.updatedAt || null,
  };
  const totalSat = Number(out.total || 0);
  if (lastBalanceTotalSatForLog === null) {
    lastBalanceTotalSatForLog = totalSat;
  } else if (lastBalanceTotalSatForLog !== totalSat) {
    const deltaSat = totalSat - lastBalanceTotalSatForLog;
    const recent = txRows
      .slice()
      .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0))
      .slice(0, 6)
      .map((t) => ({
        txid: t.txid,
        netSat: Number(t.netSat || 0),
        confirmed: Boolean(t.confirmed),
        note: String(notes[String(t.txid || "")]?.note || ""),
      }));
    appendSendLog('balance_total_changed', {
      deltaSat,
      totalSat,
      confirmedSat: confirmed,
      unconfirmedSat: unconfirmedBalance,
      incomeSat: safeIncomeSat,
      expenseSat,
      recent,
    });
    lastBalanceTotalSatForLog = totalSat;
  }
  return out;
}

function updateAddressBalancesFromSpv(state) {
  const index = getSpvIndex();
  const displaySummary = buildWalletDisplayUtxoSummary(index);
  const byAddress = {};
  for (const utxo of Array.isArray(displaySummary?.classifiedUtxos) ? displaySummary.classifiedUtxos : []) {
    byAddress[utxo.address] = Number(byAddress[utxo.address] || 0) + Number(utxo.satoshis || 0);
  }
  for (const addr of state.addresses || []) {
    addr.balance = Number(byAddress[addr.address] || 0);
  }
}

function getCriticalRefreshAddresses(state) {
  const items = Array.isArray(state.addresses) ? state.addresses : [];
  const receiveAddress = getReceiveAddress();
  const first = items.find((a) => a.index === 0)?.address;
  const allAddresses = items
    .map((a) => String(a?.address || '').trim())
    .filter(Boolean);
  return Array.from(new Set([receiveAddress, first, ...allAddresses].filter(Boolean)));
}

function getTxAncestorDepth(index, txid, seen = new Set()) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return 0;
  if (seen.has(safeTxid)) return 0;
  seen.add(safeTxid);
  const row = index?.txs?.[safeTxid];
  if (!row) return 0;
  if (row.confirmed === true) return 0;
  const storedDepth = Number(row.ancestorDepth);
  if (Number.isFinite(storedDepth) && storedDepth >= 0) return storedDepth;
  return 1;
}

function listSpendableUtxosForState(state, hdPrivateKey, options = {}) {
  const pathBase = state.pathBase || PATH_BASE;
  const addressToIndex = new Map((state.addresses || []).map((a) => [a.address, a.index]));
  const index = options.index && typeof options.index === 'object'
    ? options.index
    : getSpvIndex(options.forceReload === true ? { forceReload: true } : undefined);
  const maxAncestorDepth = Number.isFinite(Number(options.maxAncestorDepth))
    ? Math.max(0, Number(options.maxAncestorDepth))
    : Number.POSITIVE_INFINITY;
  const includeUnconfirmed = options.includeUnconfirmed !== false;
  const excludeOutpoints = options.excludeOutpoints instanceof Set
    ? options.excludeOutpoints
    : new Set(Array.isArray(options.excludeOutpoints) ? options.excludeOutpoints : []);
  const locallySpentOutpoints = getTxContextSpentOutpoints();
  const allowLocalOwnedChain = options.allowLocalOwnedChain === true;
  const ignoreLocalChainCheck = options.ignoreLocalChainCheck === true;
  const stalePendingTxids = collectKnownStalePendingTxidSet(index);
  const candidateUtxos = new Map(Object.entries(index.utxos || {}));
  if (allowLocalOwnedChain) {
    for (const [outpoint, existing] of Array.from(candidateUtxos.entries())) {
      const safeAddress = String(existing?.address || '').trim();
      if (safeAddress && addressToIndex.has(safeAddress)) continue;
      const match = String(outpoint || '').match(/^([0-9a-f]{64}):(\d+)$/i);
      if (!match) continue;
      const txId = String(match[1] || '').trim().toLowerCase();
      const vout = Number(match[2] || 0);
      const ctxRow = getTxContextByTxid(txId);
      const rawtx = rawtxHexFromUnknown(ctxRow?.rawtx);
      if (!rawtx) continue;
      let repairedAddress = '';
      try {
        const tx = new bsv.Transaction(rawtx);
        const output = tx.outputs?.[vout];
        const maybeAddress = output?.script?.toAddress?.(NETWORK);
        repairedAddress = String(maybeAddress || '').trim();
      } catch (_) {
        repairedAddress = '';
      }
      if (!repairedAddress || !addressToIndex.has(repairedAddress)) continue;
      candidateUtxos.set(outpoint, {
        ...existing,
        txId,
        vout,
        address: repairedAddress,
      });
    }
    for (const [outpoint, satoshis] of Object.entries(index.ownedOutpoints || {})) {
      if (candidateUtxos.has(outpoint)) continue;
      if (index?.spentOutpoints?.[outpoint]) continue;
      if (locallySpentOutpoints.has(outpoint)) continue;
      const match = String(outpoint || '').match(/^([0-9a-f]{64}):(\d+)$/i);
      if (!match) continue;
      const txId = String(match[1] || '').trim().toLowerCase();
      const vout = Number(match[2] || 0);
      const ctxRow = getTxContextByTxid(txId);
      const rawtx = rawtxHexFromUnknown(ctxRow?.rawtx);
      if (!rawtx) continue;
      let address = '';
      try {
        const tx = new bsv.Transaction(rawtx);
        const output = tx.outputs?.[vout];
        const maybeAddress = output?.script?.toAddress?.(NETWORK);
        address = String(maybeAddress || '').trim();
      } catch (_) {
        address = '';
      }
      if (!addressToIndex.has(address)) continue;
      candidateUtxos.set(outpoint, {
        txId,
        vout,
        address,
        satoshis: Number(satoshis || 0),
        confirmed: Boolean(index?.txs?.[txId]?.confirmed),
        ancestorDepth: getTxAncestorDepth(index, txId),
        seenAt: String(ctxRow?.updatedAt || ctxRow?.createdAt || ''),
        updatedAt: String(ctxRow?.updatedAt || ctxRow?.createdAt || ''),
      });
    }
  }
  const spendable = [];
  for (const utxo of candidateUtxos.values()) {
    const idx = addressToIndex.get(utxo.address);
    if (!Number.isInteger(idx)) continue;
    const confirmed = Boolean(utxo.confirmed);
    const txId = String(utxo.txId || '').trim().toLowerCase();
    if (!confirmed && stalePendingTxids.has(txId)) continue;
    const ctxRawtx = rawtxHexFromUnknown(getTxContextByTxid(txId)?.rawtx);
    const ancestorDepth = getTxAncestorDepth(index, utxo.txId);
    if (!confirmed && !includeUnconfirmed) continue;
    if (!confirmed && !ctxRawtx) continue;
    if (ctxRawtx) {
      try {
        const prevTx = new bsv.Transaction(ctxRawtx);
        const prevOutput = prevTx.outputs?.[Number(utxo.vout)];
        const expectedScriptHex = bsv.Script.buildPublicKeyHashOut(utxo.address).toHex();
        const actualScriptHex = typeof prevOutput?.script?.toHex === 'function'
          ? String(prevOutput.script.toHex() || '').toLowerCase()
          : '';
        if (!actualScriptHex || actualScriptHex !== String(expectedScriptHex || '').toLowerCase()) continue;
      } catch (_) {
        continue;
      }
    }
    if (!confirmed && ancestorDepth > maxAncestorDepth) continue;
    const outpoint = `${String(utxo.txId || '')}:${Number(utxo.vout)}`;
    if (locallySpentOutpoints.has(outpoint)) continue;
    if (!confirmed && !ignoreLocalChainCheck && !canSpendWithLocalChain(utxo.txId)) {
      const locallyOwned = Number(index?.ownedOutpoints?.[outpoint] || 0) > 0;
      const locallyApplied = Boolean(index?.txs?.[String(utxo.txId || '').trim().toLowerCase()]?.applied);
      if (!(allowLocalOwnedChain && locallyOwned && locallyApplied)) continue;
    }
    if (excludeOutpoints.has(outpoint)) continue;
    const privKey = hdPrivateKey.deriveChild(`${pathBase}/${idx}`).privateKey;
    spendable.push({
      txId: utxo.txId,
      vout: Number(utxo.vout),
      script: bsv.Script.buildPublicKeyHashOut(utxo.address),
      satoshis: Number(utxo.satoshis),
      confirmed,
      ancestorDepth,
      privKey,
    });
  }
  spendable.sort((a, b) => {
    if (Number(b.confirmed) !== Number(a.confirmed)) return Number(b.confirmed) - Number(a.confirmed);
    if (Number(a.ancestorDepth || 0) !== Number(b.ancestorDepth || 0)) return Number(a.ancestorDepth || 0) - Number(b.ancestorDepth || 0);
    return Number(b.satoshis || 0) - Number(a.satoshis || 0);
  });
  return spendable;
}

function getUtxoKey(utxo) {
  return `${String(utxo?.txId || '')}:${Number(utxo?.vout || 0)}`;
}

function estimateTxFeeSat({ inputCount = 1, outputCount = 2, dataBytes = 0, feeRate = DEFAULT_FEE_RATE }) {
  const safeInputs = Math.max(1, Number(inputCount || 1));
  const safeOutputs = Math.max(1, Number(outputCount || 1));
  const safeDataBytes = Math.max(0, Number(dataBytes || 0));
  const scriptOverhead = safeDataBytes > 0 ? (safeDataBytes + 16) : 0;
  const sizeBytes = 10 + (safeInputs * 148) + (safeOutputs * 34) + scriptOverhead;
  return Math.max(1, Math.ceil(sizeBytes * Number(feeRate || DEFAULT_FEE_RATE || 1)));
}

function selectUtxosForTransaction(availableUtxos, options = {}) {
  const targetSat = Math.max(0, Number(options.targetSat || 0));
  const feeRate = Math.max(0.25, Number(options.feeRate || DEFAULT_FEE_RATE || 1));
  const outputCount = Math.max(1, Number(options.outputCount || 2));
  const dataBytes = Math.max(0, Number(options.dataBytes || 0));
  const smallThreshold = Math.max(SAFE_MIN_CHANGE_SAT, Number(options.smallThreshold || CONSOLIDATE_SMALL_UTXO_SAT));
  const triggerCount = Math.max(2, Number(options.consolidateTriggerCount || CONSOLIDATE_TRIGGER_COUNT));
  const totalTriggerCount = Math.max(4, Number(options.totalTriggerCount || CONSOLIDATE_TOTAL_TRIGGER_COUNT));
  const maxExtraInputs = Math.max(0, Number(options.maxExtraInputs || CONSOLIDATE_MAX_EXTRA_INPUTS));
  const allowConsolidation = options.allowConsolidation !== false;
  const preferSingleInput = options.preferSingleInput === true;
  const utxos = Array.isArray(availableUtxos) ? availableUtxos.slice() : [];
  const selected = [];
  const selectedKeys = new Set();
  let selectedTotalSat = 0;
  const requiredFor = (inputCount) => targetSat + estimateTxFeeSat({
    inputCount,
    outputCount,
    dataBytes,
    feeRate,
  });

  if (preferSingleInput) {
    const single = utxos
      .filter((utxo) => Number(utxo.satoshis || 0) >= requiredFor(1))
      .sort((a, b) => Number(a.satoshis || 0) - Number(b.satoshis || 0))[0];
    if (single) {
      selected.push(single);
      selectedKeys.add(getUtxoKey(single));
      selectedTotalSat += Number(single.satoshis || 0);
    }
  }

  if (!selected.length) {
    for (const utxo of utxos) {
      selected.push(utxo);
      selectedKeys.add(getUtxoKey(utxo));
      selectedTotalSat += Number(utxo.satoshis || 0);
      if (selectedTotalSat >= requiredFor(selected.length)) break;
    }
  }

  if (selectedTotalSat < requiredFor(selected.length || 1)) {
    throw new Error('Insufficient spendable balance');
  }

  let consolidationApplied = false;
  let consolidationInputCount = 0;
  if (allowConsolidation) {
    const remaining = utxos.filter((u) => !selectedKeys.has(getUtxoKey(u)));
    const smallConfirmed = remaining
      .filter((u) => Boolean(u.confirmed) && Number(u.satoshis || 0) <= smallThreshold)
      .sort((a, b) => Number(a.satoshis || 0) - Number(b.satoshis || 0));
    const shouldConsolidate = smallConfirmed.length >= triggerCount || utxos.length >= totalTriggerCount;
    if (shouldConsolidate) {
      for (const utxo of smallConfirmed) {
        if (consolidationInputCount >= maxExtraInputs) break;
        selected.push(utxo);
        selectedKeys.add(getUtxoKey(utxo));
        selectedTotalSat += Number(utxo.satoshis || 0);
        consolidationInputCount += 1;
      }
      consolidationApplied = consolidationInputCount > 0;
    }
  }

  return {
    utxos: selected,
    selectedTotalSat,
    consolidationApplied,
    consolidationInputCount,
    estimatedFeeSat: estimateTxFeeSat({
      inputCount: selected.length,
      outputCount,
      dataBytes,
      feeRate,
    }),
  };
}

function requiredFeeForSizeSat(sizeBytes, feeRate = DEFAULT_FEE_RATE) {
  return Math.max(1, Math.ceil(Math.max(0, Number(sizeBytes || 0)) * Math.max(0.25, Number(feeRate || DEFAULT_FEE_RATE || 1))));
}

function signTransactionInputs(tx, utxos) {
  for (const utxo of (Array.isArray(utxos) ? utxos : [])) {
    tx.sign(utxo.privKey);
  }
}

function signTransactionInputsAtOffset(tx, utxos, inputOffset = 0) {
  const list = Array.isArray(utxos) ? utxos : [];
  for (let i = 0; i < list.length; i += 1) {
    const utxo = list[i];
    const inputIndex = Number(inputOffset || 0) + i;
    const input = tx.inputs?.[inputIndex];
    if (!input || !utxo?.privKey) continue;
    const signatures = input.getSignatures(
      tx,
      utxo.privKey,
      inputIndex,
      bsv.crypto.Signature.SIGHASH_ALL | bsv.crypto.Signature.SIGHASH_FORKID,
    );
    for (const signature of (Array.isArray(signatures) ? signatures : [])) {
      input.addSignature(tx, signature);
    }
  }
}

function clearExplicitTransactionFee(tx) {
  if (tx && Object.prototype.hasOwnProperty.call(tx, '_fee')) {
    tx._fee = undefined;
  }
}

function clearTransactionSignatures(tx) {
  if (tx && typeof tx._clearSignatures === 'function') {
    tx._clearSignatures();
  }
}

function buildSpendableUtxoError(state, hdPrivateKey, action, maxAncestorDepth) {
  const allSpendable = listSpendableUtxosForState(state, hdPrivateKey, {
    includeUnconfirmed: true,
    maxAncestorDepth: Number.POSITIVE_INFINITY,
  });
  if (!allSpendable.length) return new Error('No local SPV UTXOs found');
  const unconfirmed = allSpendable.filter((u) => !u.confirmed);
  if (!unconfirmed.length) return new Error('No local SPV UTXOs found');
  if (!Number.isFinite(Number(maxAncestorDepth))) return new Error('No local SPV UTXOs found');
  const minDepth = Math.min(...unconfirmed.map((u) => Number(u.ancestorDepth || 1)));
  if (minDepth > maxAncestorDepth) {
    return new Error(`Waiting for prior transaction confirmation before ${action} again`);
  }
  return new Error('No local SPV UTXOs found');
}

function applyFeeAndSafeChange(tx, changeAddress, feeRate = DEFAULT_FEE_RATE, minChangeSat = SAFE_MIN_CHANGE_SAT) {
  tx.change(changeAddress);
  let feeSat = 0;
  for (let i = 0; i < 5; i += 1) {
    const txSizeBytes = Math.ceil(tx.serialize(true).length / 2);
    const nextFeeSat = requiredFeeForSizeSat(txSizeBytes, feeRate);
    if (nextFeeSat === feeSat) break;
    feeSat = nextFeeSat;
    tx.fee(feeSat);
  }
  const changeOutput = tx.getChangeOutput ? tx.getChangeOutput() : null;
  if (!changeOutput) {
    return { feeSat: Number(tx.getFee ? tx.getFee() : feeSat), absorbedChangeSat: 0 };
  }
  const changeSat = Number(changeOutput.satoshis || 0);
  if (!Number.isFinite(changeSat) || changeSat >= minChangeSat) {
    return { feeSat: Number(tx.getFee ? tx.getFee() : feeSat), absorbedChangeSat: 0 };
  }
  const idx = tx.outputs.indexOf(changeOutput);
  if (idx >= 0) {
    tx.removeOutput(idx);
    tx.fee(Number(tx.getFee ? tx.getFee() : 0) + changeSat);
    return { feeSat: Number(tx.getFee ? tx.getFee() : 0), absorbedChangeSat: changeSat };
  }
  return { feeSat: Number(tx.getFee ? tx.getFee() : feeSat), absorbedChangeSat: 0 };
}

function finalizeFeeAndSign(tx, utxos, changeAddress, feeRate = DEFAULT_FEE_RATE, minChangeSat = SAFE_MIN_CHANGE_SAT) {
  tx.change(changeAddress);
  let absorbedChangeSat = 0;
  let feeSat = 0;
  for (let i = 0; i < 12; i += 1) {
    signTransactionInputs(tx, utxos);
    // During fee convergence the auto-generated change output can briefly fall
    // below dust. We need the signed size first so we can absorb/remove that
    // tiny change before doing a fully checked serialize.
    const rawtx = tx.serialize({ disableDustOutputs: true });
    const sizeBytes = Buffer.from(rawtx, 'hex').length;
    const requiredFeeSat = requiredFeeForSizeSat(sizeBytes, feeRate);
    const targetFeeSat = requiredFeeSat + FINAL_SIGNED_FEE_SAFETY_SAT;
    const currentFeeSat = Number(tx.getFee ? tx.getFee() : 0);
    const changeOutput = tx.getChangeOutput ? tx.getChangeOutput() : null;
    if (changeOutput) {
      const changeSat = Number(changeOutput.satoshis || 0);
      if (Number.isFinite(changeSat) && changeSat > 0 && changeSat < minChangeSat) {
        const idx = tx.outputs.indexOf(changeOutput);
        if (idx >= 0) {
          tx.removeOutput(idx);
          absorbedChangeSat += changeSat;
          tx.fee(currentFeeSat + changeSat);
          continue;
        }
      }
    }
    if (currentFeeSat >= targetFeeSat && currentFeeSat <= targetFeeSat + FINAL_SIGNED_FEE_SAFETY_SAT) {
      return {
        feeSat: currentFeeSat,
        requiredFeeSat,
        sizeBytes,
        feePerByte: sizeBytes > 0 ? currentFeeSat / sizeBytes : 0,
        absorbedChangeSat,
      };
    }
    tx.fee(targetFeeSat);
    feeSat = targetFeeSat;
  }
  for (let i = 0; i < 6; i += 1) {
    signTransactionInputs(tx, utxos);
    const rawtx = tx.serialize({ disableDustOutputs: true });
    const sizeBytes = Buffer.from(rawtx, 'hex').length;
    const currentFeeSat = Number(tx.getFee ? tx.getFee() : feeSat);
    const requiredFeeSat = requiredFeeForSizeSat(sizeBytes, feeRate);
    if (currentFeeSat >= requiredFeeSat) {
      return {
        feeSat: currentFeeSat,
        requiredFeeSat,
        sizeBytes,
        feePerByte: sizeBytes > 0 ? currentFeeSat / sizeBytes : 0,
        absorbedChangeSat,
      };
    }
    const targetFeeSat = requiredFeeSat + FINAL_SIGNED_FEE_SAFETY_SAT;
    const changeOutput = tx.getChangeOutput ? tx.getChangeOutput() : null;
    if (changeOutput) {
      const changeSat = Number(changeOutput.satoshis || 0);
      if (Number.isFinite(changeSat) && changeSat > 0 && changeSat < minChangeSat) {
        const idx = tx.outputs.indexOf(changeOutput);
        if (idx >= 0) {
          tx.removeOutput(idx);
          absorbedChangeSat += changeSat;
          tx.fee(currentFeeSat + changeSat);
          continue;
        }
      }
    }
    tx.fee(targetFeeSat);
    feeSat = targetFeeSat;
  }
  signTransactionInputs(tx, utxos);
  const rawtx = tx.serialize();
  const sizeBytes = Buffer.from(rawtx, 'hex').length;
  const currentFeeSat = Number(tx.getFee ? tx.getFee() : feeSat);
  const requiredFeeSat = requiredFeeForSizeSat(sizeBytes, feeRate);
  if (currentFeeSat < requiredFeeSat) {
    throw new Error(`Final signed transaction fee too low (${currentFeeSat} < ${requiredFeeSat})`);
  }
  return {
    feeSat: currentFeeSat,
    requiredFeeSat,
    sizeBytes,
    feePerByte: sizeBytes > 0 ? currentFeeSat / sizeBytes : 0,
    absorbedChangeSat,
  };
}

function finalizeSendAllFeeAndSign(tx, utxos, sendOutputIndex, feeRate = DEFAULT_FEE_RATE) {
  const totalInputSat = (Array.isArray(utxos) ? utxos : []).reduce((sum, utxo) => sum + Number(utxo.satoshis || 0), 0);
  let targetFeeSat = estimateTxFeeSat({
    inputCount: Array.isArray(utxos) ? utxos.length : 1,
    outputCount: 1,
    feeRate,
  }) + FINAL_SIGNED_FEE_SAFETY_SAT;
  let lastSizeBytes = null;
  for (let i = 0; i < 16; i += 1) {
    const output = tx.outputs[sendOutputIndex];
    if (!output) throw new Error('Send-all output missing');
    const nextAmountSat = totalInputSat - targetFeeSat;
    if (!(nextAmountSat > 0)) throw new Error('Insufficient spendable balance');
    if (Number(output.satoshis || 0) !== nextAmountSat) {
      output.satoshis = nextAmountSat;
      clearTransactionSignatures(tx);
    }
    clearExplicitTransactionFee(tx);
    signTransactionInputs(tx, utxos);
    const rawtx = tx.uncheckedSerialize();
    const sizeBytes = Buffer.from(rawtx, 'hex').length;
    const requiredFeeSat = requiredFeeForSizeSat(sizeBytes, feeRate);
    const desiredFeeSat = requiredFeeSat + FINAL_SIGNED_FEE_SAFETY_SAT;
    const feeSat = totalInputSat - Number(output.satoshis || 0);
    if (feeSat >= desiredFeeSat && desiredFeeSat === targetFeeSat && sizeBytes === lastSizeBytes) {
      tx.serialize();
      return {
        feeSat,
        requiredFeeSat,
        sizeBytes,
        feePerByte: sizeBytes > 0 ? feeSat / sizeBytes : 0,
        sendAll: true,
      };
    }
    targetFeeSat = Math.max(targetFeeSat, desiredFeeSat);
    lastSizeBytes = sizeBytes;
  }
  const output = tx.outputs[sendOutputIndex];
  if (!output) throw new Error('Send-all output missing');
  const finalAmountSat = totalInputSat - targetFeeSat;
  if (!(finalAmountSat > 0)) throw new Error('Insufficient spendable balance');
  if (Number(output.satoshis || 0) !== finalAmountSat) {
    output.satoshis = finalAmountSat;
    clearTransactionSignatures(tx);
  }
  clearExplicitTransactionFee(tx);
  signTransactionInputs(tx, utxos);
  const rawtx = tx.serialize();
  const sizeBytes = Buffer.from(rawtx, 'hex').length;
  const feeSat = totalInputSat - Number(output.satoshis || 0);
  const requiredFeeSat = requiredFeeForSizeSat(sizeBytes, feeRate);
  const desiredFeeSat = requiredFeeSat + FINAL_SIGNED_FEE_SAFETY_SAT;
  if (feeSat < desiredFeeSat) {
    throw new Error(`Final signed send-all transaction fee too low (${feeSat} < ${desiredFeeSat})`);
  }
  return {
    feeSat,
    requiredFeeSat,
    sizeBytes,
    feePerByte: sizeBytes > 0 ? feeSat / sizeBytes : 0,
    sendAll: true,
  };
}

function validateAnchorRawTx(rawtx, minDataOutputSat = ANCHOR_DATA_OUTPUT_SAT) {
  const tx = new bsv.Transaction(rawtx);
  const dataOutputs = tx.outputs.filter((output) => output?.script?.isDataOut && output.script.isDataOut());
  if (!dataOutputs.length) {
    throw new Error('Anchor transaction missing OP_RETURN data output');
  }
  const safeMinDataOutputSat = Math.max(0, Number(minDataOutputSat || 0));
  const smallestDataOutputSat = Math.min(...dataOutputs.map((output) => Number(output?.satoshis || 0)));
  if (!Number.isFinite(smallestDataOutputSat) || smallestDataOutputSat < safeMinDataOutputSat) {
    throw new Error(`Anchor data output below safe minimum (${smallestDataOutputSat} < ${safeMinDataOutputSat})`);
  }
  return {
    dataOutputCount: dataOutputs.length,
    smallestDataOutputSat,
  };
}

function validateRawTxPolicy(rawtx, options = {}) {
  const minStandardOutputSat = Math.max(1, Number(options.minStandardOutputSat || SAFE_MIN_CHANGE_SAT));
  const minDataOutputSat = Math.max(0, Number(options.minDataOutputSat ?? ANCHOR_DATA_OUTPUT_SAT));
  const allowedP2shVouts = new Set(
    Array.isArray(options.allowedP2shVouts)
      ? options.allowedP2shVouts.map((vout) => Number(vout)).filter((vout) => Number.isInteger(vout) && vout >= 0)
      : []
  );
  const allowP2shOutputs = options.allowP2shOutputs === true;
  const tx = new bsv.Transaction(rawtx);
  const dataOutputs = [];
  const standardOutputs = [];
  tx.outputs.forEach((output, idx) => {
    const satoshis = Number(output?.satoshis || 0);
    const isDataOut = Boolean(output?.script?.isDataOut && output.script.isDataOut());
    const isP2sh = Boolean(output?.script?.isScriptHashOut && output.script.isScriptHashOut());
    if (!Number.isFinite(satoshis) || (!isDataOut && satoshis <= 0) || (isDataOut && satoshis < 0)) {
      throw new Error(`Transaction output ${idx} has invalid satoshis`);
    }
    if (isDataOut) {
      dataOutputs.push({ idx, satoshis });
      if (satoshis < minDataOutputSat) {
        throw new Error(`Transaction data output ${idx} below safe minimum (${satoshis} < ${minDataOutputSat})`);
      }
      return;
    }
    if (isP2sh && !allowP2shOutputs && !allowedP2shVouts.has(idx)) {
      throw new Error(`Transaction output ${idx} uses forbidden P2SH locking script`);
    }
    standardOutputs.push({ idx, satoshis });
    if (satoshis < minStandardOutputSat) {
      throw new Error(`Transaction output ${idx} below safe minimum (${satoshis} < ${minStandardOutputSat})`);
    }
  });
  return {
    outputCount: tx.outputs.length,
    dataOutputCount: dataOutputs.length,
    standardOutputCount: standardOutputs.length,
    smallestDataOutputSat: dataOutputs.length ? Math.min(...dataOutputs.map((o) => o.satoshis)) : null,
    smallestStandardOutputSat: standardOutputs.length ? Math.min(...standardOutputs.map((o) => o.satoshis)) : null,
  };
}

function getPrevOutputForInput(input, index = null) {
  const prevTxId = input?.prevTxId ? Buffer.from(input.prevTxId).toString('hex') : '';
  const vout = Number(input?.outputIndex);
  if (!/^[0-9a-f]{64}$/i.test(prevTxId) || !Number.isInteger(vout) || vout < 0) return null;
  const outpoint = `${prevTxId}:${vout}`;
  const activeIndex = index || getSpvIndex();
  const utxo = activeIndex?.utxos?.[outpoint];
  const ctx = getTxContextByTxid(prevTxId);
  if ((!utxo || Number(utxo.satoshis || 0) <= 0) && ctx?.rawtx) {
    try {
      const prevTx = new bsv.Transaction(ctx.rawtx);
      const output = prevTx.outputs[vout];
      if (!output) return null;
      return {
        outpoint,
        txId: prevTxId,
        vout,
        satoshis: Number(output.satoshis || 0),
        confirmed: Boolean(ctx.confirmed === true),
        proofReady: hasConfirmedBoundaryProof(ctx, null),
        script: output.script,
        output,
        contextOnlyPrevout: true,
      };
    } catch (_) {
      return null;
    }
  }
  if (!utxo || Number(utxo.satoshis || 0) <= 0) return null;
  if (!ctx?.rawtx) {
    const address = String(utxo.address || '').trim();
    const satoshis = Number(utxo.satoshis || 0);
    if (utxo.confirmed === true && address && satoshis > 0) {
      try {
        return {
          outpoint,
          txId: prevTxId,
          vout,
          satoshis,
          confirmed: true,
          proofReady: false,
          script: bsv.Script.buildPublicKeyHashOut(address),
          output: new bsv.Transaction.Output({
            script: bsv.Script.buildPublicKeyHashOut(address),
            satoshis,
          }),
          syntheticPrevout: true,
        };
      } catch (_) {}
    }
    return {
      outpoint,
      txId: prevTxId,
      vout,
      satoshis: Number(utxo.satoshis || 0),
      confirmed: utxo.confirmed === true,
      missingRawtx: true,
      script: null,
    };
  }
  try {
    const prevTx = new bsv.Transaction(ctx.rawtx);
    const output = prevTx.outputs[vout];
    if (!output) return null;
    return {
      outpoint,
      txId: prevTxId,
      vout,
      satoshis: Number(output.satoshis || utxo.satoshis || 0),
      confirmed: Boolean(utxo.confirmed === true || ctx.confirmed === true),
      proofReady: hasConfirmedBoundaryProof(ctx, null),
      script: output.script,
      output,
    };
  } catch (_) {
    return null;
  }
}

function validateLocalRawTxSpend(rawtx, options = {}) {
  const rawtxHex = rawtxHexFromUnknown(rawtx);
  const tx = new bsv.Transaction(rawtxHex);
  const index = getSpvIndex();
  const inputFacts = [];
  let inputSat = 0;
  let missingInputCount = 0;
  let missingProofCount = 0;
  const allowMissingExternalInputs = options.allowMissingExternalInputs === true;
  for (const input of tx.inputs || []) {
    const prev = getPrevOutputForInput(input, index);
    if (!prev) {
      missingInputCount += 1;
      const prevTxId = input?.prevTxId ? Buffer.from(input.prevTxId).toString('hex') : '';
      inputFacts.push({ outpoint: `${prevTxId}:${Number(input?.outputIndex)}`, missing: true });
      continue;
    }
    if (prev.missingRawtx || !prev.output) {
      missingInputCount += 1;
      inputFacts.push({ outpoint: prev.outpoint, satoshis: prev.satoshis, missingRawtx: true });
      continue;
    }
    input.output = prev.output;
    inputSat += Number(prev.satoshis || 0);
    if (prev.confirmed && !prev.proofReady) missingProofCount += 1;
    inputFacts.push({
      outpoint: prev.outpoint,
      satoshis: Number(prev.satoshis || 0),
      confirmed: Boolean(prev.confirmed),
      proofReady: Boolean(prev.proofReady),
    });
  }
  if (missingInputCount > 0 && !allowMissingExternalInputs) {
    const err = new Error(`Local transaction input validation failed: missing ${missingInputCount} spendable input(s)`);
    err.code = 'LOCAL_TX_INPUT_MISSING';
    err.inputs = inputFacts;
    throw err;
  }
  const outputSat = tx.outputs.reduce((sum, output) => sum + Number(output?.satoshis || 0), 0);
  const feeSat = inputSat - outputSat;
  const sizeBytes = Buffer.from(rawtxHex, 'hex').length;
  const minFeeSat = requiredFeeForSizeSat(sizeBytes, options.minFeeRate || DEFAULT_FEE_RATE);
  if (missingInputCount === 0 && (!Number.isFinite(feeSat) || feeSat < minFeeSat)) {
    const err = new Error(`Local transaction fee too low (${feeSat} < ${minFeeSat})`);
    err.code = 'LOCAL_TX_FEE_TOO_LOW';
    err.feeSat = feeSat;
    err.minFeeSat = minFeeSat;
    throw err;
  }
  let verifyResult = true;
  if (missingInputCount === 0) {
    try {
      verifyResult = tx.verify();
    } catch (err) {
      verifyResult = String(err?.message || err || 'script verification failed');
    }
    if (verifyResult !== true) {
      const err = new Error(`Local transaction script verification failed: ${String(verifyResult || 'verify failed')}`);
      err.code = 'LOCAL_TX_SCRIPT_VERIFY_FAILED';
      throw err;
    }
  }
  return {
    txid: tx.id,
    inputSat,
    outputSat,
    feeSat,
    feePerByte: sizeBytes > 0 ? feeSat / sizeBytes : 0,
    sizeBytes,
    inputCount: tx.inputs.length,
    missingInputCount,
    externalInputValidationSkipped: missingInputCount > 0 && allowMissingExternalInputs,
    missingProofCount,
    inputs: inputFacts,
  };
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function pickNextSpvNode(excluded = new Set()) {
  if (!Array.isArray(spvRuntime.nodes) || !spvRuntime.nodes.length) return null;
  for (let i = 0; i < spvRuntime.nodes.length; i += 1) {
    const idx = (spvRuntime.nodeCursor + i) % spvRuntime.nodes.length;
    const node = spvRuntime.nodes[idx];
    if (!excluded.has(node)) {
      spvRuntime.nodeCursor = (idx + 1) % spvRuntime.nodes.length;
      return node;
    }
  }
  return null;
}

async function connectSpvNode(node) {
  let markedFailure = false;
  const markFailure = (reason) => {
    if (markedFailure) return;
    markedFailure = true;
    recordSpvNodeFailure(node, reason);
  };
  let session = null;
  let peer = null;
  let connectedAt = 0;

  const cleanup = (reason, options = {}) => {
    const {
      markFailure: shouldMarkFailure = true,
      reconnectDelayMs = 1200,
    } = options || {};
    spvRuntime.connectingNodes.delete(node);
    if (spvRuntime.peers.get(node) === peer) {
      spvRuntime.peers.delete(node);
    }
    if (spvRuntime.sessions.get(node) === session) {
      spvRuntime.sessions.delete(node);
    }
    Promise.resolve(session?.release?.({ outcome: reason || 'listener_cleanup' })).catch(() => {});
    if (reason && shouldMarkFailure) markFailure(reason);
    refreshWalletNodeManagerState();
    scheduleSpvMaintain(reconnectDelayMs);
  };

  try {
    session = await p2pNodeRuntime.connectSession(getWalletP2PNodeSelector(), {
      node,
      purpose: 'wallet_listener',
      mode: 'persistent',
      connectTimeoutMs: SPV_CONNECT_TIMEOUT_MS,
    });
    peer = session.peer;
  } catch (err) {
    spvRuntime.connectingNodes.delete(node);
    markFailure(err.message || 'connect_failed');
    appendSendLog('spv_listener_connect_failed', { node, error: err.message });
    refreshWalletNodeManagerState();
    scheduleSpvMaintain(1500);
    throw err;
  }

  peer.on('transactions', ({ transactions, header }) => {
    const confirmed = Boolean(header);
    let hit = 0;
    const entries = Array.isArray(transactions) ? transactions : [];
    const touchHints = getWalletTouchHints();
    for (const [, txLike] of entries) {
      const observedTx = txFromUnknown(txLike);
      if (!observedTx) continue;
      const rawtxHex = rawtxHexFromUnknown(observedTx);
      const marketRelevant = Boolean(rawtxHex && rawtxHex.includes(MARKET_CHAIN_MARKER_HEX));
      const walletRelevant = Boolean(
        transactionTouchesWalletWithHints(observedTx, touchHints)
        || (marketRelevant && transactionMentionsCurrentWalletId(observedTx))
      );
      const changed = walletRelevant ? applyTxToSpvIndex(observedTx, { confirmed }) : false;
      const published = (marketRelevant || walletRelevant)
        ? publishObservedChainRawtx(observedTx, {
          confirmed,
          node,
          source: 'wallet_spv_listener',
          walletRelevant,
        })
        : false;
      if (walletRelevant || marketRelevant || published) hit += 1;
      if (observedTx?.id) {
        if (walletRelevant || marketRelevant || published) {
          rememberSpvTxObservation(observedTx.id, {
            relevant: walletRelevant || marketRelevant || published,
            confirmedSeen: confirmed,
            node,
          });
        }
      }
      if (walletRelevant && !changed && observedTx?.id) {
        appendSendLog('spv_tx_event_wallet_relevant_no_change', {
          txid: String(observedTx.id || ''),
          confirmed,
          node,
        });
      }
      if (!changed && confirmed) {
        if (observedTx?.id) markTxConfirmedInIndex(observedTx.id);
      }
    }
    if (entries.length > 0) {
      recordSpvListenerTxRelay(node, {
        txCount: entries.length,
        relevantCount: hit,
        confirmed,
      });
    }
    if (hit > 0) {
      appendSendLog('spv_tx_event_hit', { confirmed, txCount: hit, node });
    }
  });
  peer.on('version', ({ version }) => {
    appendSendLog('spv_peer_version', { node, version: version?.version, services: version?.services?.toString?.('hex') || null });
  });
  peer.on('verack', () => {
    appendSendLog('spv_peer_verack', { node });
  });
  peer.on('reject', (msg) => {
    appendSendLog('spv_peer_reject', { node, code: msg?.ccode || null, reason: msg?.reason || null, message: msg?.message || null });
  });

  const onAddrPayload = (payload, sourceEvent = 'addr') => {
    const source = payload?.addrs || payload?.addr || payload;
    const endpoints = extractNodeEndpoints(source);
    if (endpoints.length) {
      upsertSpvNodes(endpoints, sourceEvent);
      appendSendLog('spv_addr_discovered', { node, sourceEvent, count: endpoints.length });
    }
  };
  peer.on('addr', (payload) => onAddrPayload(payload, 'addr'));
  peer.on('peers', (payload) => onAddrPayload(payload, 'peers'));

  peer.on('disconnected', () => {
    const uptimeMs = connectedAt > 0 ? Math.max(0, Date.now() - connectedAt) : 0;
    appendSendLog('spv_listener_disconnected', { node, uptimeMs });
    // Many public nodes accept the persistent listener connection and then close it
    // shortly after without a transport error. Treat that as churn, not as a hard
    // node failure, otherwise the listener pool thrashes itself.
    cleanup('disconnected', {
      markFailure: false,
      reconnectDelayMs: uptimeMs > 0 && uptimeMs < 5000 ? 2200 : 1200,
    });
  });
  peer.on('error_socket', () => {
    appendSendLog('spv_listener_socket_error', { node });
    try {
      peer.disconnect(false);
    } catch (_) {}
    cleanup('socket_error');
  });

  try {
    recordSpvNodeSuccess(node);
    connectedAt = Date.now();
    spvRuntime.lastGoodNode = node;
    spvRuntime.connectingNodes.delete(node);
    spvRuntime.peers.set(node, peer);
    spvRuntime.sessions.set(node, session);
    try {
      peer.sendMessage('getaddr');
      appendSendLog('spv_getaddr_sent', { node });
    } catch (_) {}
    if (SPV_AGGRESSIVE_LISTEN) {
      peer.listenForTxs();
      peer.listenForBlocks();
      appendSendLog('spv_listen_mode', { node, mode: 'aggressive', mempoolCatchup: false });
    } else {
      peer.listenForTxs();
      appendSendLog('spv_listen_mode', {
        node,
        mode: 'light',
        mempoolCatchup: false,
      });
    }
    appendSendLog('spv_listener_connected', { node, connectedNow: spvRuntime.peers.size });
    refreshWalletNodeManagerState();
    scheduleSpvMaintain(300);
  } catch (err) {
    spvRuntime.connectingNodes.delete(node);
    markFailure(err.message || 'connect_failed');
    appendSendLog('spv_listener_connect_failed', { node, error: err.message });
    Promise.resolve(session?.release?.({ outcome: 'listener_connect_failed', reason: String(err?.message || 'connect_failed') })).catch(() => {});
    refreshWalletNodeManagerState();
    scheduleSpvMaintain(1500);
    throw err;
  }
}

async function maintainSpvConnections() {
  if (DISABLE_SPV_LISTENER) return;
  if (spvRuntime.maintaining) return;
  spvRuntime.maintaining = true;
  try {
    const policy = getWalletRuntimePolicy();
    if (!policy.listenerEnabled || policy.listenerTarget <= 0) {
      stopSpvListener('listener_disabled');
      return;
    }
    spvRuntime.nodes = getRankedSpvNodes({ limit: null, includeBannedFallback: true, role: 'listener' }).map((n) => n.endpoint);
    if (!spvRuntime.nodes.length) {
      scheduleSpvMaintain(3000);
      return;
    }
    const target = Math.max(0, Math.min(SPV_NODE_CONNECT_TOP, Number(policy.listenerTarget || 0)));
    disconnectSpvOverflowPeers(target);
    const rebalanced = rebalanceSpvActivePeers(target);
    if (rebalanced) scheduleSpvMaintain(600);
    const active = new Set([
      ...Array.from(spvRuntime.peers.keys()),
      ...Array.from(spvRuntime.connectingNodes.values()),
    ]);
    if (active.size > target) disconnectSpvOverflowPeers(target);
    const need = target - active.size;
    if (need <= 0) {
      const probeRebalanced = await maybeProbeAndRebalanceActivePeers(target).catch(() => false);
      if (probeRebalanced) scheduleSpvMaintain(600);
      return;
    }

    for (let i = 0; i < need; i += 1) {
      const node = pickNextSpvNode(active);
      if (!node) break;
      active.add(node);
      spvRuntime.connectingNodes.add(node);
      connectSpvNode(node).catch(() => {});
    }
    if (spvRuntime.peers.size < target) {
      scheduleSpvMaintain(2000);
    }
    refreshWalletNodeManagerState();
  } finally {
    spvRuntime.maintaining = false;
  }
}

function startSpvListener() {
  if (DISABLE_SPV_LISTENER) return;
  if (!walletRuntimePolicy.listenerEnabled || walletRuntimePolicy.listenerTarget <= 0) return;
  if (!spvRuntime.started) spvRuntime.started = true;
  if (!spvRuntime.peers.size && !spvRuntime.connectingNodes.size) {
    maintainSpvConnections().catch(() => {});
  }
}

async function ensureSpvListenerActive() {
  if (DISABLE_SPV_LISTENER) {
    return getSpvNodeSnapshot(SPV_NODE_CONNECT_TOP);
  }
  if (!walletRuntimePolicy.listenerEnabled || walletRuntimePolicy.listenerTarget <= 0) {
    stopSpvListener('listener_disabled');
    return getSpvNodeSnapshot(0);
  }
  startSpvListener();
  if (!spvRuntime.peers.size && !spvRuntime.connectingNodes.size) {
    await maintainSpvConnections().catch(() => {});
  }
  return getSpvNodeSnapshot(walletRuntimePolicy.listenerTarget);
}

async function pullMempoolSnapshot(addresses, options = {}) {
  void addresses;
  return {
    skipped: true,
    reason: 'getmempool_disabled',
    checked: 0,
    changed: 0,
    targetCount: Array.isArray(options?.targetTxids) ? options.targetTxids.length : 0,
    targetHitCount: 0,
    txids: [],
  };
}

async function refreshUnconfirmedWalletSnapshot(options = {}) {
  const cooldownMs = Math.max(0, Number(options?.cooldownMs || 5000));
  const now = Date.now();
  if (unconfirmedWalletSnapshotInFlight) return unconfirmedWalletSnapshotInFlight;
  if (cooldownMs > 0 && now - lastUnconfirmedWalletSnapshotAt < cooldownMs) {
    return { skipped: true, reason: 'cooldown', ageMs: now - lastUnconfirmedWalletSnapshotAt };
  }
  unconfirmedWalletSnapshotInFlight = (async () => {
    lastUnconfirmedWalletSnapshotAt = Date.now();
    const state = getWalletStateSnapshotInternal();
    const addresses = Array.isArray(state.addresses) ? state.addresses : [];
    startSpvListener();
    if (!spvRuntime.peers.size && !spvRuntime.connectingNodes.size) {
      await maintainSpvConnections().catch(() => {});
    }
    const result = await pullMempoolSnapshot(addresses, {
      force: true,
      source: String(options?.source || 'refresh_unconfirmed_wallet_snapshot'),
      nodeLimit: Math.max(1, Number(options?.nodeLimit || 3)),
      snapshotMs: Math.max(250, Number(options?.snapshotMs || 1200)),
      connectTimeoutMs: Math.max(500, Number(options?.connectTimeoutMs || 1800)),
      stopOnHit: options?.stopOnHit !== false,
    });
    if (Number(result?.changed || 0) > 0) {
      const freshState = getWalletState();
      updateAddressBalancesFromSpv(freshState);
      saveWalletState(freshState);
      const cache = buildCacheFromSpvIndex();
      writeJson(CACHE_FILE, cache);
      result.cache = cache;
    }
    return result;
  })();
  try {
    return await unconfirmedWalletSnapshotInFlight;
  } finally {
    unconfirmedWalletSnapshotInFlight = null;
  }
}

function txidFromRaw(rawtx) {
  return new bsv.Transaction(rawtx).id;
}

function bufferHex(value) {
  if (Buffer.isBuffer(value)) return value.toString('hex').toLowerCase();
  if (value && typeof value.toString === 'function') {
    const text = String(value.toString('hex') || value.toString() || '').trim().toLowerCase();
    if (/^[0-9a-f]+$/i.test(text)) return text;
  }
  return '';
}

function reverseHexBytes(hex) {
  const safe = String(hex || '').trim().toLowerCase();
  if (!/^[0-9a-f]+$/i.test(safe) || safe.length % 2 !== 0) return '';
  return Buffer.from(safe, 'hex').reverse().toString('hex');
}

function normalizeRejectMessage(msg) {
  const dataHex = bufferHex(msg?.data);
  const txidCandidates = [dataHex, reverseHexBytes(dataHex)]
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid));
  return {
    code: msg?.ccode ?? msg?.code ?? null,
    reason: msg?.reason == null ? '' : String(msg.reason),
    message: msg?.message == null ? '' : String(msg.message),
    dataTxid: txidCandidates[0] || '',
    dataTxidCandidates: Array.from(new Set(txidCandidates)),
  };
}

function createBroadcastRejectWatcher(peer, node, txids = []) {
  const wanted = new Set((Array.isArray(txids) ? txids : [])
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid)));
  const rejects = [];
  const handler = (msg) => {
    const normalized = normalizeRejectMessage(msg);
    const dataTxids = Array.isArray(normalized.dataTxidCandidates) ? normalized.dataTxidCandidates : [];
    const matched = !wanted.size || dataTxids.some((txid) => wanted.has(String(txid || '').toLowerCase()));
    if (!matched) {
      if (wanted.size > 0) {
        rejects.push({
          ...normalized,
          assumedMatch: true,
        });
        appendSendLog('broadcast_reject_assumed_match', {
          node,
          txids: Array.from(wanted).slice(0, 16),
          code: normalized.code,
          reason: normalized.reason,
          message: normalized.message,
          dataTxid: normalized.dataTxid,
        });
        return;
      }
      appendSendLog('broadcast_reject_ignored', {
        node,
        txids: Array.from(wanted).slice(0, 16),
        code: normalized.code,
        reason: normalized.reason,
        message: normalized.message,
        dataTxid: normalized.dataTxid,
      });
      return;
    }
    rejects.push(normalized);
    appendSendLog('broadcast_reject', {
      node,
      txids: Array.from(wanted).slice(0, 16),
      code: normalized.code,
      reason: normalized.reason,
      message: normalized.message,
      dataTxid: normalized.dataTxid,
    });
  };
  if (peer && typeof peer.on === 'function') peer.on('reject', handler);
  return {
    assertClear() {
      if (!rejects.length) return;
      const first = rejects[0];
      const err = new Error(`SPV peer rejected transaction: code=${first.code ?? ''} reason=${first.reason || ''} message=${first.message || ''}`.trim());
      err.code = 'SPV_PEER_REJECTED_TX';
      err.reject = first;
      err.rejects = rejects.slice();
      throw err;
    },
    async wait(ms) {
      await sleep(Math.max(0, Number(ms || 0)));
      this.assertClear();
    },
    close() {
      if (peer && typeof peer.removeListener === 'function') {
        try { peer.removeListener('reject', handler); } catch (_) {}
      }
    },
  };
}

function isTransientBroadcastNodeFailure(reason = '') {
  const text = String(reason || '').toLowerCase();
  return text.includes('timeout')
    || text.includes('econnrefused')
    || text.includes('ehostunreach')
    || text.includes('enetunreach')
    || text.includes('not connected')
    || text.includes('disconnected')
    || text.includes('no node lease available')
    || text.includes('socket hang up');
}

async function waitForFirstPositiveBroadcastEvidence(tasks = []) {
  const pending = (Array.isArray(tasks) ? tasks : []).map((task) => {
    const entry = { wrapped: null };
    entry.wrapped = Promise.resolve(task)
      .then((value) => ({ entry, ok: true, value }))
      .catch((error) => ({ entry, ok: false, error }));
    return entry;
  });
  const settled = [];
  while (pending.length) {
    const next = await Promise.race(pending.map((row) => row.wrapped));
    const pendingIndex = pending.findIndex((row) => row === next.entry);
    if (pendingIndex >= 0) pending.splice(pendingIndex, 1);
    settled.push(next);
    if (next.ok && next.value?.positive === true) {
      return { firstPositive: next.value, settled };
    }
  }
  return { firstPositive: null, settled };
}

function broadcastTxWithGetDataTrace(peer, node, item, broadcastTimeoutMs) {
  const txid = String(item?.txid || txidFromRaw(item?.rawtx || '') || '').trim().toLowerCase();
  const txBuf = Buffer.from(item.rawtx, 'hex');
  const wanted = new Set([txid, reverseHexBytes(txid)].filter((value) => /^[0-9a-f]{64}$/i.test(value)));
  return new Promise((resolve, reject) => {
    let settled = false;
    let sawAnyGetData = false;
    let timer = null;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      try { peer.removeListener('getdata', onGetData); } catch (_) {}
      try { peer.removeListener('error', onError); } catch (_) {}
      try { peer.removeListener('disconnect', onDisconnect); } catch (_) {}
      try { peer.removeListener('close', onDisconnect); } catch (_) {}
    };
    const finish = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };
    const finishAfterTxWrite = () => {
      if (settled) return;
      setTimeout(() => finish(null), SEND_TX_SETTLE_MS);
    };
    const onGetData = (msg) => {
      const txs = Array.isArray(msg?.txs) ? msg.txs : [];
      const hashes = txs.map((hash) => bufferHex(hash)).filter(Boolean);
      if (!hashes.length) return;
      sawAnyGetData = true;
      const matched = hashes.some((hash) => wanted.has(hash) || wanted.has(reverseHexBytes(hash)));
      appendSendLog(matched ? 'broadcast_getdata_match' : 'broadcast_getdata_other', {
        node,
        txid,
        requestedTxCount: hashes.length,
        requestedTxids: hashes.slice(0, 8),
      });
      if (!matched) return;
      try {
        peer.sendMessage('tx', txBuf);
        finishAfterTxWrite();
      } catch (err) {
        finish(err);
      }
    };
    const onError = (err) => finish(err instanceof Error ? err : new Error(String(err || 'peer error')));
    const onDisconnect = () => finish(new Error('disconnected'));
    try {
      peer.on('getdata', onGetData);
      peer.on('error', onError);
      peer.on('disconnect', onDisconnect);
      peer.on('close', onDisconnect);
      timer = setTimeout(() => {
        appendSendLog('broadcast_getdata_timeout', { node, txid, sawAnyGetData });
        finish(new Error(`SPV broadcast timeout: ${node}`));
      }, Math.max(1000, Number(broadcastTimeoutMs || SEND_BROADCAST_TIMEOUT_MS)));
      peer.broadcastTx(txBuf).then(() => finishAfterTxWrite()).catch((err) => finish(err));
    } catch (err) {
      finish(err);
    }
  });
}

async function sendBroadcastPackageToPeer(peer, node, packageResult, broadcastTimeoutMs) {
  let delivery = 'inv-getdata';
  const watcher = createBroadcastRejectWatcher(peer, node, packageResult.items.map((item) => item.txid));
  try {
    for (let i = 0; i < packageResult.items.length; i += 1) {
      const item = packageResult.items[i];
      const isLastItem = i === packageResult.items.length - 1;
      const txBuf = Buffer.from(item.rawtx, 'hex');
      let itemDelivery = 'inv-getdata';
      try {
        await broadcastTxWithGetDataTrace(peer, node, item, broadcastTimeoutMs);
        await watcher.wait(isLastItem ? 500 : 900);
      } catch (err) {
        watcher.assertClear();
        appendSendLog('broadcast_inv_getdata_failed', {
          node,
          txid: String(item?.txid || ''),
          error: String(err?.message || err || 'inv/getdata broadcast failed'),
        });
        throw err;
      }
      watcher.assertClear();
      delivery = itemDelivery;
    }
    await watcher.wait(500);
    return delivery;
  } finally {
    watcher.close();
  }
}

async function probeTxidOnPeer(peer, node, txid, { timeoutMs = SEND_NODE_MEMPOOL_PROBE_TIMEOUT_MS } = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!peer || typeof peer.on !== 'function' || !/^[0-9a-f]{64}$/i.test(safeTxid)) {
    return { ok: false, node: String(node || ''), txid: safeTxid, reason: 'invalid_probe_request' };
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { peer.removeListener('transactions', onTransactions); } catch (_) {}
      try { peer.removeListener('notfound', onNotFound); } catch (_) {}
      try { peer.removeListener('disconnected', onDisconnected); } catch (_) {}
      try { peer.removeListener('error_socket', onSocketError); } catch (_) {}
      resolve({
        ok: Boolean(result?.ok),
        node: String(node || ''),
        txid: safeTxid,
        reason: String(result?.reason || ''),
        via: String(result?.via || ''),
      });
    };
    const onTransactions = ({ transactions, header }) => {
      for (const [, txLike] of (transactions || [])) {
        const observedTx = txFromUnknown(txLike);
        const observedTxid = String(observedTx?.id || '').trim().toLowerCase();
        if (observedTxid !== safeTxid) continue;
        rememberSpvTxObservation(safeTxid, {
          relevant: true,
          confirmedSeen: Boolean(header),
          node,
        });
        finish({ ok: true, via: header ? 'confirmed_tx_reply' : 'mempool_tx_reply' });
        return;
      }
    };
    const onNotFound = (payload) => {
      const txs = Array.isArray(payload?.txs) ? payload.txs : [];
      const found = txs.some((hash) => String(Buffer.isBuffer(hash) ? hash.toString('hex') : hash || '').trim().toLowerCase() === safeTxid);
      if (found) finish({ ok: false, reason: 'notfound' });
    };
    const onDisconnected = () => finish({ ok: false, reason: 'disconnected' });
    const onSocketError = ({ error }) => finish({ ok: false, reason: String(error?.message || error || 'socket_error') });
    peer.on('transactions', onTransactions);
    peer.on('notfound', onNotFound);
    peer.on('disconnected', onDisconnected);
    peer.on('error_socket', onSocketError);
    timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), Math.max(250, Number(timeoutMs || 0)));
    try {
      peer.getTxs([safeTxid]);
    } catch (err) {
      finish({ ok: false, reason: String(err?.message || err || 'probe_send_failed') });
    }
  });
}

async function probeTxidOnNode(node, txid, {
  connectTimeoutMs = SEND_CONNECT_TIMEOUT_MS,
  timeoutMs = SEND_NODE_MEMPOOL_PROBE_TIMEOUT_MS,
} = {}) {
  const safeNode = String(node || '').trim();
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!safeNode || !/^[0-9a-f]{64}$/i.test(safeTxid)) {
    return { ok: false, node: safeNode, txid: safeTxid, reason: 'invalid_probe_request' };
  }
  const existingPeer = spvRuntime.peers.get(safeNode);
  if (existingPeer?.connected) {
    return probeTxidOnPeer(existingPeer, safeNode, safeTxid, { timeoutMs });
  }
  let session = null;
  try {
    session = await p2pNodeRuntime.connectSession(getWalletP2PNodeSelector(), {
      node: safeNode,
      purpose: 'broadcast_probe',
      mode: 'fresh',
      connectTimeoutMs,
    });
    return await probeTxidOnPeer(session.peer, safeNode, safeTxid, { timeoutMs });
  } catch (err) {
    return {
      ok: false,
      node: safeNode,
      txid: safeTxid,
      reason: String(err?.message || err || 'probe_failed'),
    };
  } finally {
    await Promise.resolve(session?.release?.({ outcome: 'broadcast_probe_done' })).catch(() => {});
  }
}

async function probeTxidOnBroadcastNodes(txid, nodes, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  const uniqueNodes = Array.from(new Set((Array.isArray(nodes) ? nodes : [])
    .map((node) => String(node || '').trim())
    .filter(Boolean)));
  if (!/^[0-9a-f]{64}$/i.test(safeTxid) || !uniqueNodes.length) {
    return { ok: false, txid: safeTxid, hits: [], misses: [], errors: [] };
  }
  const delayMs = Math.max(0, Number(options.delayMs ?? SEND_NODE_MEMPOOL_PROBE_DELAY_MS));
  if (delayMs > 0) await sleep(delayMs);
  const results = await Promise.all(uniqueNodes.map((node) => (
    // Probe the exact nodes that accepted the broadcast. A returned tx is
    // stronger evidence than a fire-and-forget send acknowledgement.
    probeTxidOnNode(node, safeTxid, options)
  )));
  const hits = results.filter((row) => row?.ok);
  return {
    ok: hits.length > 0,
    txid: safeTxid,
    hits,
    misses: results.filter((row) => row && row.ok !== true && row.reason === 'notfound'),
    errors: results.filter((row) => row && row.ok !== true && row.reason !== 'notfound'),
  };
}

function mergeProbeBucket(existing = [], incoming = [], keyBuilder = (row) => `${String(row?.node || '')}:${String(row?.via || row?.reason || '')}`) {
  const merged = new Map();
  for (const row of Array.isArray(existing) ? existing : []) {
    merged.set(keyBuilder(row), row);
  }
  for (const row of Array.isArray(incoming) ? incoming : []) {
    merged.set(keyBuilder(row), row);
  }
  return Array.from(merged.values());
}

async function waitForBroadcastEvidence(txid, nodes, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  const totalTimeoutMs = Math.max(250, Number(options.totalTimeoutMs || SEND_BROADCAST_EVIDENCE_TIMEOUT_MS));
  const intervalMs = Math.max(250, Number(options.intervalMs || SEND_NODE_MEMPOOL_PROBE_INTERVAL_MS));
  const probeTimeoutMs = Math.max(250, Number(options.probeTimeoutMs || SEND_NODE_MEMPOOL_PROBE_TIMEOUT_MS));
  const connectTimeoutMs = Math.max(250, Number(options.connectTimeoutMs || SEND_CONNECT_TIMEOUT_MS));
  const requiredProbeHitCount = Math.max(1, Number(options.requiredProbeHitCount || 1));
  const deadline = Date.now() + totalTimeoutMs;
  let rounds = 0;
  let observed = getSpvTxObservation(safeTxid) || getSpvTxObservationFromIndex(safeTxid);
  let firstPositive = observed
    ? {
      positive: true,
      source: observed.node === 'spv_index' ? 'spv_index' : 'spv_observation',
      observed,
    }
    : null;
  let aggregateProbe = { ok: false, txid: safeTxid, hits: [], misses: [], errors: [] };

  while (!firstPositive && Date.now() < deadline) {
    rounds += 1;
    const remainingMs = Math.max(0, deadline - Date.now());
    const roundWindowMs = Math.min(intervalMs, remainingMs);
    if (roundWindowMs <= 0) break;
    const evidence = await waitForFirstPositiveBroadcastEvidence([
      (async () => {
        const row = await waitForSpvTxObservation(safeTxid, roundWindowMs);
        return {
          positive: Boolean(row),
          source: row?.node === 'spv_index' ? 'spv_index' : 'spv_observation',
          observed: row || null,
        };
      })(),
      (async () => {
        const result = await probeTxidOnBroadcastNodes(safeTxid, nodes, {
          delayMs: 0,
          timeoutMs: Math.min(probeTimeoutMs, roundWindowMs),
          connectTimeoutMs,
        });
        const firstHit = Array.isArray(result?.hits) ? result.hits[0] : null;
        const hitCount = Array.isArray(result?.hits) ? result.hits.length : 0;
        return {
          positive: Boolean(result?.ok) && hitCount >= requiredProbeHitCount,
          source: 'node_probe',
          observed: result?.ok ? {
            relevant: true,
            confirmedSeen: false,
            seenAt: Date.now(),
            node: String(firstHit?.node || ''),
          } : null,
          probe: result,
        };
      })(),
    ]);
    const settledValues = Array.isArray(evidence?.settled)
      ? evidence.settled.filter((row) => row?.ok).map((row) => row.value)
      : [];
    const settledObservation = settledValues.find((row) => row?.source === 'spv_observation' || row?.source === 'spv_index')?.observed || null;
    const settledProbe = settledValues.find((row) => row?.source === 'node_probe')?.probe || null;
    if (settledObservation) observed = settledObservation;
    if (settledProbe) {
      aggregateProbe = {
        ok: aggregateProbe.ok || Boolean(settledProbe.ok),
        txid: safeTxid,
        hits: mergeProbeBucket(aggregateProbe.hits, settledProbe.hits, (row) => String(row?.node || '')),
        misses: mergeProbeBucket(aggregateProbe.misses, settledProbe.misses, (row) => String(row?.node || '')),
        errors: mergeProbeBucket(aggregateProbe.errors, settledProbe.errors, (row) => `${String(row?.node || '')}:${String(row?.reason || '')}`),
      };
    }
    if (evidence?.firstPositive?.positive === true) {
      firstPositive = evidence.firstPositive;
      if (firstPositive?.observed) observed = firstPositive.observed;
    }
  }

  return {
    firstPositive,
    observed,
    probe: aggregateProbe,
    rounds,
    timedOut: !firstPositive,
  };
}

async function broadcastRawTxViaNode(rawtx, node, { connectTimeoutMs = SPV_CONNECT_TIMEOUT_MS, broadcastTimeoutMs = SPV_BROADCAST_TIMEOUT_MS } = {}) {
  const existingPeer = spvRuntime.peers.get(node);
  if (existingPeer?.connected) {
    return broadcastRawTxViaConnectedPeer(rawtx, node, { broadcastTimeoutMs });
  }
  let session = null;
  try {
    session = await p2pNodeRuntime.connectSession(getWalletP2PNodeSelector(), {
      node,
      purpose: 'broadcast',
      mode: 'fresh',
      connectTimeoutMs,
    });
    const peer = session.peer;
    const startedAt = Date.now();
    const packageResult = await ensureLocalBroadcastContextReady(rawtx);
    const delivery = await sendBroadcastPackageToPeer(peer, node, packageResult, broadcastTimeoutMs);
    spvRuntime.lastGoodNode = node;
    recordSpvBroadcastResult(node, { ok: true, latencyMs: Date.now() - startedAt });
    await session.reportSuccess({ latencyMs: Date.now() - startedAt, purpose: 'broadcast' });
    return {
      node,
      delivery,
      elapsedMs: Date.now() - startedAt,
      packageTxCount: packageResult.items.length,
      packageTxids: packageResult.items.map((item) => item.txid),
    };
  } finally {
    await Promise.resolve(session?.release?.({ outcome: 'broadcast_done' })).catch(() => {});
  }
}

async function broadcastRawTxViaConnectedPeer(rawtx, node, { broadcastTimeoutMs = SPV_BROADCAST_TIMEOUT_MS } = {}) {
  const peer = spvRuntime.peers.get(node);
  const session = spvRuntime.sessions.get(node);
  if (!peer || !peer.connected) throw new Error(`Not connected: ${node}`);
  const startedAt = Date.now();
  const packageResult = await ensureLocalBroadcastContextReady(rawtx);
  const delivery = await sendBroadcastPackageToPeer(peer, node, packageResult, broadcastTimeoutMs);
  spvRuntime.lastGoodNode = node;
  recordSpvNodeSuccess(node);
  recordSpvBroadcastResult(node, { ok: true, latencyMs: Date.now() - startedAt });
  await Promise.resolve(session?.reportSuccess?.({ latencyMs: Date.now() - startedAt, purpose: 'broadcast' })).catch(() => {});
  return {
    node,
    delivery,
    elapsedMs: Date.now() - startedAt,
    packageTxCount: packageResult.items.length,
    packageTxids: packageResult.items.map((item) => item.txid),
  };
}

function getPreferredBroadcastNodes() {
  const state = loadSpvNodeState();
  const now = Date.now();
  const rowsByEndpoint = new Map((state.nodes || []).map((n) => [n.endpoint, n]));
  const syncActiveSet = new Set(
    Array.from(walletNodeManagerRuntime.activeSyncLeases.values())
      .map((row) => String(row?.node || '').trim())
      .filter(Boolean),
  );
  const connected = Array.from(spvRuntime.peers.keys())
    .filter((endpoint) => {
      const peer = spvRuntime.peers.get(endpoint);
      return peer && peer.connected && !syncActiveSet.has(endpoint);
    })
    .sort((a, b) => sortBroadcastNodeRows(
      rowsByEndpoint.get(a) || newNodeRow(a, 'runtime'),
      rowsByEndpoint.get(b) || newNodeRow(b, 'runtime'),
    ));
  const connectedSet = new Set(connected);
  const fallbackRows = (state.nodes || [])
    .filter((n) => !connectedSet.has(n.endpoint))
    .filter((n) => !syncActiveSet.has(String(n.endpoint || '').trim()))
    .filter((n) => !Number(n.banUntil || 0) || Number(n.banUntil || 0) <= now)
    .sort(sortBroadcastNodeRows);
  let fallback = fallbackRows
    .filter((n) => isPreferredBroadcastCandidate(n, now))
    .map((n) => n.endpoint);
  if (fallback.length < SEND_MAX_NODE_TRIES) {
    fallback = Array.from(new Set([
      ...fallback,
      ...fallbackRows.map((n) => n.endpoint),
    ]));
  }
  if (!fallback.length) {
    fallback = loadSpvNodes().filter((n) => !connectedSet.has(n) && !syncActiveSet.has(String(n || '').trim()));
  }
  const preferred = PREFERRED_BROADCAST_NODES
    .filter((node) => !syncActiveSet.has(String(node || '').trim()));
  const prioritySet = new Set(preferred);
  return {
    priority: Array.from(new Set(preferred)).slice(0, SEND_MAX_NODE_TRIES),
    connected: connected.filter((node) => !prioritySet.has(node)).slice(0, SEND_CONNECTED_PEER_TRIES),
    fallback: Array.from(new Set(fallback.filter((node) => !prioritySet.has(node)))).slice(0, SEND_MAX_NODE_TRIES),
  };
}

async function broadcastRawTxViaWoc(rawtx, options = {}) {
  const hex = String(rawtx || '').trim();
  const txid = txidFromRaw(hex);
  const url = `${WOC_BASE}/tx/raw`;
  let responseData = null;
  await wocRateLimitWait({ ...options, allowDisabled: true });
  try {
    const res = await axios.post(url, { txhex: hex }, {
      timeout: WOC_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json' },
    });
    responseData = res?.data ?? null;
  } catch (err) {
    const status = err?.response?.status || null;
    const data = err?.response?.data ?? null;
    const message = typeof data === 'string'
      ? data
      : (data && typeof data === 'object' ? JSON.stringify(data).slice(0, 500) : String(err?.message || 'WOC broadcast failed'));
    const normalized = message.toLowerCase();
    if (!(status === 400 && (normalized.includes('already') || normalized.includes('txn-already') || normalized.includes('known transaction')))) {
      appendSendLog('broadcast_woc_fail', { txid, status, error: message.slice(0, 500) });
      throw err;
    }
    responseData = data;
  }
  const visible = await isTxVisibleOnPublicIndex(txid, { allowDisabled: true }).catch(() => false);
  appendSendLog('broadcast_woc_done', {
    txid,
    visible,
    responseType: Array.isArray(responseData) ? 'array' : typeof responseData,
    response: typeof responseData === 'string' ? responseData.slice(0, 300) : '',
  });
  return {
    txid,
    provider: 'woc',
    node: 'whatsonchain',
    visible,
    responseData,
  };
}

async function broadcastRawTx(rawtx, options = {}) {
  assertWalletSendAllowed('broadcast');
  const requireExternalVisibility = options?.requireVisibility === true || options?.requireExternalVisibility === true;
  const allowPendingVisibilityCommit = options?.allowPendingVisibilityCommit === true;
  const allowWocBroadcastFallback = options?.allowWocBroadcastFallback === true || options?.allowWocFallback === true;
  if (!spvRuntime.peers.size && !spvRuntime.connectingNodes.size) {
    startSpvListener();
  }
  const txid = txidFromRaw(rawtx);
  const policyValidation = validateRawTxPolicy(rawtx, {
    minStandardOutputSat: SAFE_MIN_CHANGE_SAT,
    minDataOutputSat: Number.isFinite(Number(options.minDataOutputSat))
      ? Math.max(0, Number(options.minDataOutputSat))
      : ANCHOR_DATA_OUTPUT_SAT,
    allowP2shOutputs: options.allowP2shOutputs === true,
    allowedP2shVouts: Array.isArray(options.allowedP2shVouts) ? options.allowedP2shVouts : [],
  });
  let spendValidation;
  try {
    spendValidation = validateLocalRawTxSpend(rawtx, {
      minFeeRate: DEFAULT_FEE_RATE,
      allowMissingExternalInputs: options.allowMissingExternalInputs === true,
    });
  } catch (err) {
    appendSendLog('broadcast_local_validation_failed', {
      txid,
      code: String(err?.code || ''),
      error: String(err?.message || err || 'local spend validation failed'),
      inputs: Array.isArray(err?.inputs) ? err.inputs.slice(0, 16) : [],
    });
    throw err;
  }
  let packageResult;
  try {
    packageResult = await ensureLocalBroadcastContextReady(rawtx, {
      allowMissingExternalInputs: options.allowMissingExternalInputs === true,
      rootOnlyBroadcast: options.rootOnlyBroadcast === true,
      rootOnlyReason: String(options.rootOnlyReason || ''),
    });
  } catch (err) {
    appendSendLog('broadcast_context_failed', {
      txid,
      code: String(err?.code || ''),
      error: String(err?.message || err || 'local broadcast context failed'),
      missingAncestors: Array.isArray(err?.missingAncestors) ? err.missingAncestors.slice(0, 24) : [],
    });
    throw err;
  }
  appendSendLog('broadcast_local_validation_ok', {
    txid,
    feeSat: Number(spendValidation.feeSat || 0),
    feePerByte: Number(spendValidation.feePerByte || 0),
    sizeBytes: Number(spendValidation.sizeBytes || 0),
    inputCount: Number(spendValidation.inputCount || 0),
    outputCount: Number(policyValidation.outputCount || 0),
    dataOutputCount: Number(policyValidation.dataOutputCount || 0),
    smallestDataOutputSat: policyValidation.smallestDataOutputSat,
    smallestStandardOutputSat: policyValidation.smallestStandardOutputSat,
    missingConfirmedProofCount: Number(spendValidation.missingProofCount || 0),
    missingInputCount: Number(spendValidation.missingInputCount || 0),
    externalInputValidationSkipped: Boolean(spendValidation.externalInputValidationSkipped),
  });
  const plan = getPreferredBroadcastNodes();
  const tries = Array.from(new Set([...(plan.priority || []), ...plan.connected, ...plan.fallback])).slice(0, SEND_MAX_NODE_TRIES);
  if (!tries.length) throw new Error('No SPV nodes configured');
  appendSendLog('broadcast_start', {
    txid,
    tries,
    priorityTries: Array.isArray(plan.priority) ? plan.priority : [],
    connectedTries: plan.connected,
    fallbackTries: plan.fallback.slice(0, Math.max(0, SEND_MAX_NODE_TRIES - plan.connected.length)),
    mode: 'observed_dynamic_waves',
    initialNodeTries: SEND_INITIAL_NODE_TRIES,
    retryWaveNodeTries: SEND_RETRY_WAVE_NODE_TRIES,
    observationWaitMs: SEND_OBSERVATION_WAIT_MS,
    evidenceTimeoutMs: SEND_BROADCAST_EVIDENCE_TIMEOUT_MS,
    probeIntervalMs: SEND_NODE_MEMPOOL_PROBE_INTERVAL_MS,
  });
  appendSendLog('broadcast_context_ready', {
    txid,
    contextFormat: String(packageResult.format || ''),
    beefFormat: 'local-chain',
    packageTxCount: packageResult.items.length,
    ancestorTxCount: Math.max(0, packageResult.items.length - 1),
    ancestorWithRawtxCount: Array.isArray(packageResult.ancestors) ? packageResult.ancestors.length : 0,
    bumpHintCount: 0,
    missingAncestorCount: Array.isArray(packageResult.missingAncestors) ? packageResult.missingAncestors.length : 0,
    beefTxCount: packageResult.items.length,
    beefComplete: Boolean(packageResult.complete),
    confirmedInputProofMissingCount: Number(spendValidation.missingProofCount || 0),
    packageTxids: packageResult.items.map((item) => item.txid),
  });
  const successes = [];
  const errors = [];
  const mempoolProofHits = new Map();
  const minSuccessNodes = packageResult.items.length > 1 ? 1 : SEND_MIN_SUCCESS_NODES;
  const minObservationNodes = 1;
  async function runPhase(nodes, sender, options = {}) {
    if (!nodes.length) return;
    const stopAfterMinSuccess = options.stopAfterMinSuccess === true;
    const successBefore = successes.length;
    const errorBefore = errors.length;
    const phase = String(options.phase || (sender === broadcastRawTxViaConnectedPeer ? 'connected' : 'fallback'));
    appendSendLog('broadcast_phase_start', {
      txid,
      nodes,
      phase,
    });
    function recordFailure(node, reason, late = false) {
      const message = reason?.message || 'broadcast failed';
      recordSpvBroadcastResult(node, { ok: false, reason: message });
      appendSendLog(late ? 'broadcast_late_fail_node' : 'broadcast_fail_node', { txid, node, elapsedMs: null, error: message });
      errors.push(`${node}: ${message}`);
    }
    function recordSuccess(value) {
      successes.push(value);
    }
    function makeAttempt(node) {
      let wrapped;
      wrapped = (async () => {
        try {
          const result = await sender(rawtx, node);
          appendSendLog('broadcast_ok', {
            txid,
            node,
            elapsedMs: Number(result?.elapsedMs || 0),
            delivery: String(result?.delivery || 'unknown'),
            packageTxCount: Number(result?.packageTxCount || 1),
            packageTxids: Array.isArray(result?.packageTxids) ? result.packageTxids.slice(0, 16) : [],
          });
          return {
            wrapped,
            status: 'fulfilled',
            value: {
              node,
              elapsedMs: Number(result?.elapsedMs || 0),
              delivery: String(result?.delivery || 'unknown'),
            },
          };
        } catch (reason) {
          return { wrapped, status: 'rejected', node, reason };
        }
      })();
      return wrapped;
    }
    const pending = new Set(nodes.map(makeAttempt));
    while (pending.size) {
      const result = await Promise.race(Array.from(pending));
      pending.delete(result.wrapped);
      if (result.status === 'fulfilled') {
        recordSuccess(result.value);
      } else {
        recordFailure(result.node, result.reason);
      }
      if (stopAfterMinSuccess && successes.length >= minSuccessNodes) {
        for (const pendingAttempt of pending) {
          pendingAttempt.then((lateResult) => {
            if (lateResult.status === 'rejected') recordFailure(lateResult.node, lateResult.reason, true);
          }).catch(() => {});
        }
        break;
      }
    }
    appendSendLog('broadcast_phase_done', {
      txid,
      nodes,
      phase,
      phaseSuccessCount: successes.length - successBefore,
      phaseErrorCount: errors.length - errorBefore,
      pendingCount: pending.size,
      stoppedAfterMinSuccess: stopAfterMinSuccess && successes.length >= minSuccessNodes,
      cumulativeSuccessCount: successes.length,
      cumulativeErrorCount: errors.length,
    });
  }

  let observed = getSpvTxObservation(txid);
  const connectedSet = new Set(plan.connected);
  const sendToNode = (hex, node) => (
    connectedSet.has(node)
      ? broadcastRawTxViaConnectedPeer(hex, node, { broadcastTimeoutMs: SEND_BROADCAST_TIMEOUT_MS })
      : broadcastRawTxViaNode(hex, node, {
        connectTimeoutMs: SEND_CONNECT_TIMEOUT_MS,
        broadcastTimeoutMs: SEND_BROADCAST_TIMEOUT_MS,
      })
  );
  let cursor = 0;
  let wave = 0;
  const evidenceDeadline = Date.now() + SEND_BROADCAST_EVIDENCE_TIMEOUT_MS;
  const getHandshakeSuccessCount = () => successes.filter((item) => item.delivery === 'inv-getdata').length;
  const hasEnoughBroadcastEvidence = () => {
    const observedNode = String(observed?.node || '').trim();
    const externalObservation = Boolean(observed)
      && (
        Boolean(observed?.confirmedSeen)
        || (observedNode && observedNode !== 'spv_index')
      );
    return (
      (!requireExternalVisibility && getHandshakeSuccessCount() >= minSuccessNodes)
      || mempoolProofHits.size >= minObservationNodes
      || (externalObservation && successes.length >= 1)
    );
  };
  const getProbeNodes = () => Array.from(new Set(successes.map((item) => String(item?.node || '').trim()).filter(Boolean)));
  async function runEvidenceRound(roundLabel = '') {
    const probeNodes = getProbeNodes();
    if (!probeNodes.length) return null;
    const immediateObserved = getSpvTxObservation(txid) || getSpvTxObservationFromIndex(txid);
    const immediateObservedNode = String(immediateObserved?.node || '').trim();
    const immediateObservedIsExternal = Boolean(immediateObserved)
      && (
        Boolean(immediateObserved?.confirmedSeen)
        || (immediateObservedNode && immediateObservedNode !== 'spv_index')
      );
    if (immediateObservedIsExternal) {
      observed = immediateObserved;
      appendSendLog('broadcast_node_probe_done', {
        txid,
        wave,
        attemptedNodes: probeNodes,
        probeRounds: 0,
        roundLabel: String(roundLabel || ''),
        hitCount: 0,
        hitNodes: [],
        missCount: 0,
        missNodes: [],
        errorCount: 0,
        errorNodes: [],
        firstPositiveSource: immediateObserved.node === 'spv_index' ? 'spv_index' : 'spv_observation',
      });
      appendSendLog('broadcast_observation_wait_done', {
        txid,
        wave,
        observed: true,
        relevant: Boolean(immediateObserved?.relevant),
        confirmedSeen: Boolean(immediateObserved?.confirmedSeen),
        node: String(immediateObserved?.node || ''),
        roundLabel: String(roundLabel || ''),
      });
      return {
        rounds: 0,
        observed: immediateObserved,
        probe: { ok: false, txid, hits: [], misses: [], errors: [] },
        firstPositive: {
          positive: true,
          source: immediateObserved.node === 'spv_index' ? 'spv_index' : 'spv_observation',
          observed: immediateObserved,
        },
      };
    }
    const remainingMs = Math.max(0, evidenceDeadline - Date.now());
    const roundTimeoutMs = Math.min(SEND_NODE_MEMPOOL_PROBE_INTERVAL_MS, remainingMs);
    if (roundTimeoutMs <= 0) return null;
    appendSendLog('broadcast_node_probe_done', {
      txid,
      wave,
      attemptedNodes: probeNodes,
      status: 'started',
      roundLabel: String(roundLabel || ''),
    });
    appendSendLog('broadcast_observation_wait_start', {
      txid,
      wave,
      timeoutMs: roundTimeoutMs,
      successCount: successes.length,
      roundLabel: String(roundLabel || ''),
    });
    const evidence = await waitForBroadcastEvidence(txid, probeNodes, {
      totalTimeoutMs: roundTimeoutMs,
      intervalMs: SEND_NODE_MEMPOOL_PROBE_INTERVAL_MS,
      probeTimeoutMs: SEND_NODE_MEMPOOL_PROBE_TIMEOUT_MS,
      connectTimeoutMs: SEND_CONNECT_TIMEOUT_MS,
      requiredProbeHitCount: minObservationNodes,
    });
    const finalProbe = evidence?.probe || null;
    const firstPositive = evidence?.firstPositive || null;
    for (const hit of (Array.isArray(finalProbe?.hits) ? finalProbe.hits : [])) {
      const hitNode = String(hit?.node || '').trim();
      if (hitNode) mempoolProofHits.set(hitNode, hit);
    }
    observed = firstPositive?.source === 'node_probe' ? observed : (evidence?.observed || observed);
    appendSendLog('broadcast_node_probe_done', {
      txid,
      wave,
      attemptedNodes: probeNodes,
      probeRounds: Number(evidence?.rounds || 0),
      roundLabel: String(roundLabel || ''),
      hitCount: Array.isArray(finalProbe?.hits) ? finalProbe.hits.length : 0,
      hitNodes: Array.isArray(finalProbe?.hits) ? finalProbe.hits.map((row) => ({
        node: row.node,
        via: row.via,
      })) : [],
      missCount: Array.isArray(finalProbe?.misses) ? finalProbe.misses.length : 0,
      missNodes: Array.isArray(finalProbe?.misses) ? finalProbe.misses.map((row) => row.node) : [],
      errorCount: Array.isArray(finalProbe?.errors) ? finalProbe.errors.length : 0,
      errorNodes: Array.isArray(finalProbe?.errors) ? finalProbe.errors.map((row) => ({
        node: row.node,
        reason: row.reason,
      })) : [],
      firstPositiveSource: String(firstPositive?.source || ''),
      mempoolProofHitCount: mempoolProofHits.size,
      mempoolProofNodes: Array.from(mempoolProofHits.keys()),
      requiredMempoolProofHitCount: minObservationNodes,
    });
    appendSendLog('broadcast_observation_wait_done', {
      txid,
      wave,
      observed: Boolean(observed),
      relevant: Boolean(observed?.relevant),
      confirmedSeen: Boolean(observed?.confirmedSeen),
      node: String(observed?.node || ''),
      roundLabel: String(roundLabel || ''),
    });
    return evidence;
  }
  let wocFallbackError = '';
  async function tryWocBroadcastFallback(reason = '') {
    if (!allowWocBroadcastFallback || !ALLOW_WOC_HTTP) return null;
    try {
      const wocBroadcast = await broadcastRawTxViaWoc(rawtx);
      if (wocBroadcast?.visible) {
        rememberSpvTxObservation(txid, {
          relevant: true,
          confirmedSeen: false,
          node: 'whatsonchain',
        });
        appendSendLog('broadcast_woc_fallback_accepted', {
          txid,
          spvSuccessCount: successes.length,
          attemptedCount: tries.length,
          reason: String(reason || (successes.length >= 1 ? 'spv_no_visibility' : 'spv_all_failed')),
        });
        return {
          txid,
          provider: successes.length >= 1 ? 'woc+spv-p2p' : 'woc',
          node: 'whatsonchain',
          nodes: successes.map((x) => x.node),
          successCount: successes.length,
          attemptedCount: tries.length,
          contextFormat: String(packageResult.format || ''),
          beefFormat: 'local-chain',
          packageTxCount: packageResult.items.length,
          beefComplete: Boolean(packageResult.complete),
          observed: true,
          observedRelevant: true,
          observedConfirmed: false,
          observedNode: 'whatsonchain',
          mempoolProofHitCount: Math.max(1, mempoolProofHits.size),
          mempoolProofNodes: Array.from(new Set(['whatsonchain', ...mempoolProofHits.keys()])),
          broadcastAcceptedByMempool: true,
        };
      }
      return null;
    } catch (err) {
      wocFallbackError = String(err?.message || err || 'WOC fallback failed').slice(0, 500);
      appendSendLog('broadcast_woc_fallback_failed', {
        txid,
        spvSuccessCount: successes.length,
        attemptedCount: tries.length,
        reason: String(reason || ''),
        error: wocFallbackError,
      });
      return null;
    }
  }
  while (cursor < tries.length && !hasEnoughBroadcastEvidence() && Date.now() < evidenceDeadline) {
    const width = wave === 0 ? SEND_INITIAL_NODE_TRIES : SEND_RETRY_WAVE_NODE_TRIES;
    const nodes = tries.slice(cursor, Math.min(tries.length, cursor + width));
    cursor += nodes.length;
    wave += 1;
    await runPhase(nodes, sendToNode, {
      phase: wave === 1 ? 'initial_observed_wave' : 'retry_observed_wave',
      stopAfterMinSuccess: false,
    });
    if (successes.length >= minSuccessNodes) {
      observed = observed || getSpvTxObservation(txid) || getSpvTxObservationFromIndex(txid);
      const handshakeSuccesses = successes.filter((item) => item.delivery === 'inv-getdata');
      const directFallbackSuccesses = successes.filter((item) => item.delivery === 'direct-tx-fallback');
      const hasEvidenceNow = hasEnoughBroadcastEvidence();
      appendSendLog('broadcast_summary', {
        txid,
        successCount: successes.length,
        attemptedCount: tries.length,
        handshakeSuccessCount: handshakeSuccesses.length,
        directFallbackSuccessCount: directFallbackSuccesses.length,
        successNodes: successes.map((item) => ({
          node: item.node,
          delivery: item.delivery,
          elapsedMs: item.elapsedMs,
        })),
        mempoolProofHitCount: mempoolProofHits.size,
        mempoolProofNodes: Array.from(mempoolProofHits.keys()),
        requiredMempoolProofHitCount: minObservationNodes,
        observed: Boolean(observed),
        observedRelevant: Boolean(observed?.relevant),
        observedConfirmed: Boolean(observed?.confirmedSeen),
        observedNode: String(observed?.node || ''),
        errors: errors.slice(0, 8),
        earlyReturn: true,
        reason: hasEvidenceNow ? 'p2p_send_success_with_evidence' : 'p2p_send_success_no_explicit_error',
      });
      if (!hasEvidenceNow) {
        appendSendLog('broadcast_send_success_without_visibility', {
          txid,
          successCount: successes.length,
          attemptedCount: tries.length,
          successNodes: successes.map((item) => ({
            node: item.node,
            delivery: item.delivery,
            elapsedMs: item.elapsedMs,
          })),
          mempoolProofHitCount: mempoolProofHits.size,
          mempoolProofNodes: Array.from(mempoolProofHits.keys()),
          reason: 'accepted_without_waiting_for_visibility',
        });
      }
      if (!requireExternalVisibility && successes.length >= BROADCAST_PENDING_MIN_NODES) {
        const monitorNodes = successes
          .map((item) => String(item?.node || '').trim())
          .filter(Boolean)
          .slice(0, BROADCAST_PENDING_MIN_NODES);
        upsertPendingBroadcastMonitor({
          txid,
          rawtx,
          nodes: monitorNodes,
          source: String(options?.source || 'wallet_broadcast'),
        });
        appendSendLog('broadcast_pending_confirm_return', {
          txid,
          successCount: successes.length,
          requiredSuccessCount: BROADCAST_PENDING_MIN_NODES,
          monitorNodes,
          reason: 'three_node_send_no_explicit_failure',
        });
        return {
          txid,
          provider: 'spv-p2p',
          node: monitorNodes[0] || successes[0]?.node || tries[0],
          nodes: successes.map((x) => x.node),
          monitorNodes,
          successCount: successes.length,
          attemptedCount: tries.length,
          contextFormat: String(packageResult.format || ''),
          beefFormat: 'local-chain',
          packageTxCount: packageResult.items.length,
          beefComplete: Boolean(packageResult.complete),
          observed: Boolean(observed),
          observedRelevant: Boolean(observed?.relevant),
          observedConfirmed: Boolean(observed?.confirmedSeen),
          observedNode: String(observed?.node || ''),
          mempoolProofHitCount: mempoolProofHits.size,
          mempoolProofNodes: Array.from(mempoolProofHits.keys()),
          broadcastAcceptedByMempool: false,
          acceptedWithoutVisibility: true,
          broadcastPendingConfirm: true,
          broadcastStatus: 'broadcast_pending_confirm',
          requireExternalVisibility,
        };
      }
      if (hasEvidenceNow) {
        return {
          txid,
          provider: 'spv-p2p',
          node: (hasEvidenceNow && mempoolProofHits.size > 0 ? Array.from(mempoolProofHits.keys())[0] : '')
            || handshakeSuccesses[0]?.node
            || successes[0]?.node
            || tries[0],
          nodes: successes.map((x) => x.node),
          successCount: successes.length,
          attemptedCount: tries.length,
          contextFormat: String(packageResult.format || ''),
          beefFormat: 'local-chain',
          packageTxCount: packageResult.items.length,
          beefComplete: Boolean(packageResult.complete),
          observed: Boolean(observed),
          observedRelevant: Boolean(observed?.relevant),
          observedConfirmed: Boolean(observed?.confirmedSeen),
          observedNode: String(observed?.node || ''),
          mempoolProofHitCount: mempoolProofHits.size,
          mempoolProofNodes: Array.from(mempoolProofHits.keys()),
          broadcastAcceptedByMempool: true,
          acceptedWithoutVisibility: !hasEvidenceNow,
        };
      }
      const wocFallback = await tryWocBroadcastFallback('spv_send_success_without_visibility');
      if (wocFallback) return wocFallback;
    }
    if (successes.length > 0) {
      await runEvidenceRound(`wave_${wave}`);
    }
  }
  while (!hasEnoughBroadcastEvidence() && successes.length > 0 && Date.now() < evidenceDeadline) {
    await runEvidenceRound('post_waves');
  }
  observed = observed || getSpvTxObservation(txid) || getSpvTxObservationFromIndex(txid);
  const observedNode = String(observed?.node || '').trim();
  const externalObserved = Boolean(observed)
    && (
      Boolean(observed?.confirmedSeen)
      || (observedNode && observedNode !== 'spv_index')
    );
  const handshakeSuccesses = successes.filter((item) => item.delivery === 'inv-getdata');
  const directFallbackSuccesses = successes.filter((item) => item.delivery === 'direct-tx-fallback');
  appendSendLog('broadcast_summary', {
    txid,
    successCount: successes.length,
    attemptedCount: tries.length,
    handshakeSuccessCount: handshakeSuccesses.length,
    directFallbackSuccessCount: directFallbackSuccesses.length,
    successNodes: successes.map((item) => ({
      node: item.node,
      delivery: item.delivery,
      elapsedMs: item.elapsedMs,
    })),
    mempoolProofHitCount: mempoolProofHits.size,
    mempoolProofNodes: Array.from(mempoolProofHits.keys()),
    requiredMempoolProofHitCount: minObservationNodes,
    observed: Boolean(observed),
    observedRelevant: Boolean(observed?.relevant),
    observedConfirmed: Boolean(observed?.confirmedSeen),
    observedNode: String(observed?.node || ''),
    errors: errors.slice(0, 8),
  });
  if (handshakeSuccesses.length >= minSuccessNodes && hasEnoughBroadcastEvidence()) {
    return {
      txid,
      provider: 'spv-p2p',
      node: handshakeSuccesses[0]?.node || successes[0]?.node || tries[0],
      nodes: successes.map((x) => x.node),
      successCount: successes.length,
      attemptedCount: tries.length,
      contextFormat: String(packageResult.format || ''),
      beefFormat: 'local-chain',
      packageTxCount: packageResult.items.length,
      beefComplete: Boolean(packageResult.complete),
      observed: Boolean(observed),
      observedRelevant: Boolean(observed?.relevant),
      observedConfirmed: Boolean(observed?.confirmedSeen),
      observedNode: String(observed?.node || ''),
      mempoolProofHitCount: mempoolProofHits.size,
      mempoolProofNodes: Array.from(mempoolProofHits.keys()),
    };
  }
  if (mempoolProofHits.size >= minObservationNodes) {
    return {
      txid,
      provider: 'spv-p2p',
      node: Array.from(mempoolProofHits.keys())[0] || successes[0]?.node || tries[0],
      nodes: successes.map((x) => x.node),
      successCount: successes.length,
      attemptedCount: tries.length,
      contextFormat: String(packageResult.format || ''),
      beefFormat: 'local-chain',
      packageTxCount: packageResult.items.length,
      beefComplete: Boolean(packageResult.complete),
      observed: Boolean(observed),
      observedRelevant: Boolean(observed?.relevant),
      observedConfirmed: Boolean(observed?.confirmedSeen),
      observedNode: String(observed?.node || ''),
      mempoolProofHitCount: mempoolProofHits.size,
      mempoolProofNodes: Array.from(mempoolProofHits.keys()),
      broadcastAcceptedByMempool: true,
    };
  }
  if (externalObserved && observed && successes.length >= 1) {
    return {
      txid,
      provider: 'spv-p2p',
      node: successes[0]?.node || tries[0],
      nodes: successes.map((x) => x.node),
      successCount: successes.length,
      attemptedCount: tries.length,
      contextFormat: String(packageResult.format || ''),
      beefFormat: 'local-chain',
      packageTxCount: packageResult.items.length,
      beefComplete: Boolean(packageResult.complete),
      observed: true,
      observedRelevant: Boolean(observed?.relevant),
      observedConfirmed: Boolean(observed?.confirmedSeen),
      observedNode: String(observed?.node || ''),
      mempoolProofHitCount: mempoolProofHits.size,
      mempoolProofNodes: Array.from(mempoolProofHits.keys()),
    };
  }
  if (requireExternalVisibility || successes.length >= 1) {
    const wocFallback = await tryWocBroadcastFallback(successes.length >= 1 ? 'spv_no_visibility' : 'spv_all_failed');
    if (wocFallback) return wocFallback;
  }
  if (!requireExternalVisibility && successes.length >= BROADCAST_PENDING_MIN_NODES) {
    const monitorNodes = successes
      .map((item) => String(item?.node || '').trim())
      .filter(Boolean)
      .slice(0, BROADCAST_PENDING_MIN_NODES);
    upsertPendingBroadcastMonitor({
      txid,
      rawtx,
      nodes: monitorNodes,
      source: String(options?.source || 'wallet_broadcast'),
    });
    appendSendLog('broadcast_pending_confirm_return', {
      txid,
      successCount: successes.length,
      requiredSuccessCount: BROADCAST_PENDING_MIN_NODES,
      monitorNodes,
      reason: 'three_node_send_no_explicit_failure_after_visibility_wait',
      requireExternalVisibility,
    });
    return {
      txid,
      provider: 'spv-p2p',
      node: monitorNodes[0] || successes[0]?.node || tries[0],
      nodes: successes.map((x) => x.node),
      monitorNodes,
      successCount: successes.length,
      attemptedCount: tries.length,
      contextFormat: String(packageResult.format || ''),
      beefFormat: 'local-chain',
      packageTxCount: packageResult.items.length,
      beefComplete: Boolean(packageResult.complete),
      observed: Boolean(observed),
      observedRelevant: Boolean(observed?.relevant),
      observedConfirmed: Boolean(observed?.confirmedSeen),
      observedNode: String(observed?.node || ''),
      mempoolProofHitCount: mempoolProofHits.size,
      mempoolProofNodes: Array.from(mempoolProofHits.keys()),
      broadcastAcceptedByMempool: false,
      acceptedWithoutVisibility: true,
      broadcastPendingConfirm: true,
      broadcastStatus: 'broadcast_pending_confirm',
      requireExternalVisibility,
    };
  }
  if (requireExternalVisibility && allowPendingVisibilityCommit && successes.length >= 1) {
    const monitorNodes = successes
      .map((item) => String(item?.node || '').trim())
      .filter(Boolean)
      .slice(0, Math.max(1, BROADCAST_PENDING_MIN_NODES));
    upsertPendingBroadcastMonitor({
      txid,
      rawtx,
      nodes: monitorNodes,
      source: String(options?.source || 'wallet_broadcast'),
    });
    appendSendLog('broadcast_pending_visibility_commit_return', {
      txid,
      successCount: successes.length,
      monitorNodes,
      reason: 'external_node_requested_tx_without_local_visibility',
      requireExternalVisibility,
    });
    return {
      txid,
      provider: 'spv-p2p',
      node: monitorNodes[0] || successes[0]?.node || tries[0],
      nodes: successes.map((x) => x.node),
      monitorNodes,
      successCount: successes.length,
      attemptedCount: tries.length,
      contextFormat: String(packageResult.format || ''),
      beefFormat: 'local-chain',
      packageTxCount: packageResult.items.length,
      beefComplete: Boolean(packageResult.complete),
      observed: Boolean(observed),
      observedRelevant: Boolean(observed?.relevant),
      observedConfirmed: Boolean(observed?.confirmedSeen),
      observedNode: String(observed?.node || ''),
      mempoolProofHitCount: mempoolProofHits.size,
      mempoolProofNodes: Array.from(mempoolProofHits.keys()),
      broadcastAcceptedByMempool: false,
      acceptedWithoutVisibility: true,
      broadcastPendingConfirm: true,
      broadcastStatus: 'broadcast_pending_confirm',
      requireExternalVisibility,
    };
  }
  if (successes.length >= 1) {
    appendSendLog('broadcast_accepted_without_visibility', {
      txid,
      successCount: successes.length,
      attemptedCount: tries.length,
      successNodes: successes.map((item) => ({
        node: item.node,
        delivery: item.delivery,
        elapsedMs: item.elapsedMs,
      })),
      mempoolProofHitCount: mempoolProofHits.size,
      mempoolProofNodes: Array.from(mempoolProofHits.keys()),
      errors: errors.slice(0, 8),
      reason: 'p2p_send_success_no_external_visibility_rejected',
    });
  }
  appendSendLog('broadcast_failed', { txid, errors: errors.slice(0, 6) });
  throw new Error(`SPV broadcast failed on ${tries.length} node(s): ${errors.slice(0, 4).join(' | ')}${wocFallbackError ? ` | WOC: ${wocFallbackError}` : ''}`);
}

async function isTxVisibleOnPublicIndex(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return false;
  if (isTxConfirmedInSpvIndex(safeTxid)) return true;
  if (!ALLOW_WOC_HTTP && options.allowDisabled !== true) return false;
  const url = `${WOC_BASE}/tx/hash/${safeTxid}`;
  for (let i = 0; i < 4; i += 1) {
    try {
      await wocRateLimitWait(options);
      const res = await axios.get(url, { timeout: WOC_TIMEOUT_MS });
      if (res?.data && typeof res.data === 'object') return true;
      return false;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) return false;
      if ((status === 429 || status === 503 || status === 504 || !status) && i < 3) {
        await sleep(Math.min(4000, 300 * (2 ** i)));
        continue;
      }
      return false;
    }
  }
  return false;
}

async function rebroadcastMonitoredTx(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) {
    const err = new Error('Invalid txid');
    err.code = 'INVALID_TXID';
    throw err;
  }
  const state = readBroadcastMonitorState();
  const index = state.records.findIndex((row) => row.txid === safeTxid);
  if (index < 0 || !String(state.records[index]?.rawtx || '').trim()) {
    const err = new Error('Broadcast rawtx not found');
    err.code = 'BROADCAST_RAWTX_NOT_FOUND';
    throw err;
  }
  const prev = normalizeBroadcastMonitorRecord(state.records[index]);
  state.records[index] = normalizeBroadcastMonitorRecord({
    ...prev,
    status: 'broadcast_pending_confirm',
    updatedAt: new Date().toISOString(),
    nextProbeAt: new Date(Date.now() + BROADCAST_MONITOR_PROBE_MS).toISOString(),
    retryCount: prev.retryCount + 1,
    failureReason: '',
    failedAt: '',
  });
  writeBroadcastMonitorState(state);
  appendSendLog('broadcast_monitor_manual_rebroadcast_start', {
    txid: safeTxid,
    retryCount: prev.retryCount + 1,
    source: String(options.source || 'manual_rebroadcast'),
  });
  return broadcastRawTx(prev.rawtx, {
    source: String(options.source || 'manual_rebroadcast'),
    requireVisibility: false,
  });
}

function getCandidatePathBases(statePathBase) {
  const legacyPaths = readJson(LEGACY_AVAILABLE_PATHS_FILE, { availablePaths: [] }).availablePaths || [];
  return Array.from(new Set([statePathBase, PATH_BASE, ...FALLBACK_PATH_BASES, ...legacyPaths].filter(Boolean)));
}

async function wocGetAddressBalance(address, options = {}) {
  const url = `${WOC_BASE}/address/${address}/confirmed/balance`;
  for (let i = 0; i < 8; i += 1) {
    try {
      await wocRateLimitWait(options);
      const res = await axios.get(url, { timeout: WOC_TIMEOUT_MS });
      return Number(res.data?.confirmed || 0);
    } catch (err) {
      const status = err?.response?.status;
      appendRecoverLog('woc_balance_retry', { address, attempt: i + 1, status: status || null, error: err.message });
      if ((status === 429 || status === 503 || status === 504 || !status) && i < 7) {
        await sleep(Math.min(4500, 300 * (2 ** i)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('WOC balance query failed');
}

async function wocGetAddressUtxos(address, options = {}) {
  const url = `${WOC_BASE}/address/${address}/confirmed/unspent`;
  for (let i = 0; i < 8; i += 1) {
    try {
      await wocRateLimitWait(options);
      const res = await axios.get(url, { timeout: WOC_TIMEOUT_MS });
      const rows = Array.isArray(res.data)
        ? res.data
        : (Array.isArray(res.data?.result) ? res.data.result : []);
      return rows;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) return [];
      appendRecoverLog('woc_utxo_retry', { address, attempt: i + 1, status: status || null, error: err.message });
      if ((status === 429 || status === 503 || status === 504 || !status) && i < 7) {
        await sleep(Math.min(4500, 300 * (2 ** i)));
        continue;
      }
      throw err;
    }
  }
  throw new Error('WOC utxo query failed');
}

async function wocGetAddressTxids(address, options = {}) {
  const txids = [];
  let token = null;
  let safetyPages = 0;

  while (safetyPages < 200) {
    safetyPages += 1;
    const params = new URLSearchParams();
    params.set('order', 'desc');
    params.set('limit', '1000');
    if (token) params.set('token', token);
    const url = `${WOC_BASE}/address/${address}/confirmed/history?${params.toString()}`;

    let payload = null;
    for (let i = 0; i < 8; i += 1) {
      try {
        await wocRateLimitWait(options);
        const res = await axios.get(url, { timeout: WOC_TIMEOUT_MS });
        payload = res.data || {};
        break;
      } catch (err) {
        const status = err?.response?.status;
        if (status === 404) {
          payload = { result: [], nextPageToken: null };
          break;
        }
        appendRecoverLog('woc_history_retry', { address, attempt: i + 1, status: status || null, error: err.message, token: token || null });
        if ((status === 429 || status === 503 || status === 504 || !status) && i < 7) {
          await sleep(Math.min(4500, 300 * (2 ** i)));
          continue;
        }
        throw err;
      }
    }

    const rows = Array.isArray(payload?.result) ? payload.result : [];
    for (const row of rows) {
      if (row?.tx_hash) txids.push(row.tx_hash);
    }
    token = payload?.nextPageToken || null;
    if (!token || rows.length === 0) break;
  }

  return Array.from(new Set(txids));
}

async function wocGetAddressUnconfirmedTxids(address, options = {}) {
  const safeAddress = String(address || '').trim();
  if (!safeAddress) return [];
  const url = `${WOC_BASE}/address/${safeAddress}/unconfirmed/history`;
  for (let i = 0; i < 8; i += 1) {
    try {
      await wocRateLimitWait(options);
      const res = await axios.get(url, { timeout: WOC_TIMEOUT_MS });
      const rows = Array.isArray(res.data)
        ? res.data
        : (Array.isArray(res.data?.result) ? res.data.result : []);
      return Array.from(new Set(rows
        .map((row) => String(row?.tx_hash || row?.txid || '').trim().toLowerCase())
        .filter((txid) => /^[0-9a-f]{64}$/i.test(txid))));
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) return [];
      appendRecoverLog('woc_unconfirmed_history_retry', {
        address: safeAddress,
        attempt: i + 1,
        status: status || null,
        error: err.message,
      });
      if ((status === 429 || status === 503 || status === 504 || !status) && i < 7) {
        await sleep(Math.min(4500, 300 * (2 ** i)));
        continue;
      }
      throw err;
    }
  }
  return [];
}

async function refreshCriticalAddressesFromWoc(state, options = {}) {
  const addresses = getCriticalRefreshAddresses(state);
  if (!addresses.length) return;
  appendSendLog('refresh_woc_start', { addressCount: addresses.length });

  for (const address of addresses) {
    try {
      const [utxos, txids, unconfirmedTxids] = await Promise.all([
        wocGetAddressUtxos(address, options),
        wocGetAddressTxids(address, options),
        wocGetAddressUnconfirmedTxids(address, options),
      ]);
      const contextTxids = new Set(txids);
      for (const u of utxos) {
        const satoshis = Number(u.value || 0);
        const txId = String(u.tx_hash || '');
        const vout = Number(u.tx_pos);
        if (!txId || !Number.isInteger(vout) || vout < 0 || satoshis <= 0) continue;
        contextTxids.add(txId);
        const ok = upsertUtxoToSpvIndex({
          txId,
          vout,
          address,
          satoshis,
          confirmed: Number(u.height || 0) > 0,
          source: 'woc',
        });
        if (ok) {
          appendSendLog('utxo_upsert_ok', {
            source: 'woc',
            txId,
            vout,
            satoshis,
            confirmed: Number(u.height || 0) > 0,
            address,
          });
        }
      }
      for (const txid of txids) {
        recordTxidToSpvIndex(txid, { confirmed: true });
      }
      let importedUnconfirmedCount = 0;
      if (unconfirmedTxids.length) {
        const backfill = await backfillTxContextsFromWoc(unconfirmedTxids, {
          ...options,
          allowDisabled: true,
          confirmed: false,
          onlyMissing: false,
        });
        for (const txid of unconfirmedTxids) {
          const ctx = getTxContextByTxid(txid);
          if (ctx?.rawtx && applyTxToSpvIndex(ctx.rawtx, { confirmed: false })) {
            importedUnconfirmedCount += 1;
          }
        }
        appendSendLog('refresh_woc_unconfirmed_import', {
          address,
          txidCount: unconfirmedTxids.length,
          backfillInserted: Number(backfill?.inserted || 0),
          importedCount: importedUnconfirmedCount,
        });
      }
      appendSendLog('refresh_woc_address_ok', {
        address,
        utxoCount: utxos.length,
        txidCount: txids.length,
        unconfirmedTxidCount: unconfirmedTxids.length,
        importedUnconfirmedCount,
      });
    } catch (err) {
      appendSendLog('refresh_woc_address_fail', { address, error: err.message });
    }
  }
}

async function reconcileConfirmedUtxoSetWithWoc(state, options = {}) {
  const addresses = Array.isArray(state?.addresses)
    ? state.addresses.map((row) => String(row?.address || '').trim()).filter(Boolean)
    : [];
  if (!addresses.length) {
    return { addressCount: 0, wocConfirmedCount: 0, removedConfirmed: 0, upsertedConfirmed: 0, confirmedSat: 0 };
  }
  const wocConfirmed = new Map();
  const watchedAddresses = new Set(addresses);
  for (const address of addresses) {
    const utxos = await wocGetAddressUtxos(address, options);
    for (const row of (Array.isArray(utxos) ? utxos : [])) {
      const txId = String(row?.tx_hash || '').trim().toLowerCase();
      const vout = Number(row?.tx_pos);
      const satoshis = Number(row?.value || 0);
      if (!/^[0-9a-f]{64}$/i.test(txId) || !Number.isInteger(vout) || vout < 0 || satoshis <= 0) continue;
      const key = `${txId}:${vout}`;
      wocConfirmed.set(key, {
        txId,
        vout,
        address,
        satoshis,
        confirmed: true,
        source: 'woc_reconcile',
      });
    }
  }

  const index = getSpvIndex();
  index.utxos = index.utxos || {};
  index.ownedOutpoints = index.ownedOutpoints || {};
  index.spentOutpoints = index.spentOutpoints || {};
  index.txs = index.txs || {};
  const auditBefore = buildWalletBalanceAuditSnapshot(index);

  let removedConfirmed = 0;
  for (const [key, row] of Object.entries(index.utxos || {})) {
    const txId = String(row?.txId || '').trim().toLowerCase();
    const address = String(row?.address || '').trim();
    const isWalletAddress = watchedAddresses.has(address);
    if (!isWalletAddress || row?.confirmed !== true) continue;
    if (wocConfirmed.has(key)) continue;
    delete index.utxos[key];
    delete index.ownedOutpoints[key];
    removedConfirmed += 1;
  }

  let upsertedConfirmed = 0;
  for (const [key, utxo] of wocConfirmed.entries()) {
    const existing = index.utxos[key];
    delete index.spentOutpoints[key];
    index.ownedOutpoints[key] = Number(utxo.satoshis || 0);
    index.utxos[key] = {
      ...(existing || {}),
      ...utxo,
      confirmed: true,
      ancestorDepth: 0,
      updatedAt: new Date().toISOString(),
      seenAt: existing?.seenAt || new Date().toISOString(),
    };
    index.txs[utxo.txId] = {
      ...(index.txs[utxo.txId] || {}),
      txid: utxo.txId,
      confirmed: true,
      ancestorDepth: 0,
      firstSeenAt: index.txs[utxo.txId]?.firstSeenAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      receivedSat: Number(index.txs[utxo.txId]?.receivedSat || 0),
      spentSat: Number(index.txs[utxo.txId]?.spentSat || 0),
      netSat: Number(index.txs[utxo.txId]?.netSat || 0),
    };
    if (!existing || existing.confirmed !== true || Number(existing.satoshis || 0) !== Number(utxo.satoshis || 0)) {
      upsertedConfirmed += 1;
    }
  }

  for (const [key, satoshis] of Object.entries(index.ownedOutpoints || {})) {
    if (!index.utxos[key] && Number.isFinite(Number(satoshis || 0))) delete index.ownedOutpoints[key];
  }

  saveSpvIndex(index);
  appendWalletBalanceAudit('wallet_balance_index_mutated', auditBefore, buildWalletBalanceAuditSnapshot(index), {
    source: String(options.source || 'woc_reconcile'),
    operation: 'reconcile_confirmed_utxo_set_with_woc',
    addressCount: addresses.length,
    wocConfirmedCount: wocConfirmed.size,
    removedConfirmed,
    upsertedConfirmed,
  });
  const confirmedSat = Array.from(wocConfirmed.values()).reduce((acc, row) => acc + Number(row?.satoshis || 0), 0);
  appendSendLog('woc_confirmed_utxo_reconciled', {
    addressCount: addresses.length,
    wocConfirmedCount: wocConfirmed.size,
    removedConfirmed,
    upsertedConfirmed,
    confirmedSat,
  });
  return {
    addressCount: addresses.length,
    wocConfirmedCount: wocConfirmed.size,
    removedConfirmed,
    upsertedConfirmed,
    confirmedSat,
  };
}

function restoreSpentOutpointForPrunedTx(index, outpoint, spentRow = {}, now = new Date().toISOString()) {
  const key = String(outpoint || '').trim().toLowerCase();
  const match = /^([0-9a-f]{64}):(\d+)$/i.exec(key);
  if (!match || index?.utxos?.[key]) return false;
  const txId = match[1].toLowerCase();
  const vout = Number(match[2]);
  const watchSet = getWatchedAddresses();
  let address = String(spentRow?.address || '').trim();
  let satoshis = Number(spentRow?.satoshis || 0);
  let confirmed = spentRow?.confirmed === true;
  let ancestorDepth = Math.max(0, Number(spentRow?.ancestorDepth || 0));
  let seenAt = spentRow?.seenAt || now;

  if (!address || !(satoshis > 0)) {
    const ctx = getTxContextByTxid(txId);
    if (ctx?.rawtx) {
      try {
        const prevTx = new bsv.Transaction(ctx.rawtx);
        const output = prevTx.outputs[vout];
        if (output) {
          try {
            address = String(output?.script?.toAddress?.(NETWORK) || '').trim();
          } catch (_) {}
          satoshis = Number(output?.satoshis || satoshis || 0);
          confirmed = Boolean(ctx.confirmed === true || index?.txs?.[txId]?.confirmed === true || confirmed);
          ancestorDepth = confirmed ? 0 : Math.max(0, Number(index?.txs?.[txId]?.ancestorDepth || ancestorDepth || 0));
        }
      } catch (_) {}
    }
  }

  if (!address || !(satoshis > 0)) return false;
  if (watchSet.size > 0 && !watchSet.has(address)) return false;
  index.utxos[key] = {
    txId,
    vout,
    address,
    satoshis,
    confirmed,
    ancestorDepth: confirmed ? 0 : ancestorDepth,
    seenAt,
    updatedAt: now,
  };
  index.ownedOutpoints[key] = satoshis;
  return true;
}

function revertPendingTxInSpvIndex(index, txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) {
    return { prunedTxCount: 0, prunedUtxoCount: 0, restoredSpentOutpointCount: 0, restoredUtxoCount: 0 };
  }
  index.utxos = index.utxos || {};
  index.ownedOutpoints = index.ownedOutpoints || {};
  index.spentOutpoints = index.spentOutpoints || {};
  index.txs = index.txs || {};
  index.stalePendingTxs = index.stalePendingTxs || {};

  const now = new Date().toISOString();
  let prunedUtxoCount = 0;
  let restoredSpentOutpointCount = 0;
  let restoredUtxoCount = 0;
  let prunedTxCount = 0;

  for (const [key, row] of Object.entries(index.utxos || {})) {
    const rowTxid = String(row?.txId || row?.txid || '').trim().toLowerCase();
    if (rowTxid !== safeTxid || row?.confirmed === true) continue;
    delete index.utxos[key];
    delete index.ownedOutpoints[key];
    prunedUtxoCount += 1;
  }
  for (const [outpoint, row] of Object.entries(index.spentOutpoints || {})) {
    const spentBy = String(row?.spentBy || '').trim().toLowerCase();
    if (spentBy !== safeTxid) continue;
    if (restoreSpentOutpointForPrunedTx(index, outpoint, row, now)) restoredUtxoCount += 1;
    delete index.spentOutpoints[outpoint];
    restoredSpentOutpointCount += 1;
  }

  const existing = index.txs[safeTxid];
  const existingStale = index.stalePendingTxs[safeTxid] || null;
  if (existing?.confirmed !== true) {
    index.stalePendingTxs[safeTxid] = {
      ...(existingStale || {}),
      ...(existing || {}),
      txid: safeTxid,
      staleReason: String(options.reason || 'woc_local_only_pending_reconcile'),
      staleAt: existingStale?.staleAt || now,
    };
    if (existing) {
      delete index.txs[safeTxid];
      prunedTxCount += 1;
    }
  }

  for (const [key, satoshis] of Object.entries(index.ownedOutpoints || {})) {
    if (!index.utxos[key] && Number.isFinite(Number(satoshis || 0))) delete index.ownedOutpoints[key];
  }
  return { prunedTxCount, prunedUtxoCount, restoredSpentOutpointCount, restoredUtxoCount };
}

function pruneLocalOnlyPendingTxidsFromSpvIndex(index, txids = [], options = {}) {
  const staleTxids = new Set((Array.isArray(txids) ? txids : [])
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid)));
  if (!staleTxids.size || !index || typeof index !== 'object') {
    return { prunedTxCount: 0, prunedUtxoCount: 0, restoredSpentOutpointCount: 0, restoredUtxoCount: 0 };
  }
  index.utxos = index.utxos || {};
  index.ownedOutpoints = index.ownedOutpoints || {};
  index.spentOutpoints = index.spentOutpoints || {};
  index.txs = index.txs || {};
  index.stalePendingTxs = index.stalePendingTxs || {};
  let prunedUtxoCount = 0;
  let restoredSpentOutpointCount = 0;
  let restoredUtxoCount = 0;
  let prunedTxCount = 0;
  for (const txid of staleTxids) {
    const result = revertPendingTxInSpvIndex(index, txid, options);
    prunedTxCount += Number(result.prunedTxCount || 0);
    prunedUtxoCount += Number(result.prunedUtxoCount || 0);
    restoredSpentOutpointCount += Number(result.restoredSpentOutpointCount || 0);
    restoredUtxoCount += Number(result.restoredUtxoCount || 0);
  }
  return { prunedTxCount, prunedUtxoCount, restoredSpentOutpointCount, restoredUtxoCount };
}

function revertPendingWalletTx(txid, options = {}) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) {
    return { prunedTxCount: 0, prunedUtxoCount: 0, restoredSpentOutpointCount: 0, restoredUtxoCount: 0 };
  }
  const index = getSpvIndex();
  const result = revertPendingTxInSpvIndex(index, safeTxid, {
    reason: String(options.reason || 'broadcast_failed_revert'),
  });
  saveSpvIndex(index);
  appendSendLog('wallet_pending_tx_reverted', {
    txid: safeTxid,
    reason: String(options.reason || 'broadcast_failed_revert'),
    prunedTxCount: Number(result.prunedTxCount || 0),
    prunedUtxoCount: Number(result.prunedUtxoCount || 0),
    restoredSpentOutpointCount: Number(result.restoredSpentOutpointCount || 0),
    restoredUtxoCount: Number(result.restoredUtxoCount || 0),
  });
  return result;
}

function buildProtectedPendingAncestorTxidSet(index = null) {
  const safeIndex = index || getSpvIndex() || {};
  const txs = safeIndex.txs || {};
  const spentOutpoints = safeIndex.spentOutpoints || {};
  const protectedTxids = new Set();
  for (const [outpoint, row] of Object.entries(spentOutpoints)) {
    const parentTxid = String(outpoint || '').trim().toLowerCase().split(':')[0] || '';
    if (!/^[0-9a-f]{64}$/i.test(parentTxid)) continue;
    const spentBy = String(row?.spentBy || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(spentBy) || spentBy === parentTxid) continue;
    const spenderRow = txs[spentBy];
    if (!spenderRow || spenderRow?.confirmed === true) continue;
    protectedTxids.add(parentTxid);
  }
  return protectedTxids;
}

function buildPendingSpenderMap(index = null) {
  const safeIndex = index || getSpvIndex() || {};
  const txs = safeIndex.txs || {};
  const spentOutpoints = safeIndex.spentOutpoints || {};
  const pendingSpenderMap = new Map();
  for (const [outpoint, row] of Object.entries(spentOutpoints || {})) {
    const parentTxid = String(outpoint || '').trim().toLowerCase().split(':')[0] || '';
    const spentBy = String(row?.spentBy || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(parentTxid) || !/^[0-9a-f]{64}$/i.test(spentBy)) continue;
    const spenderRow = txs[spentBy];
    if (!spenderRow || spenderRow?.confirmed === true) continue;
    const existing = pendingSpenderMap.get(parentTxid);
    if (existing) existing.add(spentBy);
    else pendingSpenderMap.set(parentTxid, new Set([spentBy]));
  }
  return pendingSpenderMap;
}

function buildActiveOrderProtocolTxidSet(index = null, options = {}) {
  const safeIndex = index || getSpvIndex() || {};
  const txs = safeIndex.txs || {};
  const stalePendingTxs = safeIndex.stalePendingTxs || {};
  const includeStale = options?.includeStale === true;
  const protectedTxids = new Set();
  const activeOrderStatuses = new Set([
    'PLACED',
    'LOCKED',
    'SHIPPED',
    'REFUND_REQUESTED',
  ]);
  let orders = [];
  try {
    const orderDomain = require('./order_domain');
    if (typeof orderDomain?.listOrdersSync === 'function') {
      orders = orderDomain.listOrdersSync();
    }
  } catch (_) {
    orders = [];
  }
  for (const order of Array.isArray(orders) ? orders : []) {
    const status = String(order?.status || '').trim().toUpperCase();
    if (!activeOrderStatuses.has(status)) continue;
    const chain = order && typeof order.chain === 'object' ? order.chain : {};
    for (const value of Object.values(chain)) {
      const txid = String(value || '').trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/i.test(txid)) continue;
      const row = txs[txid] || (includeStale ? stalePendingTxs[txid] : null);
      if (!row || row?.confirmed === true) continue;
      protectedTxids.add(txid);
    }
  }
  return protectedTxids;
}

function pruneTerminalOrderProtocolPendingTxs(index, options = {}) {
  const safeIndex = index || getSpvIndex() || {};
  safeIndex.txs = safeIndex.txs || {};
  safeIndex.stalePendingTxs = safeIndex.stalePendingTxs || {};
  const localHeight = Math.max(0, Number(options?.localHeight || 0));
  const minBlocks = Math.max(1, Number(options?.minBlocks || 1));
  const protectedAncestorTxids = options?.protectedAncestorTxids instanceof Set
    ? options.protectedAncestorTxids
    : buildProtectedPendingAncestorTxidSet(safeIndex);
  const terminalStatuses = new Set([
    'COMPLETED',
    'REFUNDED',
    'CANCELED',
    'TIMED_OUT',
  ]);
  let orders = [];
  try {
    const orderDomain = require('./order_domain');
    if (typeof orderDomain?.listOrdersSync === 'function') {
      orders = orderDomain.listOrdersSync();
    }
  } catch (_) {
    orders = [];
  }
  const pendingSpenderMap = buildPendingSpenderMap(safeIndex);
  const prunedTxids = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    const status = String(order?.status || '').trim().toUpperCase();
    if (!terminalStatuses.has(status)) continue;
    const chain = order && typeof order.chain === 'object' ? order.chain : {};
    const terminalChainTxids = new Set();
    for (const value of Object.values(chain)) {
      const txid = String(value || '').trim().toLowerCase();
      if (/^[0-9a-f]{64}$/i.test(txid)) terminalChainTxids.add(txid);
    }
    const candidateRows = [];
    const candidateSet = new Set(terminalChainTxids);
    for (const value of Object.values(chain)) {
      const txid = String(value || '').trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/i.test(txid)) continue;
      const row = safeIndex.txs[txid];
      if (!row || row?.confirmed === true) continue;
      const firstSeenHeight = Math.max(0, Number(row?.firstSeenHeight || row?.broadcastHeight || 0));
      if (localHeight > 0 && firstSeenHeight > 0 && localHeight < firstSeenHeight + minBlocks) continue;
      candidateRows.push({
        txid,
        firstSeenHeight,
        lastSeenAt: String(row?.lastSeenAt || row?.firstSeenAt || ''),
      });
      candidateSet.add(txid);
    }
    candidateRows.sort((a, b) => (
      Number(b.firstSeenHeight || 0) - Number(a.firstSeenHeight || 0)
      || String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || ''))
      || String(b.txid || '').localeCompare(String(a.txid || ''))
    ));
    for (const row of candidateRows) {
      const txid = row.txid;
      if (protectedAncestorTxids.has(txid)) {
        const spenders = pendingSpenderMap.get(txid) || new Set();
        const protectedByExternalPending = Array.from(spenders).some((spenderTxid) => !candidateSet.has(spenderTxid));
        if (protectedByExternalPending) continue;
      }
      revertPendingTxInSpvIndex(safeIndex, txid, options);
      prunedTxids.push(txid);
    }
  }
  return {
    prunedCount: prunedTxids.length,
    prunedTxids,
  };
}

async function reconcileStalePendingWalletTxs(options = {}) {
  const source = String(options?.source || 'stale_pending_spv_reconcile').trim() || 'stale_pending_spv_reconcile';
  const localHeight = Math.max(0, Number(options?.localHeight || 0));
  const minBlocks = Math.max(1, Number(options?.minBlocks || 1));
  const minAgeMs = Math.max(0, Number(options?.minAgeMs || 0));
  const maxChecks = Math.max(1, Math.min(64, Number(options?.maxChecks || 8)));
  const index = getSpvIndex();
  index.utxos = index.utxos || {};
  index.ownedOutpoints = index.ownedOutpoints || {};
  index.spentOutpoints = index.spentOutpoints || {};
  index.txs = index.txs || {};

  const prePrune = purgeKnownStalePendingUtxosFromIndex(index);
  if (Number(prePrune.prunedUtxoCount || 0) > 0) {
    saveSpvIndex(index);
    if (walletExists()) {
      const freshState = getWalletState();
      updateAddressBalancesFromSpv(freshState);
      saveWalletState(freshState);
      writeJson(CACHE_FILE, buildCacheFromSpvIndex(index));
    }
    appendSendLog('stale_pending_known_utxos_pruned', {
      source,
      prunedUtxoCount: Number(prePrune.prunedUtxoCount || 0),
    });
  }

  if (localHeight <= 0) {
    return { skipped: true, reason: 'no_local_height', checked: 0, staleTxids: [] };
  }

  const candidateTxids = [];
  const now = Date.now();
  for (const [txidKey, row] of Object.entries(index.txs || {})) {
    const txid = String(row?.txid || txidKey || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(txid)) continue;
    if (row?.confirmed === true) continue;
    const firstSeenHeight = Math.max(0, Number(row?.firstSeenHeight || row?.broadcastHeight || 0));
    if (firstSeenHeight <= 0 || localHeight < firstSeenHeight + minBlocks) continue;
    const firstSeenAt = Date.parse(String(row?.firstSeenAt || row?.lastSeenAt || ''));
    if (minAgeMs > 0 && Number.isFinite(firstSeenAt) && firstSeenAt > 0 && (now - firstSeenAt) < minAgeMs) continue;
    const hasAccounting = Boolean(
      row?.applied === true
      || Number(row?.receivedSat || 0) > 0
      || Number(row?.spentSat || 0) > 0
      || Number(row?.netSat || 0) !== 0
    );
    if (!hasAccounting) continue;
    candidateTxids.push({
      txid,
      firstSeenHeight,
      ageBlocks: localHeight - firstSeenHeight,
      lastSeenAt: row?.lastSeenAt || row?.firstSeenAt || '',
    });
  }

  candidateTxids.sort((a, b) => (
    a.firstSeenHeight - b.firstSeenHeight
    || String(a.lastSeenAt).localeCompare(String(b.lastSeenAt))
    || a.txid.localeCompare(b.txid)
  ));
  const candidates = candidateTxids.slice(0, maxChecks);
  const protectedAncestorTxids = buildProtectedPendingAncestorTxidSet(index);
  const terminalPruneResult = pruneTerminalOrderProtocolPendingTxs(index, {
    ...options,
    localHeight,
    minBlocks,
    protectedAncestorTxids,
  });
  if (Number(terminalPruneResult.prunedCount || 0) > 0) {
    saveSpvIndex(index);
    if (walletExists()) {
      const freshState = getWalletState();
      updateAddressBalancesFromSpv(freshState);
      saveWalletState(freshState);
      writeJson(CACHE_FILE, buildCacheFromSpvIndex(index));
    }
    appendSendLog('stale_pending_terminal_order_pruned', {
      source,
      localHeight,
      prunedCount: Number(terminalPruneResult.prunedCount || 0),
      prunedTxids: (terminalPruneResult.prunedTxids || []).slice(0, 12),
    });
  }
  const activeOrderProtocolTxids = buildActiveOrderProtocolTxidSet(index);
  const activeOrderProtocolStaleTxids = Array.from(buildActiveOrderProtocolTxidSet(index, { includeStale: true }))
    .filter((txid) => !index.txs?.[txid] && index.stalePendingTxs?.[txid]);
  if (activeOrderProtocolStaleTxids.length) {
    appendSendLog('stale_pending_active_order_stale_bucket_detected', {
      source,
      localHeight,
      activeOrderProtocolCount: activeOrderProtocolTxids.size,
      staleBucketCount: activeOrderProtocolStaleTxids.length,
      staleBucketTxids: activeOrderProtocolStaleTxids.slice(0, 12),
      policy: 'runtime_restore_disallowed_manual_recovery_only',
    });
  }
  if (!candidates.length) {
    return {
      skipped: false,
      checked: 0,
      candidateCount: 0,
      staleTxids: [],
      activeOrderProtocolTxids: Array.from(activeOrderProtocolTxids),
      activeOrderProtocolStaleTxids,
    };
  }

  let probeResult = null;
  if (typeof options.visibilityProbe === 'function') {
    probeResult = await options.visibilityProbe(candidates.map((row) => row.txid), {
      source,
      localHeight,
      minBlocks,
      minAgeMs,
    });
  } else {
    const state = getWalletStateSnapshotInternal();
    const addresses = Array.isArray(state.addresses) ? state.addresses : [];
    probeResult = await pullMempoolSnapshot(addresses, {
      force: true,
      source,
      nodeLimit: Math.max(1, Number(options?.nodeLimit || 3)),
      snapshotMs: Math.max(250, Number(options?.snapshotMs || 1200)),
      connectTimeoutMs: Math.max(500, Number(options?.connectTimeoutMs || 1800)),
      stopOnHit: false,
      targetTxids: candidates.map((row) => row.txid),
      logAlways: options?.logAlways === true,
    });
  }

  const visibleTxids = new Set((Array.isArray(probeResult?.visibleTxids) ? probeResult.visibleTxids : probeResult?.txids || [])
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid)));
  const invisibleCandidateTxids = new Set(candidates
    .map((row) => row.txid)
    .filter((txid) => (
      !visibleTxids.has(txid)
      && index.txs?.[txid]?.confirmed !== true
    )));
  const pendingSpenderMap = buildPendingSpenderMap(index);
  const checkedNodes = Math.max(0, Number(probeResult?.checked || 0));
  const minProbeNodes = Math.max(1, Number(options?.minProbeNodes || 2));
  if (checkedNodes < minProbeNodes) {
    appendSendLog('stale_pending_spv_reconcile_skipped', {
      source,
      localHeight,
      candidateCount: candidates.length,
      checked: checkedNodes,
      minProbeNodes,
      reason: 'insufficient_spv_visibility_checks',
    });
    return {
      skipped: true,
      reason: 'insufficient_spv_visibility_checks',
      checked: candidates.length,
      checkedNodes,
      minProbeNodes,
      candidateCount: candidates.length,
      visibleTxids: Array.from(visibleTxids),
      protectedAncestorTxids: Array.from(protectedAncestorTxids),
      activeOrderProtocolTxids: Array.from(activeOrderProtocolTxids),
      activeOrderProtocolStaleTxids,
      staleTxids: [],
      probeResult,
    };
  }
  const staleTxids = candidates
    .map((row) => row.txid)
    .filter((txid) => {
      if (!invisibleCandidateTxids.has(txid)) return false;
      if (activeOrderProtocolTxids.has(txid)) return false;
      if (!protectedAncestorTxids.has(txid)) return true;
      const spenders = pendingSpenderMap.get(txid) || new Set();
      const protectedByLivePending = Array.from(spenders)
        .some((spenderTxid) => !invisibleCandidateTxids.has(spenderTxid));
      return !protectedByLivePending;
    });
  if (!staleTxids.length) {
    appendSendLog('stale_pending_spv_reconcile_done', {
      source,
      localHeight,
      candidateCount: candidates.length,
      checked: Number(probeResult?.checked || 0),
      visibleCount: visibleTxids.size,
      protectedCount: protectedAncestorTxids.size,
      activeOrderProtocolCount: activeOrderProtocolTxids.size,
      activeOrderProtocolStaleCount: activeOrderProtocolStaleTxids.length,
      prunedTxCount: 0,
    });
    return {
      skipped: false,
      checked: candidates.length,
      candidateCount: candidates.length,
      visibleTxids: Array.from(visibleTxids),
      protectedAncestorTxids: Array.from(protectedAncestorTxids),
      activeOrderProtocolTxids: Array.from(activeOrderProtocolTxids),
      activeOrderProtocolStaleTxids,
      staleTxids: [],
      probeResult,
    };
  }

  const pruneResult = pruneLocalOnlyPendingTxidsFromSpvIndex(index, staleTxids, {
    reason: 'spv_mempool_not_visible_after_block',
  });
  const postPrune = purgeKnownStalePendingUtxosFromIndex(index);
  if (
    Number(pruneResult.prunedTxCount || 0) > 0
    || Number(pruneResult.prunedUtxoCount || 0) > 0
    || Number(pruneResult.restoredSpentOutpointCount || 0) > 0
    || Number(pruneResult.restoredUtxoCount || 0) > 0
    || Number(postPrune.prunedUtxoCount || 0) > 0
  ) {
    saveSpvIndex(index);
    if (walletExists()) {
      const freshState = getWalletState();
      updateAddressBalancesFromSpv(freshState);
      saveWalletState(freshState);
      writeJson(CACHE_FILE, buildCacheFromSpvIndex());
    }
  }
  appendSendLog('stale_pending_spv_reconcile_done', {
      source,
      localHeight,
      minBlocks,
      minAgeMs,
      candidateCount: candidates.length,
    checked: Number(probeResult?.checked || 0),
    visibleCount: visibleTxids.size,
    protectedCount: protectedAncestorTxids.size,
    activeOrderProtocolCount: activeOrderProtocolTxids.size,
    activeOrderProtocolStaleCount: activeOrderProtocolStaleTxids.length,
    staleTxids: staleTxids.slice(0, 12),
    prunedTxCount: Number(pruneResult.prunedTxCount || 0),
    prunedUtxoCount: Number(pruneResult.prunedUtxoCount || 0),
    postPruneUtxoCount: Number(postPrune.prunedUtxoCount || 0),
    restoredSpentOutpointCount: Number(pruneResult.restoredSpentOutpointCount || 0),
    restoredUtxoCount: Number(pruneResult.restoredUtxoCount || 0),
  });
  return {
    skipped: false,
    checked: candidates.length,
    candidateCount: candidates.length,
    visibleTxids: Array.from(visibleTxids),
    protectedAncestorTxids: Array.from(protectedAncestorTxids),
    activeOrderProtocolTxids: Array.from(activeOrderProtocolTxids),
    activeOrderProtocolStaleTxids,
    staleTxids,
    postPruneUtxoCount: Number(postPrune.prunedUtxoCount || 0),
    probeResult,
    ...pruneResult,
  };
}

async function reconcilePendingWalletIndexWithWoc(state, options = {}) {
  const addresses = Array.isArray(state?.addresses)
    ? state.addresses.map((row) => String(row?.address || '').trim()).filter(Boolean)
    : [];
  if (!addresses.length) {
    return {
      addressCount: 0,
      wocUnconfirmedTxCount: 0,
      localOnlyPendingTxCount: 0,
      keptRecentLocalTxs: 0,
      localOnlyPendingTxids: [],
    };
  }

  const wocUnconfirmedTxids = new Set();
  for (const address of addresses) {
    const txids = await wocGetAddressUnconfirmedTxids(address, options);
    for (const txid of (Array.isArray(txids) ? txids : [])) {
      const safeTxid = String(txid || '').trim().toLowerCase();
      if (/^[0-9a-f]{64}$/i.test(safeTxid)) wocUnconfirmedTxids.add(safeTxid);
    }
  }

  const index = getSpvIndex();
  index.utxos = index.utxos || {};
  index.ownedOutpoints = index.ownedOutpoints || {};
  index.spentOutpoints = index.spentOutpoints || {};
  index.txs = index.txs || {};

  const candidateTxids = new Set();
  for (const [txid, row] of Object.entries(index.txs || {})) {
    const safeTxid = String(txid || row?.txid || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/i.test(safeTxid) && row?.confirmed !== true) candidateTxids.add(safeTxid);
  }
  for (const row of Object.values(index.utxos || {})) {
    const safeTxid = String(row?.txId || row?.txid || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/i.test(safeTxid) && row?.confirmed !== true) candidateTxids.add(safeTxid);
  }
  for (const row of Object.values(index.spentOutpoints || {})) {
    const safeTxid = String(row?.spentBy || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/i.test(safeTxid)) {
      const txRow = index.txs?.[safeTxid];
      if (!txRow || txRow?.confirmed !== true) candidateTxids.add(safeTxid);
    }
  }

  const protectedTxids = new Set((Array.isArray(options.protectedTxids) ? options.protectedTxids : [])
    .map((txid) => String(txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid)));
  const keepRecentMs = Math.max(0, Number(options.keepRecentMs || 10 * 60 * 1000));
  const protectedKeepRecentMs = Math.max(0, Number(options.protectedKeepRecentMs || keepRecentMs));
  const nowMs = Date.now();
  const keptRecentLocalTxids = new Set();
  const keptProtectedLocalTxids = new Set();
  const expiredProtectedLocalTxids = new Set();
  const localOnlyPendingTxids = new Set();
  for (const txid of candidateTxids) {
    if (wocUnconfirmedTxids.has(txid)) continue;
    const row = index.txs?.[txid] || {};
    const lastSeenMs = Date.parse(String(row?.lastSeenAt || row?.firstSeenAt || '')) || 0;
    if (protectedTxids.has(txid)) {
      if (protectedKeepRecentMs > 0 && lastSeenMs > 0 && (nowMs - lastSeenMs) < protectedKeepRecentMs) {
        keptProtectedLocalTxids.add(txid);
        continue;
      }
      expiredProtectedLocalTxids.add(txid);
    }
    if (keepRecentMs > 0 && lastSeenMs > 0 && (nowMs - lastSeenMs) < keepRecentMs) {
      keptRecentLocalTxids.add(txid);
      continue;
    }
    localOnlyPendingTxids.add(txid);
  }

  let pruneResult = { prunedTxCount: 0, prunedUtxoCount: 0, restoredSpentOutpointCount: 0 };
  if (options.pruneLocalOnly === true && localOnlyPendingTxids.size > 0) {
    pruneResult = pruneLocalOnlyPendingTxidsFromSpvIndex(index, Array.from(localOnlyPendingTxids), {
      reason: 'manual_woc_pending_reconcile',
    });
    if (
      Number(pruneResult.prunedTxCount || 0) > 0
      || Number(pruneResult.prunedUtxoCount || 0) > 0
      || Number(pruneResult.restoredSpentOutpointCount || 0) > 0
    ) {
      saveSpvIndex(index);
    }
  }

  appendSendLog('woc_pending_wallet_index_reconciled', {
    addressCount: addresses.length,
    wocUnconfirmedTxCount: wocUnconfirmedTxids.size,
    localOnlyPendingTxCount: localOnlyPendingTxids.size,
    keptRecentLocalTxCount: keptRecentLocalTxids.size,
    keptProtectedLocalTxCount: keptProtectedLocalTxids.size,
    expiredProtectedLocalTxCount: expiredProtectedLocalTxids.size,
    prunedTxCount: Number(pruneResult.prunedTxCount || 0),
    prunedUtxoCount: Number(pruneResult.prunedUtxoCount || 0),
    restoredSpentOutpointCount: Number(pruneResult.restoredSpentOutpointCount || 0),
    localOnlyPendingTxids: Array.from(localOnlyPendingTxids).slice(0, 24),
    expiredProtectedLocalTxids: Array.from(expiredProtectedLocalTxids).slice(0, 24),
  });
  return {
    addressCount: addresses.length,
    wocUnconfirmedTxCount: wocUnconfirmedTxids.size,
    localOnlyPendingTxCount: localOnlyPendingTxids.size,
    keptRecentLocalTxs: keptRecentLocalTxids.size,
    keptProtectedLocalTxs: keptProtectedLocalTxids.size,
    expiredProtectedLocalTxs: expiredProtectedLocalTxids.size,
    prunedTxCount: Number(pruneResult.prunedTxCount || 0),
    prunedUtxoCount: Number(pruneResult.prunedUtxoCount || 0),
    restoredSpentOutpointCount: Number(pruneResult.restoredSpentOutpointCount || 0),
    localOnlyPendingTxids: Array.from(localOnlyPendingTxids),
  };
}

async function pickBestPathByWoc(mnemonic, scanCount) {
  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  const pathBases = getCandidatePathBases(null);
  const cap = Math.max(1, Math.min(Number(scanCount) || DEFAULT_RESCAN_COUNT, 300));
  appendRecoverLog('pick_path_start', { scanCount: cap, pathBases });

  let best = null;
  let successfulChecks = 0;

  for (const pathBase of pathBases) {
    const addresses = [];
    for (let i = 0; i < cap; i += 1) addresses.push(deriveAddress(hdPrivateKey, i, pathBase));

    let total = 0;
    for (const item of addresses) {
      item.balance = Number(await wocGetAddressBalance(item.address));
      total += item.balance;
      successfulChecks += 1;
    }

    const used = addresses.filter((a) => Number(a.balance || 0) > 0);
    const maxUsedIndex = used.length ? Math.max(...used.map((a) => a.index)) : 0;
    const addressCount = Math.max(1, maxUsedIndex + 20);
    const finalAddresses = addresses.slice(0, Math.min(addressCount, addresses.length));

    const candidate = {
      pathBase,
      total,
      addresses: finalAddresses,
    };
    appendRecoverLog('pick_path_candidate', {
      pathBase,
      total,
      watchedAddressCount: finalAddresses.length,
      usedAddressCount: used.length,
      maxUsedIndex,
    });

    if (!best || candidate.total > best.total) best = candidate;
  }

  if (!best || successfulChecks === 0) {
    throw new Error('WOC bootstrap failed: unable to read address balances');
  }
  appendRecoverLog('pick_path_selected', {
    pathBase: best.pathBase,
    total: best.total,
    watchedAddressCount: best.addresses.length,
    successfulChecks,
  });
  return best;
}

async function bootstrapSpvIndexFromWoc(state, options = {}) {
  resetSpvIndex();
  setWalletSyncProgress({
    stage: 'bootstrap',
    message: '开始从 WOC 重建钱包索引',
    addressCount: Array.isArray(state.addresses) ? state.addresses.length : 0,
    scannedAddresses: 0,
    currentAddress: '',
    currentIndex: -1,
    foundUtxos: 0,
    foundTxids: 0,
  });
  appendRecoverLog('bootstrap_index_start', {
    pathBase: state.pathBase,
    addressCount: state.addresses.length,
  });

  for (const addr of state.addresses) {
    setWalletSyncProgress({
      stage: 'bootstrap',
      message: `正在扫描地址 ${Number(addr.index) + 1}/${Array.isArray(state.addresses) ? state.addresses.length : 0}`,
      currentAddress: String(addr.address || ''),
      currentIndex: Number(addr.index),
    });
    const [utxos, txids] = await Promise.all([
      wocGetAddressUtxos(addr.address, options),
      wocGetAddressTxids(addr.address, options),
    ]);
    const contextTxids = new Set(txids);
    const utxoSatTotal = utxos.reduce((acc, u) => acc + Number(u?.value || 0), 0);
    setWalletSyncProgress({
      stage: 'bootstrap',
      scannedAddresses: Math.max(0, Number(addr.index) + 1),
      currentAddress: String(addr.address || ''),
      currentIndex: Number(addr.index),
      foundUtxos: Number(walletSyncRuntime.foundUtxos || 0) + utxos.length,
      foundTxids: Number(walletSyncRuntime.foundTxids || 0) + txids.length,
      message: `已扫 ${Number(addr.index) + 1}/${Array.isArray(state.addresses) ? state.addresses.length : 0} 个地址，发现 ${Number(walletSyncRuntime.foundUtxos || 0) + utxos.length} 条 UTXO，${Number(walletSyncRuntime.foundTxids || 0) + txids.length} 条交易`,
    });
    appendRecoverLog('bootstrap_address', {
      index: addr.index,
      address: addr.address,
      utxoCount: utxos.length,
      utxoSatTotal,
      txidCount: txids.length,
    });

    for (const u of utxos) {
      const satoshis = Number(u.value || 0);
      const txId = String(u.tx_hash || '');
      const vout = Number(u.tx_pos);
      if (!txId || !Number.isInteger(vout) || vout < 0 || satoshis <= 0) continue;
      contextTxids.add(txId);

      upsertUtxoToSpvIndex({
        txId,
        vout,
        address: addr.address,
        satoshis,
        confirmed: Number(u.height || 0) > 0,
      });
    }

    for (const txid of txids) {
      recordTxidToSpvIndex(txid, { confirmed: true });
    }
    let backfill = { requested: contextTxids.size, inserted: 0, skipped: 0, failed: true };
    try {
      backfill = await backfillTxContextsFromWoc(Array.from(contextTxids), {
        ...options,
        confirmed: true,
      });
    } catch (err) {
      appendRecoverLog('bootstrap_address_context_backfill_failed_nonfatal', {
        index: addr.index,
        address: addr.address,
        requested: contextTxids.size,
        error: String(err?.message || err || 'context backfill failed'),
      });
      appendSendLog('wallet_bootstrap_context_backfill_failed_nonfatal', {
        address: addr.address,
        requested: contextTxids.size,
        error: String(err?.message || err || 'context backfill failed'),
      });
    }
    appendRecoverLog('bootstrap_address_context', {
      index: addr.index,
      address: addr.address,
      requested: Number(backfill.requested || 0),
      inserted: Number(backfill.inserted || 0),
      skipped: Number(backfill.skipped || 0),
    });
  }
  const cache = buildCacheFromSpvIndex();
  setWalletSyncProgress({
    stage: 'bootstrap',
    message: '索引重建完成',
    confirmed: Number(cache.confirmed || 0),
    unconfirmed: Number(cache.unconfirmed || 0),
    total: Number(cache.total || 0),
  });
  appendRecoverLog('bootstrap_index_done', {
    confirmed: cache.confirmed,
    unconfirmed: cache.unconfirmed,
    total: cache.total,
    txidCount: cache.txids.length,
  });
}

function initWalletState(firstAddress) {
  return {
    pathBase: PATH_BASE,
    addresses: [firstAddress],
    lastReceiveIndex: firstAddress.index,
    addressCursor: firstAddress.index,
    updatedAt: new Date().toISOString(),
  };
}

function buildWalletStateFromHdPrivateKey(hdPrivateKey, addressCount = 1, pathBase = PATH_BASE) {
  const cap = Math.max(1, Math.min(Number(addressCount) || 1, 500));
  const addresses = [];
  for (let i = 0; i < cap; i += 1) addresses.push(deriveAddress(hdPrivateKey, i, pathBase));
  return {
    pathBase,
    addresses,
    lastReceiveIndex: 0,
    addressCursor: cap - 1,
    updatedAt: new Date().toISOString(),
  };
}

function getNotesMap() {
  return readJson(NOTES_FILE, {});
}

function getAnchorEventTypeMap(txids = []) {
  const wanted = Array.isArray(txids)
    ? txids.map((value) => String(value || '').trim().toLowerCase()).filter((value) => /^[0-9a-f]{64}$/i.test(value))
    : [];
  if (!wanted.length) return new Map();
  const out = new Map();
  const missing = [];
  for (const txid of wanted) {
    if (anchorEventTypeCache.has(txid)) {
      out.set(txid, String(anchorEventTypeCache.get(txid) || ''));
      continue;
    }
    missing.push(txid);
  }
  if (missing.length) {
    const db = ensureTxContextDb();
    const placeholders = missing.map(() => '?').join(', ');
    const rows = db.prepare(`
      SELECT txid, event_type
      FROM anchor_events
      WHERE txid IN (${placeholders})
    `).all(...missing);
    const found = new Map();
    for (const row of rows) {
      const txid = String(row?.txid || '').trim().toLowerCase();
      const eventType = String(row?.event_type || '').trim();
      if (!txid) continue;
      if (!found.has(txid)) found.set(txid, eventType);
    }
    for (const txid of missing) {
      const eventType = String(found.get(txid) || '');
      anchorEventTypeCache.set(txid, eventType);
      out.set(txid, eventType);
    }
  }
  for (const txid of wanted) {
    if (!out.has(txid)) out.set(txid, String(anchorEventTypeCache.get(txid) || ''));
  }
  return out;
}

function getMarketAnchorTypeForTxid(txid) {
  const safeTxid = String(txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return '';
  try {
    const note = String(getNotesMap()?.[safeTxid]?.note || '').trim();
    if (note.startsWith('market:')) return note.slice('market:'.length) || 'market';
  } catch (_) {
    // Fall through to the anchor event index.
  }
  try {
    return String(getAnchorEventTypeMap([safeTxid]).get(safeTxid) || '').trim();
  } catch (_) {
    return '';
  }
}

function getMarketAnchorTypeFromRawtx(rawtxLike) {
  const rawtx = rawtxHexFromUnknown(rawtxLike);
  if (!rawtx) return '';
  try {
    const text = Buffer.from(rawtx, 'hex').toString('utf8');
    const marker = 'BMMKT2|';
    const idx = text.indexOf(marker);
    if (idx < 0) return '';
    const start = idx + marker.length;
    const end = text.indexOf('|', start);
    if (end <= start) return '';
    return String(text.slice(start, end) || '').trim();
  } catch (_) {
    return '';
  }
}

function isNonWalletMarketAnchorType(type) {
  const safeType = String(type || '').trim();
  if (!safeType) return false;
  if (/^order_/i.test(safeType)) return false;
  if (safeType === 'wallet_key_bind') return true;
  if (/^chat_/i.test(safeType)) return true;
  if (/^profile_/i.test(safeType) || safeType === 'profile') return true;
  if (/^category_/i.test(safeType) || /^product_/i.test(safeType) || safeType === 'catalog') return true;
  if (/^drive_/i.test(safeType) || safeType === 'drive') return true;
  return false;
}

function listUnconfirmedAnchorTxidsWithRawtx(limit = 5000) {
  const cap = Math.max(1, Math.min(Number(limit || 5000), 20000));
  try {
    const db = ensureTxContextDb();
    const rows = db.prepare(`
      SELECT DISTINCT ae.txid AS txid
      FROM anchor_events ae
      JOIN tx_contexts tc ON tc.txid = ae.txid
      WHERE ae.confirmed = 0
        AND ae.txid <> ''
        AND tc.rawtx_hex <> ''
      ORDER BY ae.event_id ASC
      LIMIT ?
    `).all(cap);
    const stalePendingTxids = collectKnownStalePendingTxidSet(getSpvIndex());
    return rows
      .map((row) => String(row?.txid || '').trim().toLowerCase())
      .filter((txid) => /^[0-9a-f]{64}$/i.test(txid))
      .filter((txid) => !stalePendingTxids.has(txid));
  } catch (err) {
    appendSendLog('unconfirmed_anchor_txid_scan_failed', {
      error: String(err?.message || 'scan failed'),
    });
    return [];
  }
}

function setNote(txid, note) {
  const notes = getNotesMap();
  notes[txid] = { note: String(note || ''), updatedAt: new Date().toISOString() };
  writeJson(NOTES_FILE, notes);
}

function normalizeAmountToSats(amount) {
  const sat = Math.floor(Number(amount) * 100000000);
  if (!Number.isFinite(sat) || sat <= 0) throw new Error('Invalid amount');
  return sat;
}

function validateAddress(address) {
  try {
    new bsv.Address(address, NETWORK);
    return true;
  } catch (_) {
    return false;
  }
}

const ORDER_ANCHOR_OUTPUT_SAT = Math.max(0, Number(process.env.BSV_MARKET_ORDER_ANCHOR_OUTPUT_SAT ?? 1));
const ORDER_SETTLEMENT_FEE_RESERVE_SAT = Math.max(
  SAFE_MIN_CHANGE_SAT,
  Number(process.env.BSV_MARKET_ORDER_SETTLEMENT_FEE_RESERVE_SAT || 20000),
);
const ORDER_SHIP_ANCHOR_FEE_RESERVE_SAT = Math.max(
  SAFE_MIN_CHANGE_SAT,
  Number(process.env.BSV_MARKET_ORDER_SHIP_ANCHOR_FEE_RESERVE_SAT || 30000),
);
const ORDER_BUYER_ACCEPT_SIGTYPE = bsv.crypto.Signature.SIGHASH_SINGLE
  | bsv.crypto.Signature.SIGHASH_ANYONECANPAY
  | bsv.crypto.Signature.SIGHASH_FORKID;
const ORDER_COOPERATIVE_SIGTYPE = bsv.crypto.Signature.SIGHASH_ALL
  | bsv.crypto.Signature.SIGHASH_FORKID;
const ORDER_CANCEL_FEE_MARGIN_SAT = 2;

function estimateOrderSettlementDraftRawtxBytes({
  mode = 'completed',
  includeSellerSource = true,
  anchorText = '',
  feeInputCount = 1,
} = {}) {
  const safeMode = String(mode || 'completed').trim() || 'completed';
  const safeIncludeSellerSource = includeSellerSource !== false;
  const anchorPayloadBytes = String(anchorText || '').trim()
    ? Buffer.byteLength(String(anchorText || '').trim(), 'utf8')
    : 0;
  const anchorOutputCount = anchorPayloadBytes > 0 ? 1 : 0;
  const baseOutputCount = 2;
  const effectiveOutputCount = safeMode === 'completed' && safeIncludeSellerSource
    ? baseOutputCount + 1 + anchorOutputCount
    : baseOutputCount + anchorOutputCount;
  const settlementBaseInputCount = safeIncludeSellerSource ? 2 : 1;
  return 10
    + (settlementBaseInputCount * ORDER_SETTLEMENT_MULTISIG_INPUT_ESTIMATE_BYTES)
    + (Math.max(0, Number(feeInputCount || 0)) * 148)
    + ((effectiveOutputCount + 1) * 34)
    + anchorPayloadBytes
    + FINAL_SIGNED_FEE_SAFETY_SAT;
}

function estimateOrderSettlementFeeReserveSat(options = {}) {
  const anchorPayloadBytes = String(options.anchorText || '').trim()
    ? Buffer.byteLength(String(options.anchorText || '').trim(), 'utf8')
    : 0;
  const anchorOutputSat = anchorPayloadBytes > 0 ? ORDER_ANCHOR_OUTPUT_SAT : 0;
  const safeIncludeSellerSource = options.includeSellerSource !== false;
  const baseInputCount = safeIncludeSellerSource ? 2 : 1;
  const draftBytes = estimateOrderSettlementDraftRawtxBytes({
    ...options,
    feeInputCount: Math.max(1, Number(options.feeInputCount || 1)),
  });
  const effectiveOutputCount = String(options.mode || 'completed') === 'completed' && safeIncludeSellerSource
    ? 3 + (anchorPayloadBytes > 0 ? 1 : 0)
    : 2 + (anchorPayloadBytes > 0 ? 1 : 0);
  const settlementFeeSat = Math.max(
    estimateTxFeeSat({
      inputCount: baseInputCount + 1,
      outputCount: effectiveOutputCount + 1,
      feeRate: DEFAULT_FEE_RATE,
    }) + ORDER_SETTLEMENT_FINAL_FEE_SAFETY_SAT,
    requiredFeeForSizeSat(draftBytes, DEFAULT_FEE_RATE) + ORDER_SETTLEMENT_FINAL_FEE_SAFETY_SAT,
  );
  const selectorFeeSat = estimateTxFeeSat({
    inputCount: 1,
    outputCount: effectiveOutputCount + 1,
    feeRate: DEFAULT_FEE_RATE,
  });
  return Math.max(
    SAFE_MIN_CHANGE_SAT,
    Math.ceil(settlementFeeSat + anchorOutputSat + selectorFeeSat + SAFE_MIN_CHANGE_SAT),
  );
}

function estimateAnchorDataFeeReserveSat({
  payloadBytes = 0,
  notifyOutputCount = 0,
  inputCount = 1,
} = {}) {
  const safePayloadBytes = Math.max(0, Number(payloadBytes || 0));
  const safeNotifyOutputCount = Math.max(0, Number(notifyOutputCount || 0));
  const outputCount = 2 + safeNotifyOutputCount;
  const targetSat = ANCHOR_DATA_OUTPUT_SAT + (safeNotifyOutputCount * SAFE_MIN_CHANGE_SAT);
  return Math.max(
    SAFE_MIN_CHANGE_SAT,
    Math.ceil(targetSat + estimateTxFeeSat({
      inputCount: Math.max(1, Number(inputCount || 1)),
      outputCount,
      dataBytes: safePayloadBytes,
      feeRate: DEFAULT_FEE_RATE,
    }) + SAFE_MIN_CHANGE_SAT),
  );
}

function coercePublicKeyHex(value, label = 'public key') {
  const hex = String(value || '').trim();
  if (!/^[0-9a-f]{66}$/i.test(hex)) throw new Error(`Invalid ${label}`);
  return hex;
}

function asPublicKey(value, label = 'public key') {
  return new bsv.PublicKey(coercePublicKeyHex(value, label));
}

function buildOrderBuyerLockRedeemScript({
  buyerChatPubKey,
  sellerChatPubKey,
} = {}) {
  const buyerPub = asPublicKey(buyerChatPubKey, 'buyer chat public key');
  const sellerPub = asPublicKey(sellerChatPubKey, 'seller chat public key');
  const script = new bsv.Script();
  script.add(bsv.Opcode.OP_IF);
  script.add(bsv.Opcode.OP_2);
  script.add(sellerPub.toBuffer());
  script.add(buyerPub.toBuffer());
  script.add(bsv.Opcode.OP_2);
  script.add(bsv.Opcode.OP_CHECKMULTISIG);
  script.add(bsv.Opcode.OP_ELSE);
  script.add(bsv.Opcode.OP_IF);
  script.add(sellerPub.toBuffer());
  script.add(bsv.Opcode.OP_CHECKSIG);
  script.add(bsv.Opcode.OP_ELSE);
  script.add(buyerPub.toBuffer());
  script.add(bsv.Opcode.OP_CHECKSIG);
  script.add(bsv.Opcode.OP_ENDIF);
  script.add(bsv.Opcode.OP_ENDIF);
  return script;
}

function buildOrderJointRedeemScript({
  buyerChatPubKey,
  sellerChatPubKey,
} = {}) {
  const buyerPub = asPublicKey(buyerChatPubKey, 'buyer chat public key');
  const sellerPub = asPublicKey(sellerChatPubKey, 'seller chat public key');
  return bsv.Script.buildMultisigOut([buyerPub, sellerPub], 2);
}

function buildP2shLockingScript(redeemScript) {
  const script = redeemScript instanceof bsv.Script ? redeemScript : new bsv.Script(redeemScript);
  return bsv.Script.buildScriptHashOut(script);
}

function buildOrderEscrowOutputScript(redeemScript) {
  return redeemScript instanceof bsv.Script ? redeemScript : new bsv.Script(redeemScript);
}

function getWalletPrivateKeyForAddress(mnemonic, address) {
  const safeAddress = String(address || '').trim();
  if (!safeAddress) return null;
  const state = getWalletState();
  const row = Array.isArray(state?.addresses)
    ? state.addresses.find((item) => String(item?.address || '').trim() === safeAddress)
    : null;
  if (!row) return null;
  const index = Number(row.index || 0);
  if (!Number.isInteger(index) || index < 0) return null;
  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  return hdPrivateKey.deriveChild(`${state.pathBase || PATH_BASE}/${index}`).privateKey;
}

function getWalletPrivateKeyForP2pkhScript(mnemonic, script) {
  try {
    const lockingScript = script instanceof bsv.Script ? script : new bsv.Script(String(script || '').trim());
    const address = String(lockingScript.toAddress(NETWORK) || '').trim();
    return getWalletPrivateKeyForAddress(mnemonic, address);
  } catch (_) {
    return null;
  }
}

function setP2pkhUnlockScript(tx, inputIndex, privateKey, lockingScript, satoshis) {
  const input = tx.inputs?.[inputIndex];
  if (!input || !privateKey) return false;
  const signatures = input.getSignatures(
    tx,
    privateKey,
    inputIndex,
    bsv.crypto.Signature.SIGHASH_ALL | bsv.crypto.Signature.SIGHASH_FORKID,
  );
  const signature = Array.isArray(signatures) ? signatures[0] : null;
  if (!signature) return false;
  input.addSignature(tx, signature);
  return true;
}

function toScriptHashAddress(redeemScript) {
  return bsv.Address.payingTo(redeemScript, NETWORK).toString();
}

function createManualInput({ prevTxId, outputIndex, outputScript, satoshis }) {
  return new bsv.Transaction.Input({
    prevTxId: String(prevTxId || '').trim(),
    outputIndex: Number(outputIndex || 0),
    script: bsv.Script.empty(),
    output: new bsv.Transaction.Output({
      script: outputScript,
      satoshis: Number(satoshis || 0),
    }),
  });
}

function attachManualInputOutput(tx, inputIndex, outputScript, satoshis) {
  const safeIndex = Number(inputIndex || 0);
  const input = tx?.inputs?.[safeIndex];
  if (!input || !outputScript || !(Number(satoshis || 0) > 0)) return false;
  const output = new bsv.Transaction.Output({
    script: outputScript,
    satoshis: Number(satoshis || 0),
  });
  if (outputScript?.isPublicKeyHashOut && outputScript.isPublicKeyHashOut()) {
    tx.inputs[safeIndex] = new bsv.Transaction.Input.PublicKeyHash({
      prevTxId: input.prevTxId,
      outputIndex: input.outputIndex,
      sequenceNumber: input.sequenceNumber,
      script: input.script || bsv.Script.empty(),
      output,
    });
    return true;
  }
  input.output = output;
  return true;
}

function buildOrderAnchorPayloadText(payload = {}) {
  return JSON.stringify({
    protocol: 'bsv_market_order_v1',
    ...payload,
  });
}

function buildOrderAnchorOutput(text) {
  const payloadText = String(text || '').trim();
  if (!payloadText) return null;
  return new bsv.Transaction.Output({
    script: bsv.Script.buildDataOut(Buffer.from(payloadText, 'utf8')),
    satoshis: ORDER_ANCHOR_OUTPUT_SAT,
  });
}

function buildOrderStateTransitionTx({
  mnemonic,
  orderId,
  status,
  placeTxid = '',
  note = '',
  extra = null,
  excludeOutpoints = null,
} = {}) {
  assertWalletSendAllowed('order_state_transition');
  const payload = {
    protocol: 'bsv_market_order_state_v1',
    orderId: String(orderId || '').trim(),
    status: String(status || '').trim(),
    placeTxid: String(placeTxid || '').trim(),
  };
  if (!payload.orderId) throw new Error('orderId is required');
  if (!payload.status) throw new Error('status is required');
  if (extra && typeof extra === 'object') payload.extra = { ...extra };
  const text = JSON.stringify(payload);
  const payloadBytes = Buffer.byteLength(text, 'utf8');
  if (Buffer.byteLength(text, 'utf8') > MAX_ANCHOR_PAYLOAD_BYTES) {
    throw new Error(`Order state payload too large (max ${MAX_ANCHOR_PAYLOAD_BYTES} bytes UTF-8)`);
  }
  const estimatedStateTxSizeBytes = Math.max(620, 420 + payloadBytes);
  const estimatedStateFeeSat = requiredFeeForSizeSat(estimatedStateTxSizeBytes, DEFAULT_FEE_RATE) + FINAL_SIGNED_FEE_SAFETY_SAT;
  const { state, selection } = selectOrderFundingContext(mnemonic, {
    targetSat: ORDER_ANCHOR_OUTPUT_SAT + estimatedStateFeeSat + SAFE_MIN_CHANGE_SAT,
    outputCount: 2,
    dataBytes: payloadBytes,
    excludeOutpoints,
    requireConfirmed: true,
    action: 'building order state transition',
  });
  const selected = selection.utxos;
  const tx = new bsv.Transaction();
  tx.from(selected);
  tx.addOutput(buildOrderAnchorOutput(text));
  const changeAddress = new bsv.Address(getReceiveAddressFromState(state), NETWORK);
  const feePlan = finalizeFeeAndSign(tx, selected, changeAddress, DEFAULT_FEE_RATE, SAFE_MIN_CHANGE_SAT);
  const rawtx = tx.serialize();
  const txid = tx.id;
  if (note && String(note).trim()) setNote(txid, String(note).trim());
  return {
    rawtx,
    txid,
    feeSat: Number(feePlan.feeSat || 0),
    stateVout: 0,
    payload,
  };
}

function getSpendableWalletContext(mnemonic, options = {}) {
  const state = getWalletState();
  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  const index = options.index && typeof options.index === 'object'
    ? options.index
    : getSpvIndex(options.forceReload === true ? { forceReload: true } : undefined);
  const utxos = listSpendableUtxosForState(state, hdPrivateKey, {
    includeUnconfirmed: options.includeUnconfirmed === true,
    maxAncestorDepth: Number.isFinite(Number(options.maxAncestorDepth))
      ? Number(options.maxAncestorDepth)
      : SEND_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
    excludeOutpoints: options.excludeOutpoints || null,
    index,
    allowLocalOwnedChain: options.allowLocalOwnedChain === true,
    ignoreLocalChainCheck: options.ignoreLocalChainCheck === true,
  });
  return { state, hdPrivateKey, utxos };
}

function listOrderFundingUtxos(state, hdPrivateKey, index, options = {}) {
  const pathBase = state.pathBase || PATH_BASE;
  const addressToIndex = new Map((state.addresses || []).map((a) => [a.address, a.index]));
  const requireConfirmed = options.requireConfirmed === true;
  const excludeOutpoints = options.excludeOutpoints instanceof Set
    ? options.excludeOutpoints
    : new Set(Array.isArray(options.excludeOutpoints) ? options.excludeOutpoints : []);
  const locallySpentOutpoints = getTxContextSpentOutpoints();
  const candidateUtxos = new Map();
  const ensureCandidate = (outpoint, seed = {}) => {
    if (!outpoint || excludeOutpoints.has(outpoint) || index?.spentOutpoints?.[outpoint] || locallySpentOutpoints.has(outpoint)) return;
    const match = String(outpoint || '').match(/^([0-9a-f]{64}):(\d+)$/i);
    if (!match) return;
    const txId = String(match[1] || '').trim().toLowerCase();
    const vout = Number(match[2] || 0);
    const ctxRow = getTxContextByTxid(txId);
    const rawtx = rawtxHexFromUnknown(ctxRow?.rawtx);
    let address = String(seed?.address || '').trim();
    let satoshis = Number(seed?.satoshis || 0);
    let actualScriptHex = '';
    if (rawtx) {
      try {
        const tx = new bsv.Transaction(rawtx);
        const output = tx.outputs?.[vout];
        actualScriptHex = typeof output?.script?.toHex === 'function'
          ? String(output.script.toHex() || '').toLowerCase()
          : '';
        if (!address) {
          const maybeAddress = output?.script?.toAddress?.(NETWORK);
          address = String(maybeAddress || '').trim();
        }
        if (!(satoshis > 0)) {
          satoshis = Number(output?.satoshis || 0);
        }
      } catch (_) {}
    }
    if (!(satoshis > 0)) satoshis = Number(index?.ownedOutpoints?.[outpoint] || 0);
    if (!address || !addressToIndex.has(address) || !(satoshis > 0)) return;
    if (rawtx) {
      const expectedScriptHex = bsv.Script.buildPublicKeyHashOut(address).toHex();
      if (!actualScriptHex || actualScriptHex !== String(expectedScriptHex || '').toLowerCase()) return;
    }
    const confirmed = Boolean(index?.txs?.[txId]?.confirmed);
    if (!confirmed && !rawtx) return;
    const idx = addressToIndex.get(address);
    const privKey = hdPrivateKey.deriveChild(`${pathBase}/${idx}`).privateKey;
    candidateUtxos.set(outpoint, {
      txId,
      vout,
      script: bsv.Script.buildPublicKeyHashOut(address),
      satoshis,
      confirmed,
      ancestorDepth: getTxAncestorDepth(index, txId),
      privKey,
    });
  };
  for (const [outpoint, utxo] of Object.entries(index?.utxos || {})) {
    ensureCandidate(outpoint, {
      address: utxo?.address,
      satoshis: Number(utxo?.satoshis || 0),
    });
  }
  for (const [outpoint, satoshis] of Object.entries(index?.ownedOutpoints || {})) {
    if (candidateUtxos.has(outpoint)) continue;
    ensureCandidate(outpoint, { satoshis: Number(satoshis || 0) });
  }
  return Array.from(candidateUtxos.values()).filter((utxo) => {
    if (!requireConfirmed) return true;
    return utxo?.confirmed === true;
  }).sort((a, b) => {
    if (Number(b.confirmed) !== Number(a.confirmed)) return Number(b.confirmed) - Number(a.confirmed);
    if (Number(a.ancestorDepth || 0) !== Number(b.ancestorDepth || 0)) return Number(a.ancestorDepth || 0) - Number(b.ancestorDepth || 0);
    return Number(b.satoshis || 0) - Number(a.satoshis || 0);
  });
}

function selectOrderFundingContext(mnemonic, {
  targetSat,
  outputCount = 2,
  dataBytes = 0,
  excludeOutpoints = null,
  requireConfirmed = false,
  allowConsolidation = false,
  action = 'processing order',
} = {}) {
  const buildContext = () => {
    const state = getWalletState();
    const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
    const index = readJson(SPV_INDEX_FILE, {
      version: 1,
      utxos: {},
      ownedOutpoints: {},
      spentOutpoints: {},
      txs: {},
      updatedAt: null,
    });
    const utxos = listOrderFundingUtxos(state, hdPrivateKey, index, {
      excludeOutpoints,
      requireConfirmed,
    });
    return { state, hdPrivateKey, utxos, index };
  };
  const summarize = (ctx, forceReload = false) => ({
    spvIndexFile: SPV_INDEX_FILE,
    action,
    forceReload,
      targetSat: Math.max(0, Number(targetSat || 0)),
      outputCount: Math.max(1, Number(outputCount || 1)),
      dataBytes: Math.max(0, Number(dataBytes || 0)),
      requireConfirmed,
      allowConsolidation,
      utxoCount: Array.isArray(ctx?.utxos) ? ctx.utxos.length : 0,
    utxos: (Array.isArray(ctx?.utxos) ? ctx.utxos : []).map((u) => ({
      txId: String(u?.txId || ''),
      vout: Number(u?.vout || 0),
      satoshis: Number(u?.satoshis || 0),
      confirmed: Boolean(u?.confirmed),
      ancestorDepth: Number(u?.ancestorDepth || 0),
    })),
  });
  let context = buildContext();
  appendSendLog('order_funding_context', summarize(context, false));
  const selectFrom = (ctx) => selectUtxosForTransaction(ctx.utxos, {
    targetSat: Math.max(0, Number(targetSat || 0)),
    outputCount,
    dataBytes: Math.max(0, Number(dataBytes || 0)),
    feeRate: DEFAULT_FEE_RATE,
    allowConsolidation: allowConsolidation === true,
    preferSingleInput: true,
  });
  if (!context.utxos.length) {
    context = buildContext();
    appendSendLog('order_funding_context', summarize(context, true));
  }
  if (!context.utxos.length) {
    throw buildSpendableUtxoError(context.state, context.hdPrivateKey, action, ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH);
  }
  try {
    return { ...context, selection: selectFrom(context) };
  } catch (err) {
    appendSendLog('order_funding_select_failed', {
      action,
      targetSat: Math.max(0, Number(targetSat || 0)),
      dataBytes: Math.max(0, Number(dataBytes || 0)),
      message: String(err?.message || ''),
    });
    if (!/Insufficient spendable balance/i.test(String(err?.message || ''))) throw err;
    const refreshed = buildContext();
    appendSendLog('order_funding_context', summarize(refreshed, true));
    if (!refreshed.utxos.length) {
      throw buildSpendableUtxoError(refreshed.state, refreshed.hdPrivateKey, action, ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH);
    }
    return { ...refreshed, selection: selectFrom(refreshed) };
  }
}

function addP2pkhChangeOutput(tx, address, satoshis) {
  const safeSats = Math.max(0, Number(satoshis || 0));
  if (safeSats <= 0) return null;
  const output = new bsv.Transaction.Output({
    script: bsv.Script.buildPublicKeyHashOut(address),
    satoshis: safeSats,
  });
  tx.addOutput(output);
  return output;
}

function buildOrderPlaceLockTx({
  mnemonic,
  orderId,
  priceBsv = null,
  priceSats = null,
  sellerChatPubKey,
  timeoutAt,
  anchorText = '',
  notifyAddresses = [],
  note = '',
} = {}) {
  assertWalletSendAllowed('order_place');
  const buyerChat = deriveChatKeypairFromMnemonic(mnemonic);
  const hasExplicitPriceSats = priceSats !== null
    && priceSats !== undefined
    && String(priceSats).trim() !== ''
    && Number.isFinite(Number(priceSats));
  const unitPriceSats = hasExplicitPriceSats
    ? Math.max(0, Math.floor(Number(priceSats)))
    : normalizeAmountToSats(priceBsv);
  const buyerDepositSats = Math.floor(unitPriceSats * 0.2);
  const buyerLockSats = unitPriceSats + buyerDepositSats;
  const safeAnchorText = String(anchorText || '').trim();
  const notificationOutputs = Array.from(new Set((Array.isArray(notifyAddresses) ? notifyAddresses : [notifyAddresses])
    .map((address) => String(address || '').trim())
    .filter(Boolean)));
  const payloadBytes = safeAnchorText ? Buffer.byteLength(safeAnchorText, 'utf8') : 0;
  if (payloadBytes > MAX_ANCHOR_PAYLOAD_BYTES) {
    throw new Error(`Order place payload too large (max ${MAX_ANCHOR_PAYLOAD_BYTES} bytes UTF-8)`);
  }
  const { state, selection } = selectOrderFundingContext(mnemonic, {
    targetSat: buyerLockSats + (safeAnchorText ? ORDER_ANCHOR_OUTPUT_SAT : 0) + (notificationOutputs.length * SAFE_MIN_CHANGE_SAT),
    outputCount: (safeAnchorText ? 3 : 2) + notificationOutputs.length,
    dataBytes: payloadBytes,
    requireConfirmed: false,
    action: 'placing order',
  });
  const selected = selection.utxos;
  const buyerRefundAddress = getReceiveAddressFromState(state);
  const buyerLockRedeemScript = bsv.Script.buildPublicKeyHashOut(buyerRefundAddress);
  const buyerLockScript = buyerLockRedeemScript;
  const tx = new bsv.Transaction();
  tx.from(selected);
  tx.addOutput(new bsv.Transaction.Output({
    script: buyerLockScript,
    satoshis: buyerLockSats,
  }));
  if (safeAnchorText) {
    tx.addOutput(buildOrderAnchorOutput(safeAnchorText));
  }
  for (const address of notificationOutputs) {
    tx.to(new bsv.Address(address, NETWORK), SAFE_MIN_CHANGE_SAT);
  }
  const changeAddress = new bsv.Address(getReceiveAddressFromState(state), NETWORK);
  const feePlan = finalizeFeeAndSign(tx, selected, changeAddress, DEFAULT_FEE_RATE, SAFE_MIN_CHANGE_SAT);
  const rawtx = tx.serialize();
  const txid = tx.id;
  if (note && String(note).trim()) setNote(txid, String(note).trim());
  return {
    rawtx,
    txid,
    feeSat: Number(feePlan.feeSat || 0),
    buyerChatPubKey: buyerChat.chatPubKey,
    sellerChatPubKey: coercePublicKeyHex(sellerChatPubKey, 'seller chat public key'),
    buyerRefundAddress,
    buyerLockSats,
    buyerDepositSats,
    priceSats: unitPriceSats,
    buyerLockVout: 0,
    anchorVout: safeAnchorText ? 1 : -1,
    buyerLockRedeemScriptHex: buyerLockRedeemScript.toHex(),
    buyerLockScriptHex: buyerLockScript.toHex(),
    buyerLockAddress: '',
    timeoutAt: Math.max(0, Math.floor(Number(timeoutAt || 0))),
  };
}

function getOrderPlaceContext(mnemonic) {
  const state = getWalletState();
  const buyerChat = deriveChatKeypairFromMnemonic(mnemonic);
  return {
    buyerChatPubKey: buyerChat.chatPubKey,
    buyerRefundAddress: getReceiveAddressFromState(state),
  };
}

function computeOrderSellerDepositSats(priceSats) {
  const safePrice = Math.max(0, Math.floor(Number(priceSats || 0)));
  if (safePrice <= 0) return 0;
  return Math.max(MIN_ORDER_ESCROW_OUTPUT_SATS, Math.floor(safePrice * 0.10));
}

function buildOrderSellerLockTx({
  mnemonic,
  orderId,
  priceSats,
  buyerChatPubKey,
  sellerChatPubKey = '',
  anchorText = '',
  notifyAddresses = [],
  settlementFeeReserveSats = ORDER_SETTLEMENT_FEE_RESERVE_SAT,
  shipAnchorFeeReserveSats = ORDER_SHIP_ANCHOR_FEE_RESERVE_SAT,
  note = '',
  excludeOutpoints = null,
} = {}) {
  assertWalletSendAllowed('order_accept');
  const sellerChat = deriveChatKeypairFromMnemonic(mnemonic);
  const sellerPubKey = sellerChatPubKey ? coercePublicKeyHex(sellerChatPubKey, 'seller chat public key') : sellerChat.chatPubKey;
  if (sellerPubKey !== sellerChat.chatPubKey) throw new Error('seller chat public key does not match mnemonic');
  const sellerLockSats = computeOrderSellerDepositSats(priceSats);
  const safeAnchorText = String(anchorText || '').trim();
  const notificationOutputs = Array.from(new Set((Array.isArray(notifyAddresses) ? notifyAddresses : [notifyAddresses])
    .map((address) => String(address || '').trim())
    .filter(Boolean)));
  const payloadBytes = safeAnchorText ? Buffer.byteLength(safeAnchorText, 'utf8') : 0;
  if (payloadBytes > MAX_ANCHOR_PAYLOAD_BYTES) {
    throw new Error(`Order accept payload too large (max ${MAX_ANCHOR_PAYLOAD_BYTES} bytes UTF-8)`);
  }
  const feeReserveSats = Math.max(
    SAFE_MIN_CHANGE_SAT,
    Math.floor(Number(settlementFeeReserveSats || 0)),
    estimateOrderSettlementFeeReserveSat({
      mode: 'completed',
      includeSellerSource: true,
      anchorText: '',
    }),
  );
  const shipFeeReserveSats = Math.max(
    SAFE_MIN_CHANGE_SAT,
    Math.floor(Number(shipAnchorFeeReserveSats || 0)),
    estimateAnchorDataFeeReserveSat({
      payloadBytes: Math.max(payloadBytes, 0),
      notifyOutputCount: notificationOutputs.length,
    }),
  );
	  const { state, selection } = selectOrderFundingContext(mnemonic, {
	    targetSat: sellerLockSats + feeReserveSats + shipFeeReserveSats + (safeAnchorText ? ORDER_ANCHOR_OUTPUT_SAT : 0) + (notificationOutputs.length * SAFE_MIN_CHANGE_SAT),
	    outputCount: (safeAnchorText ? 5 : 4) + notificationOutputs.length,
	    dataBytes: payloadBytes,
	    excludeOutpoints,
	    requireConfirmed: true,
	    action: 'locking seller deposit',
	  });
  const jointRedeemScript = buildOrderJointRedeemScript({
    buyerChatPubKey,
    sellerChatPubKey: sellerPubKey,
  });
  const jointScript = buildOrderEscrowOutputScript(jointRedeemScript);
  const selected = selection.utxos;
  const sellerLockAddress = getReceiveAddressFromState(state);
  const tx = new bsv.Transaction();
  tx.from(selected);
  tx.addOutput(new bsv.Transaction.Output({
    script: bsv.Script.buildPublicKeyHashOut(sellerLockAddress),
    satoshis: sellerLockSats,
  }));
  if (safeAnchorText) {
    tx.addOutput(buildOrderAnchorOutput(safeAnchorText));
  }
  const changeAddress = new bsv.Address(getReceiveAddressFromState(state), NETWORK);
  const settlementFeeVout = tx.outputs.length;
  tx.to(changeAddress, feeReserveSats);
  const shipAnchorFeeVout = tx.outputs.length;
  tx.to(changeAddress, shipFeeReserveSats);
  for (const address of notificationOutputs) {
    tx.to(new bsv.Address(address, NETWORK), SAFE_MIN_CHANGE_SAT);
  }
  const feePlan = finalizeFeeAndSign(tx, selected, changeAddress, DEFAULT_FEE_RATE, SAFE_MIN_CHANGE_SAT);
  const rawtx = tx.serialize();
  const txid = tx.id;
  let changeUtxo = null;
  try {
    const signedTx = new bsv.Transaction(rawtx);
    const ownAddress = String(getReceiveAddressFromState(state) || '').trim();
    for (let vout = 0; vout < (signedTx.outputs || []).length; vout += 1) {
      if (vout === 0) continue;
      const output = signedTx.outputs[vout];
      const outAddress = String(output?.script?.toAddress?.(NETWORK) || '').trim();
      const satoshis = Number(output?.satoshis || 0);
      if (outAddress && ownAddress && outAddress === ownAddress && satoshis > 0) {
        changeUtxo = {
          txId: txid,
          vout,
          satoshis,
          confirmed: false,
          ancestorDepth: ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
          script: bsv.Script.buildPublicKeyHashOut(ownAddress),
          privKey: selected[0]?.privKey || null,
        };
        break;
      }
    }
  } catch (_) {}
  if (note && String(note).trim()) setNote(txid, String(note).trim());
  return {
    rawtx,
    txid,
    feeSat: Number(feePlan.feeSat || 0),
    sellerLockSats,
    sellerLockVout: 0,
    anchorVout: safeAnchorText ? 1 : -1,
    settlementFeeReserveSats: feeReserveSats,
    settlementFeeVout,
    settlementFeeUtxo: {
      txId: txid,
      vout: settlementFeeVout,
      satoshis: feeReserveSats,
      confirmed: false,
      ancestorDepth: ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
      script: bsv.Script.buildPublicKeyHashOut(getReceiveAddressFromState(state)),
      privKey: selected[0]?.privKey || null,
    },
    shipAnchorFeeReserveSats: shipFeeReserveSats,
    shipAnchorFeeVout,
    shipAnchorFeeUtxo: {
      txId: txid,
      vout: shipAnchorFeeVout,
      satoshis: shipFeeReserveSats,
      confirmed: false,
      ancestorDepth: ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
      script: bsv.Script.buildPublicKeyHashOut(getReceiveAddressFromState(state)),
      privKey: selected[0]?.privKey || null,
    },
    jointRedeemScriptHex: bsv.Script.buildPublicKeyHashOut(sellerLockAddress).toHex(),
    jointScriptHex: bsv.Script.buildPublicKeyHashOut(sellerLockAddress).toHex(),
    jointAddress: '',
    feeInputOutpoints: selected.map((u) => `${String(u.txId || '').trim()}:${Number(u.vout || 0)}`),
    changeUtxo,
  };
}

function buildOrderAcceptBuyerTemplate({
  mnemonic,
  buyerLockTxid,
  buyerLockVout = 0,
  buyerLockSats,
  buyerLockRedeemScriptHex,
  buyerChatPubKey = '',
  sellerChatPubKey,
} = {}) {
  const buyerChat = deriveChatKeypairFromMnemonic(mnemonic);
  const buyerPubKey = buyerChatPubKey ? coercePublicKeyHex(buyerChatPubKey, 'buyer chat public key') : buyerChat.chatPubKey;
  if (buyerPubKey !== buyerChat.chatPubKey) throw new Error('buyer chat public key does not match mnemonic');
  const buyerLockRedeemScript = new bsv.Script(String(buyerLockRedeemScriptHex || '').trim());
  const jointRedeemScript = buildOrderJointRedeemScript({ buyerChatPubKey: buyerPubKey, sellerChatPubKey });
  const tx = new bsv.Transaction();
  tx.addInput(createManualInput({
    prevTxId: buyerLockTxid,
    outputIndex: buyerLockVout,
    outputScript: buildOrderEscrowOutputScript(buyerLockRedeemScript),
    satoshis: buyerLockSats,
  }));
  tx.addOutput(new bsv.Transaction.Output({
    script: buildOrderEscrowOutputScript(jointRedeemScript),
    satoshis: Number(buyerLockSats || 0),
  }));
  const p2pkhPrivKey = buyerLockRedeemScript.isPublicKeyHashOut && buyerLockRedeemScript.isPublicKeyHashOut()
    ? getWalletPrivateKeyForP2pkhScript(mnemonic, buyerLockRedeemScript)
    : null;
  const sig = p2pkhPrivKey ? null : bsv.Transaction.Sighash.sign(
    tx,
    buyerChat.privateKey,
    ORDER_BUYER_ACCEPT_SIGTYPE,
    0,
    buyerLockRedeemScript,
    new bsv.crypto.BN(Number(buyerLockSats || 0)),
  );
  if (p2pkhPrivKey) {
    setP2pkhUnlockScript(tx, 0, p2pkhPrivKey, buyerLockRedeemScript, buyerLockSats);
  }
  return {
    templateRawtx: tx.uncheckedSerialize(),
    buyerSignatureHex: sig ? sig.toTxFormat().toString('hex') : '',
    sigtype: ORDER_BUYER_ACCEPT_SIGTYPE,
    jointRedeemScriptHex: jointRedeemScript.toHex(),
    jointAddress: '',
  };
}

function buildOrderSellerCancelTemplate({
  mnemonic,
  buyerLockTxid,
  buyerLockVout = 0,
  buyerLockSats,
  buyerLockRedeemScriptHex,
  buyerRefundAddress,
  buyerChatPubKey = '',
} = {}) {
  const buyerChat = deriveChatKeypairFromMnemonic(mnemonic);
  const buyerPubKey = buyerChatPubKey ? coercePublicKeyHex(buyerChatPubKey, 'buyer chat public key') : buyerChat.chatPubKey;
  if (buyerPubKey !== buyerChat.chatPubKey) throw new Error('buyer chat public key does not match mnemonic');
  if (!validateAddress(buyerRefundAddress)) throw new Error('Invalid buyer refund address');
  const buyerLockRedeemScript = new bsv.Script(String(buyerLockRedeemScriptHex || '').trim());
  const tx = new bsv.Transaction();
  tx.addInput(createManualInput({
    prevTxId: buyerLockTxid,
    outputIndex: buyerLockVout,
    outputScript: buildOrderEscrowOutputScript(buyerLockRedeemScript),
    satoshis: buyerLockSats,
  }));
  tx.addOutput(new bsv.Transaction.Output({
    script: bsv.Script.buildPublicKeyHashOut(buyerRefundAddress),
    satoshis: Number(buyerLockSats || 0),
  }));
  const sig = bsv.Transaction.Sighash.sign(
    tx,
    buyerChat.privateKey,
    ORDER_BUYER_ACCEPT_SIGTYPE,
    0,
    buyerLockRedeemScript,
    new bsv.crypto.BN(Number(buyerLockSats || 0)),
  );
  return {
    templateRawtx: tx.uncheckedSerialize(),
    buyerSignatureHex: sig.toTxFormat().toString('hex'),
    sigtype: ORDER_BUYER_ACCEPT_SIGTYPE,
  };
}

function setOrderBuyerLockCooperativeUnlockScript(tx, inputIndex, buyerSignatureHex, sellerSignatureHex, buyerLockRedeemScriptHex) {
  const script = new bsv.Script();
  const variant = getOrderBuyerLockScriptVariant(buyerLockRedeemScriptHex);
  if (variant === 'cooperative_buyer_seller_cancel') {
    script.add(Buffer.alloc(0));
    script.add(Buffer.from(String(sellerSignatureHex || '').trim(), 'hex'));
    script.add(Buffer.from(String(buyerSignatureHex || '').trim(), 'hex'));
    script.add(bsv.Opcode.OP_1);
  } else {
    script.add(Buffer.alloc(0));
    script.add(Buffer.from(String(buyerSignatureHex || '').trim(), 'hex'));
    script.add(Buffer.from(String(sellerSignatureHex || '').trim(), 'hex'));
  }
  tx.inputs[inputIndex].setScript(script);
}

function getOrderBuyerLockScriptVariant(buyerLockRedeemScriptHex) {
  const script = new bsv.Script(String(buyerLockRedeemScriptHex || '').trim());
  const asm = String(script.toASM() || '').trim();
  if (!asm) return 'unknown';
  if (asm.includes('OP_ELSE OP_IF')) return 'cooperative_buyer_seller_cancel';
  if (asm.includes('OP_CHECKMULTISIG OP_ELSE') && asm.endsWith('OP_CHECKSIG OP_ENDIF')) {
    return 'cooperative_buyer_cancel';
  }
  return 'unknown';
}

function setOrderBuyerLockBuyerCancelUnlockScript(tx, inputIndex, buyerSignatureHex, buyerLockRedeemScriptHex) {
  const script = new bsv.Script();
  const variant = getOrderBuyerLockScriptVariant(buyerLockRedeemScriptHex);
  script.add(Buffer.from(String(buyerSignatureHex || '').trim(), 'hex'));
  if (variant === 'cooperative_buyer_seller_cancel') {
    script.add(bsv.Opcode.OP_0);
    script.add(bsv.Opcode.OP_0);
  } else {
    script.add(bsv.Opcode.OP_0);
    script.add(new bsv.Script(String(buyerLockRedeemScriptHex || '').trim()).toBuffer());
  }
  tx.inputs[inputIndex].setScript(script);
}

function setOrderBuyerLockSellerCancelUnlockScript(tx, inputIndex, sellerSignatureHex, buyerLockRedeemScriptHex) {
  const variant = getOrderBuyerLockScriptVariant(buyerLockRedeemScriptHex);
  if (variant !== 'cooperative_buyer_seller_cancel') {
    throw new Error('Seller cancel is unavailable for this order lock script');
  }
  const script = new bsv.Script();
  script.add(Buffer.from(String(sellerSignatureHex || '').trim(), 'hex'));
  script.add(bsv.Opcode.OP_1);
  script.add(bsv.Opcode.OP_0);
  tx.inputs[inputIndex].setScript(script);
}

function extractMultisigSignatureHexesFromInput(input) {
  const chunks = Array.isArray(input?.script?.chunks) ? input.script.chunks : [];
  if (!chunks.length) return [];
  const results = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const buf = Buffer.isBuffer(chunk?.buf) ? chunk.buf : null;
    if (!buf || !buf.length) continue;
    const looksLikeDerSignature = buf[0] === 0x30 && buf.length >= 8;
    if (i === chunks.length - 1 && !looksLikeDerSignature) continue;
    results.push(buf.toString('hex'));
  }
  return results;
}

function setOrderJointUnlockScript(tx, inputIndex, jointRedeemScriptHex, signatureHexes = []) {
  const script = new bsv.Script();
  script.add(bsv.Opcode.OP_0);
  for (const signatureHex of signatureHexes) {
    const safeHex = String(signatureHex || '').trim();
    if (!safeHex) continue;
    script.add(Buffer.from(safeHex, 'hex'));
  }
  tx.inputs[inputIndex].setScript(script);
}

function buildOrderAcceptFinalizeTx({
  mnemonic,
  templateRawtx,
  buyerSignatureHex,
  buyerLockRedeemScriptHex,
  excludeOutpoints = null,
  feeUtxosOverride = null,
} = {}) {
  const { state, selection } = selectOrderFundingContext(mnemonic, {
    targetSat: 1,
    outputCount: 2,
    excludeOutpoints,
    action: 'finalizing buyer joint lock',
  });
  const sellerChat = deriveChatKeypairFromMnemonic(mnemonic);
  let tx = new bsv.Transaction(String(templateRawtx || '').trim());
  const overrideFeeUtxos = Array.isArray(feeUtxosOverride)
    ? feeUtxosOverride.filter((u) => u && Number(u.satoshis || 0) > 0 && u.privKey)
    : [];
  const feeUtxos = overrideFeeUtxos.length
    ? overrideFeeUtxos
    : selection.utxos;
  tx.from(feeUtxos);
  const totalFeeInputSat = feeUtxos.reduce((sum, u) => sum + Number(u.satoshis || 0), 0);
  const changeAddress = getReceiveAddressFromState(state);
  const buyerLockRedeemScript = new bsv.Script(String(buyerLockRedeemScriptHex || '').trim());
  const sellerSig = bsv.Transaction.Sighash.sign(
    tx,
    sellerChat.privateKey,
    ORDER_BUYER_ACCEPT_SIGTYPE,
    0,
    buyerLockRedeemScript,
    new bsv.crypto.BN(Number(tx.inputs?.[0]?.output?.satoshis || 0)),
  );
  const sellerSignatureHex = sellerSig.toTxFormat().toString('hex');
  const rebuildSignedTx = (feeSat) => {
    tx = new bsv.Transaction(String(templateRawtx || '').trim());
    tx.from(feeUtxos);
    const changeSat = totalFeeInputSat - Number(feeSat || 0);
    if (changeSat >= SAFE_MIN_CHANGE_SAT) {
      addP2pkhChangeOutput(tx, changeAddress, changeSat);
    }
    setOrderBuyerLockCooperativeUnlockScript(tx, 0, buyerSignatureHex, sellerSignatureHex, buyerLockRedeemScriptHex);
    signTransactionInputsAtOffset(tx, feeUtxos, 1);
    return tx;
  };
  const acceptEstimatedSizeBytes = (
    10
    + ORDER_SETTLEMENT_MULTISIG_INPUT_ESTIMATE_BYTES
    + (feeUtxos.length * 148)
    + ((2 + 1) * 34)
  );
  let feeSat = Math.max(
    estimateTxFeeSat({ inputCount: tx.inputs.length, outputCount: 2, feeRate: DEFAULT_FEE_RATE }),
    requiredFeeForSizeSat(acceptEstimatedSizeBytes, DEFAULT_FEE_RATE) + FINAL_SIGNED_FEE_SAFETY_SAT,
  );
  for (let i = 0; i < 8; i += 1) {
    rebuildSignedTx(feeSat);
    const sizeBytes = Buffer.from(tx.uncheckedSerialize(), 'hex').length;
    const estimatedSignedSizeBytes = Math.max(sizeBytes, acceptEstimatedSizeBytes);
    const requiredFeeSat = requiredFeeForSizeSat(estimatedSignedSizeBytes, DEFAULT_FEE_RATE) + FINAL_SIGNED_FEE_SAFETY_SAT;
    if (requiredFeeSat === feeSat) break;
    feeSat = requiredFeeSat;
  }
  rebuildSignedTx(feeSat);
  const rawtx = tx.uncheckedSerialize();
  return {
    rawtx,
    txid: txidFromRaw(rawtx),
    feeSat,
    sellerSignatureHex,
    feeInputOutpoints: feeUtxos.map((u) => `${String(u.txId || '').trim()}:${Number(u.vout || 0)}`),
  };
}

function buildOrderTimeoutCancelTx({
  mnemonic,
  buyerLockTxid,
  buyerLockVout = 0,
  buyerLockSats,
  buyerLockRedeemScriptHex,
  buyerRefundAddress = '',
  timeoutAt = 0,
  excludeOutpoints = null,
} = {}) {
  const { state, hdPrivateKey, utxos } = getSpendableWalletContext(mnemonic, {
    includeUnconfirmed: true,
    maxAncestorDepth: ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
    forceReload: true,
    allowLocalOwnedChain: true,
    ignoreLocalChainCheck: true,
    excludeOutpoints,
  });
  const buyerChat = deriveChatKeypairFromMnemonic(mnemonic);
  const refundAddress = validateAddress(buyerRefundAddress) ? buyerRefundAddress : getReceiveAddressFromState(state);
  const buyerLockRedeemScript = new bsv.Script(String(buyerLockRedeemScriptHex || '').trim());
  let tx = new bsv.Transaction();
  const rebuildSignedTx = (feeSat) => {
    const refundSat = Number(buyerLockSats || 0) - Number(feeSat || 0);
    if (refundSat <= 0) throw new Error('Insufficient spendable balance');
    tx = new bsv.Transaction();
    tx.addInput(createManualInput({
      prevTxId: buyerLockTxid,
      outputIndex: buyerLockVout,
      outputScript: buildOrderEscrowOutputScript(buyerLockRedeemScript),
      satoshis: buyerLockSats,
    }));
    tx.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.buildPublicKeyHashOut(refundAddress),
      satoshis: refundSat,
    }));
    if (buyerLockRedeemScript.isPublicKeyHashOut && buyerLockRedeemScript.isPublicKeyHashOut()) {
      const privKey = getWalletPrivateKeyForP2pkhScript(mnemonic, buyerLockRedeemScript);
      if (!privKey || !setP2pkhUnlockScript(tx, 0, privKey, buyerLockRedeemScript, buyerLockSats)) {
        throw new Error('Buyer lock key is unavailable');
      }
    } else {
      const buyerSig = bsv.Transaction.Sighash.sign(
        tx,
        buyerChat.privateKey,
        ORDER_COOPERATIVE_SIGTYPE,
        0,
        buyerLockRedeemScript,
        new bsv.crypto.BN(Number(buyerLockSats || 0)),
      );
      setOrderBuyerLockBuyerCancelUnlockScript(tx, 0, buyerSig.toTxFormat().toString('hex'), buyerLockRedeemScriptHex);
    }
    return tx;
  };
  let feeSat = estimateTxFeeSat({ inputCount: 1, outputCount: 1, feeRate: DEFAULT_FEE_RATE });
  for (let i = 0; i < 8; i += 1) {
    rebuildSignedTx(feeSat);
    const sizeBytes = Buffer.from(tx.uncheckedSerialize(), 'hex').length;
    const requiredFeeSat = requiredFeeForSizeSat(sizeBytes, DEFAULT_FEE_RATE) + FINAL_SIGNED_FEE_SAFETY_SAT + ORDER_CANCEL_FEE_MARGIN_SAT;
    if (requiredFeeSat === feeSat) break;
    feeSat = requiredFeeSat;
  }
  rebuildSignedTx(feeSat);
  const rawtx = tx.uncheckedSerialize();
  return {
    rawtx,
    txid: txidFromRaw(rawtx),
    feeSat,
    feeInputOutpoints: [],
  };
}

function buildOrderSellerCancelTx({
  mnemonic,
  buyerLockTxid,
  buyerLockVout = 0,
  buyerLockSats,
  buyerLockRedeemScriptHex,
  buyerRefundAddress = '',
  excludeOutpoints = null,
} = {}) {
  const { state, hdPrivateKey, utxos } = getSpendableWalletContext(mnemonic, {
    includeUnconfirmed: true,
    maxAncestorDepth: ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
    forceReload: true,
    allowLocalOwnedChain: true,
    ignoreLocalChainCheck: true,
    excludeOutpoints,
  });
  const sellerChat = deriveChatKeypairFromMnemonic(mnemonic);
  const refundAddress = validateAddress(buyerRefundAddress) ? buyerRefundAddress : getReceiveAddressFromState(state);
  const buyerLockRedeemScript = new bsv.Script(String(buyerLockRedeemScriptHex || '').trim());
  let tx = new bsv.Transaction();
  const rebuildSignedTx = (feeSat) => {
    const refundSat = Number(buyerLockSats || 0) - Number(feeSat || 0);
    if (refundSat <= 0) throw new Error('Insufficient spendable balance');
    tx = new bsv.Transaction();
    tx.addInput(createManualInput({
      prevTxId: buyerLockTxid,
      outputIndex: buyerLockVout,
      outputScript: buildOrderEscrowOutputScript(buyerLockRedeemScript),
      satoshis: buyerLockSats,
    }));
    tx.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.buildPublicKeyHashOut(refundAddress),
      satoshis: refundSat,
    }));
    if (buyerLockRedeemScript.isPublicKeyHashOut && buyerLockRedeemScript.isPublicKeyHashOut()) {
      throw new Error('Seller cancel is unavailable for standard buyer lock script');
    }
    const sellerSig = bsv.Transaction.Sighash.sign(
      tx,
      sellerChat.privateKey,
      ORDER_COOPERATIVE_SIGTYPE,
      0,
      buyerLockRedeemScript,
      new bsv.crypto.BN(Number(buyerLockSats || 0)),
    );
    setOrderBuyerLockSellerCancelUnlockScript(tx, 0, sellerSig.toTxFormat().toString('hex'), buyerLockRedeemScriptHex);
    return tx;
  };
  let feeSat = estimateTxFeeSat({ inputCount: 1, outputCount: 1, feeRate: DEFAULT_FEE_RATE });
  for (let i = 0; i < 8; i += 1) {
    rebuildSignedTx(feeSat);
    const sizeBytes = Buffer.from(tx.uncheckedSerialize(), 'hex').length;
    const requiredFeeSat = requiredFeeForSizeSat(sizeBytes, DEFAULT_FEE_RATE) + FINAL_SIGNED_FEE_SAFETY_SAT + ORDER_CANCEL_FEE_MARGIN_SAT;
    if (requiredFeeSat === feeSat) break;
    feeSat = requiredFeeSat;
  }
  rebuildSignedTx(feeSat);
  const rawtx = tx.uncheckedSerialize();
  return {
    rawtx,
    txid: txidFromRaw(rawtx),
    feeSat,
    feeInputOutpoints: [],
  };
}

async function buildOrderSettlementDraft({
  mnemonic,
  mode,
  priceSats,
  buyerJointTxid,
  buyerJointVout = 0,
  buyerJointSats,
  sellerJointTxid,
  sellerJointVout = 0,
  sellerJointSats,
  jointRedeemScriptHex,
  buyerSourceTxid = '',
  buyerSourceVout = null,
  buyerSourceSats = null,
  buyerSourceRedeemScriptHex = '',
  sellerSourceTxid = '',
  sellerSourceVout = null,
  sellerSourceSats = null,
  sellerSourceRedeemScriptHex = '',
  buyerChatPubKey,
  sellerChatPubKey,
  buyerRefundAddress,
  sellerReceiveAddress,
  sellerRefundAddress,
  spendSellerSource = null,
  anchorText = '',
  feeInputsDisabled = false,
  excludeOutpoints = null,
  preferredFeeOutpoints = null,
} = {}) {
  const safeMode = String(mode || '').trim();
  if (!['completed', 'refunded'].includes(safeMode)) throw new Error('Unsupported order settlement mode');
  const buyerInputTxid = String(buyerSourceTxid || buyerJointTxid || '').trim();
  const sellerInputTxid = String(sellerSourceTxid || sellerJointTxid || '').trim();
  const buyerInputVout = Number.isFinite(Number(buyerSourceVout)) ? Number(buyerSourceVout) : Number(buyerJointVout || 0);
  const sellerInputVout = Number.isFinite(Number(sellerSourceVout)) ? Number(sellerSourceVout) : Number(sellerJointVout || 0);
  const effectiveExcludeOutpoints = new Set(Array.isArray(excludeOutpoints) ? excludeOutpoints : []);
  const preferredFeeOutpointSet = new Set(Array.isArray(preferredFeeOutpoints)
    ? preferredFeeOutpoints.map((outpoint) => String(outpoint || '').trim().toLowerCase()).filter(Boolean)
    : []);
  if (buyerInputTxid) effectiveExcludeOutpoints.add(`${buyerInputTxid}:${buyerInputVout}`);
  if (sellerInputTxid) effectiveExcludeOutpoints.add(`${sellerInputTxid}:${sellerInputVout}`);
  const { state, utxos } = getSpendableWalletContext(mnemonic, {
    includeUnconfirmed: true,
    maxAncestorDepth: ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
    forceReload: true,
    allowLocalOwnedChain: true,
    ignoreLocalChainCheck: false,
    excludeOutpoints: Array.from(effectiveExcludeOutpoints),
  });
  const buyerScriptHex = String(buyerSourceRedeemScriptHex || jointRedeemScriptHex || '').trim();
  const sellerScriptHex = String(sellerSourceRedeemScriptHex || jointRedeemScriptHex || '').trim();
  const buyerSourceScript = new bsv.Script(buyerScriptHex);
  const sellerSourceScript = new bsv.Script(sellerScriptHex);
  const buyerInputSats = Number.isFinite(Number(buyerSourceSats)) ? Number(buyerSourceSats) : Number(buyerJointSats || 0);
  const sellerInputSats = Number.isFinite(Number(sellerSourceSats)) ? Number(sellerSourceSats) : Number(sellerJointSats || 0);
  const includeSellerSource = spendSellerSource === null || spendSellerSource === undefined
    ? safeMode !== 'completed'
    : spendSellerSource === true;
  let tx = new bsv.Transaction();
  tx.addInput(createManualInput({
    prevTxId: buyerInputTxid,
    outputIndex: buyerInputVout,
    outputScript: buildOrderEscrowOutputScript(buyerSourceScript),
    satoshis: buyerInputSats,
  }));
  if (includeSellerSource) {
    tx.addInput(createManualInput({
      prevTxId: sellerInputTxid,
      outputIndex: sellerInputVout,
      outputScript: buildOrderEscrowOutputScript(sellerSourceScript),
      satoshis: sellerInputSats,
    }));
  }
  const unitPriceSats = Math.max(0, Number(priceSats || 0));
  const buyerDepositSats = Math.max(0, Number(buyerInputSats || 0) - unitPriceSats);
  const sellerDepositSats = Math.max(0, Number(sellerInputSats || 0));
  const sellerRefundSat = sellerDepositSats;
  const buyerRefundBaseSat = safeMode === 'completed' ? buyerDepositSats : Number(buyerInputSats || 0);
  const safeAnchorText = String(anchorText || '').trim();
  const anchorPayloadBytes = safeAnchorText ? Buffer.byteLength(safeAnchorText, 'utf8') : 0;
  if (anchorPayloadBytes > MAX_ANCHOR_PAYLOAD_BYTES) {
    throw new Error(`Order settlement payload too large (max ${MAX_ANCHOR_PAYLOAD_BYTES} bytes UTF-8)`);
  }
  const anchorOutputCount = safeAnchorText ? 1 : 0;
  const baseOutputCount = 2;
  const effectiveOutputCount = safeMode === 'completed' && includeSellerSource
    ? baseOutputCount + 1 + anchorOutputCount
    : baseOutputCount + anchorOutputCount;
  const settlementBaseInputCount = (includeSellerSource ? 2 : 1);
  const settlementBaseSizeBytes = 10
    + (settlementBaseInputCount * ORDER_SETTLEMENT_MULTISIG_INPUT_ESTIMATE_BYTES)
    + ((effectiveOutputCount + 1) * 34)
    + anchorPayloadBytes;
  const estimatedSettlementFeeSat = Math.max(
    estimateTxFeeSat({
      inputCount: settlementBaseInputCount + 1,
      outputCount: effectiveOutputCount + 1,
      feeRate: DEFAULT_FEE_RATE,
    }) + ORDER_SETTLEMENT_FINAL_FEE_SAFETY_SAT,
    requiredFeeForSizeSat(settlementBaseSizeBytes + 148, DEFAULT_FEE_RATE) + ORDER_SETTLEMENT_FINAL_FEE_SAFETY_SAT,
  );
  let feeUtxos = [];
  let totalFeeInputSat = 0;
  try {
    if (feeInputsDisabled === true) throw new Error('settlement fee inputs disabled');
    await markExternallyVisibleSettlementFeeCandidates(utxos);
    const isPreferredSettlementFeeUtxo = (utxo) => {
      const key = getUtxoKey(utxo).toLowerCase();
      if (!preferredFeeOutpointSet.has(key)) return false;
      const txid = String(utxo?.txId || '').trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/i.test(txid)) return false;
      if (Math.max(0, Number(utxo?.ancestorDepth || 0)) > ORDER_MAX_UNCONFIRMED_ANCESTOR_DEPTH) return false;
      return Boolean(rawtxHexFromUnknown(getTxContextByTxid(txid, { useCache: false })?.rawtx));
    };
    const settlementFeeUtxos = utxos
      .filter((utxo) => isPreferredSettlementFeeUtxo(utxo) || isOrderSettlementFeeUtxoCandidate(utxo))
      .sort((a, b) => {
        const ap = preferredFeeOutpointSet.has(getUtxoKey(a).toLowerCase()) ? 1 : 0;
        const bp = preferredFeeOutpointSet.has(getUtxoKey(b).toLowerCase()) ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return Number(b?.satoshis || 0) - Number(a?.satoshis || 0);
      });
    const feeCandidateDiagnostics = utxos.slice(0, 12).map((utxo) => {
      const txid = String(utxo?.txId || '').trim().toLowerCase();
      const ctxRow = getTxContextByTxid(txid, { useCache: false });
      const rawtx = rawtxHexFromUnknown(ctxRow?.rawtx);
      const observation = getSpvTxObservation(txid) || getSpvTxObservationFromIndex(txid);
      return {
        outpoint: `${txid}:${Number(utxo?.vout || 0)}`,
        satoshis: Number(utxo?.satoshis || 0),
        confirmed: utxo?.confirmed === true,
        ctxConfirmed: ctxRow?.confirmed === true,
        proofVerified: ctxRow?.proofVerified === true,
        proofBlockHeight: Number(ctxRow?.proofBlockHeight || 0),
        observedRelevant: observation?.relevant === true,
        observedConfirmed: observation?.confirmedSeen === true,
        observedNode: String(observation?.node || ''),
        hasDataOutput: rawtx ? txHasUnspendableDataOutput(rawtx) : null,
        preferred: preferredFeeOutpointSet.has(`${txid}:${Number(utxo?.vout || 0)}`),
        accepted: isPreferredSettlementFeeUtxo(utxo) || isOrderSettlementFeeUtxoCandidate(utxo),
      };
    });
    appendSendLog('order_settlement_fee_utxo_candidates', {
      mode: safeMode,
      spendSellerSource: includeSellerSource,
      totalSpendable: utxos.length,
      plainCandidates: settlementFeeUtxos.length,
      excludedOutpoints: Array.from(effectiveExcludeOutpoints),
      estimatedSettlementFeeSat,
      preferredFeeOutpoints: Array.from(preferredFeeOutpointSet),
      feeCandidateDiagnostics,
    });
    const feeSelection = selectUtxosForTransaction(settlementFeeUtxos, {
      targetSat: estimatedSettlementFeeSat + (safeAnchorText ? ORDER_ANCHOR_OUTPUT_SAT : 0),
      outputCount: effectiveOutputCount + 1,
      feeRate: DEFAULT_FEE_RATE,
      allowConsolidation: false,
    });
    feeUtxos = Array.isArray(feeSelection?.utxos) ? feeSelection.utxos : [];
    totalFeeInputSat = feeUtxos.reduce((sum, u) => sum + Number(u.satoshis || 0), 0);
  } catch (_) {
    feeUtxos = [];
    totalFeeInputSat = 0;
  }
  if (feeUtxos.length) tx.from(feeUtxos);
  const changeAddress = getReceiveAddressFromState(state);
  const rebuildSignedTx = (feeSat) => {
    tx = new bsv.Transaction();
    tx.addInput(createManualInput({
      prevTxId: buyerInputTxid,
      outputIndex: buyerInputVout,
      outputScript: buildOrderEscrowOutputScript(buyerSourceScript),
      satoshis: buyerInputSats,
    }));
    if (includeSellerSource) {
      tx.addInput(createManualInput({
        prevTxId: sellerInputTxid,
        outputIndex: sellerInputVout,
        outputScript: buildOrderEscrowOutputScript(sellerSourceScript),
        satoshis: sellerInputSats,
      }));
    }
    if (feeUtxos.length) tx.from(feeUtxos);
    const feeSatSafe = Math.max(0, Number(feeSat || 0));
    const buyerRefundSat = feeUtxos.length
      ? buyerRefundBaseSat
      : Math.max(0, buyerRefundBaseSat - feeSatSafe);
    if (safeMode === 'completed') {
      const sellerPayoutSat = unitPriceSats;
      tx.to(sellerReceiveAddress, sellerPayoutSat);
      if (buyerRefundSat > 0) tx.to(buyerRefundAddress, buyerRefundSat);
      if (includeSellerSource && sellerRefundSat > 0) tx.to(sellerRefundAddress, sellerRefundSat);
    } else {
      if (buyerRefundSat > 0) tx.to(buyerRefundAddress, buyerRefundSat);
      if (sellerRefundSat > 0) tx.to(sellerRefundAddress, sellerRefundSat);
    }
    if (safeAnchorText) {
      tx.addOutput(buildOrderAnchorOutput(safeAnchorText));
    }
    const anchorOutputSat = safeAnchorText ? ORDER_ANCHOR_OUTPUT_SAT : 0;
    const changeSat = totalFeeInputSat - feeSatSafe - anchorOutputSat;
    if (feeUtxos.length && changeSat >= SAFE_MIN_CHANGE_SAT) {
      addP2pkhChangeOutput(tx, changeAddress, changeSat);
    }
    if (feeUtxos.length) signTransactionInputsAtOffset(tx, feeUtxos, includeSellerSource ? 2 : 1);
    return tx;
  };
  const settlementEstimatedSizeBytes = 10
    + (settlementBaseInputCount * ORDER_SETTLEMENT_MULTISIG_INPUT_ESTIMATE_BYTES)
    + (feeUtxos.length * 148)
    + ((effectiveOutputCount + 1) * 34)
    + anchorPayloadBytes;
  let feeSat = Math.max(
    estimateTxFeeSat({
      inputCount: settlementBaseInputCount + feeUtxos.length,
      outputCount: effectiveOutputCount + 1,
      feeRate: DEFAULT_FEE_RATE,
    }) + ORDER_SETTLEMENT_FINAL_FEE_SAFETY_SAT,
    requiredFeeForSizeSat(settlementEstimatedSizeBytes, DEFAULT_FEE_RATE) + ORDER_SETTLEMENT_FINAL_FEE_SAFETY_SAT,
  );
  if (feeUtxos.length) {
    for (let i = 0; i < 8; i += 1) {
      rebuildSignedTx(feeSat);
      const serializedSizeBytes = Buffer.from(tx.uncheckedSerialize(), 'hex').length;
      const estimatedSignedSizeBytes = Math.max(serializedSizeBytes, settlementEstimatedSizeBytes);
      const requiredFeeSat = requiredFeeForSizeSat(estimatedSignedSizeBytes, DEFAULT_FEE_RATE)
        + ORDER_SETTLEMENT_FINAL_FEE_SAFETY_SAT;
      if (requiredFeeSat === feeSat) break;
      feeSat = requiredFeeSat;
    }
  }
  if (!feeUtxos.length) {
    throw new Error('Settlement requires a wallet fee UTXO; escrow refunds cannot pay settlement fee');
  }
  rebuildSignedTx(feeSat);
  const totalInputSat = Number(buyerInputSats || 0)
    + (includeSellerSource ? Number(sellerInputSats || 0) : 0)
    + totalFeeInputSat;
  const totalOutputSat = tx.outputs.reduce((sum, output) => sum + Number(output?.satoshis || 0), 0);
  const actualFeeSat = totalInputSat - totalOutputSat;
  if (actualFeeSat < feeSat) {
    throw new Error('Settlement fee UTXO selection is insufficient');
  }
  return {
    rawtx: tx.uncheckedSerialize(),
    feePayerWalletAddress: getReceiveAddressFromState(state),
    feeInputCount: feeUtxos.length,
    buyerSourceRedeemScriptHex: buyerSourceScript.toHex(),
    sellerSourceRedeemScriptHex: sellerSourceScript.toHex(),
    spendSellerSource: includeSellerSource,
    feeInputOutpoints: feeUtxos.map((u) => `${String(u.txId || '').trim()}:${Number(u.vout || 0)}`),
    feeSat,
  };
}

function signOrderSettlementDraft({
  mnemonic,
  draftRawtx,
  jointRedeemScriptHex,
  buyerJointSats,
  sellerJointSats,
  buyerSourceRedeemScriptHex = '',
  sellerSourceRedeemScriptHex = '',
  buyerSourceSats = null,
  sellerSourceSats = null,
  spendSellerSource = true,
  buyerSoloSpend = false,
  signerRole = '',
} = {}) {
  const tx = new bsv.Transaction(String(draftRawtx || '').trim());
  const chatKeypair = deriveChatKeypairFromMnemonic(mnemonic);
  const redeemScripts = [
    new bsv.Script(String(buyerSourceRedeemScriptHex || jointRedeemScriptHex || '').trim()),
    new bsv.Script(String(sellerSourceRedeemScriptHex || jointRedeemScriptHex || '').trim()),
  ];
  const inputSats = [
    Number.isFinite(Number(buyerSourceSats)) ? Number(buyerSourceSats) : Number(buyerJointSats || 0),
    Number.isFinite(Number(sellerSourceSats)) ? Number(sellerSourceSats) : Number(sellerJointSats || 0),
  ];
  const orderInputCount = spendSellerSource === true ? 2 : 1;
  for (let inputIndex = 0; inputIndex < Math.min(orderInputCount, tx.inputs.length, inputSats.length); inputIndex += 1) {
    const currentSats = inputSats[inputIndex];
    if (!(currentSats > 0)) continue;
    const currentScript = redeemScripts[inputIndex];
    attachManualInputOutput(tx, inputIndex, buildOrderEscrowOutputScript(currentScript), currentSats);
    const currentScriptHex = currentScript.toHex();
    if (currentScript.isPublicKeyHashOut && currentScript.isPublicKeyHashOut()) {
      const privKey = getWalletPrivateKeyForP2pkhScript(mnemonic, currentScript);
      if (privKey) setP2pkhUnlockScript(tx, inputIndex, privKey, currentScript, currentSats);
      continue;
    }
    const sig = bsv.Transaction.Sighash.sign(
      tx,
      chatKeypair.privateKey,
      ORDER_COOPERATIVE_SIGTYPE,
      inputIndex,
      currentScript,
      new bsv.crypto.BN(currentSats),
    );
    const sigHex = sig.toTxFormat().toString('hex');
    const existingSigs = extractMultisigSignatureHexesFromInput(tx.inputs[inputIndex]);
    const merged = Array.from(new Set([
      ...existingSigs,
      sigHex,
    ]));
    if (inputIndex === 0 && buyerSoloSpend === true) {
      setOrderBuyerLockBuyerCancelUnlockScript(
        tx,
        inputIndex,
        String(merged[0] || '').trim(),
        currentScriptHex,
      );
    } else if (inputIndex === 0 && getOrderBuyerLockScriptVariant(currentScriptHex) === 'cooperative_buyer_seller_cancel') {
      const role = String(signerRole || '').trim().toLowerCase();
      const prior = existingSigs.find((item) => item && item !== sigHex) || '';
      const buyerSig = role === 'buyer' ? sigHex : (merged.length >= 2 ? merged[0] : '');
      const sellerSig = role === 'seller' ? sigHex : (prior || (merged.length >= 2 ? merged[1] : ''));
      setOrderBuyerLockCooperativeUnlockScript(
        tx,
        inputIndex,
        String(buyerSig || '').trim(),
        String(sellerSig || '').trim(),
        currentScriptHex,
      );
    } else {
      const role = String(signerRole || '').trim().toLowerCase();
      if (role === 'buyer' && inputIndex === 1) {
        const sellerSig = existingSigs.find((item) => item && item !== sigHex) || '';
        setOrderJointUnlockScript(tx, inputIndex, currentScriptHex, [sigHex, sellerSig].filter(Boolean));
      } else if (role === 'seller' && inputIndex === 1) {
        const buyerSig = existingSigs.find((item) => item && item !== sigHex) || '';
        setOrderJointUnlockScript(tx, inputIndex, currentScriptHex, [buyerSig, sigHex].filter(Boolean));
      } else {
        setOrderJointUnlockScript(tx, inputIndex, currentScriptHex, merged);
      }
    }
  }
  return {
    rawtx: tx.uncheckedSerialize(),
    txid: txidFromRaw(tx.uncheckedSerialize()),
    signatureCount: Math.min(2, tx.inputs.length),
  };
}

const MANUAL_WALLET_RECOVERY_SOURCES = new Set([
  'wallet_sync_api',
  'wallet_sync_button',
  'wallet_refresh_cache',
  'wallet_rescan_command',
  'wallet_switch_manual',
  'wallet_refresh_pending_replay',
  'wallet_recover_bootstrap',
  'wallet_refresh_bootstrap',
  'rebuild_wallet_index_from_local_data',
  'spv_index_rebuild_confirmed_base',
  'wallet_confirmed_reconcile_manual',
]);

const MANUAL_WOC_WALLET_SOURCES = new Set([
  'wallet_sync_api',
  'wallet_sync_button',
  'wallet_rescan_command',
  'wallet_switch_manual',
  'wallet_recover_bootstrap',
  'wallet_refresh_bootstrap',
  'wallet_confirmed_reconcile_manual',
]);

function isManualWocWalletSource(source, options = {}) {
  const safeSource = String(source || '').trim();
  return Boolean(
    options?.allowWocReconcile === true
    || options?.forceWocRebuild === true
    || MANUAL_WOC_WALLET_SOURCES.has(safeSource),
  );
}

function assertManualWalletRecoverySource(source, operation = 'wallet_recovery') {
  const safeSource = String(source || '').trim();
  if (MANUAL_WALLET_RECOVERY_SOURCES.has(safeSource)) return safeSource;
  const err = new Error(`${operation} requires manual source`);
  err.code = 'MANUAL_RECOVERY_REQUIRED';
  err.source = safeSource;
  throw err;
}

async function refreshBalancesAndHistory(options = {}) {
  const source = assertManualWalletRecoverySource(options?.source, 'refreshBalancesAndHistory');
  const state = getWalletState();
  const allowExplicitWocReconcile = isManualWocWalletSource(source, options);
  const indexBefore = getSpvIndex();
  const hasLocalIndex = Object.keys(indexBefore?.utxos || {}).length > 0 || Object.keys(indexBefore?.txs || {}).length > 0;
  const forceBootstrap = options?.forceBootstrap === true;
  const clearLocalFirst = options?.clearLocalFirst === true;
  let clearLocalBackup = null;
  const shouldAbort = typeof options?.shouldAbort === 'function' ? options.shouldAbort : null;
  const throwIfAborted = (stage = 'wallet_refresh') => {
    if (!shouldAbort || shouldAbort() !== true) return;
    const err = new Error(`wallet refresh preempted by wallet_send at ${stage}`);
    err.code = 'COMMAND_PREEMPTED';
    throw err;
  };
  startWalletSyncProgress('starting', {
    message: forceBootstrap
      ? (clearLocalFirst ? '开始刷新钱包：清空本地索引并重建' : '开始刷新钱包：准备重建索引')
      : '开始刷新钱包',
    addressCount: Array.isArray(state.addresses) ? state.addresses.length : 0,
  });
  if ((forceBootstrap || !hasLocalIndex) && allowExplicitWocReconcile) {
    try {
      throwIfAborted('bootstrap_start');
      if (clearLocalFirst) {
        clearLocalBackup = captureWalletLocalIndexBackup();
        setWalletSyncProgress({
          stage: 'reset_local',
          message: '正在清空本地交易和 UTXO 索引',
        });
        clearWalletLocalIndex('forced_wallet_sync');
      }
      appendSendLog('wallet_refresh_bootstrap_start', {
        source,
        reason: forceBootstrap ? 'forced' : 'empty_index',
        addressCount: Array.isArray(state.addresses) ? state.addresses.length : 0,
        clearLocalFirst,
      });
      throwIfAborted('bootstrap_before_woc');
      await bootstrapSpvIndexFromWoc(state, {
        // Empty-index bootstrap is also an explicit recovery path and must not be
        // blocked by the normal WOC-disabled runtime guard.
        allowDisabled: true,
      });
      if (ALLOW_WOC_HTTP || allowExplicitWocReconcile) {
        await reconcileConfirmedUtxoSetWithWoc(state, {
          allowDisabled: true,
        });
        let protectedTxids = [];
        try {
          const serverMarket = require('./server_market');
          if (typeof serverMarket?.buildProjectionBackedState === 'function') {
            const runtimeState = serverMarket.buildProjectionBackedState();
            protectedTxids = (Array.isArray(runtimeState?.recentRawtxs) ? runtimeState.recentRawtxs : [])
              .map((row) => String(row?.txid || '').trim().toLowerCase())
              .filter((txid) => /^[0-9a-f]{64}$/i.test(txid));
          }
        } catch (_) {}
        await reconcilePendingWalletIndexWithWoc(state, {
          allowDisabled: true,
          protectedTxids: [
            ...listUnconfirmedAnchorTxidsWithRawtx(),
            ...protectedTxids,
          ],
          pruneLocalOnly: true,
        });
      }
      try {
        const serverMarket = require('./server_market');
        if (typeof serverMarket?.buildProjectionBackedState === 'function' && typeof serverMarket?.reconcileRecentRawtxConfirmationState === 'function') {
          const runtimeState = serverMarket.buildProjectionBackedState();
          serverMarket.reconcileRecentRawtxConfirmationState(runtimeState, {
            source: 'wallet_refresh_bootstrap',
            reason: 'wallet_refresh_bootstrap_recent_rawtx_cleanup',
          });
        }
      } catch (_) {}
      appendSendLog('wallet_confirmed_reconcile_skipped_policy', {
        source: 'wallet_refresh_bootstrap_reconcile',
        reason: 'manual_refresh_uses_woc_utxo_truth',
      });
      let allowedPendingTxids = new Set(listUnconfirmedAnchorTxidsWithRawtx());
      try {
        const serverMarket = require('./server_market');
        if (typeof serverMarket?.buildProjectionBackedState === 'function') {
          const runtimeState = serverMarket.buildProjectionBackedState();
          allowedPendingTxids = new Set([
            ...allowedPendingTxids,
            (Array.isArray(runtimeState?.recentRawtxs) ? runtimeState.recentRawtxs : [])
              .map((row) => String(row?.txid || '').trim().toLowerCase())
              .filter((txid) => /^[0-9a-f]{64}$/i.test(txid)),
          ].flat());
        }
      } catch (_) {}
      if (options?.allowPendingReplay === true) {
        const pendingRawtxs = sortTxContextsTopologically(listTxContexts({
          requireRawtx: true,
          limit: 5000,
        }).filter((row) => {
          if (row?.confirmed === true) return false;
          if (!(allowedPendingTxids instanceof Set)) return true;
          return allowedPendingTxids.has(String(row?.txid || '').trim().toLowerCase());
        })).map((row) => String(row?.rawtx || '').trim()).filter(Boolean);
        if (pendingRawtxs.length > 0) {
          rebuildLocalIndexFromQueueRawtxs(pendingRawtxs, {
            source: 'wallet_refresh_pending_replay',
          });
        }
      } else {
        appendSendLog('wallet_refresh_pending_replay_skipped_policy', {
          source,
          policy: 'explicit_allow_pending_replay_required',
          allowedPendingTxidCount: allowedPendingTxids instanceof Set ? allowedPendingTxids.size : 0,
        });
      }
      updateAddressBalancesFromSpv(state);
      saveWalletState(state);
      const bootstrapped = buildCacheFromSpvIndex();
      writeJson(CACHE_FILE, bootstrapped);
      // Forced bootstrap rebuilds local wallet data but should still restore the
      // background SPV listener pool for ongoing connectivity and mempool watch.
      startSpvListener();
      if (!spvRuntime.peers.size && !spvRuntime.connectingNodes.size) {
        await maintainSpvConnections().catch(() => {});
      }
      appendSendLog('wallet_refresh_bootstrap_done', {
        confirmed: Number(bootstrapped.confirmed || 0),
        unconfirmed: Number(bootstrapped.unconfirmed || 0),
        total: Number(bootstrapped.total || 0),
        txidCount: Array.isArray(bootstrapped.txids) ? bootstrapped.txids.length : 0,
      });
      finishWalletSyncProgress('done', {
        message: '钱包刷新完成',
        confirmed: Number(bootstrapped.confirmed || 0),
        unconfirmed: Number(bootstrapped.unconfirmed || 0),
        total: Number(bootstrapped.total || 0),
      });
      return bootstrapped;
    } catch (err) {
      if (clearLocalFirst && clearLocalBackup) {
        try {
          const currentIndex = getSpvIndex({ forceReload: true });
          const currentUtxoCount = Object.keys(currentIndex?.utxos || {}).length;
          const currentCache = buildCacheFromSpvIndex(currentIndex);
          if (currentUtxoCount > 0 && Number(currentCache.total || 0) > 0) {
            writeJson(CACHE_FILE, currentCache);
            appendSendLog('wallet_refresh_bootstrap_partial_index_kept_after_failure', {
              source,
              error: String(err?.message || err || 'wallet refresh failed'),
              utxoCount: currentUtxoCount,
              total: Number(currentCache.total || 0),
              policy: 'do_not_restore_potentially_stale_backup_over_woc_utxos',
            });
          } else {
            restoreWalletLocalIndexBackup(clearLocalBackup);
            appendSendLog('wallet_refresh_bootstrap_restore_after_failure', {
              source,
              error: String(err?.message || err || 'wallet refresh failed'),
            });
          }
        } catch (restoreError) {
          appendSendLog('wallet_refresh_bootstrap_restore_failed', {
            source,
            error: String(restoreError?.message || restoreError || 'restore failed'),
          });
        }
      }
      appendSendLog('wallet_refresh_bootstrap_failed', {
        source,
        reason: forceBootstrap ? 'forced' : 'empty_index',
        message: String(err?.message || 'bootstrap failed'),
      });
      finishWalletSyncProgress('failed', {
        message: '钱包刷新失败',
        error: String(err?.message || 'bootstrap failed'),
      });
      if (forceBootstrap) throw err;
    }
  } else if (forceBootstrap && !allowExplicitWocReconcile) {
    const err = new Error('Manual wallet sync is required for WOC bootstrap');
    err.code = 'WOC_MANUAL_SYNC_REQUIRED';
    finishWalletSyncProgress('failed', {
      message: '钱包刷新失败',
      error: err.message,
    });
    throw err;
  } else if (!hasLocalIndex && !allowExplicitWocReconcile) {
    appendSendLog('wallet_refresh_bootstrap_skipped_policy', {
      source,
      reason: 'woc_allowed_only_for_manual_wallet_sync',
    });
  }
  setWalletSyncProgress({
    stage: 'spv_refresh',
    message: '正在从 SPV 节点刷新余额',
  });
  throwIfAborted('spv_refresh_start');
  startSpvListener();
  if (!spvRuntime.peers.size && !spvRuntime.connectingNodes.size) {
    await maintainSpvConnections().catch(() => {});
  }
  throwIfAborted('before_mempool_snapshot');
  await pullMempoolSnapshot(state.addresses);
  if (allowExplicitWocReconcile) {
    throwIfAborted('before_woc_refresh');
    await refreshCriticalAddressesFromWoc(state, {
      allowDisabled: true,
    });
    throwIfAborted('before_woc_confirmed_utxo_reconcile');
    await reconcileConfirmedUtxoSetWithWoc(state, {
      allowDisabled: true,
    });
    throwIfAborted('before_woc_pending_reconcile');
    let protectedTxids = [];
    try {
      const serverMarket = require('./server_market');
      if (typeof serverMarket?.buildProjectionBackedState === 'function') {
        const runtimeState = serverMarket.buildProjectionBackedState();
        protectedTxids = (Array.isArray(runtimeState?.recentRawtxs) ? runtimeState.recentRawtxs : [])
          .map((row) => String(row?.txid || '').trim().toLowerCase())
          .filter((txid) => /^[0-9a-f]{64}$/i.test(txid));
      }
    } catch (_) {}
    await reconcilePendingWalletIndexWithWoc(state, {
      allowDisabled: true,
      protectedTxids: [
        ...listUnconfirmedAnchorTxidsWithRawtx(),
        ...protectedTxids,
      ],
      pruneLocalOnly: true,
    });
  } else {
    appendSendLog('wallet_refresh_woc_skipped_policy', {
      source,
      reason: 'woc_allowed_only_for_manual_wallet_sync_or_switch',
    });
  }
  throwIfAborted('before_stale_pending_reconcile');
  const staleReconcileLocalHeight = resolveRuntimeWalletLocalHeight(state);
  await reconcileStalePendingWalletTxs({
    source,
    localHeight: staleReconcileLocalHeight,
    minBlocks: 1,
    minAgeMs: 0,
    nodeLimit: 3,
    maxChecks: 8,
  });
  throwIfAborted('before_confirmed_reconcile');
  appendSendLog('wallet_confirmed_reconcile_skipped_policy', {
    source: forceBootstrap || !hasLocalIndex ? 'wallet_refresh_bootstrap_reconcile' : 'wallet_refresh_reconcile',
    reason: 'runtime_refresh_uses_incremental_utxo_truth',
  });
  throwIfAborted('before_balance_rebuild');
  updateAddressBalancesFromSpv(state);
  saveWalletState(state);

  const cache = buildCacheFromSpvIndex();
  writeJson(CACHE_FILE, cache);
  finishWalletSyncProgress('done', {
    message: '钱包刷新完成',
    confirmed: Number(cache.confirmed || 0),
    unconfirmed: Number(cache.unconfirmed || 0),
    total: Number(cache.total || 0),
  });
  return cache;
}

function getCachedBalanceAndHistory() {
  const stableKey = walletBalanceHistoryCacheStableKey();
  if (walletBalanceHistoryCache && walletBalanceHistoryCacheKey === stableKey) {
    return walletBalanceHistoryCache;
  }
  const cache = readJson(CACHE_FILE, {
    confirmed: 0,
    unconfirmed: 0,
    pendingDelta: 0,
    incomeSat: 0,
    expenseSat: 0,
    total: 0,
    txids: [],
    updatedAt: null,
  });
  const rebuilt = buildCacheFromSpvIndex();
  const cacheKey = JSON.stringify({
    confirmed: Number(cache?.confirmed || 0),
    unconfirmed: Number(cache?.unconfirmed || 0),
    pendingDelta: Number(cache?.pendingDelta || 0),
    available: Number(cache?.available || 0),
    selfChangePending: Number(cache?.selfChangePending || 0),
    unconfirmedIncoming: Number(cache?.unconfirmedIncoming || cache?.unconfirmed || 0),
    incomeSat: Number(cache?.incomeSat || 0),
    expenseSat: Number(cache?.expenseSat || 0),
    total: Number(cache?.total || 0),
    txids: Array.isArray(cache?.txids) ? cache.txids : [],
  });
  const rebuiltKey = JSON.stringify({
    confirmed: Number(rebuilt.confirmed || 0),
    unconfirmed: Number(rebuilt.unconfirmed || 0),
    pendingDelta: Number(rebuilt.pendingDelta || 0),
    available: Number(rebuilt.available || 0),
    selfChangePending: Number(rebuilt.selfChangePending || 0),
    unconfirmedIncoming: Number(rebuilt.unconfirmedIncoming || rebuilt.unconfirmed || 0),
    incomeSat: Number(rebuilt.incomeSat || 0),
    expenseSat: Number(rebuilt.expenseSat || 0),
    total: Number(rebuilt.total || 0),
    txids: Array.isArray(rebuilt.txids) ? rebuilt.txids : [],
  });
  if (cacheKey === rebuiltKey && Number.isFinite(Number(cache?.incomeSat)) && Number.isFinite(Number(cache?.expenseSat))) {
    return rememberWalletBalanceHistoryCache(cache);
  }
  const merged = {
    ...cache,
    confirmed: Number(rebuilt.confirmed || 0),
    unconfirmed: Number(rebuilt.unconfirmed || 0),
    pendingDelta: Number(rebuilt.pendingDelta || 0),
    available: Number(rebuilt.available || rebuilt.total || 0),
    availableBsv: Number(rebuilt.availableBsv || ((rebuilt.available || rebuilt.total || 0) / 100000000)),
    selfChangePending: Number(rebuilt.selfChangePending || 0),
    unconfirmedIncoming: Number(rebuilt.unconfirmedIncoming || rebuilt.unconfirmed || 0),
    incomeSat: Number(rebuilt.incomeSat || 0),
    expenseSat: Number(rebuilt.expenseSat || 0),
    total: Number(rebuilt.total || 0),
    txids: Array.isArray(rebuilt.txids) ? rebuilt.txids : (Array.isArray(cache.txids) ? cache.txids : []),
    updatedAt: rebuilt.updatedAt || cache.updatedAt || new Date().toISOString(),
  };
  appendSendLog('wallet_balance_cache_mismatch_detected', {
    source: 'get_cached_balance_and_history',
    policy: 'read_only_no_cache_rewrite',
    cache: {
      confirmed: Number(cache?.confirmed || 0),
      unconfirmed: Number(cache?.unconfirmed || 0),
      pendingDelta: Number(cache?.pendingDelta || 0),
      available: Number(cache?.available || 0),
      total: Number(cache?.total || 0),
      txidCount: Array.isArray(cache?.txids) ? cache.txids.length : 0,
    },
    rebuilt: {
      confirmed: Number(rebuilt?.confirmed || 0),
      unconfirmed: Number(rebuilt?.unconfirmed || 0),
      pendingDelta: Number(rebuilt?.pendingDelta || 0),
      available: Number(rebuilt?.available || 0),
      total: Number(rebuilt?.total || 0),
      txidCount: Array.isArray(rebuilt?.txids) ? rebuilt.txids.length : 0,
    },
  });
  return rememberWalletBalanceHistoryCache(merged);
}

function getLocalIndexStats() {
  const index = getSpvIndex();
  const utxos = Object.values(index?.utxos || {});
  const txs = Object.keys(index?.txs || {});
  let contextReadyCount = 0;
  let beefReadyUtxoCount = 0;
  const evaluatedTxids = new Set();
  for (const utxo of utxos) {
    const txid = String(utxo?.txId || '').trim().toLowerCase();
    const ctx = getTxContextByTxid(txid);
    const confirmed = Boolean(utxo?.confirmed);
    if (confirmed || (ctx?.rawtx && canSpendWithLocalChain(txid, buildLocalBroadcastContext(ctx.rawtx)))) {
      beefReadyUtxoCount += 1;
    }
    if (!txid || !ctx?.rawtx) continue;
    if (!evaluatedTxids.has(txid)) {
      evaluatedTxids.add(txid);
      contextReadyCount += 1;
    }
  }
  const confirmedUtxoCount = utxos.filter((u) => Boolean(u?.confirmed)).length;
  const unconfirmedUtxoCount = Math.max(0, utxos.length - confirmedUtxoCount);
  let sendPreflightStatus = 'no_utxo';
  if (utxos.length > 0) {
    sendPreflightStatus = beefReadyUtxoCount > 0
      ? 'ready'
      : (contextReadyCount > 0 ? 'waiting_beef' : 'waiting_context');
  }
  return {
    utxoCount: utxos.length,
    confirmedUtxoCount,
    unconfirmedUtxoCount,
    txCount: txs.length,
    contextTxCount: getTxContextCount(),
    contextReadyCount,
    beefReadyUtxoCount,
    sendPreflightStatus,
    updatedAt: index?.updatedAt || null,
  };
}

function listWalletUtxoAudit(limit = 200) {
  const index = getSpvIndex({ forceReload: true });
  const notes = getNotesMap();
  const cap = Math.max(1, Math.min(Number(limit || 200), 1000));
  const allRows = Object.entries(index?.utxos || {})
    .map(([outpoint, utxo]) => {
      const txid = String(utxo?.txId || utxo?.txid || '').trim().toLowerCase();
      const txRow = index?.txs?.[txid] || {};
      const ctx = getTxContextByTxid(txid);
      let anchorType = getMarketAnchorTypeForTxid(txid);
      if (!anchorType) anchorType = getMarketAnchorTypeFromRawtx(ctx?.rawtx);
      const nonWalletAnchor = isNonWalletMarketAnchorType(anchorType);
      return {
        outpoint,
        txid,
        vout: Number(utxo?.vout),
        address: String(utxo?.address || ''),
        satoshis: Number(utxo?.satoshis || 0),
        confirmed: Boolean(utxo?.confirmed),
        spent: Boolean(index?.spentOutpoints?.[outpoint]),
        note: String(notes?.[txid]?.note || ''),
        anchorType,
        nonWalletAnchor,
        suppressed: false,
        tx: {
          confirmed: Boolean(txRow?.confirmed),
          receivedSat: Number(txRow?.receivedSat || 0),
          spentSat: Number(txRow?.spentSat || 0),
          netSat: Number(txRow?.netSat || 0),
          feeSat: Number(txRow?.feeSat || 0),
          lastSeenAt: String(txRow?.lastSeenAt || ''),
        },
        context: {
          source: String(ctx?.source || ''),
          kind: String(ctx?.kind || ''),
          confirmed: Boolean(ctx?.confirmed),
          hasRawtx: Boolean(rawtxHexFromUnknown(ctx?.rawtx)),
        },
      };
    })
    .sort((a, b) => Number(b.satoshis || 0) - Number(a.satoshis || 0));
  const activeRows = allRows.filter((row) => !row.spent);
  return {
    updatedAt: String(index?.updatedAt || ''),
    utxoCount: allRows.length,
    txCount: Object.keys(index?.txs || {}).length,
    activeTotal: activeRows.reduce((sum, row) => sum + Math.max(0, Number(row.satoshis || 0)), 0),
    suppressedTotal: 0,
    rows: allRows.slice(0, cap),
  };
}

function getReceiveAddress() {
  const state = getWalletStateSnapshotInternal();
  if (!state || !Array.isArray(state.addresses) || state.addresses.length === 0) {
    throw new Error('Wallet addresses missing');
  }
  const item = state.addresses.find((a) => a.index === state.lastReceiveIndex) || state.addresses[state.addresses.length - 1];
  return item.address;
}

function getReceiveAddressFromState(state) {
  if (!state || !Array.isArray(state.addresses) || state.addresses.length === 0) return '';
  const item = state.addresses.find((a) => a.index === state.lastReceiveIndex) || state.addresses[state.addresses.length - 1];
  return String(item?.address || '').trim();
}

function createNewReceiveAddress(mnemonic) {
  const state = getWalletState();
  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  const nextIndex = Number(state.addressCursor || 0) + 1;
  const item = deriveAddress(hdPrivateKey, nextIndex, state.pathBase || PATH_BASE);
  state.addresses.push(item);
  state.addressCursor = nextIndex;
  state.lastReceiveIndex = nextIndex;
  saveWalletState(state);
  return item.address;
}

async function createWallet(password) {
  ensureDataDir();
  if (walletExists()) throw new Error('Wallet already exists');

  const mnemonic = generateMnemonic();
  const keystore = encryptMnemonic(mnemonic, password);
  writeJson(KEYSTORE_FILE, keystore);

  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  const firstAddress = deriveAddress(hdPrivateKey, 0, PATH_BASE);
  saveWalletState(initWalletState(firstAddress));
  clearWalletLocalIndex('create_wallet');

  startSpvListener();

  return {
    mnemonic,
    firstAddress: firstAddress.address,
  };
}

async function createWalletFromMnemonic(mnemonic, password) {
  ensureDataDir();
  if (walletExists()) throw new Error('Wallet already exists');
  if (!Mnemonic.isValid(mnemonic)) throw new Error('Invalid mnemonic');

  const normalized = String(mnemonic).trim().replace(/\s+/g, ' ');
  const keystore = encryptMnemonic(normalized, password);
  writeJson(KEYSTORE_FILE, keystore);

  const hdPrivateKey = getHdPrivateKeyFromMnemonic(normalized);
  const state = buildWalletStateFromHdPrivateKey(hdPrivateKey, 1, PATH_BASE);
  saveWalletState(state);
  clearWalletLocalIndex('create_wallet_from_mnemonic');
  startSpvListener();

  return {
    mnemonic: normalized,
    firstAddress: state.addresses[0]?.address || '',
  };
}

async function importWalletFromMnemonic(mnemonic, password, addressCount = LIGHTWEIGHT_IMPORT_ADDRESS_COUNT) {
  ensureDataDir();
  if (walletExists()) throw new Error('Wallet already exists');
  if (!Mnemonic.isValid(mnemonic)) throw new Error('Invalid mnemonic');

  clearRecoverLog();
  appendRecoverLog('lightweight_import_start', {
    mnemonicWords: String(mnemonic || '').trim().split(/\s+/).length,
    addressCount: Math.max(1, Math.min(Number(addressCount) || LIGHTWEIGHT_IMPORT_ADDRESS_COUNT, 500)),
  });

  const normalized = String(mnemonic).trim().replace(/\s+/g, ' ');
  const keystore = encryptMnemonic(normalized, password);
  writeJson(KEYSTORE_FILE, keystore);

  const hdPrivateKey = getHdPrivateKeyFromMnemonic(normalized);
  const state = buildWalletStateFromHdPrivateKey(hdPrivateKey, addressCount, PATH_BASE);
  saveWalletState(state);
  appendRecoverLog('lightweight_import_state_saved', {
    pathBase: state.pathBase,
    addressCount: state.addresses.length,
    addressCursor: state.addressCursor,
  });
  clearWalletLocalIndex('lightweight_import');
  startSpvListener();
  appendRecoverLog('lightweight_import_done', {
    receiveAddress: state.addresses[0]?.address || '',
    addressCount: state.addresses.length,
  });

  return {
    mnemonic: normalized,
    firstAddress: state.addresses[0]?.address || '',
    addressCount: state.addresses.length,
    receiveAddress: state.addresses[0]?.address || '',
    selectedPath: state.pathBase,
    scanCount: state.addresses.length,
    lightweight: true,
  };
}

async function recoverWallet(mnemonic, password) {
  ensureDataDir();
  if (!Mnemonic.isValid(mnemonic)) throw new Error('Invalid mnemonic');
  clearRecoverLog();
  appendRecoverLog('recover_start', { mnemonicWords: String(mnemonic || '').trim().split(/\s+/).length });
  const backup = {
    keystore: readFileRawOrNull(KEYSTORE_FILE),
    state: readFileRawOrNull(STATE_FILE),
    cache: readFileRawOrNull(CACHE_FILE),
    index: readFileRawOrNull(SPV_INDEX_FILE),
  };

  try {
    const keystore = encryptMnemonic(mnemonic, password);
    writeJson(KEYSTORE_FILE, keystore);

    // Optional centralized bootstrap path; disabled by default.
    const best = await pickBestPathByWoc(mnemonic, DEFAULT_RESCAN_COUNT);
    const state = {
      pathBase: best.pathBase,
      addresses: best.addresses,
      lastReceiveIndex: 0,
      addressCursor: Math.max(...best.addresses.map((a) => a.index), 0),
      updatedAt: new Date().toISOString(),
    };
    saveWalletState(state);
    appendRecoverLog('recover_state_saved', {
      pathBase: state.pathBase,
      addressCount: state.addresses.length,
      addressCursor: state.addressCursor,
    });

    await bootstrapSpvIndexFromWoc(state, {
      // Recovery is an explicit operator action; allow the bootstrap path even
      // when normal WOC reads are disabled for day-to-day operation.
      allowDisabled: true,
    });
    appendRecoverLog('wallet_confirmed_reconcile_skipped_policy', {
      source: 'wallet_recover_bootstrap_reconcile',
      reason: 'recover_uses_woc_utxo_truth',
    });
    updateAddressBalancesFromSpv(state);
    saveWalletState(state);

    const cache = buildCacheFromSpvIndex();
    writeJson(CACHE_FILE, cache);
    appendRecoverLog('recover_done', {
      confirmed: cache.confirmed,
      unconfirmed: cache.unconfirmed,
      total: cache.total,
      txidCount: cache.txids.length,
    });

    startSpvListener();

    return {
      addressCount: state.addresses.length,
      receiveAddress: getReceiveAddress(),
      selectedPath: best.pathBase,
      scanCount: DEFAULT_RESCAN_COUNT,
    };
  } catch (err) {
    appendRecoverLog('recover_failed', { error: err.message });
    restoreFileRaw(KEYSTORE_FILE, backup.keystore);
    restoreFileRaw(STATE_FILE, backup.state);
    restoreFileRaw(CACHE_FILE, backup.cache);
    restoreFileRaw(SPV_INDEX_FILE, backup.index);
    invalidateWalletStateSnapshot();
    throw err;
  }
}

async function rescanWalletAddresses(mnemonic, scanCount = DEFAULT_RESCAN_COUNT) {
  assertManualWalletRecoverySource('wallet_rescan_command', 'rescanWalletAddresses');
  const oldState = getWalletStateSnapshot();
  const pathBase = oldState?.pathBase || PATH_BASE;
  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  const cap = Math.max(1, Math.min(Number(scanCount) || DEFAULT_RESCAN_COUNT, 500));

  const addresses = [];
  for (let i = 0; i < cap; i += 1) addresses.push(deriveAddress(hdPrivateKey, i, pathBase));

  const state = {
    pathBase,
    addresses,
    lastReceiveIndex: Number(oldState?.lastReceiveIndex || 0),
    addressCursor: cap - 1,
    updatedAt: new Date().toISOString(),
  };
  saveWalletState(state);

  // SPV-only rescan: keep existing index, then refresh by snapshot/listener.
  await refreshBalancesAndHistory({
    source: 'wallet_rescan_command',
  });

  return {
    addressCount: state.addresses.length,
    receiveAddress: getReceiveAddress(),
    selectedPath: state.pathBase,
    scanCount: cap,
  };
}

async function sendBsv({ mnemonic, to, amountBsv, sendAll = false, note, onStage = null, excludeOutpoints = null, localHeight = 0, broadcastHeight = 0 }) {
  assertWalletSendAllowed('send');
  if (!validateAddress(to)) throw new Error('Invalid BSV address');
  const amountSat = sendAll ? 0 : normalizeAmountToSats(amountBsv);

  const state = getWalletState();
  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  const sendStartedAt = Date.now();
  let preparedRawtx = '';
  let preparedTxid = '';
  let broadcastSucceeded = false;
  const emitStage = async (stage, extra = {}) => {
    if (typeof onStage !== 'function') return;
    try {
      await onStage(stage, extra);
    } catch (_) {}
  };
  appendSendLog('send_start', { to, amountSat });
  try {
    let utxos = listSpendableUtxosForState(state, hdPrivateKey, {
      maxAncestorDepth: SEND_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
      excludeOutpoints,
    });
    appendSendLog('send_utxo_scan', {
      candidateCount: utxos.length,
      candidateTotalSat: utxos.reduce((a, u) => a + Number(u.satoshis || 0), 0),
      candidates: utxos.map((u) => ({
        txid: String(u.txId || ''),
        vout: Number(u.vout),
        satoshis: Number(u.satoshis || 0),
        confirmed: Boolean(u.confirmed),
        ancestorDepth: Number(u.ancestorDepth || 0),
      })),
    });
    if (!utxos.length) {
      appendSendLog('send_no_local_utxo_policy_blocked', {
        reason: 'runtime_auto_refresh_disabled',
      });
    }
    if (!utxos.length) throw buildSpendableUtxoError(state, hdPrivateKey, 'sending', SEND_MAX_UNCONFIRMED_ANCESTOR_DEPTH);
    let selection = null;
    if (!sendAll) {
      selection = selectUtxosForTransaction(utxos, {
        targetSat: amountSat,
        outputCount: 2,
        feeRate: DEFAULT_FEE_RATE,
        allowConsolidation: true,
      });
      utxos = selection.utxos;
    }
    appendSendLog('send_utxo_ready', {
      utxoCount: utxos.length,
      utxoTotalSat: utxos.reduce((a, u) => a + Number(u.satoshis || 0), 0),
      selectedForSend: utxos.length,
      estimatedFeeSat: Number(selection?.estimatedFeeSat || estimateTxFeeSat({
        inputCount: utxos.length,
        outputCount: 1,
        feeRate: DEFAULT_FEE_RATE,
      })),
      consolidationApplied: Boolean(selection?.consolidationApplied),
      consolidationInputCount: Number(selection?.consolidationInputCount || 0),
      sendAll,
      selected: utxos.map((u) => ({
        txid: String(u.txId || ''),
        vout: Number(u.vout),
        satoshis: Number(u.satoshis || 0),
        confirmed: Boolean(u.confirmed),
        ancestorDepth: Number(u.ancestorDepth || 0),
      })),
    });
    await emitStage('wallet_send_composed', {
      utxoCount: utxos.length,
      sendAll,
      amountSat: sendAll ? null : amountSat,
    });

    const tx = new bsv.Transaction();
    tx.from(utxos);
    const changeAddress = new bsv.Address(getReceiveAddressFromState(state), NETWORK);
    let feePlan = null;
    let finalAmountSat = amountSat;
    if (sendAll) {
      const totalInputSat = utxos.reduce((a, u) => a + Number(u.satoshis || 0), 0);
      const estimatedFeeSat = estimateTxFeeSat({
        inputCount: utxos.length,
        outputCount: 1,
        feeRate: DEFAULT_FEE_RATE,
      });
      finalAmountSat = totalInputSat - estimatedFeeSat;
      if (!(finalAmountSat > 0)) throw new Error('Insufficient spendable balance');
      tx.to(new bsv.Address(to, NETWORK), finalAmountSat);
      feePlan = finalizeSendAllFeeAndSign(tx, utxos, 0, DEFAULT_FEE_RATE);
      finalAmountSat = Number(tx.outputs?.[0]?.satoshis || finalAmountSat);
    } else {
      tx.to(new bsv.Address(to, NETWORK), finalAmountSat);
      feePlan = finalizeFeeAndSign(tx, utxos, changeAddress, DEFAULT_FEE_RATE, SAFE_MIN_CHANGE_SAT);
    }

    const rawtx = tx.serialize();
    const inspected = inspectRawTx(rawtx) || {};
    preparedRawtx = String(rawtx || '');
    preparedTxid = String(inspected.txid || txidFromRaw(rawtx) || '').trim().toLowerCase();
    const outputSummary = (tx.outputs || []).map((output, idx) => {
      let address = '';
      try {
        address = String(output?.script?.toAddress?.(NETWORK) || '');
      } catch (_) {}
      return {
        index: idx,
        satoshis: Number(output?.satoshis || 0),
        address,
      };
    });
    validateRawTxPolicy(rawtx, {
      minStandardOutputSat: SAFE_MIN_CHANGE_SAT,
    });
    await emitStage('wallet_send_signed', {
      txid: String(inspected.txid || txidFromRaw(rawtx) || ''),
      rawtxLength: rawtx.length,
    });
    upsertTxContext(rawtx, {
      source: 'local',
      kind: 'wallet_send',
      confirmed: false,
    });
    const packageResult = buildLocalBroadcastContext(rawtx);
    appendSendLog('send_tx_built', {
      txid: String(inspected.txid || txidFromRaw(rawtx) || ''),
      rawtxLength: rawtx.length,
      inputCount: Array.isArray(tx.inputs) ? tx.inputs.length : 0,
      outputCount: Array.isArray(tx.outputs) ? tx.outputs.length : 0,
      inputTxids: Array.isArray(inspected.inputTxids) ? inspected.inputTxids.slice(0, 12) : [],
      outputs: outputSummary,
      feeSat: Number(feePlan.feeSat || 0),
      absorbedChangeSat: Number(feePlan.absorbedChangeSat || 0),
      changeAddress: String(changeAddress || ''),
      contextFormat: String(packageResult?.format || ''),
      beefFormat: 'local-chain',
      packageTxCount: Number(packageResult.items?.length || 0),
      missingAncestorCount: Number(packageResult.missingAncestors?.length || 0),
      beefComplete: Boolean(packageResult.complete),
    });
    await emitStage('wallet_send_broadcasting', {
      txid: preparedTxid,
      nodeCount: SEND_MAX_NODE_TRIES,
    });
    const broadcast = await broadcastRawTx(rawtx);
    broadcastSucceeded = true;
    const txid = broadcast.txid;
    appendSendLog('send_broadcast_done', {
      txid,
      node: broadcast.node,
      provider: String(broadcast.provider || 'spv-p2p'),
      successCount: Number(broadcast.successCount || 0),
      attemptedCount: Number(broadcast.attemptedCount || 0),
      nodes: Array.isArray(broadcast.nodes) ? broadcast.nodes.slice(0, 8) : [],
      contextFormat: String(broadcast.contextFormat || ''),
      beefFormat: String(broadcast.beefFormat || ''),
      packageTxCount: Number(broadcast.packageTxCount || 0),
      feeSat: Number(feePlan.feeSat || 0),
      absorbedChangeSat: Number(feePlan.absorbedChangeSat || 0),
      elapsedMs: Date.now() - sendStartedAt,
    });
    await emitStage('wallet_send_broadcasted', {
      txid,
      node: broadcast.node,
      successCount: Number(broadcast.successCount || 0),
      attemptedCount: Number(broadcast.attemptedCount || 0),
    });

    const localCommit = commitWalletLocalMutation(rawtx, {
      source: 'wallet_send',
      txid,
      confirmed: false,
      trackOutputs: true,
      requireApplied: true,
      localHeight: Math.max(0, Number(broadcastHeight || localHeight || 0)),
    });
    appendSendLog('send_local_index_applied', {
      txid,
      changeAddress: String(changeAddress || ''),
      outputCount: outputSummary.length,
      confirmed: Number(localCommit?.cache?.confirmed || 0),
      unconfirmed: Number(localCommit?.cache?.unconfirmed || 0),
      total: Number(localCommit?.cache?.total || 0),
    });

    if (note && String(note).trim()) setNote(txid, note.trim());
    appendSendLog('send_post_refresh_skipped_policy', {
      txid,
      reason: 'runtime_auto_refresh_disabled',
    });

    return {
      txid,
      to,
      amountSat: finalAmountSat,
      amountBsv: finalAmountSat / 100000000,
      requestedAmountBsv: sendAll ? 'ALL' : (amountSat / 100000000),
      sendAll,
      rawtx,
      feeSat: Number(feePlan.feeSat || 0),
      feeBsv: Number(feePlan.feeSat || 0) / 100000000,
      node: broadcast.node,
      provider: String(broadcast.provider || 'spv-p2p'),
      contextFormat: String(broadcast.contextFormat || ''),
      beefFormat: String(broadcast.beefFormat || ''),
      packageTxCount: Number(broadcast.packageTxCount || 0),
      beefComplete: Boolean(broadcast.beefComplete),
    };
  } catch (err) {
    if (!broadcastSucceeded && preparedTxid) {
      deleteTxContextByTxid(preparedTxid);
    }
    if (preparedTxid && !err?.txid) err.txid = preparedTxid;
    if (preparedRawtx && !err?.rawtx) err.rawtx = preparedRawtx;
    if (!err?.failureStage) err.failureStage = broadcastSucceeded ? 'post_broadcast' : 'pre_broadcast';
    appendSendLog('send_failed', {
      to,
      amountSat,
      txid: preparedTxid,
      failureStage: String(err?.failureStage || ''),
      error: String(err?.message || 'send failed'),
      elapsedMs: Date.now() - sendStartedAt,
    });
    throw err;
  }
}

async function anchorDataOnChain({
  mnemonic,
  payload,
  note,
  notifyAddresses = [],
  onStage = null,
  excludeOutpoints = null,
  preferredFeeOutpoints = null,
  requirePreferredFee = false,
  requireVisibility = false,
  includeUnconfirmed = false,
  trackOutputs = true,
  localHeight = 0,
  broadcastHeight = 0,
} = {}) {
  assertWalletSendAllowed('anchor');
  const text = String(payload || '').trim();
  if (!text) throw new Error('Payload is required');
  if (Buffer.byteLength(text, 'utf8') > MAX_ANCHOR_PAYLOAD_BYTES) {
    throw new Error(`Payload too large (max ${MAX_ANCHOR_PAYLOAD_BYTES} bytes UTF-8)`);
  }

  const state = getWalletState();
  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  const notificationOutputs = Array.from(new Set((Array.isArray(notifyAddresses) ? notifyAddresses : [notifyAddresses])
    .map((address) => String(address || '').trim())
    .filter(Boolean)));
  let preparedRawtx = '';
  let preparedTxid = '';
  const emitStage = (stage, extra = {}) => {
    if (typeof onStage !== 'function') return;
    try {
      onStage(stage, extra);
    } catch (_) {}
  };
  appendSendLog('anchor_start', { payloadBytes: Buffer.byteLength(text, 'utf8') });

  try {

  let utxos = listSpendableUtxosForState(state, hdPrivateKey, {
    includeUnconfirmed: includeUnconfirmed === true,
    maxAncestorDepth: ANCHOR_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
    excludeOutpoints,
  });
  const preferredFeeOutpointSet = new Set(Array.isArray(preferredFeeOutpoints)
    ? preferredFeeOutpoints.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
    : []);
  if (preferredFeeOutpointSet.size > 0) {
    const beforePreferredFilter = utxos.length;
    const preferred = utxos.filter((utxo) => preferredFeeOutpointSet.has(getUtxoKey(utxo).toLowerCase()));
    appendSendLog('anchor_preferred_fee_utxo_filter', {
      before: beforePreferredFilter,
      preferred: preferred.length,
      requirePreferredFee: requirePreferredFee === true,
      preferredFeeOutpoints: Array.from(preferredFeeOutpointSet),
    });
    if (requirePreferredFee === true) {
      utxos = preferred;
    } else if (preferred.length > 0) {
      utxos = utxos.slice().sort((a, b) => {
        const ap = preferredFeeOutpointSet.has(getUtxoKey(a).toLowerCase()) ? 1 : 0;
        const bp = preferredFeeOutpointSet.has(getUtxoKey(b).toLowerCase()) ? 1 : 0;
        if (ap !== bp) return bp - ap;
        return Number(b.satoshis || 0) - Number(a.satoshis || 0);
      });
    }
  }
  if (includeUnconfirmed === true) {
    await markExternallyVisibleSettlementFeeCandidates(utxos, { limit: 8 });
    const beforeVisibilityFilter = utxos.length;
    utxos = utxos.filter(isAnchorFeeUtxoCandidate);
    appendSendLog('anchor_unconfirmed_visibility_filter', {
      before: beforeVisibilityFilter,
      after: utxos.length,
      excluded: Math.max(0, beforeVisibilityFilter - utxos.length),
    });
  }
  if (!utxos.length) {
    appendSendLog('anchor_no_spendable_utxo_policy_blocked', {
      reason: 'runtime_auto_refresh_disabled',
      includeUnconfirmed: includeUnconfirmed === true,
      maxAncestorDepth: Number.isFinite(Number(ANCHOR_MAX_UNCONFIRMED_ANCESTOR_DEPTH))
        ? Number(ANCHOR_MAX_UNCONFIRMED_ANCESTOR_DEPTH)
        : 'infinity',
    });
  }
  if (!utxos.length) throw buildSpendableUtxoError(state, hdPrivateKey, 'anchoring', ANCHOR_MAX_UNCONFIRMED_ANCESTOR_DEPTH);
	  const selection = selectUtxosForTransaction(utxos, {
	    targetSat: ANCHOR_DATA_OUTPUT_SAT + (notificationOutputs.length * SAFE_MIN_CHANGE_SAT),
	    outputCount: 2 + notificationOutputs.length,
	    dataBytes: Buffer.byteLength(text, 'utf8'),
	    feeRate: DEFAULT_FEE_RATE,
	    allowConsolidation: true,
  });
  utxos = selection.utxos;
  appendSendLog('anchor_utxo_ready', {
    utxoCount: utxos.length,
    utxoTotalSat: utxos.reduce((a, u) => a + Number(u.satoshis || 0), 0),
    selectedForAnchor: utxos.length,
    estimatedFeeSat: Number(selection.estimatedFeeSat || 0),
    consolidationApplied: Boolean(selection.consolidationApplied),
    consolidationInputCount: Number(selection.consolidationInputCount || 0),
    includeUnconfirmed: includeUnconfirmed === true,
    selected: utxos.map((u) => ({
      txid: String(u.txId || ''),
      vout: Number(u.vout),
      satoshis: Number(u.satoshis || 0),
      confirmed: Boolean(u.confirmed),
      ancestorDepth: Number(u.ancestorDepth || 0),
    })),
  });
  emitStage('wallet_anchor_composed', {
    utxoCount: utxos.length,
    estimatedFeeSat: Number(selection.estimatedFeeSat || 0),
    payloadBytes: Buffer.byteLength(text, 'utf8'),
  });

  const tx = new bsv.Transaction();
  tx.from(utxos);
	  tx.addOutput(new bsv.Transaction.Output({
	    script: bsv.Script.buildDataOut(Buffer.from(text, 'utf8')),
	    satoshis: ANCHOR_DATA_OUTPUT_SAT,
	  }));
	  for (const address of notificationOutputs) {
	    tx.to(new bsv.Address(address, NETWORK), SAFE_MIN_CHANGE_SAT);
	  }
	  const changeAddress = new bsv.Address(getReceiveAddressFromState(state), NETWORK);
  const feePlan = finalizeFeeAndSign(tx, utxos, changeAddress, DEFAULT_FEE_RATE, SAFE_MIN_CHANGE_SAT);
  const feeSat = Number(feePlan.feeSat || 0);

  const rawtx = tx.serialize();
  const policyValidation = validateRawTxPolicy(rawtx, {
    minStandardOutputSat: SAFE_MIN_CHANGE_SAT,
    minDataOutputSat: ANCHOR_DATA_OUTPUT_SAT,
  });
  const anchorValidation = validateAnchorRawTx(rawtx, ANCHOR_DATA_OUTPUT_SAT);
  const inspected = inspectRawTx(rawtx) || {};
  preparedRawtx = String(rawtx || '');
  preparedTxid = String(inspected.txid || txidFromRaw(rawtx) || '').trim().toLowerCase();
  emitStage('wallet_anchor_signed', {
    txid: String(inspected.txid || txidFromRaw(rawtx) || ''),
    rawtxLength: rawtx.length,
    payloadBytes: Buffer.byteLength(text, 'utf8'),
  });
  let broadcast;
  try {
    broadcast = await broadcastRawTx(rawtx, {
      requireVisibility: requireVisibility === true,
    });
  } catch (err) {
    const failedTxid = String(inspected.txid || txidFromRaw(rawtx) || '').trim().toLowerCase();
    deleteTxContextByTxid(failedTxid);
    appendSendLog('anchor_broadcast_failed', {
      txid: failedTxid,
      rawtxLength: rawtx.length,
      rawtx,
      feeSat,
      payloadBytes: Buffer.byteLength(text, 'utf8'),
      outputCount: Number(policyValidation.outputCount || 0),
      dataOutputCount: Number(policyValidation.dataOutputCount || 0),
      standardOutputCount: Number(policyValidation.standardOutputCount || 0),
      smallestStandardOutputSat: Number(policyValidation.smallestStandardOutputSat || 0),
      smallestDataOutputSat: Number(anchorValidation.smallestDataOutputSat || policyValidation.smallestDataOutputSat || 0),
      inputTxids: Array.isArray(inspected.inputTxids) ? inspected.inputTxids.slice(0, 8) : [],
      error: String(err?.message || 'SPV broadcast failed'),
    });
    err.rawtx = rawtx;
    err.txid = failedTxid;
    err.feeSat = feeSat;
    err.payloadBytes = Buffer.byteLength(text, 'utf8');
    err.policyValidation = policyValidation;
    err.anchorValidation = anchorValidation;
    err.inputTxids = Array.isArray(inspected.inputTxids) ? inspected.inputTxids.slice(0, 8) : [];
    err.failureStage = 'broadcast_failed';
    throw err;
  }
  const txid = broadcast.txid;
  appendSendLog('anchor_broadcast_done', {
    txid,
    node: broadcast.node,
    feeSat,
    smallestStandardOutputSat: Number(policyValidation.smallestStandardOutputSat || 0),
    dataOutputSat: anchorValidation.smallestDataOutputSat,
    absorbedChangeSat: Number(feePlan.absorbedChangeSat || 0),
    contextFormat: String(broadcast.contextFormat || ''),
    beefFormat: String(broadcast.beefFormat || ''),
    packageTxCount: Number(broadcast.packageTxCount || 0),
    beefComplete: Boolean(broadcast.beefComplete),
  });
  emitStage('wallet_anchor_broadcasted', {
    txid,
    node: broadcast.node,
    successCount: Number(broadcast.successCount || 0),
    attemptedCount: Number(broadcast.attemptedCount || 0),
  });

  // Market anchors spend wallet UTXOs and normally create wallet change. Track
  // local outputs by default so the wallet index does not drop the change UTXO.
  commitWalletLocalMutation(rawtx, {
    source: 'wallet_anchor',
    txid,
    confirmed: false,
    trackOutputs: trackOutputs !== false,
    requireApplied: true,
    localHeight: Math.max(0, Number(broadcastHeight || localHeight || 0)),
  });
  if (note && String(note).trim()) setNote(txid, note.trim());

  return {
    txid,
    payload: text,
    payloadBytes: Buffer.byteLength(text, 'utf8'),
    node: broadcast.node,
    nodes: Array.isArray(broadcast.nodes) ? broadcast.nodes.slice(0, 8) : [],
    successCount: Number(broadcast.successCount || 0),
    attemptedCount: Number(broadcast.attemptedCount || 0),
    feeSat,
    feeBsv: feeSat / 100000000,
    rawtx,
    contextFormat: String(broadcast.contextFormat || ''),
    beefFormat: String(broadcast.beefFormat || ''),
    packageTxCount: Number(broadcast.packageTxCount || 0),
    beefComplete: Boolean(broadcast.beefComplete),
  };
  } catch (err) {
    if (preparedTxid && !err?.txid) err.txid = preparedTxid;
    if (preparedRawtx && !err?.rawtx) err.rawtx = preparedRawtx;
    if (!err?.failureStage) err.failureStage = preparedRawtx ? 'broadcast_failed' : 'compose_failed';
    throw err;
  }
}

async function anchorDataBatchOnChain({
  mnemonic,
  payloads,
  note,
  onStage = null,
  excludeOutpoints = null,
  includeUnconfirmed = false,
  trackOutputs = true,
  localHeight = 0,
  broadcastHeight = 0,
} = {}) {
  assertWalletSendAllowed('anchor');
  const items = (Array.isArray(payloads) ? payloads : [])
    .map((entry) => ({
      payload: String(entry?.payload || '').trim(),
      note: String(entry?.note || note || '').trim(),
    }))
    .filter((entry) => entry.payload);
  if (!items.length) throw new Error('Payloads are required');
  for (const entry of items) {
    if (Buffer.byteLength(entry.payload, 'utf8') > MAX_ANCHOR_PAYLOAD_BYTES) {
      throw new Error(`Payload too large (max ${MAX_ANCHOR_PAYLOAD_BYTES} bytes UTF-8)`);
    }
  }

  const state = getWalletState();
  const hdPrivateKey = getHdPrivateKeyFromMnemonic(mnemonic);
  const totalPayloadBytes = items.reduce((sum, entry) => sum + Buffer.byteLength(entry.payload, 'utf8'), 0);
  let preparedRawtx = '';
  let preparedTxid = '';
  const emitStage = (stage, extra = {}) => {
    if (typeof onStage !== 'function') return;
    try { onStage(stage, extra); } catch (_) {}
  };
  appendSendLog('anchor_batch_start', {
    payloadCount: items.length,
    payloadBytes: totalPayloadBytes,
  });

  try {
    let utxos = listSpendableUtxosForState(state, hdPrivateKey, {
      includeUnconfirmed: includeUnconfirmed === true,
      maxAncestorDepth: ANCHOR_MAX_UNCONFIRMED_ANCESTOR_DEPTH,
      excludeOutpoints,
    });
    if (!utxos.length) {
      appendSendLog('anchor_batch_no_spendable_utxo_policy_blocked', {
        reason: 'runtime_auto_refresh_disabled',
        includeUnconfirmed: includeUnconfirmed === true,
      });
    }
    if (!utxos.length) throw buildSpendableUtxoError(state, hdPrivateKey, 'anchoring batch', ANCHOR_MAX_UNCONFIRMED_ANCESTOR_DEPTH);
    const selection = selectUtxosForTransaction(utxos, {
      targetSat: ANCHOR_DATA_OUTPUT_SAT * items.length,
      outputCount: items.length + 1,
      dataBytes: totalPayloadBytes,
      feeRate: DEFAULT_FEE_RATE,
      allowConsolidation: true,
    });
    utxos = selection.utxos;
    appendSendLog('anchor_batch_utxo_ready', {
      payloadCount: items.length,
      utxoCount: utxos.length,
      utxoTotalSat: utxos.reduce((a, u) => a + Number(u.satoshis || 0), 0),
      estimatedFeeSat: Number(selection.estimatedFeeSat || 0),
      includeUnconfirmed: includeUnconfirmed === true,
      selected: utxos.map((u) => ({
        txid: String(u.txId || ''),
        vout: Number(u.vout),
        satoshis: Number(u.satoshis || 0),
        confirmed: Boolean(u.confirmed),
        ancestorDepth: Number(u.ancestorDepth || 0),
      })),
    });
    emitStage('wallet_anchor_batch_composed', {
      utxoCount: utxos.length,
      estimatedFeeSat: Number(selection.estimatedFeeSat || 0),
      payloadCount: items.length,
      payloadBytes: totalPayloadBytes,
    });

    const tx = new bsv.Transaction();
    tx.from(utxos);
    for (const entry of items) {
      tx.addOutput(new bsv.Transaction.Output({
        script: bsv.Script.buildDataOut(Buffer.from(entry.payload, 'utf8')),
        satoshis: ANCHOR_DATA_OUTPUT_SAT,
      }));
    }
    const changeAddress = new bsv.Address(getReceiveAddressFromState(state), NETWORK);
    const feePlan = finalizeFeeAndSign(tx, utxos, changeAddress, DEFAULT_FEE_RATE, SAFE_MIN_CHANGE_SAT);
    const feeSat = Number(feePlan.feeSat || 0);
    const rawtx = tx.serialize();
    const policyValidation = validateRawTxPolicy(rawtx, {
      minStandardOutputSat: SAFE_MIN_CHANGE_SAT,
      minDataOutputSat: ANCHOR_DATA_OUTPUT_SAT,
    });
    const inspected = inspectRawTx(rawtx) || {};
    preparedRawtx = String(rawtx || '');
    preparedTxid = String(inspected.txid || txidFromRaw(rawtx) || '').trim().toLowerCase();
    emitStage('wallet_anchor_batch_signed', {
      txid: preparedTxid,
      rawtxLength: rawtx.length,
      payloadCount: items.length,
      payloadBytes: totalPayloadBytes,
    });
    let broadcast;
    try {
      broadcast = await broadcastRawTx(rawtx);
    } catch (err) {
      const failedTxid = String(inspected.txid || txidFromRaw(rawtx) || '').trim().toLowerCase();
      deleteTxContextByTxid(failedTxid);
      appendSendLog('anchor_batch_broadcast_failed', {
        txid: failedTxid,
        rawtxLength: rawtx.length,
        feeSat,
        payloadCount: items.length,
        payloadBytes: totalPayloadBytes,
        outputCount: Number(policyValidation.outputCount || 0),
        dataOutputCount: Number(policyValidation.dataOutputCount || 0),
        inputTxids: Array.isArray(inspected.inputTxids) ? inspected.inputTxids.slice(0, 8) : [],
        error: String(err?.message || 'SPV broadcast failed'),
      });
      err.rawtx = rawtx;
      err.txid = failedTxid;
      err.feeSat = feeSat;
      err.payloadBytes = totalPayloadBytes;
      err.inputTxids = Array.isArray(inspected.inputTxids) ? inspected.inputTxids.slice(0, 8) : [];
      err.failureStage = 'broadcast_failed';
      throw err;
    }
    const txid = broadcast.txid;
    appendSendLog('anchor_batch_broadcast_done', {
      txid,
      node: broadcast.node,
      feeSat,
      payloadCount: items.length,
      payloadBytes: totalPayloadBytes,
      dataOutputCount: Number(policyValidation.dataOutputCount || 0),
      smallestStandardOutputSat: Number(policyValidation.smallestStandardOutputSat || 0),
      absorbedChangeSat: Number(feePlan.absorbedChangeSat || 0),
      contextFormat: String(broadcast.contextFormat || ''),
      beefFormat: String(broadcast.beefFormat || ''),
      packageTxCount: Number(broadcast.packageTxCount || 0),
      beefComplete: Boolean(broadcast.beefComplete),
      observed: Boolean(broadcast.observed),
      observedRelevant: Boolean(broadcast.observedRelevant),
      observedConfirmed: Boolean(broadcast.observedConfirmed),
      observedNode: String(broadcast.observedNode || ''),
    });
    emitStage('wallet_anchor_batch_broadcasted', {
      txid,
      node: broadcast.node,
      successCount: Number(broadcast.successCount || 0),
      attemptedCount: Number(broadcast.attemptedCount || 0),
      observed: Boolean(broadcast.observed),
      observedRelevant: Boolean(broadcast.observedRelevant),
      observedConfirmed: Boolean(broadcast.observedConfirmed),
      observedNode: String(broadcast.observedNode || ''),
      payloadCount: items.length,
    });
    commitWalletLocalMutation(rawtx, {
      source: 'wallet_anchor_batch',
      txid,
      confirmed: false,
      trackOutputs: trackOutputs !== false,
      requireApplied: true,
      localHeight: Math.max(0, Number(broadcastHeight || localHeight || 0)),
    });
    if (note && String(note).trim()) setNote(txid, note.trim());
    return {
      txid,
      payloadCount: items.length,
      payloadBytes: totalPayloadBytes,
      node: broadcast.node,
      nodes: Array.isArray(broadcast.nodes) ? broadcast.nodes.slice(0, 8) : [],
      successCount: Number(broadcast.successCount || 0),
      attemptedCount: Number(broadcast.attemptedCount || 0),
      feeSat,
      feeBsv: feeSat / 100000000,
      rawtx,
      contextFormat: String(broadcast.contextFormat || ''),
      beefFormat: String(broadcast.beefFormat || ''),
      packageTxCount: Number(broadcast.packageTxCount || 0),
      beefComplete: Boolean(broadcast.beefComplete),
      observed: Boolean(broadcast.observed),
      observedRelevant: Boolean(broadcast.observedRelevant),
      observedConfirmed: Boolean(broadcast.observedConfirmed),
      observedNode: String(broadcast.observedNode || ''),
    };
  } catch (err) {
    if (preparedTxid && !err?.txid) err.txid = preparedTxid;
    if (preparedRawtx && !err?.rawtx) err.rawtx = preparedRawtx;
    if (!err?.failureStage) err.failureStage = preparedRawtx ? 'broadcast_failed' : 'compose_failed';
    throw err;
  }
}

function getHistoryPage(page = 1, pageSize = DEFAULT_HISTORY_PAGE_SIZE) {
  const cache = getCachedBalanceAndHistory();
  const notes = getNotesMap();
  const index = getSpvIndex();
  const txMap = index.txs || {};
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Math.min(50, Number(pageSize) || DEFAULT_HISTORY_PAGE_SIZE));

  const rows = (cache.txids || []).map((txid) => ({
    txid,
    note: notes[txid]?.note || '',
    notedAt: notes[txid]?.updatedAt || null,
    confirmed: Boolean(txMap[txid]?.confirmed),
    netSat: Number(txMap[txid]?.netSat || 0),
    lastSeenAt: txMap[txid]?.lastSeenAt || null,
  }));

  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const start = (safePage - 1) * safePageSize;

  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    items: rows.slice(start, start + safePageSize),
    updatedAt: cache.updatedAt,
  };
}

function getHistorySnapshot() {
  const cache = getCachedBalanceAndHistory();
  const notes = getNotesMap();
  const index = getSpvIndex();
  const txMap = index.txs || {};
  const items = (cache.txids || []).map((txid) => ({
    txid,
    note: notes[txid]?.note || '',
    notedAt: notes[txid]?.updatedAt || null,
    confirmed: Boolean(txMap[txid]?.confirmed),
    netSat: Number(txMap[txid]?.netSat || 0),
    lastSeenAt: txMap[txid]?.lastSeenAt || null,
  }));
  return {
    total: items.length,
    items,
    updatedAt: cache.updatedAt || null,
  };
}

function getWalletReadSnapshot(options = {}) {
  const walletState = getWalletStateSnapshotInternal();
  const walletKey = getReceiveAddressFromState(walletState);
  const cache = getCachedBalanceAndHistory();
  const includeHistory = options?.includeHistory === true;
  const history = includeHistory ? getHistorySnapshot() : null;
  return {
    walletKey,
    receiveAddress: walletKey,
    confirmed: Number(cache.confirmed || 0),
    unconfirmed: Number(cache.unconfirmed || 0),
    pendingDelta: Number(cache.pendingDelta || 0),
    available: Number(cache.available || cache.total || 0),
    availableBsv: Number(cache.availableBsv || ((cache.available || cache.total || 0) / 100000000)),
    selfChangePending: Number(cache.selfChangePending || 0),
    unconfirmedIncoming: Number(cache.unconfirmedIncoming || cache.unconfirmed || 0),
    incomeSat: Number(cache.incomeSat || 0),
    expenseSat: Number(cache.expenseSat || 0),
    total: Number(cache.total || 0),
    totalBsv: Number(cache.total || 0) / 100000000,
    updatedAt: cache.updatedAt || null,
    history,
  };
}

function extractWalletTxIoFacts(rawtx, contextByTxid = null) {
  const tx = txFromUnknown(rawtx);
  if (!tx) return null;
  const watchSet = getWatchedAddresses();
  const index = getSpvIndex();
  const outputs = [];
  let walletOutputSat = 0;
  let externalOutputSat = 0;
  let outputTotalSat = 0;
  let hasDataOutput = false;
  for (let vout = 0; vout < (tx.outputs || []).length; vout += 1) {
    const output = tx.outputs[vout];
    const satoshis = Number(output?.satoshis || 0);
    outputTotalSat += Math.max(0, satoshis);
    let address = '';
    try {
      address = String(output?.script?.toAddress?.(NETWORK) || '').trim();
    } catch (_) {
      address = '';
    }
    const isData = !address;
    const isWalletOwned = Boolean(address && watchSet.has(address));
    if (isData) hasDataOutput = true;
    if (isWalletOwned) walletOutputSat += Math.max(0, satoshis);
    else if (!isData) externalOutputSat += Math.max(0, satoshis);
    outputs.push({
      vout,
      satoshis: Math.max(0, satoshis),
      address,
      isWalletOwned,
      isData,
      outpoint: `${String(tx.id || '').trim().toLowerCase()}:${vout}`,
    });
  }
  const resolveContext = (txid) => {
    const safeTxid = String(txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(safeTxid)) return null;
    if (contextByTxid instanceof Map && contextByTxid.has(safeTxid)) return contextByTxid.get(safeTxid) || null;
    return getTxContextByTxid(safeTxid);
  };
  const inputs = [];
  let walletInputSat = 0;
  let totalInputSat = 0;
  for (const input of (tx.inputs || [])) {
    const prevTxId = Buffer.isBuffer(input?.prevTxId)
      ? input.prevTxId.toString('hex')
      : String(input?.prevTxId || '').trim().toLowerCase();
    const vout = Number(input?.outputIndex);
    if (!/^[0-9a-f]{64}$/i.test(prevTxId) || !Number.isInteger(vout) || vout < 0) continue;
    const outpoint = `${prevTxId}:${vout}`;
    let satoshis = Number(index?.ownedOutpoints?.[outpoint] || index?.utxos?.[outpoint]?.satoshis || 0);
    let address = String(index?.utxos?.[outpoint]?.address || '').trim();
    let isWalletOwned = Boolean(address && watchSet.has(address));
    const parentCtx = resolveContext(prevTxId);
    if (parentCtx?.rawtx) {
      const parentTx = txFromUnknown(parentCtx.rawtx);
      const parentOutput = parentTx?.outputs?.[vout];
      if (parentOutput) {
        satoshis = Number(parentOutput?.satoshis || satoshis || 0);
        try {
          address = String(parentOutput?.script?.toAddress?.(NETWORK) || '').trim();
        } catch (_) {
          address = address || '';
        }
        isWalletOwned = Boolean(address && watchSet.has(address));
      }
    }
    satoshis = Math.max(0, Number(satoshis || 0));
    totalInputSat += satoshis;
    if (isWalletOwned) walletInputSat += satoshis;
    inputs.push({
      txid: prevTxId,
      vout,
      outpoint,
      satoshis,
      address,
      isWalletOwned,
    });
  }
  const feeSat = Math.max(0, totalInputSat - outputTotalSat);
  return {
    txid: String(tx.id || '').trim().toLowerCase(),
    inputs,
    outputs,
    walletInputSat,
    walletOutputSat,
    externalOutputSat,
    totalInputSat,
    outputTotalSat,
    feeSat,
    hasDataOutput,
  };
}

function buildWalletBusinessSnapshot(page = 1, pageSize = DEFAULT_HISTORY_PAGE_SIZE) {
  const walletState = getWalletStateSnapshotInternal();
  const walletKey = getReceiveAddressFromState(walletState);
  if (!walletKey) {
    return {
      walletKey: '',
      receiveAddress: '',
      confirmed: 0,
      unconfirmed: 0,
      pendingDelta: 0,
      incomeSat: 0,
      expenseSat: 0,
      total: 0,
      totalBsv: 0,
      updatedAt: null,
      page: 1,
      pageSize: Math.max(1, Number(pageSize || DEFAULT_HISTORY_PAGE_SIZE)),
      totalItems: 0,
      totalPages: 1,
      items: [],
    };
  }
  const index = getSpvIndex();
  const notes = getNotesMap();
  const nowIso = new Date().toISOString();
  const displaySummary = buildWalletDisplayUtxoSummary(index);
  const confirmedUtxoSat = Number(displaySummary.confirmed || 0);
  const selfChangePendingSat = Number(displaySummary.selfChangePending || 0);
  const unconfirmedIncomingSat = Number(displaySummary.unconfirmedIncoming || 0);
  const availableSat = Number(displaySummary.available || 0);
  const rawTotalSat = Number(displaySummary.total || 0);
  const txRowsSorted = Object.values(index?.txs || {})
    .slice()
    .sort((a, b) => {
      const ta = Date.parse(String(a?.lastSeenAt || '')) || 0;
      const tb = Date.parse(String(b?.lastSeenAt || '')) || 0;
      if (tb !== ta) return tb - ta;
      return String(a?.txid || '').localeCompare(String(b?.txid || ''));
    });
  const candidateLimit = Math.max(20, Math.min(60, Math.max(Number(page || 1) * Number(pageSize || DEFAULT_HISTORY_PAGE_SIZE) * 2, 20)));
  const txids = txRowsSorted
    .slice(0, candidateLimit)
    .map((row) => String(row?.txid || '').trim().toLowerCase())
    .filter((txid) => /^[0-9a-f]{64}$/i.test(txid));
  const anchorEventTypeByTxid = getAnchorEventTypeMap(txids);
  const items = [];
  let pendingBusinessDeltaSat = 0;
  for (const txid of txids) {
    const safeTxid = String(txid || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/i.test(safeTxid)) continue;
    const txRow = index?.txs?.[safeTxid] || {};
    const ctx = getTxContextByTxid(safeTxid);
    const anchorEventType = String(anchorEventTypeByTxid.get(safeTxid) || '').trim();
    const contextKind = String(ctx?.kind || '').trim();
    const note = String(notes?.[safeTxid]?.note || (anchorEventType ? `market:${anchorEventType}` : '') || (contextKind ? `market:${contextKind}` : '')).trim();
    const facts = ctx?.rawtx ? extractWalletTxIoFacts(ctx.rawtx, null) : null;
    let kind = '';
    let amountSat = 0;
    let balanceImpactSat = 0;
    const isMarketTx = note === 'market-send' || note.startsWith('market:');
    if (facts) {
      if (isMarketTx && facts.walletOutputSat > 0 && facts.externalOutputSat <= 0 && facts.hasDataOutput === true) {
        kind = 'external_spend';
        amountSat = Math.max(0, Number(facts.feeSat || 0)) || DEFAULT_MARKET_FEE_DISPLAY_SAT;
        balanceImpactSat = amountSat;
      } else if (facts.walletInputSat <= 0 && facts.walletOutputSat > 0) {
        kind = 'external_receive';
        amountSat = facts.walletOutputSat;
        balanceImpactSat = facts.walletOutputSat;
      } else if (facts.walletInputSat > 0) {
        const walletGainSat = Math.max(0, facts.walletOutputSat - facts.walletInputSat);
        const walletLossSat = Math.max(0, facts.walletInputSat - facts.walletOutputSat);
        const isPureSelf = !isMarketTx && facts.externalOutputSat <= 0 && facts.hasDataOutput !== true;
        const marketDataOnly = isMarketTx && facts.externalOutputSat <= 0;
        if (walletGainSat > 0) {
          kind = 'external_receive';
          amountSat = walletGainSat;
          balanceImpactSat = walletGainSat;
        } else if (walletLossSat > 0) {
          if (isPureSelf) {
            kind = 'self_consolidation_fee';
            amountSat = Math.max(0, Number(facts.feeSat || walletLossSat));
            balanceImpactSat = amountSat;
          } else if (marketDataOnly) {
            kind = 'external_spend';
            amountSat = Math.max(0, Number(facts.feeSat || walletLossSat));
            balanceImpactSat = amountSat;
          } else {
            kind = 'external_spend';
            amountSat = Math.max(0, Number(facts.externalOutputSat || 0));
            if (amountSat <= 0) amountSat = walletLossSat;
            balanceImpactSat = Math.max(0, Number(facts.externalOutputSat || 0)) + Math.max(0, Number(facts.feeSat || 0));
            if (balanceImpactSat <= 0) balanceImpactSat = walletLossSat;
          }
        }
      }
    } else {
      const netSat = Number(txRow?.netSat || 0);
      const isMarketFallback = note === 'market-send' || note.startsWith('market:');
      if (isMarketFallback) {
        kind = 'external_spend';
        amountSat = Math.max(0, Math.trunc(Number(txRow?.feeSat || 0))) || DEFAULT_MARKET_FEE_DISPLAY_SAT;
        balanceImpactSat = amountSat;
      } else if (netSat > 0) {
        kind = 'external_receive';
        amountSat = netSat;
        balanceImpactSat = netSat;
      } else if (netSat < 0) {
        kind = 'external_spend';
        amountSat = Math.abs(netSat);
        balanceImpactSat = Math.abs(netSat);
      }
    }
    if (!kind || amountSat <= 0) continue;
    let label = kind === 'external_receive' ? '收入' : '支出';
    if (kind === 'self_consolidation_fee') label = '归集手续费';
    if (kind === 'external_spend' && (note === 'market-send' || note.startsWith('market:'))) label = '上链支出';
    if (kind === 'external_receive' && note === 'market:order_confirm') label = '商品收入';
    const confirmed = Boolean(txRow?.confirmed || ctx?.confirmed);
    const lastSeenAt = String(txRow?.lastSeenAt || ctx?.lastSeenAt || notes?.[safeTxid]?.updatedAt || nowIso);
    if (!confirmed) {
      const signedDelta = kind === 'external_receive'
        ? Math.max(0, Math.trunc(balanceImpactSat || amountSat))
        : -Math.max(0, Math.trunc(balanceImpactSat || amountSat));
      pendingBusinessDeltaSat += signedDelta;
    }
    items.push({
      entryId: safeTxid,
      txid: safeTxid,
      kind,
      amountSat: Math.max(0, Math.trunc(amountSat)),
      confirmed,
      label,
      note,
      lastSeenAt,
    });
  }
  items.sort((a, b) => {
    const ta = Date.parse(String(a?.lastSeenAt || '')) || 0;
    const tb = Date.parse(String(b?.lastSeenAt || '')) || 0;
    if (tb !== ta) return tb - ta;
    return String(a?.txid || '').localeCompare(String(b?.txid || ''));
  });
  const safePage = Math.max(1, Number(page || 1));
  const safePageSize = Math.max(1, Math.min(50, Number(pageSize || DEFAULT_HISTORY_PAGE_SIZE)));
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const start = (safePage - 1) * safePageSize;
  const incomeSat = items.reduce((acc, row) => row.kind === 'external_receive' ? acc + Number(row.amountSat || 0) : acc, 0);
  const expenseSat = items.reduce((acc, row) => row.kind !== 'external_receive' ? acc + Number(row.amountSat || 0) : acc, 0);
  const totalSat = rawTotalSat;
  const confirmedSat = confirmedUtxoSat;
  const unconfirmedSat = unconfirmedIncomingSat;
  const pendingDeltaSat = Math.trunc(pendingBusinessDeltaSat);
  return {
    walletKey,
    receiveAddress: walletKey,
    confirmed: confirmedSat,
    unconfirmed: unconfirmedSat,
    pendingDelta: pendingDeltaSat,
    available: availableSat,
    availableBsv: availableSat / 100000000,
    selfChangePending: selfChangePendingSat,
    unconfirmedIncoming: unconfirmedIncomingSat,
    incomeSat,
    expenseSat,
    total: totalSat,
    totalBsv: totalSat / 100000000,
    updatedAt: String(index?.updatedAt || nowIso),
    page: safePage,
    pageSize: safePageSize,
    totalItems,
    totalPages,
    items: items.slice(start, start + safePageSize),
  };
}

module.exports = {
  NETWORK,
  API_NETWORK,
  DEFAULT_HISTORY_PAGE_SIZE,
  DEFAULT_FEE_RATE,
  FINAL_SIGNED_FEE_SAFETY_SAT,
  DEFAULT_RESCAN_COUNT,
  MAX_ANCHOR_PAYLOAD_BYTES,
  ensureDataDir,
  walletExists,
  resetWalletData,
  generateMnemonic,
  createWallet,
  createWalletFromMnemonic,
  importWalletFromMnemonic,
  recoverWallet,
  getMnemonicFromPassword,
  getWalletState,
  getHdPrivateKeyFromMnemonic,
  listSpendableUtxosForState,
  deriveChatKeypairFromMnemonic,
  deriveChatPublicKeyFromMnemonic,
  signWalletKeyBind,
  verifyWalletKeyBind,
  signChatEnvelope,
  verifyChatEnvelope,
  encryptChatMessage,
  decryptChatMessage,
  refreshBalancesAndHistory,
  isTxConfirmedInSpvIndex,
  isTxSeenInSpvIndex,
  isTxVisibleOnPublicIndex,
  getCachedBalanceAndHistory,
  getReceiveAddress,
  createNewReceiveAddress,
  sendBsv,
  anchorDataOnChain,
  anchorDataBatchOnChain,
  buildOrderBuyerLockRedeemScript,
  buildOrderJointRedeemScript,
  buildOrderPlaceLockTx,
  getOrderPlaceContext,
  buildOrderStateTransitionTx,
  buildOrderSellerLockTx,
  buildOrderAcceptBuyerTemplate,
  buildOrderSellerCancelTemplate,
  buildOrderAcceptFinalizeTx,
  buildOrderTimeoutCancelTx,
  buildOrderSellerCancelTx,
  buildOrderSettlementDraft,
  signOrderSettlementDraft,
  computeOrderSellerDepositSats,
  estimateOrderSettlementDraftRawtxBytes,
  estimateOrderSettlementDraftRawtxHexChars: (options = {}) => estimateOrderSettlementDraftRawtxBytes(options) * 2,
  estimateOrderSettlementFeeReserveSat,
  estimateAnchorDataFeeReserveSat,
  ORDER_ANCHOR_OUTPUT_SAT,
  ORDER_SETTLEMENT_FEE_RESERVE_SAT,
  ORDER_SHIP_ANCHOR_FEE_RESERVE_SAT,
  commitWalletLocalMutation,
  getHistoryPage,
  getHistorySnapshot,
  getWalletReadSnapshot,
  rebuildWalletIndexFromLocalData,
  buildWalletBusinessSnapshot,
  rescanWalletAddresses,
  getSpvNodeSnapshot,
  getWalletDisplayNodeSnapshot,
  getSpvRuntimeSnapshot,
  getWalletNodeManagerSnapshot,
  getWalletP2PNodeSelector,
  createWalletSyncNodeAllocator,
  getWalletRuntimePolicy,
  setWalletRuntimePolicy,
  ensureSpvListenerActive,
  refreshUnconfirmedWalletSnapshot,
  onWalletCacheChanged,
  stopSpvListener,
  broadcastRawTx,
  listBroadcastMonitorRecords,
  monitorPendingBroadcasts,
  rebroadcastMonitoredTx,
  inspectRawTx,
  rawtxHexFromUnknown,
  getWalletTouchHints,
  transactionTouchesWallet,
  transactionTouchesWalletWithHints,
  buildConfirmedBlockTxSummary,
  applyConfirmedTxSummaryToSpvIndex,
  clearWalletLocalIndex,
  rebuildWalletIndexFromLocalData,
  rebuildLocalIndexFromQueueRawtxs,
  syncLocalIndexFromRecentRawtxs,
  ingestConfirmedBlockTransaction,
  applyConfirmedWalletRawtx,
  confirmWalletTransaction,
  validateRawTxPolicy,
  markTxConfirmedInIndex,
  reconcileUnconfirmedUtxosWithConfirmedChain,
  reconcileStalePendingWalletTxs,
  reconcileConfirmedUtxoSetWithWoc,
  reconcilePendingWalletIndexWithWoc,
  getWalletSyncProgress,
  getLocalIndexStats,
  listWalletUtxoAudit,
  listTxContexts,
  getTxContextByTxid,
  upsertTxContext,
  ensureDirectParentTxContexts,
  scheduleDirectParentTxContextBackfill,
  buildLocalBroadcastContext,
  deleteTxContextByTxid,
  revertPendingWalletTx,
  _test: {
    normalizeRejectMessage,
    isTransientBroadcastNodeFailure,
    isPreferredBroadcastCandidate,
    collectMissingDirectParentTxids,
    ensureDirectParentTxContexts,
    scheduleDirectParentTxContextBackfill,
    broadcastRawTxViaNode,
    finalizeSendAllFeeAndSign,
    applyTxToSpvIndex,
    transactionMentionsCurrentWalletId,
    revertPendingTxInSpvIndex,
    buildWalletDisplayUtxoSummary,
    listSpendableUtxosForState,
  },
};
