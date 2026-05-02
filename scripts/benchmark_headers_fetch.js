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
    nodes: 8,
    bootstrapHeight: null,
    cursorHeight: null,
    cursorHash: '',
    nodeList: [],
    showBatches: 12,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    const next = argv[i + 1];
    if (arg === '--nodes' && next) {
      options.nodes = Math.max(1, Number(next));
      i += 1;
    } else if (arg === '--node' && next) {
      options.nodeList.push(String(next).trim());
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
    } else if (arg === '--show-batches' && next) {
      options.showBatches = Math.max(0, Number(next));
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
  node scripts/benchmark_headers_fetch.js [options]

Options:
  --nodes N               Use the top N candidate nodes from current state (default: 8)
  --node HOST:PORT        Add a specific node; may be repeated
  --bootstrap-height H    Override bootstrap height in in-memory state
  --cursor-height H       Override current p2p header cursor height
  --cursor-hash HASH      Override current p2p header cursor hash
  --show-batches N        Show first N p2p_headers_batch logs (default: 12)
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

function summarizeBatches(events) {
  const batches = events.filter((event) => event && event.event === 'p2p_headers_batch');
  return batches.map((event) => ({
    node: String(event.node || ''),
    fromHeight: Number(event.fromHeight || 0),
    count: Number(event.count || 0),
    error: String(event.error || ''),
  }));
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
  syncP2PHeadersToTip,
  loadState,
  getP2PSyncNodeCandidates,
  getP2PHashAtHeight,
};`, sandbox, { filename: 'server_market.js' });

  const {
    syncP2PHeadersToTip,
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

  const candidates = options.nodeList.length
    ? options.nodeList
    : getP2PSyncNodeCandidates().slice(0, Math.max(1, Number(options.nodes || 1)));

  const heightToHash = new Map();
  const startedAt = performance.now();
  const result = await syncP2PHeadersToTip(state, candidates, heightToHash, {});
  const elapsedMs = Math.round(performance.now() - startedAt);
  const timing = debugEvents.filter((event) => event && event.event === 'p2p_header_sync_timing').slice(-1)[0] || null;
  const batches = summarizeBatches(debugEvents);

  const output = {
    elapsedMs,
    nodes: candidates,
    cursorHeight: Number(state?.sync?.p2pHeaderCursorHeight || 0),
    cursorHash: String(state?.sync?.p2pHeaderCursorHash || ''),
    result,
    timing,
    batchCount: batches.length,
    batches: batches.slice(0, Math.max(0, Number(options.showBatches || 0))),
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exitCode = 1;
});
