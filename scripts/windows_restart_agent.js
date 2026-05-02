#!/usr/bin/env node
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_FILE = path.join(ROOT_DIR, '.env.market');
const DEFAULT_DATA_DIR = path.join(ROOT_DIR, 'data');
const DEFAULT_LOG_DIR = path.join(ROOT_DIR, 'log');
const DEFAULT_PORT = 8091;
const DEFAULT_AGENT_PORT = 18765;
const DEFAULT_AGENT_HOST = '0.0.0.0';
const START_BAT = path.join(ROOT_DIR, 'start.bat');

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const lines = String(fs.readFileSync(file, 'utf8') || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = String(raw || '').trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const envFile = parseEnvFile(ENV_FILE);
const MARKET_DATA_DIR = path.resolve(envFile.BSV_MARKET_DATA_DIR || DEFAULT_DATA_DIR);
const MARKET_LOG_DIR = path.resolve(envFile.BSV_MARKET_LOG_DIR || DEFAULT_LOG_DIR);
const MARKET_PORT = Math.max(1, Number(envFile.BSV_MARKET_PORT || DEFAULT_PORT) || DEFAULT_PORT);
const AGENT_PORT = Math.max(1, Number(process.env.BSV_MARKET_RESTART_AGENT_PORT || envFile.BSV_MARKET_RESTART_AGENT_PORT || DEFAULT_AGENT_PORT) || DEFAULT_AGENT_PORT);
const AGENT_HOST = String(process.env.BSV_MARKET_RESTART_AGENT_HOST || envFile.BSV_MARKET_RESTART_AGENT_HOST || DEFAULT_AGENT_HOST).trim() || DEFAULT_AGENT_HOST;
const RUN_LOG_FILE = path.join(MARKET_LOG_DIR, 'bsv_market_run.log');
const STATE_FILE = path.join(MARKET_LOG_DIR, 'windows_restart_agent_state.json');

fs.mkdirSync(MARKET_LOG_DIR, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

function createMessage(type, payload = {}) {
  return JSON.stringify({
    ts: nowIso(),
    type,
    ...payload,
  });
}

function psQuote(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

const clients = new Set();
let restarting = false;
let tailer = null;
let tailPosition = 0;

function emitConsole(type, payload = {}) {
  process.stdout.write(`${createMessage(type, payload)}\n`);
}

function writeState(extra = {}) {
  const payload = {
    ts: nowIso(),
    pid: process.pid,
    rootDir: ROOT_DIR,
    dataDir: MARKET_DATA_DIR,
    logDir: MARKET_LOG_DIR,
    marketPort: MARKET_PORT,
    agentPort: AGENT_PORT,
    ...extra,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
}

function broadcast(type, payload = {}) {
  if (
    type === 'restart_started'
    || type === 'restart_killed'
    || type === 'restart_spawned'
    || type === 'restart_ready'
    || type === 'restart_timeout'
    || type === 'kill_attempt'
  ) {
    emitConsole(type, payload);
  }
  const line = `${createMessage(type, payload)}\n`;
  for (const client of clients) {
    if (client.destroyed) continue;
    try {
      client.write(line);
    } catch (_) {}
  }
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    if (child.stdout) child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    if (child.stderr) child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('close', (code) => resolve({
      code: Number(code || 0),
      stdout,
      stderr,
    }));
    child.on('error', (error) => resolve({
      code: -1,
      stdout,
      stderr: `${stderr}${error?.message || error}`,
    }));
  });
}

function readRecentRunLog(maxBytes = 16384) {
  try {
    const st = fs.statSync(RUN_LOG_FILE);
    const start = Math.max(0, Number(st.size || 0) - maxBytes);
    const fd = fs.openSync(RUN_LOG_FILE, 'r');
    try {
      const size = Math.max(0, Number(st.size || 0) - start);
      const buf = Buffer.alloc(size);
      fs.readSync(fd, buf, 0, size, start);
      return String(buf.toString('utf8') || '');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return '';
  }
}

function ensureLogTail() {
  if (tailer) return;
  try {
    tailPosition = fs.existsSync(RUN_LOG_FILE) ? Number(fs.statSync(RUN_LOG_FILE).size || 0) : 0;
  } catch (_) {
    tailPosition = 0;
  }
  tailer = fs.watch(MARKET_LOG_DIR, { persistent: false }, (_eventType, filename) => {
    if (String(filename || '').toLowerCase() !== 'bsv_market_run.log') return;
    try {
      const st = fs.statSync(RUN_LOG_FILE);
      const nextSize = Number(st.size || 0);
      if (nextSize < tailPosition) tailPosition = 0;
      if (nextSize === tailPosition) return;
      const fd = fs.openSync(RUN_LOG_FILE, 'r');
      try {
        const size = nextSize - tailPosition;
        const buf = Buffer.alloc(size);
        fs.readSync(fd, buf, 0, size, tailPosition);
        tailPosition = nextSize;
        String(buf.toString('utf8') || '').split(/\r?\n/).forEach((line) => {
          if (!line) return;
          broadcast('run_log_line', { line });
        });
      } finally {
        fs.closeSync(fd);
      }
    } catch (_) {}
  });
}

function buildProtectedPidSet(rows, helperPid) {
  const byPid = new Map();
  for (const row of rows) {
    const pid = Number(row?.pid || 0);
    if (!pid) continue;
    byPid.set(pid, row);
  }
  const protectedPids = new Set();
  let cursor = Number(helperPid || 0);
  while (cursor > 0 && !protectedPids.has(cursor)) {
    protectedPids.add(cursor);
    const row = byPid.get(cursor);
    cursor = Number(row?.ppid || 0);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const pid = Number(row?.pid || 0);
      const ppid = Number(row?.ppid || 0);
      if (!pid || protectedPids.has(pid)) continue;
      if (protectedPids.has(ppid)) {
        protectedPids.add(pid);
        changed = true;
      }
    }
  }
  return protectedPids;
}

function buildRelatedPidSet(rows, seedPids) {
  const related = new Set(Array.from(seedPids || []).map((value) => Number(value || 0)).filter((value) => value > 0));
  if (related.size <= 0) return related;
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const pid = Number(row?.pid || 0);
      const ppid = Number(row?.ppid || 0);
      if (!pid) continue;
      if (related.has(pid) || related.has(ppid)) {
        if (!related.has(pid)) {
          related.add(pid);
          changed = true;
        }
        if (ppid > 0 && !related.has(ppid)) {
          related.add(ppid);
          changed = true;
        }
      }
    }
  }
  return related;
}

