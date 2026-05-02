const marketDb = require('./market_db');
const messageQueue = require('./lib/message_queue');
const wallet = require('./wallet');

const WALLET_READ_CONSUMER = 'wallet_read_projection_writer_v1';
const walletStateCache = new Map();
const walletPersistState = new Map();
const WALLET_READ_PERSIST_DEBOUNCE_MS = Math.max(50, Number(process.env.BSV_WALLET_READ_PERSIST_DEBOUNCE_MS || 400));

function nowIso() {
  return new Date().toISOString();
}

function normalizeIndexStatus(row = {}) {
  return {
    walletKey: String(row.walletKey || '').trim(),
    walletScanCursorHeight: Math.max(0, Number(row.walletScanCursorHeight || 0)),
    walletRelevantTxCount: Math.max(0, Number(row.walletRelevantTxCount || 0)),
    walletUtxoCount: Math.max(0, Number(row.walletUtxoCount || 0)),
    contextReadyCount: Math.max(0, Number(row.contextReadyCount || 0)),
    beefReadyUtxoCount: Math.max(0, Number(row.beefReadyUtxoCount || 0)),
    sendPreflightStatus: String(row.sendPreflightStatus || 'unknown').trim(),
    syncProgressActive: row.syncProgressActive === true,
    syncProgressStage: String(row.syncProgressStage || 'idle').trim(),
    syncProgressMessage: String(row.syncProgressMessage || '').trim(),
    syncProgressError: String(row.syncProgressError || '').trim(),
    lastIndexedAt: String(row.lastIndexedAt || '').trim(),
    recentRawtxCount: Math.max(0, Number(row.recentRawtxCount || 0)),
    recentRawtxLatestTxid: String(row.recentRawtxLatestTxid || '').trim(),
    recentRawtxLatestTs: String(row.recentRawtxLatestTs || '').trim(),
    source: String(row.source || '').trim(),
    lastEventSeq: Math.max(0, Number(row.lastEventSeq || 0)),
    updatedAt: String(row.updatedAt || nowIso()),
  };
}

function normalizeReadModel(row = {}) {
  return {
    walletKey: String(row.walletKey || '').trim(),
    receiveAddress: String(row.receiveAddress || '').trim(),
    confirmed: Number(row.confirmed || 0),
    unconfirmed: Number(row.unconfirmed || 0),
    pendingDelta: Number(row.pendingDelta || 0),
    incomeSat: Number(row.incomeSat || 0),
    expenseSat: Number(row.expenseSat || 0),
    total: Number(row.total || 0),
    totalBsv: Number(row.totalBsv || 0),
    balanceUpdatedAt: String(row.balanceUpdatedAt || row.updatedAt || '').trim(),
    source: String(row.source || '').trim(),
    lastEventSeq: Math.max(0, Number(row.lastEventSeq || 0)),
    updatedAt: String(row.updatedAt || nowIso()),
  };
}

function normalizeHistoryItems(walletKey, items = [], eventSeq = 0, updatedAt = nowIso()) {
  return (Array.isArray(items) ? items : []).map((row, index) => ({
    walletKey: String(walletKey || '').trim(),
    txid: String(row?.txid || '').trim(),
    note: String(row?.note || '').trim(),
    notedAt: String(row?.notedAt || '').trim(),
    confirmed: row?.confirmed === true,
    netSat: Number(row?.netSat || 0),
    lastSeenAt: String(row?.lastSeenAt || '').trim(),
    sortIndex: Math.max(0, Number(row?.sortIndex ?? index)),
    sourceEventSeq: Math.max(0, Number(eventSeq || 0)),
    updatedAt: String(row?.updatedAt || updatedAt),
  })).filter((row) => row.walletKey && row.txid);
}

function makeEmptyState() {
  return {
    indexStatus: null,
    readModel: null,
    historyItems: [],
  };
}

function cloneState(state = null) {
  if (!state || typeof state !== 'object') return makeEmptyState();
  return {
    indexStatus: state.indexStatus ? { ...state.indexStatus } : null,
    readModel: state.readModel ? { ...state.readModel } : null,
    historyItems: Array.isArray(state.historyItems) ? state.historyItems.map((row) => ({ ...row })) : [],
  };
}

function hashState(state = null) {
  try {
    return JSON.stringify(state || null);
  } catch (_) {
    return '';
  }
}

function writeCache(walletKey, state) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return makeEmptyState();
  const normalized = cloneState(state);
  walletStateCache.set(safeWalletKey, normalized);
  return normalized;
}

function getCachedState(walletKey, options = {}) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return makeEmptyState();
  const cached = walletStateCache.get(safeWalletKey);
  if (cached) return cloneState(cached);
  if (options.allowLoad === false) return makeEmptyState();
  return writeCache(safeWalletKey, readProjectionState(safeWalletKey));
}

