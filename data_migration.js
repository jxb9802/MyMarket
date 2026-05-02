const fs = require('fs');
const path = require('path');

const {
  CURRENT_DATA_VERSION,
  nowIso,
  getDataDir,
  getDbFilePath,
  getRuntimeVersionFilePath,
  writeJsonAtomic,
  normalizeVersionRecord,
  writeRuntimeVersion,
  writeMetaVersion,
  getCurrentDataVersionInfo,
} = require('./data_version');

function appendMigrationLog(message, extra = {}) {
  try {
    const logDir = path.resolve(process.env.BSV_MARKET_LOG_DIR || path.join(__dirname, 'log'));
    ensureDir(logDir);
    const logFile = path.join(logDir, 'migration.log');
    const line = {
      ts: nowIso(),
      message,
      ...extra,
    };
    fs.appendFileSync(logFile, `${JSON.stringify(line)}\n`, 'utf8');
  } catch (_) {}
}

function createMigrationReporter(options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  return (event, payload = {}) => {
    appendMigrationLog(event, payload);
    if (onProgress) {
      try {
        onProgress(event, payload);
      } catch (_) {}
    }
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function pathExists(filePath) {
  try {
    fs.accessSync(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function removePathIfExists(filePath) {
  if (!pathExists(filePath)) return;
  fs.rmSync(filePath, { recursive: true, force: true });
}

function copyFileIntoBackup(sourcePath, backupRoot, dataDir, manifest) {
  if (!pathExists(sourcePath)) return;
  const relativePath = path.relative(dataDir, sourcePath);
  const targetPath = path.join(backupRoot, relativePath);
  ensureDir(path.dirname(targetPath));
  fs.copyFileSync(sourcePath, targetPath);
  manifest.files.push(relativePath);
}

function listVersion0To1CleanupPaths(dataDir = getDataDir()) {
  const entries = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
  const targets = [
    getDbFilePath(dataDir),
    `${getDbFilePath(dataDir)}-wal`,
    `${getDbFilePath(dataDir)}-shm`,
    path.join(dataDir, 'state.json'),
    path.join(dataDir, 'tx_contexts.json'),
    path.join(dataDir, 'anchors_global.json'),
    path.join(dataDir, 'p2p_sync_receipts.json'),
    path.join(dataDir, 'independent_sync_status.json'),
    path.join(dataDir, 'wallet_index_state.json'),
    path.join(dataDir, 'public_state_cache.json'),
    path.join(dataDir, 'command_queue.json'),
    path.join(dataDir, 'job_state.json'),
    getRuntimeVersionFilePath(dataDir),
  ];
  entries
    .filter((name) => String(name || '').startsWith('state.json.bak'))
    .forEach((name) => {
      targets.push(path.join(dataDir, name));
    });
  return Array.from(new Set(targets));
}

function createMigrationBackup(fromVersion, toVersion, dataDir = getDataDir(), report = appendMigrationLog) {
  const backupDir = path.join(
    dataDir,
    'migration_backups',
    `${new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')}_v${fromVersion}_to_v${toVersion}`,
  );
  const manifest = {
    fromVersion,
    toVersion,
    createdAt: nowIso(),
    files: [],
  };
  ensureDir(backupDir);
  listVersion0To1CleanupPaths(dataDir).forEach((filePath) => {
    copyFileIntoBackup(filePath, backupDir, dataDir, manifest);
  });
  writeJsonAtomic(path.join(backupDir, 'manifest.json'), manifest);
  report('migration_backup_created', {
    fromVersion,
    toVersion,
    backupDir,
    fileCount: manifest.files.length,
  });
  return { backupDir, manifest };
}

function restoreMigrationBackup(backupDir, dataDir = getDataDir(), report = appendMigrationLog) {
  const manifestPath = path.join(backupDir, 'manifest.json');
  const manifest = pathExists(manifestPath)
    ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    : { files: [] };
  listVersion0To1CleanupPaths(dataDir).forEach((filePath) => {
    removePathIfExists(filePath);
  });
  for (const relativePath of Array.isArray(manifest.files) ? manifest.files : []) {
    const sourcePath = path.join(backupDir, relativePath);
    const targetPath = path.join(dataDir, relativePath);
    if (!pathExists(sourcePath)) continue;
    ensureDir(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
  }
  report('migration_backup_restored', {
    backupDir,
    restoredCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
  });
}

function writeVersionState(record, dataDir = getDataDir()) {
  const normalized = normalizeVersionRecord(record);
  writeRuntimeVersion(normalized, dataDir);
  writeMetaVersion(normalized, dataDir);
  return normalized;
}

function migrateV0ToV1(dataDir = getDataDir(), options = {}) {
  const fromVersion = 0;
  const toVersion = 1;
  const report = createMigrationReporter(options);
  report('migration_step_started', {
    fromVersion,
    toVersion,
    label: `v${fromVersion} -> v${toVersion}`,
  });
  const backup = createMigrationBackup(fromVersion, toVersion, dataDir, report);
  const migratingRecord = {
    app_data_version: fromVersion,
    migration_status: 'migrating',
    last_migration_from: fromVersion,
    last_migration_to: toVersion,
    last_migration_at: nowIso(),
    current_step: `v${fromVersion}->v${toVersion}`,
    current_step_from: fromVersion,
    current_step_to: toVersion,
  };
  try {
    writeRuntimeVersion(migratingRecord, dataDir);
    listVersion0To1CleanupPaths(dataDir).forEach((filePath) => {
      if (filePath === getRuntimeVersionFilePath(dataDir)) return;
      removePathIfExists(filePath);
    });
    const readyRecord = {
      app_data_version: toVersion,
      migration_status: 'ready',
      last_migration_from: fromVersion,
      last_migration_to: toVersion,
      last_migration_at: nowIso(),
      current_step: '',
      current_step_from: 0,
      current_step_to: 0,
    };
    writeVersionState(readyRecord, dataDir);
    report('migration_step_completed', {
      fromVersion,
      toVersion,
      label: `v${fromVersion} -> v${toVersion}`,
      backupDir: backup.backupDir,
    });
    report('migration_v0_to_v1_ok', {
      backupDir: backup.backupDir,
      dataDir,
    });
    return {
      migrated: true,
      fromVersion,
      toVersion,
      backupDir: backup.backupDir,
    };
  } catch (error) {
    try {
      restoreMigrationBackup(backup.backupDir, dataDir, report);
    } catch (restoreError) {
      report('migration_restore_failed', {
        backupDir: backup.backupDir,
        message: String(restoreError?.message || restoreError || 'restore failed'),
      });
    }
    report('migration_step_failed', {
      fromVersion,
      toVersion,
      label: `v${fromVersion} -> v${toVersion}`,
      backupDir: backup.backupDir,
      message: String(error?.message || error || 'migration failed'),
    });
    report('migration_v0_to_v1_failed', {
      backupDir: backup.backupDir,
      message: String(error?.message || error || 'migration failed'),
    });
    throw error;
  }
}

function ensureDataVersion(dataDir = getDataDir(), options = {}) {
  ensureDir(dataDir);
  const report = createMigrationReporter(options);
  let info = getCurrentDataVersionInfo(dataDir);
  report('migration_check_started', {
    currentVersion: info.version,
    targetVersion: CURRENT_DATA_VERSION,
    source: info.source,
  });
  if (info.version > CURRENT_DATA_VERSION) {
    throw new Error(`Data version ${info.version} is newer than supported version ${CURRENT_DATA_VERSION}`);
  }
  const steps = [];
  while (info.version < CURRENT_DATA_VERSION) {
    if (info.version === 0) {
      steps.push(migrateV0ToV1(dataDir, options));
      info = getCurrentDataVersionInfo(dataDir);
      continue;
    }
    throw new Error(`No migration path from data version ${info.version} to ${CURRENT_DATA_VERSION}`);
  }
  if (info.version === CURRENT_DATA_VERSION && info.record?.migration_status !== 'ready') {
    const repaired = {
      app_data_version: CURRENT_DATA_VERSION,
      migration_status: 'ready',
      last_migration_from: info.record?.last_migration_from || CURRENT_DATA_VERSION,
      last_migration_to: info.record?.last_migration_to || CURRENT_DATA_VERSION,
      last_migration_at: nowIso(),
      current_step: '',
      current_step_from: 0,
      current_step_to: 0,
    };
    writeVersionState(repaired, dataDir);
    info = getCurrentDataVersionInfo(dataDir);
  }
  report('migration_check_completed', {
    currentVersion: info.version,
    targetVersion: CURRENT_DATA_VERSION,
    source: info.source,
    migrated: steps.length > 0,
    stepCount: steps.length,
  });
  return {
    currentVersion: info.version,
    source: info.source,
    migrated: steps.length > 0,
    steps,
  };
}

module.exports = {
  listVersion0To1CleanupPaths,
  createMigrationBackup,
  restoreMigrationBackup,
  migrateV0ToV1,
  ensureDataVersion,
};
