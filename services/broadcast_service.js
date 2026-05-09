'use strict';

function normalizeNode(node) {
  return String(node || '').trim();
}

function uniqueNodes(nodes = [], limit = 16) {
  return Array.from(new Set((Array.isArray(nodes) ? nodes : [])
    .map(normalizeNode)
    .filter(Boolean))).slice(0, Math.max(0, Number(limit || 0)));
}

function hasExternalObservation(observed) {
  const observedNode = normalizeNode(observed?.node);
  return Boolean(observed)
    && (
      Boolean(observed?.confirmedSeen)
      || (observedNode && observedNode !== 'spv_index')
    );
}

function classifyBroadcastEvidence({
  observed = null,
  successCount = 0,
  mempoolProofHitCount = 0,
  requireVisibility = false,
  allowPendingVisibilityCommit = false,
} = {}) {
  const proofCount = Math.max(0, Number(mempoolProofHitCount || 0));
  const sentCount = Math.max(0, Number(successCount || 0));
  const externalObserved = hasExternalObservation(observed);
  const confirmed = Boolean(observed?.confirmedSeen);
  const networkSeen = proofCount >= 1 || externalObserved;

  if (confirmed) {
    return {
      status: 'confirmed',
      final: true,
      realVisibility: true,
      networkSeen: true,
      commitAllowed: true,
    };
  }
  if (networkSeen) {
    return {
      status: 'broadcast_pending_confirm',
      final: false,
      realVisibility: true,
      networkSeen: true,
      commitAllowed: true,
    };
  }
  if (sentCount > 0) {
    const commitAllowed = !requireVisibility || allowPendingVisibilityCommit;
    return {
      status: 'broadcast_uncertain_retrying',
      final: false,
      realVisibility: false,
      networkSeen: false,
      commitAllowed,
    };
  }
  return {
    status: 'failed',
    final: true,
    realVisibility: false,
    networkSeen: false,
    commitAllowed: false,
  };
}

function buildPendingBroadcastResult({
  txid,
  successes = [],
  tries = [],
  observed = null,
  mempoolProofNodes = [],
  packageResult = {},
  requireVisibility = false,
  reason = 'sent_to_peer_pending_visibility',
  status = 'broadcast_uncertain_retrying',
} = {}) {
  const safeSuccesses = Array.isArray(successes) ? successes : [];
  const proofNodes = uniqueNodes(mempoolProofNodes, 16);
  const monitorNodes = uniqueNodes(safeSuccesses.map((item) => item?.node), 8);
  return {
    txid: String(txid || '').trim().toLowerCase(),
    provider: 'spv-p2p',
    node: monitorNodes[0] || normalizeNode(safeSuccesses[0]?.node) || normalizeNode(tries[0]),
    nodes: uniqueNodes(safeSuccesses.map((item) => item?.node), 32),
    monitorNodes,
    successCount: safeSuccesses.length,
    attemptedCount: Array.isArray(tries) ? tries.length : 0,
    contextFormat: String(packageResult?.format || ''),
    beefFormat: 'local-chain',
    packageTxCount: Array.isArray(packageResult?.items) ? packageResult.items.length : 1,
    beefComplete: Boolean(packageResult?.complete),
    observed: Boolean(observed),
    observedRelevant: Boolean(observed?.relevant),
    observedConfirmed: Boolean(observed?.confirmedSeen),
    observedNode: normalizeNode(observed?.node),
    mempoolProofHitCount: proofNodes.length,
    mempoolProofNodes: proofNodes,
    broadcastAcceptedByMempool: status === 'broadcast_pending_confirm',
    acceptedWithoutVisibility: status === 'broadcast_uncertain_retrying',
    broadcastPendingConfirm: true,
    broadcastUncertain: status === 'broadcast_uncertain_retrying',
    broadcastStatus: status,
    pendingReason: reason,
    requireExternalVisibility: Boolean(requireVisibility),
  };
}

function isOversizeOpReturnReason(reason = '') {
  return /oversize-op-return/i.test(String(reason || ''));
}

function applyBroadcastFailureToNode(row = {}, { reason = '', nowMs = Date.now() } = {}) {
  const next = { ...row };
  const nowIso = new Date(nowMs).toISOString();
  next.broadcastFailCount = Number(next.broadcastFailCount || 0) + 1;
  next.lastFailAt = nowIso;
  next.consecutiveFail = Number(next.consecutiveFail || 0) + 1;
  next.score = Math.max(-100, Number(next.score || 0) - 3);
  if (isOversizeOpReturnReason(reason)) {
    next.dataRelayRejectCount = Number(next.dataRelayRejectCount || 0) + 1;
    next.lastDataRelayRejectAt = nowIso;
    next.dataRelayBadUntil = Math.max(
      Number(next.dataRelayBadUntil || 0),
      nowMs + (60 * 60 * 1000),
    );
    next.score = Math.max(-100, Number(next.score || 0) - 15);
  }
  return next;
}

function isDataRelayBad(row = {}, nowMs = Date.now()) {
  return Number(row?.dataRelayBadUntil || 0) > nowMs;
}

module.exports = {
  applyBroadcastFailureToNode,
  buildPendingBroadcastResult,
  classifyBroadcastEvidence,
  hasExternalObservation,
  isDataRelayBad,
  isOversizeOpReturnReason,
  uniqueNodes,
};
