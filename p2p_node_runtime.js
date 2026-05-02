const path = require('path');
const net = require('net');

function requireWithFallback(name) {
  try {
    return require(name);
  } catch (firstErr) {
    const fallbackRoots = [
      path.join(__dirname, 'node_modules'),
      path.join(__dirname, '..', 'node_modules'),
      path.join(__dirname, '..', 'bsv2', 'node_modules'),
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, timeoutMs, message) {
  let timer = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message || 'timeout')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withSocketIdleTimeout(peer, promise, options = {}) {
  const socket = peer?.socket || null;
  const idleTimeoutMs = Math.max(1000, Number(options.idleTimeoutMs || 0));
  const hardTimeoutMs = Math.max(idleTimeoutMs, Number(options.hardTimeoutMs || 0) || idleTimeoutMs);
  const idleMessage = String(options.idleMessage || 'socket idle timeout');
  const hardMessage = String(options.hardMessage || 'socket hard timeout');
  if (!socket || typeof socket.on !== 'function') {
    return withTimeout(promise, hardTimeoutMs, hardMessage);
  }

  let settled = false;
  let idleTimer = null;
  let hardTimer = null;

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      if (idleTimer) clearTimeout(idleTimer);
      if (hardTimer) clearTimeout(hardTimer);
      socket.removeListener('data', onData);
      socket.removeListener('close', onClose);
      socket.removeListener('end', onEnd);
      socket.removeListener('error', onError);
    };

    const finishResolve = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error || 'socket timeout')));
    };

    const refreshIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finishReject(new Error(idleMessage));
      }, idleTimeoutMs);
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
    hardTimer = setTimeout(() => {
      finishReject(new Error(hardMessage));
    }, hardTimeoutMs);

    Promise.resolve(promise).then(finishResolve, finishReject);
  });
}

function probeTcp(endpoint, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const target = String(endpoint || '').trim();
    const [host, portRaw] = target.split(':');
    const port = Number(portRaw);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      resolve({
        endpoint: target,
        ok: false,
        latencyMs: 0,
        error: 'invalid_endpoint',
      });
      return;
    }
    const started = Date.now();
    const socket = new net.Socket();
    let settled = false;
    const done = (ok, error = '') => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (_) {}
      resolve({
        endpoint: target,
        ok,
        latencyMs: ok ? Math.max(1, Date.now() - started) : 0,
        error: ok ? '' : String(error || 'probe_failed'),
      });
    };
    socket.setTimeout(timeoutMs, () => done(false, 'timeout'));
    socket.once('error', (err) => done(false, err?.message || 'socket_error'));
    socket.connect(port, host, () => done(true, ''));
  });
}

function createPeer(node, options = {}) {
  const peer = new BitcoinP2P({
    node,
    ticker: 'BSV',
    autoReconnect: false,
    stream: options.stream === true,
    validate: false,
    disableExtmsg: options.disableExtmsg !== false,
    DEBUG_LOG: false,
  });
  if (typeof peer.setMaxListeners === 'function') peer.setMaxListeners(0);
  if (peer.internalEmitter && typeof peer.internalEmitter.setMaxListeners === 'function') {
    peer.internalEmitter.setMaxListeners(0);
  }
  return peer;
}

function resolveLease(selector, { node = '', preferred = [], exclude = [], purpose = 'general', mode = 'fresh' } = {}) {
  if (!selector || typeof selector.acquirePreferredLease !== 'function') {
    const endpoint = String(node || (Array.isArray(preferred) ? preferred[0] : '')).trim();
    if (!endpoint) return null;
    return {
      id: `direct-${endpoint}`,
      node: endpoint,
      purpose,
      mode,
      isActive() { return true; },
      snapshot() { return { node: endpoint, purpose, mode, status: 'active' }; },
      reportSuccess() { return null; },
      reportFailure() { return null; },
      release() { return true; },
    };
  }
  const explicit = String(node || '').trim();
  if (explicit) {
    return selector.acquirePreferredLease({
      preferred: [explicit],
      exclude,
      purpose,
      mode,
      strictPreferred: true,
    });
  }
  return selector.acquirePreferredLease({
    preferred,
    exclude,
    purpose,
    mode,
  });
}

async function connectSession(selector, options = {}) {
  const {
    node = '',
    preferred = [],
    exclude = [],
    purpose = 'general',
    mode = 'fresh',
    connectTimeoutMs = 8000,
    stream = false,
  } = options;
  const lease = resolveLease(selector, { node, preferred, exclude, purpose, mode });
  if (!lease) throw new Error('no node lease available');
  const endpoint = String(lease.node || node || '').trim();
  if (!endpoint) {
    try { lease.release({ outcome: 'invalid_node' }); } catch (_) {}
    throw new Error('invalid leased node');
  }
  const peer = createPeer(endpoint, { stream });
  const startedAt = Date.now();
  let connected = false;
  let closed = false;
  async function close(meta = {}) {
    if (closed) return;
    closed = true;
    try {
      peer.disconnect(false);
    } catch (_) {}
    try {
      lease.release(meta);
    } catch (_) {}
  }
  try {
    await withTimeout(peer.connect(), connectTimeoutMs, `connect timeout: ${endpoint}`);
    connected = true;
  } catch (err) {
    try {
      lease.reportFailure({ error: String(err?.message || 'connect failed'), purpose });
    } catch (_) {}
    await close({ outcome: 'connect_failure', reason: String(err?.message || 'connect failed') });
    throw err;
  }
  return {
    lease,
    peer,
    node: endpoint,
    purpose,
    mode,
    connectedAt: Date.now(),
    connectElapsedMs: Date.now() - startedAt,
    isConnected() {
      return Boolean(connected && !closed && peer?.connected);
    },
    async reportSuccess(meta = {}) {
      try {
        lease.reportSuccess({ ...meta, purpose: meta.purpose || purpose });
      } catch (_) {}
    },
    async reportFailure(meta = {}) {
      try {
        lease.reportFailure({ ...meta, purpose: meta.purpose || purpose });
      } catch (_) {}
    },
    async release(meta = {}) {
      await close(meta);
    },
  };
}

async function withFreshPeer(selector, options = {}, fn) {
  const session = await connectSession(selector, {
    ...options,
    mode: options?.mode || 'fresh',
  });
  try {
    const result = await fn(session.peer, session);
    return result;
  } finally {
    await session.release({ outcome: 'fresh_done' });
  }
}

module.exports = {
  BitcoinP2P,
  sleep,
  withTimeout,
  withSocketIdleTimeout,
  probeTcp,
  createPeer,
  connectSession,
  withFreshPeer,
};
