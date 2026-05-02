#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const out = {
    dataDir: path.resolve(process.env.BSV_MARKET_DATA_DIR || path.join(__dirname, '..', 'data')),
    iterations: 3,
    profileCount: 1,
    categoryCount: 50,
    productCount: 500,
    bindCount: 20,
    threadCount: 20,
    messageCount: 500,
    txContextCount: 500,
    benchmarkDb: null,
    logFile: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = String(argv[i] || '');
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !String(next).startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = '1';
    }
  }
  out.iterations = Math.max(1, Number(out.iterations || 3));
  out.profileCount = Math.max(1, Number(out.profileCount || 1));
  out.categoryCount = Math.max(1, Number(out.categoryCount || 50));
  out.productCount = Math.max(1, Number(out.productCount || 500));
  out.bindCount = Math.max(1, Number(out.bindCount || 20));
  out.threadCount = Math.max(1, Number(out.threadCount || 20));
  out.messageCount = Math.max(1, Number(out.messageCount || 500));
  out.txContextCount = Math.max(1, Number(out.txContextCount || 500));
  out.benchmarkDb = path.resolve(String(out.benchmarkDb || path.join(out.dataDir, 'market_bench.db')));
  out.logFile = path.resolve(String(out.logFile || path.join(out.dataDir, 'sqlite_benchmark.log')));
  return out;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createDb(dbFile) {
  ensureDir(path.dirname(dbFile));
  try { fs.unlinkSync(dbFile); } catch (_) {}
  try { fs.unlinkSync(`${dbFile}-wal`); } catch (_) {}
  try { fs.unlinkSync(`${dbFile}-shm`); } catch (_) {}
  const db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS profiles (
      profile_key TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL DEFAULT '',
      wallet_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      last_event_id INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      category_id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      owned_by_current_wallet INTEGER NOT NULL DEFAULT 0,
      local_status TEXT NOT NULL DEFAULT 'synced',
      updated_at TEXT NOT NULL,
      last_event_id INTEGER NOT NULL,
      last_txid TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS products (
      product_id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      category_id TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      sold_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      owned_by_current_wallet INTEGER NOT NULL DEFAULT 0,
      local_status TEXT NOT NULL DEFAULT 'synced',
      updated_at TEXT NOT NULL,
      last_event_id INTEGER NOT NULL,
      last_txid TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS wallet_key_binds (
      wallet_id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL DEFAULT '',
      chat_pub_key TEXT NOT NULL DEFAULT '',
      endpoint_hints_json TEXT NOT NULL DEFAULT '[]',
      relay_hints_json TEXT NOT NULL DEFAULT '[]',
      signature_ok INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      last_event_id INTEGER NOT NULL,
      last_txid TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS chat_threads (
      thread_id TEXT PRIMARY KEY,
      self_wallet_id TEXT NOT NULL,
      peer_wallet_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      last_message_at TEXT NOT NULL DEFAULT '',
      last_message_id TEXT NOT NULL DEFAULT '',
      unread_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      msg_id TEXT PRIMARY KEY,
      txid TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL,
      from_wallet_id TEXT NOT NULL DEFAULT '',
      to_wallet_id TEXT NOT NULL DEFAULT '',
      direction TEXT NOT NULL DEFAULT '',
      transport TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      ciphertext TEXT NOT NULL DEFAULT '',
      nonce TEXT NOT NULL DEFAULT '',
      auth_tag TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0,
      fee_sat INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tx_contexts (
      txid TEXT PRIMARY KEY,
      rawtx_hex TEXT NOT NULL DEFAULT '',
      input_txids_json TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT '',
      confirmed INTEGER NOT NULL DEFAULT 0,
      proof_type TEXT NOT NULL DEFAULT '',
      proof_source TEXT NOT NULL DEFAULT '',
      proof_hex TEXT NOT NULL DEFAULT '',
      proof_encoding TEXT NOT NULL DEFAULT '',
      proof_verified INTEGER NOT NULL DEFAULT 0,
      proof_verified_at TEXT,
      proof_block_height INTEGER,
      proof_block_hash TEXT NOT NULL DEFAULT '',
      proof_merkle_root TEXT NOT NULL DEFAULT '',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function withTransaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

function makeRows(count, factory) {
  return Array.from({ length: count }, (_, idx) => factory(idx));
}

function replaceProfileSnapshot(db, count) {
  const rows = makeRows(count, (idx) => ({
    profileKey: idx === 0 ? 'self' : `profile-${idx}`,
    merchantId: `m-${idx}`,
    walletId: `w-${idx}`,
    name: `Profile ${idx}`,
    payloadJson: JSON.stringify({ localStatus: 'synced', localUpdatedAt: nowIso() }),
    updatedAt: nowIso(),
  }));
  return withTransaction(db, () => {
    const stmt = db.prepare(`
      INSERT INTO profiles(profile_key, merchant_id, wallet_id, name, payload_json, updated_at, last_event_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_key) DO UPDATE SET
        merchant_id = excluded.merchant_id,
        wallet_id = excluded.wallet_id,
        name = excluded.name,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `);
    rows.forEach((row) => {
      stmt.run(row.profileKey, row.merchantId, row.walletId, row.name, row.payloadJson, row.updatedAt, 0);
    });
    return rows.length;
  });
}

function replaceCatalogSnapshot(db, categoryCount, productCount) {
  const categories = makeRows(categoryCount, (idx) => ({
    id: `cat-${idx}`,
    merchantId: 'm-bench',
    name: `Category ${idx}`,
    updatedAt: nowIso(),
  }));
  const products = makeRows(productCount, (idx) => ({
    id: `prod-${idx}`,
    merchantId: 'm-bench',
    categoryId: `cat-${idx % Math.max(1, categoryCount)}`,
    title: `Product ${idx}`,
    description: `Description ${idx}`,
    imageUrl: '',
    price: idx,
    stock: 100 + idx,
    soldCount: idx % 17,
    updatedAt: nowIso(),
  }));
  return withTransaction(db, () => {
    db.exec('DELETE FROM categories');
    db.exec('DELETE FROM products');
    const insertCategory = db.prepare(`
      INSERT INTO categories(category_id, merchant_id, name, status, owned_by_current_wallet, local_status, updated_at, last_event_id, last_txid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertProduct = db.prepare(`
      INSERT INTO products(product_id, merchant_id, category_id, title, description, image_url, price, stock, sold_count, status, owned_by_current_wallet, local_status, updated_at, last_event_id, last_txid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    categories.forEach((row) => {
      insertCategory.run(row.id, row.merchantId, row.name, 'active', 1, 'synced', row.updatedAt, 0, '');
    });
    products.forEach((row) => {
      insertProduct.run(row.id, row.merchantId, row.categoryId, row.title, row.description, row.imageUrl, row.price, row.stock, row.soldCount, 'active', 1, 'synced', row.updatedAt, 0, '');
    });
    return { categories: categories.length, products: products.length };
  });
}

function replaceWalletKeyBindSnapshot(db, bindCount) {
  const rows = makeRows(bindCount, (idx) => ({
    walletId: `wallet-${idx}`,
    merchantId: `m-${idx}`,
    chatPubKey: `chat-pub-${idx}`,
    updatedAt: nowIso(),
  }));
  return withTransaction(db, () => {
    db.exec('DELETE FROM wallet_key_binds');
    const insert = db.prepare(`
      INSERT INTO wallet_key_binds(wallet_id, merchant_id, chat_pub_key, endpoint_hints_json, relay_hints_json, signature_ok, updated_at, last_event_id, last_txid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    rows.forEach((row) => {
      insert.run(row.walletId, row.merchantId, row.chatPubKey, '[]', '[]', 1, row.updatedAt, 0, '');
    });
    return rows.length;
  });
}

function replaceChatThreadSnapshot(db, threadCount) {
  const rows = makeRows(threadCount, (idx) => ({
    threadId: `thread-${idx}`,
    selfWalletId: 'self-wallet',
    peerWalletId: `peer-${idx}`,
    displayName: `Peer ${idx}`,
    lastMessageAt: nowIso(),
    lastMessageId: `msg-${idx}`,
    unreadCount: idx % 3,
    updatedAt: nowIso(),
  }));
  return withTransaction(db, () => {
    db.exec('DELETE FROM chat_threads');
    const insert = db.prepare(`
      INSERT INTO chat_threads(thread_id, self_wallet_id, peer_wallet_id, merchant_id, display_name, last_message_at, last_message_id, unread_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    rows.forEach((row) => {
      insert.run(row.threadId, row.selfWalletId, row.peerWalletId, '', row.displayName, row.lastMessageAt, row.lastMessageId, row.unreadCount, row.updatedAt);
    });
    return rows.length;
  });
}

function replaceChatMessageSnapshot(db, messageCount, threadCount) {
  const rows = makeRows(messageCount, (idx) => ({
    msgId: `msg-${idx}`,
    txid: `tx-${idx}`,
    threadId: `thread-${idx % Math.max(1, threadCount)}`,
    fromWalletId: idx % 2 === 0 ? 'self-wallet' : `peer-${idx % Math.max(1, threadCount)}`,
    toWalletId: idx % 2 === 0 ? `peer-${idx % Math.max(1, threadCount)}` : 'self-wallet',
    direction: idx % 2 === 0 ? 'out' : 'in',
    text: `Message ${idx}`,
    ts: new Date(Date.now() - idx * 1000).toISOString(),
    updatedAt: nowIso(),
  }));
  return withTransaction(db, () => {
    db.exec('DELETE FROM chat_messages');
    const insert = db.prepare(`
      INSERT INTO chat_messages(msg_id, txid, thread_id, from_wallet_id, to_wallet_id, direction, transport, text, ciphertext, nonce, auth_tag, status, ts, confirmed, fee_sat, payload_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    rows.forEach((row) => {
      insert.run(row.msgId, row.txid, row.threadId, row.fromWalletId, row.toWalletId, row.direction, 'onchain', row.text, '', '', '', 'visible', row.ts, 1, 0, JSON.stringify(row), row.updatedAt);
    });
    return rows.length;
  });
}

function upsertTxContexts(db, count) {
  const now = nowIso();
  const upsert = db.prepare(`
    INSERT INTO tx_contexts(txid, rawtx_hex, input_txids_json, source, kind, confirmed, proof_type, proof_source, proof_hex, proof_encoding, proof_verified, proof_verified_at, proof_block_height, proof_block_hash, proof_merkle_root, first_seen_at, last_seen_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(txid) DO UPDATE SET
      rawtx_hex = excluded.rawtx_hex,
      input_txids_json = excluded.input_txids_json,
      source = excluded.source,
      kind = excluded.kind,
      confirmed = excluded.confirmed,
      proof_type = excluded.proof_type,
      proof_source = excluded.proof_source,
      proof_hex = excluded.proof_hex,
      proof_encoding = excluded.proof_encoding,
      proof_verified = excluded.proof_verified,
      proof_verified_at = excluded.proof_verified_at,
      proof_block_height = excluded.proof_block_height,
      proof_block_hash = excluded.proof_block_hash,
      proof_merkle_root = excluded.proof_merkle_root,
      last_seen_at = excluded.last_seen_at,
      updated_at = excluded.updated_at
  `);
  return withTransaction(db, () => {
    for (let i = 0; i < count; i += 1) {
      const txid = `${String(i).padStart(64, '0')}`.slice(-64);
      upsert.run(
        txid,
        '00'.repeat(200),
        JSON.stringify([`${String(i + 1).padStart(64, '0')}`.slice(-64)]),
        'bench',
        'wallet_send',
        0,
        '',
        '',
        '',
        '',
        0,
        null,
        null,
        '',
        '',
        now,
        now,
        now,
      );
    }
    return count;
  });
}

function measure(label, fn) {
  const started = process.hrtime.bigint();
  const result = fn();
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    label,
    elapsedMs: Number(elapsedMs.toFixed(3)),
    result,
  };
}

function appendLog(logFile, payload) {
  ensureDir(path.dirname(logFile));
  fs.appendFileSync(logFile, `${JSON.stringify(payload)}\n`);
}

function main() {
  const options = parseArgs(process.argv);
  const db = createDb(options.benchmarkDb);
  const summary = {
    ts: nowIso(),
    host: process.platform,
    dataDir: options.dataDir,
    benchmarkDb: options.benchmarkDb,
    liveDbExists: fs.existsSync(path.join(options.dataDir, 'market.db')),
    liveDbSizeBytes: fs.existsSync(path.join(options.dataDir, 'market.db')) ? fs.statSync(path.join(options.dataDir, 'market.db')).size : 0,
    iterations: options.iterations,
    operations: [],
  };
  for (let i = 0; i < options.iterations; i += 1) {
    summary.operations.push(measure(`replace_profile_snapshot#${i + 1}`, () => replaceProfileSnapshot(db, options.profileCount)));
    summary.operations.push(measure(`replace_catalog_snapshot#${i + 1}`, () => replaceCatalogSnapshot(db, options.categoryCount, options.productCount)));
    summary.operations.push(measure(`replace_wallet_key_bind_snapshot#${i + 1}`, () => replaceWalletKeyBindSnapshot(db, options.bindCount)));
    summary.operations.push(measure(`replace_chat_thread_snapshot#${i + 1}`, () => replaceChatThreadSnapshot(db, options.threadCount)));
    summary.operations.push(measure(`replace_chat_message_snapshot#${i + 1}`, () => replaceChatMessageSnapshot(db, options.messageCount, options.threadCount)));
    summary.operations.push(measure(`upsert_tx_context_batch#${i + 1}`, () => upsertTxContexts(db, options.txContextCount)));
  }
  const walFile = `${options.benchmarkDb}-wal`;
  const shmFile = `${options.benchmarkDb}-shm`;
  summary.outputSizes = {
    benchmarkDbBytes: fs.existsSync(options.benchmarkDb) ? fs.statSync(options.benchmarkDb).size : 0,
    walBytes: fs.existsSync(walFile) ? fs.statSync(walFile).size : 0,
    shmBytes: fs.existsSync(shmFile) ? fs.statSync(shmFile).size : 0,
  };
  appendLog(options.logFile, summary);
  console.log(JSON.stringify(summary, null, 2));
}

main();