async function listManagedProcesses() {
  const helperPid = process.pid;
  const managedScriptNames = [
    'start.bat',
    'server_market.js',
    'chat_service_subprocess.js',
    'market_db_writer.js',
    'steward_subprocess.js',
    'view_state_subprocess.js',
    'block_headers_service.js',
  ];
  const normalizedRootDir = String(ROOT_DIR || '').replace(/\//g, '\\').toLowerCase();
  const normalizedStartBat = String(START_BAT || '').replace(/\//g, '\\').toLowerCase();
  const ps = [
    '$ErrorActionPreference="Stop";',
    '$rows = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine;',
    '$rows | ForEach-Object {',
    '  [pscustomobject]@{',
    '    pid = [int]$_.ProcessId;',
    '    ppid = [int]$_.ParentProcessId;',
    '    name = [string]$_.Name;',
    '    commandLine = [string]$_.CommandLine;',
    '  }',
    '} | ConvertTo-Json -Compress',
  ].join(' ');
  const result = await runCommand('powershell.exe', ['-NoProfile', '-Command', ps], { cwd: ROOT_DIR });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'failed to list processes');
  }
  let parsed = [];
  try {
    const json = JSON.parse(String(result.stdout || '[]').trim() || '[]');
    parsed = Array.isArray(json) ? json : (json ? [json] : []);
  } catch (error) {
    throw new Error(`failed to parse process list: ${error.message}`);
  }
  const protectedPids = buildProtectedPidSet(parsed, helperPid);
  const seedPids = new Set();
  for (const row of parsed) {
    const pid = Number(row?.pid || 0);
    if (!pid || protectedPids.has(pid)) continue;
    const name = String(row?.name || '').toLowerCase();
    const cmd = String(row?.commandLine || '').toLowerCase();
    const includesRootDir = Boolean(normalizedRootDir) && cmd.includes(normalizedRootDir);
    const includesStartBat = Boolean(normalizedStartBat) && cmd.includes(normalizedStartBat);
    const isManagedScript = managedScriptNames.some((scriptName) => cmd.includes(scriptName));
    const isNodeOrShell = name === 'node.exe' || name === 'cmd.exe' || name === 'conhost.exe';
    if (isNodeOrShell && (isManagedScript || includesRootDir || includesStartBat)) {
      seedPids.add(pid);
    }
  }
  async function addSeedsFromListeningPort(port) {
    const safePort = Math.max(1, Number(port || 0));
    if (!safePort) return;
    const netstatResult = await runCommand('cmd.exe', ['/d', '/s', '/c', 'netstat', '-ano', '-p', 'tcp'], { cwd: ROOT_DIR });
    if (netstatResult.code !== 0) return;
    const portSuffix = `:${safePort}`;
    const lines = String(netstatResult.stdout || '').split(/\r?\n/);
    for (const rawLine of lines) {
      const line = String(rawLine || '').trim();
      if (!line) continue;
      if (!/\sLISTENING\s/i.test(line)) continue;
      if (!line.includes(portSuffix)) continue;
      const parts = line.split(/\s+/);
      const pid = Number(parts[parts.length - 1] || 0);
      if (pid > 0 && !protectedPids.has(pid)) seedPids.add(pid);
    }
  }
  try {
    await addSeedsFromListeningPort(MARKET_PORT);
  } catch (_) {}
  try {
    const runtimePortFile = path.join(MARKET_DATA_DIR, 'runtime_port.json');
    if (fs.existsSync(runtimePortFile)) {
      const parsedPort = JSON.parse(String(fs.readFileSync(runtimePortFile, 'utf8') || '{}'));
      const runtimePort = Math.max(1, Number(parsedPort?.port || 0));
      if (runtimePort > 0 && runtimePort !== MARKET_PORT) {
        await addSeedsFromListeningPort(runtimePort);
      }
    }
  } catch (_) {}
  const relatedPids = buildRelatedPidSet(parsed, seedPids);
  return parsed.filter((row) => {
    const pid = Number(row?.pid || 0);
    if (!pid || protectedPids.has(pid)) return false;
    const name = String(row?.name || '').toLowerCase();
    if (!(name === 'node.exe' || name === 'cmd.exe' || name === 'conhost.exe')) return false;
    const cmd = String(row?.commandLine || '').toLowerCase();
    const isManagedScript = managedScriptNames.some((scriptName) => cmd.includes(scriptName));
    const matchesDirect = isManagedScript || cmd.includes(normalizedRootDir) || cmd.includes(normalizedStartBat);
    return relatedPids.has(pid) || matchesDirect;
  });
}

