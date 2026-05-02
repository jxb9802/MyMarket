const test = require('node:test');
const assert = require('node:assert/strict');

const { createP2PNodeSelector } = require('../p2p_node_selector');

function makeSelector(overrides = {}) {
  return createP2PNodeSelector({
    snapshotLimit: 24,
    nodeStateMax: 64,
    defaultCandidateLimit: 16,
    timeoutCooldownMs: 60000,
    nodeMaxConsecFail: 2,
    nodeBanMs: 120000,
    walletApi: {
      getSpvNodeSnapshot() {
        return {
          connected: [],
          candidates: [],
        };
      },
    },
    ...overrides,
  });
}

test('imports and exports normalized node stats', () => {
  const selector = makeSelector();
  selector.importStats({
    'a:8333': {
      score: 999,
      successCount: 10,
      failCount: 1,
      consecutiveFails: 0,
      bannedUntil: 0,
      avgLatencyMs: 120,
      lastError: 'x'.repeat(300),
      lastFailureAt: 100,
      lastTimeoutAt: 90,
      lastSuccessAt: 110,
      updatedAt: 120,
    },
  });
  const row = selector.getHealth('a:8333', { purpose: 'sync_block' });
  assert.equal(row.score, 100);
  assert.equal(row.successCount, 10);
  assert.equal(row.avgLatencyMs, 120);
  assert.equal(row.lastError.length, 240);

  const exported = selector.exportStats();
  assert.equal(exported['a:8333'].score, 100);
});

test('prefers healthy non-cooled nodes in candidate ordering', () => {
  const now = Date.now();
  const selector = makeSelector({
    walletApi: {
      getSpvNodeSnapshot() {
        return {
          connected: [],
          candidates: [
            { rank: 1, endpoint: 'fast:8333', score: 80 },
            { rank: 2, endpoint: 'cooling:8333', score: 99 },
            { rank: 3, endpoint: 'slow:8333', score: 70 },
          ],
        };
      },
    },
  });
  selector.importStats({
    'fast:8333': { score: 90, successCount: 10, failCount: 0, consecutiveFails: 0, avgLatencyMs: 100, lastSuccessAt: now - 1000, updatedAt: now - 1000 },
    'cooling:8333': { score: 95, successCount: 20, failCount: 0, consecutiveFails: 0, avgLatencyMs: 50, lastSuccessAt: now - 500, lastTimeoutAt: now - 1000, updatedAt: now - 500 },
    'slow:8333': { score: 70, successCount: 10, failCount: 0, consecutiveFails: 0, avgLatencyMs: 500, lastSuccessAt: now - 2000, updatedAt: now - 2000 },
  });

  const candidates = selector.getCandidates({ limit: 3, purpose: 'sync_block' });
  assert.deepEqual(candidates, ['fast:8333', 'slow:8333', 'cooling:8333']);
});

test('records download speed and prefers faster sync-block nodes', () => {
  const selector = makeSelector({
    walletApi: {
      getSpvNodeSnapshot() {
        return {
          connected: [],
          candidates: [
            { rank: 1, endpoint: 'slow:8333', score: 90 },
            { rank: 2, endpoint: 'fast:8333', score: 80 },
          ],
        };
      },
    },
  });

  selector.reportSuccess('slow:8333', {
    purpose: 'sync_block',
    latencyMs: 50,
    downloadBytesPerSec: 120 * 1024,
  });
  selector.reportSuccess('fast:8333', {
    purpose: 'sync_block',
    latencyMs: 200,
    downloadBytesPerSec: 2 * 1024 * 1024,
  });

  const row = selector.getHealth('fast:8333', { purpose: 'sync_block' });
  assert.equal(row.lastDownloadBytesPerSec, 2 * 1024 * 1024);
  assert.equal(row.downloadSampleCount, 1);
  assert.deepEqual(selector.getCandidates({ limit: 2, purpose: 'sync_block' }), ['fast:8333', 'slow:8333']);
});

