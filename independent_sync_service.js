const fs = require('fs');
const path = require('path');
const axios = require('axios');

const marketDb = require('./market_db');
const bhsDomain = require('./bhs_domain');
const wallet = require('./wallet');
const syncRuntime = require('./independent_sync_runtime');
const p2pNodeRuntime = require('./p2p_node_runtime');

const ROOT = __dirname;
const DATA_DIR = process.env.BSV_MARKET_DATA_DIR
  ? path.resolve(process.env.BSV_MARKET_DATA_DIR)
  : path.join(ROOT, 'data');
const LOG_DIR = process.env.BSV_MARKET_LOG_DIR
  ? path.resolve(process.env.BSV_MARKET_LOG_DIR)
  : path.join(ROOT, 'log');
const MARKET_DEBUG_LOG_FILE = path.join(LOG_DIR, 'market-debug.log');
const SYNC_NODE_STATS_SNAPSHOT_FILE = path.join(DATA_DIR, 'sync_node_stats_snapshot.json');
const SYNC_RETAINED_GOOD_NODES_FILE = path.join(DATA_DIR, 'sync_retained_good_nodes.json');
const BHS_STATE_FILE = path.join(DATA_DIR, 'bhs_state.json');
const HEIGHT_HASH_HTTP_TIMEOUT_MS = Math.max(1000, Number(process.env.BSV_MARKET_CHAIN_HTTP_TIMEOUT_MS || 12000));
const HEIGHT_HASH_MAX_TRIES = Math.max(1, Number(process.env.BSV_MARKET_CHAIN_HTTP_MAX_TRIES || 3));
const HEIGHT_HASH_SOURCES_ENV = String(process.env.BSV_MARKET_CHAIN_HTTP_SOURCES || '').trim();
const HEIGHT_HASH_BHS_WAIT_MS = Math.max(1000, Number(process.env.BSV_MARKET_HEIGHT_HASH_BHS_WAIT_MS || 30000));
const HEIGHT_HASH_BHS_POLL_MS = Math.max(100, Number(process.env.BSV_MARKET_HEIGHT_HASH_BHS_POLL_MS || 500));
const DEFAULT_COUNT = Math.max(1, Number(process.env.BSV_MARKET_FRONTIER_TEST_COUNT || 8));
const DEFAULT_CONNECT_TIMEOUT_MS = Math.max(1000, Number(process.env.BSV_MARKET_P2P_CONNECT_TIMEOUT_MS || 8000));
const DEFAULT_GETBLOCK_TIMEOUT_MS = Math.max(1000, Number(process.env.BSV_MARKET_P2P_GETBLOCK_TIMEOUT_MS || 20000));
const DEFAULT_GETBLOCK_IDLE_TIMEOUT_MS = Math.max(1000, Number(process.env.BSV_MARKET_P2P_GETBLOCK_IDLE_TIMEOUT_MS || 5000));
const DEFAULT_GETBLOCK_HARD_TIMEOUT_MS = Math.max(
  DEFAULT_GETBLOCK_TIMEOUT_MS,
  Number(process.env.BSV_MARKET_P2P_GETBLOCK_HARD_TIMEOUT_MS || 1800000),
);
const DEFAULT_STREAM_SPEED_FLOOR_BPS = Math.max(0, Number(process.env.BSV_MARKET_P2P_STREAM_SPEED_FLOOR_BPS || 96 * 1024));
const DEFAULT_STREAM_SPEED_CAP_BPS = Math.max(
  DEFAULT_STREAM_SPEED_FLOOR_BPS,
  Number(process.env.BSV_MARKET_P2P_STREAM_SPEED_CAP_BPS || 512 * 1024),
);
const DEFAULT_STREAM_SPEED_RATIO = Math.min(1, Math.max(0, Number(process.env.BSV_MARKET_P2P_STREAM_SPEED_RATIO || 0.25)));
const DEFAULT_STREAM_SPEED_GRACE_MS = Math.max(5000, Number(process.env.BSV_MARKET_P2P_STREAM_SPEED_GRACE_MS || 15000));
const DEFAULT_MAX_ROUNDS_PER_BLOCK = Math.max(1, Number(process.env.BSV_MARKET_FRONTIER_TEST_MAX_ROUNDS || 8));
const DEFAULT_CANDIDATE_LIMIT = Math.max(8, Number(process.env.BSV_MARKET_FRONTIER_TEST_CANDIDATE_LIMIT || 48));
const DEFAULT_PARALLEL_BLOCKS = Math.max(1, Number(process.env.BSV_MARKET_FRONTIER_TEST_PARALLEL_BLOCKS || 8));
const DEFAULT_ADAPTIVE_INITIAL_PARALLEL_BLOCKS = Math.max(1, Number(process.env.BSV_MARKET_SYNC_ADAPTIVE_INITIAL_PARALLEL_BLOCKS || 2));
const DEFAULT_ADAPTIVE_EVAL_BLOCKS = Math.max(1, Number(process.env.BSV_MARKET_SYNC_ADAPTIVE_EVAL_BLOCKS || 10));
const DEFAULT_ADAPTIVE_SUCCESS_THRESHOLD = Math.min(1, Math.max(0, Number(process.env.BSV_MARKET_SYNC_ADAPTIVE_SUCCESS_THRESHOLD || 0.9)));
const DEFAULT_PERFECT_NODE_SUCCESS_THRESHOLD = Math.min(1, Math.max(0, Number(process.env.BSV_MARKET_SYNC_PERFECT_NODE_SUCCESS_THRESHOLD || 0.9)));
const DEFAULT_PERFECT_NODE_MIN_ATTEMPTS = Math.max(1, Number(process.env.BSV_MARKET_SYNC_PERFECT_NODE_MIN_ATTEMPTS || 3));
const DEFAULT_CANDIDATE_NODE_SUCCESS_THRESHOLD = Math.min(1, Math.max(0, Number(process.env.BSV_MARKET_SYNC_CANDIDATE_NODE_SUCCESS_THRESHOLD || 0.5)));
const DEFAULT_CANDIDATE_NODE_MIN_ATTEMPTS = Math.max(1, Number(process.env.BSV_MARKET_SYNC_CANDIDATE_NODE_MIN_ATTEMPTS || 1));
const DEFAULT_BAD_NODE_SUCCESS_THRESHOLD = Math.min(1, Math.max(0, Number(process.env.BSV_MARKET_SYNC_BAD_NODE_SUCCESS_THRESHOLD || 0.25)));
const DEFAULT_BAD_NODE_MIN_ATTEMPTS = Math.max(1, Number(process.env.BSV_MARKET_SYNC_BAD_NODE_MIN_ATTEMPTS || 3));
const DEFAULT_CANDIDATE_EXPLORATION_POOL_SIZE = Math.max(1, Number(process.env.BSV_MARKET_SYNC_CANDIDATE_EXPLORATION_POOL_SIZE || 4));
const DEFAULT_CANDIDATE_EVAL_BLOCKS = Math.max(1, Number(process.env.BSV_MARKET_SYNC_CANDIDATE_EVAL_BLOCKS || 25));
const DEFAULT_CANDIDATE_EVAL_FAILURE_LIMIT = Math.max(1, Number(process.env.BSV_MARKET_SYNC_CANDIDATE_EVAL_FAILURE_LIMIT || 2));
const DEFAULT_MIN_PARALLEL_BLOCKS = Math.max(2, Number(process.env.BSV_MARKET_SYNC_MIN_PARALLEL_BLOCKS || 2));
const DEFAULT_LOCK_SUCCESS_BLOCKS = Math.max(1, Number(process.env.BSV_MARKET_SYNC_LOCK_SUCCESS_BLOCKS || 10));
const DEFAULT_LOCK_FAILURE_LIMIT = Math.max(1, Number(process.env.BSV_MARKET_SYNC_LOCK_FAILURE_LIMIT || 2));
const RETAINED_GOOD_NODE_LIMIT = Math.max(8, Number(process.env.BSV_MARKET_SYNC_RETAINED_GOOD_NODE_LIMIT || 24));
const TAIL_SUCCESS_WINDOW_MS = 30 * 60 * 1000;
const TAIL_PREFERRED_NODE_LIMIT = Math.max(4, Number(process.env.BSV_MARKET_SYNC_TAIL_PREFERRED_LIMIT || 12));
const SEED_RECENT_SUCCESS_WINDOW_MS = Math.max(60 * 60 * 1000, Number(process.env.BSV_MARKET_SYNC_SEED_RECENT_SUCCESS_WINDOW_MS || 24 * 60 * 60 * 1000));
const SEED_RELAXED_SUCCESS_WINDOW_MS = Math.max(SEED_RECENT_SUCCESS_WINDOW_MS, Number(process.env.BSV_MARKET_SYNC_SEED_RELAXED_SUCCESS_WINDOW_MS || 7 * 24 * 60 * 60 * 1000));
const SEED_TIMEOUT_GRACE_MS = Math.max(60 * 1000, Number(process.env.BSV_MARKET_SYNC_SEED_TIMEOUT_GRACE_MS || 15 * 60 * 1000));

const singletonState = {
  nextGeneration: 0,
  activeControl: null,
  retainedGoodNodes: [],
  candidateRotationCursor: 0,
  candidateEvaluation: {
    currentNode: '',
    testedBlocks: 0,
    successCount: 0,
    failCount: 0,
    cycle: 0,
    history: {},
  },
};

function emitEvent(logger, event, payload = {}) {
  if (typeof logger !== 'function') return;
  try {
    logger(event, payload);
  } catch (_) {}
}

function appendDebug(event, payload = {}) {
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...payload,
    });
    fs.appendFileSync(MARKET_DEBUG_LOG_FILE, `${line}\n`);
  } catch (_) {}
}

function sanitizeResult(row) {
  if (!row || typeof row !== 'object') return row;
  const next = { ...row };
  delete next.block;
  delete next.streamed;
  return next;
}

function releaseBlockStatePayload(blockState) {
  if (!blockState || typeof blockState !== 'object') return;
  if (blockState.winner && typeof blockState.winner === 'object') {
    delete blockState.winner.block;
    delete blockState.winner.streamed;
    blockState.winner = sanitizeResult(blockState.winner);
  }
  if (Array.isArray(blockState.results)) {
    blockState.results = blockState.results.map((row) => sanitizeResult(row));
  }
}

function compactExtractedStreamedPayload(extracted = null) {
  if (!extracted || typeof extracted !== 'object') return null;
  return {
    rows: Array.isArray(extracted.rows) ? extracted.rows : [],
    txCount: Math.max(0, Number(extracted.txCount || 0)),
    diag: extracted.diag && typeof extracted.diag === 'object' ? extracted.diag : null,
    walletTxSummaries: Array.isArray(extracted.walletTxSummaries) ? extracted.walletTxSummaries : [],
  };
}

function uniquePush(list, value) {
  const key = String(value || '').trim();
  if (!key) return;
  if (!list.includes(key)) list.push(key);
}

function removeNodeFromList(list, value) {
  if (!Array.isArray(list)) return;
  const key = String(value || '').trim();
  if (!key) return;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (String(list[index] || '').trim() === key) list.splice(index, 1);
  }
}

function promoteNodeInList(list, value) {
  if (!Array.isArray(list)) return;
  const key = String(value || '').trim();
  if (!key) return;
  removeNodeFromList(list, key);
  list.unshift(key);
}

function getNodeAttemptCount(row) {
  return Math.max(0, Number(row?.successCount || 0)) + Math.max(0, Number(row?.failCount || 0));
}

