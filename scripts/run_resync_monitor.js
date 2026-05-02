#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const BASE_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(BASE_DIR, 'data');
const ENV_FILE = path.join(BASE_DIR, '.env.market');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const RECEIPTS_FILE = path.join(DATA_DIR, 'p2p_sync_receipts.json');
const COMMAND_QUEUE_FILE = path.join(DATA_DIR, 'command_queue.json');
const JOB_STATE_FILE = path.join(DATA_DIR, 'job_state.json');
const WALLET_INDEX_STATE_FILE = path.join(DATA_DIR, 'wallet_index_state.json');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const WALLET_STATE_FILE = path.join(DATA_DIR, 'wallet_state.json');
const TX_CONTEXTS_FILE = path.join(DATA_DIR, 'tx_contexts.json');
const REPORT_DIR = path.join(DATA_DIR, 'diagnostics');
const DEFAULT_TIMEOUT_SEC = 180;
const DEFAULT_POLL_MS = 2000;

function readEnvNumber(key, fallback = 0) {
  try {
    const raw = fs.readFileSync(ENV_FILE, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      if (!trimmed.startsWith(`${key}=`)) continue;
      const value = Number(trimmed.split('=').slice(1).join('=').trim());
      if (Number.isFinite(value)) return value;
    }
  } catch (_) {}
  return fallback;
}

function readEnvPort() {
  return readEnvNumber('BSV_MARKET_PORT', 8091) || 8091;
}