test('acquire and release nodes respects lease state', () => {
  const selector = makeSelector({
    walletApi: {
      getSpvNodeSnapshot() {
        return {
          connected: [],
          candidates: [
            { rank: 1, endpoint: 'n1:8333', score: 80 },
            { rank: 2, endpoint: 'n2:8333', score: 70 },
            { rank: 3, endpoint: 'n3:8333', score: 60 },
          ],
        };
      },
    },
  });
  selector.importStats({
    'n1:8333': { score: 90, successCount: 10, failCount: 0, consecutiveFails: 0, lastSuccessAt: 100, updatedAt: 100 },
    'n2:8333': { score: 80, successCount: 9, failCount: 0, consecutiveFails: 0, lastSuccessAt: 90, updatedAt: 90 },
    'n3:8333': { score: 70, successCount: 8, failCount: 0, consecutiveFails: 0, lastSuccessAt: 80, updatedAt: 80 },
  });

  assert.deepEqual(selector.acquireNodes({ count: 2 }), ['n1:8333', 'n2:8333']);
  assert.equal(selector.acquireBackupNode({}), 'n3:8333');
  selector.releaseNode('n2:8333');
  assert.equal(selector.acquireBackupNode({ exclude: ['n1:8333', 'n3:8333'] }), 'n2:8333');
});

test('acquirePreferredNodes leases preferred nodes first then fills remaining slots', () => {
  const selector = makeSelector({
    walletApi: {
      getSpvNodeSnapshot() {
        return {
          connected: [],
          candidates: [
            { rank: 1, endpoint: 'n1:8333', score: 90 },
            { rank: 2, endpoint: 'n2:8333', score: 80 },
            { rank: 3, endpoint: 'n3:8333', score: 70 },
          ],
        };
      },
    },
  });
  selector.importStats({
    'n1:8333': { score: 90, successCount: 10, failCount: 0, consecutiveFails: 0, lastSuccessAt: 100, updatedAt: 100 },
    'n2:8333': { score: 80, successCount: 9, failCount: 0, consecutiveFails: 0, lastSuccessAt: 90, updatedAt: 90 },
    'n3:8333': { score: 70, successCount: 8, failCount: 0, consecutiveFails: 0, lastSuccessAt: 80, updatedAt: 80 },
  });

  const leased = selector.acquirePreferredNodes({
    preferred: ['n3:8333', 'n2:8333'],
    count: 2,
    purpose: 'sync_block',
  });
  assert.deepEqual(leased, ['n3:8333', 'n2:8333']);
});

test('reportFailure bans transport-failed nodes after threshold and reportSuccess clears fail streak', () => {
  const selector = makeSelector({
    nodeMaxConsecFail: 2,
    nodeBanMs: 120000,
  });

  selector.reportFailure('bad:8333', { error: 'p2p connect timeout: bad:8333' });
  let row = selector.getHealth('bad:8333');
  assert.equal(row.consecutiveFails, 1);
  assert.equal(row.bannedUntil, 0);

  selector.reportFailure('bad:8333', { error: 'p2p connect timeout: bad:8333' });
  row = selector.getHealth('bad:8333');
  assert.equal(row.consecutiveFails, 2);
  assert.ok(row.bannedUntil > Date.now());

  selector.reportSuccess('bad:8333', { latencyMs: 150 });
  row = selector.getHealth('bad:8333');
  assert.equal(row.consecutiveFails, 0);
  assert.equal(row.bannedUntil, 0);
});

test('wallet probe success does not outrank sync-block history', () => {
  const now = Date.now();
  const selector = makeSelector({
    walletApi: {
      getSpvNodeSnapshot() {
        return {
          connected: [],
          candidates: [
            { rank: 1, endpoint: 'probe-fast:8333', score: 100 },
            { rank: 2, endpoint: 'block-good:8333', score: 60 },
          ],
        };
      },
    },
  });

  selector.importStats({
    'block-good:8333': { score: 90, successCount: 20, failCount: 0, consecutiveFails: 0, avgLatencyMs: 120, lastSuccessAt: now - 1000, updatedAt: now - 1000 },
    'probe-fast:8333': { score: 40, successCount: 1, failCount: 0, consecutiveFails: 0, avgLatencyMs: 900, lastSuccessAt: now - 5000, updatedAt: now - 5000 },
  });

  selector.reportSuccess('probe-fast:8333', { latencyMs: 50, purpose: 'probe' });

  const syncCandidates = selector.getCandidates({ limit: 2, purpose: 'sync_block' });
  assert.deepEqual(syncCandidates, ['block-good:8333', 'probe-fast:8333']);
});

