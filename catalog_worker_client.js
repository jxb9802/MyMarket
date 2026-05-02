const path = require('path');
const { fork } = require('child_process');
const messageQueue = require('./lib/message_queue');

let catalogWorker = null;
let restartTimer = null;
let nextRequestId = 1;
const pendingRequests = new Map();
const hooks = {
  appendMarketDebug: null,
  sendCatalogWorkerAuthSnapshot: null,
  handleMarketDbProxyRequest: null,
};

function appendDebug(event, payload = {}) {
  try {
    hooks.appendMarketDebug?.(event, payload);
  } catch (_) {}
}

function setCatalogWorkerHooks(nextHooks = {}) {
  if (!nextHooks || typeof nextHooks !== 'object') return;
  if (typeof nextHooks.appendMarketDebug === 'function') {
    hooks.appendMarketDebug = nextHooks.appendMarketDebug;
  }
  if (typeof nextHooks.sendCatalogWorkerAuthSnapshot === 'function') {
    hooks.sendCatalogWorkerAuthSnapshot = nextHooks.sendCatalogWorkerAuthSnapshot;
  }
  if (typeof nextHooks.handleMarketDbProxyRequest === 'function') {
    hooks.handleMarketDbProxyRequest = nextHooks.handleMarketDbProxyRequest;
  }
}

function rejectPendingRequests(error) {
  for (const [requestId, entry] of pendingRequests.entries()) {
    clearTimeout(entry.timeout);
    entry.reject(error);
    pendingRequests.delete(requestId);
  }
}

function scheduleCatalogWorkerRestart() {
  if (restartTimer || process.env.BSV_MARKET_DISABLE_CATALOG_WORKER === '1') return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startCatalogWorker();
  }, 2000);
  restartTimer.unref?.();
}

function handleCatalogWorkerMessage(message) {
  if (messageQueue.handleChildProcessMessage(catalogWorker, message)) return;
  if (!message || typeof message !== 'object') return;
  const type = String(message.type || '').trim();
  if (type === 'auth.query') {
    try {
      hooks.sendCatalogWorkerAuthSnapshot?.(catalogWorker, {
        source: String(message?.source || 'catalog_worker_query_reply'),
      });
    } catch (_) {}
    return;
  }
  if (type === 'market_db_proxy_request') {
    try {
      hooks.handleMarketDbProxyRequest?.(catalogWorker, message, 'catalog');
    } catch (error) {
      appendDebug('catalog_worker_market_db_proxy_failed', {
        code: String(error?.code || ''),
        message: String(error?.message || error || 'market_db proxy failed'),
      });
    }
    return;
  }
  if (type === 'catalog_worker_ready') {
    appendDebug('catalog_worker_ready', {
      pid: Number(message.pid || catalogWorker?.pid || 0),
    });
    return;
  }
  if (type !== 'catalog_worker_response') return;
  const requestId = String(message.requestId || '').trim();
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  if (message.ok === true) {
    pending.resolve(message.result);
    return;
  }
  pending.reject(new Error(String(message.error || 'catalog worker request failed')));
}

function startCatalogWorker() {
  if (process.env.BSV_MARKET_DISABLE_CATALOG_WORKER === '1') return null;
  if (catalogWorker && !catalogWorker.killed) return catalogWorker;
  const workerPath = path.join(__dirname, 'catalog_subprocess.js');
  catalogWorker = fork(workerPath, [], {
    cwd: __dirname,
    env: {
      ...process.env,
      BSV_MARKET_RUNTIME_BUS_CHILD: '1',
      BSV_MARKET_PROCESS_ROLE: 'catalog_worker',
    },
    stdio: 'inherit',
  });
  messageQueue.registerChildProcess(catalogWorker);
  appendDebug('catalog_worker_spawn', { pid: catalogWorker.pid || null });
  catalogWorker.on('message', handleCatalogWorkerMessage);
  catalogWorker.on('error', (error) => {
    appendDebug('catalog_worker_error', {
      code: String(error?.code || ''),
      message: String(error?.message || error || 'unknown worker error'),
    });
  });
  catalogWorker.on('exit', (code, signal) => {
    appendDebug('catalog_worker_exit', { code, signal });
    catalogWorker = null;
    rejectPendingRequests(new Error('catalog worker exited'));
    scheduleCatalogWorkerRestart();
  });
  try {
    hooks.sendCatalogWorkerAuthSnapshot?.(catalogWorker, { source: 'catalog_worker_startup' });
  } catch (_) {}
  return catalogWorker;
}

function callCatalogWorker(method, args = [], options = {}) {
  if (process.env.BSV_MARKET_DISABLE_CATALOG_WORKER === '1') {
    const localCatalogDomain = require('./catalog_domain');
    return Promise.resolve(localCatalogDomain[method](...(Array.isArray(args) ? args : [])));
  }
  const worker = startCatalogWorker();
  if (!worker || worker.killed || worker.connected === false) {
    return Promise.reject(new Error('catalog worker unavailable'));
  }
  const requestId = `catalog-${process.pid}-${Date.now()}-${nextRequestId++}`;
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || 20000));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`catalog worker timeout: ${method}`));
    }, timeoutMs);
    timeout.unref?.();
    pendingRequests.set(requestId, { resolve, reject, timeout });
    try {
      worker.send({
        type: 'catalog_worker_request',
        requestId,
        method: String(method || '').trim(),
        args: Array.isArray(args) ? args : [],
      });
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(requestId);
      reject(error);
    }
  });
}

function stopCatalogWorker() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (!catalogWorker || catalogWorker.killed) return;
  try {
    catalogWorker.kill();
  } catch (_) {}
}

function emitCatalogSnapshot(snapshot, meta = {}) {
  return callCatalogWorker('emitCatalogSnapshot', [snapshot, meta], { timeoutMs: 30000 });
}

function resetCatalogSnapshot() {
  return callCatalogWorker('resetCatalogSnapshot', [], { timeoutMs: 30000 });
}

function ensureCatalogRuntimeLoaded(options = {}) {
  return callCatalogWorker('ensureCatalogRuntimeLoaded', [options], { timeoutMs: 30000 });
}

function rehydrateCatalogRuntimeFromProjection() {
  return callCatalogWorker('rehydrateCatalogRuntimeFromProjection', [], { timeoutMs: 30000 });
}

module.exports = {
  emitCatalogSnapshot,
  ensureCatalogRuntimeLoaded,
  rehydrateCatalogRuntimeFromProjection,
  resetCatalogSnapshot,
  setCatalogWorkerHooks,
  startCatalogWorker,
  stopCatalogWorker,
};