function syncCacheWithProjection(walletKey) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return makeEmptyState();
  const cached = walletStateCache.get(safeWalletKey);
  const projected = readProjectionState(safeWalletKey);
  if (!cached) return writeCache(safeWalletKey, projected);

  const cachedIndexUpdatedAt = String(cached?.indexStatus?.updatedAt || cached?.indexStatus?.lastIndexedAt || '');
  const projectedIndexUpdatedAt = String(projected?.indexStatus?.updatedAt || projected?.indexStatus?.lastIndexedAt || '');
  const cachedReadUpdatedAt = String(cached?.readModel?.updatedAt || cached?.readModel?.balanceUpdatedAt || '');
  const projectedReadUpdatedAt = String(projected?.readModel?.updatedAt || projected?.readModel?.balanceUpdatedAt || '');
  const cachedHistoryUpdatedAt = String((Array.isArray(cached?.historyItems) && cached.historyItems[0]?.updatedAt) || '');
  const projectedHistoryUpdatedAt = String((Array.isArray(projected?.historyItems) && projected.historyItems[0]?.updatedAt) || '');

  if (
    projectedIndexUpdatedAt > cachedIndexUpdatedAt
    || projectedReadUpdatedAt > cachedReadUpdatedAt
    || projectedHistoryUpdatedAt > cachedHistoryUpdatedAt
  ) {
    return writeCache(safeWalletKey, projected);
  }
  return cloneState(cached);
}

function readProjectionState(walletKey = '') {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return { indexStatus: null, readModel: null, historyItems: [] };
  const db = marketDb.openReadDb();
  try {
    const indexStatus = db.prepare(`
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
    `).get(safeWalletKey);
    const readModel = db.prepare(`
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
    `).get(safeWalletKey);
    const historyItems = db.prepare(`
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
    `).all(safeWalletKey).map((row) => ({
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
    return {
      indexStatus: indexStatus ? normalizeIndexStatus({
        walletKey: indexStatus.wallet_key,
        walletScanCursorHeight: indexStatus.wallet_scan_cursor_height,
        walletRelevantTxCount: indexStatus.wallet_relevant_tx_count,
        walletUtxoCount: indexStatus.wallet_utxo_count,
        contextReadyCount: indexStatus.context_ready_count,
        beefReadyUtxoCount: indexStatus.beef_ready_utxo_count,
        sendPreflightStatus: indexStatus.send_preflight_status,
        syncProgressActive: Number(indexStatus.sync_progress_active || 0) === 1,
        syncProgressStage: indexStatus.sync_progress_stage,
        syncProgressMessage: indexStatus.sync_progress_message,
        syncProgressError: indexStatus.sync_progress_error,
        lastIndexedAt: indexStatus.last_indexed_at,
        recentRawtxCount: indexStatus.recent_rawtx_count,
        recentRawtxLatestTxid: indexStatus.recent_rawtx_latest_txid,
        recentRawtxLatestTs: indexStatus.recent_rawtx_latest_ts,
        source: indexStatus.source,
        lastEventSeq: indexStatus.last_event_seq,
        updatedAt: indexStatus.updated_at,
      }) : null,
      readModel: readModel ? normalizeReadModel({
        walletKey: readModel.wallet_key,
        receiveAddress: readModel.receive_address,
        confirmed: readModel.confirmed,
        unconfirmed: readModel.unconfirmed,
        pendingDelta: readModel.pending_delta,
        incomeSat: readModel.income_sat,
        expenseSat: readModel.expense_sat,
        total: readModel.total,
        totalBsv: readModel.total_bsv,
        balanceUpdatedAt: readModel.balance_updated_at,
        source: readModel.source,
        lastEventSeq: readModel.last_event_seq,
        updatedAt: readModel.updated_at,
      }) : null,
      historyItems,
    };
  } finally {
    db.close();
  }
}

async function catchUpProjection(walletKey = '') {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return { applied: 0, lastSeq: 0 };
  const state = readProjectionState(safeWalletKey);
  writeCache(safeWalletKey, state);
  appendWalletReadTrace('catchup_profile', {
    consumerName: WALLET_READ_CONSUMER,
    walletKey: safeWalletKey,
    mode: 'projection_reload',
    indexPresent: Boolean(state.indexStatus),
    readModelPresent: Boolean(state.readModel),
    historyItemCount: Array.isArray(state.historyItems) ? state.historyItems.length : 0,
  });
  return {
    applied: 0,
    lastSeq: Math.max(
      Number(state.indexStatus?.lastEventSeq || 0),
      Number(state.readModel?.lastEventSeq || 0),
      ...((Array.isArray(state.historyItems) ? state.historyItems : []).map((row) => Number(row?.sourceEventSeq || 0))),
    ),
  };
}

async function persistState(walletKey, state) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return;
  schedulePersistState(walletKey, state);
}

function getOrCreatePersistControl(walletKey) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return null;
  let control = walletPersistState.get(safeWalletKey) || null;
  if (!control) {
    control = {
      timer: null,
      inFlight: false,
      pendingState: null,
      pendingSignature: '',
      lastPersistedSignature: '',
    };
    walletPersistState.set(safeWalletKey, control);
  }
  return control;
}

async function flushPersistState(walletKey) {
  const safeWalletKey = String(walletKey || '').trim();
  const control = walletPersistState.get(safeWalletKey);
  if (!control || control.inFlight || !control.pendingState) return;
  control.inFlight = true;
  try {
    while (control.pendingState) {
      const safeState = cloneState(control.pendingState);
      const signature = String(control.pendingSignature || '');
      control.pendingState = null;
      control.pendingSignature = '';
      if (signature && signature === control.lastPersistedSignature) {
        writeCache(safeWalletKey, safeState);
        continue;
      }
      await marketDb.applyWalletReadProjectionBatch({
        indexStatus: safeState.indexStatus,
        readModel: safeState.readModel,
        historyItems: safeState.historyItems,
        deleteWalletKeys: [],
      });
      control.lastPersistedSignature = signature;
      writeCache(safeWalletKey, safeState);
    }
  } finally {
    control.inFlight = false;
    if (control.pendingState) {
      setImmediate(() => {
        void flushPersistState(safeWalletKey).catch(() => {});
      });
    } else if (!control.timer) {
      walletPersistState.delete(safeWalletKey);
    }
  }
}

async function flushWalletReadProjection(walletKey) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return false;
  const control = walletPersistState.get(safeWalletKey);
  if (control?.timer) {
    clearTimeout(control.timer);
    control.timer = null;
  }
  await flushPersistState(safeWalletKey);
  return true;
}