test('acquireLease and releaseLease track active session state', () => {
  const selector = makeSelector({
    walletApi: {
      getSpvNodeSnapshot() {
        return {
          connected: [],
          candidates: [
            { rank: 1, endpoint: 'n1:8333', score: 90 },
            { rank: 2, endpoint: 'n2:8333', score: 80 },
          ],
        };
      },
    },
  });
  selector.importStats({
    'n1:8333': { score: 90, successCount: 10, failCount: 0, consecutiveFails: 0, lastSuccessAt: 100, updatedAt: 100 },
    'n2:8333': { score: 80, successCount: 9, failCount: 0, consecutiveFails: 0, lastSuccessAt: 90, updatedAt: 90 },
  });

  const lease = selector.acquireLease({ purpose: 'sync_block', mode: 'fresh' });
  assert.ok(lease);
  assert.equal(lease.node, 'n1:8333');
  assert.equal(lease.mode, 'fresh');
  assert.equal(lease.isActive(), true);
  assert.equal(selector.getActiveLeases().length, 1);

  const snapshot = lease.snapshot();
  assert.equal(snapshot.node, 'n1:8333');
  assert.equal(snapshot.status, 'active');

  assert.equal(selector.releaseLease(lease.id, { outcome: 'success' }), true);
  assert.equal(lease.isActive(), false);
  assert.equal(selector.getActiveLeases().length, 0);
  assert.equal(selector.releaseLease(lease.id, { outcome: 'again' }), false);
});

test('lease handle reports success/failure through selector health buckets', () => {
  const selector = makeSelector({
    nodeMaxConsecFail: 2,
    nodeBanMs: 120000,
    walletApi: {
      getSpvNodeSnapshot() {
        return {
          connected: [],
          candidates: [
            { rank: 1, endpoint: 'n1:8333', score: 90 },
          ],
        };
      },
    },
  });

  const lease = selector.acquireLease({ purpose: 'sync_block', mode: 'persistent' });
  assert.ok(lease);
  lease.reportFailure({ error: 'p2p connect timeout: n1:8333' });
  lease.reportFailure({ error: 'p2p connect timeout: n1:8333' });
  let row = selector.getHealth('n1:8333', { purpose: 'sync_block' });
  assert.equal(row.consecutiveFails, 2);
  assert.ok(row.bannedUntil > Date.now());

  lease.reportSuccess({ latencyMs: 120, purpose: 'sync_block' });
  row = selector.getHealth('n1:8333', { purpose: 'sync_block' });
  assert.equal(row.consecutiveFails, 0);
  assert.equal(row.bannedUntil, 0);

  assert.equal(lease.release({ outcome: 'done' }), true);
});

test('acquirePreferredLease honors preferred ordering and exclusion', () => {
  const selector = makeSelector({
    walletApi: {
      getSpvNodeSnapshot() {
        return {
          connected: [],
          candidates: [
            { rank: 1, endpoint: 'n1:8333', score: 90 },
            { rank: 2, endpoint: 'n2:8333', score: 80 },
            { rank: 3, endpoint: 'n3:8333', score: 70 },
          ],
        };
      },
    },
  });
  selector.importStats({
    'n1:8333': { score: 90, successCount: 10, failCount: 0, consecutiveFails: 0, lastSuccessAt: 100, updatedAt: 100 },
    'n2:8333': { score: 80, successCount: 9, failCount: 0, consecutiveFails: 0, lastSuccessAt: 90, updatedAt: 90 },
    'n3:8333': { score: 70, successCount: 8, failCount: 0, consecutiveFails: 0, lastSuccessAt: 80, updatedAt: 80 },
  });

  const lease = selector.acquirePreferredLease({
    preferred: ['n3:8333', 'n2:8333'],
    exclude: ['n2:8333'],
    purpose: 'sync_block',
    mode: 'fresh',
  });
  assert.ok(lease);
  assert.equal(lease.node, 'n3:8333');
  assert.equal(lease.release({ outcome: 'done' }), true);
});
