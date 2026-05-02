const EventEmitter = require('events');
const { makeEnvelope, assertEnvelope } = require('../shared/event_envelope');

class RuntimeBus extends EventEmitter {
  publish(topic, payload, options = {}) {
    const envelope = makeEnvelope(topic, payload, options);
    this.emit(String(topic || '').trim(), envelope);
    this.emit('*', envelope);
    return envelope;
  }

  subscribe(topic, handler) {
    const wrapped = (envelope) => handler(assertEnvelope(envelope));
    this.on(String(topic || '').trim(), wrapped);
    return () => this.off(String(topic || '').trim(), wrapped);
  }
}

function createRuntimeBus() {
  return new RuntimeBus();
}

module.exports = {
  createRuntimeBus,
};
