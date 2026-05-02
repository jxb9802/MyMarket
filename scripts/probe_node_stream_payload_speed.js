#!/usr/bin/env node

const {
  createStreamingPeer,
  streamBlockFromConnectedPeer,
} = require('../lib/stream_block_reader');

function parseArgs(argv) {
  const args = {
    node: '',
    hash: '',
    connectTimeoutMs: 15000,
    idleTimeoutMs: 30000,
    hardTimeoutMs: 180000,
    label: 'payload_stream_speed',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    const next = String(argv[i + 1] || '');
    if (arg === '--node') {
      args.node = next.trim();
      i += 1;
    } else if (arg === '--hash') {
      args.hash = next.trim().toLowerCase();
      i += 1;
    } else if (arg === '--connect-timeout-ms') {
      args.connectTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
    } else if (arg === '--idle-timeout-ms') {
      args.idleTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
    } else if (arg === '--hard-timeout-ms') {
      args.hardTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
    } else if (arg === '--label') {
      args.label = next.trim() || args.label;
      i += 1;
    }
  }
  return args;
}

function log(event, extra = {}) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...extra })}\n`);
}

async function connectPeer(peer, node, timeoutMs) {
  const startedAt = Date.now();
  await Promise.race([
    peer.connect(),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`connect timeout: ${node}`)), timeoutMs);
    }),
  ]);
  return Date.now() - startedAt;
}

function rate(bytes, elapsedMs) {
  const seconds = Math.max(0.001, elapsedMs / 1000);
  return {
    bytesPerSec: Math.round(bytes / seconds),
    mibPerSec: Number((bytes / seconds / (1024 * 1024)).toFixed(3)),
    mbPerSec: Number((bytes / seconds / 1000 / 1000).toFixed(3)),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.node) throw new Error('missing --node host:port');
  if (!/^[0-9a-f]{64}$/.test(args.hash)) throw new Error('missing or invalid --hash');

  const peer = createStreamingPeer(args.node, { validate: false });
  log('payload_probe_started', {
    label: args.label,
    node: args.node,
    hash: args.hash,
    connectTimeoutMs: args.connectTimeoutMs,
    idleTimeoutMs: args.idleTimeoutMs,
    hardTimeoutMs: args.hardTimeoutMs,
  });

  let payloadBytes = 0;
  let payloadChunks = 0;
  let payloadStartedAt = 0;
  let payloadFinishedAt = 0;

  try {
    const connectElapsedMs = await connectPeer(peer, args.node, args.connectTimeoutMs);
    const beforeRequestAt = Date.now();
    log('payload_probe_connected', {
      label: args.label,
      connectElapsedMs,
    });

    let result = null;
    try {
      result = await streamBlockFromConnectedPeer(peer, args.hash, {
      idleTimeoutMs: args.idleTimeoutMs,
      hardTimeoutMs: args.hardTimeoutMs,
      memoryLogIntervalMs: 30000,
      logEveryNChunks: 1,
      label: args.label,
      collectMarkerMatches: false,
      onEvent(event, payload = {}) {
        if (event !== 'stream_block_probe_chunk') return;
        const chunkBytes = Math.max(0, Number(payload.chunkBytes || 0));
        if (chunkBytes > 0) {
          if (!payloadStartedAt) payloadStartedAt = Date.now();
          payloadBytes += chunkBytes;
          payloadChunks += 1;
        }
        if (payload.finished) {
          payloadFinishedAt = Date.now();
        }
      },
      });
    } catch (err) {
      const partialElapsedMs = payloadStartedAt
        ? Math.max(1, (payloadFinishedAt || Date.now()) - payloadStartedAt)
        : 0;
      log('payload_probe_partial_failed', {
        label: args.label,
        ok: false,
        node: args.node,
        requestedHash: args.hash,
        error: String(err?.message || err),
        connectElapsedMs,
        requestToFirstPayloadMs: payloadStartedAt ? payloadStartedAt - beforeRequestAt : 0,
        totalAfterRequestMs: Date.now() - beforeRequestAt,
        payloadBytes,
        payloadChunks,
        payloadElapsedMs: partialElapsedMs,
        payloadRate: partialElapsedMs ? rate(payloadBytes, partialElapsedMs) : null,
      });
      throw err;
    }

    const requestToFirstPayloadMs = payloadStartedAt ? payloadStartedAt - beforeRequestAt : 0;
    const payloadElapsedMs = payloadStartedAt && payloadFinishedAt
      ? Math.max(1, payloadFinishedAt - payloadStartedAt)
      : 0;
    log('payload_probe_completed', {
      label: args.label,
      ok: true,
      node: args.node,
      requestedHash: args.hash,
      blockHash: result.blockHash,
      txCountObserved: result.txCountObserved,
      connectElapsedMs,
      requestToFirstPayloadMs,
      totalAfterRequestMs: Date.now() - beforeRequestAt,
      payloadBytes,
      payloadChunks,
      payloadElapsedMs,
      payloadRate: payloadElapsedMs ? rate(payloadBytes, payloadElapsedMs) : null,
      socketBytesRead: result.socketBytesRead,
      socketElapsedMs: Math.max(1, result.elapsedMs - result.firstDataElapsedMs),
      socketRateAfterFirstData: rate(result.socketBytesRead, Math.max(1, result.elapsedMs - result.firstDataElapsedMs)),
    });
  } finally {
    try {
      peer.disconnect(false);
    } catch (_) {}
  }
}

main().catch((err) => {
  log('payload_probe_failed', {
    ok: false,
    error: String(err?.message || err),
  });
  process.exit(1);
});
