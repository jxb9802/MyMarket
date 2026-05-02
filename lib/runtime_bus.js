const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(128);

const childSubscriptions = new Map();
let childProcessListenerAttached = false;

function normalizeTopic(topic) {
  return String(topic || '').trim();
}

function ensureChildProcessListener() {
  if (childProcessListenerAttached || typeof process.on !== 'function') return;
  childProcessListenerAttached = true;
  process.on('message', (message) => {
    if (!message || typeof message !== 'object') return;
    if (String(message.type || '') !== 'runtime_bus_event') return;
    const topic = normalizeTopic(message.topic);
    if (!topic) return;
    emitter.emit(topic, message.payload, {
      topic,
      source: String(message.source || 'runtime_bus'),
      originPid: Number(message.originPid || 0),
      ts: String(message.ts || new Date().toISOString()),
    });
    emitter.emit('*', message.payload, {
      topic,
      source: String(message.source || 'runtime_bus'),
      originPid: Number(message.originPid || 0),
      ts: String(message.ts || new Date().toISOString()),
    });
  });
}

function dispatchLocal(topic, payload, meta = {}) {
  const normalized = normalizeTopic(topic);
  if (!normalized) return;
  const envelope = {
    topic: normalized,
    source: String(meta.source || 'runtime_bus'),
    originPid: Number(meta.originPid || process.pid || 0),
    ts: String(meta.ts || new Date().toISOString()),
  };
  emitter.emit(normalized, payload, envelope);
  emitter.emit('*', payload, envelope);
}

function dispatchToChildren(topic, payload, meta = {}) {
  const normalized = normalizeTopic(topic);
  if (!normalized) return;
  for (const [worker, topics] of childSubscriptions.entries()) {
    if (!worker || worker.killed) continue;
    if (!(topics.has(normalized) || topics.has('*'))) continue;
    try {
      worker.send({
        type: 'runtime_bus_event',
        topic: normalized,
        payload,
        source: String(meta.source || 'runtime_bus'),
        originPid: Number(meta.originPid || process.pid || 0),
        ts: String(meta.ts || new Date().toISOString()),
      });
    } catch (_) {}
  }
}

function handleChildRuntimeBusMessage(worker, message) {
  const msgType = String(message?.type || '');
  if (msgType === 'runtime_bus_subscribe') {
    const topic = normalizeTopic(message.topic);
    if (!topic) return true;
    const topics = childSubscriptions.get(worker) || new Set();
    topics.add(topic);
    childSubscriptions.set(worker, topics);
    return true;
  }
  if (msgType === 'runtime_bus_unsubscribe') {
    const topic = normalizeTopic(message.topic);
    const topics = childSubscriptions.get(worker);
    if (!topics) return true;
    if (topic) topics.delete(topic);
    if (topics.size === 0) childSubscriptions.delete(worker);
    return true;
  }
  if (msgType === 'runtime_bus_publish') {
    const topic = normalizeTopic(message.topic);
    if (!topic) return true;
    const payload = message.payload;
    const meta = {
      source: String(message.source || 'runtime_bus_child'),
      originPid: Number(worker?.pid || message.originPid || 0),
      ts: String(message.ts || new Date().toISOString()),
    };
    dispatchLocal(topic, payload, meta);
    dispatchToChildren(topic, payload, meta);
    return true;
  }
  return false;
}

function registerChildProcess(worker) {
  if (!worker || typeof worker.on !== 'function') return () => {};
  const onExit = () => {
    childSubscriptions.delete(worker);
  };
  worker.on('exit', onExit);
  return () => {
    childSubscriptions.delete(worker);
    try {
      worker.off('exit', onExit);
    } catch (_) {}
  };
}

function publish(topic, payload = {}, meta = {}) {
  const normalized = normalizeTopic(topic);
  if (!normalized) return;
  if (typeof process.send === 'function' && process.env.BSV_MARKET_RUNTIME_BUS_CHILD === '1') {
    try {
      process.send({
        type: 'runtime_bus_publish',
        topic: normalized,
        payload,
        source: String(meta.source || 'runtime_bus_child'),
        originPid: Number(process.pid || 0),
        ts: String(meta.ts || new Date().toISOString()),
      });
    } catch (_) {}
    return;
  }
  dispatchLocal(normalized, payload, meta);
  dispatchToChildren(normalized, payload, meta);
}

function subscribe(topic, handler) {
  const normalized = normalizeTopic(topic) || '*';
  ensureChildProcessListener();
  emitter.on(normalized, handler);
  if (typeof process.send === 'function' && process.env.BSV_MARKET_RUNTIME_BUS_CHILD === '1') {
    try {
      process.send({
        type: 'runtime_bus_subscribe',
        topic: normalized,
      });
    } catch (_) {}
  }
  return () => {
    emitter.off(normalized, handler);
    if (typeof process.send === 'function' && process.env.BSV_MARKET_RUNTIME_BUS_CHILD === '1') {
      try {
        process.send({
          type: 'runtime_bus_unsubscribe',
          topic: normalized,
        });
      } catch (_) {}
    }
  };
}

module.exports = {
  handleChildRuntimeBusMessage,
  publish,
  registerChildProcess,
  subscribe,
};
