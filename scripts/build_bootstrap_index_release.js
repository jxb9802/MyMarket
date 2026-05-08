#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = process.env.BSV_MARKET_DATA_DIR
  ? path.resolve(process.env.BSV_MARKET_DATA_DIR)
  : path.join(ROOT, 'data');
const INDEX_DIR = path.join(DATA_DIR, 'bootstrap_index');
const DEFAULT_OUT_DIR = path.join(ROOT, 'dist', 'bootstrap_index_release');

function usage() {
  console.log(`Usage:
  node scripts/build_bootstrap_index_release.js [--index data/bootstrap_index/bmmkt2-index-mainnet-HEIGHT.json.gz] [--out dist/bootstrap_index_release] [--repo owner/repo] [--tag bootstrap-index-latest]

Output:
  manifest.json
  bootstrap_index_sources.json
  bmmkt2-index-full-mainnet-FROM-TO.json.gz
  bmmkt2-index-lite-mainnet-FROM-TO.json.gz
  RELEASE_NOTES_BOOTSTRAP_INDEX.txt

The generated folder is a local release-asset staging directory. Upload these
files to GitHub Release or include them in a software package.`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    args[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function readMaybeGzipJson(file) {
  const buf = fs.readFileSync(file);
  const text = file.endsWith('.gz') ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  return JSON.parse(text);
}

function writeGzipJson(file, payload) {
  const json = JSON.stringify(payload);
  const gz = zlib.gzipSync(json, { level: 9 });
  fs.writeFileSync(file, gz);
  return {
    file,
    bytes: gz.length,
    sha256: sha256Hex(gz),
    jsonBytes: Buffer.byteLength(json),
  };
}

function latestIndexFile() {
  if (!fs.existsSync(INDEX_DIR)) return '';
  const files = fs.readdirSync(INDEX_DIR)
    .filter((name) => /^bmmkt2-index-mainnet-\d+\.json(?:\.gz)?$/.test(name))
    .map((name) => path.join(INDEX_DIR, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] || '';
}

function stripFullEntryToLite(row) {
  return {
    height: row.height,
    blockHash: row.blockHash,
    txid: row.txid,
    txIndex: row.txIndex,
    eventType: row.eventType,
    entityId: row.entityId || '',
    merchantId: row.merchantId || '',
    walletId: row.walletId || '',
    payloadHash: row.payloadHash || '',
    rawtxHash: row.rawtxHash || '',
  };
}

function buildRelease(args) {
  const indexFile = path.resolve(args.index || latestIndexFile());
  if (!indexFile || !fs.existsSync(indexFile)) {
    throw new Error('No index file found. Run sync_index_benchmark.js build-index first or pass --index.');
  }
  const outDir = path.resolve(args.out || DEFAULT_OUT_DIR);
  fs.mkdirSync(outDir, { recursive: true });

  const fullPayload = readMaybeGzipJson(indexFile);
  const entries = Array.isArray(fullPayload.entries) ? fullPayload.entries : [];
  const baseManifest = fullPayload.manifest || {};
  const fromHeight = Number(baseManifest.fromHeight || entries[0]?.height || 0);
  const toHeight = Number(baseManifest.toHeight || entries[entries.length - 1]?.height || 0);
  if (!Number.isFinite(fromHeight) || !Number.isFinite(toHeight) || fromHeight <= 0 || toHeight <= 0) {
    throw new Error('Index manifest is missing fromHeight/toHeight');
  }

  const fullAssetName = `bmmkt2-index-full-mainnet-${fromHeight}-${toHeight}.json.gz`;
  const liteAssetName = `bmmkt2-index-lite-mainnet-${fromHeight}-${toHeight}.json.gz`;
  const fullAssetPath = path.join(outDir, fullAssetName);
  const liteAssetPath = path.join(outDir, liteAssetName);

  const fullReleasePayload = {
    ...fullPayload,
    releaseAssetKind: 'full',
  };
  const fullAsset = writeGzipJson(fullAssetPath, fullReleasePayload);

  const litePayload = {
    version: fullPayload.version || 1,
    createdAt: new Date().toISOString(),
    releaseAssetKind: 'lite',
    manifest: {
      ...baseManifest,
      assetKind: 'lite',
      rawtxCount: 0,
      missingRawtxCount: entries.length,
      proofCount: 0,
      missingProofCount: entries.length,
    },
    entries: entries.map(stripFullEntryToLite),
  };
  const liteAsset = writeGzipJson(liteAssetPath, litePayload);

  const missingRawtxCount = entries.filter((row) => !String(row.rawtx || '').trim()).length;
  const missingProofCount = entries.filter((row) => !String(row.proofHex || '').trim()).length;
  const productionReady = missingRawtxCount === 0 && missingProofCount === 0;
  const releaseManifest = {
    version: 1,
    network: baseManifest.network || 'mainnet',
    marker: baseManifest.marker || 'BMMKT2',
    fromHeight,
    toHeight,
    tipHash: String(baseManifest.tipHash || ''),
    createdAt: new Date().toISOString(),
    productionReady,
    productionReadyReason: productionReady
      ? 'full index has rawtx and merkle proof for every entry'
      : `not production-ready: missingRawtxCount=${missingRawtxCount}, missingProofCount=${missingProofCount}`,
    eventCount: entries.length,
    txCount: Number(baseManifest.txCount || new Set(entries.map((row) => row.txid).filter(Boolean)).size),
    relevantBlockCount: Number(baseManifest.relevantBlockCount || new Set(entries.map((row) => row.height).filter(Boolean)).size),
    full: {
      indexFile: fullAssetName,
      indexSha256: fullAsset.sha256,
      bytes: fullAsset.bytes,
      jsonBytes: fullAsset.jsonBytes,
      rawtxCount: entries.length - missingRawtxCount,
      missingRawtxCount,
      proofCount: entries.length - missingProofCount,
      missingProofCount,
    },
    lite: {
      indexFile: liteAssetName,
      indexSha256: liteAsset.sha256,
      bytes: liteAsset.bytes,
      jsonBytes: liteAsset.jsonBytes,
    },
    githubRelease: args.repo ? {
      repo: String(args.repo),
      tag: String(args.tag || 'bootstrap-index-latest'),
      tagApiUrl: `https://api.github.com/repos/${String(args.repo).replace(/^\/+|\/+$/g, '')}/releases/tags/${encodeURIComponent(String(args.tag || 'bootstrap-index-latest'))}`,
      latestApiUrl: `https://api.github.com/repos/${String(args.repo).replace(/^\/+|\/+$/g, '')}/releases/latest`,
    } : null,
  };

  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(releaseManifest, null, 2));

  const sources = {
    version: 1,
    sources: [
      {
        type: 'local',
        path: 'bootstrap_index/manifest.json',
      },
      ...(args.repo ? [{
        type: 'github_release',
        repo: String(args.repo),
        release: String(args.tag || 'bootstrap-index-latest'),
      }] : []),
      {
        type: 'node',
        url: 'http://8.136.3.174:8091/api/bootstrap-index/manifest',
      },
    ],
  };
  const sourcesPath = path.join(outDir, 'bootstrap_index_sources.json');
  fs.writeFileSync(sourcesPath, JSON.stringify(sources, null, 2));

  const notes = [
    'Bootstrap Index Release Assets',
    '',
    `Range: ${fromHeight} -> ${toHeight}`,
    `Events: ${releaseManifest.eventCount}`,
    `Transactions: ${releaseManifest.txCount}`,
    `Relevant blocks: ${releaseManifest.relevantBlockCount}`,
    `Production ready: ${productionReady ? 'yes' : 'no'}`,
    `Reason: ${releaseManifest.productionReadyReason}`,
    '',
    'Upload or package these files together:',
    `- manifest.json`,
    `- ${fullAssetName}`,
    `- ${liteAssetName}`,
    '- bootstrap_index_sources.json',
    '',
    'The current full index can be used for benchmark/preload only when productionReady=false.',
    'Production fast sync requires rawtx and merkle proof for every entry.',
    '',
  ].join('\n');
  const notesPath = path.join(outDir, 'RELEASE_NOTES_BOOTSTRAP_INDEX.txt');
  fs.writeFileSync(notesPath, notes);

  return {
    ok: true,
    outDir,
    manifest: manifestPath,
    sources: sourcesPath,
    notes: notesPath,
    fullAsset: fullAssetPath,
    liteAsset: liteAssetPath,
    ...releaseManifest,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  const result = buildRelease(args);
  console.log(JSON.stringify(result, null, 2));
}

try {
  main();
} catch (err) {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err || 'failed') }, null, 2));
  process.exitCode = 1;
}
