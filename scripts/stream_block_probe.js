#!/usr/bin/env node

const {
  formatMem,
  streamBlockFromNode,
} = require('../lib/stream_block_reader');

function parseArgs(argv) {
  const out = {
    node: '',
    hash: '',
    connectTimeoutMs: 8000,
    idleTimeoutMs: 10000,
    hardTimeoutMs: 1800000,
    memoryLogIntervalMs: 5000,
    maxEvents: 100,
    dumpEvents: false,
    validate: false,
    acceptLegacyBmmkt1: false,
    logEveryNChunks: 1,
    label: 'stream_block_probe',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    const next = String(argv[i + 1] || '');
    if (arg === '--node') {
      out.node = next.trim();
      i += 1;
      continue;
    }
    if (arg === '--hash') {
      out.hash = next.trim().toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--connect-timeout-ms') {
      out.connectTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--idle-timeout-ms') {
      out.idleTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--hard-timeout-ms') {
      out.hardTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--memory-log-interval-ms') {
      out.memoryLogIntervalMs = Math.max(1000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--max-events') {
      out.maxEvents = Math.max(1, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--dump-events') {
      out.dumpEvents = true;
      continue;
    }
    if (arg === '--validate') {
      out.validate = true;
      continue;
    }
    if (arg === '--accept-legacy-bmmkt1') {
      out.acceptLegacyBmmkt1 = true;
      continue;
    }
    if (arg === '--log-every-n-chunks') {
      out.logEveryNChunks = Math.max(0, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--label') {
      out.label = next.trim() || out.label;
      i += 1;
    }
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function log(event, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ts: nowIso(), event, ...extra })}\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.node) throw new Error('missing --node host:port');
  if (!/^[0-9a-f]{64}$/i.test(args.hash)) throw new Error('missing or invalid --hash');

  log('stream_block_probe_started', {
    label: args.label,
    node: args.node,
    hash: args.hash,
    connectTimeoutMs: args.connectTimeoutMs,
    idleTimeoutMs: args.idleTimeoutMs,
    hardTimeoutMs: args.hardTimeoutMs,
    validate: args.validate,
    acceptLegacyBmmkt1: args.acceptLegacyBmmkt1,
    pid: process.pid,
    ...formatMem(),
  });

  try {
    const result = await streamBlockFromNode({
      ...args,
      collectMarkerMatches: true,
      onEvent: log,
    });
    log('stream_block_probe_completed', {
      label: args.label,
      node: args.node,
      ...result,
      events: args.dumpEvents ? result.matchedEvents : undefined,
    });
  } catch (err) {
    log('stream_block_probe_failed', {
      label: args.label,
      ok: false,
      node: args.node,
      requestedHash: args.hash,
      error: String(err?.message || err),
      ...formatMem(),
    });
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err?.message || err)}\n`);
  process.exit(1);
});
