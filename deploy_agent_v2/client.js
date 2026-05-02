#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const { normalizeRelPath, readText, safeJsonParse, sha256 } = require('./lib/common');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const part = String(argv[i] || '');
    if (!part.startsWith('--')) {
      out._.push(part);
      continue;
    }
    const key = part.slice(2);
    const next = argv[i + 1];
    if (next == null || String(next).startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function requestJson({ method = 'GET', url, token = '', body = null }) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = body == null ? '' : JSON.stringify(body);
    const req = http.request({
      method,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'x-deploy-agent-token': token,
      },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const parsed = safeJsonParse(data, null);
        if (res.statusCode >= 400) {
          return reject(new Error(parsed?.error || parsed?.message || `request failed: ${res.statusCode}`));
        }
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function baseUrl(args) {
  return String(args.url || process.env.DEPLOY_AGENT_URL || 'http://127.0.0.1:18766').replace(/\/+$/, '');
}

function authToken(args) {
  return String(args.token || process.env.DEPLOY_AGENT_TOKEN || 'local-dev-token');
}

async function remotePlatform(url, token) {
  const result = await requestJson({ url: `${url}/health`, token });
  return String(result?.platform || '').trim().toLowerCase();
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadManifestPaths(sourceDir, manifestFile) {
  const manifest = readText(manifestFile, '');
  return manifest
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => normalizeRelPath(line));
}

function buildManifestPayload(sourceDir, relPaths) {
  return relPaths.map((relPath) => {
    const full = path.join(sourceDir, relPath);
    const content = fs.readFileSync(full);
    const stats = fs.statSync(full);
    return {
      path: relPath,
      contentBase64: content.toString('base64'),
      sha256: sha256(content),
      mode: stats.mode & 0o777,
    };
  });
}

function walkFiles(rootDir, relDir = '', shouldSkipDir = null) {
  const dir = path.join(rootDir, relDir);
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relPath = relDir ? path.posix.join(relDir, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (typeof shouldSkipDir === 'function' && shouldSkipDir(relPath)) continue;
      files.push(...walkFiles(rootDir, relPath, shouldSkipDir));
      continue;
    }
    if (entry.isFile()) files.push(relPath);
  }
  return files;
}

function shouldExcludeBsvMarketPath(relPath) {
  const normalized = normalizeRelPath(relPath);
  const top = normalized.split('/')[0];
  if ([
    '.git',
    'node_modules',
    'data',
    'log',
    'memory',
    'baselines',
    'dist',
  ].includes(top)) return true;
  if (normalized === '.deploy') return true;
  if (normalized === 'deploy_agent_v2/.agent_node') return true;
  if (normalized === 'deploy_agent_v2/.runtime') return true;
  if (normalized.startsWith('deploy_agent_v2/.runtime/')) return true;
  if (normalized.startsWith('deploy_agent_v2/.agent_node/')) return true;
  if (normalized.startsWith('D:WSLdb')) return true;
  if (normalized.endsWith('.bak')) return true;
  if (normalized.includes('.bak.')) return true;
  if (normalized.endsWith('.pid')) return true;
  if (normalized === 'perf.data') return true;
  if (normalized === '.env.market') return true;
  return false;
}

function collectBsvMarketFiles(sourceDir) {
  return walkFiles(sourceDir, '', shouldExcludeBsvMarketPath)
    .map((relPath) => normalizeRelPath(relPath))
    .filter((relPath) => !shouldExcludeBsvMarketPath(relPath))
    .sort();
}

function buildArchivePayload(sourceDir, relPaths) {
  return {
    format: 'manifest-archive-v1',
    source: sourceDir,
    generatedAt: new Date().toISOString(),
    files: buildManifestPayload(sourceDir, relPaths),
  };
}

function gzipArchiveBase64(archivePayload) {
  const raw = Buffer.from(JSON.stringify(archivePayload));
  return zlib.gzipSync(raw, { level: 9 }).toString('base64');
}

function defaultBsvMarketConfig() {
  return {
    name: 'bsv-market',
    deploymentSubdir: '.',
    persistentPaths: [
      'data',
      'log',
      '.deploy',
      '.env.market',
    ],
    env: {},
    commands: {
      ensure_node: {
        command: {
          default: [
            'node',
            'deploy_agent_v2/remote_helpers/ensure_node.js',
            '--version',
            '24.14.0',
            '--install-dir',
            '.deploy/node',
          ],
        },
        cwd: '.',
        timeoutMs: 1200000,
      },
      install: {
        command: {
          windows: [
            'node',
            'deploy_agent_v2/remote_helpers/run_with_managed_node.js',
            'cmd.exe',
            '/d',
            '/s',
            '/c',
            'call npm install',
          ],
          linux: [
            'node',
            'deploy_agent_v2/remote_helpers/run_with_managed_node.js',
            'npm',
            'install',
          ],
          darwin: [
            'node',
            'deploy_agent_v2/remote_helpers/run_with_managed_node.js',
            'npm',
            'install',
          ],
        },
        cwd: '.',
        timeoutMs: 1200000,
      },
      start: {
        command: {
          windows: [
            'node',
            'deploy_agent_v2/remote_helpers/run_with_managed_node.js',
            'cmd.exe',
            '/d',
            '/s',
            '/c',
            'call start.bat',
          ],
          linux: [
            'node',
            'deploy_agent_v2/remote_helpers/run_with_managed_node.js',
            'bash',
            './market_ctl.sh',
            'start',
          ],
          darwin: [
            'node',
            'deploy_agent_v2/remote_helpers/run_with_managed_node.js',
            'bash',
            './market_ctl.sh',
            'start',
          ],
        },
        cwd: '.',
        waitFor: {
          type: 'http',
          url: 'http://127.0.0.1:8091/api/state-lite',
          timeoutMs: 30000,
        },
      },
    },
    logFiles: [
      'log/bsv_market_run.log',
      'log/market-debug.log',
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = String(args._[0] || 'help').trim().toLowerCase();
  const url = baseUrl(args);
  const token = authToken(args);

  if (cmd === 'help') {
    process.stdout.write([
      'Usage:',
      '  node client.js ping --url http://host:18766 --token secret',
      '  node client.js register --app app-id --spec ./appspec.json',
      '  node client.js deploy-manifest --app app-id --source /path/project --manifest ./files.txt',
      '  node client.js start --app app-id',
      '  node client.js stop --app app-id',
      '  node client.js restart --app app-id',
      '  node client.js status --app app-id',
      '  node client.js logs --app app-id --max-bytes 65536',
      '  node client.js exec --app app-id --command \"bash ./market_ctl.sh restart\"',
    ].join('\n') + '\n');
    return;
  }

  if (cmd === 'ping') {
    const result = await requestJson({ url: `${url}/health` });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (cmd === 'register') {
    const appId = String(args.app || '').trim();
    const specFile = String(args.spec || '').trim();
    const result = await requestJson({
      method: 'POST',
      url: `${url}/v1/apps/register`,
      token,
      body: {
        appId,
        config: loadJson(specFile),
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (cmd === 'deploy-manifest') {
    const appId = String(args.app || '').trim();
    const sourceDir = path.resolve(String(args.source || '.'));
    const manifestFile = path.resolve(String(args.manifest || ''));
    const relPaths = loadManifestPaths(sourceDir, manifestFile);
    const files = buildManifestPayload(sourceDir, relPaths);
    const result = await requestJson({
      method: 'POST',
      url: `${url}/v1/apps/install-manifest`,
      token,
      body: {
        appId,
        source: manifestFile,
        files,
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (cmd === 'deploy-bsv-market') {
    const appId = String(args.app || 'bsv-market').trim();
    const sourceDir = path.resolve(String(args.source || path.resolve(__dirname, '..')));
    const restartAfter = args['no-restart'] === true ? false : true;
    const installAfter = args['skip-install'] === true ? false : true;
    const relPaths = collectBsvMarketFiles(sourceDir);
    const archivePayload = buildArchivePayload(sourceDir, relPaths);
    const archiveBase64 = gzipArchiveBase64(archivePayload);
    const compressedBytes = Buffer.byteLength(archiveBase64, 'base64');
    const rawBytes = Buffer.byteLength(JSON.stringify(archivePayload));

    const registerResult = await requestJson({
      method: 'POST',
      url: `${url}/v1/apps/register`,
      token,
      body: {
        appId,
        config: defaultBsvMarketConfig(),
      },
    });
    const installResult = await requestJson({
      method: 'POST',
      url: `${url}/v1/apps/install-archive`,
      token,
      body: {
        appId,
        compression: 'gzip',
        archiveBase64,
        source: sourceDir,
      },
    });
    const ensureNodeResult = await requestJson({
      method: 'POST',
      url: `${url}/v1/apps/run-command`,
      token,
      body: {
        appId,
        key: 'ensure_node',
      },
    });
    let installCommandResult = null;
    if (installAfter) {
      installCommandResult = await requestJson({
        method: 'POST',
        url: `${url}/v1/apps/run-command`,
        token,
        body: {
          appId,
          key: 'install',
        },
      });
    }
    let restartResult = null;
    if (restartAfter) {
      restartResult = await requestJson({
        method: 'POST',
        url: `${url}/v1/apps/restart`,
        token,
        body: {
          appId,
        },
      });
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      data: {
        appId,
        sourceDir,
        fileCount: relPaths.length,
        rawBytes,
        compressedBytes,
        register: registerResult.data,
        install: installResult.data,
        ensureNode: ensureNodeResult.data,
        installCommand: installCommandResult ? installCommandResult.data : null,
        restart: restartResult ? restartResult.data : null,
      },
    }, null, 2)}\n`);
    return;
  }

  if (['start', 'stop', 'restart', 'status', 'logs'].includes(cmd)) {
    const appId = String(args.app || '').trim();
    const result = await requestJson({
      method: 'POST',
      url: `${url}/v1/apps/${cmd}`,
      token,
      body: {
        appId,
        maxBytes: Number(args['max-bytes'] || 32768),
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (cmd === 'exec') {
    const appId = String(args.app || '').trim();
    const commandText = String(args.command || '').trim();
    const platform = await remotePlatform(url, token);
    const isWindows = platform === 'win32' || platform === 'windows';
    const result = await requestJson({
      method: 'POST',
      url: `${url}/v1/apps/exec`,
      token,
      body: {
        appId,
        shell: true,
        command: isWindows
          ? ['cmd.exe', '/d', '/s', '/c', commandText]
          : ['bash', '-lc', commandText],
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  throw new Error(`unknown command: ${cmd}`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: String(error?.message || error || 'client failed'),
  }, null, 2)}\n`);
  process.exitCode = 1;
});
