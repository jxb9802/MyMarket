#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const Crypto = require("crypto");
const wallet = require("../wallet");
const p2pNodeRuntime = require("../p2p_node_runtime");

const LOG_PATH = process.env.SCHEME_C_LOG_PATH || path.join(__dirname, "..", "log", "send-debug.log");
const OUTPUT_PATH = process.env.SCHEME_C_OUTPUT_PATH || path.join(__dirname, "..", "docs", "scheme_c_probe_report.json");
const TIMEOUT_MS = Number(process.env.SCHEME_C_TIMEOUT_MS || 2500);
const STABLE_WAIT_MS = Number(process.env.SCHEME_C_STABLE_WAIT_MS || 900);
const CONCURRENCY = Math.max(1, Number(process.env.SCHEME_C_CONCURRENCY || 5));
const LIMIT = Math.max(0, Number(process.env.SCHEME_C_LIMIT || 0));

const NODE_BLOOM = 0x04n;

function readLatestPeers(logPath) {
  const content = fs.readFileSync(logPath, "utf8");
  const byNode = new Map();
  for (const line of content.split("\n")) {
    if (!line.includes("\"event\":\"spv_peer_version\"")) continue;
    try {
      const row = JSON.parse(line);
      if (!row?.node || !row?.services) continue;
      byNode.set(row.node, row);
    } catch {}
  }
  return Array.from(byNode.values())
    .sort((a, b) => String(a.node).localeCompare(String(b.node)))
    .slice(0, LIMIT > 0 ? LIMIT : undefined);
}

function hasServiceBit(servicesHex, bit) {
  try {
    return (BigInt(`0x${servicesHex}`) & bit) !== 0n;
  } catch {
    return false;
  }
}

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
  const hashFuncs = 10;
  const tweak = Crypto.randomBytes(4).readUInt32LE(0);
  const flags = 1;
  const hashBuf = Buffer.alloc(4);
  hashBuf.writeUInt32LE(hashFuncs, 0);
  const tweakBuf = Buffer.alloc(4);
  tweakBuf.writeUInt32LE(tweak, 0);
  const payload = Buffer.concat([
    encodeVarInt(filter.length),
    filter,
    hashBuf,
    tweakBuf,
    Buffer.from([flags]),
  ]);
  return payload;
}

function buildFilteraddPayload() {
  const data = Crypto.randomBytes(20);
  return Buffer.concat([encodeVarInt(data.length), data]);
}

function timeoutAfter(ms, label) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(label)), ms);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runStep(result, label, fn) {
  const started = Date.now();
  try {
    const value = await Promise.race([
      fn(),
      timeoutAfter(TIMEOUT_MS, `${label}_timeout`),
    ]);
    result.steps[label] = { ok: true, ms: Date.now() - started, value: value ?? null };
    return value;
  } catch (err) {
    result.steps[label] = {
      ok: false,
      ms: Date.now() - started,
      error: err?.message || String(err),
    };
    throw err;
  }
}

async function testPeer(row) {
  const result = {
    node: row.node,
    advertisedServices: row.services || null,
    advertisedVersion: Number(row.version || 0),
    advertisedBloom: hasServiceBit(row.services, NODE_BLOOM),
    steps: {},
    pass: false,
  };
  let session = null;
  let peer = null;

  let lastReject = null;
  let disconnectReason = null;
  peer.on("reject", (msg) => {
    lastReject = msg;
  });
  peer.on("disconnected", (msg) => {
    disconnectReason = msg || "disconnected";
  });
  peer.on("error_socket", ({ error }) => {
    disconnectReason = error?.message || String(error);
  });

  try {
    await runStep(result, "connect", async () => {
      session = await p2pNodeRuntime.connectSession(wallet.getWalletP2PNodeSelector(), {
        node: row.node,
        purpose: "probe",
        mode: "fresh",
        connectTimeoutMs: TIMEOUT_MS,
      });
      peer = session.peer;
      return "connected";
    });
    await runStep(result, "ping_initial", async () => peer.ping());
    await runStep(result, "filterload", async () => {
      lastReject = null;
      peer.sendMessage("filterload", buildFilterloadPayload());
      await delay(STABLE_WAIT_MS);
      if (!peer.connected) throw new Error(disconnectReason || "disconnected_after_filterload");
      if (lastReject) throw new Error(`reject:${lastReject.message || lastReject.code || "filterload"}`);
      return "accepted";
    });
    await runStep(result, "ping_after_filterload", async () => peer.ping());
    await runStep(result, "filteradd", async () => {
      lastReject = null;
      peer.sendMessage("filteradd", buildFilteraddPayload());
      await delay(STABLE_WAIT_MS);
      if (!peer.connected) throw new Error(disconnectReason || "disconnected_after_filteradd");
      if (lastReject) throw new Error(`reject:${lastReject.message || lastReject.code || "filteradd"}`);
      return "accepted";
    });
    await runStep(result, "ping_after_filteradd", async () => peer.ping());
    await runStep(result, "filterclear", async () => {
      lastReject = null;
      peer.sendMessage("filterclear", null);
      await delay(STABLE_WAIT_MS);
      if (!peer.connected) throw new Error(disconnectReason || "disconnected_after_filterclear");
      if (lastReject) throw new Error(`reject:${lastReject.message || lastReject.code || "filterclear"}`);
      return "accepted";
    });
    await runStep(result, "ping_after_filterclear", async () => peer.ping());
    result.pass = true;
  } catch (err) {
    result.error = err?.message || String(err);
    result.reject = lastReject;
    result.disconnectReason = disconnectReason;
  } finally {
    try {
      await Promise.resolve(session?.release?.({ outcome: "scheme_c_probe_done" }));
    } catch {}
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
  const peers = readLatestPeers(LOG_PATH);
  if (!peers.length) {
    throw new Error(`no peers found in ${LOG_PATH}`);
  }
  const startedAt = new Date().toISOString();
  const results = await mapLimit(peers, CONCURRENCY, testPeer);
  const summary = {
    startedAt,
    finishedAt: new Date().toISOString(),
    totalPeers: results.length,
    advertisedBloomPeers: results.filter((r) => r.advertisedBloom).length,
    handshakePassed: results.filter((r) => r.steps.connect?.ok).length,
    initialPingPassed: results.filter((r) => r.steps.ping_initial?.ok).length,
    filterloadAccepted: results.filter((r) => r.steps.filterload?.ok).length,
    filteraddAccepted: results.filter((r) => r.steps.filteradd?.ok).length,
    filterclearAccepted: results.filter((r) => r.steps.filterclear?.ok).length,
    fullPass: results.filter((r) => r.pass).length,
  };
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify({ summary, results }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`report=${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
