#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const p2pNodeRuntime = require('../p2p_node_runtime');

const ROOT = path.resolve(__dirname, '..');
const APP_ROOT = path.resolve(ROOT, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_NODES_FILE = path.join(ROOT, 'spv_nodes.txt');
const OUT_REPORT_FILE = path.join(DATA_DIR, 'spv_nodes_scan_report.json');
const STATE_FILE = path.join(DATA_DIR, 'spv_nodes_state.json');

const SOURCES = [
  path.join(ROOT, 'spv_nodes.txt'),
  path.join(APP_ROOT, 'bsv', 'bsv_nodes_open_2026-02-27.txt'),
  path.join(APP_ROOT, 'bsv', 'bsv_nodes_targets.txt'),
  path.join(APP_ROOT, 'bsv', 'bsv_nodes_connectivity_2026-02-27.tsv'),
];

function parseArgs(argv) {
  const args = {
    timeoutMs: 1800,
    concurrency: 32,
    maxCandidates: 600,
    outTop: 100,
    useTop: 8,
    stateOnly: false,
    noWrite: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if (key === '--timeout-ms' && val) args.timeoutMs = Math.max(200, Number(val));
    if (key === '--concurrency' && val) args.concurrency = Math.max(1, Number(val));
    if (key === '--max-candidates' && val) args.maxCandidates = Math.max(10, Number(val));
    if (key === '--out-top' && val) args.outTop = Math.max(8, Number(val));
    if (key === '--use-top' && val) args.useTop = Math.max(1, Number(val));
    if (key === '--source' && val) args.extraSource = path.resolve(val);
    if (key === '--state-only') args.stateOnly = true;
    if (key === '--no-write') args.noWrite = true;
  }
  return args;
}

function normalizeEndpoint(raw, defaultPort = 8333) {
  const s = String(raw || '').trim();
  if (!s || s.startsWith('#')) return null;
  const cols = s.split(/\s+/).map((x) => x.trim()).filter(Boolean);
  // Connectivity TSV format: idx host port status
  if (cols.length >= 4 && /^open$/i.test(cols[3])) {
    const host = cols[1];
    const port = Number(cols[2]);
    if (host && Number.isInteger(port) && port > 0 && port <= 65535) return `${host}:${port}`;
  }
  if (/^\S+\s+\d+$/.test(s)) {
    const [host, p] = s.split(/\s+/);
    const port = Number(p);
    if (host && Number.isInteger(port) && port > 0 && port <= 65535) return `${host}:${port}`;
  }
  if (!s.includes(':')) return `${s}:${defaultPort}`;
  const [host, p] = s.split(':');
  const port = Number(p);
  if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return `${host}:${port}`;
}

function collectCandidates(files, maxCandidates) {
  const out = [];
  const seen = new Set();
  for (const file of files) {
    if (!file || !fs.existsSync(file)) continue;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const ep = normalizeEndpoint(line);
      if (!ep || seen.has(ep)) continue;
      seen.add(ep);
      out.push(ep);
      if (out.length >= maxCandidates) return out;
    }
  }
  const env = String(process.env.SPV_EXTRA_NODES || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const raw of env) {
    const ep = normalizeEndpoint(raw);
    if (!ep || seen.has(ep)) continue;
    seen.add(ep);
    out.push(ep);
    if (out.length >= maxCandidates) break;
  }
  return out;
}

function collectCandidatesFromState(maxCandidates) {
  const state = loadNodeState();
  const out = [];
  const seen = new Set();
  for (const row of (state.nodes || [])) {
    const ep = normalizeEndpoint(row?.endpoint || '');
    if (!ep || seen.has(ep)) continue;
    seen.add(ep);
    out.push(ep);
    if (out.length >= maxCandidates) break;
  }
  return out;
}

function probeEndpoint(endpoint, timeoutMs) {
  return p2pNodeRuntime.probeTcp(endpoint, timeoutMs).then((result) => ({
    endpoint,
    ok: result.ok === true,
    latencyMs: result.ok ? Number(result.latencyMs || 0) : null,
    error: result.ok ? null : String(result.error || 'error'),
  }));
}

async function runPool(items, worker, concurrency) {
  const out = [];
  let idx = 0;
  async function next() {
    if (idx >= items.length) return;
    const i = idx;
    idx += 1;
    out[i] = await worker(items[i], i);
    await next();
  }
  const jobs = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i += 1) jobs.push(next());
  await Promise.all(jobs);
  return out;
}

