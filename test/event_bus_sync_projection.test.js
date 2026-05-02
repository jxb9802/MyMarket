const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

test('event bus appends sync facts and sync projection writer builds command/job state', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-event-bus-sync-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
  };

  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;

  const marketDb = loadFresh('../market_db');
  const syncDomain = loadFresh('../sync_domain');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();
  await syncDomain.startSyncDomain({
    adapters: {
      getBhsSnapshot: () => ({ ok: true, tipHeight: 1000, tipHash: '00'.repeat(32), updatedAt: '2026-04-04T15:00:00.000Z' }),
      getIndependentSyncSnapshot: () => ({ phase: '', updatedAt: '', localHeight: 0, targetHeight: 0 }),
      getConnectedNodeSnapshot: () => ({ connectedCount: 0, activeSyncNodeCount: 0, activeSyncNodeList: [], nodePool: [] }),
      getLagPolicy: (syncState, bhs) => ({
        lag: Math.max(0, Number(bhs?.tipHeight || 0) - Number(syncState?.localHeight || 0)),
        mode: 'catchup_sync',
        syncNodeBudget: 2,
        walletListenerEnabled: true,
        walletListenerTarget: 8,
        walletSendEnabled: true,
        walletReason: 'test',
      }),
      buildAutoSyncCommandPayload: () => ({
        payload: { source: 'test', options: {} },
        options: { dedupePending: true },
      }),
    },
  });

  const command = await syncDomain.enqueueCommand('wallet_send', {
    to: '1test',
    amountBsv: 0.25,
  }, { dedupePending: false });

  const claimed = await syncDomain.claimNextCommand('steward-test');
  assert.equal(claimed.id, command.id);
  assert.equal(claimed.status, 'claimed');

  await syncDomain.updateJobState({
    jobId: command.id,
    jobType: 'wallet_send',
    status: 'running',
    stage: 'wallet_send_signed',
    progressCurrent: 2,
    progressTotal: 4,
    startedAt: '2026-04-04T15:00:00.000Z',
    workerId: 'steward-test',
  });

  await syncDomain.markCommandFinished(command.id, 'done', {
    result: { txid: 'tx-1', feeSat: 42 },
  });

  await syncDomain.updateJobState({
    jobId: command.id,
    jobType: 'wallet_send',
    status: 'done',
    stage: 'done',
    progressCurrent: 4,
    progressTotal: 4,
    startedAt: '2026-04-04T15:00:00.000Z',
    workerId: 'steward-test',
    finishedAt: '2026-04-04T15:00:05.000Z',
  }, { finalize: true });

  const queueState = syncDomain.getCommandQueueState();
  assert.equal(queueState.commands.length, 1);
  assert.equal(queueState.commands[0].id, command.id);
  assert.equal(queueState.commands[0].status, 'done');
  assert.equal(queueState.commands[0].result.txid, 'tx-1');

  const jobState = syncDomain.getJobState();
  assert.equal(jobState.currentJob, null);
  assert.equal(jobState.recentJobs.length, 1);
  assert.equal(jobState.recentJobs[0].jobId, command.id);
  assert.equal(jobState.recentJobs[0].status, 'done');
  assert.equal(jobState.recentJobs[0].stage, 'done');

  const status = syncDomain.getSyncStatus({ confirm: true });
  assert.equal(status.commandQueue.pendingCount, 0);
  assert.equal(status.commandQueue.claimedCount, 0);
  assert.equal(status.jobState.currentJob, null);
  assert.equal(status.sync.highestBlock, 1000);
});