function getNodeSuccessRate(row) {
  const attempts = getNodeAttemptCount(row);
  if (attempts <= 0) return 0;
  return Math.max(0, Number(row?.successCount || 0)) / attempts;
}

function getNodeFailRate(row) {
  const attempts = getNodeAttemptCount(row);
  if (attempts <= 0) return 0;
  return Math.max(0, Number(row?.failCount || 0)) / attempts;
}

function getNodeTimeoutRate(row) {
  const attempts = getNodeAttemptCount(row);
  if (attempts <= 0) return 0;
  return Math.max(0, Number(row?.timeoutCount || 0)) / attempts;
}

function getNodeScore(row) {
  const attempts = getNodeAttemptCount(row);
  const successRate = getNodeSuccessRate(row);
  const timeoutRate = getNodeTimeoutRate(row);
  const failRate = getNodeFailRate(row);
  const recentSuccessBonus = Number(row?.lastSuccessAt || 0) > 0 ? 0.1 : 0;
  const sampleBonus = Math.min(0.1, attempts / 50);
  const consecutiveFailPenalty = Math.min(0.4, Math.max(0, Number(row?.consecutiveFailCount || 0)) * 0.08);
  const speedBonus = Math.min(0.4, Math.max(0, Number(row?.avgDownloadBytesPerSec || 0)) / (2 * 1024 * 1024));
  return (successRate * 1.2) + recentSuccessBonus + sampleBonus + speedBonus - (timeoutRate * 0.5) - (failRate * 0.2) - consecutiveFailPenalty;
}

function isPerfectNode(row, options = {}) {
  const threshold = Math.min(1, Math.max(0, Number(options.perfectSuccessThreshold || options.successThreshold || DEFAULT_PERFECT_NODE_SUCCESS_THRESHOLD)));
  const minAttempts = Math.max(1, Number(options.perfectMinAttempts || options.minAttempts || DEFAULT_PERFECT_NODE_MIN_ATTEMPTS));
  const attempts = getNodeAttemptCount(row);
  if (attempts < minAttempts) return false;
  if (Number(row?.bannedUntil || 0) > Date.now()) return false;
  return getNodeSuccessRate(row) >= threshold;
}

function isCandidateNode(row, options = {}) {
  const threshold = Math.min(1, Math.max(0, Number(options.candidateSuccessThreshold || options.successThreshold || DEFAULT_CANDIDATE_NODE_SUCCESS_THRESHOLD)));
  const minAttempts = Math.max(1, Number(options.candidateMinAttempts || options.minAttempts || DEFAULT_CANDIDATE_NODE_MIN_ATTEMPTS));
  const attempts = getNodeAttemptCount(row);
  if (attempts < minAttempts) return true;
  if (Number(row?.bannedUntil || 0) > Date.now()) return false;
  if (isPerfectNode(row, options)) return false;
  return getNodeSuccessRate(row) >= threshold;
}

function isBadNode(row, options = {}) {
  const threshold = Math.min(1, Math.max(0, Number(options.badSuccessThreshold || options.successThreshold || DEFAULT_BAD_NODE_SUCCESS_THRESHOLD)));
  const minAttempts = Math.max(1, Number(options.badMinAttempts || options.minAttempts || DEFAULT_BAD_NODE_MIN_ATTEMPTS));
  const attempts = getNodeAttemptCount(row);
  if (attempts < minAttempts) return false;
  if (Number(row?.bannedUntil || 0) > Date.now()) return true;
  return getNodeSuccessRate(row) < threshold;
}

function rankNodeRows(rows = []) {
  return rows.slice().sort((a, b) => {
    const aPerfect = isPerfectNode(a) ? 1 : 0;
    const bPerfect = isPerfectNode(b) ? 1 : 0;
    if (bPerfect !== aPerfect) return bPerfect - aPerfect;
    const aCandidate = isCandidateNode(a) ? 1 : 0;
    const bCandidate = isCandidateNode(b) ? 1 : 0;
    if (bCandidate !== aCandidate) return bCandidate - aCandidate;
    const aScore = getNodeScore(a);
    const bScore = getNodeScore(b);
    if (bScore !== aScore) return bScore - aScore;
    const aRate = getNodeSuccessRate(a);
    const bRate = getNodeSuccessRate(b);
    if (bRate !== aRate) return bRate - aRate;
    if (Number(b.lastSuccessAt || 0) !== Number(a.lastSuccessAt || 0)) return Number(b.lastSuccessAt || 0) - Number(a.lastSuccessAt || 0);
    if (Number(b.successCount || 0) !== Number(a.successCount || 0)) return Number(b.successCount || 0) - Number(a.successCount || 0);
    if (Number(a.failCount || 0) !== Number(b.failCount || 0)) return Number(a.failCount || 0) - Number(b.failCount || 0);
    return String(a.node || '').localeCompare(String(b.node || ''));
  });
}

function getPerfectNodesFromStats(stats = {}, options = {}) {
  return rankNodeRows(Object.entries(stats || {})
    .map(([endpoint, row]) => ({
      node: String(endpoint || '').trim(),
      successCount: Math.max(0, Number(row?.successCount || 0)),
      failCount: Math.max(0, Number(row?.failCount || 0)),
      lastSuccessAt: Math.max(0, Number(row?.lastSuccessAt || 0)),
      bannedUntil: Math.max(0, Number(row?.bannedUntil || 0)),
      avgDownloadBytesPerSec: Math.max(0, Number(row?.avgDownloadBytesPerSec || 0)),
    }))
    .filter((row) => row.node)
    .filter((row) => isPerfectNode(row, options)))
    .map((row) => row.node);
}

function getCandidateNodesFromStats(stats = {}, options = {}) {
  return rankNodeRows(Object.entries(stats || {})
    .map(([endpoint, row]) => ({
      node: String(endpoint || '').trim(),
      successCount: Math.max(0, Number(row?.successCount || 0)),
      failCount: Math.max(0, Number(row?.failCount || 0)),
      timeoutCount: Math.max(0, Number(row?.timeoutCount || 0)),
      lastSuccessAt: Math.max(0, Number(row?.lastSuccessAt || 0)),
      bannedUntil: Math.max(0, Number(row?.bannedUntil || 0)),
      consecutiveFailCount: Math.max(0, Number(row?.consecutiveFailCount || 0)),
      avgDownloadBytesPerSec: Math.max(0, Number(row?.avgDownloadBytesPerSec || 0)),
    }))
    .filter((row) => row.node)
    .filter((row) => !isPerfectNode(row, options))
    .filter((row) => !isBadNode(row, options))
    .filter((row) => isCandidateNode(row, options)))
    .map((row) => row.node);
}

function buildRankedStatsRows(stats = {}) {
  return Object.entries(stats || {})
    .map(([endpoint, row]) => ({
      node: String(endpoint || '').trim(),
      successCount: Math.max(0, Number(row?.successCount || 0)),
      failCount: Math.max(0, Number(row?.failCount || 0)),
      timeoutCount: Math.max(0, Number(row?.timeoutCount || 0)),
      lastSuccessAt: Math.max(0, Number(row?.lastSuccessAt || 0)),
      lastTimeoutAt: Math.max(0, Number(row?.lastTimeoutAt || 0)),
      bannedUntil: Math.max(0, Number(row?.bannedUntil || 0)),
      consecutiveFailCount: Math.max(
        0,
        Number(row?.consecutiveFailCount || row?.consecutiveFails || 0),
      ),
      avgDownloadBytesPerSec: Math.max(0, Number(row?.avgDownloadBytesPerSec || 0)),
    }))
    .filter((row) => row.node)
    .sort((a, b) => {
      const aAttempts = getNodeAttemptCount(a);
      const bAttempts = getNodeAttemptCount(b);
      const aRate = getNodeSuccessRate(a);
      const bRate = getNodeSuccessRate(b);
      if (bRate !== aRate) return bRate - aRate;
      if (Number(b.avgDownloadBytesPerSec || 0) !== Number(a.avgDownloadBytesPerSec || 0)) {
        return Number(b.avgDownloadBytesPerSec || 0) - Number(a.avgDownloadBytesPerSec || 0);
      }
      if (bAttempts !== aAttempts) return bAttempts - aAttempts;
      if (Number(b.lastSuccessAt || 0) !== Number(a.lastSuccessAt || 0)) {
        return Number(b.lastSuccessAt || 0) - Number(a.lastSuccessAt || 0);
      }
      if (Number(a.timeoutCount || 0) !== Number(b.timeoutCount || 0)) {
        return Number(a.timeoutCount || 0) - Number(b.timeoutCount || 0);
      }
      return a.node.localeCompare(b.node);
    });
}

function isLockedNodeEligible(row, options = {}) {
  const failureLimit = Math.max(1, Number(options.lockFailureLimit || DEFAULT_LOCK_FAILURE_LIMIT));
  if (!row || !row.node) return false;
  if (Number(row.bannedUntil || 0) > Date.now()) return false;
  return Math.max(0, Number(row.consecutiveFailCount || 0)) < failureLimit;
}

function selectLockedNodes(previousLockedNodes = [], stats = {}, desiredCount = DEFAULT_MIN_PARALLEL_BLOCKS, options = {}) {
  const targetCount = Math.max(DEFAULT_MIN_PARALLEL_BLOCKS, Number(desiredCount || DEFAULT_MIN_PARALLEL_BLOCKS));
  const rankedRows = buildRankedStatsRows(stats);
  const eligibleRows = rankedRows.filter((row) => isLockedNodeEligible(row, options));
  const byNode = new Map(eligibleRows.map((row) => [row.node, row]));
  const selected = [];
  (Array.isArray(previousLockedNodes) ? previousLockedNodes : [])
    .map((node) => String(node || '').trim())
    .filter(Boolean)
    .forEach((node) => {
      if (!byNode.has(node)) return;
      uniquePush(selected, node);
    });
  eligibleRows.forEach((row) => {
    if (selected.length >= targetCount) return;
    uniquePush(selected, row.node);
  });
  return selected.slice(0, targetCount);
}

function selectExplorationNodes(stats = {}, lockedNodes = [], limit = DEFAULT_CANDIDATE_EXPLORATION_POOL_SIZE, options = {}) {
  const lockedSet = new Set((Array.isArray(lockedNodes) ? lockedNodes : []).map((node) => String(node || '').trim()).filter(Boolean));
  return buildRankedStatsRows(stats)
    .filter((row) => row.node && !lockedSet.has(row.node))
    .filter((row) => Number(row.bannedUntil || 0) <= Date.now())
    .filter((row) => Math.max(0, Number(row.consecutiveFailCount || 0)) < Math.max(1, Number(options.lockFailureLimit || DEFAULT_LOCK_FAILURE_LIMIT)))
    .map((row) => row.node)
    .slice(0, Math.max(1, Number(limit || DEFAULT_CANDIDATE_EXPLORATION_POOL_SIZE)));
}

function rotateNodes(list = [], limit = DEFAULT_CANDIDATE_EXPLORATION_POOL_SIZE) {
  const nodes = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!nodes.length) return [];
  const take = Math.max(1, Math.min(nodes.length, Number(limit || DEFAULT_CANDIDATE_EXPLORATION_POOL_SIZE)));
  const cursor = singletonState.candidateRotationCursor % nodes.length;
  const rotated = [];
  for (let index = 0; index < take; index += 1) {
    rotated.push(nodes[(cursor + index) % nodes.length]);
  }
  singletonState.candidateRotationCursor = (cursor + 1) % nodes.length;
  return rotated;
}

