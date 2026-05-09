const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const broadcastService = require('../services/broadcast_service');

test('inv-getdata only is uncertain, not network seen', () => {
  const result = broadcastService.classifyBroadcastEvidence({
    successCount: 2,
    mempoolProofHitCount: 0,
    observed: null,
    requireVisibility: true,
    allowPendingVisibilityCommit: true,
  });
  assert.equal(result.status, 'broadcast_uncertain_retrying');
  assert.equal(result.networkSeen, false);
  assert.equal(result.commitAllowed, true);
});

test('mempool proof upgrades broadcast to pending confirm', () => {
  const result = broadcastService.classifyBroadcastEvidence({
    successCount: 1,
    mempoolProofHitCount: 1,
    observed: null,
    requireVisibility: true,
  });
  assert.equal(result.status, 'broadcast_pending_confirm');
  assert.equal(result.networkSeen, true);
  assert.equal(result.realVisibility, true);
});

test('confirmed observation is final success', () => {
  const result = broadcastService.classifyBroadcastEvidence({
    successCount: 1,
    mempoolProofHitCount: 0,
    observed: { node: 'spv_index', confirmedSeen: true },
    requireVisibility: true,
  });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.final, true);
  assert.equal(result.commitAllowed, true);
});

test('server requireVisibility does not implicitly allow uncertain local commit', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server_market.js'), 'utf8');
  assert.match(source, /const effectiveAllowPendingVisibilityCommit = allowPendingVisibilityCommit === true;/);
  assert.doesNotMatch(source, /allowPendingVisibilityCommit === true \|\| requireVisibility === true/);
});

test('oversize-op-return marks node as data relay bad without banning all broadcasts', () => {
  const nowMs = Date.now();
  const row = broadcastService.applyBroadcastFailureToNode({
    endpoint: 'node:8333',
    score: 50,
    broadcastFailCount: 0,
    consecutiveFail: 0,
  }, {
    reason: 'SPV peer rejected transaction: code=64 reason=oversize-op-return message=tx',
    nowMs,
  });
  assert.equal(row.broadcastFailCount, 1);
  assert.equal(row.dataRelayRejectCount, 1);
  assert.ok(row.dataRelayBadUntil > nowMs);
  assert.equal(broadcastService.isDataRelayBad(row, nowMs), true);
});
