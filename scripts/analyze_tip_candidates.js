#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    logFile: '',
    correct: null,
    tail: 600,
    clusterWindow: 2,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const val = argv[i + 1];
    if ((key === '--log' || key === '--log-file') && val) args.logFile = path.resolve(val);
    if (key === '--correct' && val) args.correct = Number(val);
    if (key === '--tail' && val) args.tail = Math.max(50, Number(val));
    if (key === '--cluster-window' && val) args.clusterWindow = Math.max(0, Number(val));
  }
  if (!args.logFile) {
    throw new Error('Missing --log <file>');
  }
  return args;
}

function readRecentEvents(file, tail) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  return lines.slice(-tail).map((line) => {
    try {
      return JSON.parse(line);
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

function clusterHeights(values, windowSize) {
  const nums = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const clusters = [];
  for (const height of nums) {
    const last = clusters[clusters.length - 1];
    if (!last || Math.abs(height - last.max) > windowSize) {
      clusters.push({ min: height, max: height, values: [height] });
      continue;
    }
    last.max = Math.max(last.max, height);
    last.values.push(height);
  }
  return clusters.map((c) => ({
    range: c.min === c.max ? String(c.min) : `${c.min}-${c.max}`,
    count: c.values.length,
    representative: c.values[Math.floor(c.values.length / 2)],
    values: c.values,
  })).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.representative - a.representative;
  });
}

function countByValue(values) {
  const counts = new Map();
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([height, count]) => ({ height, count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.height - a.height;
    });
}

function median(values) {
  const nums = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  return nums[Math.floor(nums.length / 2)];
}

function lowerMedian(values) {
  const nums = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  return nums[Math.floor((nums.length - 1) / 2)];
}

function trimmedTopByCount(values, trimGap) {
  const nums = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const max = nums[nums.length - 1];
  const kept = nums.filter((v) => max - v <= trimGap);
  if (!kept.length) return null;
  const ranked = countByValue(kept);
  return ranked[0]?.height ?? null;
}

function smallestClusterOver(values, windowSize, minCount) {
  const clusters = clusterHeights(values, windowSize)
    .filter((c) => c.count >= minCount)
    .sort((a, b) => a.representative - b.representative);
  return clusters[0]?.representative ?? null;
}

function summarize(events, clusterWindow) {
  const latestReported = new Map();
  const latestHeaderBatch = new Map();
  for (const obj of events) {
    const ev = obj.event;
    if (ev === 'p2p_tip_probe' || ev === 'p2p_tip_probe_failed') {
      for (const node of obj.nodes || []) {
        if (node && node.ok && Number.isFinite(node.startHeight)) {
          latestReported.set(node.node, Number(node.startHeight));
        }
      }
    }
    if (ev === 'p2p_headers_batch') {
      const node = obj.node;
      const fromHeight = Number(obj.fromHeight);
      const count = Number(obj.count);
      if (node && Number.isFinite(fromHeight) && Number.isFinite(count) && count > 0) {
        latestHeaderBatch.set(node, fromHeight + count);
      }
    }
  }

  const reportedEntries = Array.from(latestReported.entries())
    .sort((a, b) => b[1] - a[1]);
  const headerEntries = Array.from(latestHeaderBatch.entries())
    .sort((a, b) => b[1] - a[1]);
  const reportedHeights = reportedEntries.map(([, h]) => h);
  const headerHeights = headerEntries.map(([, h]) => h);
  const reportedCounts = countByValue(reportedHeights);
  const headerCounts = countByValue(headerHeights);

  return {
    reportedTipByNode: Object.fromEntries(reportedEntries),
    headerBatchTipByNode: Object.fromEntries(headerEntries),
    reportedClusters: clusterHeights(reportedHeights, clusterWindow),
    headerClusters: clusterHeights(headerHeights, clusterWindow),
    heuristics: {
      reportedMajority: reportedCounts[0]?.height ?? null,
      reportedMedian: median(reportedHeights),
      reportedLowerMedian: lowerMedian(reportedHeights),
      reportedTrimTop4: trimmedTopByCount(reportedHeights, 4),
      reportedTrimTop8: trimmedTopByCount(reportedHeights, 8),
      reportedSmallestCluster2: smallestClusterOver(reportedHeights, clusterWindow, 2),
      reportedSmallestCluster3: smallestClusterOver(reportedHeights, clusterWindow, 3),
      headerMajority: headerCounts[0]?.height ?? null,
      headerMedian: median(headerHeights),
      headerSmallestCluster2: smallestClusterOver(headerHeights, clusterWindow, 2),
    },
  };
}

function attachDelta(value, correct) {
  if (!Number.isFinite(correct) || !Number.isFinite(value)) return { value, delta: null };
  return { value, delta: value - correct };
}

function main() {
  const args = parseArgs(process.argv);
  const events = readRecentEvents(args.logFile, args.tail);
  const summary = summarize(events, args.clusterWindow);
  const bestReported = summary.reportedClusters[0]?.representative ?? null;
  const bestHeader = summary.headerClusters[0]?.representative ?? null;
  const out = {
    logFile: args.logFile,
    tail: args.tail,
    correctHeight: args.correct,
    candidates: {
      bestReportedCluster: summary.reportedClusters[0] || null,
      bestHeaderCluster: summary.headerClusters[0] || null,
      bestReported: attachDelta(bestReported, args.correct),
      bestHeaderBatch: attachDelta(bestHeader, args.correct),
      heuristics: Object.fromEntries(
        Object.entries(summary.heuristics).map(([key, value]) => [key, attachDelta(value, args.correct)]),
      ),
    },
    reportedClusters: summary.reportedClusters,
    headerClusters: summary.headerClusters,
    reportedTipByNode: summary.reportedTipByNode,
    headerBatchTipByNode: summary.headerBatchTipByNode,
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
}

main();