function getCandidateEvaluationState() {
  if (!singletonState.candidateEvaluation || typeof singletonState.candidateEvaluation !== 'object') {
    singletonState.candidateEvaluation = {
      currentNode: '',
      testedBlocks: 0,
      successCount: 0,
      failCount: 0,
      cycle: 0,
      history: {},
    };
  }
  if (!singletonState.candidateEvaluation.history || typeof singletonState.candidateEvaluation.history !== 'object') {
    singletonState.candidateEvaluation.history = {};
  }
  return singletonState.candidateEvaluation;
}

function finalizeCandidateEvaluation(node, state, options = {}) {
  const endpoint = String(node || '').trim();
  if (!endpoint) return null;
  const testedBlocks = Math.max(0, Number(state?.testedBlocks || 0));
  const successCount = Math.max(0, Number(state?.successCount || 0));
  const failCount = Math.max(0, Number(state?.failCount || 0));
  const successRate = testedBlocks > 0 ? (successCount / testedBlocks) : 0;
  const result = {
    node: endpoint,
    testedBlocks,
    successCount,
    failCount,
    successRate,
    qualified: successRate >= Math.min(1, Math.max(0, Number(options.perfectSuccessThreshold || DEFAULT_PERFECT_NODE_SUCCESS_THRESHOLD))),
    completedAt: Date.now(),
    cycle: Math.max(0, Number(state?.cycle || 0)),
  };
  state.history[endpoint] = result;
  state.currentNode = '';
  state.testedBlocks = 0;
  state.successCount = 0;
  state.failCount = 0;
  state.cycle = Math.max(0, Number(state.cycle || 0)) + 1;
  return result;
}

function chooseLockedCandidateNode(candidateNodes = [], perfectNodes = [], options = {}) {
  const state = getCandidateEvaluationState();
  const perfectSet = new Set((Array.isArray(perfectNodes) ? perfectNodes : []).map((node) => String(node || '').trim()).filter(Boolean));
  const available = (Array.isArray(candidateNodes) ? candidateNodes : [])
    .map((node) => String(node || '').trim())
    .filter(Boolean)
    .filter((node) => !perfectSet.has(node));
  const current = String(state.currentNode || '').trim();
  if (current && (available.includes(current) || perfectSet.has(current))) return current;
  if (!available.length) {
    state.currentNode = '';
    return '';
  }
  const ranked = available.slice().sort((a, b) => {
    const aHist = state.history[a] || null;
    const bHist = state.history[b] || null;
    const aRate = Number(aHist?.successRate || -1);
    const bRate = Number(bHist?.successRate || -1);
    if (bRate !== aRate) return bRate - aRate;
    const aBlocks = Number(aHist?.testedBlocks || 0);
    const bBlocks = Number(bHist?.testedBlocks || 0);
    if (bBlocks !== aBlocks) return bBlocks - aBlocks;
    const aAt = Number(aHist?.completedAt || 0);
    const bAt = Number(bHist?.completedAt || 0);
    if (bAt !== aAt) return bAt - aAt;
    return a.localeCompare(b);
  });
  state.currentNode = ranked[0];
  state.testedBlocks = 0;
  state.successCount = 0;
  state.failCount = 0;
  return state.currentNode;
}

function noteLockedCandidateOutcome(node, ok, options = {}) {
  const endpoint = String(node || '').trim();
  if (!endpoint) return null;
  const state = getCandidateEvaluationState();
  if (String(state.currentNode || '').trim() !== endpoint) return null;
  state.testedBlocks = Math.max(0, Number(state.testedBlocks || 0)) + 1;
  if (ok) state.successCount = Math.max(0, Number(state.successCount || 0)) + 1;
  else state.failCount = Math.max(0, Number(state.failCount || 0)) + 1;
  const failureLimit = Math.max(1, Number(options.candidateEvalFailureLimit || DEFAULT_CANDIDATE_EVAL_FAILURE_LIMIT));
  const evalBlocks = Math.max(1, Number(options.candidateEvalBlocks || DEFAULT_CANDIDATE_EVAL_BLOCKS));
  if (state.failCount >= failureLimit || state.testedBlocks >= evalBlocks) {
    return finalizeCandidateEvaluation(endpoint, state, options);
  }
  return {
    node: endpoint,
    testedBlocks: state.testedBlocks,
    successCount: state.successCount,
    failCount: state.failCount,
    successRate: state.testedBlocks > 0 ? (state.successCount / state.testedBlocks) : 0,
    cycle: Math.max(0, Number(state.cycle || 0)),
    completed: false,
  };
}

function ensureRuntimeNodeStat(stats, node) {
  const endpoint = String(node || '').trim();
  if (!endpoint) return null;
  if (!stats[endpoint] || typeof stats[endpoint] !== 'object') {
    stats[endpoint] = {
      successCount: 0,
      failCount: 0,
      lastSuccessAt: 0,
      lastFailAt: 0,
      lastTimeoutAt: 0,
      timeoutCount: 0,
      consecutiveFailCount: 0,
      bannedUntil: 0,
      avgDownloadBytesPerSec: 0,
      lastDownloadBytesPerSec: 0,
      downloadSampleCount: 0,
    };
  }
  return stats[endpoint];
}

function noteRuntimeNodeResult(stats, node, ok, error = '', latencyMs = 0, downloadBytesPerSec = 0) {
  const row = ensureRuntimeNodeStat(stats, node);
  if (!row) return;
  const now = Date.now();
  const sampleLatency = Math.max(0, Number(latencyMs || 0));
  const sampleDownloadBytesPerSec = Math.max(0, Number(downloadBytesPerSec || 0));
  const previousLatency = Math.max(0, Number(row.avgLatencyMs || 0));
  const previousDownloadBytesPerSec = Math.max(0, Number(row.avgDownloadBytesPerSec || 0));
  if (ok) {
    row.successCount = Math.max(0, Number(row.successCount || 0)) + 1;
    row.lastSuccessAt = now;
    row.consecutiveFailCount = 0;
    row.consecutiveFails = 0;
    row.bannedUntil = 0;
    row.lastError = '';
    row.score = Math.min(100, Math.max(0, Number(row.score || 0)) + (sampleLatency > 0 && sampleLatency <= 1500 ? 4 : 3));
    if (sampleLatency > 0) {
      row.avgLatencyMs = previousLatency > 0
        ? Math.round(previousLatency * 0.7 + sampleLatency * 0.3)
        : sampleLatency;
    }
    if (sampleDownloadBytesPerSec > 0) {
      row.avgDownloadBytesPerSec = previousDownloadBytesPerSec > 0
        ? Math.round(previousDownloadBytesPerSec * 0.7 + sampleDownloadBytesPerSec * 0.3)
        : sampleDownloadBytesPerSec;
      row.lastDownloadBytesPerSec = sampleDownloadBytesPerSec;
      row.downloadSampleCount = Math.max(0, Number(row.downloadSampleCount || 0)) + 1;
    }
  } else {
    row.failCount = Math.max(0, Number(row.failCount || 0)) + 1;
    row.lastFailAt = now;
    row.consecutiveFailCount = Math.max(0, Number(row.consecutiveFailCount || 0)) + 1;
    row.consecutiveFails = Math.max(0, Number(row.consecutiveFails || row.consecutiveFailCount || 0));
    row.lastError = String(error || '').slice(0, 240);
    row.score = Math.max(-100, Number(row.score || 0) - (/timeout/i.test(String(error || '')) ? 8 : 4));
    if (/timeout/i.test(String(error || ''))) {
      row.lastTimeoutAt = now;
      row.timeoutCount = Math.max(0, Number(row.timeoutCount || 0)) + 1;
    }
  }
  row.updatedAt = now;
}

function getRuntimeStreamSpeedPolicy(stats = {}, node = '', candidateNodes = []) {
  const endpoint = String(node || '').trim();
  const candidates = (Array.isArray(candidateNodes) ? candidateNodes : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .filter((item) => item !== endpoint);
  const speeds = candidates
    .map((item) => Number(stats?.[item]?.avgDownloadBytesPerSec || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a);
  const bestOtherBytesPerSec = Math.max(0, Number(speeds[0] || 0));
  if (
    DEFAULT_STREAM_SPEED_FLOOR_BPS <= 0
    || bestOtherBytesPerSec < DEFAULT_STREAM_SPEED_FLOOR_BPS
  ) {
    return {
      enabled: false,
      minStreamBytesPerSec: 0,
      bestOtherBytesPerSec,
      streamSpeedGraceMs: DEFAULT_STREAM_SPEED_GRACE_MS,
    };
  }
  const minStreamBytesPerSec = Math.min(
    DEFAULT_STREAM_SPEED_CAP_BPS,
    Math.max(DEFAULT_STREAM_SPEED_FLOOR_BPS, Math.round(bestOtherBytesPerSec * DEFAULT_STREAM_SPEED_RATIO)),
  );
  return {
    enabled: minStreamBytesPerSec > 0,
    minStreamBytesPerSec,
    bestOtherBytesPerSec,
    streamSpeedGraceMs: DEFAULT_STREAM_SPEED_GRACE_MS,
  };
}

function normalizeRuntimeNodeStatsForSummary(stats = {}) {
  const normalized = {};
  Object.entries(stats || {}).forEach(([endpointRaw, row]) => {
    const endpoint = String(endpointRaw || '').trim();
    if (!endpoint || !row || typeof row !== 'object') return;
    normalized[endpoint] = {
      score: Math.max(-100, Math.min(100, Number(row.score || 0))),
      successCount: Math.max(0, Number(row.successCount || 0)),
      failCount: Math.max(0, Number(row.failCount || 0)),
      consecutiveFails: Math.max(0, Number(row.consecutiveFails || row.consecutiveFailCount || 0)),
      bannedUntil: Math.max(0, Number(row.bannedUntil || 0)),
      avgLatencyMs: Math.max(0, Number(row.avgLatencyMs || 0)),
      avgDownloadBytesPerSec: Math.max(0, Number(row.avgDownloadBytesPerSec || 0)),
      lastDownloadBytesPerSec: Math.max(0, Number(row.lastDownloadBytesPerSec || 0)),
      downloadSampleCount: Math.max(0, Number(row.downloadSampleCount || 0)),
      lastError: String(row.lastError || '').slice(0, 240),
      lastFailureAt: Math.max(0, Number(row.lastFailAt || row.lastFailureAt || 0)),
      lastTimeoutAt: Math.max(0, Number(row.lastTimeoutAt || 0)),
      lastSuccessAt: Math.max(0, Number(row.lastSuccessAt || 0)),
      updatedAt: Math.max(0, Number(row.updatedAt || 0)),
    };
  });
  return Object.fromEntries(
    Object.entries(normalized)
      .sort((a, b) => {
        if (Number(a[1].score || 0) !== Number(b[1].score || 0)) return Number(b[1].score || 0) - Number(a[1].score || 0);
        if (Number(a[1].lastSuccessAt || 0) !== Number(b[1].lastSuccessAt || 0)) {
          return Number(b[1].lastSuccessAt || 0) - Number(a[1].lastSuccessAt || 0);
        }
        if (Number(a[1].successCount || 0) !== Number(b[1].successCount || 0)) {
          return Number(b[1].successCount || 0) - Number(a[1].successCount || 0);
        }
        return String(a[0]).localeCompare(String(b[0]));
      })
      .slice(0, RETAINED_GOOD_NODE_LIMIT * 4),
  );
}

function readRetainedGoodNodesFile() {
  try {
    if (!fs.existsSync(SYNC_RETAINED_GOOD_NODES_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(SYNC_RETAINED_GOOD_NODES_FILE, 'utf8'));
    const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
    return nodes.map((node) => String(node || '').trim()).filter(Boolean).slice(0, RETAINED_GOOD_NODE_LIMIT);
  } catch (_) {
    return [];
  }
}

function persistRetainedGoodNodes() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SYNC_RETAINED_GOOD_NODES_FILE, JSON.stringify({
      updatedAt: new Date().toISOString(),
      nodes: singletonState.retainedGoodNodes.slice(0, RETAINED_GOOD_NODE_LIMIT),
    }, null, 2));
  } catch (_) {}
}

