const path = require('path');

function requireWithFallback(name) {
  try {
    return require(name);
  } catch (firstErr) {
    const fallbackRoots = [
      path.join(__dirname, '..', 'node_modules'),
      path.join(__dirname, '..', '..', 'node_modules'),
      path.join(__dirname, '..', '..', 'bsv2', 'node_modules'),
    ];
    for (const root of fallbackRoots) {
      try {
        return require(path.join(root, name));
      } catch (_) {}
    }
    throw firstErr;
  }
}

const BitcoinP2PRaw = requireWithFallback('bsv-p2p');
const BitcoinP2P = BitcoinP2PRaw.default || BitcoinP2PRaw;

const CHAIN_MARKER = 'BMMKT2|';
const LEGACY_CHAIN_MARKER = 'BMMKT1|';

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

function createPeakTracker() {
  const peak = {
    rssMb: 0,
    heapUsedMb: 0,
    heapTotalMb: 0,
    externalMb: 0,
    arrayBuffersMb: 0,
  };
  return {
    update() {
      const mem = formatMem();
      Object.keys(peak).forEach((key) => {
        peak[key] = Math.max(peak[key], Number(mem[key] || 0));
      });
      return mem;
    },
    snapshot() {
      return { ...peak };
    },
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

function toHex(value) {
  if (!value) return '';
  if (Buffer.isBuffer(value)) return value.toString('hex');
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value.toBuffer === 'function') {
    try {
      return value.toBuffer().toString('hex');
    } catch (_) {}
  }
  if (typeof value.toString === 'function') {
    try {
      return String(value.toString('hex') || value.toString()).trim().toLowerCase();
    } catch (_) {}
  }
  return '';
}

function collectPushTextFromScriptBuffer(scriptBuffer) {
  if (!Buffer.isBuffer(scriptBuffer) || !scriptBuffer.length) return [];
  const texts = [];
  let offset = 0;
  if (scriptBuffer[offset] !== 0x6a) return texts;
  offset += 1;
  while (offset < scriptBuffer.length) {
    const opcode = scriptBuffer[offset];
    offset += 1;
    if (opcode === 0x00) continue;
    let size = 0;
    if (opcode >= 0x01 && opcode <= 0x4b) {
      size = opcode;
    } else if (opcode === 0x4c) {
      if (offset + 1 > scriptBuffer.length) break;
      size = scriptBuffer.readUInt8(offset);
      offset += 1;
    } else if (opcode === 0x4d) {
      if (offset + 2 > scriptBuffer.length) break;
      size = scriptBuffer.readUInt16LE(offset);
      offset += 2;
    } else if (opcode === 0x4e) {
      if (offset + 4 > scriptBuffer.length) break;
      size = scriptBuffer.readUInt32LE(offset);
      offset += 4;
    } else {
      continue;
    }
    if (size <= 0 || offset + size > scriptBuffer.length) break;
    const payload = scriptBuffer.subarray(offset, offset + size);
    offset += size;
    try {
      texts.push(payload.toString('utf8'));
    } catch (_) {}
  }
  return texts;
}

function collectOpReturnStrings(transaction) {
  const outputs = Array.isArray(transaction?.outputs) ? transaction.outputs : [];
  const texts = [];
  for (const output of outputs) {
    const scriptBuffer = Buffer.isBuffer(output?.scriptBuffer) ? output.scriptBuffer : null;
    if (scriptBuffer) {
      texts.push(...collectPushTextFromScriptBuffer(scriptBuffer));
      continue;
    }
    const script = output?.script;
    const chunks = Array.isArray(script?.chunks) ? script.chunks : [];
    if (!chunks.length) continue;
    const first = chunks[0];
    const op = Number(first?.opcodenum ?? first?.op ?? -1);
    if (op !== 106) continue;
    for (let i = 1; i < chunks.length; i += 1) {
      const chunk = chunks[i];
      const buf = Buffer.isBuffer(chunk?.buf)
        ? chunk.buf
        : (Buffer.isBuffer(chunk?.data) ? chunk.data : null);
      if (!buf || !buf.length) continue;
      try {
        texts.push(buf.toString('utf8'));
      } catch (_) {}
    }
  }
  return texts;
}

function extractMarkerMatches(transaction, context = {}) {
  const txid = typeof transaction?.getHash === 'function'
    ? toHex(transaction.getHash())
    : '';
  const texts = collectOpReturnStrings(transaction);
  const matches = [];
  const acceptedMarkers = Array.isArray(context.acceptedMarkers) && context.acceptedMarkers.length
    ? context.acceptedMarkers
    : [CHAIN_MARKER];
  for (const text of texts) {
    const normalized = String(text || '');
    const marker = acceptedMarkers.find((candidate) => normalized.startsWith(candidate));
    if (!marker) continue;
    const firstSep = normalized.indexOf('|');
    const secondSep = normalized.indexOf('|', firstSep + 1);
    if (firstSep <= -1 || secondSep <= -1) continue;
    const eventType = normalized.slice(firstSep + 1, secondSep).trim();
    const payloadText = normalized.slice(secondSep + 1);
    matches.push({
      txid,
      marker: marker.slice(0, -1),
      eventType,
      payloadPreview: payloadText.slice(0, 240),
      blockHash: String(context.blockHash || ''),
      txIndex: Number(context.txIndex || 0),
    });
  }
  return matches;
}

function emitEvent(logger, event, payload = {}) {
  if (typeof logger !== 'function') return;
  try {
    logger(event, payload);
  } catch (_) {}
}

function createStreamingPeer(node, options = {}) {
  const peer = new BitcoinP2P({
    node,
    ticker: 'BSV',
    stream: true,
    validate: Boolean(options.validate),
    autoReconnect: false,
    disableExtmsg: options.disableExtmsg !== false,
    DEBUG_LOG: false,
  });
  if (typeof peer.setMaxListeners === 'function') peer.setMaxListeners(0);
  if (peer.internalEmitter && typeof peer.internalEmitter.setMaxListeners === 'function') {
    peer.internalEmitter.setMaxListeners(0);
  }
  return peer;
}

async function connectPeer(peer, node, connectTimeoutMs) {
  await Promise.race([
    peer.connect(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`connect timeout: ${node}`)), connectTimeoutMs)),
  ]);
}

