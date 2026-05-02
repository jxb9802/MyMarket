#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const BASE = process.cwd();
const TARGETS = [
  "app.js",
  "index.html",
  "demo.css",
];

const EXEMPT_PATTERNS = [
  /<option value="zh">简体中文<\/option>/,
  /data-i18n(?:-[a-z]+)?=/,
  /data-i18n-placeholder=/,
  /data-i18n-alt=/,
  /\btr\([^)]*[\u4e00-\u9fff][^)]*\)/,
  /\btrf\([^)]*[\u4e00-\u9fff][^)]*\)/,
];

function scanFile(relPath) {
  const fullPath = path.join(BASE, relPath);
  const content = fs.readFileSync(fullPath, "utf8");
  const lines = content.split(/\r?\n/);
  const hits = [];
  lines.forEach((line, idx) => {
    if (!/[\u4e00-\u9fff]/.test(line)) return;
    if (EXEMPT_PATTERNS.some((pattern) => pattern.test(line))) return;
    hits.push({ line: idx + 1, text: line.trim() });
  });
  return hits;
}

let failed = false;
for (const relPath of TARGETS) {
  const hits = scanFile(relPath);
  if (!hits.length) continue;
  failed = true;
  process.stdout.write(`\n[hardcoded-text] ${relPath}\n`);
  hits.forEach((hit) => {
    process.stdout.write(`  ${hit.line}: ${hit.text}\n`);
  });
}

if (failed) {
  process.stderr.write("\nHardcoded UI text detected. Move it to locale packs.\n");
  process.exit(1);
}

process.stdout.write("No hardcoded UI text found in audited files.\n");
