#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");

const BASE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = process.env.BSV_MARKET_DATA_DIR
  ? path.resolve(process.env.BSV_MARKET_DATA_DIR)
  : path.join(BASE_DIR, "data");
const RUNTIME_PORT_FILE = path.join(DATA_DIR, "runtime_port.json");
const DEFAULT_START = Number.parseInt(process.env.BSV_MARKET_PORT || "8091", 10);
const DEFAULT_END = Number.parseInt(process.env.BSV_MARKET_PORT_MAX || "8100", 10);

function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ port, host }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(start, end) {
  for (let port = start; port <= end; port += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port found in range ${start}-${end}`);
}

function writeRuntimePort(port) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(
    RUNTIME_PORT_FILE,
    `${JSON.stringify(
      {
        port,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function main() {
  const start = Number.parseInt(process.argv[2] || `${DEFAULT_START}`, 10);
  const end = Number.parseInt(process.argv[3] || `${DEFAULT_END}`, 10);
  const shouldWrite = process.argv.includes("--write");
  const port = await findFreePort(start, end);
  if (shouldWrite) writeRuntimePort(port);
  process.stdout.write(`${port}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
