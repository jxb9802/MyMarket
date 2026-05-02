#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const wallet = require('../wallet');
const p2pNodeRuntime = require('../p2p_node_runtime');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.BSV_MARKET_DATA_DIR
  ? path.resolve(process.env.BSV_MARKET_DATA_DIR)
  : path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

function parseArgs(argv) {
  const out = {
    height: 0,
    hash: '',
    nodes: [],
    connectTimeoutMs: 10000,
    getBlockTimeoutMs: 20000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    const next = String(argv[i + 1] || '');
    if (arg === '--height') {
      out.height = Math.max(0, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--hash') {
      out.hash = next.trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--nodes') {
      out.nodes = next.split(',').map((x) => x.trim()).filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === '--connect-timeout-ms') {
      out.connectTimeoutMs = Math.max(1000, Number(next || 10000));
      i += 1;
      continue;
    }
    if (arg === '--getblock-timeout-ms') {
      out.getBlockTimeoutMs = Math.max(1000, Number(next || 20000));
      i += 1;
      continue;
    }
  }
  return out;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function resolveHashFromState(height) {
  const state = readJson(STATE_FILE, {});
  const cache = state?.sync?.p2pHeightHashCache;
  if (!cache || typeof cache !== 'object') return '';
  return String(cache[String(height)] || '').trim().toLowerCase();
}

async function probeNode(node, blockHash, connectTimeoutMs, getBlockTimeoutMs) {
  const startedAt = Date.now();
  try {
    return await p2pNodeRuntime.withFreshPeer(
      wallet.getWalletP2PNodeSelector(),
      {
        node,
        purpose: 'sync_block',
        mode: 'fresh',
        connectTimeoutMs,
      },
      async (peer, session) => {
        const blockStartedAt = Date.now();
        const block = await p2pNodeRuntime.withTimeout(peer.getBlock(blockHash), getBlockTimeoutMs, `getblock timeout: ${node}`);
        const txCount = Array.isArray(block?.txs) ? block.txs.length : (Array.isArray(block?.transactions) ? block.transactions.length : 0);
        await session.reportSuccess({ latencyMs: Date.now() - startedAt, purpose: 'sync_block' });
        return {
          node,
          ok: true,
          connectElapsedMs: Number(session.connectElapsedMs || 0),
          getBlockElapsedMs: Date.now() - blockStartedAt,
          totalElapsedMs: Date.now() - startedAt,
          txCount,
        };
      },
    );
  } catch (err) {
    return {
      node,
      ok: false,
      connectElapsedMs: 0,
      totalElapsedMs: Date.now() - startedAt,
      error: String(err?.message || 'probe failed'),
    };
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const blockHash = args.hash || resolveHashFromState(args.height);
  if (!args.nodes.length) {
    throw new Error('missing --nodes endpoint1,endpoint2');
  }
  if (!/^[0-9a-f]{64}$/i.test(blockHash)) {
    throw new Error(`unable to resolve block hash for height=${args.height}`);
  }
  const results = [];
  for (const node of args.nodes) {
    results.push(await probeNode(node, blockHash, args.connectTimeoutMs, args.getBlockTimeoutMs));
  }
  const summary = {
    height: args.height || null,
    hash: blockHash,
    connectTimeoutMs: args.connectTimeoutMs,
    getBlockTimeoutMs: args.getBlockTimeoutMs,
    okCount: results.filter((x) => x.ok).length,
    failCount: results.filter((x) => !x.ok).length,
    results,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((err) => {
  process.stderr.write(`${String(err?.message || err)}\n`);
  process.exit(1);
});
