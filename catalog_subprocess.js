const messageQueue = require('./lib/message_queue');
const catalogDomain = require('./catalog_domain');
const { createCatalogAuthRuntime } = require('./catalog_auth_runtime');

const ALLOWED_METHODS = new Set([
  'emitCatalogSnapshot',
  'resetCatalogSnapshot',
  'rehydrateCatalogRuntimeFromProjection',
  'ensureCatalogRuntimeLoaded',
]);
const catalogAuthRuntime = createCatalogAuthRuntime();

function safeSend(payload = {}) {
  if (typeof process.send !== 'function' || process.connected === false) return;
  try {
    process.send(payload);
  } catch (_) {}
}

async function handleCatalogWorkerRequest(message) {
  const requestId = String(message?.requestId || '').trim();
  const method = String(message?.method || '').trim();
  const args = Array.isArray(message?.args) ? message.args : [];
  if (!requestId || !ALLOWED_METHODS.has(method)) {
    safeSend({
      type: 'catalog_worker_response',
      requestId,
      ok: false,
      error: `unsupported catalog worker method: ${method || 'unknown'}`,
    });
    return;
  }
  try {
    const result = await catalogDomain[method](...args);
    safeSend({
      type: 'catalog_worker_response',
      requestId,
      ok: true,
      result,
    });
  } catch (error) {
    safeSend({
      type: 'catalog_worker_response',
      requestId,
      ok: false,
      error: String(error?.message || error || `${method} failed`),
    });
  }
}

process.on('message', (message) => {
  if (messageQueue.handleChildProcessMessage(process, message)) return;
  if (!message || typeof message !== 'object') return;
  if (message.type === 'auth.snapshot' || message.type === 'auth.logged_in' || message.type === 'auth.logged_out') {
    catalogAuthRuntime.applySnapshot(message.snapshot || {}, {
      source: String(message?.source || message.type || 'auth_snapshot'),
    });
    return;
  }
  if (String(message.type || '') !== 'catalog_worker_request') return;
  void handleCatalogWorkerRequest(message);
});

safeSend({
  type: 'auth.query',
  source: 'catalog_worker_startup',
});

safeSend({
  type: 'catalog_worker_ready',
  pid: Number(process.pid || 0),
});
