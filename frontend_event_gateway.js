function createFrontendEventGateway(options = {}) {
  const replayLimit = Math.max(1, Number(options.replayLimit || 2000));
  const heartbeatMs = Math.max(1000, Number(options.heartbeatMs || 15000));
  const buildBootstrapPayload = typeof options.buildBootstrapPayload === 'function'
    ? options.buildBootstrapPayload
    : async () => ({});
  const defaultDomains = Array.isArray(options.defaultDomains) && options.defaultDomains.length > 0
    ? options.defaultDomains.slice()
    : null;
  const logger = typeof options.logger === 'function' ? options.logger : null;

  let nextSeq = 1;
  let heartbeatTimer = null;
  const clients = new Map();
  const replayBuffer = [];

  function log(event, payload = {}) {
    if (!logger) return;
    try {
      logger(event, payload);
    } catch (_) {}
  }

  function makeEnvelope(type, domain, payload = {}, meta = {}) {
    return {
      seq: nextSeq++,
      ts: String(meta.ts || new Date().toISOString()),
      type: String(type || '').trim(),
      domain: String(domain || '').trim(),
      payload: payload && typeof payload === 'object' ? payload : {},
    };
  }

  function remember(envelope) {
    replayBuffer.push(envelope);
    if (replayBuffer.length > replayLimit) replayBuffer.splice(0, replayBuffer.length - replayLimit);
    return envelope;
  }

  function send(client, envelope) {
    if (!client?.ws || client.ws.readyState !== 1) return false;
    try {
      client.ws.send(JSON.stringify(envelope));
      client.lastSeq = Math.max(Number(client.lastSeq || 0), Number(envelope.seq || 0));
      return true;
    } catch (_) {
      return false;
    }
  }

  function broadcastEnvelope(envelope, predicate = null) {
    const remembered = remember(envelope);
    for (const client of clients.values()) {
      if (predicate && predicate(client) !== true) continue;
      send(client, remembered);
    }
    return remembered;
  }

  async function sendBootstrap(client, reason = 'runtime') {
    if (!client?.id) return null;
    let snapshot = null;
    try {
      snapshot = await buildBootstrapPayload(client.req, { domains: defaultDomains });
    } catch (err) {
      log('frontend_event_gateway_bootstrap_failed', {
        clientId: client.id,
        reason: String(reason || '').trim(),
        message: String(err?.message || 'bootstrap failed'),
      });
      return null;
    }
    const domains = snapshot?.domains && typeof snapshot.domains === 'object' ? snapshot.domains : {};
    const envelopes = [
      makeEnvelope('sync.snapshot.updated', 'sync', domains.sync || {}, { ts: snapshot?.serverTs }),
      makeEnvelope('wallet.snapshot.updated', 'wallet', domains.wallet || {}, { ts: snapshot?.serverTs }),
      makeEnvelope('wallet.ledger.updated', 'wallet', domains.walletLedger || {}, { ts: snapshot?.serverTs }),
      makeEnvelope('chat.snapshot.updated', 'chat', domains.chat || {}, { ts: snapshot?.serverTs }),
      makeEnvelope('order.snapshot.updated', 'order', domains.order || {}, { ts: snapshot?.serverTs }),
      makeEnvelope('catalog.snapshot.updated', 'catalog', domains.catalog || {}, { ts: snapshot?.serverTs }),
      makeEnvelope('profile.snapshot.updated', 'profile', domains.profile || {}, { ts: snapshot?.serverTs }),
      makeEnvelope('system.bootstrap', 'system', {
        reason: String(reason || 'runtime'),
        bootstrapVersion: Number(snapshot?.bootstrapVersion || 1),
      }, { ts: snapshot?.serverTs }),
    ];
    envelopes.forEach((envelope) => send(client, remember(envelope)));
    return snapshot;
  }

  async function sendBootstrapToAll(reason = 'runtime') {
    for (const client of clients.values()) {
      await sendBootstrap(client, reason);
    }
  }

  function buildDomainEnvelopes(snapshot, reason = 'runtime') {
    const domains = snapshot?.domains && typeof snapshot.domains === 'object' ? snapshot.domains : {};
    return {
      sync: [makeEnvelope('sync.snapshot.updated', 'sync', domains.sync || {}, { ts: snapshot?.serverTs })],
      wallet: [makeEnvelope('wallet.snapshot.updated', 'wallet', domains.wallet || {}, { ts: snapshot?.serverTs })],
      walletLedger: [makeEnvelope('wallet.ledger.updated', 'wallet', domains.walletLedger || {}, { ts: snapshot?.serverTs })],
      chat: [makeEnvelope('chat.snapshot.updated', 'chat', domains.chat || {}, { ts: snapshot?.serverTs })],
      order: [makeEnvelope('order.snapshot.updated', 'order', domains.order || {}, { ts: snapshot?.serverTs })],
      catalog: [makeEnvelope('catalog.snapshot.updated', 'catalog', domains.catalog || {}, { ts: snapshot?.serverTs })],
      profile: [makeEnvelope('profile.snapshot.updated', 'profile', domains.profile || {}, { ts: snapshot?.serverTs })],
      system: [makeEnvelope('system.bootstrap', 'system', {
        reason: String(reason || 'runtime'),
        bootstrapVersion: Number(snapshot?.bootstrapVersion || 1),
      }, { ts: snapshot?.serverTs })],
    };
  }

  async function sendDomain(client, domain, reason = 'runtime') {
    if (!client?.id) return null;
    const safeDomain = String(domain || '').trim();
    let snapshot = null;
    try {
      snapshot = await buildBootstrapPayload(client.req, { domains: [safeDomain] });
    } catch (err) {
      log('frontend_event_gateway_domain_failed', {
        clientId: client.id,
        domain: safeDomain,
        reason: String(reason || '').trim(),
        message: String(err?.message || 'domain snapshot failed'),
      });
      return null;
    }
    const envelopesByDomain = buildDomainEnvelopes(snapshot, reason);
    const envelopes = Array.isArray(envelopesByDomain[safeDomain]) ? envelopesByDomain[safeDomain] : [];
    envelopes.forEach((envelope) => send(client, remember(envelope)));
    return snapshot;
  }

  async function sendDomainToAll(domain, reason = 'runtime') {
    for (const client of clients.values()) {
      await sendDomain(client, domain, reason);
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      broadcastEnvelope(makeEnvelope('system.heartbeat', 'system', {}));
    }, heartbeatMs);
    heartbeatTimer.unref?.();
  }

  function stopHeartbeat() {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function attachClient(ws, req) {
    const client = {
      id: `ws-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      ws,
      req,
      lastSeq: 0,
    };
    clients.set(client.id, client);
    startHeartbeat();
    ws.on('close', () => {
      clients.delete(client.id);
      if (clients.size === 0) stopHeartbeat();
    });
    ws.on('error', () => {
      clients.delete(client.id);
      if (clients.size === 0) stopHeartbeat();
    });
    const hello = makeEnvelope('system.hello', 'system', {
      heartbeatMs,
      replayLimit,
      clientId: client.id,
    });
    send(client, remember(hello));
    return client;
  }

  function replayFrom(client, afterSeq = 0) {
    const minSeq = Math.max(0, Number(afterSeq || 0));
    replayBuffer
      .filter((event) => Number(event?.seq || 0) > minSeq)
      .forEach((event) => send(client, event));
  }

  function publishInfo(type, domain, payload = {}, predicate = null) {
    return broadcastEnvelope(makeEnvelope(type, domain, payload), predicate);
  }

  function close() {
    stopHeartbeat();
    for (const client of clients.values()) {
      try {
        client.ws.close();
      } catch (_) {}
    }
    clients.clear();
  }

  return {
    attachClient,
    close,
    publishInfo,
    replayFrom,
    sendBootstrap,
    sendBootstrapToAll,
    sendDomain,
    sendDomainToAll,
  };
}

module.exports = {
  createFrontendEventGateway,
};
