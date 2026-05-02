#!/usr/bin/env node
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const net = require('net');
const zlib = require('zlib');

const {
  defaultAgentRoot,
  detectPlatform,
  ensureDir,
  fs,
  makeId,
  normalizeRelPath,
  nowIso,
  path,
  pickPlatformValue,
  readJson,
  sha256,
  sleep,
  tailFile,
  toEnvObject,
  writeJson,
} = require('./lib/common');

const ROOT_DIR = path.resolve(process.env.DEPLOY_AGENT_ROOT_DIR || defaultAgentRoot());
const APPS_DIR = ensureDir(path.join(ROOT_DIR, 'apps'));
const TMP_DIR = ensureDir(path.join(ROOT_DIR, 'tmp'));
const PORT = Math.max(1, Number(process.env.DEPLOY_AGENT_PORT || 18766) || 18766);
const HOST = String(process.env.DEPLOY_AGENT_HOST || '0.0.0.0').trim() || '0.0.0.0';
const TOKEN = String(process.env.DEPLOY_AGENT_TOKEN || 'local-dev-token').trim();
const MAX_BODY_BYTES = Math.max(1024 * 1024, Number(process.env.DEPLOY_AGENT_MAX_BODY_BYTES || (64 * 1024 * 1024)));
const NODE_BIN_DIR = path.dirname(process.execPath);
const PATH_KEY = process.platform === 'win32' ? 'Path' : 'PATH';

function withAgentNodeEnv(extraEnv = {}) {
  const base = {
    ...process.env,
    ...extraEnv,
  };
  const currentPath = String(
    base[PATH_KEY]
    || base.PATH
    || base.Path
    || '',
  );
  const parts = currentPath
    .split(path.delimiter)
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!parts.includes(NODE_BIN_DIR)) {
    parts.unshift(NODE_BIN_DIR);
  }
  base[PATH_KEY] = parts.join(path.delimiter);
  base.PATH = base[PATH_KEY];
  if (process.platform === 'win32') {
    base.Path = base[PATH_KEY];
  }
  return base;
}

function appRoot(appId) {
  return ensureDir(path.join(APPS_DIR, appId));
}

function appConfigFile(appId) {
  return path.join(appRoot(appId), 'appspec.json');
}

function appStateFile(appId) {
  return path.join(appRoot(appId), 'runtime.json');
}

function deploymentRoot(appId) {
  return ensureDir(path.join(appRoot(appId), 'current'));
}

function logsRoot(appId) {
  return ensureDir(path.join(appRoot(appId), 'logs'));
}

function readAppConfig(appId) {
  const config = readJson(appConfigFile(appId), null);
  if (!config) throw new Error(`app not registered: ${appId}`);
  return config;
}

function readAppState(appId) {
  return readJson(appStateFile(appId), {
    appId,
    updatedAt: '',
    install: null,
    process: {
      pid: 0,
      running: false,
      startedAt: '',
      exitedAt: '',
      exitCode: null,
      signal: '',
      command: [],
      cwd: '',
      restartCount: 0,
    },
  });
}

function writeAppState(appId, next) {
  const merged = {
    ...readAppState(appId),
    ...(next || {}),
    updatedAt: nowIso(),
  };
  writeJson(appStateFile(appId), merged);
  return merged;
}

function resolveCommandSpec(config, key) {
  const spec = config?.commands?.[key];
  const command = pickPlatformValue(spec?.command);
  if (!Array.isArray(command) || command.length <= 0) {
    throw new Error(`missing ${key} command for current platform`);
  }
  return {
    command: command.map((item) => String(item)),
    cwd: String(pickPlatformValue(spec?.cwd) || config?.deploymentSubdir || ''),
    env: {
      ...toEnvObject(config?.env),
      ...toEnvObject(pickPlatformValue(spec?.env)),
    },
    waitFor: spec?.waitFor && typeof spec.waitFor === 'object' ? spec.waitFor : null,
    timeoutMs: Math.max(1000, Number(spec?.timeoutMs || 30000)),
  };
}

function isProcessRunning(pid) {
  const numericPid = Math.max(0, Number(pid || 0));
  if (!numericPid) return false;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

async function stopPid(pid) {
  const numericPid = Math.max(0, Number(pid || 0));
  if (!numericPid) return { stopped: false, reason: 'missing_pid' };
  if (!isProcessRunning(numericPid)) return { stopped: false, reason: 'not_running' };
  if (process.platform === 'win32') {
    await spawnAndCapture('taskkill', ['/PID', String(numericPid), '/T', '/F']);
    return { stopped: true, signal: 'SIGKILL' };
  }
  try { process.kill(numericPid, 'SIGTERM'); } catch (_) {}
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isProcessRunning(numericPid)) return { stopped: true, signal: 'SIGTERM' };
    await sleep(150);
  }
  try { process.kill(numericPid, 'SIGKILL'); } catch (_) {}
  return { stopped: true, signal: 'SIGKILL' };
}