async function waitForManagedShutdown(timeoutMs = 15000) {
  const startedAt = Date.now();
  let lastProcesses = [];
  while ((Date.now() - startedAt) < timeoutMs) {
    lastProcesses = await listManagedProcesses();
    if (lastProcesses.length <= 0) {
      return {
        ok: true,
        elapsedMs: Date.now() - startedAt,
        remaining: [],
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  lastProcesses = await listManagedProcesses();
  return {
    ok: lastProcesses.length <= 0,
    elapsedMs: Date.now() - startedAt,
    remaining: lastProcesses,
  };
}

async function killManagedProcesses() {
  let processes = await listManagedProcesses();
  const killed = [];
  for (const proc of processes) {
    const pid = Number(proc?.pid || 0);
    if (!pid) continue;
    const name = String(proc?.name || '').toLowerCase();
    const commandLine = String(proc?.commandLine || '');
    const lowerCmd = commandLine.toLowerCase();
    const looksLikeStartShell = name === 'cmd.exe' && lowerCmd.includes('start.bat');
    if (!looksLikeStartShell) continue;
    broadcast('kill_attempt', {
      pid,
      name: String(proc?.name || ''),
      commandLine,
      mode: 'graceful_close',
    });
    const closeResult = await runCommand('powershell.exe', [
      '-NoProfile',
      '-Command',
      [
        '$ErrorActionPreference="SilentlyContinue";',
        `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue;`,
        'if ($p -ne $null) {',
        '  $null = $p.CloseMainWindow();',
        '  Start-Sleep -Milliseconds 1200;',
        '}',
      ].join(' '),
    ], { cwd: ROOT_DIR });
    killed.push({
      pid,
      name: String(proc?.name || ''),
      mode: 'graceful_close',
      code: closeResult.code,
      stdout: String(closeResult.stdout || '').trim(),
      stderr: String(closeResult.stderr || '').trim(),
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 1800));
  processes = await listManagedProcesses();
  for (const proc of processes) {
    const pid = Number(proc?.pid || 0);
    if (!pid) continue;
    broadcast('kill_attempt', {
      pid,
      name: String(proc?.name || ''),
      commandLine: String(proc?.commandLine || ''),
      mode: 'force_kill',
    });
    const result = await runCommand('cmd.exe', ['/d', '/s', '/c', 'taskkill', '/PID', String(pid), '/T', '/F'], { cwd: ROOT_DIR });
    killed.push({
      pid,
      name: String(proc?.name || ''),
      mode: 'force_kill',
      code: result.code,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim(),
    });
  }
  return killed;
}

async function startManagedService() {
  if (!fs.existsSync(START_BAT)) throw new Error(`start.bat not found: ${START_BAT}`);
  const child = spawn('cmd.exe', ['/d', '/s', '/c', 'start', '""', '/min', START_BAT], {
    cwd: ROOT_DIR,
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: {
      ...process.env,
    },
  });
  child.unref();
  return { spawned: true, pid: Number(child.pid || 0) };
}

async function probeHttpReady(timeoutMs = 45000) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const result = await runCommand('powershell.exe', [
      '-NoProfile',
      '-Command',
      [
        '$ProgressPreference="SilentlyContinue";',
        'try {',
        `  $r = Invoke-WebRequest -UseBasicParsing -Uri ${psQuote(`http://127.0.0.1:${MARKET_PORT}/index.html`)} -TimeoutSec 4;`,
        '  if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 400) { Write-Output "ready"; exit 0 }',
        '  Write-Output ("status=" + $r.StatusCode); exit 2',
        '} catch {',
        '  Write-Output $_.Exception.Message; exit 1',
        '}',
      ].join(' '),
    ], { cwd: ROOT_DIR });
    if (result.code === 0) {
      return {
        ready: true,
        elapsedMs: Date.now() - startedAt,
        detail: String(result.stdout || '').trim(),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return {
    ready: false,
    elapsedMs: Date.now() - startedAt,
    detail: 'timeout',
  };
}

async function handleRestart() {
  if (restarting) return { ok: false, error: 'restart already in progress' };
  restarting = true;
  const startedAt = Date.now();
  broadcast('restart_started', {
    rootDir: ROOT_DIR,
    dataDir: MARKET_DATA_DIR,
    marketPort: MARKET_PORT,
    logFile: RUN_LOG_FILE,
  });
  try {
    const killed = await killManagedProcesses();
    broadcast('restart_killed', { killed });
    const shutdown = await waitForManagedShutdown(15000);
    broadcast('restart_shutdown_wait', shutdown);
    const startResult = await startManagedService();
    broadcast('restart_spawned', startResult);
    const ready = await probeHttpReady(45000);
    broadcast(ready.ready ? 'restart_ready' : 'restart_timeout', ready);
    return {
      ok: ready.ready,
      killed,
      shutdown,
      startResult,
      ready,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    restarting = false;
  }
}

function send(socket, type, payload = {}) {
  socket.write(`${createMessage(type, payload)}\n`);
}

async function handleMessage(socket, parsed) {
  const cmd = String(parsed?.cmd || '').trim().toLowerCase();
  emitConsole('command_received', {
    remoteAddress: String(socket?.remoteAddress || ''),
    remotePort: Number(socket?.remotePort || 0),
    cmd,
  });
  if (cmd === 'ping') {
    send(socket, 'pong', {
      pid: process.pid,
      rootDir: ROOT_DIR,
      dataDir: MARKET_DATA_DIR,
      marketPort: MARKET_PORT,
      agentPort: AGENT_PORT,
      restarting,
    });
    return;
  }
  if (cmd === 'status') {
    const processes = await listManagedProcesses();
    send(socket, 'status', {
      pid: process.pid,
      restarting,
      processCount: processes.length,
      processes,
      rootDir: ROOT_DIR,
      dataDir: MARKET_DATA_DIR,
      marketPort: MARKET_PORT,
      agentHost: AGENT_HOST,
      agentPort: AGENT_PORT,
      recentRunLog: readRecentRunLog(),
    });
    return;
  }
  if (cmd === 'restart') {
    const result = await handleRestart();
    send(socket, 'restart_result', result);
    return;
  }
  send(socket, 'command_error', { error: `unknown command: ${cmd || '(empty)'}` });
}

function attachSocket(socket) {
  clients.add(socket);
  ensureLogTail();
  send(socket, 'hello', {
    pid: process.pid,
    rootDir: ROOT_DIR,
    dataDir: MARKET_DATA_DIR,
    logDir: MARKET_LOG_DIR,
    logFile: RUN_LOG_FILE,
    marketPort: MARKET_PORT,
    agentHost: AGENT_HOST,
    agentPort: AGENT_PORT,
  });
  const rl = readline.createInterface({ input: socket });
  rl.on('error', (error) => {
    clients.delete(socket);
    emitConsole('client_stream_error', {
      remoteAddress: String(socket?.remoteAddress || ''),
      remotePort: Number(socket?.remotePort || 0),
      message: error?.message || String(error || 'socket stream error'),
    });
    try { rl.close(); } catch (_) {}
    try { socket.destroy(); } catch (_) {}
  });
  rl.on('line', async (line) => {
    let parsed = null;
    try {
      parsed = JSON.parse(String(line || '').trim() || '{}');
    } catch (error) {
      send(socket, 'command_error', { error: `invalid json: ${error.message}` });
      return;
    }
    try {
      await handleMessage(socket, parsed);
    } catch (error) {
      send(socket, 'command_error', { error: error.message || String(error || 'command failed') });
    }
  });
  socket.on('close', () => {
    clients.delete(socket);
    try { rl.close(); } catch (_) {}
  });
  socket.on('error', () => {
    clients.delete(socket);
    try { rl.close(); } catch (_) {}
  });
}

function main() {
  writeState();
  ensureLogTail();
  const server = net.createServer((socket) => attachSocket(socket));
  server.on('error', (error) => {
    process.stderr.write(`${createMessage('fatal', { message: error?.message || String(error || 'server error') })}\n`);
    process.exitCode = 1;
  });
  server.listen(AGENT_PORT, AGENT_HOST, () => {
    writeState({
      listening: server.address(),
    });
    emitConsole('listening', {
      pid: process.pid,
      rootDir: ROOT_DIR,
      dataDir: MARKET_DATA_DIR,
      marketPort: MARKET_PORT,
      agentHost: AGENT_HOST,
      agentPort: AGENT_PORT,
    });
  });
}

main();
