#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_REPO = 'jxb9802/MyMarket';
const DEFAULT_TAG = 'bootstrap-index-latest';
const DEFAULT_OUT_DIR = path.join(ROOT, 'dist', 'bootstrap_index_release_full');

function usage() {
  console.log(`Usage:
  node scripts/prepare_bootstrap_release.js [--repo jxb9802/MyMarket] [--tag bootstrap-index-latest] [--from 947110] [--to latest] [--out dist/bootstrap_index_release_full] [--upload]

Environment:
  GITHUB_TOKEN is required only when --upload is used.
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--upload' || arg === '--dry-run') {
      args[arg.slice(2)] = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    args[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function runNode(script, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (buf) => { stdout += buf.toString(); });
    child.stderr.on('data', (buf) => { stderr += buf.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${path.basename(script)} failed with code ${code}: ${stderr || stdout}`));
        return;
      }
      let parsed = null;
      try {
        const start = stdout.lastIndexOf('\n{');
        parsed = JSON.parse((start >= 0 ? stdout.slice(start + 1) : stdout).trim());
      } catch (_) {}
      resolve({ stdout, stderr, json: parsed });
    });
  });
}

function assertOk(result, label) {
  if (!result?.json || result.json.ok !== true) {
    throw new Error(`${label} did not return ok=true`);
  }
  return result.json;
}

function assetAllowList(outDir, manifest) {
  const fullName = String(manifest?.full?.indexFile || '').trim();
  const liteName = String(manifest?.lite?.indexFile || '').trim();
  return [
    'manifest.json',
    'bootstrap_index_sources.json',
    'RELEASE_NOTES_BOOTSTRAP_INDEX.txt',
    fullName,
    liteName,
  ]
    .filter(Boolean)
    .map((name) => path.join(outDir, name))
    .filter((file) => fs.existsSync(file));
}

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function getOrCreateRelease({ repo, tag, token }) {
  const apiBase = `https://api.github.com/repos/${repo}`;
  const headers = githubHeaders(token);
  try {
    const { data } = await axios.get(`${apiBase}/releases/tags/${encodeURIComponent(tag)}`, { headers, timeout: 20000 });
    return data;
  } catch (err) {
    if (Number(err?.response?.status || 0) !== 404) throw err;
  }
  const { data } = await axios.post(`${apiBase}/releases`, {
    tag_name: tag,
    name: 'Bootstrap Index Latest',
    body: 'Latest bootstrap index assets for automatic business sync recovery.',
    draft: false,
    prerelease: false,
  }, { headers, timeout: 20000 });
  return data;
}

async function deleteMatchingAssets(release, files, token) {
  const headers = githubHeaders(token);
  const wanted = new Set(files.map((file) => path.basename(file)));
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  for (const asset of assets) {
    const name = String(asset?.name || '');
    const isBootstrapAsset = wanted.has(name)
      || name === 'manifest.json'
      || name === 'bootstrap_index_sources.json'
      || name === 'RELEASE_NOTES_BOOTSTRAP_INDEX.txt'
      || /^bmmkt2-index-(full|lite)-mainnet-\d+-\d+\.json\.gz$/.test(name);
    if (!isBootstrapAsset || !asset?.url) continue;
    await axios.delete(asset.url, { headers, timeout: 20000 });
  }
}

async function uploadAssets({ repo, release, files, token }) {
  const headers = {
    ...githubHeaders(token),
    'Content-Type': 'application/octet-stream',
  };
  const uploadBase = String(release.upload_url || '').split('{')[0];
  if (!uploadBase) throw new Error('GitHub release upload_url is missing');
  const uploaded = [];
  for (const file of files) {
    const name = path.basename(file);
    const url = `${uploadBase}?name=${encodeURIComponent(name)}`;
    const body = fs.readFileSync(file);
    const { data } = await axios.post(url, body, {
      headers,
      maxBodyLength: Infinity,
      timeout: 60000,
    });
    uploaded.push({
      name,
      size: body.length,
      browserDownloadUrl: String(data?.browser_download_url || ''),
    });
  }
  return uploaded;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const repo = String(args.repo || DEFAULT_REPO).replace(/^\/+|\/+$/g, '');
  const tag = String(args.tag || DEFAULT_TAG).trim();
  const outDir = path.resolve(args.out || DEFAULT_OUT_DIR);
  const from = String(args.from || '947110');
  const to = String(args.to || 'latest');
  const syncTool = path.join(ROOT, 'scripts', 'sync_index_benchmark.js');
  const buildReleaseTool = path.join(ROOT, 'scripts', 'build_bootstrap_index_release.js');

  const built = assertOk(await runNode(syncTool, ['build-index', '--from', from, '--to', to, '--gzip']), 'build-index');
  const backfilledPath = path.join(path.dirname(built.index), path.basename(built.index).replace(/\.json\.gz$/, '.full.json.gz'));
  const backfilled = assertOk(await runNode(syncTool, ['backfill-index', '--index', built.index, '--out', backfilledPath]), 'backfill-index');
  const replay = assertOk(await runNode(syncTool, ['replay-index', '--index', backfilled.index]), 'replay-index');
  if (Number(replay.invalidBlockHash || 0) !== 0 || Number(replay.rawtxFailures?.length || 0) !== 0) {
    throw new Error('Replay validation failed');
  }
  const release = assertOk(await runNode(buildReleaseTool, ['--index', backfilled.index, '--out', outDir, '--repo', repo, '--tag', tag]), 'build release');
  const manifestFile = path.join(outDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.productionReady !== true) {
    throw new Error(`Release is not production ready: ${manifest.productionReadyReason || ''}`);
  }
  const files = assetAllowList(outDir, manifest);
  if (files.length < 5) throw new Error('Release asset set is incomplete');

  let upload = null;
  if (args.upload === true) {
    const token = String(process.env.GITHUB_TOKEN || '').trim();
    if (!token) throw new Error('GITHUB_TOKEN is required for --upload');
    const ghRelease = await getOrCreateRelease({ repo, tag, token });
    await deleteMatchingAssets(ghRelease, files, token);
    const freshRelease = await getOrCreateRelease({ repo, tag, token });
    const uploaded = await uploadAssets({ repo, release: freshRelease, files, token });
    upload = {
      repo,
      tag,
      releaseUrl: String(freshRelease.html_url || `https://github.com/${repo}/releases/tag/${tag}`),
      uploaded,
    };
  }

  console.log(JSON.stringify({
    ok: true,
    repo,
    tag,
    outDir,
    buildIndex: built.index,
    backfilledIndex: backfilled.index,
    replay: {
      entries: replay.entries,
      validBlockHash: replay.validBlockHash,
      rawtxTxidOk: replay.rawtxTxidOk,
      rawtxMarkerOk: replay.rawtxMarkerOk,
      proofPresent: replay.proofPresent,
    },
    release: {
      productionReady: manifest.productionReady,
      fromHeight: manifest.fromHeight,
      toHeight: manifest.toHeight,
      eventCount: manifest.eventCount,
      full: manifest.full,
      lite: manifest.lite,
    },
    files: files.map((file) => ({ name: path.basename(file), bytes: fs.statSync(file).size })),
    upload,
  }, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err || 'failed') }, null, 2));
  process.exitCode = 1;
});
