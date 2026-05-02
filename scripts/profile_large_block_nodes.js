#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_NODES_FILE = path.join(ROOT, 'spv_nodes.txt');
const DEFAULT_CAPABILITIES_FILE = path.join(ROOT, 'data', 'p2p_node_capabilities.json');
const DEFAULT_RESULTS_FILE = path.join(ROOT, 'data', 'p2p_large_block_probe_results.json');
const DEFAULT_TEST_SCRIPT = path.join(ROOT, 'scripts', 'test_large_getblock.js');

function parseArgs(argv) {
  const out = {
    nodesFile: DEFAULT_NODES_FILE,
    capabilitiesFile: DEFAULT_CAPABILITIES_FILE,
    resultsFile: DEFAULT_RESULTS_FILE,
    testScript: DEFAULT_TEST_SCRIPT,
    blockHash: '',
    blockHeight: 0,
    probeDurationMs: 30000,
    connectTimeoutMs: 15000,
    getBlockTimeoutMs: 900000,
    memoryLogIntervalMs: 5000,
    maxOldSpaceMb: 768,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    const next = String(argv[i + 1] || '');
    if (arg === '--nodes-file') {
      out.nodesFile = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === '--capabilities-file') {
      out.capabilitiesFile = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === '--results-file') {
      out.resultsFile = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === '--test-script') {
      out.testScript = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === '--hash') {
      out.blockHash = next.trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--height') {
      out.blockHeight = Math.max(0, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--probe-duration-ms') {
      out.probeDurationMs = Math.max(5000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--connect-timeout-ms') {
      out.connectTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--getblock-timeout-ms') {
      out.getBlockTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--memory-log-interval-ms') {
      out.memoryLogIntervalMs = Math.max(1000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--max-old-space-mb') {
      out.maxOldSpaceMb = Math.max(128, Number(next || 0));
      i += 1;
      continue;
    }
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function loadNodes(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function summarizeThresholdTags(maxBytesRead) {
  const tags = [];
  const gib = maxBytesRead / (1024 ** 3);
  if (gib >= 0.5) tags.push('large_block_probe_ge_0_5gib');
  if (gib >= 1) tags.push('large_block_probe_ge_1gib');
  if (gib >= 2) tags.push('large_block_probe_ge_2gib');
  if (gib >= 3) tags.push('large_block_probe_ge_3gib');
  if (gib >= 4) tags.push('large_block_probe_ge_4gib');
  return tags;
}

async function runProbeForNode(options, node) {
  return new Promise((resolve) => {
    const label = `profile_${node.replace(/[:.]/g, '_')}`;
    const args = [
      `--max-old-space-size=${options.maxOldSpaceMb}`,
      options.testScript,
      '--node', node,
      '--hash', options.blockHash,
      '--connect-timeout-ms', String(options.connectTimeoutMs),
      '--getblock-timeout-ms', String(options.getBlockTimeoutMs),
      '--memory-log-interval-ms', String(options.memoryLogIntervalMs),
      '--label', label,
    ];
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const state = {
      node,
      label,
      startedAt: nowIso(),
      connected: false,
      connectElapsedMs: 0,
      firstDataElapsedMs: 0,
      maxBytesRead: 0,
      maxExternalMb: 0,
      maxRssMb: 0,
      completed: false,
      failed: false,
      failure: '',
      exitCode: null,
      signal: '',
      lastElapsedMs: 0,
      lines: 0,
    };

    const handleLine = (line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed) return;
      state.lines += 1;
      let row = null;
      try {
        row = JSON.parse(trimmed);
      } catch (_) {
        return;
      }
      const rssMb = Number(row.rssMb || 0);
      const externalMb = Number(row.externalMb || 0);
      state.maxRssMb = Math.max(state.maxRssMb, rssMb);
      state.maxExternalMb = Math.max(state.maxExternalMb, externalMb);
      if (row.event === 'large_getblock_test_connected') {
        state.connected = true;
        state.connectElapsedMs = Number(row.connectElapsedMs || 0);
      }
      if (row.event === 'large_getblock_test_traffic') {
        state.maxBytesRead = Math.max(state.maxBytesRead, Number(row.socketBytesRead || 0));
        state.lastElapsedMs = Math.max(state.lastElapsedMs, Number(row.elapsedMs || 0));
        if (!state.firstDataElapsedMs && Number(row.firstDataElapsedMs || 0) > 0) {
          state.firstDataElapsedMs = Number(row.firstDataElapsedMs || 0);
        }
      }
      if (row.event === 'large_getblock_test_completed') {
        state.completed = true;
        state.maxBytesRead = Math.max(state.maxBytesRead, Number(row.socketBytesRead || 0));
        state.lastElapsedMs = Math.max(state.lastElapsedMs, Number(row.elapsedMs || 0));
      }
      if (row.event === 'large_getblock_test_failed') {
        state.failed = true;
        state.failure = String(row.error || '');
        state.maxBytesRead = Math.max(state.maxBytesRead, Number(row.socketBytesRead || 0));
        state.lastElapsedMs = Math.max(state.lastElapsedMs, Number(row.elapsedMs || 0));
      }
    };

    child.stdout.on('data', (chunk) => {
      String(chunk || '').split(/\r?\n/).forEach(handleLine);
    });
    child.stderr.on('data', (chunk) => {
      String(chunk || '').split(/\r?\n/).forEach(handleLine);
    });

    const killTimer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch (_) {}
    }, options.probeDurationMs);

    child.on('close', (code, signal) => {
      clearTimeout(killTimer);
      state.exitCode = Number.isInteger(code) ? code : null;
      state.signal = String(signal || '');
      state.finishedAt = nowIso();
      state.maxGiBRead = Number((state.maxBytesRead / (1024 ** 3)).toFixed(3));
      resolve(state);
    });
  });
}

function updateCapabilities(existing, probe, options) {
  const next = { ...(existing || {}) };
  const prev = next[probe.node] && typeof next[probe.node] === 'object' ? next[probe.node] : {};
  const prevTags = Array.isArray(prev.tags) ? prev.tags.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const thresholdTags = summarizeThresholdTags(probe.maxBytesRead);
  const mergedTags = Array.from(new Set([
    ...prevTags.filter((tag) => !tag.startsWith('large_block_probe_ge_')),
    ...thresholdTags,
  ]));
  next[probe.node] = {
    ...prev,
    tags: mergedTags,
    notes: `Sequential large-block probe window observed max download for the 4GB candidate block over ${Math.round(options.probeDurationMs / 1000)}s.`,
    updatedAt: probe.finishedAt,
    evidence: {
      blockHeight: options.blockHeight,
      blockHash: options.blockHash,
      bytesRead: probe.maxBytesRead,
      observedAt: probe.finishedAt,
    },
    largeBlockProbe: {
      connected: Boolean(probe.connected),
      connectElapsedMs: Number(probe.connectElapsedMs || 0),
      firstDataElapsedMs: Number(probe.firstDataElapsedMs || 0),
      probeDurationMs: Number(options.probeDurationMs || 0),
      maxBytesRead: Number(probe.maxBytesRead || 0),
      maxGiBRead: Number(probe.maxGiBRead || 0),
      maxRssMb: Number(probe.maxRssMb || 0),
      maxExternalMb: Number(probe.maxExternalMb || 0),
      completed: Boolean(probe.completed),
      failed: Boolean(probe.failed),
      failure: String(probe.failure || ''),
      exitCode: probe.exitCode,
      signal: String(probe.signal || ''),
      lastElapsedMs: Number(probe.lastElapsedMs || 0),
      testedAt: probe.finishedAt,
    },
  };
  return next;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!/^[0-9a-f]{64}$/i.test(options.blockHash)) {
    throw new Error('missing or invalid --hash');
  }
  if (!options.blockHeight) {
    throw new Error('missing --height');
  }

  const nodes = loadNodes(options.nodesFile);
  const results = [];
  let capabilities = readJson(options.capabilitiesFile, {});

  for (const node of nodes) {
    const probe = await runProbeForNode(options, node);
    results.push(probe);
    capabilities = updateCapabilities(capabilities, probe, options);
    writeJson(options.capabilitiesFile, capabilities);
    writeJson(options.resultsFile, {
      updatedAt: nowIso(),
      blockHeight: options.blockHeight,
      blockHash: options.blockHash,
      probeDurationMs: options.probeDurationMs,
      results,
    });
    process.stdout.write(`${JSON.stringify({
      node,
      maxBytesRead: probe.maxBytesRead,
      maxGiBRead: probe.maxGiBRead,
      connected: probe.connected,
      completed: probe.completed,
      failed: probe.failed,
      failure: probe.failure,
      maxRssMb: probe.maxRssMb,
      maxExternalMb: probe.maxExternalMb,
    })}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err?.message || err)}\n`);
  process.exit(1);
});
