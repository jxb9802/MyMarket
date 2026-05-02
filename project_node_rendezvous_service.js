'use strict';

const crypto = require('crypto');

function normalizeString(value) {
  return String(value || '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function parseTs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}

function makeId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
}

function isPrivateHost(hostLike) {
  const host = normalizeString(hostLike).toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '::1') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m) {
    const n = Number(m[1]);
    if (n >= 16 && n <= 31) return true;
  }
  if (/^(fc|fd)[0-9a-f]{2}:/i.test(host)) return true;
  return false;
}

function endpointHost(endpointLike) {
  const raw = normalizeString(endpointLike);
  if (!raw) return '';
  try {
    return new URL(/^https?:\/\//i.test(raw) || /^wss?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname;
  } catch (_) {
    return '';
  }
}

function createProjectNodeRendezvousService(options = {}) {
  const presenceTtlMs = Math.max(15000, Number(options.presenceTtlMs || 120000));
  const signalTtlMs = Math.max(15000, Number(options.signalTtlMs || 60000));
  const maxSignalsPerWallet = Math.max(8, Number(options.maxSignalsPerWallet || 128));
  const presenceByWalletId = new Map();
  const signalQueueByWalletId = new Map();
  const signalWaitersByWalletId = new Map();

  function pruneExpired() {
    const now = Date.now();
    for (const [walletId, row] of presenceByWalletId.entries()) {
      if (now - parseTs(row.lastSeenAt) > presenceTtlMs) presenceByWalletId.delete(walletId);
    }
    for (const [walletId, queue] of signalQueueByWalletId.entries()) {
      const next = (Array.isArray(queue) ? queue : []).filter((row) => now - parseTs(row.createdAt) <= signalTtlMs);
      if (next.length) signalQueueByWalletId.set(walletId, next);
      else signalQueueByWalletId.delete(walletId);
    }
  }

  function buildObservedAddress(req) {
    const forwarded = normalizeString(req?.headers?.['x-forwarded-for']).split(',')[0].trim();
    const host = forwarded || normalizeString(req?.socket?.remoteAddress || req?.ip || '');
    const port = Number(req?.socket?.remotePort || 0);
    return host ? `${host}${port > 0 ? `:${port}` : ''}` : '';
  }

  function announcePresence(body = {}, meta = {}) {
    pruneExpired();
    const walletId = normalizeString(body.walletId);
    if (!walletId) throw new Error('walletId is required');
    const nodeId = normalizeString(body.nodeId) || walletId;
    const publicEndpoint = normalizeString(body.publicEndpoint || body.chatEndpoint || '');
    const publicHost = endpointHost(publicEndpoint);
    const publicReachableClaim = Boolean(publicEndpoint && !isPrivateHost(publicHost));
    const row = {
      nodeId,
      walletId,
      merchantId: normalizeString(body.merchantId),
      chatPubKey: normalizeString(body.chatPubKey),
      capabilities: body.capabilities && typeof body.capabilities === 'object' ? { ...body.capabilities } : {},
      lanEndpoints: Array.isArray(body.lanEndpoints) ? body.lanEndpoints.map(normalizeString).filter(Boolean).slice(0, 8) : [],
      publicEndpoint,
      publicReachableClaim,
      observedAddress: normalizeString(meta.observedAddress),
      seenBy: normalizeString(meta.seenBy),
      lastSeenAt: nowIso(),
      expiresAt: new Date(Date.now() + presenceTtlMs).toISOString(),
    };
    presenceByWalletId.set(walletId, row);
    return row;
  }

  function lookup(walletId) {
    pruneExpired();
    const safeWalletId = normalizeString(walletId);
    return safeWalletId ? (presenceByWalletId.get(safeWalletId) || null) : null;
  }

  function listPresence(limit = 100) {
    pruneExpired();
    return Array.from(presenceByWalletId.values())
      .sort((a, b) => parseTs(b.lastSeenAt) - parseTs(a.lastSeenAt))
      .slice(0, Math.max(1, Math.min(500, Number(limit || 100))));
  }

  function enqueueSignal(body = {}) {
    pruneExpired();
    const toWalletId = normalizeString(body.toWalletId);
    const fromWalletId = normalizeString(body.fromWalletId);
    const type = normalizeString(body.type);
    const sessionId = normalizeString(body.sessionId);
    if (!toWalletId) throw new Error('toWalletId is required');
    if (!fromWalletId) throw new Error('fromWalletId is required');
    if (!type) throw new Error('type is required');
    if (!sessionId) throw new Error('sessionId is required');
    const signal = {
      id: normalizeString(body.id) || makeId('signal'),
      type,
      sessionId,
      fromWalletId,
      toWalletId,
      createdAt: nowIso(),
      payload: body.payload && typeof body.payload === 'object' ? { ...body.payload } : {},
    };
    const queue = signalQueueByWalletId.get(toWalletId) || [];
    queue.push(signal);
    signalQueueByWalletId.set(toWalletId, queue.slice(-maxSignalsPerWallet));
    wakeSignalWaiters(toWalletId);
    return {
      signal,
      targetPresence: lookup(toWalletId),
    };
  }

  function pollSignals(walletId, limit = 64) {
    pruneExpired();
    const safeWalletId = normalizeString(walletId);
    if (!safeWalletId) throw new Error('walletId is required');
    const queue = signalQueueByWalletId.get(safeWalletId) || [];
    const count = Math.max(1, Math.min(128, Number(limit || 64)));
    const out = queue.slice(0, count);
    const rest = queue.slice(out.length);
    if (rest.length) signalQueueByWalletId.set(safeWalletId, rest);
    else signalQueueByWalletId.delete(safeWalletId);
    return out;
  }

  function wakeSignalWaiters(walletId) {
    const safeWalletId = normalizeString(walletId);
    const waiters = signalWaitersByWalletId.get(safeWalletId) || [];
    if (!waiters.length) return;
    signalWaitersByWalletId.delete(safeWalletId);
    for (const waiter of waiters) {
      try {
        waiter.resolve();
      } catch (_) {}
    }
  }

  function pollSignalsLong(walletId, optionsForPoll = {}) {
    pruneExpired();
    const safeWalletId = normalizeString(walletId);
    if (!safeWalletId) return Promise.reject(new Error('walletId is required'));
    const limit = Math.max(1, Math.min(128, Number(optionsForPoll.limit || 64)));
    const timeoutMs = Math.max(100, Math.min(30000, Number(optionsForPoll.timeoutMs || 20000)));
    const immediate = pollSignals(safeWalletId, limit);
    if (immediate.length > 0 || timeoutMs <= 100) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      const waiter = {
        resolve() {
          clearTimeout(timer);
          resolve(pollSignals(safeWalletId, limit));
        },
      };
      const timer = setTimeout(() => {
        const list = signalWaitersByWalletId.get(safeWalletId) || [];
        const next = list.filter((item) => item !== waiter);
        if (next.length) signalWaitersByWalletId.set(safeWalletId, next);
        else signalWaitersByWalletId.delete(safeWalletId);
        resolve(pollSignals(safeWalletId, limit));
      }, timeoutMs);
      timer.unref?.();
      const list = signalWaitersByWalletId.get(safeWalletId) || [];
      list.push(waiter);
      signalWaitersByWalletId.set(safeWalletId, list.slice(-32));
    });
  }

  function getStats() {
    pruneExpired();
    let queuedSignals = 0;
    for (const queue of signalQueueByWalletId.values()) queuedSignals += Array.isArray(queue) ? queue.length : 0;
    return {
      presenceCount: presenceByWalletId.size,
      queuedSignals,
      waitingPolls: Array.from(signalWaitersByWalletId.values()).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0),
      presenceWalletIds: Array.from(presenceByWalletId.keys()).slice(0, 20),
      queuedWalletIds: Array.from(signalQueueByWalletId.keys()).slice(0, 20),
      waitingWalletIds: Array.from(signalWaitersByWalletId.keys()).slice(0, 20),
      presenceTtlMs,
      signalTtlMs,
    };
  }

  function expressHandlers(optionsForHandlers = {}) {
    const getSelfNodeId = typeof optionsForHandlers.getSelfNodeId === 'function'
      ? optionsForHandlers.getSelfNodeId
      : (() => '');
    return {
      announce: (req, res) => {
        try {
          const row = announcePresence(req.body || {}, {
            observedAddress: buildObservedAddress(req),
            seenBy: getSelfNodeId() || 'public-node',
          });
          return res.json({ success: true, presence: row });
        } catch (error) {
          return res.status(400).json({ success: false, error: String(error?.message || error || 'presence failed') });
        }
      },
      lookup: (req, res) => {
        const walletId = normalizeString(req.query?.walletId || req.body?.walletId);
        return res.json({ success: true, presence: lookup(walletId) });
      },
      list: (req, res) => {
        return res.json({ success: true, entries: listPresence(req.query?.limit) });
      },
      signal: (req, res) => {
        try {
          const result = enqueueSignal(req.body || {});
          return res.json({ success: true, delivered: Boolean(result.targetPresence), ...result });
        } catch (error) {
          return res.status(400).json({ success: false, error: String(error?.message || error || 'signal failed') });
        }
      },
      poll: (req, res) => {
        try {
          const walletId = normalizeString(req.query?.walletId || req.body?.walletId);
          return res.json({ success: true, signals: pollSignals(walletId, req.query?.limit || req.body?.limit) });
        } catch (error) {
          return res.status(400).json({ success: false, error: String(error?.message || error || 'poll failed') });
        }
      },
      pollLong: async (req, res) => {
        try {
          const walletId = normalizeString(req.query?.walletId || req.body?.walletId);
          const signals = await pollSignalsLong(walletId, {
            limit: req.query?.limit || req.body?.limit,
            timeoutMs: req.query?.timeoutMs || req.body?.timeoutMs,
          });
          return res.json({ success: true, signals });
        } catch (error) {
          return res.status(400).json({ success: false, error: String(error?.message || error || 'poll-long failed') });
        }
      },
      stats: (_req, res) => res.json({ success: true, stats: getStats() }),
    };
  }

  return {
    announcePresence,
    lookup,
    listPresence,
    enqueueSignal,
    pollSignals,
    pollSignalsLong,
    getStats,
    expressHandlers,
  };
}

module.exports = {
  createProjectNodeRendezvousService,
  isPrivateHost,
};