function loadNodeState() {
  if (!fs.existsSync(STATE_FILE)) return { version: 1, nodes: [] };
  return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
}

function saveNodeState(state) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function updateNodeState(results) {
  const prev = loadNodeState();
  const map = new Map((prev.nodes || []).map((n) => [n.endpoint, n]));
  const now = Date.now();
  for (const r of results) {
    const row = map.get(r.endpoint) || {
      endpoint: r.endpoint,
      score: 0,
      successCount: 0,
      failCount: 0,
      consecutiveFail: 0,
      lastSuccessAt: null,
      lastFailAt: null,
      banUntil: 0,
      source: 'scanner',
      updatedAt: new Date().toISOString(),
    };
    if (r.ok) {
      row.successCount = Number(row.successCount || 0) + 1;
      row.consecutiveFail = 0;
      row.lastSuccessAt = new Date().toISOString();
      row.banUntil = 0;
      row.score = Math.min(100, Number(row.score || 0) + 8);
    } else {
      row.failCount = Number(row.failCount || 0) + 1;
      row.consecutiveFail = Number(row.consecutiveFail || 0) + 1;
      row.lastFailAt = new Date().toISOString();
      row.score = Math.max(-100, Number(row.score || 0) - 2);
      if (row.consecutiveFail >= 6) row.banUntil = now + 5 * 60 * 1000;
    }
    row.updatedAt = new Date().toISOString();
    map.set(r.endpoint, row);
  }
  const nodes = Array.from(map.values())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 100);
  saveNodeState({ version: 1, nodes });
  return nodes;
}

async function main() {
  const args = parseArgs(process.argv);
  const files = [...SOURCES];
  if (args.extraSource) files.push(args.extraSource);
  const candidates = args.stateOnly
    ? collectCandidatesFromState(args.maxCandidates)
    : collectCandidates(files, args.maxCandidates);
  if (!candidates.length) {
    console.error('No candidates found.');
    process.exit(1);
  }

  console.log(`Scanning ${candidates.length} candidates (timeout=${args.timeoutMs}ms, concurrency=${args.concurrency}) ...`);
  const results = await runPool(candidates, (ep) => probeEndpoint(ep, args.timeoutMs), args.concurrency);
  const ok = results.filter((r) => r.ok);
  const fail = results.length - ok.length;
  const okSorted = ok.slice().sort((a, b) => Number(a.latencyMs || 9e9) - Number(b.latencyMs || 9e9));
  const failReasonCounts = results
    .filter((r) => !r.ok)
    .reduce((acc, r) => {
      const key = String(r.error || 'unknown');
      acc[key] = Number(acc[key] || 0) + 1;
      return acc;
    }, {});
  const topFailReasons = Object.entries(failReasonCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const report = {
    scannedAt: new Date().toISOString(),
    config: args,
    total: results.length,
    ok: ok.length,
    fail,
    okRate: results.length ? ok.length / results.length : 0,
    topFailReasons,
    best: okSorted.slice(0, args.outTop),
    failed: results.filter((r) => !r.ok).slice(0, 200),
  };
  fs.writeFileSync(OUT_REPORT_FILE, JSON.stringify(report, null, 2));

  const outList = okSorted.slice(0, args.outTop).map((r) => r.endpoint);
  if (!args.noWrite && outList.length > 0) {
    fs.writeFileSync(OUT_NODES_FILE, `${outList.join('\n')}\n`);
  }
  if (!args.noWrite) updateNodeState(results);

  console.log(`Reachable: ${ok.length}/${results.length}`);
  console.log(`Top failure reasons: ${topFailReasons.map((x) => `${x.reason}=${x.count}`).join(', ') || 'none'}`);
  if (!args.noWrite && outList.length > 0) {
    console.log(`Saved top ${outList.length} nodes -> ${OUT_NODES_FILE}`);
  } else if (!args.noWrite) {
    console.log(`No reachable nodes found; kept existing ${OUT_NODES_FILE} unchanged.`);
  }
  console.log(`Report -> ${OUT_REPORT_FILE}`);
  console.log(`Runtime top-use suggestion: first ${Math.min(args.useTop, outList.length)} nodes`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