function buildLogFiles(appId, config) {
  const root = logsRoot(appId);
  const stdoutFile = path.join(root, 'stdout.log');
  const stderrFile = path.join(root, 'stderr.log');
  const extraFiles = Array.isArray(config?.logFiles)
    ? config.logFiles.map((item) => path.join(deploymentRoot(appId), normalizeRelPath(item)))
    : [];
  return { stdoutFile, stderrFile, extraFiles };
}

async function spawnAndCapture(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || process.cwd(),
      env: withAgentNodeEnv(options.env || {}),
      shell: options.shell === true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk || ''); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk || ''); });
    child.on('close', (code, signal) => resolve({
      code: Number(code == null ? -1 : code),
      signal: String(signal || ''),
      stdout,
      stderr,
    }));
    child.on('error', (error) => resolve({
      code: -1,
      signal: '',
      stdout,
      stderr: String(error?.message || error || 'spawn error'),
    }));
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 0) || 30000);
  while (Date.now() <= deadline) {
    const ok = await new Promise((resolve) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('error', () => resolve(false));
      req.setTimeout(1500, () => {
        req.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

async function waitForTcp(host, port, timeoutMs) {
  const deadline = Date.now() + Math.max(1000, Number(timeoutMs || 0) || 30000);
  while (Date.now() <= deadline) {
    const ok = await new Promise((resolve) => {
      const socket = net.createConnection({ host, port: Number(port) }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => resolve(false));
      socket.setTimeout(1500, () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await sleep(250);
  }
  return false;
}

async function waitForHealth(waitFor) {
  if (!waitFor || typeof waitFor !== 'object') return { ok: true, checked: false };
  const type = String(waitFor.type || '').trim().toLowerCase();
  const timeoutMs = Math.max(1000, Number(waitFor.timeoutMs || 30000));
  if (type === 'http') {
    const ok = await waitForHttp(String(waitFor.url || ''), timeoutMs);
    return { ok, checked: true, type };
  }
  if (type === 'tcp') {
    const ok = await waitForTcp(String(waitFor.host || '127.0.0.1'), Number(waitFor.port || 0), timeoutMs);
    return { ok, checked: true, type };
  }
  return { ok: true, checked: false };
}

function commandSpecOrNull(config, key) {
  try {
    return resolveCommandSpec(config, key);
  } catch (_) {
    return null;
  }
}

async function appHealthStatus(config) {
  const startSpec = commandSpecOrNull(config, 'start');
  return waitForHealth(startSpec?.waitFor || null);
}

function removeDirContents(target, persistentPaths = []) {
  ensureDir(target);
  const protectedNames = new Set(
    persistentPaths.map((item) => normalizeRelPath(item).split('/')[0]).filter(Boolean),
  );
  for (const name of fs.readdirSync(target)) {
    if (protectedNames.has(name)) continue;
    fs.rmSync(path.join(target, name), { recursive: true, force: true });
  }
}

function writeManifestFiles(targetRoot, files) {
  for (const file of files) {
    const rel = normalizeRelPath(file?.path || '');
    const content = Buffer.from(String(file?.contentBase64 || ''), 'base64');
    const expectedSha = String(file?.sha256 || '').trim().toLowerCase();
    const actualSha = sha256(content);
    if (expectedSha && expectedSha !== actualSha) {
      throw new Error(`sha256 mismatch for ${rel}`);
    }
    const dest = path.join(targetRoot, rel);
    ensureDir(path.dirname(dest));
    fs.writeFileSync(dest, content);
    if (Number.isInteger(file?.mode)) {
      try { fs.chmodSync(dest, Number(file.mode)); } catch (_) {}
    }
  }
}

async function registerApp(body) {
  const appId = String(body?.appId || '').trim();
  if (!appId) throw new Error('appId is required');
  const config = body?.config && typeof body.config === 'object' ? body.config : null;
  if (!config) throw new Error('config is required');
  writeJson(appConfigFile(appId), {
    appId,
    updatedAt: nowIso(),
    ...config,
  });
  return { appId, config: readAppConfig(appId) };
}

async function installManifest(body) {
  const appId = String(body?.appId || '').trim();
  if (!appId) throw new Error('appId is required');
  const config = readAppConfig(appId);
  const files = Array.isArray(body?.files) ? body.files : [];
  if (files.length <= 0) throw new Error('files is required');
  const deployRoot = deploymentRoot(appId);
  removeDirContents(deployRoot, Array.isArray(config?.persistentPaths) ? config.persistentPaths : []);
  writeManifestFiles(deployRoot, files);
  const installMeta = {
    deploymentId: makeId('deploy'),
    installedAt: nowIso(),
    fileCount: files.length,
    source: String(body?.source || 'manifest'),
    sha256: sha256(Buffer.from(JSON.stringify(files.map((file) => ({
      path: file.path,
      sha256: file.sha256 || '',
    }))))),
  };
  writeAppState(appId, { install: installMeta });
  return {
    appId,
    install: installMeta,
    deployRoot,
  };
}

async function installArchive(body) {
  const appId = String(body?.appId || '').trim();
  if (!appId) throw new Error('appId is required');
  readAppConfig(appId);
  const compression = String(body?.compression || 'gzip').trim().toLowerCase();
  if (compression !== 'gzip') throw new Error(`unsupported compression: ${compression}`);
  const archiveBase64 = String(body?.archiveBase64 || '').trim();
  if (!archiveBase64) throw new Error('archiveBase64 is required');
  const compressed = Buffer.from(archiveBase64, 'base64');
  const unpacked = zlib.gunzipSync(compressed);
  const archive = JSON.parse(unpacked.toString('utf8'));
  const files = Array.isArray(archive?.files) ? archive.files : [];
  if (files.length <= 0) throw new Error('archive contains no files');
  return installManifest({
    appId,
    files,
    source: String(body?.source || archive?.source || 'archive'),
  });
}

async function runConfiguredCommand(body) {
  const appId = String(body?.appId || '').trim();
  if (!appId) throw new Error('appId is required');
  const key = String(body?.key || '').trim();
  if (!key) throw new Error('key is required');
  const config = readAppConfig(appId);
  const spec = resolveCommandSpec(config, key);
  const deployRoot = deploymentRoot(appId);
  const cwd = path.resolve(deployRoot, spec.cwd || '.');
  const result = await spawnAndCapture(spec.command[0], spec.command.slice(1), {
    cwd,
    env: withAgentNodeEnv(spec.env),
    shell: body?.shell === true,
  });
  return {
    appId,
    key,
    cwd,
    command: spec.command,
    result,
  };
}

async function startApp(body) {
  const appId = String(body?.appId || '').trim();
  const config = readAppConfig(appId);
  const state = readAppState(appId);
  const healthBeforeStart = await appHealthStatus(config);
  if (isProcessRunning(state?.process?.pid) || healthBeforeStart.ok) {
    const next = writeAppState(appId, {
      process: {
        ...state.process,
        running: true,
        exitedAt: '',
      },
    });
    return {
      appId,
      alreadyRunning: true,
      process: next.process,
      health: healthBeforeStart,
    };
  }
  const spec = resolveCommandSpec(config, 'start');
  const deployRoot = deploymentRoot(appId);
  const cwd = path.resolve(deployRoot, spec.cwd || '.');
  ensureDir(cwd);
  const { stdoutFile, stderrFile } = buildLogFiles(appId, config);
  ensureDir(path.dirname(stdoutFile));
  const stdoutFd = fs.openSync(stdoutFile, 'a');
  const stderrFd = fs.openSync(stderrFile, 'a');
  const child = spawn(spec.command[0], spec.command.slice(1), {
    cwd,
    env: withAgentNodeEnv(spec.env),
    detached: true,
    windowsHide: true,
    stdio: ['ignore', stdoutFd, stderrFd],
  });
  child.unref();
  const nextState = writeAppState(appId, {
    process: {
      pid: Number(child.pid || 0),
      running: true,
      startedAt: nowIso(),
      exitedAt: '',
      exitCode: null,
      signal: '',
      command: spec.command,
      cwd,
      restartCount: Math.max(0, Number(state?.process?.restartCount || 0)),
    },
  });
  const health = await waitForHealth(spec.waitFor);
  if (!health.ok) {
    return {
      appId,
      process: nextState.process,
      health,
      warning: 'process started but health check did not pass before timeout',
    };
  }
  return {
    appId,
    process: nextState.process,
    health,
  };
}

async function stopApp(body) {
  const appId = String(body?.appId || '').trim();
  const config = readAppConfig(appId);
  const state = readAppState(appId);
  const stopSpec = commandSpecOrNull(config, 'stop');
  let result = await stopPid(state?.process?.pid);
  if (!result.stopped && stopSpec) {
    const deployRoot = deploymentRoot(appId);
    const cwd = path.resolve(deployRoot, stopSpec.cwd || '.');
    const commandResult = await spawnAndCapture(stopSpec.command[0], stopSpec.command.slice(1), {
      cwd,
      env: withAgentNodeEnv(stopSpec.env),
    });
    result = {
      stopped: commandResult.code === 0,
      signal: String(commandResult.signal || ''),
      code: commandResult.code,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      via: 'stop_command',
    };
  }
  const next = writeAppState(appId, {
    process: {
      ...state.process,
      running: false,
      exitedAt: nowIso(),
      signal: String(result.signal || ''),
    },
  });
  return {
    appId,
    stop: result,
    process: next.process,
  };
}

async function restartApp(body) {
  const appId = String(body?.appId || '').trim();
  const config = readAppConfig(appId);
  const state = readAppState(appId);
  const healthBeforeRestart = await appHealthStatus(config);
  if (Number(state?.process?.pid || 0) || healthBeforeRestart.ok) {
    await stopApp({ appId });
  }
  const started = await startApp({ appId });
  const next = writeAppState(appId, {
    process: {
      ...readAppState(appId).process,
      restartCount: Math.max(0, Number(state?.process?.restartCount || 0)) + 1,
    },
  });
  return {
    appId,
    restarted: true,
    start: started,
    process: next.process,
  };
}

async function appStatus(body) {
  const appId = String(body?.appId || '').trim();
  const config = readAppConfig(appId);
  const state = readAppState(appId);
  const { stdoutFile, stderrFile, extraFiles } = buildLogFiles(appId, config);
  const pidRunning = isProcessRunning(state?.process?.pid);
  const health = await appHealthStatus(config);
  const running = pidRunning || health.ok;
  if (running !== Boolean(state?.process?.running)) {
    writeAppState(appId, {
      process: {
        ...state.process,
        running,
        exitedAt: running ? '' : (state.process.exitedAt || nowIso()),
      },
    });
  }
  return {
    appId,
    platform: detectPlatform(),
    rootDir: deploymentRoot(appId),
    config,
    state: readAppState(appId),
    health,
    logs: {
      stdoutFile,
      stderrFile,
      extraFiles,
    },
  };
}

async function appLogs(body) {
  const appId = String(body?.appId || '').trim();
  const config = readAppConfig(appId);
  const maxBytes = Math.max(1024, Number(body?.maxBytes || 32768));
  const { stdoutFile, stderrFile, extraFiles } = buildLogFiles(appId, config);
  return {
    appId,
    stdout: tailFile(stdoutFile, maxBytes),
    stderr: tailFile(stderrFile, maxBytes),
    extra: extraFiles.map((file) => ({
      file,
      content: tailFile(file, maxBytes),
    })),
  };
}

async function execApp(body) {
  const appId = String(body?.appId || '').trim();
  const config = readAppConfig(appId);
  const command = Array.isArray(body?.command) ? body.command.map((item) => String(item)) : [];
  if (command.length <= 0) throw new Error('command is required');
  const cwd = path.resolve(deploymentRoot(appId), String(body?.cwd || '.'));
  const result = await spawnAndCapture(command[0], command.slice(1), {
    cwd,
    env: withAgentNodeEnv({
      ...toEnvObject(config?.env),
      ...toEnvObject(body?.env),
    }),
    shell: body?.shell === true,
  });
  return {
    appId,
    result,
  };
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error(`request too large (>${MAX_BODY_BYTES} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      resolve(raw ? JSON.parse(raw) : {});
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function unauthorized(res) {
  sendJson(res, 401, {
    ok: false,
    error: 'unauthorized',
  });
}

const routes = {
  'GET /health': async () => ({
    ok: true,
    now: nowIso(),
    platform: detectPlatform(),
    rootDir: ROOT_DIR,
  }),
  'POST /v1/apps/register': registerApp,
  'POST /v1/apps/install-manifest': installManifest,
  'POST /v1/apps/install-archive': installArchive,
  'POST /v1/apps/run-command': runConfiguredCommand,
  'POST /v1/apps/start': startApp,
  'POST /v1/apps/stop': stopApp,
  'POST /v1/apps/restart': restartApp,
  'POST /v1/apps/status': appStatus,
  'POST /v1/apps/logs': appLogs,
  'POST /v1/apps/exec': execApp,
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health' && req.method === 'GET') {
      const payload = await routes['GET /health']();
      return sendJson(res, 200, payload);
    }
    const auth = String(req.headers['x-deploy-agent-token'] || '').trim();
    if (TOKEN && auth !== TOKEN) return unauthorized(res);
    const routeKey = `${String(req.method || 'GET').toUpperCase()} ${String(req.url || '')}`;
    const handler = routes[routeKey];
    if (!handler) {
      return sendJson(res, 404, { ok: false, error: `unknown route: ${routeKey}` });
    }
    const body = req.method === 'POST' ? await collectBody(req) : {};
    const data = await handler(body || {});
    return sendJson(res, 200, { ok: true, data });
  } catch (error) {
    return sendJson(res, 500, {
      ok: false,
      error: String(error?.message || error || 'request failed'),
    });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`${JSON.stringify({
    ts: nowIso(),
    type: 'deploy_agent_started',
    host: HOST,
    port: PORT,
    rootDir: ROOT_DIR,
    tokenConfigured: Boolean(TOKEN),
  })}\n`);
});
