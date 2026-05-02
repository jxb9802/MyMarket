const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.resolve(process.env.BSV_MARKET_DATA_DIR || path.join(__dirname, 'data'));
const DB_DIR = path.resolve(process.env.BSV_MARKET_DB_DIR || DATA_DIR);
const LOG_DIR = path.resolve(process.env.BSV_MARKET_LOG_DIR || path.join(__dirname, 'log'));
const DB_FILE = path.join(DB_DIR, 'market.db');
const RAWTX_DIR = path.join(DB_DIR, 'rawtx');
const RAWTX_PENDING_DIR = path.join(RAWTX_DIR, 'pending');
const DEFAULT_PENDING_MAX_AGE_MS = Math.max(
  60_000,
  Number(process.env.BSV_MARKET_RAWTX_PENDING_MAX_AGE_MS || (6 * 60 * 60 * 1000)),
);
const DB_TRACE_SLOW_MS = Math.max(50, Number(process.env.BSV_MARKET_DB_TRACE_SLOW_MS || 250));
const TRACE_LOG_FILE = path.join(LOG_DIR, 'market_db_trace.log');
const DB_INIT_RETRY_MS = Math.max(100, Number(process.env.BSV_MARKET_DB_INIT_RETRY_MS || 500));
const DB_INIT_MAX_WAIT_MS = Math.max(1000, Number(process.env.BSV_MARKET_DB_INIT_MAX_WAIT_MS || 15000));

let db = null;
let shuttingDown = false;

function fsyncDirectoryIfPossible(dir) {
  if (!dir) return;
  let fd = null;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch (_) {
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch (_) {}
    }
  }
}

function atomicWriteTextFile(file, serialized) {
  ensureDir(path.dirname(file));
  const tempFile = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tempFile, serialized, 'utf8');
  try {
    const fd = fs.openSync(tempFile, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {}
  fs.renameSync(tempFile, file);
  fsyncDirectoryIfPossible(path.dirname(file));
}

function estimatePayloadBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch (_) {
    return -1;
  }
}

const TRACE_SKIP_PAYLOAD_BYTES_ACTIONS = new Set([
  'upsert_sync_state',
  'apply_sync_projection_batch',
  'write_sync_node_stats_snapshot',
  'write_p2p_sync_receipts_snapshot',
]);

function summarizeRequestPayload(action, payload = {}) {
  const safeAction = String(action || '').trim();
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const summary = {
    payloadBytes: TRACE_SKIP_PAYLOAD_BYTES_ACTIONS.has(safeAction)
      ? -1
      : estimatePayloadBytes(safePayload),
  };
  switch (safeAction) {
    case 'append_events': {
      const events = Array.isArray(safePayload.events) ? safePayload.events : [];
      summary.eventCount = events.length;
      summary.eventTypes = Array.from(new Set(events.map((row) => String(row?.eventType || '').trim()).filter(Boolean))).slice(0, 8);
      summary.maxEventPayloadBytes = events.reduce((max, row) => {
        const bytes = estimatePayloadBytes(row?.payload && typeof row.payload === 'object' ? row.payload : {});
        return Math.max(max, bytes);
      }, 0);
      break;
    }
    case 'list_events_after':
      summary.afterSeq = Math.max(0, Number(safePayload.afterSeq || 0));
      summary.limit = Math.max(0, Number(safePayload.limit || 0));
      break;
    case 'get_event_consumer':
    case 'set_event_consumer':
      summary.consumerName = String(safePayload.consumerName || '').trim();
      if (String(action || '').trim() === 'set_event_consumer') {
        summary.lastSeq = Math.max(0, Number(safePayload.lastSeq || 0));
      }
      break;
    case 'apply_sync_projection_batch': {
      const syncState = safePayload.syncState && typeof safePayload.syncState === 'object' ? safePayload.syncState : null;
      summary.hasSyncState = Boolean(syncState);
      summary.syncStateBytes = -1;
      summary.commandCount = Array.isArray(safePayload.commands) ? safePayload.commands.length : 0;
      summary.chainSourceCount = Array.isArray(syncState?.chainSources) ? syncState.chainSources.length : 0;
      summary.sourceStatsKeys = syncState?.sourceStats && typeof syncState.sourceStats === 'object'
        ? Object.keys(syncState.sourceStats).length
        : 0;
      summary.p2pHeightHashCacheKeys = syncState?.p2pHeightHashCache && typeof syncState.p2pHeightHashCache === 'object'
        ? Object.keys(syncState.p2pHeightHashCache).length
        : 0;
      summary.p2pNodeStatsKeys = syncState?.p2pNodeStats && typeof syncState.p2pNodeStats === 'object'
        ? Object.keys(syncState.p2pNodeStats).length
        : 0;
      break;
    }
    case 'upsert_sync_state':
      summary.scope = String(safePayload.scope || 'main').trim() || 'main';
      summary.localHeight = Math.max(0, Number(safePayload.localHeight || 0));
      summary.fixedSyncLastHeight = Math.max(0, Number(safePayload.fixedSyncLastHeight || 0));
      summary.chainSourceCount = Array.isArray(safePayload.chainSources) ? safePayload.chainSources.length : 0;
      summary.sourceStatsKeys = safePayload.sourceStats && typeof safePayload.sourceStats === 'object'
        ? Object.keys(safePayload.sourceStats).length
        : 0;
      summary.p2pHeightHashCacheKeys = safePayload.p2pHeightHashCache && typeof safePayload.p2pHeightHashCache === 'object'
        ? Object.keys(safePayload.p2pHeightHashCache).length
        : 0;
      summary.p2pNodeStatsKeys = safePayload.p2pNodeStats && typeof safePayload.p2pNodeStats === 'object'
        ? Object.keys(safePayload.p2pNodeStats).length
        : 0;
      break;
    case 'write_sync_node_stats_snapshot':
    case 'write_p2p_sync_receipts_snapshot':
      summary.file = String(safePayload.file || '').trim();
      summary.serializedBytes = Buffer.byteLength(String(safePayload.serialized || ''), 'utf8');
      if (safeAction === 'write_p2p_sync_receipts_snapshot') {
        try {
          const parsed = JSON.parse(String(safePayload.serialized || '{}'));
          summary.committedHeight = Math.max(0, Number(parsed?.committedHeight || 0));
          summary.entryCount = parsed?.entries && typeof parsed.entries === 'object'
            ? Object.keys(parsed.entries).length
            : 0;
        } catch (_) {}
      }
      break;
    default:
      break;
  }
  return summary;
}

