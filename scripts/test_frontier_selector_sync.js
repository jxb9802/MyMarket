#!/usr/bin/env node

const syncService = require('../independent_sync_service');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    const next = String(argv[i + 1] || '');
    if (arg === '--start-height') {
      out.startHeight = Math.max(0, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--count') {
      out.count = Math.max(1, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--connect-timeout-ms') {
      out.connectTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--getblock-timeout-ms') {
      out.getBlockTimeoutMs = Math.max(1000, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--max-rounds-per-block') {
      out.maxRoundsPerBlock = Math.max(1, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--candidate-limit') {
      out.candidateLimit = Math.max(8, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--parallel-blocks') {
      out.parallelBlocks = Math.max(1, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--target-height') {
      out.targetHeight = Math.max(0, Number(next || 0));
      i += 1;
      continue;
    }
    if (arg === '--to-tip') {
      out.toTip = true;
      continue;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await syncService.runSync({
    ...args,
    onWindow(windowSummary) {
      process.stderr.write(
        `[frontier-sync] window ${windowSummary.startHeight}-${windowSummary.endHeight} `
        + `done: completed=${windowSummary.completedCount} `
        + `failed=${windowSummary.failedCount} `
        + `successNodes=${windowSummary.successNodeCount} `
        + `elapsedMs=${windowSummary.elapsedMs}\n`,
      );
    },
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (Number(summary?.failedCount || 0) > 0) process.exitCode = 2;
}

main().catch((err) => {
  process.stderr.write(`${String(err?.stack || err?.message || err)}\n`);
  process.exit(1);
});
