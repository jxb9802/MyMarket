'use strict';

const dgram = require('dgram');

const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_SUCCESS = 0x0101;
const STUN_MAGIC_COOKIE = 0x2112A442;
const ATTR_XOR_MAPPED_ADDRESS = 0x0020;

function normalizeString(value) {
  return String(value || '').trim();
}

function parseIpv4(address) {
  const parts = normalizeString(address).split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isStunBindingRequest(message) {
  if (!Buffer.isBuffer(message) || message.length < 20) return false;
  if (message.readUInt16BE(0) !== STUN_BINDING_REQUEST) return false;
  if (message.readUInt32BE(4) !== STUN_MAGIC_COOKIE) return false;
  return (message[0] & 0xc0) === 0;
}

function buildXorMappedAddressAttr(address, port) {
  const ipv4 = parseIpv4(address);
  if (!ipv4) return null;
  const attr = Buffer.alloc(12);
  attr.writeUInt16BE(ATTR_XOR_MAPPED_ADDRESS, 0);
  attr.writeUInt16BE(8, 2);
  attr[4] = 0;
  attr[5] = 0x01;
  attr.writeUInt16BE((Number(port || 0) ^ (STUN_MAGIC_COOKIE >>> 16)) & 0xffff, 6);
  const cookie = Buffer.alloc(4);
  cookie.writeUInt32BE(STUN_MAGIC_COOKIE, 0);
  for (let i = 0; i < 4; i += 1) attr[8 + i] = ipv4[i] ^ cookie[i];
  return attr;
}

function buildBindingSuccess(request, remote) {
  const attr = buildXorMappedAddressAttr(remote.address, remote.port);
  if (!attr) return null;
  const response = Buffer.alloc(20 + attr.length);
  response.writeUInt16BE(STUN_BINDING_SUCCESS, 0);
  response.writeUInt16BE(attr.length, 2);
  response.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  request.copy(response, 8, 8, 20);
  attr.copy(response, 20);
  return response;
}

function createEmbeddedStunServer(options = {}) {
  const host = normalizeString(options.host || '0.0.0.0');
  const port = Math.max(1, Number(options.port || 3478));
  const appendDebug = typeof options.appendDebug === 'function' ? options.appendDebug : (() => {});
  let socket = null;
  let started = false;

  function start() {
    if (started && socket) return Promise.resolve({ started: true, reused: true, host, port });
    return new Promise((resolve) => {
      const nextSocket = dgram.createSocket('udp4');
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      nextSocket.on('message', (message, remote) => {
        try {
          if (!isStunBindingRequest(message)) return;
          const response = buildBindingSuccess(message, remote);
          if (!response) return;
          nextSocket.send(response, remote.port, remote.address);
        } catch (error) {
          appendDebug('embedded_stun_request_failed', {
            message: String(error?.message || error || ''),
            remote: `${remote?.address || ''}:${remote?.port || ''}`,
          });
        }
      });
      nextSocket.once('error', (error) => {
        try { nextSocket.close(); } catch (_) {}
        socket = null;
        started = false;
        appendDebug('embedded_stun_start_failed', {
          host,
          port,
          message: String(error?.message || error || ''),
          code: String(error?.code || ''),
        });
        finish({ started: false, host, port, reason: String(error?.code || error?.message || 'stun_start_failed') });
      });
      nextSocket.bind(port, host, () => {
        socket = nextSocket;
        started = true;
        appendDebug('embedded_stun_started', { host, port });
        finish({ started: true, host, port });
      });
    });
  }

  function stop() {
    if (!socket) return;
    try { socket.close(); } catch (_) {}
    socket = null;
    started = false;
  }

  function status() {
    return { started, host, port };
  }

  return {
    start,
    stop,
    status,
  };
}

module.exports = {
  createEmbeddedStunServer,
  isStunBindingRequest,
  buildBindingSuccess,
};