function ensureRetainedGoodNodesLoaded() {
  if (singletonState.retainedGoodNodes.length > 0) return;
  readRetainedGoodNodesFile().forEach((node) => uniquePush(singletonState.retainedGoodNodes, node));
}

function rememberRetainedGoodNodes(nodes = []) {
  ensureRetainedGoodNodesLoaded();
  const merged = [];
  (Array.isArray(nodes) ? nodes : []).forEach((node) => uniquePush(merged, node));
  singletonState.retainedGoodNodes.forEach((node) => uniquePush(merged, node));
  singletonState.retainedGoodNodes = merged.slice(0, RETAINED_GOOD_NODE_LIMIT);
  persistRetainedGoodNodes();
}

function chooseSeedPreferredNodes(stats = {}, limit = RETAINED_GOOD_NODE_LIMIT, options = {}) {
  const now = Date.now();
  const recentSuccessWindowMs = Math.max(1000, Number(options.recentSuccessWindowMs || SEED_RECENT_SUCCESS_WINDOW_MS));
  const relaxedSuccessWindowMs = Math.max(recentSuccessWindowMs, Number(options.relaxedSuccessWindowMs || SEED_RELAXED_SUCCESS_WINDOW_MS));
  const timeoutGraceMs = Math.max(1000, Number(options.timeoutGraceMs || SEED_TIMEOUT_GRACE_MS));
  const metrics = {
    total: 0,
    passed: 0,
    relaxedPassed: 0,
    banned: 0,
    noSuccess: 0,
    lowScore: 0,
    staleSuccess: 0,
    timeoutAfterSuccess: 0,
    failOverSuccess: 0,
  };
  const rows = Object.entries(stats)
    .map(([endpoint, row]) => {
      const node = String(endpoint || '').trim();
      if (!node) return null;
      metrics.total += 1;
      const next = {
        node,
        score: Number(row?.score || 0),
        successCount: Number(row?.successCount || 0),
        failCount: Number(row?.failCount || 0),
        lastSuccessAt: Number(row?.lastSuccessAt || 0),
        bannedUntil: Number(row?.bannedUntil || 0),
        lastTimeoutAt: Number(row?.lastTimeoutAt || 0),
        timeoutAfterSuccess: Number(row?.lastSuccessAt || 0) < Number(row?.lastTimeoutAt || 0),
      };
      next.recentSuccess = next.lastSuccessAt > 0 && (now - next.lastSuccessAt) <= recentSuccessWindowMs;
      next.relaxedSuccess = next.lastSuccessAt > 0 && (now - next.lastSuccessAt) <= relaxedSuccessWindowMs;
      next.timeoutWithinGrace = next.lastTimeoutAt > 0 && (now - next.lastTimeoutAt) <= timeoutGraceMs;
      next.failOverLimit = Math.max(8, next.successCount);
      return next;
    })
    .filter(Boolean);

  const strictRows = rows.filter((row) => {
    if (row.bannedUntil > now) {
      metrics.banned += 1;
      return false;
    }
    if (row.successCount <= 0) {
      metrics.noSuccess += 1;
      return false;
    }
    if (!row.recentSuccess) {
      metrics.staleSuccess += 1;
      return false;
    }
    if (row.timeoutAfterSuccess && row.timeoutWithinGrace) {
      metrics.timeoutAfterSuccess += 1;
      return false;
    }
    if (row.failCount > row.failOverLimit) {
      metrics.failOverSuccess += 1;
      return false;
    }
    metrics.passed += 1;
    return true;
  });

  const selectedRows = strictRows.slice();
  if (selectedRows.length < Math.max(2, Math.min(limit, 6))) {
    rows
      .filter((row) => !selectedRows.includes(row))
      .filter((row) => row.bannedUntil <= now)
      .filter((row) => row.successCount > 0)
      .filter((row) => row.relaxedSuccess)
      .filter((row) => row.failCount <= Math.max(16, row.successCount * 3))
      .sort((a, b) => {
        if (b.lastSuccessAt !== a.lastSuccessAt) return b.lastSuccessAt - a.lastSuccessAt;
        if (b.score !== a.score) return b.score - a.score;
        if (b.successCount !== a.successCount) return b.successCount - a.successCount;
        if (a.failCount !== b.failCount) return a.failCount - b.failCount;
        return a.node.localeCompare(b.node);
      })
      .forEach((row) => {
        if (selectedRows.length >= Math.max(1, Number(limit || RETAINED_GOOD_NODE_LIMIT))) return;
        selectedRows.push(row);
        metrics.relaxedPassed += 1;
      });
  }

  selectedRows.sort((a, b) => {
      const aTimeoutPenalty = a.lastTimeoutAt > 0 ? 1 : 0;
      const bTimeoutPenalty = b.lastTimeoutAt > 0 ? 1 : 0;
      if (aTimeoutPenalty !== bTimeoutPenalty) return aTimeoutPenalty - bTimeoutPenalty;
      if (b.score !== a.score) return b.score - a.score;
      if (b.lastSuccessAt !== a.lastSuccessAt) return b.lastSuccessAt - a.lastSuccessAt;
      if (b.successCount !== a.successCount) return b.successCount - a.successCount;
      if (a.failCount !== b.failCount) return a.failCount - b.failCount;
      return a.node.localeCompare(b.node);
    });
  return {
    nodes: selectedRows.slice(0, Math.max(1, Number(limit || RETAINED_GOOD_NODE_LIMIT))).map((row) => row.node),
    metrics,
  };
}

function loadSeedPreferredNodesFromState(limit = RETAINED_GOOD_NODE_LIMIT) {
  const stats = loadSyncProjectionState()?.p2pNodeStats;
  if (!stats || typeof stats !== 'object') return [];
  return chooseSeedPreferredNodes(stats, limit).nodes;
}

function loadTailPreferredNodesFromState(limit = TAIL_PREFERRED_NODE_LIMIT) {
  const stats = loadSyncProjectionState()?.p2pNodeStats;
  if (!stats || typeof stats !== 'object') return [];
  const now = Date.now();
  return Object.entries(stats)
    .map(([endpoint, row]) => ({
      node: String(endpoint || '').trim(),
      score: Number(row?.score || 0),
      successCount: Number(row?.successCount || 0),
      failCount: Number(row?.failCount || 0),
      lastSuccessAt: Number(row?.lastSuccessAt || 0),
      lastTimeoutAt: Number(row?.lastTimeoutAt || 0),
      bannedUntil: Number(row?.bannedUntil || 0),
    }))
    .filter((row) => row.node)
    .filter((row) => row.bannedUntil <= now)
    .filter((row) => row.successCount > 0)
    .filter((row) => row.lastSuccessAt > 0 && (now - row.lastSuccessAt) <= TAIL_SUCCESS_WINDOW_MS)
    .filter((row) => row.lastSuccessAt >= row.lastTimeoutAt)
    .sort((a, b) => {
      if (b.lastSuccessAt !== a.lastSuccessAt) return b.lastSuccessAt - a.lastSuccessAt;
      if (b.score !== a.score) return b.score - a.score;
      if (b.successCount !== a.successCount) return b.successCount - a.successCount;
      if (a.failCount !== b.failCount) return a.failCount - b.failCount;
      return a.node.localeCompare(b.node);
    })
    .slice(0, Math.max(1, Number(limit || TAIL_PREFERRED_NODE_LIMIT)))
    .map((row) => row.node);
}

function beginRunControl(options = {}) {
  const previous = singletonState.activeControl;
  if (previous && previous.active) {
    previous.superseded = true;
    previous.replacedAt = Date.now();
  }
  const control = {
    generation: singletonState.nextGeneration += 1,
    active: true,
    superseded: false,
    startedAt: Date.now(),
    reason: String(options.reason || '').trim(),
  };
  singletonState.activeControl = control;
  return control;
}

function finishRunControl(control) {
  if (!control) return;
  control.active = false;
  control.finishedAt = Date.now();
  if (singletonState.activeControl === control) singletonState.activeControl = null;
}

function isRunControlCurrent(control) {
  return Boolean(control && singletonState.activeControl === control && control.active && !control.superseded);
}

function cancelActiveRun(reason = 'cancelled') {
  const active = singletonState.activeControl;
  if (!active || !active.active) {
    return {
      cancelled: false,
      generation: Number(active?.generation || 0),
      reason: String(reason || ''),
    };
  }
  active.superseded = true;
  active.active = false;
  active.cancelReason = String(reason || 'cancelled');
  active.cancelledAt = Date.now();
  if (singletonState.activeControl === active) singletonState.activeControl = null;
  return {
    cancelled: true,
    generation: Number(active.generation || 0),
    reason: active.cancelReason,
  };
}

function resetServiceState() {
  singletonState.activeControl = null;
  singletonState.candidateEvaluation = {
    currentNode: '',
    testedBlocks: 0,
    successCount: 0,
    failCount: 0,
    cycle: 0,
    history: {},
  };
  return {
    active: false,
    activeGeneration: 0,
    retainedGoodNodes: Array.from(singletonState.retainedGoodNodes),
  };
}

function loadSyncStateRowFromSqlite() {
  try {
    const dbFile = marketDb.getDbFilePath();
    if (!fs.existsSync(dbFile)) return null;
    const db = marketDb.openReadDb();
    try {
      return db.prepare('SELECT * FROM sync_state WHERE scope = ?').get('main') || null;
    } finally {
      db.close();
    }
  } catch (err) {
    appendDebug('independent_sync_seed_state_sqlite_failed', {
      message: String(err?.message || 'sqlite read failed'),
    });
    return null;
  }
}

function parseJsonField(value, fallback) {
  try {
    return JSON.parse(String(value || JSON.stringify(fallback)));
  } catch (_) {
    return fallback;
  }
}