async function streamBlockFromConnectedPeer(peer, hash, options = {}) {
  const startedAt = Date.now();
  const idleTimeoutMs = Math.max(1000, Number(options.idleTimeoutMs || 10000));
  const hardTimeoutMs = Math.max(idleTimeoutMs, Number(options.hardTimeoutMs || 1800000));
  const memoryLogIntervalMs = Math.max(1000, Number(options.memoryLogIntervalMs || 5000));
  const maxEvents = Math.max(1, Number(options.maxEvents || 100));
  const logEveryNChunks = Math.max(0, Number(options.logEveryNChunks || 0));
  const minStreamBytesPerSec = Math.max(0, Number(options.minStreamBytesPerSec || 0));
  const streamSpeedGraceMs = Math.max(1000, Number(options.streamSpeedGraceMs || 15000));
  const label = String(options.label || 'stream_block_reader');
  const onEvent = typeof options.onEvent === 'function' ? options.onEvent : null;
  const onTransactions = typeof options.onTransactions === 'function' ? options.onTransactions : null;
  const abortSignal = options.abortSignal || null;
  const collectMarkerMatches = options.collectMarkerMatches === true;
  const socket = peer?.socket || null;
  if (!socket || typeof socket.on !== 'function') {
    throw new Error('peer socket unavailable');
  }
  if (abortSignal?.aborted === true) {
    throw new Error(String(abortSignal.reason || 'stream aborted'));
  }

  const peak = createPeakTracker();
  let firstDataAt = 0;
  let firstBlockChunkAt = 0;
  let lastBlockChunkAt = 0;
  let streamPayloadBytes = 0;
  let currentBlockHash = '';
  let chunkCount = 0;
  let txCountObserved = 0;
  const matchedEvents = [];
  let getBlockResolved = false;
  let idleGuardResolve = null;
  let idleGuardReject = null;
  let onBlockChunk = null;
  let onTransactionsBatch = null;
  let onErrorMessage = null;
  let onErrorSocket = null;
  let onDisconnected = null;
  let onSocketData = null;
  let onAbort = null;
  let pendingTransactionsWork = Promise.resolve();
  const acceptedMarkers = collectMarkerMatches && Array.isArray(options.acceptedMarkers) && options.acceptedMarkers.length
    ? options.acceptedMarkers
    : (collectMarkerMatches
      ? (options.acceptLegacyBmmkt1 ? [CHAIN_MARKER, LEGACY_CHAIN_MARKER] : [CHAIN_MARKER])
      : []);

  onSocketData = () => {
    peak.update();
    if (!firstDataAt) firstDataAt = Date.now();
  };
  socket.on('data', onSocketData);

  const memTimer = setInterval(() => {
    emitEvent(onEvent, 'stream_block_probe_memory', {
      label,
      elapsedMs: Date.now() - startedAt,
      ...peak.update(),
      ...getSocketStats(socket),
    });
  }, memoryLogIntervalMs);
  memTimer.unref();

  try {
    const idleGuard = new Promise((resolve, reject) => {
      const cleanup = () => {
        socket.removeListener('data', onData);
        socket.removeListener('close', onClose);
        socket.removeListener('end', onEnd);
        socket.removeListener('error', onError);
        if (idleTimer) clearTimeout(idleTimer);
        if (hardTimer) clearTimeout(hardTimer);
        if (speedTimer) clearInterval(speedTimer);
      };
      let idleTimer = null;
      let hardTimer = null;
      let speedTimer = null;
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const finishReject = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err || 'stream timeout')));
      };
      idleGuardResolve = finishResolve;
      idleGuardReject = finishReject;
      if (abortSignal && typeof abortSignal.addEventListener === 'function') {
        onAbort = () => {
          finishReject(new Error(String(abortSignal.reason || 'stream aborted')));
          try {
            if (typeof peer.disconnect === 'function') peer.disconnect(false);
          } catch (_) {}
          try {
            if (typeof socket.destroy === 'function') socket.destroy();
          } catch (_) {}
        };
        abortSignal.addEventListener('abort', onAbort, { once: true });
      }
      const refreshIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finishReject(new Error(`getblock idle timeout: ${peer.node || ''}`)), idleTimeoutMs);
      };
      const onData = () => refreshIdle();
      const onClose = () => finishReject(new Error('socket closed'));
      const onEnd = () => finishReject(new Error('socket ended'));
      const onError = (err) => finishReject(err || new Error('socket error'));
      socket.on('data', onData);
      socket.once('close', onClose);
      socket.once('end', onEnd);
      socket.once('error', onError);
      refreshIdle();
      hardTimer = setTimeout(() => finishReject(new Error(`getblock hard timeout: ${peer.node || ''}`)), hardTimeoutMs);
      if (minStreamBytesPerSec > 0) {
        speedTimer = setInterval(() => {
          if (!firstBlockChunkAt) return;
          const elapsedMs = Date.now() - firstBlockChunkAt;
          if (elapsedMs < streamSpeedGraceMs) return;
          const bytesPerSec = Math.round(streamPayloadBytes / Math.max(0.001, elapsedMs / 1000));
          if (bytesPerSec >= minStreamBytesPerSec) return;
          emitEvent(onEvent, 'stream_block_probe_slow_stream', {
            label,
            elapsedMs,
            streamPayloadBytes,
            streamPayloadBytesPerSec: bytesPerSec,
            minStreamBytesPerSec,
            ...getSocketStats(socket),
          });
          finishReject(new Error(`getblock slow stream: ${peer.node || ''} ${bytesPerSec}Bps < ${minStreamBytesPerSec}Bps`));
        }, 1000);
        speedTimer.unref?.();
      }
    });

    onBlockChunk = ({ chunk, blockHash, started, finished, num, txCount }) => {
      if (abortSignal?.aborted === true) {
        if (idleGuardReject) idleGuardReject(new Error(String(abortSignal.reason || 'stream aborted')));
        return;
      }
      peak.update();
      const chunkBytes = Buffer.isBuffer(chunk) ? chunk.length : 0;
      if (chunkBytes > 0) {
        if (!firstBlockChunkAt) firstBlockChunkAt = Date.now();
        lastBlockChunkAt = Date.now();
        streamPayloadBytes += chunkBytes;
      }
      currentBlockHash = toHex(blockHash) || currentBlockHash;
      chunkCount = Math.max(chunkCount, Number(num || 0) + 1);
      if (logEveryNChunks > 0 && (Boolean(started) || Boolean(finished) || (Number(num || 0) % logEveryNChunks) === 0)) {
        emitEvent(onEvent, 'stream_block_probe_chunk', {
          label,
          blockHash: currentBlockHash,
          chunkBytes,
          started: Boolean(started),
          finished: Boolean(finished),
          num: Number(num || 0),
          txCountHint: Number(txCount || 0),
          elapsedMs: Date.now() - startedAt,
          ...getSocketStats(socket),
        });
      }
      if (finished && idleGuardResolve) idleGuardResolve();
    };

    onTransactionsBatch = ({ header, transactions, finished }) => {
      if (abortSignal?.aborted === true) {
        if (idleGuardReject) idleGuardReject(new Error(String(abortSignal.reason || 'stream aborted')));
        return;
      }
      peak.update();
      const blockHash = toHex(header?.getHash?.()) || currentBlockHash;
      currentBlockHash = blockHash || currentBlockHash;
      const entries = Array.isArray(transactions) ? transactions : [];
      txCountObserved += entries.length;
      const txBatch = [];
      for (const entry of entries) {
        const txIndex = Number(Array.isArray(entry) ? entry[0] : 0);
        const tx = Array.isArray(entry) ? entry[1] : null;
        if (!tx) continue;
        txBatch.push({ tx, txIndex, blockHash: currentBlockHash });
        if (collectMarkerMatches) {
          const matches = extractMarkerMatches(tx, {
            blockHash: currentBlockHash,
            txIndex,
            acceptedMarkers,
          });
          for (const match of matches) {
            if (matchedEvents.length < maxEvents) matchedEvents.push(match);
          }
        }
      }
      const work = async () => {
        if (abortSignal?.aborted === true) {
          return;
        }
        if (onTransactions && txBatch.length > 0) {
          if (typeof socket.pause === 'function') socket.pause();
          try {
            await onTransactions(txBatch, { blockHash: currentBlockHash, finished: Boolean(finished) });
          } finally {
            if (typeof socket.resume === 'function') socket.resume();
          }
        }
        if (abortSignal?.aborted === true) {
          return;
        }
        if (finished) {
          emitEvent(onEvent, 'stream_block_probe_transactions_finished', {
            label,
            blockHash: currentBlockHash,
            txCountObserved,
            matchedEventCount: matchedEvents.length,
            elapsedMs: Date.now() - startedAt,
            ...getSocketStats(socket),
          });
        }
      };
      pendingTransactionsWork = pendingTransactionsWork.then(work, work);
    };

    onErrorMessage = ({ error }) => {
      emitEvent(onEvent, 'stream_block_probe_error_message', {
        label,
        error: String(error?.message || error || ''),
        elapsedMs: Date.now() - startedAt,
      });
    };

    onErrorSocket = ({ error }) => {
      emitEvent(onEvent, 'stream_block_probe_error_socket', {
        label,
        error: String(error?.message || error || ''),
        elapsedMs: Date.now() - startedAt,
      });
    };

    onDisconnected = ({ disconnects }) => {
      emitEvent(onEvent, 'stream_block_probe_disconnected', {
        label,
        disconnects: Number(disconnects || 0),
        elapsedMs: Date.now() - startedAt,
      });
      if (!getBlockResolved && idleGuardReject) {
        idleGuardReject(new Error(`peer disconnected: ${peer.node || ''}`));
      }
    };

    peer.on('block_chunk', onBlockChunk);
    peer.on('transactions', onTransactionsBatch);
    peer.on('error_message', onErrorMessage);
    peer.on('error_socket', onErrorSocket);
    peer.on('disconnected', onDisconnected);

    const getBlockPromise = peer.getBlock(hash).then((result) => {
      getBlockResolved = true;
      return result;
    });

    const result = await Promise.race([getBlockPromise, idleGuard]);
    if (!getBlockResolved && idleGuardResolve) idleGuardResolve();
    await pendingTransactionsWork;

    peer.removeListener('block_chunk', onBlockChunk);
    peer.removeListener('transactions', onTransactionsBatch);
    peer.removeListener('error_message', onErrorMessage);
    peer.removeListener('error_socket', onErrorSocket);
    peer.removeListener('disconnected', onDisconnected);

    return {
      ok: true,
      requestedHash: String(hash || '').toLowerCase(),
      blockHash: currentBlockHash,
      elapsedMs: Date.now() - startedAt,
      firstDataElapsedMs: firstDataAt ? (firstDataAt - startedAt) : 0,
      streamPayloadBytes,
      streamPayloadElapsedMs: firstBlockChunkAt ? Math.max(1, (lastBlockChunkAt || Date.now()) - firstBlockChunkAt) : 0,
      streamPayloadBytesPerSec: firstBlockChunkAt
        ? Math.round(streamPayloadBytes / Math.max(0.001, (Math.max(1, (lastBlockChunkAt || Date.now()) - firstBlockChunkAt) / 1000)))
        : 0,
      chunkCount,
      txCountObserved,
      matchedEventCount: matchedEvents.length,
      matchedEvents,
      resultKeys: result && typeof result === 'object' ? Object.keys(result).slice(0, 16) : [],
      ...getSocketStats(socket),
      ...peak.snapshot(),
    };
  } finally {
    if (abortSignal && onAbort && typeof abortSignal.removeEventListener === 'function') {
      abortSignal.removeEventListener('abort', onAbort);
    }
    if (onSocketData) socket.removeListener('data', onSocketData);
    if (onBlockChunk) peer.removeListener('block_chunk', onBlockChunk);
    if (onTransactionsBatch) peer.removeListener('transactions', onTransactionsBatch);
    if (onErrorMessage) peer.removeListener('error_message', onErrorMessage);
    if (onErrorSocket) peer.removeListener('error_socket', onErrorSocket);
    if (onDisconnected) peer.removeListener('disconnected', onDisconnected);
    clearInterval(memTimer);
  }
}

async function streamBlockFromNode(options = {}) {
  const node = String(options.node || '').trim();
  const hash = String(options.hash || '').trim().toLowerCase();
  const connectTimeoutMs = Math.max(1000, Number(options.connectTimeoutMs || 8000));
  if (!node) throw new Error('missing node');
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('missing or invalid hash');
  const peer = createStreamingPeer(node, options);
  await connectPeer(peer, node, connectTimeoutMs);
  try {
    return await streamBlockFromConnectedPeer(peer, hash, options);
  } finally {
    try {
      peer.disconnect(false);
    } catch (_) {}
  }
}

module.exports = {
  CHAIN_MARKER,
  LEGACY_CHAIN_MARKER,
  formatMem,
  getSocketStats,
  toHex,
  collectPushTextFromScriptBuffer,
  collectOpReturnStrings,
  extractMarkerMatches,
  createStreamingPeer,
  streamBlockFromConnectedPeer,
  streamBlockFromNode,
};