function schedulePersistState(walletKey, state) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return;
  const control = getOrCreatePersistControl(safeWalletKey);
  if (!control) return;
  const safeState = cloneState(state);
  const signature = hashState(safeState);
  if (signature && signature === control.lastPersistedSignature) {
    writeCache(safeWalletKey, safeState);
    return;
  }
  control.pendingState = safeState;
  control.pendingSignature = signature;
  writeCache(safeWalletKey, safeState);
  if (control.timer) return;
  control.timer = setTimeout(() => {
    control.timer = null;
    void flushPersistState(safeWalletKey).catch(() => {});
  }, WALLET_READ_PERSIST_DEBOUNCE_MS);
  control.timer.unref?.();
}

async function emitWalletIndexSnapshot(snapshot = {}, meta = {}) {
  const payload = normalizeIndexStatus(snapshot);
  if (!payload.walletKey) return null;
  await messageQueue.publish('wallet.index.updated', payload, {
    mode: messageQueue.MODE_TRANSIENT,
    source: String(meta.producer || 'wallet_read_domain'),
  });
  const state = getCachedState(payload.walletKey);
  state.indexStatus = normalizeIndexStatus({
    ...payload,
    lastEventSeq: 0,
    updatedAt: nowIso(),
  });
  await persistState(payload.walletKey, state);
  return payload;
}

async function emitWalletReadModelSnapshot(snapshot = {}, meta = {}) {
  const payload = normalizeReadModel(snapshot);
  if (!payload.walletKey) return null;
  const historyItems = normalizeHistoryItems(payload.walletKey, snapshot.historyItems || snapshot.history?.items || []);
  await messageQueue.publish('wallet.read_model.updated', {
    ...payload,
    historyItems,
  }, {
    mode: messageQueue.MODE_TRANSIENT,
    source: String(meta.producer || 'wallet_read_domain'),
  });
  const state = getCachedState(payload.walletKey);
  state.readModel = normalizeReadModel({
    ...payload,
    lastEventSeq: 0,
    updatedAt: nowIso(),
  });
  state.historyItems = normalizeHistoryItems(
    payload.walletKey,
    historyItems,
    0,
    nowIso(),
  );
  await persistState(payload.walletKey, state);
  return {
    ...payload,
    historyItems,
  };
}

async function getWalletIndexStatus(walletKey) {
  return getWalletIndexStatusSync(walletKey);
}

async function getWalletReadModel(walletKey, options = {}) {
  return getWalletReadModelSync(walletKey, options);
}

async function getWalletHistory(walletKey, page = 1, pageSize = 10) {
  return getWalletHistorySync(walletKey, page, pageSize);
}

