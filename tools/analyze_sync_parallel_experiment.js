#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    log: path.join(process.cwd(), 'log', 'market-debug.log'),
    run: 'latest',
    limitBlocks: 100,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--log') args.log = String(argv[++i] || args.log);
    else if (arg === '--run') args.run = String(argv[++i] || args.run);
    else if (arg === '--limit-blocks') args.limitBlocks = Math.max(1, Number(argv[++i] || args.limitBlocks));
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log([
    'Usage: node tools/analyze_sync_parallel_experiment.js [--log <path>] [--run latest|<index>] [--limit-blocks <n>]',
    '',
    'Outputs per-run sync experiment metrics, including:',
    '- raw first-round success rate',
    '- eventual success rate',
    '- per-node success',
    "- per-node success excluding a node's first observed failed attempt",
    '- per-node success after that node has already failed once in the same run',
  ].join('\n'));
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch (_) {
    return null;
  }
}

function percent(ok, total) {
  if (!total) return 'n/a';
  return `${((ok / total) * 100).toFixed(1)}%`;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  const raw = fs.readFileSync(args.log, 'utf8');
  const lines = raw.split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const row = safeJson(lines[i]);
    if (!row || row.event !== 'independent_sync_service_started') continue;
    starts.push({ index: i, row });
  }
  if (!starts.length) {
    console.error('No independent_sync_service_started found');
    process.exit(1);
  }
  let startEntry = starts[starts.length - 1];
  if (args.run !== 'latest') {
    const idx = Number(args.run);
    if (Number.isFinite(idx) && idx >= 0 && idx < starts.length) startEntry = starts[idx];
  }
  const startPos = startEntry.index;
  const startRow = startEntry.row;
  const endPos = (() => {
    const current = starts.findIndex((entry) => entry.index === startPos);
    const next = starts[current + 1];
    return next ? next.index : lines.length;
  })();

  const perHeight = new Map();
  for (let i = startPos; i < endPos; i += 1) {
    const row = safeJson(lines[i]);
    if (!row) continue;
    if (row.event !== 'independent_sync_block_round_finished') continue;
    const height = Number(row.height || 0);
    if (!height) continue;
    if (!perHeight.has(height)) perHeight.set(height, []);
    perHeight.get(height).push(row);
  }

  const heights = Array.from(perHeight.keys()).sort((a, b) => a - b).slice(0, args.limitBlocks);
  const nodeStats = new Map();
  let firstRoundTotal = 0;
  let firstRoundSuccess = 0;
  let eventualTotal = 0;
  let eventualSuccess = 0;

  function ensureNode(node) {
    const key = String(node || '').trim();
    if (!key) return null;
    if (!nodeStats.has(key)) {
      nodeStats.set(key, {
        attempts: 0,
        success: 0,
        firstObservedWasFailure: false,
        attemptsExcludingFirstFail: 0,
        successExcludingFirstFail: 0,
        hadPriorFailure: false,
        attemptsAfterFirstFailure: 0,
        successAfterFirstFailure: 0,
      });
    }
    return nodeStats.get(key);
  }

  for (const height of heights) {
    const rounds = (perHeight.get(height) || []).slice().sort((a, b) => Number(a.round || 0) - Number(b.round || 0));
    if (!rounds.length) continue;
    firstRoundTotal += 1;
    eventualTotal += 1;
    if (rounds[0].success === true) firstRoundSuccess += 1;
    if (rounds.some((row) => row.success === true)) eventualSuccess += 1;

    for (const round of rounds) {
      const triedNodes = Array.isArray(round.triedNodes) ? round.triedNodes.map((v) => String(v || '').trim()).filter(Boolean) : [];
      const winnerNode = round.success === true && round.winner && typeof round.winner === 'object'
        ? String(round.winner.node || '').trim()
        : '';
      const winnerSet = new Set(winnerNode ? [winnerNode] : []);

      for (const node of triedNodes) {
        const stats = ensureNode(node);
        if (!stats) continue;
        const ok = winnerSet.has(node);
        const isFirstObserved = stats.attempts === 0;

        stats.attempts += 1;
        if (ok) stats.success += 1;

        if (!(isFirstObserved && !ok)) {
          stats.attemptsExcludingFirstFail += 1;
          if (ok) stats.successExcludingFirstFail += 1;
        } else {
          stats.firstObservedWasFailure = true;
        }

        if (stats.hadPriorFailure) {
          stats.attemptsAfterFirstFailure += 1;
          if (ok) stats.successAfterFirstFailure += 1;
        }
        if (!ok) stats.hadPriorFailure = true;
      }
    }
  }

  const sortedNodes = Array.from(nodeStats.entries()).sort((a, b) => {
    const av = a[1].attemptsExcludingFirstFail;
    const bv = b[1].attemptsExcludingFirstFail;
    if (bv !== av) return bv - av;
    return a[0].localeCompare(b[0]);
  });

  console.log(`Run ts: ${startRow.ts}`);
  console.log(`Run startHeight: ${startRow.startHeight}`);
  console.log(`Run targetHeight: ${startRow.targetHeight}`);
  console.log(`Run parallelBlocks: ${Number(startRow.parallelBlocks || 0) || 'unknown'}`);
  console.log(`Run syncNodeBudget: ${Number(startRow.syncNodeBudget || 0) || 'unknown'}`);
  console.log(`Run leasesPerBlock: ${Number(startRow.leasesPerBlock || 0) || 'unknown'}`);
  console.log(`Run backupLeasesPerBlock: ${Number(startRow.backupLeasesPerBlock || 0) || 'unknown'}`);
  console.log(`Analyzed heights: ${heights.length}${heights.length ? ` (${heights[0]}-${heights[heights.length - 1]})` : ''}`);
  console.log(`First-round success: ${firstRoundSuccess}/${firstRoundTotal} (${percent(firstRoundSuccess, firstRoundTotal)})`);
  console.log(`Eventual success: ${eventualSuccess}/${eventualTotal} (${percent(eventualSuccess, eventualTotal)})`);
  console.log('');
  console.log('Per-node stats');
  console.log('node | attempts | success% | excl-first-fail success% | after-first-failure success%');
  for (const [node, stats] of sortedNodes) {
    console.log([
      node,
      stats.attempts,
      percent(stats.success, stats.attempts),
      `${stats.successExcludingFirstFail}/${stats.attemptsExcludingFirstFail} (${percent(stats.successExcludingFirstFail, stats.attemptsExcludingFirstFail)})`,
      `${stats.successAfterFirstFailure}/${stats.attemptsAfterFirstFailure} (${percent(stats.successAfterFirstFailure, stats.attemptsAfterFirstFailure)})`,
    ].join(' | '));
  }
}

main();