function loadSyncNodeStatsSnapshot() {
  try {
    if (!fs.existsSync(SYNC_NODE_STATS_SNAPSHOT_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(SYNC_NODE_STATS_SNAPSHOT_FILE, 'utf8'));
    const stats = raw?.p2pNodeStats;
    if (!stats || typeof stats !== 'object') return null;
    return {
      bootstrapHeight: Math.max(0, Number(raw.bootstrapHeight || 0)),
      localHeight: Math.max(0, Number(raw.localHeight || 0)),
      networkHeight: Math.max(0, Number(raw.networkHeight || 0)),
      p2pTipHeight: Math.max(0, Number(raw.p2pTipHeight || 0)),
      p2pHeaderCursorHeight: Number.isFinite(Number(raw.p2pHeaderCursorHeight))
        ? Number(raw.p2pHeaderCursorHeight)
        : -1,
      p2pNodeStats: stats,
      p2pHeightHashCache: stripTrustedBhsHeightsFromCache(raw?.p2pHeightHashCache),
      __source: 'snapshot',
    };
  } catch (err) {
    appendDebug('independent_sync_seed_state_snapshot_failed', {
      message: String(err?.message || 'snapshot read failed'),
    });
    return null;
  }
}

function loadSyncProjectionState() {
  const row = loadSyncStateRowFromSqlite();
  if (!row || typeof row !== 'object') {
    const fallback = loadSyncNodeStatsSnapshot();
    if (fallback) {
      appendDebug('independent_sync_seed_state_loaded', {
        source: 'snapshot',
        statCount: Object.keys(fallback.p2pNodeStats || {}).length,
        localHeight: Number(fallback.localHeight || 0),
        networkHeight: Number(fallback.networkHeight || 0),
      });
    }
    return fallback;
  }
  const state = {
    bootstrapHeight: Math.max(0, Number(row.bootstrap_height || 0)),
    localHeight: Math.max(0, Number(row.local_height || 0)),
    networkHeight: Math.max(0, Number(row.network_height || 0)),
    p2pTipHeight: Math.max(0, Number(row.p2p_tip_height || 0)),
    p2pHeaderCursorHeight: Number.isFinite(Number(row.p2p_header_cursor_height))
      ? Number(row.p2p_header_cursor_height)
      : -1,
    p2pNodeStats: parseJsonField(row.p2p_node_stats_json, {}),
    p2pHeightHashCache: stripTrustedBhsHeightsFromCache(parseJsonField(row.p2p_height_hash_cache_json, {})),
  };
  if (Object.keys(state.p2pNodeStats || {}).length <= 0) {
    const fallback = loadSyncNodeStatsSnapshot();
    if (fallback && Object.keys(fallback.p2pNodeStats || {}).length > 0) {
      appendDebug('independent_sync_seed_state_loaded', {
        source: 'snapshot_fallback_after_empty_sqlite',
        sqliteStatCount: 0,
        snapshotStatCount: Object.keys(fallback.p2pNodeStats || {}).length,
      });
      return fallback;
    }
  }
  return state;
}

function loadBhsProjectionState() {
  let projected = null;
  try {
    projected = typeof bhsDomain.getBhsStatusSync === 'function'
      ? (bhsDomain.getBhsStatusSync('main') || null)
      : null;
  } catch (_) {}
  let fromFile = null;
  try {
    if (fs.existsSync(BHS_STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BHS_STATE_FILE, 'utf8'));
      const headers = raw?.headers && typeof raw.headers === 'object' ? raw.headers : {};
      fromFile = {
        scope: 'main',
        ok: Boolean(raw?.tip?.height || raw?.tipHeight),
        checkpointHeight: Math.max(0, Number(raw?.checkpoint?.height || raw?.checkpointHeight || 0)),
        checkpointHash: String(raw?.checkpoint?.hash || raw?.checkpointHash || '').trim().toLowerCase(),
        tipHeight: Math.max(0, Number(raw?.tip?.height || raw?.tipHeight || 0)),
        tipHash: String(raw?.tip?.hash || raw?.tipHash || '').trim().toLowerCase(),
        headerCount: Object.keys(headers).length,
        headers,
        lastRound: raw?.lastRound && typeof raw.lastRound === 'object' ? raw.lastRound : {},
        updatedAt: String(raw?.tip?.updatedAt || raw?.updatedAt || ''),
      };
    }
  } catch (err) {
    appendDebug('independent_sync_bhs_file_load_failed', {
      file: BHS_STATE_FILE,
      error: String(err?.message || err || 'load failed').slice(0, 180),
    });
  }
  if (!projected) return fromFile;
  if (!fromFile) return projected;
  if (Number(fromFile.tipHeight || 0) > Number(projected.tipHeight || 0)) {
    appendDebug('independent_sync_bhs_file_fallback_used', {
      projectedTipHeight: Number(projected.tipHeight || 0),
      fileTipHeight: Number(fromFile.tipHeight || 0),
      projectedHeaderCount: Number(projected.headerCount || 0),
      fileHeaderCount: Number(fromFile.headerCount || 0),
    });
    return fromFile;
  }
  return projected;
}

function loadBhsTipHeight() {
  const state = loadBhsProjectionState();
  return Math.max(0, Number(state?.checkpointHeight || 0), Number(state?.tipHeight || 0));
}

function stripTrustedBhsHeightsFromCache(cacheLike) {
  const out = {};
  const input = cacheLike && typeof cacheLike === 'object' ? cacheLike : {};
  const bhs = loadBhsProjectionState();
  const headers = bhs?.headers && typeof bhs.headers === 'object' ? bhs.headers : {};
  Object.keys(input).forEach((k) => {
    const h = Number(k);
    const hash = String(input[k] || '').trim().toLowerCase();
    if (!Number.isFinite(h) || h < 0) return;
    if (!/^[0-9a-f]{64}$/i.test(hash)) return;
    const trustedHash = String(headers[String(h)]?.hash || '').trim().toLowerCase();
    if (trustedHash && trustedHash === hash) return;
    out[String(h)] = hash;
  });
  return out;
}

function normalizeChainHttpBase(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const base = s.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) return '';
  return base;
}

function buildHeightHashSources() {
  const sources = [];
  const seen = new Set();
  const pushSource = (id, base, type = 'custom') => {
    const safeId = String(id || '').trim();
    const safeBase = normalizeChainHttpBase(base);
    if (!safeId || !safeBase || seen.has(safeId)) return;
    seen.add(safeId);
    sources.push({ id: safeId, base: safeBase, type });
  };
  HEIGHT_HASH_SOURCES_ENV
    .split(/[,\s]+/)
    .map((value) => normalizeChainHttpBase(value))
    .filter(Boolean)
    .forEach((base, index) => pushSource(`custom-${index + 1}`, base, 'custom'));
  return sources.slice(0, HEIGHT_HASH_MAX_TRIES);
}

function resolveStartHeight(explicitHeight) {
  if (Number(explicitHeight || 0) > 0) return Number(explicitHeight);
  const syncState = loadSyncProjectionState();
  if (syncState) {
    const bootstrapHeight = Math.max(1, Number(syncState.bootstrapHeight || 1));
    const localHeight = Math.max(bootstrapHeight - 1, Number(syncState.localHeight || 0));
    return Math.max(1, localHeight + 1);
  }
  return 1;
}

function resolveTargetHeight(explicitHeight, toTip = false) {
  if (Number(explicitHeight || 0) > 0) return Number(explicitHeight);
  if (!toTip) return 0;
  const syncState = loadSyncProjectionState();
  const bhsTipHeight = loadBhsTipHeight();
  if (syncState) {
    return Math.max(
      0,
      Number(syncState.p2pTipHeight || 0),
      Number(syncState.networkHeight || 0),
      Number(syncState.p2pHeaderCursorHeight || 0),
      bhsTipHeight,
    );
  }
  return bhsTipHeight;
}

function resolveHash(height) {
  const cache = loadSyncProjectionState()?.p2pHeightHashCache;
  const fromCache = cache && typeof cache === 'object' ? String(cache[String(height)] || '').trim().toLowerCase() : '';
  if (/^[0-9a-f]{64}$/i.test(fromCache)) return fromCache;
  const bhs = loadBhsProjectionState();
  const headers = bhs?.headers && typeof bhs.headers === 'object' ? bhs.headers : {};
  const fromBhs = String(headers[String(height)]?.hash || '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/i.test(fromBhs)) return fromBhs;
  throw new Error(`missing height hash for ${height}`);
}

async function fetchMissingHeightHash(height, onEvent = null) {
  const safeHeight = Math.floor(Number(height));
  if (!Number.isFinite(safeHeight) || safeHeight < 0) return '';
  const sources = buildHeightHashSources();
  if (!sources.length) {
    throw new Error(`missing height hash for ${safeHeight}: no chain http source configured`);
  }
  let lastError = null;
  for (const source of sources) {
    const startedAt = Date.now();
    try {
      const { data } = await axios.get(`${source.base}/block/height/${safeHeight}`, {
        timeout: HEIGHT_HASH_HTTP_TIMEOUT_MS,
      });
      const hash = String(
        (typeof data === 'string' ? data : (data?.hash || data?.blockHash || '')) || '',
      ).trim().toLowerCase();
      if (/^[0-9a-f]{64}$/i.test(hash)) {
        emitEvent(onEvent, 'independent_sync_height_hash_backfilled', {
          height: safeHeight,
          hash: hash.slice(0, 16),
          sourceId: source.id,
          elapsedMs: Date.now() - startedAt,
        });
        return hash;
      }
      lastError = new Error(`invalid height hash payload from ${source.id}`);
    } catch (err) {
      lastError = err;
      emitEvent(onEvent, 'independent_sync_height_hash_backfill_failed', {
        height: safeHeight,
        sourceId: source.id,
        elapsedMs: Date.now() - startedAt,
        message: String(err?.message || 'height hash request failed'),
      });
    }
  }
  throw new Error(`missing height hash for ${safeHeight}: ${String(lastError?.message || 'lookup failed')}`);
}

async function ensureHash(height, context = {}) {
  const safeHeight = Math.floor(Number(height));
  const localCache = context.hashCache && typeof context.hashCache === 'object' ? context.hashCache : {};
  const cached = String(localCache[String(safeHeight)] || '').trim().toLowerCase();
  if (/^[0-9a-f]{64}$/i.test(cached)) return cached;
  try {
    const resolved = resolveHash(safeHeight);
    if (/^[0-9a-f]{64}$/i.test(resolved)) {
      localCache[String(safeHeight)] = resolved;
      return resolved;
    }
  } catch (_) {}
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < HEIGHT_HASH_BHS_WAIT_MS) {
    const bhs = loadBhsProjectionState();
    const bhsTipHeight = Math.max(0, Number(bhs?.tipHeight || 0));
    const headers = bhs?.headers && typeof bhs.headers === 'object' ? bhs.headers : {};
    const fromBhs = String(headers[String(safeHeight)]?.hash || '').trim().toLowerCase();
    if (/^[0-9a-f]{64}$/i.test(fromBhs)) {
      localCache[String(safeHeight)] = fromBhs;
      emitEvent(context.onEvent, 'independent_sync_height_hash_resolved_from_bhs', {
        height: safeHeight,
        hash: fromBhs.slice(0, 16),
        elapsedMs: Date.now() - startedAt,
        bhsTipHeight,
      });
      return fromBhs;
    }
    emitEvent(context.onEvent, 'independent_sync_height_hash_waiting_for_bhs', {
      height: safeHeight,
      elapsedMs: Date.now() - startedAt,
      bhsTipHeight,
    });
    await new Promise((resolve) => setTimeout(resolve, HEIGHT_HASH_BHS_POLL_MS));
    try {
      const resolved = resolveHash(safeHeight);
      if (/^[0-9a-f]{64}$/i.test(resolved)) {
        localCache[String(safeHeight)] = resolved;
        return resolved;
      }
    } catch (_) {}
  }
  const fetched = await fetchMissingHeightHash(safeHeight, context.onEvent);
  if (/^[0-9a-f]{64}$/i.test(fetched)) {
    localCache[String(safeHeight)] = fetched;
    return fetched;
  }
  throw new Error(`missing height hash for ${safeHeight}`);
}

