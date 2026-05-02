#!/usr/bin/env node
'use strict';

const axios = require('axios');

async function main() {
  const endpoint = String(process.argv[2] || '').trim().replace(/\/+$/, '');
  const kind = String(process.argv[3] || 'order').trim().toLowerCase();
  const limit = Math.max(1, Math.min(300, Number(process.argv[4] || 120) || 120));
  const timeoutMs = Math.max(500, Math.min(15000, Number(process.argv[5] || 5000) || 5000));
  if (!endpoint) {
    throw new Error('Usage: node scripts/debug_fetch_public_anchors.js <endpoint> [kind] [limit] [timeoutMs]');
  }
  const url = `${endpoint}/api/public/anchors/recent?kind=${encodeURIComponent(kind)}&limit=${limit}`;
  const res = await axios.get(url, { timeout: timeoutMs });
  const rows = Array.isArray(res?.data?.rows) ? res.data.rows : [];
  process.stdout.write(JSON.stringify({
    endpoint,
    kind,
    limit,
    timeoutMs,
    count: rows.length,
    rows,
  }, null, 2));
}

main().catch((err) => {
  process.stderr.write(`${String(err?.message || err)}\n`);
  process.exit(1);
});
