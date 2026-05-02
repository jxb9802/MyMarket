const crypto = require('crypto');
const { EventEmitter } = require('events');

const emitter = new EventEmitter();
emitter.setMaxListeners(64);

const events = [];
const consumerOffsets = new Map();
let nextSeq = 1;
const MAX_BUFFER = 5000;

function nowIso() {
  return new Date().toISOString();
}

function makeEvent(input = {}) {
  const event = {
    eventId: String(input.eventId || `evt_${crypto.randomUUID()}`),
    eventType: String(input.eventType || '').trim(),
    producer: String(input.producer || '').trim(),
    entityType: String(input.entityType || '').trim(),
    entityId: String(input.entityId || '').trim(),
    ts: String(input.ts || nowIso()),
    schemaVersion: Math.max(1, Number(input.schemaVersion || 1)),
    causationId: String(input.causationId || '').trim(),
    correlationId: String(input.correlationId || '').trim(),
    dedupeKey: String(input.dedupeKey || '').trim(),
    payload: input.payload && typeof input.payload === 'object' ? { ...input.payload } : {},
  };
  if (!event.eventType) throw new Error('eventType is required');
  if (!event.producer) throw new Error('producer is required');
  if (!event.entityType) throw new Error('entityType is required');
  if (!event.entityId) throw new Error('entityId is required');
  return event;
}

function trimBuffer() {
  let minOffset = Infinity;
  consumerOffsets.forEach((value) => {
    minOffset = Math.min(minOffset, Math.max(0, Number(value?.lastSeq || 0)));
  });
  const safeMin = Number.isFinite(minOffset) ? minOffset : (nextSeq - MAX_BUFFER);
  while (events.length > 0) {
    const firstSeq = Number(events[0]?.seq || 0);
    if (events.length <= MAX_BUFFER && firstSeq > safeMin) break;
    events.shift();
  }
}

function emitLocal(event) {
  emitter.emit(event.eventType, event);
  emitter.emit('*', event);
}

async function appendEvent(input = {}) {
  const base = makeEvent(input);
  const event = {
    ...base,
    seq: nextSeq++,
  };
  events.push(event);
  trimBuffer();
  emitLocal(event);
  return event;
}

async function appendEvents(inputs = []) {
  const written = [];
  for (const item of inputs) written.push(await appendEvent(item));
  return written;
}

async function listEventsAfter(afterSeq = 0, limit = 100) {
  const minSeq = Math.max(0, Number(afterSeq || 0));
  const maxItems = Math.max(1, Math.min(1000, Number(limit || 100)));
  return events.filter((event) => Number(event?.seq || 0) > minSeq).slice(0, maxItems);
}

async function getConsumerOffset(consumerName) {
  const normalized = String(consumerName || '').trim();
  const current = consumerOffsets.get(normalized);
  return {
    consumerName: normalized,
    lastSeq: Math.max(0, Number(current?.lastSeq || 0)),
    updatedAt: String(current?.updatedAt || ''),
  };
}

async function commitConsumerOffset(consumerName, lastSeq) {
  const normalized = String(consumerName || '').trim();
  const row = {
    consumerName: normalized,
    lastSeq: Math.max(0, Number(lastSeq || 0)),
    updatedAt: nowIso(),
  };
  consumerOffsets.set(normalized, row);
  trimBuffer();
  return row;
}

function subscribe(eventType, handler) {
  emitter.on(eventType || '*', handler);
  return () => emitter.off(eventType || '*', handler);
}

module.exports = {
  makeEvent,
  appendEvent,
  appendEvents,
  listEventsAfter,
  getConsumerOffset,
  commitConsumerOffset,
  subscribe,
};