async function fetchBlockFresh(node, hash, connectTimeoutMs, getBlockTimeoutMs, onEvent = null, meta = {}) {
  const startedAt = Date.now();
  const streamSpeedPolicy = meta?.streamSpeedPolicy && typeof meta.streamSpeedPolicy === 'object'
    ? meta.streamSpeedPolicy
    : null;
  emitEvent(onEvent, 'independent_sync_fetch_started', {
    node,
    hash: String(hash || '').slice(0, 16),
    connectTimeoutMs: Number(connectTimeoutMs || 0),
    getBlockTimeoutMs: Number(getBlockTimeoutMs || 0),
    ...meta,
  });
  try {
    const result = await syncRuntime.fetchStreamedBlockFresh(node, hash, {
      connectTimeoutMs,
      idleTimeoutMs: Math.min(getBlockTimeoutMs, DEFAULT_GETBLOCK_IDLE_TIMEOUT_MS),
      hardTimeoutMs: Math.max(getBlockTimeoutMs, DEFAULT_GETBLOCK_HARD_TIMEOUT_MS),
      minStreamBytesPerSec: Number(streamSpeedPolicy?.minStreamBytesPerSec || 0),
      streamSpeedGraceMs: Number(streamSpeedPolicy?.streamSpeedGraceMs || DEFAULT_STREAM_SPEED_GRACE_MS),
      abortSignal: meta?.abortSignal || null,
      onEvent,
      height: Number(meta?.height || 0),
    });
    if (result?.ok) {
      emitEvent(onEvent, 'independent_sync_fetch_block_received', {
        node,
        connectElapsedMs: Number(result.connectElapsedMs || 0),
        firstDataElapsedMs: Number(result.firstDataElapsedMs || 0),
        getBlockElapsedMs: Number(result.getBlockElapsedMs || 0),
        streamPayloadBytesPerSec: Number(result.streamPayloadBytesPerSec || 0),
        streamSpeedPolicy,
        txCount: Number(result.txCount || 0),
        rowsFound: Number(result.rowsFound || 0),
        ...meta,
      });
    }
    return result;
  } catch (err) {
    emitEvent(onEvent, 'independent_sync_fetch_failed', {
      node,
      error: String(err?.message || 'probe failed'),
      totalElapsedMs: Date.now() - startedAt,
      ...meta,
    });
    return {
      ok: false,
      node,
      connectElapsedMs: 0,
      totalElapsedMs: Date.now() - startedAt,
      error: String(err?.message || 'probe failed'),
    };
  }
}