function summarizeResult(action, data) {
  const summary = {};
  switch (String(action || '').trim()) {
    case 'append_events':
      summary.writtenCount = Math.max(0, Number(data?.count || 0));
      break;
    case 'list_events_after':
      summary.returnedCount = Array.isArray(data) ? data.length : 0;
      summary.returnedSeqMax = Array.isArray(data) && data.length > 0
        ? Math.max(...data.map((row) => Math.max(0, Number(row?.seq || 0))))
        : 0;
      summary.returnedBytes = -1;
      break;
    default:
      break;
  }
  return summary;
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function serializeError(error) {
  if (!error) return { message: 'Unknown writer error', code: 'WRITER_ERROR' };
  return {
    message: String(error.message || error || 'Writer error'),
    code: String(error.code || 'WRITER_ERROR'),
    stack: String(error.stack || ''),
  };
}

function appendDbTrace(event, payload = {}) {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      source: 'market_db_writer',
      pid: process.pid,
      event,
      ...payload,
    });
    fs.appendFileSync(TRACE_LOG_FILE, `${line}\n`);
  } catch (_) {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSqliteLockError(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return code === 'ERR_SQLITE_ERROR' && /database is locked/i.test(message);
}

function initializeDatabase() {
  ensureDir(DATA_DIR);
  ensureDir(DB_DIR);
  ensureDir(LOG_DIR);
  ensureDir(RAWTX_PENDING_DIR);
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      scope TEXT PRIMARY KEY,
      bootstrap_height INTEGER NOT NULL,
      local_height INTEGER NOT NULL,
      fixed_sync_last_height INTEGER NOT NULL,
      p2p_tip_height INTEGER NOT NULL,
      p2p_tip_hash TEXT NOT NULL DEFAULT '',
      p2p_header_cursor_height INTEGER NOT NULL,
      p2p_header_cursor_hash TEXT NOT NULL DEFAULT '',
      online INTEGER NOT NULL DEFAULT 0,
      mode TEXT NOT NULL DEFAULT '',
      lag INTEGER NOT NULL DEFAULT 0,
      session_epoch INTEGER NOT NULL DEFAULT 0,
      scanned_from INTEGER NOT NULL DEFAULT 0,
      initial_sync_completed INTEGER NOT NULL DEFAULT 0,
      manual_quickstart_pending INTEGER NOT NULL DEFAULT 0,
      retries INTEGER NOT NULL DEFAULT 0,
      last_p2p_forward_probe_at TEXT NOT NULL DEFAULT '',
      last_p2p_advance_at TEXT NOT NULL DEFAULT '',
      last_p2p_good_nodes INTEGER NOT NULL DEFAULT 0,
      empty_backfill_tried INTEGER NOT NULL DEFAULT 0,
      chain_sources_json TEXT NOT NULL DEFAULT '[]',
      source_stats_json TEXT NOT NULL DEFAULT '{}',
      p2p_height_hash_cache_json TEXT NOT NULL DEFAULT '{}',
      p2p_gap_heights_json TEXT NOT NULL DEFAULT '[]',
      p2p_node_stats_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blocks (
      height INTEGER NOT NULL,
      block_hash TEXT NOT NULL,
      prev_hash TEXT NOT NULL DEFAULT '',
      tx_count INTEGER NOT NULL DEFAULT 0,
      source_node TEXT NOT NULL DEFAULT '',
      seen_at TEXT NOT NULL,
      PRIMARY KEY (height, block_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(block_hash);

    CREATE TABLE IF NOT EXISTS tx_store (
      txid TEXT PRIMARY KEY,
      block_height INTEGER,
      block_hash TEXT NOT NULL DEFAULT '',
      tx_index INTEGER NOT NULL DEFAULT 0,
      rawtx_path TEXT NOT NULL DEFAULT '',
      stored_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_store_height ON tx_store(block_height);

    CREATE TABLE IF NOT EXISTS anchor_events (
      event_id INTEGER PRIMARY KEY AUTOINCREMENT,
      txid TEXT NOT NULL,
      block_height INTEGER NOT NULL DEFAULT 0,
      block_hash TEXT NOT NULL DEFAULT '',
      event_index INTEGER NOT NULL DEFAULT 0,
      event_type TEXT NOT NULL,
      merchant_id TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      wallet_id TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 1,
      source_node TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      dedupe_key TEXT NOT NULL,
      inserted_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_anchor_events_dedupe ON anchor_events(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_anchor_events_type_height ON anchor_events(event_type, block_height);
    CREATE INDEX IF NOT EXISTS idx_anchor_events_merchant_type ON anchor_events(merchant_id, event_type);
    CREATE INDEX IF NOT EXISTS idx_anchor_events_wallet_type ON anchor_events(wallet_id, event_type);
    CREATE INDEX IF NOT EXISTS idx_anchor_events_txid ON anchor_events(txid);

    CREATE TABLE IF NOT EXISTS categories (
      category_id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      owned_by_current_wallet INTEGER NOT NULL DEFAULT 0,
      local_status TEXT NOT NULL DEFAULT 'synced',
      updated_at TEXT NOT NULL,
      last_event_id INTEGER NOT NULL,
      last_txid TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_categories_merchant ON categories(merchant_id);

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
      version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      owned_by_current_wallet INTEGER NOT NULL DEFAULT 0,
      local_status TEXT NOT NULL DEFAULT 'synced',
      updated_at TEXT NOT NULL,
      last_event_id INTEGER NOT NULL,
      last_txid TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_products_merchant ON products(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

    CREATE TABLE IF NOT EXISTS profiles (
      profile_key TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL DEFAULT '',
      wallet_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      last_event_id INTEGER NOT NULL
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
    CREATE INDEX IF NOT EXISTS idx_wallet_key_binds_merchant ON wallet_key_binds(merchant_id);
    CREATE INDEX IF NOT EXISTS idx_wallet_key_binds_chat_pub_key ON wallet_key_binds(chat_pub_key);

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
    CREATE INDEX IF NOT EXISTS idx_chat_threads_self ON chat_threads(self_wallet_id);
    CREATE INDEX IF NOT EXISTS idx_chat_threads_peer ON chat_threads(peer_wallet_id);

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
    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_ts ON chat_messages(thread_id, ts);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_txid ON chat_messages(txid);

    CREATE TABLE IF NOT EXISTS event_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      producer TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      schema_version INTEGER NOT NULL DEFAULT 1,
      causation_id TEXT NOT NULL DEFAULT '',
      correlation_id TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_event_log_type_seq ON event_log(event_type, seq);
    CREATE INDEX IF NOT EXISTS idx_event_log_entity_seq ON event_log(entity_type, entity_id, seq);
    CREATE INDEX IF NOT EXISTS idx_event_log_dedupe_key ON event_log(dedupe_key);

    CREATE TABLE IF NOT EXISTS event_consumers (
      consumer_name TEXT PRIMARY KEY,
      last_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS durable_queue_messages (
      queue_name TEXT NOT NULL,
      message_id TEXT PRIMARY KEY,
      topic TEXT NOT NULL DEFAULT '',
      dedupe_key TEXT NOT NULL DEFAULT '',
      priority INTEGER NOT NULL DEFAULT 100,
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT 'null',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      worker_id TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_durable_queue_messages_queue_status_priority
      ON durable_queue_messages(queue_name, status, priority, created_at, message_id);
    CREATE INDEX IF NOT EXISTS idx_durable_queue_messages_queue_created
      ON durable_queue_messages(queue_name, created_at, message_id);
    CREATE INDEX IF NOT EXISTS idx_durable_queue_messages_queue_dedupe
      ON durable_queue_messages(queue_name, dedupe_key);

    CREATE TABLE IF NOT EXISTS chat_presence_projection (
      self_wallet_id TEXT NOT NULL,
      peer_wallet_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'offline',
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      last_event_type TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL DEFAULT '',
      last_handshake_at TEXT NOT NULL DEFAULT '',
      last_failure_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY (self_wallet_id, peer_wallet_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_presence_projection_self_status
      ON chat_presence_projection(self_wallet_id, status, updated_at);

    CREATE TABLE IF NOT EXISTS chat_thread_status_projection (
      self_wallet_id TEXT NOT NULL,
      peer_wallet_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_id TEXT NOT NULL DEFAULT '',
      last_message_at TEXT NOT NULL DEFAULT '',
      last_message_preview TEXT NOT NULL DEFAULT '',
      last_transport TEXT NOT NULL DEFAULT '',
      last_read_at TEXT NOT NULL DEFAULT '',
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (self_wallet_id, peer_wallet_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_thread_status_projection_self_order
      ON chat_thread_status_projection(self_wallet_id, last_message_at DESC, peer_wallet_id ASC);

    CREATE TABLE IF NOT EXISTS chat_message_index_projection (
      self_wallet_id TEXT NOT NULL,
      peer_wallet_id TEXT NOT NULL,
      msg_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      direction TEXT NOT NULL DEFAULT '',
      transport TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL DEFAULT '',
      order_id TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '',
      txid TEXT NOT NULL DEFAULT '',
      source_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (self_wallet_id, peer_wallet_id, msg_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_message_index_projection_thread_ts
      ON chat_message_index_projection(self_wallet_id, peer_wallet_id, ts, msg_id);

    CREATE TABLE IF NOT EXISTS chat_contact_projection (
      self_wallet_id TEXT NOT NULL,
      peer_wallet_id TEXT NOT NULL,
      is_friend INTEGER NOT NULL DEFAULT 0,
      friend_status TEXT NOT NULL DEFAULT 'none',
      blocked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (self_wallet_id, peer_wallet_id)
    );
    CREATE INDEX IF NOT EXISTS idx_chat_contact_projection_self_friend
      ON chat_contact_projection(self_wallet_id, is_friend, blocked, updated_at, peer_wallet_id);

    CREATE TABLE IF NOT EXISTS chat_self_state_projection (
      self_wallet_id TEXT PRIMARY KEY,
      online INTEGER NOT NULL DEFAULT 1,
      storage_limit_bytes INTEGER NOT NULL DEFAULT 104857600,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_job_state_projection (
      scope TEXT PRIMARY KEY,
      current_job_json TEXT NOT NULL DEFAULT '{}',
      recent_jobs_json TEXT NOT NULL DEFAULT '[]',
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_command_projection (
      command_id TEXT PRIMARY KEY,
      command_type TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT 'null',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT '',
      claimed_at TEXT NOT NULL DEFAULT '',
      finished_at TEXT NOT NULL DEFAULT '',
      worker_id TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      source_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_command_projection_status_created
      ON sync_command_projection(status, created_at, command_id);
    CREATE INDEX IF NOT EXISTS idx_sync_command_projection_type_status
      ON sync_command_projection(command_type, status, command_id);

    CREATE TABLE IF NOT EXISTS wallet_tx_reservation_projection (
      reservation_id TEXT PRIMARY KEY,
      reservation_type TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL DEFAULT '',
      txid TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      outpoints_json TEXT NOT NULL DEFAULT '[]',
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_tx_reservation_projection_status
      ON wallet_tx_reservation_projection(status, updated_at);

    CREATE TABLE IF NOT EXISTS wallet_outpoint_reservation_projection (
      reservation_id TEXT NOT NULL,
      outpoint TEXT NOT NULL,
      reservation_type TEXT NOT NULL DEFAULT '',
      owner_id TEXT NOT NULL DEFAULT '',
      txid TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (reservation_id, outpoint)
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_outpoint_reservation_projection_outpoint
      ON wallet_outpoint_reservation_projection(outpoint, status, updated_at);

    CREATE TABLE IF NOT EXISTS wallet_index_status_projection (
      wallet_key TEXT PRIMARY KEY,
      wallet_scan_cursor_height INTEGER NOT NULL DEFAULT 0,
      wallet_relevant_tx_count INTEGER NOT NULL DEFAULT 0,
      wallet_utxo_count INTEGER NOT NULL DEFAULT 0,
      context_ready_count INTEGER NOT NULL DEFAULT 0,
      beef_ready_utxo_count INTEGER NOT NULL DEFAULT 0,
      send_preflight_status TEXT NOT NULL DEFAULT 'unknown',
      sync_progress_active INTEGER NOT NULL DEFAULT 0,
      sync_progress_stage TEXT NOT NULL DEFAULT 'idle',
      sync_progress_message TEXT NOT NULL DEFAULT '',
      sync_progress_error TEXT NOT NULL DEFAULT '',
      last_indexed_at TEXT NOT NULL DEFAULT '',
      recent_rawtx_count INTEGER NOT NULL DEFAULT 0,
      recent_rawtx_latest_txid TEXT NOT NULL DEFAULT '',
      recent_rawtx_latest_ts TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallet_read_model_projection (
      wallet_key TEXT PRIMARY KEY,
      receive_address TEXT NOT NULL DEFAULT '',
      confirmed INTEGER NOT NULL DEFAULT 0,
      unconfirmed INTEGER NOT NULL DEFAULT 0,
      pending_delta INTEGER NOT NULL DEFAULT 0,
      income_sat INTEGER NOT NULL DEFAULT 0,
      expense_sat INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      total_bsv REAL NOT NULL DEFAULT 0,
      balance_updated_at TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wallet_history_projection (
      wallet_key TEXT NOT NULL,
      txid TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      noted_at TEXT NOT NULL DEFAULT '',
      confirmed INTEGER NOT NULL DEFAULT 0,
      net_sat INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL DEFAULT '',
      sort_index INTEGER NOT NULL DEFAULT 0,
      source_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (wallet_key, txid)
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_history_projection_wallet_sort
      ON wallet_history_projection(wallet_key, sort_index ASC, updated_at DESC, txid ASC);

    CREATE TABLE IF NOT EXISTS bhs_status_projection (
      scope TEXT PRIMARY KEY,
      ok INTEGER NOT NULL DEFAULT 0,
      checkpoint_height INTEGER NOT NULL DEFAULT 0,
      checkpoint_hash TEXT NOT NULL DEFAULT '',
      tip_height INTEGER NOT NULL DEFAULT 0,
      tip_hash TEXT NOT NULL DEFAULT '',
      header_count INTEGER NOT NULL DEFAULT 0,
      headers_json TEXT NOT NULL DEFAULT '{}',
      last_round_json TEXT NOT NULL DEFAULT '{}',
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_projection (
      order_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT '',
      snapshot_json TEXT NOT NULL DEFAULT '{}',
      funds_json TEXT NOT NULL DEFAULT '{}',
      transition_ids_json TEXT NOT NULL DEFAULT '[]',
      tip TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      last_event_seq INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_order_projection_status_updated
      ON order_projection(status, updated_at DESC, order_id ASC);

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
    CREATE INDEX IF NOT EXISTS idx_tx_contexts_confirmed ON tx_contexts(confirmed, last_seen_at);

    CREATE TABLE IF NOT EXISTS local_change_meta_projection (
      scope TEXT PRIMARY KEY,
      seq INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL,
      last_event_seq INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS local_change_projection (
      change_id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL DEFAULT 0,
      event_type TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      target_type TEXT NOT NULL DEFAULT '',
      target_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      txid TEXT NOT NULL DEFAULT '',
      ts TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      source_event_seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_local_change_projection_seq ON local_change_projection(seq ASC, change_id ASC);
    CREATE INDEX IF NOT EXISTS idx_local_change_projection_status ON local_change_projection(status, seq ASC);

    CREATE TABLE IF NOT EXISTS recent_rawtx_projection (
      txid TEXT PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      rawtx TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      source_event_seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_recent_rawtx_projection_ts ON recent_rawtx_projection(ts ASC, txid ASC);

    CREATE TABLE IF NOT EXISTS pending_anchor_projection (
      anchor_key TEXT PRIMARY KEY,
      ts TEXT NOT NULL DEFAULT '',
      txid TEXT NOT NULL DEFAULT '',
      event_type TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      node TEXT NOT NULL DEFAULT '',
      confirmed INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      source_event_seq INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pending_anchor_projection_ts ON pending_anchor_projection(ts ASC, txid ASC);
  `);
  const additiveSchema = [
    "ALTER TABLE categories ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE categories ADD COLUMN owned_by_current_wallet INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE categories ADD COLUMN local_status TEXT NOT NULL DEFAULT 'synced'",
    "ALTER TABLE products ADD COLUMN version INTEGER NOT NULL DEFAULT 1",
    "ALTER TABLE products ADD COLUMN owned_by_current_wallet INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE products ADD COLUMN local_status TEXT NOT NULL DEFAULT 'synced'",
    "ALTER TABLE chat_messages ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE sync_state ADD COLUMN scanned_from INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sync_state ADD COLUMN initial_sync_completed INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sync_state ADD COLUMN manual_quickstart_pending INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sync_state ADD COLUMN retries INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sync_state ADD COLUMN last_p2p_forward_probe_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE sync_state ADD COLUMN last_p2p_advance_at TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE sync_state ADD COLUMN last_p2p_good_nodes INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sync_state ADD COLUMN empty_backfill_tried INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE sync_state ADD COLUMN chain_sources_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE sync_state ADD COLUMN source_stats_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE sync_state ADD COLUMN p2p_height_hash_cache_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE sync_state ADD COLUMN p2p_gap_heights_json TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE sync_state ADD COLUMN p2p_node_stats_json TEXT NOT NULL DEFAULT '{}'",
    "ALTER TABLE bhs_status_projection ADD COLUMN headers_json TEXT NOT NULL DEFAULT '{}'",
  ];
  additiveSchema.forEach((sql) => {
    try {
      db.exec(sql);
    } catch (_) {}
  });

  try {
    const syncColumns = db.prepare(`PRAGMA table_info(sync_state)`).all();
    const hasLegacyNetworkHeight = Array.isArray(syncColumns)
      && syncColumns.some((row) => String(row?.name || '') === 'network_height');
    if (hasLegacyNetworkHeight) {
      db.exec(`
        ALTER TABLE sync_state RENAME TO sync_state_legacy;
        CREATE TABLE sync_state (
          scope TEXT PRIMARY KEY,
          bootstrap_height INTEGER NOT NULL,
          local_height INTEGER NOT NULL,
          fixed_sync_last_height INTEGER NOT NULL,
          p2p_tip_height INTEGER NOT NULL,
          p2p_tip_hash TEXT NOT NULL DEFAULT '',
          p2p_header_cursor_height INTEGER NOT NULL,
          p2p_header_cursor_hash TEXT NOT NULL DEFAULT '',
          online INTEGER NOT NULL DEFAULT 0,
          mode TEXT NOT NULL DEFAULT '',
          lag INTEGER NOT NULL DEFAULT 0,
          session_epoch INTEGER NOT NULL DEFAULT 0,
          scanned_from INTEGER NOT NULL DEFAULT 0,
          initial_sync_completed INTEGER NOT NULL DEFAULT 0,
          manual_quickstart_pending INTEGER NOT NULL DEFAULT 0,
          retries INTEGER NOT NULL DEFAULT 0,
          last_p2p_forward_probe_at TEXT NOT NULL DEFAULT '',
          last_p2p_advance_at TEXT NOT NULL DEFAULT '',
          last_p2p_good_nodes INTEGER NOT NULL DEFAULT 0,
          empty_backfill_tried INTEGER NOT NULL DEFAULT 0,
          chain_sources_json TEXT NOT NULL DEFAULT '[]',
          source_stats_json TEXT NOT NULL DEFAULT '{}',
          p2p_height_hash_cache_json TEXT NOT NULL DEFAULT '{}',
          p2p_gap_heights_json TEXT NOT NULL DEFAULT '[]',
          p2p_node_stats_json TEXT NOT NULL DEFAULT '{}',
          updated_at TEXT NOT NULL
        );
        INSERT INTO sync_state(
          scope,
          bootstrap_height,
          local_height,
          fixed_sync_last_height,
          p2p_tip_height,
          p2p_tip_hash,
          p2p_header_cursor_height,
          p2p_header_cursor_hash,
          online,
          mode,
          lag,
          session_epoch,
          scanned_from,
          initial_sync_completed,
          manual_quickstart_pending,
          retries,
          last_p2p_forward_probe_at,
          last_p2p_advance_at,
          last_p2p_good_nodes,
          empty_backfill_tried,
          chain_sources_json,
          source_stats_json,
          p2p_height_hash_cache_json,
          p2p_gap_heights_json,
          p2p_node_stats_json,
          updated_at
        )
        SELECT
          scope,
          bootstrap_height,
          local_height,
          fixed_sync_last_height,
          p2p_tip_height,
          p2p_tip_hash,
          p2p_header_cursor_height,
          p2p_header_cursor_hash,
          online,
          mode,
          lag,
          session_epoch,
          scanned_from,
          initial_sync_completed,
          manual_quickstart_pending,
          retries,
          last_p2p_forward_probe_at,
          last_p2p_advance_at,
          last_p2p_good_nodes,
          empty_backfill_tried,
          chain_sources_json,
          source_stats_json,
          p2p_height_hash_cache_json,
          p2p_gap_heights_json,
          p2p_node_stats_json,
          updated_at
        FROM sync_state_legacy;
        DROP TABLE sync_state_legacy;
      `);
    }
  } catch (_) {}

  db.prepare(`
    UPDATE chat_message_index_projection
    SET transport = 'p2p'
    WHERE msg_id LIKE 'p2p:%'
      AND transport = 'onchain'
  `).run();
  db.prepare(`
    UPDATE chat_thread_status_projection
    SET last_transport = 'p2p'
    WHERE last_message_id LIKE 'p2p:%'
      AND last_transport = 'onchain'
  `).run();

  const upsertMeta = db.prepare(`
    INSERT INTO schema_meta(key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);
  const now = nowIso();
  upsertMeta.run('schema_version', '1', now);
  upsertMeta.run('writer_started_at', now, now);
  upsertMeta.run('writer_pid', String(process.pid), now);
  upsertMeta.run('last_health_at', now, now);
}

function cleanupPendingRawtx() {
  ensureDir(RAWTX_PENDING_DIR);
  const entries = fs.readdirSync(RAWTX_PENDING_DIR, { withFileTypes: true });
  const now = Date.now();
  let deletedCount = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(RAWTX_PENDING_DIR, entry.name);
    let stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch (_) {
      continue;
    }
    if (!stat || ((now - stat.mtimeMs) < DEFAULT_PENDING_MAX_AGE_MS)) continue;
    try {
      fs.unlinkSync(filePath);
      deletedCount += 1;
    } catch (_) {}
  }
  return { deletedCount };
}

function touchHealth() {
  if (!db) return;
  db.prepare(`
    INSERT INTO schema_meta(key, value, updated_at)
    VALUES ('last_health_at', ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(nowIso(), nowIso());
}

function withTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch (_) {}
    throw error;
  }
}

function upsertSyncState(payload = {}) {
  const row = {
    scope: String(payload.scope || 'main'),
    bootstrap_height: Math.max(0, Number(payload.bootstrapHeight || 0)),
    local_height: Math.max(0, Number(payload.localHeight || 0)),
    fixed_sync_last_height: Math.max(0, Number(payload.fixedSyncLastHeight || 0)),
    p2p_tip_height: Math.max(0, Number(payload.p2pTipHeight || 0)),
    p2p_tip_hash: String(payload.p2pTipHash || ''),
    p2p_header_cursor_height: Math.max(0, Number(payload.p2pHeaderCursorHeight || 0)),
    p2p_header_cursor_hash: String(payload.p2pHeaderCursorHash || ''),
    online: payload.online ? 1 : 0,
    mode: String(payload.mode || ''),
    lag: Math.max(0, Number(payload.lag || 0)),
    session_epoch: Math.max(0, Number(payload.sessionEpoch || 0)),
    scanned_from: Math.max(0, Number(payload.scannedFrom || 0)),
    initial_sync_completed: payload.initialSyncCompleted ? 1 : 0,
    manual_quickstart_pending: payload.manualQuickstartPending ? 1 : 0,
    retries: Math.max(0, Number(payload.retries || 0)),
    last_p2p_forward_probe_at: String(payload.lastP2PForwardProbeAt || ''),
    last_p2p_advance_at: String(payload.lastP2PAdvanceAt || ''),
    last_p2p_good_nodes: Math.max(0, Number(payload.lastP2PGoodNodes || 0)),
    empty_backfill_tried: payload.emptyBackfillTried ? 1 : 0,
    chain_sources_json: JSON.stringify(Array.isArray(payload.chainSources) ? payload.chainSources : []),
    source_stats_json: JSON.stringify(payload.sourceStats && typeof payload.sourceStats === 'object' ? payload.sourceStats : {}),
    p2p_height_hash_cache_json: JSON.stringify(payload.p2pHeightHashCache && typeof payload.p2pHeightHashCache === 'object' ? payload.p2pHeightHashCache : {}),
    p2p_gap_heights_json: JSON.stringify(Array.isArray(payload.p2pGapHeights) ? payload.p2pGapHeights : []),
    p2p_node_stats_json: JSON.stringify(payload.p2pNodeStats && typeof payload.p2pNodeStats === 'object' ? payload.p2pNodeStats : {}),
    updated_at: String(payload.updatedAt || nowIso()),
  };
  withTransaction(() => {
    db.prepare(`
      INSERT INTO sync_state(
        scope,
        bootstrap_height,
        local_height,
        fixed_sync_last_height,
        p2p_tip_height,
        p2p_tip_hash,
        p2p_header_cursor_height,
        p2p_header_cursor_hash,
        online,
        mode,
        lag,
        session_epoch,
        scanned_from,
        initial_sync_completed,
        manual_quickstart_pending,
        retries,
        last_p2p_forward_probe_at,
        last_p2p_advance_at,
        last_p2p_good_nodes,
        empty_backfill_tried,
        chain_sources_json,
        source_stats_json,
        p2p_height_hash_cache_json,
        p2p_gap_heights_json,
        p2p_node_stats_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope) DO UPDATE SET
        bootstrap_height = excluded.bootstrap_height,
        local_height = excluded.local_height,
        fixed_sync_last_height = excluded.fixed_sync_last_height,
        p2p_tip_height = excluded.p2p_tip_height,
        p2p_tip_hash = excluded.p2p_tip_hash,
        p2p_header_cursor_height = excluded.p2p_header_cursor_height,
        p2p_header_cursor_hash = excluded.p2p_header_cursor_hash,
        online = excluded.online,
        mode = excluded.mode,
        lag = excluded.lag,
        session_epoch = excluded.session_epoch,
        scanned_from = excluded.scanned_from,
        initial_sync_completed = excluded.initial_sync_completed,
        manual_quickstart_pending = excluded.manual_quickstart_pending,
        retries = excluded.retries,
        last_p2p_forward_probe_at = excluded.last_p2p_forward_probe_at,
        last_p2p_advance_at = excluded.last_p2p_advance_at,
        last_p2p_good_nodes = excluded.last_p2p_good_nodes,
        empty_backfill_tried = excluded.empty_backfill_tried,
        chain_sources_json = excluded.chain_sources_json,
        source_stats_json = excluded.source_stats_json,
        p2p_height_hash_cache_json = excluded.p2p_height_hash_cache_json,
        p2p_gap_heights_json = excluded.p2p_gap_heights_json,
        p2p_node_stats_json = excluded.p2p_node_stats_json,
        updated_at = excluded.updated_at
    `).run(
      row.scope,
      row.bootstrap_height,
      row.local_height,
      row.fixed_sync_last_height,
      row.p2p_tip_height,
      row.p2p_tip_hash,
      row.p2p_header_cursor_height,
      row.p2p_header_cursor_hash,
      row.online,
      row.mode,
      row.lag,
      row.session_epoch,
      row.scanned_from,
      row.initial_sync_completed,
      row.manual_quickstart_pending,
      row.retries,
      row.last_p2p_forward_probe_at,
      row.last_p2p_advance_at,
      row.last_p2p_good_nodes,
      row.empty_backfill_tried,
      row.chain_sources_json,
      row.source_stats_json,
      row.p2p_height_hash_cache_json,
      row.p2p_gap_heights_json,
      row.p2p_node_stats_json,
      row.updated_at,
    );
  });
  return {
    scope: row.scope,
    updatedAt: row.updated_at,
  };
}

function getSyncState(payload = {}) {
  const scope = String(payload.scope || 'main');
  const row = db.prepare('SELECT * FROM sync_state WHERE scope = ?').get(scope);
  return row || null;
}

function replaceCatalogSnapshot(payload = {}) {
  const categories = Array.isArray(payload.categories) ? payload.categories : [];
  const products = Array.isArray(payload.products) ? payload.products : [];
  const resetAll = payload?.resetAll === true;
  const shouldReplaceRow = (incomingVersion, incomingUpdatedAt, storedVersion, storedUpdatedAt) => {
    const nextVersion = Math.max(1, Number(incomingVersion || 1));
    const prevVersion = Math.max(1, Number(storedVersion || 1));
    if (nextVersion !== prevVersion) return nextVersion > prevVersion;
    const nextTs = Date.parse(String(incomingUpdatedAt || '')) || 0;
    const prevTs = Date.parse(String(storedUpdatedAt || '')) || 0;
    return nextTs >= prevTs;
  };
  withTransaction(() => {
    if (resetAll) {
      db.prepare('DELETE FROM categories').run();
      db.prepare('DELETE FROM products').run();
    }
    const categoryIds = Array.from(new Set(categories.map((row) => String(row?.id || '')).filter(Boolean)));
    const productIds = Array.from(new Set(products.map((row) => String(row?.id || '')).filter(Boolean)));
    const selectExistingByIds = (table, idColumn, ids) => {
      const map = new Map();
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        if (!chunk.length) continue;
        const rows = db.prepare(`
          SELECT ${idColumn} AS id, version, updated_at
          FROM ${table}
          WHERE ${idColumn} IN (${chunk.map(() => '?').join(',')})
        `).all(...chunk);
        rows.forEach((row) => map.set(String(row.id || ''), row));
      }
      return map;
    };
    const existingCategories = resetAll
      ? new Map()
      : selectExistingByIds('categories', 'category_id', categoryIds);
    const existingProducts = resetAll
      ? new Map()
      : selectExistingByIds('products', 'product_id', productIds);
    const insertCategory = db.prepare(`
      INSERT INTO categories(
        category_id,
        merchant_id,
        name,
        version,
        status,
        owned_by_current_wallet,
        local_status,
        updated_at,
        last_event_id,
        last_txid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(category_id) DO UPDATE SET
        merchant_id = excluded.merchant_id,
        name = excluded.name,
        version = excluded.version,
        status = excluded.status,
        owned_by_current_wallet = excluded.owned_by_current_wallet,
        local_status = excluded.local_status,
        updated_at = excluded.updated_at,
        last_event_id = excluded.last_event_id,
        last_txid = excluded.last_txid
    `);
    const insertProduct = db.prepare(`
      INSERT INTO products(
        product_id,
        merchant_id,
        category_id,
        title,
        description,
        image_url,
        price,
        stock,
        sold_count,
        version,
        status,
        owned_by_current_wallet,
        local_status,
        updated_at,
        last_event_id,
        last_txid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_id) DO UPDATE SET
        merchant_id = excluded.merchant_id,
        category_id = excluded.category_id,
        title = excluded.title,
        description = excluded.description,
        image_url = excluded.image_url,
        price = excluded.price,
        stock = excluded.stock,
        sold_count = excluded.sold_count,
        version = excluded.version,
        status = excluded.status,
        owned_by_current_wallet = excluded.owned_by_current_wallet,
        local_status = excluded.local_status,
        updated_at = excluded.updated_at,
        last_event_id = excluded.last_event_id,
        last_txid = excluded.last_txid
    `);
    categories.forEach((row) => {
      const id = String(row.id || '');
      if (!id) return;
      const existing = existingCategories.get(id) || null;
      const incomingUpdatedAt = String(row.localUpdatedAt || nowIso());
      if (!shouldReplaceRow(row.version, incomingUpdatedAt, existing?.version, existing?.updated_at)) return;
      insertCategory.run(
        id,
        String(row.merchantId || ''),
        String(row.name || ''),
        Math.max(1, Number(row.version || 1)),
        String(row.deleted ? 'deleted' : 'active'),
        row.ownedByCurrentWallet ? 1 : 0,
        String(row.localStatus || 'synced'),
        incomingUpdatedAt,
        0,
        '',
      );
    });
    products.forEach((row) => {
      const id = String(row.id || '');
      if (!id) return;
      const existing = existingProducts.get(id) || null;
      const incomingUpdatedAt = String(row.localUpdatedAt || nowIso());
      if (!shouldReplaceRow(row.version, incomingUpdatedAt, existing?.version, existing?.updated_at)) return;
      insertProduct.run(
        id,
        String(row.merchantId || ''),
        String(row.categoryId || ''),
        String(row.title || ''),
        String(row.description || ''),
        String(row.imageUrl || ''),
        Math.max(0, Number(row.price || 0)),
        Math.max(0, Number(row.stock || 0)),
        Math.max(0, Number(row.soldCount || 0)),
        Math.max(1, Number(row.version || 1)),
        String(row.deleted ? 'deleted' : 'active'),
        row.ownedByCurrentWallet ? 1 : 0,
        String(row.localStatus || 'synced'),
        incomingUpdatedAt,
        0,
        '',
      );
    });
  });
  return {
    categoryCount: categories.length,
    productCount: products.length,
    resetAll,
  };
}

function getCatalogSnapshot() {
  const categories = db.prepare(`
    SELECT
      category_id,
      merchant_id,
      name,
      version,
      status,
      owned_by_current_wallet,
      local_status,
      updated_at
    FROM categories
    ORDER BY category_id ASC
  `).all();
  const products = db.prepare(`
    SELECT
      product_id,
      merchant_id,
      category_id,
      title,
      description,
      image_url,
      price,
      stock,
      sold_count,
      version,
      status,
      owned_by_current_wallet,
      local_status,
      updated_at
    FROM products
    ORDER BY product_id ASC
  `).all();
  return { categories, products };
}

function replaceProfileSnapshot(payload = {}) {
  const profile = payload && typeof payload === 'object' ? payload : {};
  const now = nowIso();
  const profileKey = String(profile.profileKey || 'self');
  const merchantId = String(profile.merchantId || '');
  const walletId = String(profile.walletId || '');
  const name = String(profile.name || '');
  const payloadJson = JSON.stringify({
    localStatus: String(profile.localStatus || ''),
    localUpdatedAt: String(profile.localUpdatedAt || ''),
  });
  withTransaction(() => {
    db.prepare(`
      INSERT INTO profiles(
        profile_key,
        merchant_id,
        wallet_id,
        name,
        payload_json,
        updated_at,
        last_event_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_key) DO UPDATE SET
        merchant_id = excluded.merchant_id,
        wallet_id = excluded.wallet_id,
        name = excluded.name,
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `).run(
      profileKey,
      merchantId,
      walletId,
      name,
      payloadJson,
      String(profile.updatedAt || now),
      0,
    );
  });
  return { profileKey, updatedAt: String(profile.updatedAt || now) };
}

function getProfileSnapshot(payload = {}) {
  const profileKey = String(payload.profileKey || 'self');
  return db.prepare(`
    SELECT
      profile_key,
      merchant_id,
      wallet_id,
      name,
      payload_json,
      updated_at
    FROM profiles
    WHERE profile_key = ?
  `).get(profileKey) || null;
}

function appendEvents(payload = {}) {
  const rows = Array.isArray(payload.events) ? payload.events : [];
  const insert = db.prepare(`
    INSERT INTO event_log (
      event_id,
      event_type,
      producer,
      entity_type,
      entity_id,
      ts,
      schema_version,
      causation_id,
      correlation_id,
      dedupe_key,
      payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING
  `);
  const selectSeq = db.prepare(`SELECT seq FROM event_log WHERE event_id = ? LIMIT 1`);
  const selectSeqByDedupeKey = db.prepare(`SELECT seq, event_id FROM event_log WHERE dedupe_key = ? LIMIT 1`);
  const written = [];
  withTransaction(() => {
    rows.forEach((row) => {
      const eventId = String(row?.eventId || '').trim();
      if (!eventId) return;
      const dedupeKey = String(row?.dedupeKey || '').trim();
      if (dedupeKey) {
        const existing = selectSeqByDedupeKey.get(dedupeKey);
        if (existing) {
          written.push({
            eventId: String(existing.event_id || eventId),
            seq: Math.max(0, Number(existing.seq || 0)),
          });
          return;
        }
      }
      insert.run(
        eventId,
        String(row?.eventType || '').trim(),
        String(row?.producer || '').trim(),
        String(row?.entityType || '').trim(),
        String(row?.entityId || '').trim(),
        String(row?.ts || nowIso()),
        Math.max(1, Number(row?.schemaVersion || 1)),
        String(row?.causationId || '').trim(),
        String(row?.correlationId || '').trim(),
        dedupeKey,
        JSON.stringify(row?.payload && typeof row.payload === 'object' ? row.payload : {}),
      );
      const found = selectSeq.get(eventId);
      if (found) written.push({ eventId, seq: Math.max(0, Number(found.seq || 0)) });
    });
  });
  return {
    count: written.length,
    events: written,
  };
}

function listEventsAfter(payload = {}) {
  const afterSeq = Math.max(0, Number(payload.afterSeq || 0));
  const limit = Math.max(1, Math.min(1000, Number(payload.limit || 100)));
  return db.prepare(`
    SELECT
      seq,
      event_id,
      event_type,
      producer,
      entity_type,
      entity_id,
      ts,
      schema_version,
      causation_id,
      correlation_id,
      dedupe_key,
      payload_json
    FROM event_log
    WHERE seq > ?
    ORDER BY seq ASC
    LIMIT ?
  `).all(afterSeq, limit).map((row) => {
    let payloadJson = {};
    try {
      payloadJson = JSON.parse(String(row.payload_json || '{}'));
    } catch (_) {
      payloadJson = {};
    }
    return {
      seq: Math.max(0, Number(row.seq || 0)),
      eventId: String(row.event_id || ''),
      eventType: String(row.event_type || ''),
      producer: String(row.producer || ''),
      entityType: String(row.entity_type || ''),
      entityId: String(row.entity_id || ''),
      ts: String(row.ts || ''),
      schemaVersion: Math.max(1, Number(row.schema_version || 1)),
      causationId: String(row.causation_id || ''),
      correlationId: String(row.correlation_id || ''),
      dedupeKey: String(row.dedupe_key || ''),
      payload: payloadJson,
    };
  });
}

function getEventConsumer(payload = {}) {
  const consumerName = String(payload.consumerName || '').trim();
  if (!consumerName) {
    return {
      consumerName: '',
      lastSeq: 0,
      updatedAt: '',
    };
  }
  const row = db.prepare(`
    SELECT consumer_name, last_seq, updated_at
    FROM event_consumers
    WHERE consumer_name = ?
    LIMIT 1
  `).get(consumerName);
  return {
    consumerName,
    lastSeq: Math.max(0, Number(row?.last_seq || 0)),
    updatedAt: String(row?.updated_at || ''),
  };
}

function setEventConsumer(payload = {}) {
  const consumerName = String(payload.consumerName || '').trim();
  if (!consumerName) throw Object.assign(new Error('consumerName is required'), { code: 'BAD_REQUEST' });
  const lastSeq = Math.max(0, Number(payload.lastSeq || 0));
  const updatedAt = String(payload.updatedAt || nowIso());
  db.prepare(`
    INSERT INTO event_consumers (consumer_name, last_seq, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(consumer_name) DO UPDATE SET
      last_seq = excluded.last_seq,
      updated_at = excluded.updated_at
  `).run(consumerName, lastSeq, updatedAt);
  return {
    consumerName,
    lastSeq,
    updatedAt,
  };
}

function mapDurableQueueRow(row) {
  if (!row) return null;
  let payload = {};
  let result = null;
  try { payload = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
  try { result = JSON.parse(String(row.result_json || 'null')); } catch (_) {}
  return {
    queueName: String(row.queue_name || ''),
    messageId: String(row.message_id || ''),
    topic: String(row.topic || ''),
    dedupeKey: String(row.dedupe_key || ''),
    priority: Math.max(0, Number(row.priority || 0)),
    payload: payload && typeof payload === 'object' ? payload : {},
    result: result && typeof result === 'object' ? result : null,
    status: String(row.status || 'pending'),
    createdAt: String(row.created_at || ''),
    claimedAt: String(row.claimed_at || ''),
    finishedAt: String(row.finished_at || ''),
    workerId: String(row.worker_id || ''),
    error: String(row.error || ''),
    updatedAt: String(row.updated_at || ''),
  };
}

function enqueueDurableMessage(payload = {}) {
  const queueName = String(payload.queueName || '').trim();
  const messageId = String(payload.messageId || '').trim();
  if (!queueName || !messageId) {
    throw Object.assign(new Error('queueName and messageId are required'), { code: 'BAD_REQUEST' });
  }
  const dedupeKey = String(payload.dedupeKey || '').trim();
  const topic = String(payload.topic || queueName).trim();
  const priority = Math.max(0, Number(payload.priority || 100));
  const now = String(payload.createdAt || nowIso());
  const selectById = db.prepare(`
    SELECT *
    FROM durable_queue_messages
    WHERE message_id = ?
    LIMIT 1
  `);
  const selectByDedupe = db.prepare(`
    SELECT *
    FROM durable_queue_messages
    WHERE queue_name = ? AND dedupe_key = ?
    ORDER BY created_at DESC, message_id DESC
    LIMIT 1
  `);
  const insert = db.prepare(`
    INSERT INTO durable_queue_messages (
      queue_name, message_id, topic, dedupe_key, priority, payload_json,
      result_json, status, created_at, claimed_at, finished_at, worker_id, error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'null', 'pending', ?, '', '', '', '', ?)
    ON CONFLICT(message_id) DO NOTHING
  `);
  let row = null;
  withTransaction(() => {
    if (dedupeKey) {
      const existing = selectByDedupe.get(queueName, dedupeKey);
      if (existing && ['pending', 'claimed'].includes(String(existing.status || ''))) {
        row = existing;
        return;
      }
    }
    insert.run(
      queueName,
      messageId,
      topic,
      dedupeKey,
      priority,
      JSON.stringify(payload.payload && typeof payload.payload === 'object' ? payload.payload : {}),
      now,
      now,
    );
    row = selectById.get(messageId);
  });
  return mapDurableQueueRow(row);
}

function claimNextDurableMessage(payload = {}) {
  const queueName = String(payload.queueName || '').trim();
  if (!queueName) throw Object.assign(new Error('queueName is required'), { code: 'BAD_REQUEST' });
  const workerId = String(payload.workerId || '').trim();
  const now = String(payload.claimedAt || nowIso());
  const select = db.prepare(`
    SELECT *
    FROM durable_queue_messages
    WHERE queue_name = ? AND status = 'pending'
    ORDER BY priority ASC, created_at ASC, message_id ASC
    LIMIT 1
  `);
  const update = db.prepare(`
    UPDATE durable_queue_messages
    SET status = 'claimed',
        claimed_at = ?,
        worker_id = ?,
        updated_at = ?
    WHERE message_id = ? AND status = 'pending'
  `);
  let row = null;
  withTransaction(() => {
    const candidate = select.get(queueName);
    if (!candidate) return;
    update.run(now, workerId, now, String(candidate.message_id || ''));
    row = db.prepare(`SELECT * FROM durable_queue_messages WHERE message_id = ? LIMIT 1`).get(String(candidate.message_id || ''));
  });
  return mapDurableQueueRow(row);
}

function finishDurableMessage(payload = {}) {
  const queueName = String(payload.queueName || '').trim();
  const messageId = String(payload.messageId || '').trim();
  if (!queueName || !messageId) {
    throw Object.assign(new Error('queueName and messageId are required'), { code: 'BAD_REQUEST' });
  }
  const status = String(payload.status || '').trim();
  if (!['done', 'failed', 'interrupted'].includes(status)) {
    throw Object.assign(new Error('status must be done/failed/interrupted'), { code: 'BAD_REQUEST' });
  }
  const finishedAt = String(payload.finishedAt || nowIso());
  db.prepare(`
    UPDATE durable_queue_messages
    SET status = ?,
        result_json = ?,
        finished_at = ?,
        error = ?,
        worker_id = CASE WHEN ? = 1 THEN '' ELSE worker_id END,
        claimed_at = CASE WHEN ? = 1 THEN '' ELSE claimed_at END,
        updated_at = ?
    WHERE queue_name = ? AND message_id = ?
  `).run(
    status,
    JSON.stringify(payload.result && typeof payload.result === 'object' ? payload.result : null),
    finishedAt,
    String(payload.error || ''),
    payload.resetClaim === true ? 1 : 0,
    payload.resetClaim === true ? 1 : 0,
    finishedAt,
    queueName,
    messageId,
  );
  const row = db.prepare(`
    SELECT *
    FROM durable_queue_messages
    WHERE queue_name = ? AND message_id = ?
    LIMIT 1
  `).get(queueName, messageId);
  return mapDurableQueueRow(row);
}

function releaseDurableMessage(payload = {}) {
  const queueName = String(payload.queueName || '').trim();
  const messageId = String(payload.messageId || '').trim();
  if (!queueName || !messageId) {
    throw Object.assign(new Error('queueName and messageId are required'), { code: 'BAD_REQUEST' });
  }
  const updatedAt = String(payload.updatedAt || nowIso());
  db.prepare(`
    UPDATE durable_queue_messages
    SET status = 'pending',
        claimed_at = '',
        worker_id = '',
        updated_at = ?
    WHERE queue_name = ? AND message_id = ? AND status = 'claimed'
  `).run(updatedAt, queueName, messageId);
  const row = db.prepare(`
    SELECT *
    FROM durable_queue_messages
    WHERE queue_name = ? AND message_id = ?
    LIMIT 1
  `).get(queueName, messageId);
  return mapDurableQueueRow(row);
}

function listDurableMessages(payload = {}) {
  const queueName = String(payload.queueName || '').trim();
  const limit = Math.max(1, Math.min(5000, Number(payload.limit || 1000)));
  const status = String(payload.status || '').trim();
  const rows = queueName
    ? (
      status
        ? db.prepare(`
            SELECT *
            FROM durable_queue_messages
            WHERE queue_name = ? AND status = ?
            ORDER BY created_at ASC, message_id ASC
            LIMIT ?
          `).all(queueName, status, limit)
        : db.prepare(`
            SELECT *
            FROM durable_queue_messages
            WHERE queue_name = ?
            ORDER BY created_at ASC, message_id ASC
            LIMIT ?
          `).all(queueName, limit)
    )
    : db.prepare(`
        SELECT *
        FROM durable_queue_messages
        ORDER BY queue_name ASC, created_at ASC, message_id ASC
        LIMIT ?
      `).all(limit);
  return rows.map((row) => mapDurableQueueRow(row));
}

function applyChatProjectionBatch(payload = {}) {
  const bindings = Array.isArray(payload.bindings) ? payload.bindings : [];
  const presences = Array.isArray(payload.presences) ? payload.presences : [];
  const threads = Array.isArray(payload.threads) ? payload.threads : [];
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  const selfStates = Array.isArray(payload.selfStates) ? payload.selfStates : [];
  const deleteMessageKeys = Array.isArray(payload.deleteMessageKeys) ? payload.deleteMessageKeys : [];
  const deleteThreadKeys = Array.isArray(payload.deleteThreadKeys) ? payload.deleteThreadKeys : [];
  const storageLimitBytes = Math.max(1024, Number(payload.storageLimitBytes || 104857600));
  const upsertPresence = db.prepare(`
    INSERT INTO chat_presence_projection (
      self_wallet_id, peer_wallet_id, status, last_event_seq, last_event_type,
      last_seen_at, last_handshake_at, last_failure_at, last_error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(self_wallet_id, peer_wallet_id) DO UPDATE SET
      status = excluded.status,
      last_event_seq = excluded.last_event_seq,
      last_event_type = excluded.last_event_type,
      last_seen_at = excluded.last_seen_at,
      last_handshake_at = excluded.last_handshake_at,
      last_failure_at = excluded.last_failure_at,
      last_error = excluded.last_error,
      updated_at = excluded.updated_at
  `);
  const upsertThread = db.prepare(`
    INSERT INTO chat_thread_status_projection (
      self_wallet_id, peer_wallet_id, thread_id, display_name, unread_count,
      last_message_id, last_message_at, last_message_preview, last_transport,
      last_read_at, last_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(self_wallet_id, peer_wallet_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      display_name = excluded.display_name,
      unread_count = excluded.unread_count,
      last_message_id = excluded.last_message_id,
      last_message_at = excluded.last_message_at,
      last_message_preview = excluded.last_message_preview,
      last_transport = CASE
        WHEN excluded.last_message_id LIKE 'p2p:%'
          AND chat_thread_status_projection.last_transport = 'p2p'
          AND excluded.last_transport = 'onchain'
        THEN chat_thread_status_projection.last_transport
        ELSE excluded.last_transport
      END,
      last_read_at = excluded.last_read_at,
      last_event_seq = excluded.last_event_seq,
      updated_at = excluded.updated_at
  `);
  const upsertMessage = db.prepare(`
    INSERT INTO chat_message_index_projection (
      self_wallet_id, peer_wallet_id, msg_id, thread_id, direction, transport,
      text, order_id, ts, status, txid, source_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(self_wallet_id, peer_wallet_id, msg_id) DO UPDATE SET
      thread_id = excluded.thread_id,
      direction = excluded.direction,
      transport = CASE
        WHEN chat_message_index_projection.msg_id LIKE 'p2p:%'
          AND chat_message_index_projection.transport = 'p2p'
          AND excluded.transport = 'onchain'
        THEN chat_message_index_projection.transport
        ELSE excluded.transport
      END,
      text = CASE
        WHEN length(trim(excluded.text)) > 0 THEN excluded.text
        ELSE chat_message_index_projection.text
      END,
      order_id = excluded.order_id,
      ts = excluded.ts,
      status = excluded.status,
      txid = excluded.txid,
      source_event_seq = excluded.source_event_seq,
      updated_at = excluded.updated_at
  `);
  const deleteMessage = db.prepare(`
    DELETE FROM chat_message_index_projection
    WHERE self_wallet_id = ? AND peer_wallet_id = ? AND msg_id = ?
  `);
  const deleteThreadMessages = db.prepare(`
    DELETE FROM chat_message_index_projection
    WHERE self_wallet_id = ? AND peer_wallet_id = ?
  `);
  const deleteThreadPresence = db.prepare(`
    DELETE FROM chat_presence_projection
    WHERE self_wallet_id = ? AND peer_wallet_id = ?
  `);
  const deleteThreadStatus = db.prepare(`
    DELETE FROM chat_thread_status_projection
    WHERE self_wallet_id = ? AND peer_wallet_id = ?
  `);
  const upsertContact = db.prepare(`
    INSERT INTO chat_contact_projection (
      self_wallet_id, peer_wallet_id, is_friend, friend_status, blocked, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(self_wallet_id, peer_wallet_id) DO UPDATE SET
      is_friend = excluded.is_friend,
      friend_status = excluded.friend_status,
      blocked = excluded.blocked,
      updated_at = excluded.updated_at
  `);
  const upsertSelfState = db.prepare(`
    INSERT INTO chat_self_state_projection (
      self_wallet_id, online, storage_limit_bytes, updated_at
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(self_wallet_id) DO UPDATE SET
      online = excluded.online,
      storage_limit_bytes = excluded.storage_limit_bytes,
      updated_at = excluded.updated_at
  `);
  const upsertWalletKeyBind = db.prepare(`
    INSERT INTO wallet_key_binds (
      wallet_id, merchant_id, chat_pub_key, endpoint_hints_json, relay_hints_json,
      signature_ok, updated_at, last_event_id, last_txid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wallet_id) DO UPDATE SET
      merchant_id = excluded.merchant_id,
      chat_pub_key = excluded.chat_pub_key,
      endpoint_hints_json = excluded.endpoint_hints_json,
      relay_hints_json = excluded.relay_hints_json,
      signature_ok = excluded.signature_ok,
      updated_at = excluded.updated_at,
      last_event_id = excluded.last_event_id,
      last_txid = excluded.last_txid
  `);
  withTransaction(() => {
    bindings.forEach((row) => {
      const walletId = String(row?.walletId || '').trim();
      const chatPubKey = String(row?.chatPubKey || '').trim();
      if (!walletId || !chatPubKey) return;
      upsertWalletKeyBind.run(
        walletId,
        String(row?.merchantId || '').trim(),
        chatPubKey,
        JSON.stringify(Array.isArray(row?.endpointHints) ? row.endpointHints.slice(0, 8) : []),
        JSON.stringify(Array.isArray(row?.relayHints) ? row.relayHints.slice(0, 8) : []),
        row?.signatureOk === false ? 0 : 1,
        String(row?.updatedAt || nowIso()),
        Math.max(0, Number(row?.lastEventId || 0)),
        String(row?.lastTxid || '').trim(),
      );
    });
    selfStates.forEach((row) => {
      upsertSelfState.run(
        String(row?.selfWalletId || '').trim(),
        row?.online === false ? 0 : 1,
        Math.max(1024, Number(row?.storageLimitBytes || storageLimitBytes || 104857600)),
        String(row?.updatedAt || nowIso()),
      );
    });
    contacts.forEach((row) => {
      upsertContact.run(
        String(row?.selfWalletId || '').trim(),
        String(row?.peerWalletId || '').trim(),
        row?.isFriend === true ? 1 : 0,
        String(row?.friendStatus || 'none').trim(),
        row?.blocked === true ? 1 : 0,
        String(row?.updatedAt || nowIso()),
      );
    });
    presences.forEach((row) => {
      upsertPresence.run(
        String(row?.selfWalletId || '').trim(),
        String(row?.peerWalletId || '').trim(),
        String(row?.status || 'offline').trim(),
        Math.max(0, Number(row?.lastEventSeq || 0)),
        String(row?.lastEventType || '').trim(),
        String(row?.lastSeenAt || '').trim(),
        String(row?.lastHandshakeAt || '').trim(),
        String(row?.lastFailureAt || '').trim(),
        String(row?.lastError || '').trim(),
        String(row?.updatedAt || nowIso()),
      );
    });
    threads.forEach((row) => {
      upsertThread.run(
        String(row?.selfWalletId || '').trim(),
        String(row?.peerWalletId || '').trim(),
        String(row?.threadId || '').trim(),
        String(row?.displayName || '').trim(),
        Math.max(0, Number(row?.unreadCount || 0)),
        String(row?.lastMessageId || '').trim(),
        String(row?.lastMessageAt || '').trim(),
        String(row?.lastMessagePreview || '').trim(),
        String(row?.lastTransport || '').trim(),
        String(row?.lastReadAt || '').trim(),
        Math.max(0, Number(row?.lastEventSeq || 0)),
        String(row?.updatedAt || nowIso()),
      );
    });
    messages.forEach((row) => {
      upsertMessage.run(
        String(row?.selfWalletId || '').trim(),
        String(row?.peerWalletId || '').trim(),
        String(row?.msgId || '').trim(),
        String(row?.threadId || '').trim(),
        String(row?.direction || '').trim(),
        String(row?.transport || '').trim(),
        String(row?.text || '').trim(),
        String(row?.orderId || '').trim(),
        String(row?.ts || '').trim(),
        String(row?.status || '').trim(),
        String(row?.txid || '').trim(),
        Math.max(0, Number(row?.sourceEventSeq || 0)),
        String(row?.updatedAt || nowIso()),
      );
    });
    deleteMessageKeys.forEach((row) => {
      deleteMessage.run(
        String(row?.selfWalletId || '').trim(),
        String(row?.peerWalletId || '').trim(),
        String(row?.msgId || '').trim(),
      );
    });
    deleteThreadKeys.forEach((row) => {
      const selfWalletId = String(row?.selfWalletId || '').trim();
      const peerWalletId = String(row?.peerWalletId || '').trim();
      deleteThreadMessages.run(selfWalletId, peerWalletId);
      deleteThreadPresence.run(selfWalletId, peerWalletId);
      deleteThreadStatus.run(selfWalletId, peerWalletId);
    });

    const affectedSelfWalletIds = new Set([
      ...selfStates.map((row) => String(row?.selfWalletId || '').trim()),
      ...contacts.map((row) => String(row?.selfWalletId || '').trim()),
      ...threads.map((row) => String(row?.selfWalletId || '').trim()),
      ...messages.map((row) => String(row?.selfWalletId || '').trim()),
    ].filter(Boolean));
    const selectStorageLimit = db.prepare(`
      SELECT storage_limit_bytes
      FROM chat_self_state_projection
      WHERE self_wallet_id = ?
    `);
    const selectMessagesForBudget = db.prepare(`
      SELECT self_wallet_id, peer_wallet_id, msg_id, text, ts
      FROM chat_message_index_projection
      WHERE self_wallet_id = ?
      ORDER BY ts ASC, msg_id ASC
    `);
    for (const selfWalletId of affectedSelfWalletIds) {
      const limitRow = selectStorageLimit.get(selfWalletId) || null;
      const limitBytes = Math.max(1024, Number(limitRow?.storage_limit_bytes || storageLimitBytes || 104857600));
      const rows = selectMessagesForBudget.all(selfWalletId);
      let totalBytes = rows.reduce((sum, row) => sum + Buffer.byteLength(String(row?.text || ''), 'utf8'), 0);
      const targetBytes = Math.max(0, limitBytes - Math.min(limitBytes, 10 * 1024 * 1024));
      for (const row of rows) {
        if (totalBytes <= limitBytes) break;
        deleteMessage.run(
          String(row?.self_wallet_id || '').trim(),
          String(row?.peer_wallet_id || '').trim(),
          String(row?.msg_id || '').trim(),
        );
        totalBytes -= Buffer.byteLength(String(row?.text || ''), 'utf8');
        if (totalBytes <= targetBytes) break;
      }
    }
  });
  return {
    bindingCount: bindings.length,
    selfStateCount: selfStates.length,
    contactCount: contacts.length,
    presenceCount: presences.length,
    threadCount: threads.length,
    messageCount: messages.length,
    deletedMessageCount: deleteMessageKeys.length,
    deletedThreadCount: deleteThreadKeys.length,
  };
}

function applySyncProjectionBatch(payload = {}) {
  const jobState = payload?.jobState && typeof payload.jobState === 'object' ? payload.jobState : null;
  const syncState = payload?.syncState && typeof payload.syncState === 'object' ? payload.syncState : null;
  const commands = Array.isArray(payload.commands) ? payload.commands : [];
  const upsertJobState = db.prepare(`
    INSERT INTO sync_job_state_projection (
      scope, current_job_json, recent_jobs_json, last_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      current_job_json = excluded.current_job_json,
      recent_jobs_json = excluded.recent_jobs_json,
      last_event_seq = excluded.last_event_seq,
      updated_at = excluded.updated_at
  `);
  const upsertCommand = db.prepare(`
    INSERT INTO sync_command_projection (
      command_id, command_type, payload_json, result_json, status,
      created_at, claimed_at, finished_at, worker_id, error, source_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(command_id) DO UPDATE SET
      command_type = excluded.command_type,
      payload_json = excluded.payload_json,
      result_json = excluded.result_json,
      status = excluded.status,
      created_at = excluded.created_at,
      claimed_at = excluded.claimed_at,
      finished_at = excluded.finished_at,
      worker_id = excluded.worker_id,
      error = excluded.error,
      source_event_seq = excluded.source_event_seq,
      updated_at = excluded.updated_at
  `);
  const upsertSync = db.prepare(`
    INSERT INTO sync_state (
      scope, bootstrap_height, local_height, fixed_sync_last_height,
      p2p_tip_height, p2p_tip_hash, p2p_header_cursor_height, p2p_header_cursor_hash,
      online, mode, lag, session_epoch, scanned_from, initial_sync_completed,
      manual_quickstart_pending, retries, last_p2p_forward_probe_at, last_p2p_advance_at,
      last_p2p_good_nodes, empty_backfill_tried, chain_sources_json, source_stats_json,
      p2p_height_hash_cache_json, p2p_gap_heights_json, p2p_node_stats_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      bootstrap_height = excluded.bootstrap_height,
      local_height = excluded.local_height,
      fixed_sync_last_height = excluded.fixed_sync_last_height,
      p2p_tip_height = excluded.p2p_tip_height,
      p2p_tip_hash = excluded.p2p_tip_hash,
      p2p_header_cursor_height = excluded.p2p_header_cursor_height,
      p2p_header_cursor_hash = excluded.p2p_header_cursor_hash,
      online = excluded.online,
      mode = excluded.mode,
      lag = excluded.lag,
      session_epoch = excluded.session_epoch,
      scanned_from = excluded.scanned_from,
      initial_sync_completed = excluded.initial_sync_completed,
      manual_quickstart_pending = excluded.manual_quickstart_pending,
      retries = excluded.retries,
      last_p2p_forward_probe_at = excluded.last_p2p_forward_probe_at,
      last_p2p_advance_at = excluded.last_p2p_advance_at,
      last_p2p_good_nodes = excluded.last_p2p_good_nodes,
      empty_backfill_tried = excluded.empty_backfill_tried,
      chain_sources_json = excluded.chain_sources_json,
      source_stats_json = excluded.source_stats_json,
      p2p_height_hash_cache_json = excluded.p2p_height_hash_cache_json,
      p2p_gap_heights_json = excluded.p2p_gap_heights_json,
      p2p_node_stats_json = excluded.p2p_node_stats_json,
      updated_at = excluded.updated_at
  `);
  withTransaction(() => {
    if (syncState) {
      upsertSync.run(
        String(syncState.scope || 'main').trim(),
        Math.max(0, Number(syncState.bootstrapHeight || 0)),
        Math.max(0, Number(syncState.localHeight || 0)),
        Math.max(0, Number(syncState.fixedSyncLastHeight || 0)),
        Math.max(0, Number(syncState.p2pTipHeight || 0)),
        String(syncState.p2pTipHash || '').trim(),
        Number.isFinite(Number(syncState.p2pHeaderCursorHeight)) ? Number(syncState.p2pHeaderCursorHeight) : -1,
        String(syncState.p2pHeaderCursorHash || '').trim(),
        syncState.online === true ? 1 : 0,
        String(syncState.mode || '').trim(),
        Math.max(0, Number(syncState.lag || 0)),
        Math.max(0, Number(syncState.sessionEpoch || 0)),
        Math.max(0, Number(syncState.scannedFrom || 0)),
        syncState.initialSyncCompleted === true ? 1 : 0,
        syncState.manualQuickstartPending === true ? 1 : 0,
        Math.max(0, Number(syncState.retries || 0)),
        String(syncState.lastP2PForwardProbeAt || '').trim(),
        String(syncState.lastP2PAdvanceAt || '').trim(),
        Math.max(0, Number(syncState.lastP2PGoodNodes || 0)),
        syncState.emptyBackfillTried === true ? 1 : 0,
        JSON.stringify(Array.isArray(syncState.chainSources) ? syncState.chainSources : []),
        JSON.stringify(syncState.sourceStats && typeof syncState.sourceStats === 'object' ? syncState.sourceStats : {}),
        JSON.stringify(syncState.p2pHeightHashCache && typeof syncState.p2pHeightHashCache === 'object' ? syncState.p2pHeightHashCache : {}),
        JSON.stringify(Array.isArray(syncState.p2pGapHeights) ? syncState.p2pGapHeights : []),
        JSON.stringify(syncState.p2pNodeStats && typeof syncState.p2pNodeStats === 'object' ? syncState.p2pNodeStats : {}),
        String(syncState.updatedAt || nowIso()),
      );
    }
    if (jobState) {
      upsertJobState.run(
        String(jobState.scope || 'main').trim(),
        JSON.stringify(jobState.currentJob && typeof jobState.currentJob === 'object' ? jobState.currentJob : null),
        JSON.stringify(Array.isArray(jobState.recentJobs) ? jobState.recentJobs : []),
        Math.max(0, Number(jobState.lastEventSeq || 0)),
        String(jobState.updatedAt || nowIso()),
      );
    }
    commands.forEach((row) => {
      upsertCommand.run(
        String(row?.id || '').trim(),
        String(row?.commandType || '').trim(),
        JSON.stringify(row?.payload && typeof row.payload === 'object' ? row.payload : {}),
        JSON.stringify(row?.result && typeof row.result === 'object' ? row.result : null),
        String(row?.status || 'pending').trim(),
        String(row?.createdAt || '').trim(),
        String(row?.claimedAt || '').trim(),
        String(row?.finishedAt || '').trim(),
        String(row?.workerId || '').trim(),
        String(row?.error || '').trim(),
        Math.max(0, Number(row?.sourceEventSeq || 0)),
        String(row?.updatedAt || nowIso()),
      );
    });
  });
  return {
    commandCount: commands.length,
    hasJobState: Boolean(jobState),
    hasSyncState: Boolean(syncState),
  };
}

function applyWalletTxProjectionBatch(payload = {}) {
  const reservations = Array.isArray(payload.reservations) ? payload.reservations : [];
  const outpointRows = Array.isArray(payload.outpointRows) ? payload.outpointRows : [];
  const deleteReservationIds = Array.isArray(payload.deleteReservationIds) ? payload.deleteReservationIds : [];
  const resetAll = payload?.resetAll === true;
  const upsertReservation = db.prepare(`
    INSERT INTO wallet_tx_reservation_projection (
      reservation_id, reservation_type, owner_id, txid, status,
      outpoints_json, last_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reservation_id) DO UPDATE SET
      reservation_type = excluded.reservation_type,
      owner_id = excluded.owner_id,
      txid = excluded.txid,
      status = excluded.status,
      outpoints_json = excluded.outpoints_json,
      last_event_seq = excluded.last_event_seq,
      updated_at = excluded.updated_at
  `);
  const deleteOutpointsForReservation = db.prepare(`
    DELETE FROM wallet_outpoint_reservation_projection
    WHERE reservation_id = ?
  `);
  const upsertOutpoint = db.prepare(`
    INSERT INTO wallet_outpoint_reservation_projection (
      reservation_id, outpoint, reservation_type, owner_id, txid,
      status, last_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(reservation_id, outpoint) DO UPDATE SET
      reservation_type = excluded.reservation_type,
      owner_id = excluded.owner_id,
      txid = excluded.txid,
      status = excluded.status,
      last_event_seq = excluded.last_event_seq,
      updated_at = excluded.updated_at
  `);
  const deleteReservation = db.prepare(`
    DELETE FROM wallet_tx_reservation_projection
    WHERE reservation_id = ?
  `);
  withTransaction(() => {
    if (resetAll) {
      db.prepare('DELETE FROM wallet_outpoint_reservation_projection').run();
      db.prepare('DELETE FROM wallet_tx_reservation_projection').run();
    }
    deleteReservationIds.forEach((reservationId) => {
      const safeId = String(reservationId || '').trim();
      if (!safeId) return;
      deleteOutpointsForReservation.run(safeId);
      deleteReservation.run(safeId);
    });
    reservations.forEach((row) => {
      const reservationId = String(row?.reservationId || '').trim();
      if (!reservationId) return;
      upsertReservation.run(
        reservationId,
        String(row?.reservationType || '').trim(),
        String(row?.ownerId || '').trim(),
        String(row?.txid || '').trim(),
        String(row?.status || 'active').trim(),
        JSON.stringify(Array.isArray(row?.outpoints) ? row.outpoints : []),
        Math.max(0, Number(row?.lastEventSeq || 0)),
        String(row?.updatedAt || nowIso()),
      );
      deleteOutpointsForReservation.run(reservationId);
    });
    outpointRows.forEach((row) => {
      const reservationId = String(row?.reservationId || '').trim();
      const outpoint = String(row?.outpoint || '').trim().toLowerCase();
      if (!reservationId || !outpoint) return;
      upsertOutpoint.run(
        reservationId,
        outpoint,
        String(row?.reservationType || '').trim(),
        String(row?.ownerId || '').trim(),
        String(row?.txid || '').trim(),
        String(row?.status || 'active').trim(),
        Math.max(0, Number(row?.lastEventSeq || 0)),
        String(row?.updatedAt || nowIso()),
      );
    });
  });
  return {
    reservationCount: reservations.length,
    outpointCount: outpointRows.length,
    deletedReservationCount: deleteReservationIds.length,
    resetAll,
  };
}

function applyWalletReadProjectionBatch(payload = {}) {
  const indexStatus = payload?.indexStatus && typeof payload.indexStatus === 'object' ? payload.indexStatus : null;
  const readModel = payload?.readModel && typeof payload.readModel === 'object' ? payload.readModel : null;
  const historyItems = Array.isArray(payload.historyItems) ? payload.historyItems : [];
  const deleteWalletKeys = Array.isArray(payload.deleteWalletKeys) ? payload.deleteWalletKeys : [];
  const upsertIndexStatus = db.prepare(`
    INSERT INTO wallet_index_status_projection (
      wallet_key, wallet_scan_cursor_height, wallet_relevant_tx_count, wallet_utxo_count,
      context_ready_count, beef_ready_utxo_count, send_preflight_status,
      sync_progress_active, sync_progress_stage, sync_progress_message, sync_progress_error, last_indexed_at,
      recent_rawtx_count, recent_rawtx_latest_txid, recent_rawtx_latest_ts, source,
      last_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wallet_key) DO UPDATE SET
      wallet_scan_cursor_height = excluded.wallet_scan_cursor_height,
      wallet_relevant_tx_count = excluded.wallet_relevant_tx_count,
      wallet_utxo_count = excluded.wallet_utxo_count,
      context_ready_count = excluded.context_ready_count,
      beef_ready_utxo_count = excluded.beef_ready_utxo_count,
      send_preflight_status = excluded.send_preflight_status,
      sync_progress_active = excluded.sync_progress_active,
      sync_progress_stage = excluded.sync_progress_stage,
      sync_progress_message = excluded.sync_progress_message,
      sync_progress_error = excluded.sync_progress_error,
      last_indexed_at = excluded.last_indexed_at,
      recent_rawtx_count = excluded.recent_rawtx_count,
      recent_rawtx_latest_txid = excluded.recent_rawtx_latest_txid,
      recent_rawtx_latest_ts = excluded.recent_rawtx_latest_ts,
      source = excluded.source,
      last_event_seq = excluded.last_event_seq,
      updated_at = excluded.updated_at
  `);
  const upsertReadModel = db.prepare(`
    INSERT INTO wallet_read_model_projection (
      wallet_key, receive_address, confirmed, unconfirmed, pending_delta,
      income_sat, expense_sat, total, total_bsv, balance_updated_at,
      source, last_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wallet_key) DO UPDATE SET
      receive_address = excluded.receive_address,
      confirmed = excluded.confirmed,
      unconfirmed = excluded.unconfirmed,
      pending_delta = excluded.pending_delta,
      income_sat = excluded.income_sat,
      expense_sat = excluded.expense_sat,
      total = excluded.total,
      total_bsv = excluded.total_bsv,
      balance_updated_at = excluded.balance_updated_at,
      source = excluded.source,
      last_event_seq = excluded.last_event_seq,
      updated_at = excluded.updated_at
  `);
  const deleteIndexStatus = db.prepare(`
    DELETE FROM wallet_index_status_projection
    WHERE wallet_key = ?
  `);
  const deleteReadModel = db.prepare(`
    DELETE FROM wallet_read_model_projection
    WHERE wallet_key = ?
  `);
  const deleteHistoryForWallet = db.prepare(`
    DELETE FROM wallet_history_projection
    WHERE wallet_key = ?
  `);
  const upsertHistory = db.prepare(`
    INSERT INTO wallet_history_projection (
      wallet_key, txid, note, noted_at, confirmed, net_sat,
      last_seen_at, sort_index, source_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wallet_key, txid) DO UPDATE SET
      note = excluded.note,
      noted_at = excluded.noted_at,
      confirmed = excluded.confirmed,
      net_sat = excluded.net_sat,
      last_seen_at = excluded.last_seen_at,
      sort_index = excluded.sort_index,
      source_event_seq = excluded.source_event_seq,
      updated_at = excluded.updated_at
  `);
  withTransaction(() => {
    deleteWalletKeys.forEach((walletKey) => {
      const safeWalletKey = String(walletKey || '').trim();
      if (!safeWalletKey) return;
      deleteIndexStatus.run(safeWalletKey);
      deleteReadModel.run(safeWalletKey);
      deleteHistoryForWallet.run(safeWalletKey);
    });
    if (indexStatus && String(indexStatus.walletKey || '').trim()) {
      upsertIndexStatus.run(
        String(indexStatus.walletKey || '').trim(),
        Math.max(0, Number(indexStatus.walletScanCursorHeight || 0)),
        Math.max(0, Number(indexStatus.walletRelevantTxCount || 0)),
        Math.max(0, Number(indexStatus.walletUtxoCount || 0)),
        Math.max(0, Number(indexStatus.contextReadyCount || 0)),
        Math.max(0, Number(indexStatus.beefReadyUtxoCount || 0)),
        String(indexStatus.sendPreflightStatus || 'unknown').trim(),
        indexStatus.syncProgressActive === true ? 1 : 0,
        String(indexStatus.syncProgressStage || 'idle').trim(),
        String(indexStatus.syncProgressMessage || '').trim(),
        String(indexStatus.syncProgressError || '').trim(),
        String(indexStatus.lastIndexedAt || '').trim(),
        Math.max(0, Number(indexStatus.recentRawtxCount || 0)),
        String(indexStatus.recentRawtxLatestTxid || '').trim(),
        String(indexStatus.recentRawtxLatestTs || '').trim(),
        String(indexStatus.source || '').trim(),
        Math.max(0, Number(indexStatus.lastEventSeq || 0)),
        String(indexStatus.updatedAt || nowIso()),
      );
    }
    if (readModel && String(readModel.walletKey || '').trim()) {
      const walletKey = String(readModel.walletKey || '').trim();
      upsertReadModel.run(
        walletKey,
        String(readModel.receiveAddress || '').trim(),
        Math.trunc(Number(readModel.confirmed || 0)),
        Math.trunc(Number(readModel.unconfirmed || 0)),
        Math.trunc(Number(readModel.pendingDelta || 0)),
        Math.trunc(Number(readModel.incomeSat || 0)),
        Math.trunc(Number(readModel.expenseSat || 0)),
        Math.trunc(Number(readModel.total || 0)),
        Number(readModel.totalBsv || 0),
        String(readModel.balanceUpdatedAt || '').trim(),
        String(readModel.source || '').trim(),
        Math.max(0, Number(readModel.lastEventSeq || 0)),
        String(readModel.updatedAt || nowIso()),
      );
      deleteHistoryForWallet.run(walletKey);
      historyItems.forEach((row, index) => {
        if (String(row?.walletKey || '').trim() !== walletKey) return;
        const txid = String(row?.txid || '').trim();
        if (!txid) return;
        upsertHistory.run(
          walletKey,
          txid,
          String(row?.note || '').trim(),
          String(row?.notedAt || '').trim(),
          row?.confirmed === true ? 1 : 0,
          Math.trunc(Number(row?.netSat || 0)),
          String(row?.lastSeenAt || '').trim(),
          Math.max(0, Number(row?.sortIndex ?? index)),
          Math.max(0, Number(row?.sourceEventSeq || 0)),
          String(row?.updatedAt || nowIso()),
        );
      });
    }
  });
  return {
    hasIndexStatus: Boolean(indexStatus),
    hasReadModel: Boolean(readModel),
    historyCount: historyItems.length,
    deletedWalletCount: deleteWalletKeys.length,
  };
}

function applyBhsProjectionBatch(payload = {}) {
  const status = payload?.status && typeof payload.status === 'object' ? payload.status : null;
  if (!status) return { hasStatus: false };
  db.prepare(`
    INSERT INTO bhs_status_projection (
      scope, ok, checkpoint_height, checkpoint_hash, tip_height,
      tip_hash, header_count, headers_json, last_round_json, last_event_seq, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      ok = excluded.ok,
      checkpoint_height = excluded.checkpoint_height,
      checkpoint_hash = excluded.checkpoint_hash,
      tip_height = excluded.tip_height,
      tip_hash = excluded.tip_hash,
      header_count = excluded.header_count,
      headers_json = excluded.headers_json,
      last_round_json = excluded.last_round_json,
      last_event_seq = excluded.last_event_seq,
      updated_at = excluded.updated_at
  `).run(
    String(status.scope || 'main').trim(),
    status.ok === true ? 1 : 0,
    Math.max(0, Number(status.checkpointHeight || 0)),
    String(status.checkpointHash || '').trim(),
    Math.max(0, Number(status.tipHeight || 0)),
    String(status.tipHash || '').trim(),
    Math.max(0, Number(status.headerCount || 0)),
    JSON.stringify(status.headers && typeof status.headers === 'object' ? status.headers : {}),
    JSON.stringify(status.lastRound && typeof status.lastRound === 'object' ? status.lastRound : {}),
    Math.max(0, Number(status.lastEventSeq || 0)),
    String(status.updatedAt || nowIso()),
  );
  return { hasStatus: true };
}

function applyOrderProjectionBatch(payload = {}) {
  const orders = Array.isArray(payload.orders) ? payload.orders : [];
  const resetAll = payload?.resetAll === true;
  const upsertOrder = db.prepare(`
    INSERT INTO order_projection (
      order_id, status, snapshot_json, funds_json, transition_ids_json,
      tip, updated_at, last_event_seq, payload_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      status = excluded.status,
      snapshot_json = excluded.snapshot_json,
      funds_json = excluded.funds_json,
      transition_ids_json = excluded.transition_ids_json,
      tip = excluded.tip,
      updated_at = excluded.updated_at,
      last_event_seq = excluded.last_event_seq,
      payload_json = excluded.payload_json
  `);
  withTransaction(() => {
    if (resetAll) {
      db.prepare('DELETE FROM order_projection').run();
    }
    orders.forEach((row) => {
      const orderId = String(row?.id || row?.orderId || '').trim();
      if (!orderId) return;
      upsertOrder.run(
        orderId,
        String(row?.status || '').trim(),
        JSON.stringify(row?.snapshot && typeof row.snapshot === 'object' ? row.snapshot : {}),
        JSON.stringify(row?.funds && typeof row.funds === 'object' ? row.funds : {}),
        JSON.stringify(Array.isArray(row?.transitionIds) ? row.transitionIds : []),
        String(row?.tip || '').trim(),
        String(row?.updatedAt || nowIso()),
        Math.max(0, Number(row?.lastEventSeq || 0)),
        JSON.stringify(row && typeof row === 'object' ? row : {}),
      );
    });
  });
  return { orderCount: orders.length, resetAll };
}

function applyLocalStateProjectionBatch(payload = {}) {
  const scope = String(payload.scope || 'main').trim() || 'main';
  const seq = Math.max(1, Number(payload.seq || 1));
  const lastEventSeq = Math.max(0, Number(payload.lastEventSeq || 0));
  const updatedAt = String(payload.updatedAt || nowIso());
  const localChanges = Array.isArray(payload.localChanges) ? payload.localChanges : [];
  const recentRawtxs = Array.isArray(payload.recentRawtxs) ? payload.recentRawtxs : [];
  const rawPendingAnchors = Array.isArray(payload.pendingAnchors) ? payload.pendingAnchors : [];
  const pendingAnchorByKey = new Map();
  rawPendingAnchors.forEach((row) => {
    const key = String(row?.anchorKey || row?.txid || '').trim()
      || crypto.createHash('sha1').update(JSON.stringify(row || {})).digest('hex');
    if (!key) return;
    pendingAnchorByKey.set(key, { ...(row || {}), anchorKey: key });
  });
  const pendingAnchors = Array.from(pendingAnchorByKey.values());
  const upsertMeta = db.prepare(`
    INSERT INTO local_change_meta_projection(scope, seq, updated_at, last_event_seq)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      seq = excluded.seq,
      updated_at = excluded.updated_at,
      last_event_seq = excluded.last_event_seq
  `);
  const insertLocalChange = db.prepare(`
    INSERT INTO local_change_projection(
      change_id, seq, event_type, payload_json, target_type, target_id,
      status, txid, ts, updated_at, source_event_seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRecentRawtx = db.prepare(`
    INSERT INTO recent_rawtx_projection(
      txid, ts, event_type, note, rawtx, updated_at, source_event_seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertPendingAnchor = db.prepare(`
    INSERT INTO pending_anchor_projection(
      anchor_key, ts, txid, event_type, payload_json, node, confirmed,
      height, updated_at, source_event_seq
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(anchor_key) DO UPDATE SET
      ts = excluded.ts,
      txid = excluded.txid,
      event_type = excluded.event_type,
      payload_json = excluded.payload_json,
      node = excluded.node,
      confirmed = excluded.confirmed,
      height = excluded.height,
      updated_at = excluded.updated_at,
      source_event_seq = excluded.source_event_seq
  `);
  withTransaction(() => {
    db.prepare('DELETE FROM local_change_projection').run();
    db.prepare('DELETE FROM recent_rawtx_projection').run();
    db.prepare('DELETE FROM pending_anchor_projection').run();
    upsertMeta.run(scope, seq, updatedAt, lastEventSeq);
    localChanges.forEach((row) => {
      const changeId = String(row?.id || '').trim();
      if (!changeId) return;
      insertLocalChange.run(
        changeId,
        Math.max(0, Number(row?.seq || 0)),
        String(row?.eventType || '').trim(),
        JSON.stringify(row?.payload && typeof row.payload === 'object' ? row.payload : {}),
        String(row?.targetType || '').trim(),
        String(row?.targetId || '').trim(),
        String(row?.status || 'pending').trim(),
        String(row?.txid || '').trim(),
        String(row?.ts || '').trim(),
        String(row?.updatedAt || row?.ts || updatedAt).trim(),
        lastEventSeq,
      );
    });
    recentRawtxs.forEach((row) => {
      const txid = String(row?.txid || '').trim().toLowerCase();
      if (!txid) return;
      insertRecentRawtx.run(
        txid,
        String(row?.ts || '').trim(),
        String(row?.eventType || '').trim(),
        String(row?.note || '').trim(),
        String(row?.rawtx || '').trim(),
        String(row?.updatedAt || row?.ts || updatedAt).trim(),
        lastEventSeq,
      );
    });
    pendingAnchors.forEach((row) => {
      const key = String(row?.anchorKey || row?.txid || '').trim();
      if (!key) return;
      insertPendingAnchor.run(
        key,
        String(row?.ts || '').trim(),
        String(row?.txid || '').trim().toLowerCase(),
        String(row?.eventType || '').trim(),
        JSON.stringify(row?.payload && typeof row.payload === 'object' ? row.payload : {}),
        String(row?.node || '').trim(),
        row?.confirmed === true ? 1 : 0,
        Math.max(0, Number(row?.height || 0)),
        String(row?.updatedAt || row?.ts || updatedAt).trim(),
        lastEventSeq,
      );
    });
  });
  return {
    scope,
    seq,
    localChangeCount: localChanges.length,
    recentRawtxCount: recentRawtxs.length,
    pendingAnchorCount: pendingAnchors.length,
  };
}

function getLocalStateProjection(payload = {}) {
  const scope = String(payload.scope || 'main').trim() || 'main';
  const meta = db.prepare(`
    SELECT scope, seq, updated_at, last_event_seq
    FROM local_change_meta_projection
    WHERE scope = ?
    LIMIT 1
  `).get(scope);
  const localChanges = db.prepare(`
    SELECT change_id, seq, event_type, payload_json, target_type, target_id,
      status, txid, ts, updated_at, source_event_seq
    FROM local_change_projection
    ORDER BY seq ASC, change_id ASC
  `).all().map((row) => {
    let payloadJson = {};
    try { payloadJson = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
    return {
      id: String(row.change_id || ''),
      seq: Math.max(0, Number(row.seq || 0)),
      eventType: String(row.event_type || ''),
      payload: payloadJson && typeof payloadJson === 'object' ? payloadJson : {},
      targetType: String(row.target_type || ''),
      targetId: String(row.target_id || ''),
      status: String(row.status || ''),
      txid: String(row.txid || ''),
      ts: String(row.ts || ''),
      updatedAt: String(row.updated_at || ''),
      sourceEventSeq: Math.max(0, Number(row.source_event_seq || 0)),
    };
  });
  const recentRawtxs = db.prepare(`
    SELECT txid, ts, event_type, note, rawtx, updated_at, source_event_seq
    FROM recent_rawtx_projection
    ORDER BY ts ASC, txid ASC
  `).all().map((row) => ({
    txid: String(row.txid || ''),
    ts: String(row.ts || ''),
    eventType: String(row.event_type || ''),
    note: String(row.note || ''),
    rawtx: String(row.rawtx || ''),
    updatedAt: String(row.updated_at || ''),
    sourceEventSeq: Math.max(0, Number(row.source_event_seq || 0)),
  }));
  const pendingAnchors = db.prepare(`
    SELECT anchor_key, ts, txid, event_type, payload_json, node, confirmed,
      height, updated_at, source_event_seq
    FROM pending_anchor_projection
    ORDER BY ts ASC, txid ASC, anchor_key ASC
  `).all().map((row) => {
    let payloadJson = {};
    try { payloadJson = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
    return {
      anchorKey: String(row.anchor_key || ''),
      ts: String(row.ts || ''),
      txid: String(row.txid || ''),
      eventType: String(row.event_type || ''),
      payload: payloadJson && typeof payloadJson === 'object' ? payloadJson : {},
      node: String(row.node || ''),
      confirmed: Number(row.confirmed || 0) === 1,
      height: Math.max(0, Number(row.height || 0)),
      updatedAt: String(row.updated_at || ''),
      sourceEventSeq: Math.max(0, Number(row.source_event_seq || 0)),
    };
  });
  return {
    scope,
    seq: Math.max(1, Number(meta?.seq || 1)),
    updatedAt: String(meta?.updated_at || ''),
    lastEventSeq: Math.max(0, Number(meta?.last_event_seq || 0)),
    localChanges,
    recentRawtxs,
    pendingAnchors,
  };
}

function listChatPresenceProjection(payload = {}) {
  const selfWalletId = String(payload.selfWalletId || '').trim();
  return db.prepare(`
    SELECT
      self_wallet_id,
      peer_wallet_id,
      status,
      last_event_seq,
      last_event_type,
      last_seen_at,
      last_handshake_at,
      last_failure_at,
      last_error,
      updated_at
    FROM chat_presence_projection
    WHERE self_wallet_id = ?
    ORDER BY peer_wallet_id ASC
  `).all(selfWalletId).map((row) => ({
    selfWalletId: String(row.self_wallet_id || ''),
    peerWalletId: String(row.peer_wallet_id || ''),
    status: String(row.status || 'offline'),
    lastEventSeq: Math.max(0, Number(row.last_event_seq || 0)),
    lastEventType: String(row.last_event_type || ''),
    lastSeenAt: String(row.last_seen_at || ''),
    lastHandshakeAt: String(row.last_handshake_at || ''),
    lastFailureAt: String(row.last_failure_at || ''),
    lastError: String(row.last_error || ''),
    updatedAt: String(row.updated_at || ''),
  }));
}

function listChatThreadStatusProjection(payload = {}) {
  const selfWalletId = String(payload.selfWalletId || '').trim();
  const latestMessage = db.prepare(`
    SELECT
      msg_id,
      ts,
      text,
      transport,
      source_event_seq,
      updated_at
    FROM chat_message_index_projection
    WHERE self_wallet_id = ? AND peer_wallet_id = ?
    ORDER BY ts DESC, msg_id DESC
    LIMIT 1
  `);
  const rows = db.prepare(`
    SELECT
      self_wallet_id,
      peer_wallet_id,
      thread_id,
      display_name,
      unread_count,
      last_message_id,
      last_message_at,
      last_message_preview,
      last_transport,
      last_read_at,
      last_event_seq,
      updated_at
    FROM chat_thread_status_projection
    WHERE self_wallet_id = ?
    ORDER BY last_message_at DESC, peer_wallet_id ASC
  `).all(selfWalletId).map((row) => ({
    selfWalletId: String(row.self_wallet_id || ''),
    peerWalletId: String(row.peer_wallet_id || ''),
    threadId: String(row.thread_id || ''),
    displayName: String(row.display_name || ''),
    unreadCount: Math.max(0, Number(row.unread_count || 0)),
    lastMessageId: String(row.last_message_id || ''),
    lastMessageAt: String(row.last_message_at || ''),
    lastMessagePreview: String(row.last_message_preview || ''),
    lastTransport: String(row.last_transport || ''),
    lastReadAt: String(row.last_read_at || ''),
    lastEventSeq: Math.max(0, Number(row.last_event_seq || 0)),
    updatedAt: String(row.updated_at || ''),
  }));
  const repaired = rows.map((row) => {
    const latest = latestMessage.get(selfWalletId, row.peerWalletId);
    if (!latest) return row;
    const currentMs = Date.parse(String(row.lastMessageAt || '')) || 0;
    const latestMs = Date.parse(String(latest.ts || '')) || 0;
    const currentId = String(row.lastMessageId || '');
    const latestId = String(latest.msg_id || '');
    const isNewer = latestMs > currentMs || (latestMs === currentMs && latestId && currentId && latestId.localeCompare(currentId) > 0);
    if (!isNewer) return row;
    return {
      ...row,
      lastMessageId: latestId,
      lastMessageAt: String(latest.ts || row.lastMessageAt || ''),
      lastMessagePreview: String(latest.text || row.lastMessagePreview || '').slice(0, 280),
      lastTransport: String(latest.transport || row.lastTransport || ''),
      lastEventSeq: Math.max(row.lastEventSeq || 0, Number(latest.source_event_seq || 0)),
      updatedAt: String(latest.updated_at || row.updatedAt || ''),
    };
  });
  repaired.sort((a, b) => {
    const ta = Date.parse(String(a.lastMessageAt || '')) || 0;
    const tb = Date.parse(String(b.lastMessageAt || '')) || 0;
    if (ta !== tb) return tb - ta;
    return String(a.peerWalletId || '').localeCompare(String(b.peerWalletId || ''));
  });
  return repaired;
}

function listChatMessageIndexProjection(payload = {}) {
  const selfWalletId = String(payload.selfWalletId || '').trim();
  const peerWalletId = String(payload.peerWalletId || '').trim();
  const pageSize = Math.max(1, Math.min(100, Number(payload.pageSize || 10)));
  const page = Math.max(1, Number(payload.page || 1));
  const offset = (page - 1) * pageSize;
  return db.prepare(`
    SELECT
      self_wallet_id,
      peer_wallet_id,
      msg_id,
      thread_id,
      direction,
      transport,
      text,
      order_id,
      ts,
      status,
      txid,
      source_event_seq,
      updated_at
    FROM (
      SELECT
        self_wallet_id,
        peer_wallet_id,
        msg_id,
        thread_id,
        direction,
        transport,
        text,
        order_id,
        ts,
        status,
        txid,
        source_event_seq,
        updated_at
      FROM chat_message_index_projection
      WHERE self_wallet_id = ? AND peer_wallet_id = ?
      ORDER BY ts DESC, source_event_seq DESC, msg_id DESC
      LIMIT ? OFFSET ?
    )
    ORDER BY ts ASC, source_event_seq ASC, msg_id ASC
  `).all(selfWalletId, peerWalletId, pageSize, offset).map((row) => ({
    selfWalletId: String(row.self_wallet_id || ''),
    peerWalletId: String(row.peer_wallet_id || ''),
    msgId: String(row.msg_id || ''),
    threadId: String(row.thread_id || ''),
    direction: String(row.direction || ''),
    transport: String(row.transport || ''),
    text: String(row.text || ''),
    orderId: String(row.order_id || ''),
    ts: String(row.ts || ''),
    status: String(row.status || ''),
    txid: String(row.txid || ''),
    sourceEventSeq: Math.max(0, Number(row.source_event_seq || 0)),
    updatedAt: String(row.updated_at || ''),
  }));
}

function listChatContactProjection(payload = {}) {
  const selfWalletId = String(payload.selfWalletId || '').trim();
  return db.prepare(`
    SELECT
      self_wallet_id,
      peer_wallet_id,
      is_friend,
      friend_status,
      blocked,
      updated_at
    FROM chat_contact_projection
    WHERE self_wallet_id = ?
    ORDER BY is_friend DESC, updated_at DESC, peer_wallet_id ASC
  `).all(selfWalletId).map((row) => ({
    selfWalletId: String(row.self_wallet_id || ''),
    peerWalletId: String(row.peer_wallet_id || ''),
    isFriend: Number(row.is_friend || 0) === 1,
    friendStatus: String(row.friend_status || 'none'),
    blocked: Number(row.blocked || 0) === 1,
    updatedAt: String(row.updated_at || ''),
  }));
}

function getChatSelfStateProjection(payload = {}) {
  const selfWalletId = String(payload.selfWalletId || '').trim();
  const row = db.prepare(`
    SELECT
      self_wallet_id,
      online,
      storage_limit_bytes,
      updated_at
    FROM chat_self_state_projection
    WHERE self_wallet_id = ?
  `).get(selfWalletId);
  return {
    selfWalletId,
    online: row ? Number(row.online || 0) === 1 : true,
    storageLimitBytes: row ? Math.max(1024, Number(row.storage_limit_bytes || 104857600)) : 104857600,
    updatedAt: row ? String(row.updated_at || '') : '',
  };
}

function listWalletTxReservationProjection() {
  return db.prepare(`
    SELECT
      reservation_id,
      reservation_type,
      owner_id,
      txid,
      status,
      outpoints_json,
      last_event_seq,
      updated_at
    FROM wallet_tx_reservation_projection
    ORDER BY updated_at ASC, reservation_id ASC
  `).all().map((row) => {
    let outpoints = [];
    try { outpoints = JSON.parse(String(row.outpoints_json || '[]')); } catch (_) {}
    return {
      reservationId: String(row.reservation_id || ''),
      reservationType: String(row.reservation_type || ''),
      ownerId: String(row.owner_id || ''),
      txid: String(row.txid || ''),
      status: String(row.status || ''),
      outpoints: Array.isArray(outpoints) ? outpoints.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean) : [],
      lastEventSeq: Math.max(0, Number(row.last_event_seq || 0)),
      updatedAt: String(row.updated_at || ''),
    };
  });
}

function listWalletOutpointReservationProjection(payload = {}) {
  const onlyActive = payload?.onlyActive !== false;
  const whereSql = onlyActive ? 'WHERE status = \'active\'' : '';
  return db.prepare(`
    SELECT
      reservation_id,
      outpoint,
      reservation_type,
      owner_id,
      txid,
      status,
      last_event_seq,
      updated_at
    FROM wallet_outpoint_reservation_projection
    ${whereSql}
    ORDER BY updated_at ASC, outpoint ASC
  `).all().map((row) => ({
    reservationId: String(row.reservation_id || ''),
    outpoint: String(row.outpoint || '').trim().toLowerCase(),
    reservationType: String(row.reservation_type || ''),
    ownerId: String(row.owner_id || ''),
    txid: String(row.txid || ''),
    status: String(row.status || ''),
    lastEventSeq: Math.max(0, Number(row.last_event_seq || 0)),
    updatedAt: String(row.updated_at || ''),
  }));
}

function getWalletIndexStatusProjection(payload = {}) {
  const walletKey = String(payload.walletKey || '').trim();
  if (!walletKey) return null;
  const row = db.prepare(`
    SELECT
      wallet_key,
      wallet_scan_cursor_height,
      wallet_relevant_tx_count,
      wallet_utxo_count,
      context_ready_count,
      beef_ready_utxo_count,
      send_preflight_status,
      sync_progress_active,
      sync_progress_stage,
      sync_progress_message,
      sync_progress_error,
      last_indexed_at,
      recent_rawtx_count,
      recent_rawtx_latest_txid,
      recent_rawtx_latest_ts,
      source,
      last_event_seq,
      updated_at
    FROM wallet_index_status_projection
    WHERE wallet_key = ?
    LIMIT 1
  `).get(walletKey);
  if (!row) return null;
  return {
    walletKey: String(row.wallet_key || ''),
    walletScanCursorHeight: Math.max(0, Number(row.wallet_scan_cursor_height || 0)),
    walletRelevantTxCount: Math.max(0, Number(row.wallet_relevant_tx_count || 0)),
    walletUtxoCount: Math.max(0, Number(row.wallet_utxo_count || 0)),
    contextReadyCount: Math.max(0, Number(row.context_ready_count || 0)),
    beefReadyUtxoCount: Math.max(0, Number(row.beef_ready_utxo_count || 0)),
    sendPreflightStatus: String(row.send_preflight_status || 'unknown'),
    syncProgressActive: Number(row.sync_progress_active || 0) === 1,
    syncProgressStage: String(row.sync_progress_stage || 'idle'),
    syncProgressMessage: String(row.sync_progress_message || ''),
    syncProgressError: String(row.sync_progress_error || ''),
    lastIndexedAt: String(row.last_indexed_at || ''),
    recentRawtxCount: Math.max(0, Number(row.recent_rawtx_count || 0)),
    recentRawtxLatestTxid: String(row.recent_rawtx_latest_txid || ''),
    recentRawtxLatestTs: String(row.recent_rawtx_latest_ts || ''),
    source: String(row.source || ''),
    lastEventSeq: Math.max(0, Number(row.last_event_seq || 0)),
    updatedAt: String(row.updated_at || ''),
  };
}

function getWalletReadModelProjection(payload = {}) {
  const walletKey = String(payload.walletKey || '').trim();
  if (!walletKey) return null;
  const row = db.prepare(`
    SELECT
      wallet_key,
      receive_address,
      confirmed,
      unconfirmed,
      pending_delta,
      income_sat,
      expense_sat,
      total,
      total_bsv,
      balance_updated_at,
      source,
      last_event_seq,
      updated_at
    FROM wallet_read_model_projection
    WHERE wallet_key = ?
    LIMIT 1
  `).get(walletKey);
  if (!row) return null;
  return {
    walletKey: String(row.wallet_key || ''),
    receiveAddress: String(row.receive_address || ''),
    confirmed: Number(row.confirmed || 0),
    unconfirmed: Number(row.unconfirmed || 0),
    pendingDelta: Number(row.pending_delta || 0),
    incomeSat: Number(row.income_sat || 0),
    expenseSat: Number(row.expense_sat || 0),
    total: Number(row.total || 0),
    totalBsv: Number(row.total_bsv || 0),
    balanceUpdatedAt: String(row.balance_updated_at || ''),
    source: String(row.source || ''),
    lastEventSeq: Math.max(0, Number(row.last_event_seq || 0)),
    updatedAt: String(row.updated_at || ''),
  };
}

function listWalletHistoryProjection(payload = {}) {
  const walletKey = String(payload.walletKey || '').trim();
  if (!walletKey) return [];
  return db.prepare(`
    SELECT
      wallet_key,
      txid,
      note,
      noted_at,
      confirmed,
      net_sat,
      last_seen_at,
      sort_index,
      source_event_seq,
      updated_at
    FROM wallet_history_projection
    WHERE wallet_key = ?
    ORDER BY sort_index ASC, updated_at DESC, txid ASC
  `).all(walletKey).map((row) => ({
    walletKey: String(row.wallet_key || ''),
    txid: String(row.txid || ''),
    note: String(row.note || ''),
    notedAt: String(row.noted_at || ''),
    confirmed: Number(row.confirmed || 0) === 1,
    netSat: Number(row.net_sat || 0),
    lastSeenAt: String(row.last_seen_at || ''),
    sortIndex: Math.max(0, Number(row.sort_index || 0)),
    sourceEventSeq: Math.max(0, Number(row.source_event_seq || 0)),
    updatedAt: String(row.updated_at || ''),
  }));
}

function getBhsStatusProjection(payload = {}) {
  const scope = String(payload.scope || 'main').trim();
  const row = db.prepare(`
    SELECT
      scope,
      ok,
      checkpoint_height,
      checkpoint_hash,
      tip_height,
      tip_hash,
      header_count,
      headers_json,
      last_round_json,
      last_event_seq,
      updated_at
    FROM bhs_status_projection
    WHERE scope = ?
    LIMIT 1
  `).get(scope);
  if (!row) return null;
  let headers = {};
  let lastRound = {};
  try { headers = JSON.parse(String(row.headers_json || '{}')); } catch (_) {}
  try { lastRound = JSON.parse(String(row.last_round_json || '{}')); } catch (_) {}
  return {
    scope: String(row.scope || 'main'),
    ok: Number(row.ok || 0) === 1,
    checkpointHeight: Math.max(0, Number(row.checkpoint_height || 0)),
    checkpointHash: String(row.checkpoint_hash || ''),
    tipHeight: Math.max(0, Number(row.tip_height || 0)),
    tipHash: String(row.tip_hash || ''),
    headerCount: Math.max(0, Number(row.header_count || 0)),
    headers: headers && typeof headers === 'object' ? headers : {},
    lastRound: lastRound && typeof lastRound === 'object' ? lastRound : {},
    lastEventSeq: Math.max(0, Number(row.last_event_seq || 0)),
    updatedAt: String(row.updated_at || ''),
  };
}

function listOrderProjection() {
  return db.prepare(`
    SELECT
      order_id,
      status,
      snapshot_json,
      funds_json,
      transition_ids_json,
      tip,
      updated_at,
      last_event_seq,
      payload_json
    FROM order_projection
    ORDER BY updated_at DESC, order_id ASC
  `).all().map((row) => {
    let snapshot = {};
    let funds = {};
    let transitionIds = [];
    let payloadJson = {};
    try { snapshot = JSON.parse(String(row.snapshot_json || '{}')); } catch (_) {}
    try { funds = JSON.parse(String(row.funds_json || '{}')); } catch (_) {}
    try { transitionIds = JSON.parse(String(row.transition_ids_json || '[]')); } catch (_) {}
    try { payloadJson = JSON.parse(String(row.payload_json || '{}')); } catch (_) {}
    return {
      ...payloadJson,
      id: String(row.order_id || ''),
      status: String(row.status || ''),
      snapshot: snapshot && typeof snapshot === 'object' ? snapshot : {},
      funds: funds && typeof funds === 'object' ? funds : {},
      transitionIds: Array.isArray(transitionIds) ? transitionIds : [],
      tip: String(row.tip || ''),
      updatedAt: String(row.updated_at || ''),
      lastEventSeq: Math.max(0, Number(row.last_event_seq || 0)),
    };
  });
}

function normalizeTxContextPayload(payload = {}) {
  const txid = String(payload.txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    throw Object.assign(new Error('Invalid tx_context txid'), {
      code: 'INVALID_TX_CONTEXT_TXID',
    });
  }
  const inputTxids = Array.from(new Set((Array.isArray(payload.inputTxids) ? payload.inputTxids : [])
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => /^[0-9a-f]{64}$/i.test(item))))
    .slice(0, 24);
  const now = nowIso();
  return {
    txid,
    rawtxHex: String(payload.rawtxHex || '').trim().toLowerCase(),
    inputTxidsJson: JSON.stringify(inputTxids),
    source: String(payload.source || '').trim(),
    kind: String(payload.kind || '').trim(),
    confirmed: payload.confirmed ? 1 : 0,
    proofType: String(payload.proofType || '').trim(),
    proofSource: String(payload.proofSource || '').trim(),
    proofHex: String(payload.proofHex || '').trim().toLowerCase(),
    proofEncoding: String(payload.proofEncoding || '').trim(),
    proofVerified: payload.proofVerified ? 1 : 0,
    proofVerifiedAt: payload.proofVerifiedAt ? String(payload.proofVerifiedAt) : null,
    proofBlockHeight: Number.isFinite(Number(payload.proofBlockHeight)) ? Number(payload.proofBlockHeight) : null,
    proofBlockHash: String(payload.proofBlockHash || '').trim().toLowerCase(),
    proofMerkleRoot: String(payload.proofMerkleRoot || '').trim().toLowerCase(),
    firstSeenAt: String(payload.firstSeenAt || now),
    lastSeenAt: String(payload.lastSeenAt || now),
    updatedAt: String(payload.updatedAt || now),
  };
}

function normalizeAnchorEventPayload(payload = {}) {
  const txid = String(payload.txid || '').trim().toLowerCase();
  const eventType = String(payload.eventType || payload.event_type || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(txid) || !eventType) return null;
  const rawPayload = payload && typeof payload.payload === 'object'
    ? payload.payload
    : (payload && typeof payload.payload_json === 'string'
      ? (() => {
          try {
            return JSON.parse(payload.payload_json);
          } catch (_) {
            return {};
          }
        })()
      : {});
  const payloadJson = JSON.stringify(rawPayload && typeof rawPayload === 'object' ? rawPayload : {});
  const merchantId = String(
    payload.merchantId
    || payload.merchant_id
    || rawPayload?.merchantId
    || ''
  ).trim();
  const walletId = String(
    payload.walletId
    || payload.wallet_id
    || rawPayload?.walletId
    || rawPayload?.fromWalletId
    || ''
  ).trim();
  const entityId = String(
    payload.entityId
    || payload.entity_id
    || rawPayload?.id
    || rawPayload?.productId
    || rawPayload?.categoryId
    || rawPayload?.orderId
    || rawPayload?.msgId
    || rawPayload?.walletId
    || ''
  ).trim();
  const blockHeightRaw = payload.blockHeight ?? payload.block_height ?? payload.height;
  const eventIndexRaw = payload.eventIndex ?? payload.event_index;
  const ts = String(payload.ts || payload.updatedAt || payload.updated_at || nowIso());
  return {
    txid,
    blockHeight: Number.isFinite(Number(blockHeightRaw)) ? Number(blockHeightRaw) : 0,
    blockHash: String(payload.blockHash || payload.block_hash || '').trim().toLowerCase(),
    eventIndex: Number.isFinite(Number(eventIndexRaw)) ? Number(eventIndexRaw) : 0,
    eventType,
    merchantId,
    entityId,
    walletId,
    ts,
    confirmed: payload.confirmed === false ? 0 : 1,
    sourceNode: String(payload.node || payload.sourceNode || payload.source_node || '').trim(),
    payloadJson,
    payloadHash: crypto.createHash('sha256').update(payloadJson).digest('hex'),
    dedupeKey: String(payload.dedupeKey || payload.dedupe_key || '').trim()
      || `${txid}|${eventType}|${entityId || crypto.createHash('sha256').update(payloadJson).digest('hex')}`,
    insertedAt: String(payload.insertedAt || payload.inserted_at || nowIso()),
  };
}

function upsertTxContext(payload = {}) {
  const row = normalizeTxContextPayload(payload);
  withTransaction(() => {
    db.prepare(`
      INSERT INTO tx_contexts(
        txid,
        rawtx_hex,
        input_txids_json,
        source,
        kind,
        confirmed,
        proof_type,
        proof_source,
        proof_hex,
        proof_encoding,
        proof_verified,
        proof_verified_at,
        proof_block_height,
        proof_block_hash,
        proof_merkle_root,
        first_seen_at,
        last_seen_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(txid) DO UPDATE SET
        rawtx_hex = excluded.rawtx_hex,
        input_txids_json = excluded.input_txids_json,
        source = excluded.source,
        kind = excluded.kind,
        confirmed = CASE
          WHEN tx_contexts.confirmed = 1 OR excluded.confirmed = 1 THEN 1
          ELSE 0
        END,
        proof_type = excluded.proof_type,
        proof_source = excluded.proof_source,
        proof_hex = excluded.proof_hex,
        proof_encoding = excluded.proof_encoding,
        proof_verified = CASE
          WHEN tx_contexts.proof_verified = 1 OR excluded.proof_verified = 1 THEN 1
          ELSE 0
        END,
        proof_verified_at = COALESCE(excluded.proof_verified_at, tx_contexts.proof_verified_at),
        proof_block_height = COALESCE(excluded.proof_block_height, tx_contexts.proof_block_height),
        proof_block_hash = CASE
          WHEN excluded.proof_block_hash <> '' THEN excluded.proof_block_hash
          ELSE tx_contexts.proof_block_hash
        END,
        proof_merkle_root = CASE
          WHEN excluded.proof_merkle_root <> '' THEN excluded.proof_merkle_root
          ELSE tx_contexts.proof_merkle_root
        END,
        first_seen_at = tx_contexts.first_seen_at,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `).run(
      row.txid,
      row.rawtxHex,
      row.inputTxidsJson,
      row.source,
      row.kind,
      row.confirmed,
      row.proofType,
      row.proofSource,
      row.proofHex,
      row.proofEncoding,
      row.proofVerified,
      row.proofVerifiedAt,
      row.proofBlockHeight,
      row.proofBlockHash,
      row.proofMerkleRoot,
      row.firstSeenAt,
      row.lastSeenAt,
      row.updatedAt,
    );
  });
  return { txid: row.txid, updatedAt: row.updatedAt };
}

function upsertAnchorEvents(payload = {}) {
  const events = Array.isArray(payload.events) ? payload.events : [];
  if (!events.length) return { eventCount: 0 };
  const rows = events
    .map((row) => normalizeAnchorEventPayload(row))
    .filter(Boolean);
  if (!rows.length) return { eventCount: 0 };
  withTransaction(() => {
    const insert = db.prepare(`
      INSERT INTO anchor_events(
        txid,
        block_height,
        block_hash,
        event_index,
        event_type,
        merchant_id,
        entity_id,
        wallet_id,
        ts,
        confirmed,
        source_node,
        payload_json,
        payload_hash,
        dedupe_key,
        inserted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO UPDATE SET
        block_height = CASE
          WHEN excluded.block_height > anchor_events.block_height THEN excluded.block_height
          ELSE anchor_events.block_height
        END,
        block_hash = CASE
          WHEN excluded.block_hash <> '' THEN excluded.block_hash
          ELSE anchor_events.block_hash
        END,
        event_index = CASE
          WHEN excluded.event_index > anchor_events.event_index THEN excluded.event_index
          ELSE anchor_events.event_index
        END,
        merchant_id = CASE
          WHEN excluded.merchant_id <> '' THEN excluded.merchant_id
          ELSE anchor_events.merchant_id
        END,
        entity_id = CASE
          WHEN excluded.entity_id <> '' THEN excluded.entity_id
          ELSE anchor_events.entity_id
        END,
        wallet_id = CASE
          WHEN excluded.wallet_id <> '' THEN excluded.wallet_id
          ELSE anchor_events.wallet_id
        END,
        ts = excluded.ts,
        confirmed = CASE
          WHEN anchor_events.confirmed = 1 OR excluded.confirmed = 1 THEN 1
          ELSE 0
        END,
        source_node = CASE
          WHEN excluded.source_node <> '' THEN excluded.source_node
          ELSE anchor_events.source_node
        END,
        payload_json = excluded.payload_json,
        payload_hash = excluded.payload_hash
    `);
    rows.forEach((row) => {
      insert.run(
        row.txid,
        row.blockHeight,
        row.blockHash,
        row.eventIndex,
        row.eventType,
        row.merchantId,
        row.entityId,
        row.walletId,
        row.ts,
        row.confirmed,
        row.sourceNode,
        row.payloadJson,
        row.payloadHash,
        row.dedupeKey,
        row.insertedAt,
      );
    });
  });
  return { eventCount: rows.length };
}

function markAnchorEventsConfirmed(payload = {}) {
  const txids = Array.from(new Set((Array.isArray(payload.txids) ? payload.txids : [])
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => /^[0-9a-f]{64}$/i.test(item))));
  if (!txids.length) return { changed: 0 };
  const placeholders = txids.map(() => '?').join(', ');
  const changed = withTransaction(() => db.prepare(`
    UPDATE anchor_events
    SET confirmed = 1
    WHERE txid IN (${placeholders}) AND confirmed <> 1
  `).run(...txids).changes);
  return { changed };
}

function clearAnchorEvents() {
  const cleared = withTransaction(() => {
    const anchorChanges = db.prepare('DELETE FROM anchor_events').run().changes;
    const pendingChanges = db.prepare('DELETE FROM pending_anchor_projection').run().changes;
    return {
      anchorChanges,
      pendingChanges,
    };
  });
  return {
    cleared: true,
    anchorEventCount: Math.max(0, Number(cleared.anchorChanges || 0)),
    pendingAnchorCount: Math.max(0, Number(cleared.pendingChanges || 0)),
  };
}

function clearOrderData() {
  const cleared = withTransaction(() => {
    const orderProjectionCount = db.prepare('DELETE FROM order_projection').run().changes;
    const orderAnchorCount = db.prepare("DELETE FROM anchor_events WHERE event_type LIKE 'order_%'").run().changes;
    const pendingAnchorCount = db.prepare("DELETE FROM pending_anchor_projection WHERE event_type LIKE 'order_%'").run().changes;
    const localChangeCount = db.prepare(`
      DELETE FROM local_change_projection
      WHERE event_type LIKE 'order_%' OR target_type = 'order'
    `).run().changes;
    const recentRawtxCount = db.prepare("DELETE FROM recent_rawtx_projection WHERE event_type LIKE 'order_%'").run().changes;
    const txContextCount = db.prepare(`
      DELETE FROM tx_contexts
      WHERE instr(lower(rawtx_hex), '424d4d4b54327c6f726465725f') > 0
    `).run().changes;
    return {
      orderProjectionCount,
      orderAnchorCount,
      pendingAnchorCount,
      localChangeCount,
      recentRawtxCount,
      txContextCount,
    };
  });
  return {
    cleared: true,
    ...cleared,
  };
}

function getTxContext(payload = {}) {
  const txid = String(payload.txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) return null;
  return db.prepare(`
    SELECT
      txid,
      rawtx_hex,
      input_txids_json,
      source,
      kind,
      confirmed,
      proof_type,
      proof_source,
      proof_hex,
      proof_encoding,
      proof_verified,
      proof_verified_at,
      proof_block_height,
      proof_block_hash,
      proof_merkle_root,
      first_seen_at,
      last_seen_at,
      updated_at
    FROM tx_contexts
    WHERE txid = ?
  `).get(txid) || null;
}

function deleteTxContext(payload = {}) {
  const txid = String(payload.txid || '').trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    throw Object.assign(new Error('Invalid tx_context txid'), {
      code: 'INVALID_TX_CONTEXT_TXID',
    });
  }
  const info = db.prepare('DELETE FROM tx_contexts WHERE txid = ?').run(txid);
  return {
    deleted: Number(info?.changes || 0) > 0,
    txid,
  };
}

function clearTxContexts() {
  withTransaction(() => {
    db.exec('DELETE FROM tx_contexts');
  });
  return { cleared: true };
}

function healthCheck() {
  touchHealth();
  return {
    pid: process.pid,
    dbFile: DB_FILE,
    pendingDir: RAWTX_PENDING_DIR,
    isOpen: !!db?.isOpen,
  };
}

function writeStateJsonSnapshot(payload = {}) {
  const stateFile = String(payload.stateFile || '').trim();
  const backupFile = String(payload.backupFile || '').trim();
  const serialized = String(payload.serialized || '');
  if (!stateFile) {
    throw Object.assign(new Error('stateFile is required'), { code: 'INVALID_ARGUMENT' });
  }
  atomicWriteTextFile(stateFile, serialized);
  if (backupFile) {
    try {
      atomicWriteTextFile(backupFile, serialized);
    } catch (_) {}
  }
  return {
    stateFile,
    backupFile,
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

function writeSyncNodeStatsSnapshot(payload = {}) {
  const file = String(payload.file || '').trim();
  const serialized = String(payload.serialized || '');
  if (!file) {
    throw Object.assign(new Error('file is required'), { code: 'INVALID_ARGUMENT' });
  }
  atomicWriteTextFile(file, serialized);
  return {
    file,
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

function writeTextFileSnapshot(payload = {}) {
  const file = String(payload.file || '').trim();
  const serialized = String(payload.serialized || '');
  if (!file) {
    throw Object.assign(new Error('file is required'), { code: 'INVALID_ARGUMENT' });
  }
  atomicWriteTextFile(file, serialized);
  return {
    file,
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

function writeP2PSyncReceiptsSnapshot(payload = {}) {
  const file = String(payload.file || '').trim();
  const serialized = String(payload.serialized || '');
  if (!file) {
    throw Object.assign(new Error('file is required'), { code: 'INVALID_ARGUMENT' });
  }
  atomicWriteTextFile(file, serialized);
  return {
    file,
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

function writeChainSpoolStateSnapshot(payload = {}) {
  const file = String(payload.file || '').trim();
  const serialized = String(payload.serialized || '');
  if (!file) {
    throw Object.assign(new Error('file is required'), { code: 'INVALID_ARGUMENT' });
  }
  atomicWriteTextFile(file, serialized);
  return {
    file,
    bytes: Buffer.byteLength(serialized, 'utf8'),
  };
}

function appendChainSpoolRecords(payload = {}) {
  const file = String(payload.file || '').trim();
  const text = String(payload.text || '');
  if (!file) {
    throw Object.assign(new Error('file is required'), { code: 'INVALID_ARGUMENT' });
  }
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, text, 'utf8');
  return {
    file,
    bytes: Buffer.byteLength(text, 'utf8'),
  };
}

function handleRequest(message = {}) {
  const action = String(message.action || '').trim();
  switch (action) {
    case 'init_schema':
      touchHealth();
      return {
        dbFile: DB_FILE,
        pendingDir: RAWTX_PENDING_DIR,
      };
    case 'health_check':
      return healthCheck();
    case 'upsert_sync_state':
      return upsertSyncState(message.payload);
    case 'get_sync_state':
      return getSyncState(message.payload);
    case 'replace_catalog_snapshot':
      return replaceCatalogSnapshot(message.payload);
    case 'get_catalog_snapshot':
      return getCatalogSnapshot();
    case 'replace_profile_snapshot':
      return replaceProfileSnapshot(message.payload);
    case 'get_profile_snapshot':
      return getProfileSnapshot(message.payload);
    case 'write_state_json_snapshot':
      return writeStateJsonSnapshot(message.payload);
    case 'write_sync_node_stats_snapshot':
      return writeSyncNodeStatsSnapshot(message.payload);
    case 'write_text_file_snapshot':
      return writeTextFileSnapshot(message.payload);
    case 'write_p2p_sync_receipts_snapshot':
      return writeP2PSyncReceiptsSnapshot(message.payload);
    case 'write_chain_spool_state_snapshot':
      return writeChainSpoolStateSnapshot(message.payload);
    case 'append_chain_spool_records':
      return appendChainSpoolRecords(message.payload);
    case 'append_events':
      return appendEvents(message.payload);
    case 'list_events_after':
      return listEventsAfter(message.payload);
    case 'get_event_consumer':
      return getEventConsumer(message.payload);
    case 'set_event_consumer':
      return setEventConsumer(message.payload);
    case 'enqueue_durable_message':
      return enqueueDurableMessage(message.payload);
    case 'claim_next_durable_message':
      return claimNextDurableMessage(message.payload);
    case 'finish_durable_message':
      return finishDurableMessage(message.payload);
    case 'release_durable_message':
      return releaseDurableMessage(message.payload);
    case 'list_durable_messages':
      return listDurableMessages(message.payload);
    case 'apply_chat_projection_batch':
      return applyChatProjectionBatch(message.payload);
    case 'apply_sync_projection_batch':
      return applySyncProjectionBatch(message.payload);
    case 'apply_wallet_tx_projection_batch':
      return applyWalletTxProjectionBatch(message.payload);
    case 'apply_wallet_read_projection_batch':
      return applyWalletReadProjectionBatch(message.payload);
    case 'apply_bhs_projection_batch':
      return applyBhsProjectionBatch(message.payload);
    case 'apply_order_projection_batch':
      return applyOrderProjectionBatch(message.payload);
    case 'apply_local_state_projection_batch':
      return applyLocalStateProjectionBatch(message.payload);
    case 'list_chat_presence_projection':
      return listChatPresenceProjection(message.payload);
    case 'list_chat_thread_status_projection':
      return listChatThreadStatusProjection(message.payload);
    case 'list_chat_message_index_projection':
      return listChatMessageIndexProjection(message.payload);
    case 'list_chat_contact_projection':
      return listChatContactProjection(message.payload);
    case 'get_chat_self_state_projection':
      return getChatSelfStateProjection(message.payload);
    case 'list_wallet_tx_reservation_projection':
      return listWalletTxReservationProjection(message.payload);
    case 'list_wallet_outpoint_reservation_projection':
      return listWalletOutpointReservationProjection(message.payload);
    case 'get_wallet_index_status_projection':
      return getWalletIndexStatusProjection(message.payload);
    case 'get_wallet_read_model_projection':
      return getWalletReadModelProjection(message.payload);
    case 'list_wallet_history_projection':
      return listWalletHistoryProjection(message.payload);
    case 'get_bhs_status_projection':
      return getBhsStatusProjection(message.payload);
    case 'list_order_projection':
      return listOrderProjection(message.payload);
    case 'get_local_state_projection':
      return getLocalStateProjection(message.payload);
    case 'upsert_tx_context':
      return upsertTxContext(message.payload);
    case 'get_tx_context':
      return getTxContext(message.payload);
    case 'delete_tx_context':
      return deleteTxContext(message.payload);
    case 'clear_tx_contexts':
      return clearTxContexts();
    case 'upsert_anchor_events':
      return upsertAnchorEvents(message.payload);
    case 'mark_anchor_events_confirmed':
      return markAnchorEventsConfirmed(message.payload);
    case 'clear_anchor_events':
      return clearAnchorEvents();
    case 'clear_order_data':
      return clearOrderData();
    case 'terminate':
      shuttingDown = true;
      setImmediate(() => process.exit(0));
      return { accepted: true };
    default:
      throw Object.assign(new Error(`Unsupported writer action: ${action || 'unknown'}`), {
        code: 'UNSUPPORTED_ACTION',
      });
  }
}

function sendEnvelope(envelope) {
  if (typeof process.send !== 'function') return;
  if (process.connected === false) {
    shuttingDown = true;
    return;
  }
  try {
    process.send(envelope);
  } catch (error) {
    const code = String(error?.code || '');
    const syscall = String(error?.syscall || '');
    const message = String(error?.message || '');
    const isClosedPipe =
      code === 'EPIPE' ||
      code === 'ERR_IPC_CHANNEL_CLOSED' ||
      (code === 'UNKNOWN' && syscall === 'write') ||
      /channel.*closed/i.test(message) ||
      /write UNKNOWN/i.test(message);
    if (isClosedPipe) {
      shuttingDown = true;
      return;
    }
    throw error;
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    if (db?.isOpen) db.close();
  } catch (_) {}
}

process.on('message', (message) => {
  const requestId = String(message?.requestId || '');
  const action = String(message?.action || '').trim();
  const receivedAtMs = Date.now();
  const sentAtMs = Number.isFinite(message?.sentAtMs) ? Number(message.sentAtMs) : null;
  const requestSummary = summarizeRequestPayload(action, message?.payload);
  if (
    action === 'append_events'
    || action === 'list_events_after'
    || action === 'apply_sync_projection_batch'
  ) {
    appendDbTrace('request_received', {
      requestId,
      action,
      receivedAtMs,
      sentAtMs,
      receiveLagMs: Number.isFinite(sentAtMs) ? Math.max(0, receivedAtMs - sentAtMs) : null,
      ...requestSummary,
    });
  }
  try {
    const startedAtMs = Date.now();
    const data = handleRequest(message);
    const finishedAtMs = Date.now();
    const elapsedMs = finishedAtMs - startedAtMs;
    if (elapsedMs >= DB_TRACE_SLOW_MS) {
      appendDbTrace('request_handled', {
        requestId,
        action,
        receivedAtMs,
        startedAtMs,
        finishedAtMs,
        elapsedMs,
        ...requestSummary,
        ...summarizeResult(action, data),
      });
    }
    sendEnvelope({
      type: 'writer_response',
      requestId,
      ok: true,
      code: 'OK',
      data,
      error: '',
      sentAtMs,
      receivedAtMs,
      startedAtMs,
      finishedAtMs,
    });
  } catch (error) {
    const finishedAtMs = Date.now();
    appendDbTrace('request_failed', {
      requestId,
      action,
      receivedAtMs,
      finishedAtMs,
      elapsedMs: finishedAtMs - receivedAtMs,
      ...requestSummary,
      error: String(error?.message || error || 'writer failure'),
      code: String(error?.code || 'WRITER_ERROR'),
    });
    const serialized = serializeError(error);
    sendEnvelope({
      type: 'writer_response',
      requestId,
      ok: false,
      code: serialized.code,
      data: null,
      error: serialized.message,
      sentAtMs,
      receivedAtMs,
      startedAtMs: receivedAtMs,
      finishedAtMs,
    });
  }
});

process.on('SIGTERM', () => {
  shutdown();
  process.exit(0);
});

process.on('SIGINT', () => {
  shutdown();
  process.exit(0);
});

process.on('disconnect', () => {
  shutdown();
  process.exit(0);
});

process.on('error', (error) => {
  const code = String(error?.code || '');
  const syscall = String(error?.syscall || '');
  const message = String(error?.message || '');
  const isClosedPipe =
    code === 'EPIPE' ||
    code === 'ERR_IPC_CHANNEL_CLOSED' ||
    (code === 'UNKNOWN' && syscall === 'write') ||
    /channel.*closed/i.test(message) ||
    /write UNKNOWN/i.test(message);
  if (isClosedPipe) {
    shutdown();
    process.exit(0);
  }
  throw error;
});

process.on('exit', () => {
  shutdown();
});

async function startWriter() {
  const initStartedAtMs = Date.now();
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      initializeDatabase();
      const cleanup = cleanupPendingRawtx();
      sendEnvelope({
        type: 'writer_online',
        ok: true,
        code: 'WRITER_ONLINE',
        data: {
          pid: process.pid,
          dbFile: DB_FILE,
          pendingDir: RAWTX_PENDING_DIR,
          cleanedPendingCount: cleanup.deletedCount,
          initAttempt: attempt,
          initElapsedMs: Date.now() - initStartedAtMs,
        },
      });
      return;
    } catch (error) {
      if (!isSqliteLockError(error)) throw error;
      const elapsedMs = Date.now() - initStartedAtMs;
      appendDbTrace('writer_init_retry', {
        attempt,
        elapsedMs,
        retryMs: DB_INIT_RETRY_MS,
        error: String(error?.message || error || 'database is locked'),
      });
      if (elapsedMs >= DB_INIT_MAX_WAIT_MS) {
        appendDbTrace('writer_init_failed', {
          attempt,
          elapsedMs,
          error: String(error?.message || error || 'database is locked'),
        });
        throw error;
      }
      await sleep(DB_INIT_RETRY_MS);
    }
  }
}

startWriter().catch((error) => {
  const serialized = serializeError(error);
  appendDbTrace('writer_boot_failed', {
    error: serialized.message,
    code: serialized.code,
  });
  console.error(error);
  process.exit(1);
});
