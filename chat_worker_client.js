const path = require('path');
const { fork } = require('child_process');
const messageQueue = require('./lib/message_queue');

let chatServiceWorker = null;
let restartTimer = null;
let nextRequestId = 1;
const pendingRequests = new Map();
const hooks = {
  appendMarketDebug: null,
  sendChatWorkerAuthSnapshot: null,
  publishFrontendEvent: null,
  handleMarketDbProxyRequest: null,
};

function appendDebug(event, payload = {}) {
  try {
    hooks.appendMarketDebug?.(event, payload);
  } catch (_) {}
}

function setChatWorkerHooks(nextHooks = {}) {
  if (!nextHooks || typeof nextHooks !== 'object') return;
  if (typeof nextHooks.appendMarketDebug === 'function') {
    hooks.appendMarketDebug = nextHooks.appendMarketDebug;
  }
  if (typeof nextHooks.sendChatWorkerAuthSnapshot === 'function') {
    hooks.sendChatWorkerAuthSnapshot = nextHooks.sendChatWorkerAuthSnapshot;
  }
  if (typeof nextHooks.publishFrontendEvent === 'function') {
    hooks.publishFrontendEvent = nextHooks.publishFrontendEvent;
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

function scheduleChatWorkerRestart() {
  if (restartTimer || process.env.BSV_MARKET_DISABLE_CHAT_SERVICE === '1') return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startChatWorker();
  }, 2000);
  restartTimer.unref?.();
}

function handleChatWorkerMessage(message) {
  if (messageQueue.handleChildProcessMessage(chatServiceWorker, message)) return;
  if (!message || typeof message !== 'object') return;
  const type = String(message.type || '').trim();
  if (type === 'auth.query') {
    try {
      hooks.sendChatWorkerAuthSnapshot?.(chatServiceWorker, {
        source: String(message?.source || 'chat_worker_query_reply'),
      });
    } catch (_) {}
    return;
  }
  if (type === 'market_db_proxy_request') {
    try {
      hooks.handleMarketDbProxyRequest?.(chatServiceWorker, message, 'chat');
    } catch (error) {
      appendDebug('chat_worker_market_db_proxy_failed', {
        code: String(error?.code || ''),
        message: String(error?.message || error || 'market_db proxy failed'),
      });
    }
    return;
  }
  if (type === 'chat_worker_ready') {
    appendDebug('chat_worker_ready', {
      pid: Number(message.pid || chatServiceWorker?.pid || 0),
    });
    return;
  }
  if (type === 'chat_worker_event') {
    try {
      hooks.publishFrontendEvent?.(
        String(message.eventType || '').trim(),
        String(message.domain || '').trim(),
        message.payload && typeof message.payload === 'object' ? message.payload : {},
      );
    } catch (_) {}
    return;
  }
  if (type !== 'chat_worker_response') return;
  const requestId = String(message.requestId || '').trim();
  const pending = pendingRequests.get(requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(requestId);
  if (message.ok === true) {
    pending.resolve(message.result);
    return;
  }
  const error = new Error(String(message.error || 'chat worker request failed'));
  error.statusCode = Number(message.statusCode || 500);
  pending.reject(error);
}

function startChatWorker() {
  if (process.env.BSV_MARKET_DISABLE_CHAT_SERVICE === '1') return null;
  if (chatServiceWorker && !chatServiceWorker.killed) return chatServiceWorker;
  const workerPath = path.join(__dirname, 'chat_service_subprocess.js');
  chatServiceWorker = fork(workerPath, [], {
    cwd: __dirname,
    env: {
      ...process.env,
      BSV_MARKET_RUNTIME_BUS_CHILD: '1',
      BSV_MARKET_PROCESS_ROLE: 'chat_service_worker',
      BSV_MARKET_DISABLE_CHAT_STEWARD: '0',
    },
    stdio: 'inherit',
  });
  messageQueue.registerChildProcess(chatServiceWorker);
  appendDebug('chat_worker_spawn', { pid: chatServiceWorker.pid || null });
  chatServiceWorker.on('message', handleChatWorkerMessage);
  chatServiceWorker.on('error', (error) => {
    appendDebug('chat_worker_error', {
      code: String(error?.code || ''),
      message: String(error?.message || error || 'unknown worker error'),
    });
  });
  chatServiceWorker.on('exit', (code, signal) => {
    appendDebug('chat_worker_exit', { code, signal });
    chatServiceWorker = null;
    rejectPendingRequests(new Error('chat worker exited'));
    scheduleChatWorkerRestart();
  });
  try {
    hooks.sendChatWorkerAuthSnapshot?.(chatServiceWorker, { source: 'chat_worker_startup' });
  } catch (_) {}
  return chatServiceWorker;
}

function callChatWorker(method, args = [], options = {}) {
  const worker = startChatWorker();
  if (!worker || worker.killed || worker.connected === false) {
    return Promise.reject(new Error('chat worker unavailable'));
  }
  const requestId = `chat-${process.pid}-${Date.now()}-${nextRequestId++}`;
  const timeoutMs = Math.max(5000, Number(options.timeoutMs || 20000));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`chat worker timeout: ${method}`));
    }, timeoutMs);
    timeout.unref?.();
    pendingRequests.set(requestId, { resolve, reject, timeout });
    try {
      worker.send({
        type: 'chat_worker_request',
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

function stopChatWorker() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (!chatServiceWorker || chatServiceWorker.killed) return;
  try {
    chatServiceWorker.kill();
  } catch (_) {}
}

module.exports = {
  callChatWorker,
  getChatWorker() {
    return chatServiceWorker;
  },
  setChatWorkerHooks,
  startChatWorker,
  stopChatWorker,
};
