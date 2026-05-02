const runtimeBus = require('./runtime_bus');

const MODE_TRANSIENT = 'transient';
const MODE_DURABLE = 'durable';

function normalizeMode(mode) {
  const normalized = String(mode || MODE_TRANSIENT).trim().toLowerCase();
  return normalized === MODE_DURABLE ? MODE_DURABLE : MODE_TRANSIENT;
}

function publish(topic, payload = {}, options = {}) {
  const mode = normalizeMode(options.mode);
  if (mode === MODE_DURABLE) {
    const marketDb = require('../market_db');
    const queueName = String(options.queueName || topic || '').trim();
    const messageId = String(options.messageId || '').trim() || `${queueName}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    return marketDb.enqueueDurableMessage({
      queueName,
      topic: String(topic || queueName),
      messageId,
      dedupeKey: String(options.dedupeKey || '').trim(),
      priority: Math.max(0, Number(options.priority || 100)),
      createdAt: String(options.ts || new Date().toISOString()),
      payload: payload && typeof payload === 'object' ? payload : {},
    });
  }
  return runtimeBus.publish(topic, payload, {
    source: String(options.source || 'message_queue'),
    ts: String(options.ts || new Date().toISOString()),
    originPid: Number(options.originPid || process.pid || 0),
  });
}

function subscribe(topic, handler, options = {}) {
  const mode = normalizeMode(options.mode);
  if (mode === MODE_DURABLE) {
    const error = new Error(`durable subscriptions are pull-only: ${String(topic || '')}`);
    error.code = 'MESSAGE_QUEUE_DURABLE_PULL_ONLY';
    throw error;
  }
  return runtimeBus.subscribe(topic, handler);
}

async function claim(queueName, options = {}) {
  const marketDb = require('../market_db');
  return marketDb.claimNextDurableMessage({
    queueName: String(queueName || '').trim(),
    workerId: String(options.workerId || '').trim(),
    claimedAt: String(options.claimedAt || new Date().toISOString()),
  });
}

async function finish(queueName, messageId, options = {}) {
  const marketDb = require('../market_db');
  return marketDb.finishDurableMessage({
    queueName: String(queueName || '').trim(),
    messageId: String(messageId || '').trim(),
    status: String(options.status || '').trim(),
    finishedAt: String(options.finishedAt || new Date().toISOString()),
    error: String(options.error || ''),
    result: options.result && typeof options.result === 'object' ? options.result : null,
    resetClaim: options.resetClaim === true,
  });
}

async function release(queueName, messageId, options = {}) {
  const marketDb = require('../market_db');
  return marketDb.releaseDurableMessage({
    queueName: String(queueName || '').trim(),
    messageId: String(messageId || '').trim(),
    updatedAt: String(options.updatedAt || new Date().toISOString()),
  });
}

async function listDurable(queueName, options = {}) {
  const marketDb = require('../market_db');
  return marketDb.listDurableMessages({
    queueName: String(queueName || '').trim(),
    status: String(options.status || '').trim(),
    limit: Math.max(1, Number(options.limit || 1000)),
  });
}

function registerChildProcess(worker) {
  return runtimeBus.registerChildProcess(worker);
}

function handleChildProcessMessage(worker, message) {
  return runtimeBus.handleChildRuntimeBusMessage(worker, message);
}

module.exports = {
  MODE_TRANSIENT,
  MODE_DURABLE,
  publish,
  subscribe,
  claim,
  finish,
  release,
  listDurable,
  registerChildProcess,
  handleChildProcessMessage,
};
