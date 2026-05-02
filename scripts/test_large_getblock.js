#!/usr/bin/env node

const p2pNodeRuntime = require('../p2p_node_runtime');

function parseArgs(argv) {
  const out = {
    node: '',
    hash: '',
    connectTimeoutMs: 15000,
    getBlockTimeoutMs: 600000,
    memoryLogIntervalMs: 5000,
    label: 'large_getblock_test',
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
    if (arg === '--label') {
      out.label = next.trim() || out.label;
      i += 1;
      continue;
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

function formatMem() {
  const mem = process.memoryUsage();
  return {
    rssMb: Number((mem.rss / (1024 * 1024)).toFixed(1)),
    heapUsedMb: Number((mem.heapUsed / (1024 * 1024)).toFixed(1)),
    heapTotalMb: Number((mem.heapTotal / (1024 * 1024)).toFixed(1)),
    externalMb: Number((mem.external / (1024 * 1024)).toFixed(1)),
    arrayBuffersMb: Number(((mem.arrayBuffers || 0) / (1024 * 1024)).toFixed(1)),
  };
}

function getSocketStats(socket) {
  if (!socket) {
    return {
      socketBytesRead: 0,
      socketBytesWritten: 0,
      socketReadableLength: 0,
      socketWritableLength: 0,
    };
  }
  return {
    socketBytesRead: Number(socket.bytesRead || 0),
    socketBytesWritten: Number(socket.bytesWritten || 0),
    socketReadableLength: Number(socket.readableLength || 0),
    socketWritableLength: Number(socket.writableLength || 0),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.node) throw new Error('missing --node host:port');
  if (!/^[0-9a-f]{64}$/i.test(args.hash)) throw new Error('missing or invalid --hash');

  log('large_getblock_test_started', {
    label: args.label,
    node: args.node,
    hash: args.hash,
    connectTimeoutMs: args.connectTimeoutMs,
    getBlockTimeoutMs: args.getBlockTimeoutMs,
    pid: process.pid,
    ...formatMem(),
  });

  const startedAt = Date.now();
  const timer = setInterval(() => {
    log('large_getblock_test_memory', {
      label: args.label,
      elapsedMs: Date.now() - startedAt,
      ...formatMem(),
    });
  }, args.memoryLogIntervalMs);
  timer.unref();

  const session = await p2pNodeRuntime.connectSession(null, {
    node: args.node,
    purpose: 'sync_block',
    mode: 'fresh',
    connectTimeoutMs: args.connectTimeoutMs,
  });

  let trafficTimer = null;
  try {
    const socket = session.peer?.socket || null;
    const trafficState = {
      firstDataAt: 0,
      lastBytesRead: Number(socket?.bytesRead || 0),
      lastBytesWritten: Number(socket?.bytesWritten || 0),
    };
    if (socket && typeof socket.on === 'function') {
      socket.on('data', () => {
        if (!trafficState.firstDataAt) trafficState.firstDataAt = Date.now();
      });
    }

    log('large_getblock_test_connected', {
      label: args.label,
      node: session.node,
      connectElapsedMs: Number(session.connectElapsedMs || 0),
      elapsedMs: Date.now() - startedAt,
      ...getSocketStats(socket),
      ...formatMem(),
    });

    trafficTimer = setInterval(() => {
      const stats = getSocketStats(socket);
      const deltaRead = Math.max(0, stats.socketBytesRead - trafficState.lastBytesRead);
      const deltaWritten = Math.max(0, stats.socketBytesWritten - trafficState.lastBytesWritten);
      trafficState.lastBytesRead = stats.socketBytesRead;
      trafficState.lastBytesWritten = stats.socketBytesWritten;
      log('large_getblock_test_traffic', {
        label: args.label,
        elapsedMs: Date.now() - startedAt,
        firstDataElapsedMs: trafficState.firstDataAt ? (trafficState.firstDataAt - startedAt) : 0,
        deltaReadBytes: deltaRead,
        deltaWrittenBytes: deltaWritten,
        ...stats,
        ...formatMem(),
      });
    }, args.memoryLogIntervalMs);
    trafficTimer.unref();

    const blockStartedAt = Date.now();
    const block = await p2pNodeRuntime.withTimeout(
      session.peer.getBlock(args.hash),
      args.getBlockTimeoutMs,
      `getblock timeout: ${args.node}`,
    );

    const txCount = Array.isArray(block?.txs)
      ? block.txs.length
      : (Array.isArray(block?.transactions) ? block.transactions.length : 0);
    const blockKeys = block && typeof block === 'object' ? Object.keys(block).slice(0, 20) : [];

    await session.reportSuccess({ latencyMs: Date.now() - startedAt, purpose: 'sync_block' });
    log('large_getblock_test_completed', {
      label: args.label,
      node: args.node,
      elapsedMs: Date.now() - startedAt,
      getBlockElapsedMs: Date.now() - blockStartedAt,
      firstDataElapsedMs: trafficState.firstDataAt ? (trafficState.firstDataAt - startedAt) : 0,
      txCount,
      blockKeys,
      ...getSocketStats(socket),
      ...formatMem(),
    });
  } catch (err) {
    await session.reportFailure({ error: String(err?.message || err), purpose: 'sync_block' });
    log('large_getblock_test_failed', {
      label: args.label,
      node: args.node,
      elapsedMs: Date.now() - startedAt,
      error: String(err?.message || err),
      ...getSocketStats(session.peer?.socket || null),
      ...formatMem(),
    });
    throw err;
  } finally {
    clearInterval(timer);
    if (trafficTimer) clearInterval(trafficTimer);
    await session.release({ outcome: 'large_getblock_test_done' });
  }
}

main().catch((err) => {
  process.stderr.write(`${String(err?.message || err)}\n`);
  process.exit(1);
});
