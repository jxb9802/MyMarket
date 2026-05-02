#!/usr/bin/env node
'use strict';

const net = require('net');

const host = process.argv[2] || '127.0.0.1';
const port = Math.max(1, Number(process.argv[3] || process.env.BSV_MARKET_RESTART_AGENT_PORT || 18765) || 18765);
const cmd = String(process.argv[4] || 'status').trim().toLowerCase();
const terminalTypesByCommand = {
  ping: new Set(['pong', 'command_error']),
  status: new Set(['status', 'status_error', 'command_error']),
  restart: new Set(['restart_result', 'command_error']),
};
const terminalTypes = terminalTypesByCommand[cmd] || new Set(['command_error']);

const socket = net.createConnection({ host, port }, () => {
  socket.write(`${JSON.stringify({ cmd })}\n`);
});

socket.setEncoding('utf8');
let buffer = '';
let closeScheduled = false;

function scheduleClose() {
  if (closeScheduled) return;
  closeScheduled = true;
  setTimeout(() => {
    socket.end();
  }, 50);
}

socket.on('data', (chunk) => {
  const text = String(chunk || '');
  process.stdout.write(text);
  buffer += text;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      const type = String(parsed?.type || '').trim();
      if (terminalTypes.has(type)) {
        scheduleClose();
      }
    } catch (_) {}
  }
});
socket.on('error', (error) => {
  process.stderr.write(`${JSON.stringify({
    ts: new Date().toISOString(),
    type: 'client_error',
    message: error?.message || String(error || 'socket error'),
  })}\n`);
  process.exitCode = 1;
});
socket.on('end', () => {
  if (buffer.trim()) process.stdout.write(`${buffer}\n`);
});
