#!/usr/bin/env node
'use strict';

const path = require('path');

function usage() {
  console.log(`Usage:
  node scripts/import_bootstrap_index_release.js --manifest dist/bootstrap_index_release_full/manifest.json
  node scripts/import_bootstrap_index_release.js --index dist/bootstrap_index_release_full/bmmkt2-index-full-mainnet-947110-948088.json.gz

Options:
  --data-dir DIR   Use an isolated data directory before loading the app modules.
  --dry-run        Verify the release without writing anchor/order/catalog projections.
`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    args[arg.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  if (args['data-dir']) {
    process.env.BSV_MARKET_DATA_DIR = path.resolve(args['data-dir']);
  }
  process.env.BSV_MARKET_HEADLESS_RUNTIME = process.env.BSV_MARKET_HEADLESS_RUNTIME || '1';
  process.env.BSV_MARKET_DISABLE_STARTUP_CHAIN_SYNC = process.env.BSV_MARKET_DISABLE_STARTUP_CHAIN_SYNC || '1';

  const server = require('../server_market');
  const marketDb = require('../market_db');
  await marketDb.ensureWriterService();
  try {
    const result = await server.importBootstrapIndexRelease({
      manifestPath: args.manifest,
      indexPath: args.index,
      dryRun: args.dryRun === true,
    });
    const anchors = marketDb.listAnchorEventsFromReadDb({ limit: 100000 });
    const categories = marketDb.listCategoriesFromReadDb();
    const products = marketDb.listProductsFromReadDb();
    const orders = await marketDb.listOrderProjection();
    console.log(JSON.stringify({
      ok: true,
      result,
      recovered: {
        anchorEvents: anchors.length,
        categories: categories.length,
        products: products.length,
        orders: Array.isArray(orders) ? orders.length : 0,
      },
    }, null, 2));
  } finally {
    await marketDb.stopWriterService().catch(() => {});
  }
}

main().catch(async (err) => {
  try {
    const marketDb = require('../market_db');
    await marketDb.stopWriterService().catch(() => {});
  } catch (_) {}
  console.error(JSON.stringify({
    ok: false,
    error: String(err?.message || err || 'bootstrap index import failed'),
    failures: Array.isArray(err?.failures) ? err.failures : undefined,
  }, null, 2));
  process.exitCode = 1;
});
