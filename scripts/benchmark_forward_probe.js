#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');

function makeExpressStub() {
  const app = {
    use() { return app; },
    get() { return app; },
    post() { return app; },
    delete() { return app; },
    put() { return app; },
    listen() { return { close() {} }; },
  };
  const express = () => app;
  express.json = () => (req, res, next) => next && next();
  express.static = () => (req, res, next) => next && next();
  express.urlencoded = () => (req, res, next) => next && next();
  return express;
}

function makeDbStub() {
  return function Database() {
    return {
      prepare() {
        return {
          run() {},
          get() { return undefined; },
          all() { return []; },
        };
      },
      exec() {},
      pragma() {},
      close() {},
      transaction(fn) {
        return (...args) => fn(...args);
      },
    };
  };
}

function parseArgs(argv) {
  const options = {
    forceStalled: true,
    nodes: 8,
    bootstrapHeight: null,
    cursorHeight: null,
    cursorHash: '',
    staleMs: 25 * 60 * 1000,
    showAccepted: 12,
    nodeList: [],
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    const next = argv[i + 1];
    if (arg === '--no-force-stalled') {
      options.forceStalled = false;
    } else if (arg === '--nodes' && next) {
      options.nodes = Math.max(1, Number(next));
      i += 1;
    } else if (arg === '--bootstrap-height' && next) {
      options.bootstrapHeight = Number(next);
      i += 1;
    } else if (arg === '--cursor-height' && next) {
      options.cursorHeight = Number(next);
      i += 1;
    } else if (arg === '--cursor-hash' && next) {
      options.cursorHash = String(next).trim().toLowerCase();
      i += 1;
    } else if (arg === '--stale-ms' && next) {
      options.staleMs = Math.max(60_000, Number(next));
      i += 1;
    } else if (arg === '--show-accepted' && next) {
      options.showAccepted = Math.max(0, Number(next));
      i += 1;
    } else if (arg === '--node' && next) {
      options.nodeList.push(String(next).trim());
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/benchmark_forward_probe.js [options]

Options:
  --nodes N               Use the top N candidate nodes from current state (default: 8)
  --node HOST:PORT        Add a specific node; may be repeated
  --bootstrap-height H    Override bootstrap height in in-memory state
  --cursor-height H       Override current p2p header cursor height
  --cursor-hash HASH      Override current p2p header cursor hash
  --stale-ms MS           Force last advance/probe to look this old (default: 1500000)
  --no-force-stalled      Use current state timestamps instead of forcing a stale condition
  --show-accepted N       Show first N accepted heights from result (default: 12)
  --help                  Show this help
`.trim());
}

function buildSandbox(repoRoot) {
  const fakeProcess = Object.assign({}, process, {
    env: {
      ...process.env,
      BSV_MARKET_PORT: '0',
    },
    exit: () => {},
    on: () => {},
    once: () => {},
    off: () => {},
    removeListener: () => {},
  });
  const sandbox = {
    console,
    process: fakeProcess,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    URLSearchParams,
    AbortController,
    fetch,
    __dirname: repoRoot,
    __filename: path.join(repoRoot, 'server_market.js'),
    module: { exports: {} },
    exports: {},
    require: (name) => {
      if (name === 'express') return makeExpressStub();
      if (name === 'multer') return () => ({ single: () => (req, res, next) => next && next() });
      if (name === 'better-sqlite3') return makeDbStub();
      if (name === 'mime-types') return { lookup: () => 'application/octet-stream' };
      if (name === './wallet') return require(path.join(repoRoot, 'wallet.js'));
      if (name === './wallet.js') return require(path.join(repoRoot, 'wallet.js'));
      if (name === './order_state_machine') return require(path.join(repoRoot, 'order_state_machine.js'));
      if (name === './order_state_machine.js') return require(path.join(repoRoot, 'order_state_machine.js'));
      if (name === './p2p_height_guard') return require(path.join(repoRoot, 'p2p_height_guard.js'));
      if (name === './p2p_height_guard.js') return require(path.join(repoRoot, 'p2p_height_guard.js'));
      if (name === './block_headers_service') return require(path.join(repoRoot, 'block_headers_service.js'));
      if (name === './block_headers_service.js') return require(path.join(repoRoot, 'block_headers_service.js'));
      return require(name);
    },
  };
  sandbox.global = sandbox;
  return sandbox;
}

function stageDurationsFromDebug(events) {
  const batches = events.filter((event) => event && event.event === 'p2p_headers_batch');
  const byNode = new Map();
  batches.forEach((event) => {
    const node = String(event.node || '');
    if (!node) return;
    if (!byNode.has(node)) byNode.set(node, { calls: 0, empty: 0, errors: 0 });
    const row = byNode.get(node);
    row.calls += 1;
    if (Number(event.count || 0) === 0) row.empty += 1;
    if (String(event.error || '').trim()) row.errors += 1;
  });
  return {
    batchCount: batches.length,
    byNode: Array.from(byNode.entries()).map(([node, stats]) => ({ node, ...stats })),
    quorumRejects: events.filter((event) => event && event.event === 'p2p_headers_quorum_reject').length,
    advanced: events.find((event) => event && event.event === 'p2p_forward_probe_advanced') || null,
    stopped: events.find((event) => event && event.event === 'p2p_forward_probe_stopped') || null,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const repoRoot = path.resolve(__dirname, '..');
  const code = fs.readFileSync(path.join(repoRoot, 'server_market.js'), 'utf8');
  const sandbox = buildSandbox(repoRoot);
  vm.createContext(sandbox);
  vm.runInContext(`${code}
module.exports = {
  probeForwardP2PHeadersWhenStalled,
  loadState,
  getP2PSyncNodeCandidates,
  getP2PHashAtHeight,
};`, sandbox, { filename: 'server_market.js' });

  const {
    probeForwardP2PHeadersWhenStalled,
    loadState,
    getP2PSyncNodeCandidates,
    getP2PHashAtHeight,
  } = sandbox.module.exports;

  const debugEvents = [];
  sandbox.appendMarketDebug = (event, payload = {}) => {
    debugEvents.push({
      ts: new Date().toISOString(),
      event,
      ...(payload || {}),
    });
  };

  const state = loadState();
  if (options.bootstrapHeight !== null) state.sync.bootstrapHeight = Number(options.bootstrapHeight);
  if (options.cursorHeight !== null) state.sync.p2pHeaderCursorHeight = Number(options.cursorHeight);
  if (options.cursorHash) state.sync.p2pHeaderCursorHash = String(options.cursorHash).trim().toLowerCase();
  if (!String(state?.sync?.p2pHeaderCursorHash || '').trim()) {
    const cursorHeight = Number(state?.sync?.p2pHeaderCursorHeight || 0);
    const cachedHash = getP2PHashAtHeight(state, cursorHeight);
    if (cachedHash) state.sync.p2pHeaderCursorHash = cachedHash;
  }

  const nowIso = new Date().toISOString();
  if (options.forceStalled) {
    const staleIso = new Date(Date.now() - Number(options.staleMs || 0)).toISOString();
    state.sync.lastP2PAdvanceAt = staleIso;
    state.sync.lastP2PForwardProbeAt = staleIso;
    state.sync.lastP2PGoodNodes = Math.max(
      Number(state?.sync?.lastP2PGoodNodes || 0),
      Math.max(4, Number(options.nodes || 0), options.nodeList.length),
    );
  } else {
    state.sync.lastP2PAdvanceAt = String(state?.sync?.lastP2PAdvanceAt || nowIso);
    state.sync.lastP2PForwardProbeAt = String(state?.sync?.lastP2PForwardProbeAt || nowIso);
  }

  const candidates = options.nodeList.length
    ? options.nodeList
    : getP2PSyncNodeCandidates().slice(0, Math.max(1, Number(options.nodes || 1)));

  const startedAt = performance.now();
  const result = await probeForwardP2PHeadersWhenStalled(state, candidates, {});
  const elapsedMs = Math.round(performance.now() - startedAt);
  const summary = stageDurationsFromDebug(debugEvents);

  const output = {
    elapsedMs,
    nodeCount: candidates.length,
    nodes: candidates,
    cursorBefore: {
      height: Number(options.cursorHeight !== null ? options.cursorHeight : state?.sync?.p2pHeaderCursorHeight || 0),
      hash: String(options.cursorHash || state?.sync?.p2pHeaderCursorHash || ''),
    },
    forceStalled: options.forceStalled,
    staleMs: options.forceStalled ? Number(options.staleMs || 0) : null,
    result: {
      ...result,
      accepted: Array.isArray(result?.accepted) ? result.accepted.slice(0, Math.max(0, Number(options.showAccepted || 0))) : [],
    },
    debugSummary: summary,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({
    error: String(err?.message || err),
    stack: String(err?.stack || ''),
  }, null, 2));
  process.exitCode = 1;
});
