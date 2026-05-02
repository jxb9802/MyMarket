#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const args = {
    dataDir: path.resolve(process.cwd(), 'data'),
    scratchName: '_sqlite_rw_probe.db',
    keepScratch: false,
    writeMarket: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const part = String(argv[i] || '').trim();
    if (!part) continue;
    if (part === '--keep-scratch') {
      args.keepScratch = true;
      continue;
    }
    if (part === '--write-market') {
      args.writeMarket = true;
      continue;
    }
    if (part.startsWith('--data-dir=')) {
      args.dataDir = path.resolve(part.slice('--data-dir='.length));
      continue;
    }
    if (part.startsWith('--scratch-name=')) {
      args.scratchName = path.basename(part.slice('--scratch-name='.length));
      continue;
    }
  }
  return args;
}

function statFileSafe(file) {
  try {
    const stat = fs.statSync(file);
    return {
      exists: true,
      size: stat.size,
      mtime: new Date(stat.mtimeMs).toISOString(),
    };
  } catch (_) {
    return {
      exists: false,
      size: 0,
      mtime: '',
    };
  }
}

function openDb(file, options = {}) {
  return new DatabaseSync(file, options);
}

function probeMarketRead(marketDbFile) {
  const result = {
    ok: false,
    file: marketDbFile,
    stat: statFileSafe(marketDbFile),
    quickCheck: null,
    integrityCheck: null,
    tables: {},
    error: '',
  };
  if (!result.stat.exists) {
    result.error = 'market.db not found';
    return result;
  }
  let db = null;
  try {
    db = openDb(marketDbFile);
    const quickRow = db.prepare('PRAGMA quick_check;').get();
    const integrityRow = db.prepare('PRAGMA integrity_check(1);').get();
    result.quickCheck = quickRow ? Object.values(quickRow)[0] : null;
    result.integrityCheck = integrityRow ? Object.values(integrityRow)[0] : null;
    const tableCounts = [
      'sync_state',
      'durable_queue_messages',
      'sync_job_state_projection',
      'bhs_status_projection',
      'anchor_events',
      'blocks',
      'tx_store',
    ];
    for (const table of tableCounts) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get();
        result.tables[table] = Number(row?.c || 0);
      } catch (error) {
        result.tables[table] = `ERROR: ${String(error?.message || error)}`;
      }
    }
    result.ok = true;
    return result;
  } catch (error) {
    result.error = String(error?.message || error);
    return result;
  } finally {
    try { db?.close(); } catch (_) {}
  }
}

function removeFileIfExists(file) {
  try { fs.unlinkSync(file); } catch (_) {}
}

function probeScratchWrite(scratchFile, keepScratch) {
  const walFile = `${scratchFile}-wal`;
  const shmFile = `${scratchFile}-shm`;
  const result = {
    ok: false,
    file: scratchFile,
    statBefore: statFileSafe(scratchFile),
    operations: [],
    statAfter: null,
    error: '',
  };
  let db = null;
  try {
    db = openDb(scratchFile);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS probe_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        note TEXT NOT NULL
      );
    `);
    result.operations.push('opened');
    const insert = db.prepare('INSERT INTO probe_log (created_at, note) VALUES (?, ?)');
    for (let i = 0; i < 5; i += 1) {
      insert.run(nowIso(), `probe-${i + 1}`);
    }
    result.operations.push('inserted_5_rows');
    const rowCount1 = db.prepare('SELECT COUNT(*) AS c FROM probe_log').get();
    result.operations.push(`count_after_insert=${Number(rowCount1?.c || 0)}`);
    db.prepare('UPDATE probe_log SET note = ? WHERE id = 1').run('probe-updated');
    result.operations.push('updated_row_1');
    db.prepare('DELETE FROM probe_log WHERE id = 2').run();
    result.operations.push('deleted_row_2');
    const rowCount2 = db.prepare('SELECT COUNT(*) AS c FROM probe_log').get();
    result.operations.push(`count_after_delete=${Number(rowCount2?.c || 0)}`);
    const quickRow = db.prepare('PRAGMA quick_check;').get();
    result.operations.push(`quick_check=${quickRow ? Object.values(quickRow)[0] : 'null'}`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    result.operations.push('wal_checkpoint_truncate');
    db.close();
    db = null;
    result.statAfter = statFileSafe(scratchFile);
    result.ok = true;
    return result;
  } catch (error) {
    result.error = String(error?.message || error);
    result.statAfter = statFileSafe(scratchFile);
    return result;
  } finally {
    try { db?.close(); } catch (_) {}
    if (!keepScratch) {
      removeFileIfExists(scratchFile);
      removeFileIfExists(walFile);
      removeFileIfExists(shmFile);
    }
  }
}

function probeMarketWrite(marketDbFile, enabled) {
  const result = {
    enabled: enabled === true,
    ok: false,
    file: marketDbFile,
    operations: [],
    error: '',
  };
  if (enabled !== true) {
    result.error = 'market write probe disabled';
    return result;
  }
  let db = null;
  try {
    db = openDb(marketDbFile);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS __sqlite_probe (
        probe_id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        note TEXT NOT NULL
      );
    `);
    result.operations.push('probe_table_ready');
    db.exec('BEGIN IMMEDIATE');
    result.operations.push('begin_immediate');
    const insert = db.prepare('INSERT INTO __sqlite_probe (created_at, note) VALUES (?, ?)');
    const inserted = insert.run(nowIso(), 'market-write-probe');
    const probeId = Number(inserted?.lastInsertRowid || 0);
    result.operations.push(`inserted_probe_id=${probeId}`);
    const row = db.prepare('SELECT probe_id, created_at, note FROM __sqlite_probe WHERE probe_id = ?').get(probeId);
    result.operations.push(`selected_probe_id=${Number(row?.probe_id || 0)}`);
    db.prepare('DELETE FROM __sqlite_probe WHERE probe_id = ?').run(probeId);
    result.operations.push('deleted_probe_row');
    db.exec('COMMIT');
    result.operations.push('commit');
    const quickRow = db.prepare('PRAGMA quick_check;').get();
    result.operations.push(`quick_check=${quickRow ? Object.values(quickRow)[0] : 'null'}`);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    result.operations.push('wal_checkpoint_truncate');
    result.ok = true;
    return result;
  } catch (error) {
    try { db?.exec('ROLLBACK'); } catch (_) {}
    result.error = String(error?.message || error);
    return result;
  } finally {
    try { db?.close(); } catch (_) {}
  }
}

function main() {
  const args = parseArgs(process.argv);
  const marketDbFile = path.join(args.dataDir, 'market.db');
  const scratchFile = path.join(args.dataDir, args.scratchName);
  const report = {
    ts: nowIso(),
    cwd: process.cwd(),
    dataDir: args.dataDir,
    marketRead: probeMarketRead(marketDbFile),
    marketWrite: probeMarketWrite(marketDbFile, args.writeMarket),
    scratchWrite: probeScratchWrite(scratchFile, args.keepScratch),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const failed = !report.marketRead.ok
    || !report.scratchWrite.ok
    || (args.writeMarket === true && !report.marketWrite.ok);
  process.exitCode = failed ? 1 : 0;
}

main();