function pickLeasesForRound(selector, preferredNodes, blockState, options) {
  const excluded = Array.from(blockState.triedNodes);
  const picked = [];
  const leaseTarget = Math.max(
    1,
    Number(blockState?.backupRequired ? options.backupLeasesPerBlock : options.primaryLeasesPerBlock) || 1,
  );
  const tailPreferredNodes = Array.isArray(options.tailPreferredNodes) ? options.tailPreferredNodes : [];
  const tailPreferredOnly = options.tailPreferredOnly === true;
  const lockedNodes = Array.isArray(options.lockedNodes) ? options.lockedNodes : [];
  const explorationNodes = Array.isArray(options.explorationNodes) ? options.explorationNodes : [];
  const pickOrdered = (orderedNodes = []) => {
    for (const endpointRaw of orderedNodes) {
      if (picked.length >= leaseTarget) break;
      const endpoint = String(endpointRaw || '').trim();
      if (!endpoint || blockState.triedNodes.has(endpoint)) continue;
      const lease = selector.acquirePreferredLease({
        preferred: [endpoint],
        exclude: [...excluded, ...picked.map((entry) => entry.node)],
        purpose: 'sync_block',
        mode: 'fresh',
        strictPreferred: true,
      });
      if (lease) {
        picked.push(lease);
        if (!blockState.backupRequired && lockedNodes.includes(endpoint)) blockState.lockedSeatNode = endpoint;
      }
    }
  };

  if (!blockState.backupRequired) {
    const firstRoundCandidates = Array.from(new Set(
      (Array.isArray(preferredNodes) ? preferredNodes : [])
        .map((node) => String(node || '').trim())
        .filter(Boolean),
    ));
    pickOrdered(firstRoundCandidates);
    if (picked.length >= leaseTarget || firstRoundCandidates.length > 0) {
      return picked.slice(0, leaseTarget);
    }
  }

  pickOrdered(tailPreferredNodes);
  pickOrdered(preferredNodes);

  if (tailPreferredOnly && picked.length > 0) {
    return picked.slice(0, leaseTarget);
  }

  const freshCandidates = selector.getCandidates({
    limit: options.candidateLimit,
    purpose: 'sync_block',
  }).filter((endpoint) => !preferredNodes.includes(endpoint));

  while (picked.length < leaseTarget) {
    const freshLease = selector.acquirePreferredLease({
      preferred: freshCandidates,
      exclude: [...excluded, ...picked.map((lease) => lease.node)],
      purpose: 'sync_block',
      mode: 'fresh',
    });
    if (!freshLease) break;
    picked.push(freshLease);
  }

  if (picked.length < leaseTarget) {
    while (picked.length < leaseTarget) {
      const fallback = selector.acquirePreferredLease({
        preferred: selector.getCandidates({
          limit: options.candidateLimit,
          purpose: 'sync_block',
        }),
        exclude: [...excluded, ...picked.map((lease) => lease.node)],
        purpose: 'sync_block',
        mode: 'fresh',
      });
      if (!fallback) break;
      picked.push(fallback);
    }
  }

  return picked.slice(0, leaseTarget);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function syncBlocksParallel(blocks, context) {
  const pending = blocks.filter((row) => !row.success && row.rounds < context.maxRoundsPerBlock);
  if (!pending.length) return { progressed: false, cancelled: false };
  let remainingBudget = Math.max(1, Number(context.totalNodeBudget || 1));
  const scheduled = [];
  pending.forEach((blockState, index) => {
    if (remainingBudget <= 0) return;
    blockState.rounds += 1;
    const desiredLeaseCount = Math.max(
      1,
      Number(blockState.backupRequired ? context.backupLeasesPerBlock : context.primaryLeasesPerBlock) || 1,
    );
    const remainingBlocks = Math.max(0, pending.length - index - 1);
    const maxForThisBlock = Math.max(0, remainingBudget - remainingBlocks);
    const leaseCount = Math.max(0, Math.min(remainingBudget, desiredLeaseCount, maxForThisBlock));
    const pair = leaseCount > 0
      ? pickLeasesForRound(context.selector, context.preferredNodes, blockState, {
        candidateLimit: context.candidateLimit,
        primaryLeasesPerBlock: Math.max(1, leaseCount),
        backupLeasesPerBlock: Math.max(1, leaseCount),
        tailPreferredNodes: context.tailPreferredNodes,
        tailPreferredOnly: context.tailWindow === true && blockState.backupRequired !== true,
        lockedNodes: context.lockedNodes,
        explorationNodes: context.explorationNodes,
      })
      : [];
    blockState.currentRoundNodes = pair;
    remainingBudget = Math.max(0, remainingBudget - pair.length);
    blockState.roundAttempts.push({
      round: blockState.rounds,
      nodes: pair.map((lease) => lease.node),
      backupRequired: blockState.backupRequired === true,
    });
    emitEvent(context.onEvent, 'independent_sync_attempt_selected', {
      height: blockState.height,
      round: blockState.rounds,
      selectedNodes: pair.map((lease) => lease.node),
      backupRequired: blockState.backupRequired === true,
      preferredNodes: context.preferredNodes.slice(0, 32),
      triedNodes: Array.from(blockState.triedNodes),
    });
    pair.forEach((lease) => blockState.triedNodes.add(lease.node));
    if (!pair.length && !blockState.finalError) {
      blockState.finalError = remainingBudget <= 0 ? 'sync node budget exhausted' : 'no candidates available';
      return;
    }
    scheduled.push(blockState);
  });

  if (!scheduled.length) return { progressed: false, cancelled: false };

  const jobs = scheduled
    .filter((blockState) => Array.isArray(blockState.currentRoundNodes) && blockState.currentRoundNodes.length > 0)
    .flatMap((blockState) => blockState.currentRoundNodes.map((lease) => {
      const abortController = new AbortController();
      const streamSpeedPolicy = getRuntimeStreamSpeedPolicy(
        context.runtimeNodeStats,
        lease.node,
        context.preferredNodes,
      );
      return {
        height: blockState.height,
        lease,
        streamSpeedPolicy,
        abortController,
        settled: false,
        ignored: false,
        released: false,
        result: null,
        promise: fetchBlockFresh(
          lease.node,
          blockState.hash,
          context.connectTimeoutMs,
          context.getBlockTimeoutMs,
          context.onEvent,
          {
            height: blockState.height,
            round: blockState.rounds,
            streamSpeedPolicy,
            abortSignal: abortController.signal,
          },
        ).then((result) => {
          const next = result && typeof result === 'object'
          ? result
          : { ok: false, node: lease.node, error: 'invalid sync result' };
          if (next.ok === true && next.streamed && typeof next.streamed === 'object') {
            next.streamed = compactExtractedStreamedPayload(next.streamed);
          }
          return next;
        }),
      };
    }));

  if (typeof syncRuntime.updateActivity === 'function') {
    syncRuntime.updateActivity({
      phase: 'round_running',
      activeNodes: jobs.map((job) => String(job?.lease?.node || '').trim()).filter(Boolean),
    });
  }

  const releaseJob = (job, outcome = 'failure') => {
    if (!job || job.released) return;
    job.released = true;
    try {
      job.lease.release({ outcome });
    } catch (_) {}
  };

  jobs.forEach((job) => {
    job.promise
      .then((result) => {
        if (job.ignored) return job.result;
        job.result = result;
        job.settled = true;
        return result;
      })
      .catch((err) => {
        if (job.ignored) return job.result;
        job.result = {
          ok: false,
          node: job.lease.node,
          error: String(err?.message || 'sync job failed'),
        };
        job.settled = true;
        return job.result;
      });
  });

  const heightJobs = (height) => jobs.filter((job) => Number(job.height || 0) === Number(height || 0));
  const heightHasSuccess = (height) => heightJobs(height).some((job) => job.settled && job.result?.ok === true);
  const heightAllSettled = (height) => heightJobs(height).every((job) => job.settled);
  const allHeightsDecided = () => scheduled.every((blockState) => (
    heightHasSuccess(blockState.height) || heightAllSettled(blockState.height)
  ));

  while (jobs.some((job) => !job.settled) && !allHeightsDecided()) {
    if (typeof context.shouldCancel === 'function' && context.shouldCancel()) {
      jobs.forEach((job) => {
        if (!job.settled) {
          try { job.abortController?.abort?.('sync cancelled by newer generation'); } catch (_) {}
          emitEvent(context.onEvent, 'independent_sync_attempt_cancelled', {
            height: job.height,
            node: job.lease.node,
            round: scheduled.find((row) => row.height === job.height)?.rounds || 0,
            reason: 'stale_generation',
          });
        }
        releaseJob(job, 'cancelled');
      });
      if (typeof syncRuntime.updateActivity === 'function') {
        syncRuntime.updateActivity({
          phase: 'cancelled',
          activeNodes: [],
        });
      }
      scheduled.forEach((blockState) => { delete blockState.currentRoundNodes; });
      return { progressed: false, cancelled: true };
    }
    // Wait briefly so stale generations can yield without waiting for every block request to finish.
    // The underlying network requests will complete in the background and be ignored.
    // eslint-disable-next-line no-await-in-loop
    await sleep(100);
  }

  jobs.forEach((job) => {
    if (job.settled || !heightHasSuccess(job.height)) return;
    try { job.abortController?.abort?.('attempt cancelled after block winner'); } catch (_) {}
    job.ignored = true;
    job.settled = true;
    job.result = {
      ok: false,
      node: job.lease.node,
      error: 'attempt cancelled after block winner',
      cancelled: true,
      totalElapsedMs: 0,
    };
    emitEvent(context.onEvent, 'independent_sync_attempt_cancelled', {
      height: job.height,
      node: job.lease.node,
      round: scheduled.find((row) => row.height === job.height)?.rounds || 0,
      reason: 'winner_found',
    });
    releaseJob(job, 'cancelled');
  });

  const settled = jobs.map((job) => job.result || {
    ok: false,
    node: job.lease.node,
    error: 'sync job missing result',
  });
  const settledSuccessNodes = Array.from(new Set(
    settled
      .filter((row) => row && row.ok)
      .map((row) => String(row.node || '').trim())
      .filter(Boolean),
  ));
  if (typeof syncRuntime.updateActivity === 'function') {
    syncRuntime.updateActivity({
      phase: 'round_settled',
      activeNodes: settledSuccessNodes,
    });
  }
  const byHeight = new Map();
  settled.forEach((result, index) => {
    const job = jobs[index];
    const bucket = byHeight.get(job.height) || [];
    bucket.push(result);
    byHeight.set(job.height, bucket);
  });

  scheduled.forEach((blockState) => {
    const results = byHeight.get(blockState.height) || [];
    const leasesByNode = new Map((blockState.currentRoundNodes || []).map((lease) => [lease.node, lease]));
    results.forEach((row) => {
      noteRuntimeNodeResult(
        context.runtimeNodeStats,
        row.node,
        row.ok === true,
        row.error,
        Number(row.firstDataElapsedMs || row.totalElapsedMs || 0),
        Number(row.streamPayloadBytesPerSec || 0),
      );
      const lease = leasesByNode.get(row.node);
      if (!lease) return;
      const job = jobs.find((entry) => entry.height === blockState.height && entry.lease.node === row.node);
      if (row.ok) {
        lease.reportSuccess({
          latencyMs: Number(row.firstDataElapsedMs || row.totalElapsedMs || 0),
          purpose: 'sync_block',
        });
        promoteNodeInList(context.preferredNodes, row.node);
        promoteNodeInList(context.tailPreferredNodes, row.node);
      } else {
        lease.reportFailure({ error: row.error, purpose: 'sync_block' });
        if (/timeout/i.test(String(row.error || ''))) {
          removeNodeFromList(context.preferredNodes, row.node);
          removeNodeFromList(context.tailPreferredNodes, row.node);
        }
      }
      emitEvent(context.onEvent, 'independent_sync_attempt_result', {
        height: blockState.height,
        round: blockState.rounds,
        node: row.node,
        ok: row.ok === true,
        error: String(row.error || ''),
        connectElapsedMs: Number(row.connectElapsedMs || 0),
        firstDataElapsedMs: Number(row.firstDataElapsedMs || 0),
        getBlockElapsedMs: Number(row.getBlockElapsedMs || 0),
        totalElapsedMs: Number(row.totalElapsedMs || 0),
        streamPayloadBytesPerSec: Number(row.streamPayloadBytesPerSec || 0),
        txCount: Number(row.txCount || 0),
      });
      releaseJob(job, row.ok ? 'success' : 'failure');
    });
    blockState.results.push(...results);
    const okResults = results.filter((row) => row.ok).sort((a, b) => {
      const aScore = Number(a.firstDataElapsedMs || a.totalElapsedMs || 0);
      const bScore = Number(b.firstDataElapsedMs || b.totalElapsedMs || 0);
      return aScore - bScore;
    });
    if (okResults.length > 0) {
      blockState.success = true;
      blockState.winner = okResults[0];
      blockState.finalError = '';
      blockState.backupRequired = false;
      okResults.forEach((row) => {
        promoteNodeInList(context.preferredNodes, row.node);
        promoteNodeInList(context.tailPreferredNodes, row.node);
      });
      blockState.results = blockState.results.map((row) => {
        if (!row || typeof row !== 'object') return row;
        if (row === blockState.winner) return row;
        return sanitizeResult(row);
      });
    } else {
      const last = results[results.length - 1];
      blockState.finalError = String(last?.error || 'block sync failed');
      blockState.results = blockState.results.map((row) => sanitizeResult(row));
    }
    if (!blockState.success && blockState.rounds < context.maxRoundsPerBlock) {
      blockState.backupRequired = true;
    }
    emitEvent(context.onEvent, 'independent_sync_block_round_finished', {
      height: blockState.height,
      round: blockState.rounds,
      success: blockState.success === true,
      backupRequiredNextRound: blockState.backupRequired === true,
      winner: blockState.winner ? sanitizeResult(blockState.winner) : null,
      finalError: String(blockState.finalError || ''),
      triedNodes: Array.from(blockState.triedNodes),
    });
    if (Number(blockState.rounds || 0) === 1 && blockState.lockedCandidateNode) {
      const evalResult = noteLockedCandidateOutcome(
        blockState.lockedCandidateNode,
        blockState.success === true && blockState.winner?.node === blockState.lockedCandidateNode,
        {
          perfectSuccessThreshold: context.perfectNodeSuccessThreshold,
          candidateEvalBlocks: context.candidateEvalBlocks,
          candidateEvalFailureLimit: context.candidateEvalFailureLimit,
        },
      );
      if (evalResult) {
        emitEvent(context.onEvent, 'independent_sync_candidate_evaluated', {
          node: evalResult.node,
          testedBlocks: evalResult.testedBlocks,
          successCount: evalResult.successCount,
          failCount: evalResult.failCount,
          successRate: Number((evalResult.successRate || 0).toFixed(4)),
          completed: evalResult.completed === true || Boolean(evalResult.completedAt),
          qualified: evalResult.qualified === true,
          cycle: Number(evalResult.cycle || 0),
        });
      }
    }
    delete blockState.currentRoundNodes;
  });

  return { progressed: true, cancelled: false };
}

async function runSync(options = {}) {
  const control = beginRunControl({ reason: options.reason || options.commandType || 'sync' });
  const startHeight = resolveStartHeight(options.startHeight);
  const targetHeight = resolveTargetHeight(options.targetHeight, options.toTip === true);
  let endHeight = targetHeight > 0
    ? Math.max(startHeight, targetHeight)
    : (startHeight + Math.max(1, Number(options.count || DEFAULT_COUNT)) - 1);
  const syncState = loadSyncProjectionState();
  const hashCache = {
    ...(syncState?.p2pHeightHashCache && typeof syncState.p2pHeightHashCache === 'object'
      ? syncState.p2pHeightHashCache
      : {}),
  };
  const selector = wallet.createWalletSyncNodeAllocator({
    candidateLimit: options.candidateLimit,
    syncStats: syncState?.p2pNodeStats && typeof syncState.p2pNodeStats === 'object'
      ? syncState.p2pNodeStats
      : {},
  });
  const runtimeNodeStats = {
    ...(syncState?.p2pNodeStats && typeof syncState.p2pNodeStats === 'object' ? syncState.p2pNodeStats : {}),
  };
  ensureRetainedGoodNodesLoaded();
  const preferredNodes = Array.from(singletonState.retainedGoodNodes);
  if (!preferredNodes.length) {
    const seedSelection = chooseSeedPreferredNodes(syncState?.p2pNodeStats || {}, RETAINED_GOOD_NODE_LIMIT);
    seedSelection.nodes.forEach((node) => uniquePush(preferredNodes, node));
    emitEvent(options.onEvent, 'independent_sync_seed_nodes_loaded', {
      source: String(syncState?.__source || 'sqlite'),
      statCount: Object.keys(syncState?.p2pNodeStats || {}).length,
      selectedCount: seedSelection.nodes.length,
      selectedNodes: seedSelection.nodes.slice(0, 12),
      metrics: seedSelection.metrics,
    });
    appendDebug('independent_sync_seed_nodes_loaded', {
      source: String(syncState?.__source || 'sqlite'),
      statCount: Object.keys(syncState?.p2pNodeStats || {}).length,
      selectedCount: seedSelection.nodes.length,
      selectedNodes: seedSelection.nodes.slice(0, 12),
      metrics: seedSelection.metrics,
    });
  }
  const tailPreferredNodes = [];
  loadTailPreferredNodesFromState(TAIL_PREFERRED_NODE_LIMIT).forEach((node) => uniquePush(tailPreferredNodes, node));
  preferredNodes.forEach((node) => uniquePush(tailPreferredNodes, node));
  const startedAt = Date.now();
  const isCancelled = typeof options.isCancelled === 'function' ? options.isCancelled : null;
  const onWindow = typeof options.onWindow === 'function' ? options.onWindow : null;
  const resolveDynamicTargetHeight = typeof options.resolveTargetHeight === 'function'
    ? options.resolveTargetHeight
    : null;
  const shouldCancel = () => Boolean((isCancelled && isCancelled()) || !isRunControlCurrent(control));
  const leasesPerBlock = Math.max(1, Number(options.leasesPerBlock || 1));
  const backupLeasesPerBlock = Math.max(
    2,
    leasesPerBlock,
    Number(options.backupLeasesPerBlock || Math.max(2, leasesPerBlock)),
  );
  const totalNodeBudget = Math.max(
    leasesPerBlock,
    Number.isFinite(Number(options.totalNodeBudget))
      ? Number(options.totalNodeBudget)
      : (Math.max(1, Number(options.parallelBlocks || DEFAULT_PARALLEL_BLOCKS)) * leasesPerBlock),
  );
  const maxParallelBlocks = Math.max(
    1,
    Math.min(
      Math.max(1, Number(options.maxAdaptiveParallelBlocks || options.parallelBlocks || DEFAULT_PARALLEL_BLOCKS)),
      Math.max(1, Math.floor(totalNodeBudget / leasesPerBlock)),
    ),
  );
  const minParallelBlocks = Math.max(2, Math.min(maxParallelBlocks, Number(options.minParallelBlocks || DEFAULT_MIN_PARALLEL_BLOCKS)));
  let currentParallelBlocks = Math.max(
    minParallelBlocks,
    Math.min(
      maxParallelBlocks,
      Math.max(minParallelBlocks, Number(options.adaptiveInitialParallelBlocks || DEFAULT_ADAPTIVE_INITIAL_PARALLEL_BLOCKS || minParallelBlocks)),
    ),
  );
  const lockSuccessBlocks = Math.max(1, Number(options.lockSuccessBlocks || DEFAULT_LOCK_SUCCESS_BLOCKS));
  const lockFailureLimit = Math.max(1, Number(options.lockFailureLimit || DEFAULT_LOCK_FAILURE_LIMIT));
  let lockedNodes = selectLockedNodes([], runtimeNodeStats, currentParallelBlocks, {
    lockFailureLimit,
  });
  let explorationNodes = currentParallelBlocks > lockedNodes.length
    ? selectExplorationNodes(runtimeNodeStats, lockedNodes, 1, { lockFailureLimit })
    : [];
  let lockedCoverageBlocks = 0;

  const context = {
    selector,
    preferredNodes,
    connectTimeoutMs: Math.max(1000, Number(options.connectTimeoutMs || DEFAULT_CONNECT_TIMEOUT_MS)),
    getBlockTimeoutMs: Math.max(1000, Number(options.getBlockTimeoutMs || DEFAULT_GETBLOCK_TIMEOUT_MS)),
    maxRoundsPerBlock: Math.max(1, Number(options.maxRoundsPerBlock || DEFAULT_MAX_ROUNDS_PER_BLOCK)),
    candidateLimit: Math.max(8, Number(options.candidateLimit || DEFAULT_CANDIDATE_LIMIT)),
    primaryLeasesPerBlock: leasesPerBlock,
    backupLeasesPerBlock,
    totalNodeBudget,
    onEvent: typeof options.onEvent === 'function' ? options.onEvent : null,
    runtimeNodeStats,
    lockedNodes,
    explorationNodes,
  };

  const allBlocks = [];
  const windows = [];
  await syncRuntime.startRun({ startHeight, targetHeight: endHeight });
  let cursor = startHeight;
  try {
    while (cursor <= endHeight) {
      if (resolveDynamicTargetHeight) {
        const nextTarget = Math.max(cursor - 1, Number(resolveDynamicTargetHeight() || 0));
        if (nextTarget > endHeight) {
          endHeight = nextTarget;
          if (typeof syncRuntime.updateTargetHeight === 'function') syncRuntime.updateTargetHeight(endHeight);
        }
      }
      if (shouldCancel()) {
        syncRuntime.finishRun({ summary: null, error: new Error('sync cancelled') });
        return {
          cancelled: true,
          startHeight,
          endHeight,
          completedCount: allBlocks.filter((row) => row.success).length,
          generation: control.generation,
        };
      }
      const windowEnd = Math.min(endHeight, cursor + currentParallelBlocks - 1);
      const remainingCount = Math.max(0, endHeight - cursor + 1);
      const tailWindow = remainingCount <= 2;
      lockedNodes = selectLockedNodes(lockedNodes, runtimeNodeStats, currentParallelBlocks, {
        lockFailureLimit,
      });
      explorationNodes = currentParallelBlocks > lockedNodes.length
        ? selectExplorationNodes(runtimeNodeStats, lockedNodes, 1, { lockFailureLimit })
        : [];
      context.lockedNodes = lockedNodes;
      context.explorationNodes = explorationNodes;
      const heights = Array.from({ length: Math.max(0, windowEnd - cursor + 1) }, (_, index) => cursor + index);
      const blocks = [];
      for (const height of heights) {
        // Keep resync semantics robust: a reset baseline may not have preseeded
        // hashes for every start height, especially below the retained BHS window.
        // Backfill only when local sync/BHS state cannot already resolve the hash.
        // eslint-disable-next-line no-await-in-loop
        const hash = await ensureHash(height, {
          hashCache,
          onEvent: context.onEvent,
        });
        blocks.push({
          height,
          hash,
          success: false,
          winner: null,
          finalError: '',
          backupRequired: false,
          rounds: 0,
          triedNodes: new Set(),
          results: [],
          roundAttempts: [],
        });
      }
      const windowStartedAt = Date.now();
      let roundsElapsedMs = 0;
      let commitElapsedMs = 0;
      let roundCount = 0;
      while (true) {
        if (shouldCancel()) {
          syncRuntime.finishRun({ summary: null, error: new Error('sync cancelled') });
          return {
            cancelled: true,
            startHeight,
            endHeight,
            completedCount: allBlocks.filter((row) => row.success).length,
            generation: control.generation,
          };
        }
        // eslint-disable-next-line no-await-in-loop
        const roundStartedAt = Date.now();
        const step = await syncBlocksParallel(blocks, {
          ...context,
          tailWindow,
          tailPreferredNodes,
          primaryLeasesPerBlock: context.primaryLeasesPerBlock,
          shouldCancel,
        });
        roundsElapsedMs += (Date.now() - roundStartedAt);
        if (step.progressed) roundCount += 1;
        if (step.cancelled) {
          syncRuntime.finishRun({ summary: null, error: new Error('sync cancelled') });
          return {
            cancelled: true,
            startHeight,
            endHeight,
            completedCount: allBlocks.filter((row) => row.success).length,
            generation: control.generation,
          };
        }
        if (!step.progressed) break;
      }
      allBlocks.push(...blocks);
      const completedInWindow = blocks.filter((row) => row.success);
      const failedInWindow = blocks.filter((row) => !row.success);
      const firstRoundSuccessInWindow = blocks.filter((row) => row.success === true && Number(row.rounds || 0) <= 1).length;
      const successNodesInWindow = Array.from(new Set(
        completedInWindow
          .flatMap((row) => (row.results || []).filter((entry) => entry && entry.ok).map((entry) => String(entry.node || '').trim()))
          .filter(Boolean),
      ));
      const windowSummary = {
        startHeight: cursor,
        endHeight: windowEnd,
        parallelBlocks: currentParallelBlocks,
        completedCount: completedInWindow.length,
        failedCount: failedInWindow.length,
        firstRoundSuccessCount: firstRoundSuccessInWindow,
        successNodeCount: successNodesInWindow.length,
        successNodes: successNodesInWindow,
        elapsedMs: Date.now() - startedAt,
      };
      windows.push(windowSummary);
      emitEvent(context.onEvent, 'independent_sync_window_finished', windowSummary);
      if (completedInWindow.length > 0) {
        completedInWindow.forEach((row) => {
          (row.results || [])
            .filter((entry) => entry && entry.ok)
            .forEach((entry) => {
              uniquePush(preferredNodes, entry.node);
              uniquePush(tailPreferredNodes, entry.node);
            });
          if (row.winner?.node) uniquePush(lockedNodes, row.winner.node);
        });
        lockedNodes = selectLockedNodes(lockedNodes, runtimeNodeStats, maxParallelBlocks, {
          lockFailureLimit,
        });
        context.lockedNodes = lockedNodes;
        rememberRetainedGoodNodes(successNodesInWindow);
        // eslint-disable-next-line no-await-in-loop
        if (isRunControlCurrent(control) && !shouldCancel()) {
          const commitStartedAt = Date.now();
          let commitResult = null;
          try {
            commitResult = await syncRuntime.commitWindow({
              windowStart: cursor,
              windowEnd,
              blocks,
              preferredNodes,
              onEvent: context.onEvent,
              shouldCancel,
            });
          } catch (err) {
            if (String(err?.code || '') === 'SYNC_CANCELLED') {
              syncRuntime.finishRun({ summary: null, error: new Error('sync cancelled') });
              return {
                cancelled: true,
                startHeight,
                endHeight,
                completedCount: allBlocks.filter((row) => row.success).length,
                generation: control.generation,
              };
            }
            throw err;
          }
          windowSummary.committedLocalHeight = Math.max(
            Number(windowSummary.committedLocalHeight || 0),
            Number(commitResult?.status?.localHeight || 0),
          );
          commitElapsedMs += (Date.now() - commitStartedAt);
        }
        completedInWindow.forEach((row) => releaseBlockStatePayload(row));
      }
      failedInWindow.forEach((row) => releaseBlockStatePayload(row));
      emitEvent(context.onEvent, 'independent_sync_window_profile', {
        startHeight: cursor,
        endHeight: windowEnd,
        parallelBlocks: currentParallelBlocks,
        perfectNodeCount: lockedNodes.length,
        candidateNodeCount: explorationNodes.length,
        lockedCandidateNode: explorationNodes[0] || '',
        roundCount,
        roundsElapsedMs,
        commitElapsedMs,
        totalElapsedMs: Date.now() - windowStartedAt,
        completedCount: completedInWindow.length,
        failedCount: failedInWindow.length,
        firstRoundSuccessCount: firstRoundSuccessInWindow,
        successNodeCount: successNodesInWindow.length,
      });
      const lockedSet = new Set(lockedNodes.map((node) => String(node || '').trim()).filter(Boolean));
      const lockedCoverageThisWindow = completedInWindow.filter((row) => lockedSet.has(String(row?.winner?.node || '').trim())).length;
      const previousParallelBlocks = currentParallelBlocks;
      if (lockedNodes.length >= currentParallelBlocks) {
        lockedCoverageBlocks += lockedCoverageThisWindow;
      } else {
        lockedCoverageBlocks = 0;
      }
      if (currentParallelBlocks < maxParallelBlocks && lockedNodes.length >= currentParallelBlocks && lockedCoverageBlocks >= lockSuccessBlocks) {
        currentParallelBlocks += 1;
        lockedCoverageBlocks = 0;
        emitEvent(context.onEvent, 'independent_sync_parallel_adjusted', {
          previousParallelBlocks,
          nextParallelBlocks: currentParallelBlocks,
          perfectNodeCount: lockedNodes.length,
          candidateNodeCount: explorationNodes.length,
          lockedCandidateNode: explorationNodes[0] || '',
          reason: 'locked_nodes_covered_parallel_window',
          evalBlocks: lockSuccessBlocks,
          firstRoundSuccessCount: lockedCoverageThisWindow,
          successRate: 1,
          successThreshold: 1,
        });
      } else if (currentParallelBlocks > minParallelBlocks && lockedNodes.length <= (currentParallelBlocks - 2)) {
        currentParallelBlocks -= 1;
        lockedCoverageBlocks = 0;
        emitEvent(context.onEvent, 'independent_sync_parallel_adjusted', {
          previousParallelBlocks,
          nextParallelBlocks: currentParallelBlocks,
          perfectNodeCount: lockedNodes.length,
          candidateNodeCount: explorationNodes.length,
          lockedCandidateNode: explorationNodes[0] || '',
          reason: 'locked_nodes_below_parallel_by_two',
          evalBlocks: 0,
          firstRoundSuccessCount: lockedCoverageThisWindow,
          successRate: 0,
          successThreshold: 0,
        });
      }
      if (onWindow) onWindow(windowSummary, blocks);
      if (failedInWindow.length > 0) break;
      cursor = windowEnd + 1;
    }

    const completed = allBlocks.filter((row) => row.success);
    const failed = allBlocks.filter((row) => !row.success);
    const successNodes = Array.from(new Set(
      completed
        .flatMap((row) => (row.results || []).filter((entry) => entry && entry.ok).map((entry) => String(entry.node || '').trim()))
        .filter(Boolean),
    ));
    const summary = {
      startHeight,
      endHeight,
      localHeight: windows.reduce(
        (maxHeight, row) => Math.max(maxHeight, Number(row?.committedLocalHeight || 0)),
        Math.max(0, Number(startHeight || 1) - 1),
      ),
      count: Math.max(0, endHeight - startHeight + 1),
      connectTimeoutMs: context.connectTimeoutMs,
      getBlockTimeoutMs: context.getBlockTimeoutMs,
      maxRoundsPerBlock: context.maxRoundsPerBlock,
      parallelBlocks: currentParallelBlocks,
      maxParallelBlocks,
      minParallelBlocks,
      lockSuccessBlocks,
      lockFailureLimit,
      totalNodeBudget,
      leasesPerBlock,
      backupLeasesPerBlock,
      toTip: options.toTip === true,
      elapsedMs: Date.now() - startedAt,
      completedCount: completed.length,
      failedCount: failed.length,
      successNodes,
      successNodeCount: successNodes.length,
      lockedNodes,
      explorationNodes,
      lockedCoverageBlocks,
      preferredNodes,
      generation: control.generation,
      windows,
      p2pNodeStats: normalizeRuntimeNodeStatsForSummary(runtimeNodeStats),
      blocks: allBlocks.map((row) => ({
        height: row.height,
        success: row.success,
        rounds: row.rounds,
        triedNodes: Array.from(row.triedNodes),
        winner: sanitizeResult(row.winner),
        roundAttempts: row.roundAttempts,
        results: Array.isArray(row.results) ? row.results.map(sanitizeResult) : [],
        finalError: row.finalError,
      })),
    };
    syncRuntime.finishRun({ summary, error: failed.length > 0 ? new Error('frontier sync failed') : null });
    return summary;
  } catch (err) {
    syncRuntime.finishRun({ summary: null, error: err });
    throw err;
  } finally {
    finishRunControl(control);
  }
}

module.exports = {
  cancelActiveRun,
  resetServiceState,
  runSync,
  getServiceSnapshot() {
    return {
      active: Boolean(singletonState.activeControl && singletonState.activeControl.active),
      activeGeneration: Number(singletonState.activeControl?.generation || 0),
      retainedGoodNodes: Array.from(singletonState.retainedGoodNodes),
    };
  },
};
