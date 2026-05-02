const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const CURRENT_DATA_VERSION = 1;
const RUNTIME_VERSION_FILE_NAME = 'runtime_version.json';

function nowIso() {
  return new Date().toISOString();
}

function getDataDir() {
  return path.resolve(process.env.BSV_MARKET_DATA_DIR || path.join(__dirname, 'data'));
}

function getDbFilePath(dataDir = getDataDir()) {
  return path.join(dataDir, 'market.db');
}

function getRuntimeVersionFilePath(dataDir = getDataDir()) {
  return path.join(dataDir, RUNTIME_VERSION_FILE_NAME);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    const code = String(err?.code || '').toUpperCase();
    const transient = code === 'EPERM' || code === 'EACCES' || code === 'EBUSY';
    if (!transient) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      throw err;
    }
    try {
      fs.copyFileSync(tempPath, filePath);
      fs.unlinkSync(tempPath);
    } catch (copyErr) {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) {}
      throw copyErr;
    }
  }
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_) {
    return null;
  }
}

function normalizeVersionRecord(raw = {}) {
  return {
    app_data_version: Math.max(0, Number(raw.app_data_version || 0)),
    migration_status: String(raw.migration_status || 'ready'),
    last_migration_from: Math.max(0, Number(raw.last_migration_from || 0)),
    last_migration_to: Math.max(0, Number(raw.last_migration_to || 0)),
    last_migration_at: String(raw.last_migration_at || ''),
    current_step: String(raw.current_step || ''),
    current_step_from: Math.max(0, Number(raw.current_step_from || 0)),
    current_step_to: Math.max(0, Number(raw.current_step_to || 0)),
  };
}

function readRuntimeVersion(dataDir = getDataDir()) {
  const filePath = getRuntimeVersionFilePath(dataDir);
  if (!fs.existsSync(filePath)) return null;
  return normalizeVersionRecord(readJsonSafe(filePath) || {});
}

function writeRuntimeVersion(record, dataDir = getDataDir()) {
  const normalized = normalizeVersionRecord(record);
  writeJsonAtomic(getRuntimeVersionFilePath(dataDir), normalized);
  return normalized;
}

function openMetaDb(dataDir = getDataDir()) {
  const dbFile = getDbFilePath(dataDir);
  ensureDir(dataDir);
  const db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function readMetaVersion(dataDir = getDataDir()) {
  const dbFile = getDbFilePath(dataDir);
  if (!fs.existsSync(dbFile)) return null;
  let db = null;
  try {
    db = openMetaDb(dataDir);
    const rows = db.prepare(`
      SELECT key, value
      FROM schema_meta
      WHERE key IN (
        'app_data_version',
        'migration_status',
        'last_migration_from',
        'last_migration_to',
        'last_migration_at',
        'current_step',
        'current_step_from',
        'current_step_to'
      )
    `).all();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const mapped = Object.create(null);
    rows.forEach((row) => {
      mapped[String(row.key || '')] = row.value;
    });
    return normalizeVersionRecord(mapped);
  } catch (_) {
    return null;
  } finally {
    try {
      db?.close();
    } catch (_) {}
  }
}

function readDbTableNames(dataDir = getDataDir()) {
  const dbFile = getDbFilePath(dataDir);
  if (!fs.existsSync(dbFile)) return [];
  let db = null;
  try {
    db = openMetaDb(dataDir);
    const rows = db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
    `).all();
    return Array.isArray(rows)
      ? rows.map((row) => String(row?.name || '').trim()).filter(Boolean)
      : [];
  } catch (_) {
    return [];
  } finally {
    try {
      db?.close();
    } catch (_) {}
  }
}

function inferImplicitV1Record(dataDir = getDataDir()) {
  const tableNames = new Set(readDbTableNames(dataDir));
  const requiredTables = [
    'sync_state',
    'anchor_events',
    'profiles',
    'tx_contexts',
    'chat_threads',
    'chat_messages',
  ];
  const hasRequiredTables = requiredTables.every((name) => tableNames.has(name));
  if (!hasRequiredTables) return null;
  const legacyJsonPaths = [
    path.join(dataDir, 'tx_contexts.json'),
    path.join(dataDir, 'anchors_global.json'),
  ];
  if (legacyJsonPaths.some((filePath) => fs.existsSync(filePath))) return null;
  return normalizeVersionRecord({
    app_data_version: 1,
    migration_status: 'ready',
    last_migration_from: 1,
    last_migration_to: 1,
    last_migration_at: nowIso(),
    current_step: '',
    current_step_from: 0,
    current_step_to: 0,
  });
}

function writeMetaVersion(record, dataDir = getDataDir()) {
  const normalized = normalizeVersionRecord(record);
  let db = null;
  try {
    db = openMetaDb(dataDir);
    const stmt = db.prepare(`
      INSERT INTO schema_meta(key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    const updatedAt = normalized.last_migration_at || nowIso();
    stmt.run('app_data_version', String(normalized.app_data_version), updatedAt);
    stmt.run('migration_status', normalized.migration_status, updatedAt);
    stmt.run('last_migration_from', String(normalized.last_migration_from), updatedAt);
    stmt.run('last_migration_to', String(normalized.last_migration_to), updatedAt);
    stmt.run('last_migration_at', updatedAt, updatedAt);
    stmt.run('current_step', normalized.current_step, updatedAt);
    stmt.run('current_step_from', String(normalized.current_step_from), updatedAt);
    stmt.run('current_step_to', String(normalized.current_step_to), updatedAt);
  } finally {
    try {
      db?.close();
    } catch (_) {}
  }
  return normalized;
}

function getCurrentDataVersionInfo(dataDir = getDataDir()) {
  const meta = readMetaVersion(dataDir);
  const runtime = readRuntimeVersion(dataDir);
  if (meta && meta.app_data_version > 0) {
    return {
      source: 'sqlite_meta',
      record: meta,
      version: meta.app_data_version,
    };
  }
  if (runtime && runtime.app_data_version > 0) {
    return {
      source: 'runtime_version',
      record: runtime,
      version: runtime.app_data_version,
    };
  }
  const implicitV1 = inferImplicitV1Record(dataDir);
  if (implicitV1) {
    return {
      source: 'implicit_v1',
      record: implicitV1,
      version: implicitV1.app_data_version,
    };
  }
  return {
    source: 'implicit_v0',
    record: normalizeVersionRecord({ app_data_version: 0 }),
    version: 0,
  };
}

module.exports = {
  CURRENT_DATA_VERSION,
  RUNTIME_VERSION_FILE_NAME,
  nowIso,
  getDataDir,
  getDbFilePath,
  getRuntimeVersionFilePath,
  writeJsonAtomic,
  readJsonSafe,
  normalizeVersionRecord,
  readRuntimeVersion,
  writeRuntimeVersion,
  readMetaVersion,
  readDbTableNames,
  inferImplicitV1Record,
  writeMetaVersion,
  getCurrentDataVersionInfo,
};