async function resetWalletState(walletKey) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return false;
  walletStateCache.delete(safeWalletKey);
  await marketDb.applyWalletReadProjectionBatch({
    deleteWalletKeys: [safeWalletKey],
    historyItems: [],
  });
  return true;
}

function getWalletIndexStatusSync(walletKey) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return null;
  return syncCacheWithProjection(safeWalletKey).indexStatus;
}

function getWalletReadModelSync(walletKey, options = {}) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) return null;
  const skipLive = options?.skipLive === true || options?.preferProjection === true;
  if (!skipLive && wallet.walletExists()) {
    try {
      const live = wallet.buildWalletBusinessSnapshot(1, 10);
      if (String(live?.walletKey || '').trim() === safeWalletKey) {
        return {
          walletKey: safeWalletKey,
          receiveAddress: String(live.receiveAddress || safeWalletKey),
          confirmed: Number(live.confirmed || 0),
          unconfirmed: Number(live.unconfirmed || 0),
          pendingDelta: Number(live.pendingDelta || 0),
          incomeSat: Number(live.incomeSat || 0),
          expenseSat: Number(live.expenseSat || 0),
          total: Number(live.total || 0),
          totalBsv: Number(live.totalBsv || 0),
          balanceUpdatedAt: String(live.updatedAt || ''),
          updatedAt: String(live.updatedAt || ''),
          historyItems: Array.isArray(live.items) ? live.items.map((row, index) => ({
            walletKey: safeWalletKey,
            txid: String(row?.txid || ''),
            note: String(row?.note || ''),
            notedAt: String(row?.lastSeenAt || ''),
            confirmed: row?.confirmed === true,
            netSat: Number(row?.amountSat || 0) * (row?.kind === 'external_receive' ? 1 : -1),
            lastSeenAt: String(row?.lastSeenAt || ''),
            sortIndex: index,
            sourceEventSeq: 0,
            updatedAt: String(live.updatedAt || nowIso()),
            entryId: String(row?.entryId || row?.txid || ''),
            kind: String(row?.kind || ''),
            amountSat: Number(row?.amountSat || 0),
            label: String(row?.label || ''),
          })) : [],
        };
      }
    } catch (_) {}
  }
  return syncCacheWithProjection(safeWalletKey).readModel;
}

function getWalletHistorySync(walletKey, page = 1, pageSize = 10) {
  const safeWalletKey = String(walletKey || '').trim();
  if (!safeWalletKey) {
    return { page: 1, pageSize: 10, total: 0, totalPages: 1, items: [], updatedAt: null };
  }
  if (wallet.walletExists()) {
    try {
      const live = wallet.buildWalletBusinessSnapshot(page, pageSize);
      if (String(live?.walletKey || '').trim() === safeWalletKey) {
        return {
          page: Number(live.page || 1),
          pageSize: Number(live.pageSize || pageSize || 10),
          total: Number(live.totalItems || 0),
          totalPages: Number(live.totalPages || 1),
          items: (Array.isArray(live.items) ? live.items : []).map((row) => ({
            entryId: String(row?.entryId || row?.txid || ''),
            txid: String(row?.txid || ''),
            kind: String(row?.kind || ''),
            amountSat: Number(row?.amountSat || 0),
            confirmed: row?.confirmed === true,
            label: String(row?.label || ''),
            note: String(row?.note || ''),
            lastSeenAt: row?.lastSeenAt || null,
          })),
          updatedAt: String(live.updatedAt || '') || null,
        };
      }
    } catch (_) {}
  }
  const state = syncCacheWithProjection(safeWalletKey);
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.max(1, Math.min(50, Number(pageSize) || 10));
  const total = state.historyItems.length;
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const start = (safePage - 1) * safePageSize;
  return {
    page: safePage,
    pageSize: safePageSize,
    total,
    totalPages,
    items: state.historyItems.slice(start, start + safePageSize).map((row) => ({
      entryId: String(row?.entryId || row.txid || ''),
      txid: row.txid,
      kind: String(row?.kind || (Number(row.netSat || 0) > 0 ? 'external_receive' : 'external_spend')),
      amountSat: Math.abs(Number(row?.amountSat || row.netSat || 0)),
      confirmed: row.confirmed === true,
      label: String(row?.label || ''),
      note: row.note,
      lastSeenAt: row.lastSeenAt || null,
    })),
    updatedAt: state.readModel?.balanceUpdatedAt || null,
  };
}

module.exports = {
  WALLET_READ_CONSUMER,
  catchUpProjection,
  emitWalletIndexSnapshot,
  emitWalletReadModelSnapshot,
  flushWalletReadProjection,
  getWalletIndexStatus,
  getWalletReadModel,
  getWalletHistory,
  getWalletIndexStatusSync,
  getWalletReadModelSync,
  getWalletHistorySync,
  resetWalletState,
};
