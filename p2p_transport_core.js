const http = require('http');
const dgram = require('dgram');
const EventEmitter = require('events');
const wsPackage = require('ws');

const {
  normalizeWalletId,
  normalizeDeviceId,
  makeEnvelope,
  validateEnvelope,
  httpBaseToWsUrl,
  isoNow,
  randomId,
} = require('./p2p_protocol');

const { WebSocketServer, WebSocket } = wsPackage;

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class RelayHub {
  constructor(logger = () => {}) {
    this.logger = logger;
    this.clients = new Map();
  }

  register(walletId, socket, meta = {}) {
    const key = normalizeWalletId(walletId);
    if (!key) throw new Error('walletId is required for relay register');
    const current = this.clients.get(key);
    if (current && current.socket && current.socket !== socket) {
      try { current.socket.close(4000, 'superseded'); } catch (_) {}
    }
    this.clients.set(key, {
      socket,
      registeredAt: isoNow(),
      ...meta,
    });
    this.logger('relay.registered', { walletId: key });
  }

  unregister(walletId, socket = null) {
    const key = normalizeWalletId(walletId);
    const current = this.clients.get(key);
    if (!current) return false;
    if (socket && current.socket !== socket) return false;
    this.clients.delete(key);
    this.logger('relay.unregistered', { walletId: key });
    return true;
  }

  forward(targetWalletId, payload) {
    const key = normalizeWalletId(targetWalletId);
    const current = this.clients.get(key);
    if (!current || !current.socket || current.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    current.socket.send(JSON.stringify(payload));
    return true;
  }
}

class P2PTransportCore extends EventEmitter {
  constructor(options = {}) {
    super();
    this.walletId = normalizeWalletId(options.walletId || options.deviceId || 'probe-wallet');
    this.deviceId = normalizeDeviceId(options.deviceId, this.walletId);
    this.host = String(options.host || '0.0.0.0');
    this.port = Number(options.port || 9777);
    this.udpPort = Number(options.udpPort || this.port);
    this.advertiseHost = String(options.advertiseHost || options.publicHost || '127.0.0.1');
    this.online = options.online !== false;
    this.blacklist = new Set((Array.isArray(options.blacklist) ? options.blacklist : String(options.blacklist || '').split(',')).map((item) => normalizeWalletId(item)).filter(Boolean));
    this.enableRelay = options.enableRelay !== false;
    this.relayUrl = String(options.relayUrl || '').trim();
    this.logger = typeof options.logger === 'function' ? options.logger : (() => {});
    this.httpServer = null;
    this.wsServer = null;
    this.relayWss = null;
    this.relaySocket = null;
    this.relayHub = new RelayHub((event, payload) => this.log(event, payload));
    this.udpSocket = null;
    this.directSessions = new Map();
    this.pendingUdpAcks = new Map();
    this.started = false;
  }

  log(event, payload = {}) {
    this.logger(event, payload);
    this.emit('log', { ts: isoNow(), event, ...payload });
  }

  getInfo() {
    return {
      walletId: this.walletId,
      deviceId: this.deviceId,
      online: this.online,
      host: this.host,
      port: this.port,
      udpPort: this.udpPort,
      advertiseHost: this.advertiseHost,
      httpBaseUrl: `http://${this.advertiseHost}:${this.port}`,
      wsUrl: `ws://${this.advertiseHost}:${this.port}/p2p/ws`,
      relayUrl: this.enableRelay ? `ws://${this.advertiseHost}:${this.port}/p2p/relay` : '',
      protocolVersion: 1,
      blacklistSize: this.blacklist.size,
    };
  }

  setOnline(value) {
    this.online = Boolean(value);
    this.log('state.online_changed', { online: this.online });
  }

  setBlacklist(values) {
    this.blacklist = new Set((Array.isArray(values) ? values : []).map((item) => normalizeWalletId(item)).filter(Boolean));
    this.log('state.blacklist_changed', { size: this.blacklist.size });
  }

  async start() {
    if (this.started) return this;
    this.httpServer = http.createServer(async (req, res) => {
      try {
        await this.handleHttp(req, res);
      } catch (err) {
        this.log('http.error', { message: String(err?.message || err) });
        writeJson(res, 500, { success: false, error: String(err?.message || err) });
      }
    });

    this.wsServer = new WebSocketServer({ noServer: true });
    this.wsServer.on('connection', (socket, req, context) => {
      this.handleWsConnection(socket, req, context || {});
    });

    this.httpServer.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      if (url.pathname !== '/p2p/ws' && url.pathname !== '/p2p/relay') {
        socket.destroy();
        return;
      }
      this.wsServer.handleUpgrade(req, socket, head, (ws) => {
        this.wsServer.emit('connection', ws, req, { path: url.pathname });
      });
    });

    await new Promise((resolve, reject) => {
      this.httpServer.once('error', reject);
      this.httpServer.listen(this.port, this.host, resolve);
    });

    this.udpSocket = dgram.createSocket('udp4');
    this.udpSocket.on('message', (msg, rinfo) => this.handleUdpMessage(msg, rinfo));
    this.udpSocket.on('error', (err) => this.log('udp.error', { message: String(err?.message || err) }));
    await new Promise((resolve, reject) => {
      this.udpSocket.once('error', reject);
      this.udpSocket.bind(this.udpPort, this.host, resolve);
    });

    this.started = true;
    this.log('transport.started', this.getInfo());
    if (this.relayUrl) await this.connectRelay(this.relayUrl).catch((err) => {
      this.log('relay.connect_failed', { relayUrl: this.relayUrl, message: String(err?.message || err) });
    });
    return this;
  }

  async stop() {
    if (!this.started) return;
    if (this.relaySocket) {
      try { this.relaySocket.close(); } catch (_) {}
      this.relaySocket = null;
    }
    for (const session of this.directSessions.values()) {
      try { session.socket.close(); } catch (_) {}
    }
    this.directSessions.clear();
    if (this.udpSocket) {
      await new Promise((resolve) => this.udpSocket.close(() => resolve()));
      this.udpSocket = null;
    }
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(() => resolve()));
      this.httpServer = null;
    }
    this.started = false;
    this.log('transport.stopped', { walletId: this.walletId });
  }

  async handleHttp(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      return writeJson(res, 200, { success: true, status: 'ok', online: this.online });
    }
    if (req.method === 'GET' && url.pathname === '/p2p/info') {
      return writeJson(res, 200, { success: true, info: this.getInfo() });
    }
    if (req.method === 'POST' && url.pathname === '/p2p/state') {
      const body = await parseJsonBody(req);
      this.setOnline(body?.online !== false);
      return writeJson(res, 200, { success: true, online: this.online });
    }
    if (req.method === 'POST' && url.pathname === '/p2p/hello') {
      const body = await parseJsonBody(req);
      const fromWalletId = normalizeWalletId(body?.fromWalletId);
      if (!fromWalletId) return writeJson(res, 400, { success: false, error: 'fromWalletId is required' });
      if (this.blacklist.has(fromWalletId)) {
        return writeJson(res, 403, { success: false, accepted: false, reason: 'blocked' });
      }
      if (!this.online) {
        return writeJson(res, 409, { success: false, accepted: false, reason: 'offline' });
      }
      this.log('hello.accepted', { fromWalletId });
      return writeJson(res, 200, {
        success: true,
        accepted: true,
        walletId: this.walletId,
        deviceId: this.deviceId,
        ts: isoNow(),
        info: this.getInfo(),
      });
    }
    if (req.method === 'POST' && url.pathname === '/p2p/holepunch/request') {
      const body = await parseJsonBody(req);
      const fromWalletId = normalizeWalletId(body?.fromWalletId);
      const fromHost = String(body?.fromHost || '').trim();
      const fromUdpPort = Number(body?.fromUdpPort || 0);
      if (!fromWalletId || !fromHost || !fromUdpPort) {
        return writeJson(res, 400, { success: false, error: 'fromWalletId, fromHost, fromUdpPort are required' });
      }
      if (this.blacklist.has(fromWalletId)) {
        return writeJson(res, 403, { success: false, accepted: false, reason: 'blocked' });
      }
      if (!this.online) {
        return writeJson(res, 409, { success: false, accepted: false, reason: 'offline' });
      }
      const packet = makeEnvelope('punch', {
        walletId: this.walletId,
        targetWalletId: fromWalletId,
        nonce: randomId('punch'),
      });
      for (let i = 0; i < 3; i += 1) {
        this.sendUdpPacket(packet, fromHost, fromUdpPort);
      }
      this.log('holepunch.request_accepted', { fromWalletId, fromHost, fromUdpPort });
      return writeJson(res, 200, {
        success: true,
        accepted: true,
        walletId: this.walletId,
        advertiseHost: this.advertiseHost,
        udpPort: this.udpPort,
        ts: isoNow(),
      });
    }
    return writeJson(res, 404, { success: false, error: 'not found' });
  }

  handleWsConnection(socket, _req, context = {}) {
    const path = String(context.path || '/p2p/ws');
    if (path === '/p2p/relay') {
      this.handleRelaySocket(socket);
      return;
    }
    const session = {
      sessionId: randomId('session'),
      walletId: '',
      socket,
      openedAt: isoNow(),
      path: 'direct',
    };
    socket.once('message', (raw) => {
      try {
        const packet = validateEnvelope(JSON.parse(String(raw || '{}')), 'hello');
        const peerWalletId = normalizeWalletId(packet.walletId);
        if (!peerWalletId) throw new Error('walletId is required');
        if (this.blacklist.has(peerWalletId)) {
          socket.send(JSON.stringify(makeEnvelope('hello_reject', { reason: 'blocked', walletId: this.walletId })));
          socket.close(4003, 'blocked');
          return;
        }
        if (!this.online) {
          socket.send(JSON.stringify(makeEnvelope('hello_reject', { reason: 'offline', walletId: this.walletId })));
          socket.close(4004, 'offline');
          return;
        }
        session.walletId = peerWalletId;
        this.directSessions.set(session.sessionId, session);
        socket.send(JSON.stringify(makeEnvelope('hello_ack', {
          sessionId: session.sessionId,
          walletId: this.walletId,
          deviceId: this.deviceId,
          ts: isoNow(),
        })));
        this.log('direct.session_opened', { sessionId: session.sessionId, peerWalletId });
        this.emit('session_opened', { path: 'direct', sessionId: session.sessionId, peerWalletId });
        socket.on('message', (frame) => this.handleDirectFrame(session, frame));
        socket.on('close', () => {
          this.directSessions.delete(session.sessionId);
          this.log('direct.session_closed', { sessionId: session.sessionId, peerWalletId });
          this.emit('session_closed', { path: 'direct', sessionId: session.sessionId, peerWalletId });
        });
      } catch (err) {
        socket.send(JSON.stringify(makeEnvelope('hello_reject', { reason: 'invalid', error: String(err?.message || err) })));
        socket.close(4002, 'invalid');
      }
    });
  }

  handleDirectFrame(session, raw) {
    let packet;
    try {
      packet = validateEnvelope(JSON.parse(String(raw || '{}')));
    } catch (err) {
      this.log('direct.packet_invalid', { sessionId: session.sessionId, message: String(err?.message || err) });
      return;
    }
    if (packet.type === 'test_message') {
      this.log('direct.message_received', {
        sessionId: session.sessionId,
        peerWalletId: session.walletId,
        text: String(packet.text || ''),
      });
      this.emit('message_received', {
        path: 'direct',
        sessionId: session.sessionId,
        peerWalletId: session.walletId,
        text: String(packet.text || ''),
      });
      session.socket.send(JSON.stringify(makeEnvelope('ack', {
        sessionId: session.sessionId,
        msgId: String(packet.msgId || ''),
        walletId: this.walletId,
      })));
      return;
    }
    if (packet.type === 'ack') {
      this.emit('message_acked', {
        path: 'direct',
        sessionId: session.sessionId,
        peerWalletId: session.walletId,
        msgId: String(packet.msgId || ''),
      });
    }
  }

  handleRelaySocket(socket) {
    let registeredWalletId = '';
    socket.on('message', (raw) => {
      let packet;
      try {
        packet = validateEnvelope(JSON.parse(String(raw || '{}')));
      } catch (err) {
        socket.send(JSON.stringify(makeEnvelope('relay_error', { error: String(err?.message || err) })));
        return;
      }
      if (packet.type === 'relay_register') {
        registeredWalletId = normalizeWalletId(packet.walletId);
        this.relayHub.register(registeredWalletId, socket, { deviceId: String(packet.deviceId || '') });
        socket.send(JSON.stringify(makeEnvelope('relay_registered', {
          walletId: this.walletId,
          registeredWalletId,
          ts: isoNow(),
        })));
        return;
      }
      if (packet.type === 'relay_send') {
        const targetWalletId = normalizeWalletId(packet.targetWalletId);
        const forwarded = this.relayHub.forward(targetWalletId, makeEnvelope('relay_deliver', {
          fromWalletId: normalizeWalletId(packet.walletId),
          targetWalletId,
          msgId: String(packet.msgId || randomId('relay')),
          text: String(packet.text || ''),
          viaRelayWalletId: this.walletId,
        }));
        socket.send(JSON.stringify(makeEnvelope('relay_ack', {
          targetWalletId,
          delivered: forwarded,
          msgId: String(packet.msgId || ''),
        })));
      }
    });
    socket.on('close', () => {
      if (registeredWalletId) this.relayHub.unregister(registeredWalletId, socket);
    });
  }

  handleUdpMessage(raw, rinfo) {
    let packet;
    try {
      packet = validateEnvelope(JSON.parse(String(raw || '{}')));
    } catch (_) {
      return;
    }
    if (packet.type === 'punch' || packet.type === 'udp_probe') {
      const replyType = packet.type === 'punch' ? 'punch_ack' : 'udp_probe_ack';
      this.sendUdpPacket(makeEnvelope(replyType, {
        walletId: this.walletId,
        targetWalletId: normalizeWalletId(packet.walletId),
        nonce: String(packet.nonce || ''),
      }), rinfo.address, rinfo.port);
      this.log('udp.probe_received', {
        type: packet.type,
        fromWalletId: normalizeWalletId(packet.walletId),
        host: rinfo.address,
        port: rinfo.port,
      });
      return;
    }
    if (packet.type === 'udp_test_message') {
      this.emit('message_received', {
        path: 'holepunch',
        peerWalletId: normalizeWalletId(packet.walletId),
        msgId: String(packet.msgId || ''),
        text: String(packet.text || ''),
      });
      this.log('udp.message_received', {
        fromWalletId: normalizeWalletId(packet.walletId),
        text: String(packet.text || ''),
      });
      this.sendUdpPacket(makeEnvelope('udp_test_ack', {
        walletId: this.walletId,
        targetWalletId: normalizeWalletId(packet.walletId),
        msgId: String(packet.msgId || ''),
      }), rinfo.address, rinfo.port);
      return;
    }
    if (packet.type === 'punch_ack' || packet.type === 'udp_probe_ack' || packet.type === 'udp_test_ack') {
      const key = String(packet.nonce || packet.msgId || '');
      const waiter = this.pendingUdpAcks.get(key);
      if (waiter) {
        waiter.resolve({
          type: packet.type,
          fromWalletId: normalizeWalletId(packet.walletId),
          host: rinfo.address,
          port: rinfo.port,
          packet,
        });
        this.pendingUdpAcks.delete(key);
      }
    }
  }

  sendUdpPacket(packet, host, port) {
    if (!this.udpSocket) throw new Error('udp socket not started');
    const buf = Buffer.from(JSON.stringify(packet));
    this.udpSocket.send(buf, port, host);
  }

  waitForUdpAck(key, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingUdpAcks.delete(key);
        reject(new Error(`udp ack timeout for ${key}`));
      }, timeoutMs);
      this.pendingUdpAcks.set(key, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
    });
  }

  async fetchPeerInfo(targetHttpBaseUrl) {
    const res = await fetch(`${String(targetHttpBaseUrl).replace(/\/$/, '')}/p2p/info`);
    const json = await res.json();
    if (!json?.success) throw new Error(String(json?.error || 'failed to fetch peer info'));
    return json.info;
  }

  async directConnect(targetHttpBaseUrl, options = {}) {
    const info = await this.fetchPeerInfo(targetHttpBaseUrl);
    const wsUrl = httpBaseToWsUrl(targetHttpBaseUrl, '/p2p/ws');
    const socket = new WebSocket(wsUrl);
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { socket.close(); } catch (_) {}
        reject(new Error('direct connect timeout'));
      }, Number(options.timeoutMs || 4000));
      socket.once('open', () => {
        socket.send(JSON.stringify(makeEnvelope('hello', {
          walletId: this.walletId,
          deviceId: this.deviceId,
          online: this.online,
        })));
      });
      socket.once('message', (raw) => {
        clearTimeout(timer);
        const packet = JSON.parse(String(raw || '{}'));
        if (packet.type === 'hello_ack') {
          resolve({
            success: true,
            path: 'direct',
            sessionId: String(packet.sessionId || ''),
            peerWalletId: String(packet.walletId || info.walletId || ''),
            socket,
          });
          return;
        }
        try { socket.close(); } catch (_) {}
        reject(new Error(String(packet.reason || packet.error || 'direct hello rejected')));
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async directSendText(targetHttpBaseUrl, text, options = {}) {
    const connection = await this.directConnect(targetHttpBaseUrl, options);
    const msgId = randomId('msg');
    const ackPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        try { connection.socket.close(); } catch (_) {}
        reject(new Error('direct ack timeout'));
      }, Number(options.timeoutMs || 4000));
      connection.socket.on('message', (raw) => {
        const packet = JSON.parse(String(raw || '{}'));
        if (packet.type === 'ack' && String(packet.msgId || '') === msgId) {
          clearTimeout(timer);
          try { connection.socket.close(); } catch (_) {}
          resolve({
            success: true,
            path: 'direct',
            msgId,
            peerWalletId: connection.peerWalletId,
          });
        }
      });
    });
    connection.socket.send(JSON.stringify(makeEnvelope('test_message', {
      msgId,
      sessionId: connection.sessionId,
      walletId: this.walletId,
      text: String(text || ''),
    })));
    return await ackPromise;
  }

  async holePunchTest(targetHttpBaseUrl, options = {}) {
    const peer = await this.fetchPeerInfo(targetHttpBaseUrl);
    const nonce = randomId('punch');
    const prepareRes = await fetch(`${String(targetHttpBaseUrl).replace(/\/$/, '')}/p2p/holepunch/request`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromWalletId: this.walletId,
        fromHost: this.advertiseHost,
        fromUdpPort: this.udpPort,
      }),
    });
    const prepareJson = await prepareRes.json();
    if (!prepareJson?.success || prepareJson?.accepted !== true) {
      throw new Error(String(prepareJson?.reason || prepareJson?.error || 'holepunch request rejected'));
    }
    const waitAck = this.waitForUdpAck(nonce, Number(options.timeoutMs || 4000));
    for (let i = 0; i < 3; i += 1) {
      this.sendUdpPacket(makeEnvelope('punch', {
        walletId: this.walletId,
        targetWalletId: normalizeWalletId(peer.walletId),
        nonce,
      }), String(peer.advertiseHost || ''), Number(peer.udpPort || 0));
      await delay(100);
    }
    const ack = await waitAck;
    this.log('holepunch.succeeded', {
      targetWalletId: normalizeWalletId(peer.walletId),
      host: ack.host,
      port: ack.port,
    });
    return {
      success: true,
      path: 'holepunch',
      peerWalletId: normalizeWalletId(peer.walletId),
      host: ack.host,
      port: ack.port,
    };
  }

  async holePunchSendText(targetHttpBaseUrl, text, options = {}) {
    const peer = await this.fetchPeerInfo(targetHttpBaseUrl);
    await this.holePunchTest(targetHttpBaseUrl, options);
    const msgId = randomId('udpmsg');
    const ackPromise = this.waitForUdpAck(msgId, Number(options.timeoutMs || 4000));
    this.sendUdpPacket(makeEnvelope('udp_test_message', {
      walletId: this.walletId,
      targetWalletId: normalizeWalletId(peer.walletId),
      msgId,
      text: String(text || ''),
    }), String(peer.advertiseHost || ''), Number(peer.udpPort || 0));
    await ackPromise;
    return {
      success: true,
      path: 'holepunch',
      msgId,
      peerWalletId: normalizeWalletId(peer.walletId),
    };
  }

  async connectRelay(relayHttpBaseUrl) {
    const wsUrl = httpBaseToWsUrl(relayHttpBaseUrl, '/p2p/relay');
    return await new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        try { socket.close(); } catch (_) {}
        reject(new Error('relay connect timeout'));
      }, 4000);
      socket.once('open', () => {
        socket.send(JSON.stringify(makeEnvelope('relay_register', {
          walletId: this.walletId,
          deviceId: this.deviceId,
        })));
      });
      socket.on('message', (raw) => {
        const packet = JSON.parse(String(raw || '{}'));
        if (packet.type === 'relay_registered') {
          clearTimeout(timer);
          this.relaySocket = socket;
          this.relayUrl = relayHttpBaseUrl;
          this.log('relay.connected', { relayHttpBaseUrl });
          resolve({ success: true });
          return;
        }
        if (packet.type === 'relay_deliver') {
          this.emit('message_received', {
            path: 'relay',
            peerWalletId: normalizeWalletId(packet.fromWalletId),
            msgId: String(packet.msgId || ''),
            text: String(packet.text || ''),
          });
          socket.send(JSON.stringify(makeEnvelope('relay_send', {
            walletId: this.walletId,
            targetWalletId: normalizeWalletId(packet.fromWalletId),
            msgId: String(packet.msgId || ''),
            text: `[relay-ack] ${packet.msgId || ''}`,
          })));
          return;
        }
        if (packet.type === 'relay_ack') {
          this.emit('message_acked', {
            path: 'relay',
            peerWalletId: normalizeWalletId(packet.targetWalletId),
            msgId: String(packet.msgId || ''),
            delivered: Boolean(packet.delivered),
          });
        }
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      socket.once('close', () => {
        if (this.relaySocket === socket) this.relaySocket = null;
      });
    });
  }

  async relaySendText(targetWalletId, text) {
    if (!this.relaySocket || this.relaySocket.readyState !== WebSocket.OPEN) {
      throw new Error('relay socket is not connected');
    }
    const msgId = randomId('relaymsg');
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('relay ack timeout')), 4000);
      const onMessage = (raw) => {
        const packet = JSON.parse(String(raw || '{}'));
        if (packet.type === 'relay_ack' && String(packet.msgId || '') === msgId) {
          clearTimeout(timer);
          this.relaySocket.off('message', onMessage);
          resolve({
            success: true,
            path: 'relay',
            msgId,
            targetWalletId: normalizeWalletId(targetWalletId),
            delivered: Boolean(packet.delivered),
          });
        }
      };
      this.relaySocket.on('message', onMessage);
      this.relaySocket.send(JSON.stringify(makeEnvelope('relay_send', {
        walletId: this.walletId,
        targetWalletId: normalizeWalletId(targetWalletId),
        msgId,
        text: String(text || ''),
      })));
    });
  }
}

module.exports = {
  P2PTransportCore,
};
