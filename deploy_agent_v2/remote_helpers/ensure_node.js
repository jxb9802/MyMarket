#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const part = String(argv[i] || '');
    if (!part.startsWith('--')) continue;
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

function compareVersions(a, b) {
  const left = String(a || '').replace(/^v/, '').split('.').map((n) => Number(n || 0));
  const right = String(b || '').replace(/^v/, '').split('.').map((n) => Number(n || 0));
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const l = left[i] || 0;
    const r = right[i] || 0;
    if (l > r) return 1;
    if (l < r) return -1;
  }
  return 0;
}

function platformKey() {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

function archiveInfo(version, arch) {
  const platform = platformKey();
  if (platform === 'win') {
    return {
      fileName: `node-v${version}-win-${arch}.zip`,
      rootName: `node-v${version}-win-${arch}`,
    };
  }
  return {
    fileName: `node-v${version}-${platform}-${arch}.tar.gz`,
    rootName: `node-v${version}-${platform}-${arch}`,
  };
}

function managedNodePath(installDir) {
  return process.platform === 'win32'
    ? path.join(installDir, 'node.exe')
    : path.join(installDir, 'bin', 'node');
}

function markerFile(installDir) {
  return path.join(installDir, '.node-version');
}

function installedVersion(installDir) {
  try {
    return String(fs.readFileSync(markerFile(installDir), 'utf8') || '').trim();
  } catch (_) {
    return '';
  }
}

function nodeExecutableVersion(nodeFile) {
  if (!fs.existsSync(nodeFile)) return '';
  const result = spawnSync(nodeFile, ['-v'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) return '';
  return String(result.stdout || '').trim().replace(/^v/, '');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function download(url, file) {
  return new Promise((resolve, reject) => {
    const handle = fs.createWriteStream(file);
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        handle.close(() => {});
        fs.rmSync(file, { force: true });
        return resolve(download(res.headers.location, file));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`download failed: ${res.statusCode} ${url}`));
      }
      res.pipe(handle);
      handle.on('finish', () => handle.close(resolve));
    }).on('error', reject);
  });
}

function runOrThrow(command, args, options) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = String(args.version || process.env.DEPLOY_AGENT_NODE_VERSION || '24.14.0').trim();
  const installDir = path.resolve(String(args['install-dir'] || '.deploy/node'));
  const arch = process.arch === 'x64' ? 'x64' : process.arch;
  const existingNode = managedNodePath(installDir);
  const existingVersion = installedVersion(installDir) || nodeExecutableVersion(existingNode);

  if (existingVersion && fs.existsSync(existingNode) && compareVersions(existingVersion, version) >= 0) {
    try { fs.writeFileSync(markerFile(installDir), `${existingVersion}\n`); } catch (_) {}
    process.stdout.write(`${JSON.stringify({
      ok: true,
      reused: true,
      installDir,
      node: existingNode,
      version: existingVersion,
    })}\n`);
    return;
  }

  ensureDir(path.dirname(installDir));
  const tmpRoot = path.join(path.dirname(installDir), `.node-download-${Date.now()}`);
  ensureDir(tmpRoot);
  const info = archiveInfo(version, arch);
  const url = `https://nodejs.org/dist/v${version}/${info.fileName}`;
  const archiveFile = path.join(tmpRoot, info.fileName);
  await download(url, archiveFile);

  if (process.platform === 'win32') {
    runOrThrow('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${archiveFile.replace(/'/g, "''")}' -DestinationPath '${tmpRoot.replace(/'/g, "''")}' -Force`,
    ]);
  } else {
    runOrThrow('tar', ['-xzf', archiveFile, '-C', tmpRoot]);
  }

  const extractedRoot = path.join(tmpRoot, info.rootName);
  if (!fs.existsSync(extractedRoot)) {
    throw new Error(`extracted node root not found: ${extractedRoot}`);
  }

  const replacementDir = `${installDir}.next`;
  fs.rmSync(replacementDir, { recursive: true, force: true });
  fs.renameSync(extractedRoot, replacementDir);
  fs.rmSync(installDir, { recursive: true, force: true });
  fs.renameSync(replacementDir, installDir);
  fs.writeFileSync(markerFile(installDir), `${version}\n`);
  fs.rmSync(tmpRoot, { recursive: true, force: true });

  process.stdout.write(`${JSON.stringify({
    ok: true,
    installed: true,
    installDir,
    node: managedNodePath(installDir),
    version,
    platform: `${process.platform}/${arch}`,
    hostNode: process.version,
    hostPlatform: `${os.platform()}/${os.arch()}`,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: String(error && error.message ? error.message : error),
  })}\n`);
  process.exitCode = 1;
});
