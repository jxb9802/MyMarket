#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const Crypto = require("crypto");
const wallet = require("../wallet");
const p2pNodeRuntime = require("../p2p_node_runtime");

const INPUT_REPORT = process.env.SCHEME_C_INPUT_REPORT || path.join(__dirname, "..", "docs", "scheme_c_probe_report.json");
const OUTPUT_REPORT = process.env.SCHEME_C_FILTERED_OUTPUT || path.join(__dirname, "..", "docs", "scheme_c_filtered_probe_report.json");
const STATE_PATH = process.env.SCHEME_C_STATE_PATH || path.join(__dirname, "..", "data", "state.json");
const TIMEOUT_MS = Number(process.env.SCHEME_C_TIMEOUT_MS || 3500);
const CONCURRENCY = Math.max(1, Number(process.env.SCHEME_C_CONCURRENCY || 4));
const LIMIT = Math.max(1, Number(process.env.SCHEME_C_LIMIT || 15));

function encodeVarInt(n) {
  if (n < 0xfd) return Buffer.from([n]);
  if (n <= 0xffff) {
    const out = Buffer.alloc(3);
    out[0] = 0xfd;
    out.writeUInt16LE(n, 1);
    return out;
  }
  if (n <= 0xffffffff) {
    const out = Buffer.alloc(5);
    out[0] = 0xfe;
    out.writeUInt32LE(n, 1);
    return out;
  }
  throw new Error(`varint too large: ${n}`);
}

function buildFilterloadPayload() {
  const filter = Crypto.randomBytes(10);
  const hashBuf = Buffer.alloc(4);
  hashBuf.writeUInt32LE(10, 0);
  const tweakBuf = Buffer.alloc(4);
  tweakBuf.writeUInt32LE(Crypto.randomBytes(4).readUInt32LE(0), 0);
  return Buffer.concat([
    encodeVarInt(filter.length),
    filter,
    hashBuf,
    tweakBuf,
    Buffer.from([1]),
  ]);
}

function readCandidatePeers() {
  const data = JSON.parse(fs.readFileSync(INPUT_REPORT, "utf8"));
  return data.results.filter((r) => r.pass).slice(0, LIMIT);
}

function readTipHash() {
  const state = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  const cache = state?.sync?.p2pHeightHashCache || {};
  const heights = Object.keys(cache).map((x) => Number(x)).filter(Number.isFinite).sort((a, b) => b - a);
  if (!heights.length) throw new Error("no tip hash found in state sync cache");
  const height = heights[0];
  const hash = String(cache[String(height)] || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`invalid tip hash for ${height}`);
  return { height, hash };
}

function timeoutAfter(ms, label) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(label)), ms));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStep(result, label, fn) {
  const started = Date.now();
  try {
    const value = await Promise.race([fn(), timeoutAfter(TIMEOUT_MS, `${label}_timeout`)]);
    result.steps[label] = { ok: true, ms: Date.now() - started, value: value ?? null };
    return value;
  } catch (err) {
    result.steps[label] = { ok: false, ms: Date.now() - started, error: err?.message || String(err) };
    throw err;
  }
}

function waitForFilteredBlock(peer) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      peer.removeListener("message", onMessage);
      peer.removeListener("notfound", onNotfound);
      peer.removeListener("error_message", onErr);
    };
    const onMessage = ({ command, payload }) => {
      if (command === "merkleblock") {
        cleanup();
        resolve({ command, payloadBytes: payload?.length || 0 });
      } else if (command === "tx") {
        cleanup();
        resolve({ command, payloadBytes: payload?.length || 0 });
      }
    };
    const onNotfound = (msg) => {
      cleanup();
      reject(new Error(`notfound:${JSON.stringify(msg)}`));
    };
    const onErr = ({ error }) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error || "error_message")));
    };
    peer.on("message", onMessage);
    peer.on("notfound", onNotfound);
    peer.on("error_message", onErr);
  });
}

async function testPeer(candidate, tip) {
  const result = {
    node: candidate.node,
    tipHeight: tip.height,
    tipHash: tip.hash,
    steps: {},
    pass: false,
  };
  let session = null;
  let peer = null;
  try {
    await runStep(result, "connect", async () => {
      session = await p2pNodeRuntime.connectSession(wallet.getWalletP2PNodeSelector(), {
        node: candidate.node,
        purpose: "probe",
        mode: "fresh",
        connectTimeoutMs: TIMEOUT_MS,
      });
      peer = session.peer;
      return "connected";
    });
    await runStep(result, "ping", async () => peer.ping());
    await runStep(result, "filterload", async () => {
      peer.sendMessage("filterload", buildFilterloadPayload());
      await delay(600);
      if (!peer.connected) throw new Error("disconnected_after_filterload");
      return "accepted";
    });
    await runStep(result, "getheaders", async () => {
      const headers = await peer.getHeaders({ from: [Buffer.from(tip.hash, "hex")] });
      return Array.isArray(headers) ? headers.length : 0;
    });
    await runStep(result, "filtered_block", async () => {
      const pending = waitForFilteredBlock(peer);
      peer.sendMessage("getdata", require("bsv-p2p/src/messages/getdata").write([Buffer.from(tip.hash, "hex")], 3));
      return await pending;
    });
    result.pass = true;
  } catch (err) {
    result.error = err?.message || String(err);
  } finally {
    try { await Promise.resolve(session?.release?.({ outcome: "scheme_c_filtered_done" })); } catch {}
  }
  return result;
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let index = 0;
  async function worker() {
    while (true) {
      const current = index++;
      if (current >= list.length) return;
      out[current] = await fn(list[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return out;
}

async function main() {
  const candidates = readCandidatePeers();
  const tip = readTipHash();
  const results = await mapLimit(candidates, CONCURRENCY, (row) => testPeer(row, tip));
  const summary = {
    startedAt: new Date().toISOString(),
    testedPeers: results.length,
    tipHeight: tip.height,
    connectPassed: results.filter((r) => r.steps.connect?.ok).length,
    filterloadPassed: results.filter((r) => r.steps.filterload?.ok).length,
    getheadersPassed: results.filter((r) => r.steps.getheaders?.ok).length,
    filteredBlockPassed: results.filter((r) => r.steps.filtered_block?.ok).length,
    fullPass: results.filter((r) => r.pass).length,
  };
  fs.mkdirSync(path.dirname(OUTPUT_REPORT), { recursive: true });
  fs.writeFileSync(OUTPUT_REPORT, JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report=${OUTPUT_REPORT}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