function parseArgs(argv) {
  const result = {
    startHeight: null,
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    pollMs: DEFAULT_POLL_MS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (arg === '--height' || arg === '-h') {
      result.startHeight = Number(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (arg === '--timeout-sec') {
      result.timeoutSec = Math.max(30, Number(argv[i + 1] || DEFAULT_TIMEOUT_SEC));
      i += 1;
      continue;
    }
    if (arg === '--poll-ms') {
      result.pollMs = Math.max(500, Number(argv[i + 1] || DEFAULT_POLL_MS));
      i += 1;
    }
  }
  return result;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function fileInfo(file) {
  try {
    const stat = fs.statSync(file);
    return {
      exists: true,
      size: stat.size,
      mtime: stat.mtime.toISOString(),
    };
  } catch (_) {
    return {
      exists: false,
      size: 0,
      mtime: null,
    };
  }
}

function snapshotDataArtifacts() {
  return {
    commandQueue: {
      file: fileInfo(COMMAND_QUEUE_FILE),
      data: readJson(COMMAND_QUEUE_FILE, null),
    },
    jobState: {
      file: fileInfo(JOB_STATE_FILE),
      data: readJson(JOB_STATE_FILE, null),
    },
    walletIndexState: {
      file: fileInfo(WALLET_INDEX_STATE_FILE),
      data: readJson(WALLET_INDEX_STATE_FILE, null),
    },
    walletCache: {
      file: fileInfo(CACHE_FILE),
      data: readJson(CACHE_FILE, null),
    },
    walletState: {
      file: fileInfo(WALLET_STATE_FILE),
      data: readJson(WALLET_STATE_FILE, null),
    },
    txContexts: {
      file: fileInfo(TX_CONTEXTS_FILE),
      sample: (() => {
        const data = readJson(TX_CONTEXTS_FILE, null);
        if (!data || typeof data !== 'object') return null;
        const keys = Object.keys(data).slice(0, 3);
        return {
          keyCount: Object.keys(data).length,
          sampleKeys: keys,
        };
      })(),
    },
  };
}

function readWalletLocalIndexStats() {
  try {
    const wallet = require(path.join(BASE_DIR, 'wallet'));
    if (typeof wallet.getLocalIndexStats !== 'function') return null;
    return wallet.getLocalIndexStats();
  } catch (err) {
    return {
      error: String(err?.message || err),
    };
  }
}

function httpJson({ port, pathName, method = 'GET', body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      path: pathName,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk.toString('utf8'); });
      res.on('end', () => {
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          raw,
          json,
        });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`timeout ${method} ${pathName}`)));
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCtl(args) {
  const result = spawnSync(path.join(BASE_DIR, 'market_ctl.sh'), args, {
    cwd: BASE_DIR,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`market_ctl.sh ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return {
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

function backupFile(file, suffix) {
  if (!fs.existsSync(file)) return null;
  const backup = `${file}.${suffix}.bak`;
  fs.copyFileSync(file, backup);
  return backup;
}

function resetSyncState(startHeight) {
  const state = readJson(STATE_FILE, null);
  if (!state || typeof state !== 'object') throw new Error('state.json missing or invalid');
  const bootstrapHeight = Number(state?.sync?.bootstrapHeight || 0);
  const start = Math.max(bootstrapHeight, Math.floor(Number(startHeight || bootstrapHeight)));
  const rewindHeight = Math.max(bootstrapHeight - 1, start - 1);
  const currentTip = Math.max(
    Number(state?.sync?.networkHeight || 0),
    Number(state?.sync?.p2pTipHeight || 0),
    Number(state?.sync?.p2pHeaderCursorHeight || 0),
    rewindHeight,
  );
  state.sync.online = false;
  state.sync.localHeight = rewindHeight;
  state.sync.fixedSyncLastHeight = rewindHeight;
  state.sync.scannedFrom = bootstrapHeight;
  state.sync.networkHeight = currentTip;
  state.sync.emptyBackfillTried = false;
  state.sync.manualQuickstartPending = true;
  state.sync.p2pGapHeights = [];
  writeJson(STATE_FILE, state);

  const receipts = readJson(RECEIPTS_FILE, { version: 1, committedHeight: bootstrapHeight - 1, entries: {} });
  const trimmedEntries = {};
  Object.entries(receipts?.entries || {}).forEach(([height, row]) => {
    const h = Number(height);
    if (!Number.isFinite(h) || h > rewindHeight) return;
    trimmedEntries[String(Math.floor(h))] = row;
  });
  writeJson(RECEIPTS_FILE, {
    version: 1,
    committedHeight: rewindHeight,
    entries: trimmedEntries,
  });

  writeJson(COMMAND_QUEUE_FILE, {
    version: 1,
    nextSeq: 1,
    commands: [],
  });
  writeJson(JOB_STATE_FILE, {
    version: 1,
    currentJob: null,
    recentJobs: [],
  });
  if (fs.existsSync(WALLET_INDEX_STATE_FILE)) {
    fs.unlinkSync(WALLET_INDEX_STATE_FILE);
  }
  return {
    bootstrapHeight,
    startHeight: start,
    rewindHeight,
    tipHint: currentTip,
  };
}

async function waitForHealthy(port, timeoutSec) {
  const deadline = Date.now() + (timeoutSec * 1000);
  while (Date.now() < deadline) {
    try {
      const response = await httpJson({ port, pathName: '/api/state' });
      if (response.statusCode >= 200 && response.statusCode < 300 && response.json?.success) return response.json;
    } catch (_) {}
    await sleep(1000);
  }
  throw new Error('server did not become healthy in time');
}

async function waitForSyncCompletion(port, targetHeight, timeoutSec, pollMs) {
  const deadline = Date.now() + (timeoutSec * 1000);
  const samples = [];
  while (Date.now() < deadline) {
    const syncStatus = await httpJson({ port, pathName: '/api/sync/status' });
    const stateStatus = await httpJson({ port, pathName: '/api/state' });
    const sync = syncStatus.json?.sync || {};
    const publicState = stateStatus.json?.state || {};
    const jobState = syncStatus.json?.jobState || {};
    const snapshot = {
      ts: new Date().toISOString(),
      localHeight: Number(sync.localHeight || publicState?.sync?.localHeight || 0),
      networkHeight: Number(sync.networkHeight || publicState?.sync?.networkHeight || 0),
      lag: Number(sync.lag || 0),
      mode: String(sync.mode || ''),
      online: Boolean(sync.online),
      jobCurrent: jobState?.currentJob || null,
      jobRecent: Array.isArray(jobState?.recentJobs) ? jobState.recentJobs.slice(-3) : [],
    };
    samples.push(snapshot);
    if (snapshot.localHeight >= targetHeight && snapshot.online) {
      return { completed: true, samples };
    }
    await sleep(pollMs);
  }
  return { completed: false, samples };
}

async function triggerSync(port) {
  const result = await httpJson({ port, pathName: '/api/catalog/sync', method: 'POST', body: {} });
  if (result.statusCode < 200 || result.statusCode >= 300 || !result.json?.success) {
    throw new Error(`catalog sync trigger failed: http ${result.statusCode}`);
  }
  return result.json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const port = readEnvPort();
  const stateBefore = readJson(STATE_FILE, null);
  const defaultHeight = Math.max(
    0,
    Number(readEnvNumber('BSV_MARKET_BOOTSTRAP_HEIGHT', 0)),
    Number(stateBefore?.sync?.bootstrapHeight || 0),
  );
  const startHeight = Number.isFinite(Number(args.startHeight)) ? Number(args.startHeight) : defaultHeight;
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const backupSuffix = `resync-monitor-${stamp}`;
  const backups = {
    state: backupFile(STATE_FILE, backupSuffix),
    receipts: backupFile(RECEIPTS_FILE, backupSuffix),
  };

  const reset = resetSyncState(startHeight);
  const beforeArtifacts = snapshotDataArtifacts();
  const ctlRestart = runCtl(['restart']);
  await waitForHealthy(port, 30);
  const trigger = await triggerSync(port);
  const observedTargetHeight = Math.max(
    Number(trigger?.state?.sync?.networkHeight || 0),
    Number(readJson(STATE_FILE, null)?.sync?.networkHeight || 0),
  );
  const monitor = await waitForSyncCompletion(port, observedTargetHeight, args.timeoutSec, args.pollMs);
  const finalState = readJson(STATE_FILE, null);
  const finalArtifacts = snapshotDataArtifacts();
  const localIndexStats = readWalletLocalIndexStats();
  const walletCache = finalArtifacts.walletCache.data || {};
  const report = {
    generatedAt: new Date().toISOString(),
    port,
    startHeightAssumed: startHeight,
    reset,
    backups,
    ctlRestart,
    trigger: {
      queuedSync: Boolean(trigger?.queuedSync),
      commandId: String(trigger?.commandId || ''),
      localHeight: Number(trigger?.state?.sync?.localHeight || 0),
      networkHeight: Number(trigger?.state?.sync?.networkHeight || 0),
    },
    completion: {
      completed: monitor.completed,
      targetHeight: observedTargetHeight,
      finalLocalHeight: Number(finalState?.sync?.localHeight || 0),
      finalNetworkHeight: Number(finalState?.sync?.networkHeight || 0),
      finalOnline: Boolean(finalState?.sync?.online),
      sampleCount: monitor.samples.length,
      lastSample: monitor.samples.slice(-1)[0] || null,
    },
    designArtifacts: {
      commandQueueGenerated: Boolean(finalArtifacts.commandQueue.file.exists),
      jobStateGenerated: Boolean(finalArtifacts.jobState.file.exists),
      walletIndexStateGenerated: Boolean(finalArtifacts.walletIndexState.file.exists),
      walletCacheUpdated: Boolean(finalArtifacts.walletCache.file.exists),
      walletStatePresent: Boolean(finalArtifacts.walletState.file.exists),
      txContextsPresent: Boolean(finalArtifacts.txContexts.file.exists),
    },
    commandQueue: finalArtifacts.commandQueue.data,
    jobState: finalArtifacts.jobState.data,
    walletIndexState: finalArtifacts.walletIndexState.data,
    localIndexStats,
    walletCacheSummary: walletCache ? {
      confirmed: Number(walletCache.confirmed || 0),
      unconfirmed: Number(walletCache.unconfirmed || 0),
      total: Number(walletCache.total || 0),
      txCount: Array.isArray(walletCache.txids) ? walletCache.txids.length : 0,
      updatedAt: walletCache.updatedAt || null,
    } : null,
    indexRequirements: {
      utxoGenerated: Number(localIndexStats?.utxoCount || 0) > 0,
      txContextsGenerated: Number(localIndexStats?.contextTxCount || 0) > 0,
      walletContextReady: Number(localIndexStats?.contextReadyCount || 0) > 0,
      beefReady: Number(localIndexStats?.beefReadyUtxoCount || 0) > 0,
      sendPreflightStatus: localIndexStats?.sendPreflightStatus || null,
    },
    txContextsSummary: finalArtifacts.txContexts.sample,
    monitorSamplesTail: monitor.samples.slice(-20),
  };
  const reportFile = path.join(REPORT_DIR, `resync_monitor_${stamp}.json`);
  writeJson(reportFile, report);
  process.stdout.write(`${JSON.stringify({ reportFile, ...report }, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
