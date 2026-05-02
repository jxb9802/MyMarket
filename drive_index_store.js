'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePath(pathText = '') {
  const parts = String(pathText || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return `/${parts.join('/')}`.replace(/\/+/g, '/');
}

function createDriveIndexStore(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || path.join(__dirname, 'data')));
  const driveDir = ensureDir(path.join(dataDir, 'drive'));
  const dbFile = path.join(driveDir, 'drive.db');
  const db = new DatabaseSync(dbFile);

  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS drive_owner_settings (
      owner_wallet_id TEXT PRIMARY KEY,
      root_local_dir TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drive_dirs (
      owner_wallet_id TEXT NOT NULL,
      dir_id TEXT NOT NULL,
      parent_dir_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      dir_path TEXT NOT NULL DEFAULT '/',
      local_relative_path TEXT NOT NULL DEFAULT '/',
      encrypted_name_json TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (owner_wallet_id, dir_id)
    );

    CREATE INDEX IF NOT EXISTS drive_dirs_parent_idx
      ON drive_dirs(owner_wallet_id, parent_dir_id, deleted, name);

    CREATE INDEX IF NOT EXISTS drive_dirs_path_idx
      ON drive_dirs(owner_wallet_id, dir_path);

    CREATE TABLE IF NOT EXISTS drive_files (
      owner_wallet_id TEXT NOT NULL,
      file_id TEXT NOT NULL,
      parent_dir_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL DEFAULT '/',
      local_relative_path TEXT NOT NULL DEFAULT '/',
      encrypted_name_json TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL DEFAULT 0,
      original_size INTEGER NOT NULL DEFAULT 0,
      chunk_count INTEGER NOT NULL DEFAULT 1,
      content_ref TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      downloaded INTEGER NOT NULL DEFAULT 0,
      onchain_status TEXT NOT NULL DEFAULT 'anchored',
      anchor_error TEXT NOT NULL DEFAULT '',
      upload_task_id TEXT NOT NULL DEFAULT '',
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (owner_wallet_id, file_id)
    );

    CREATE INDEX IF NOT EXISTS drive_files_parent_idx
      ON drive_files(owner_wallet_id, parent_dir_id, deleted, name);

    CREATE INDEX IF NOT EXISTS drive_files_path_idx
      ON drive_files(owner_wallet_id, file_path);

    CREATE TABLE IF NOT EXISTS drive_deletes (
      owner_wallet_id TEXT NOT NULL,
      object_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      deleted_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (owner_wallet_id, object_id)
    );

    CREATE INDEX IF NOT EXISTS drive_deletes_target_idx
      ON drive_deletes(owner_wallet_id, target_type, target_id);

    CREATE TABLE IF NOT EXISTS drive_tasks (
      task_id TEXT PRIMARY KEY,
      task_kind TEXT NOT NULL DEFAULT '',
      owner_wallet_id TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL
    );
  `);
  for (const statement of [
    "ALTER TABLE drive_files ADD COLUMN onchain_status TEXT NOT NULL DEFAULT 'anchored'",
    "ALTER TABLE drive_files ADD COLUMN anchor_error TEXT NOT NULL DEFAULT ''",
    "ALTER TABLE drive_files ADD COLUMN upload_task_id TEXT NOT NULL DEFAULT ''",
  ]) {
    try { db.exec(statement); } catch (_) {}
  }

  const upsertOwnerSettings = db.prepare(`
    INSERT INTO drive_owner_settings (owner_wallet_id, root_local_dir, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(owner_wallet_id) DO UPDATE SET
      root_local_dir = excluded.root_local_dir,
      updated_at = excluded.updated_at
  `);
  const selectOwnerSettings = db.prepare(`
    SELECT owner_wallet_id, root_local_dir, updated_at
    FROM drive_owner_settings
    WHERE owner_wallet_id = ?
  `);

  const upsertDirStmt = db.prepare(`
    INSERT INTO drive_dirs (
      owner_wallet_id, dir_id, parent_dir_id, name, dir_path, local_relative_path,
      encrypted_name_json, deleted, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_wallet_id, dir_id) DO UPDATE SET
      parent_dir_id = excluded.parent_dir_id,
      name = excluded.name,
      dir_path = excluded.dir_path,
      local_relative_path = excluded.local_relative_path,
      encrypted_name_json = excluded.encrypted_name_json,
      deleted = excluded.deleted,
      updated_at = excluded.updated_at,
      version = excluded.version
  `);
  const selectDirStmt = db.prepare(`
    SELECT * FROM drive_dirs
    WHERE owner_wallet_id = ? AND dir_id = ?
    LIMIT 1
  `);
  const listDirsByParentStmt = db.prepare(`
    SELECT * FROM drive_dirs
    WHERE owner_wallet_id = ? AND parent_dir_id = ? AND deleted = 0
    ORDER BY name COLLATE NOCASE ASC
  `);
  const listAllDirsStmt = db.prepare(`
    SELECT * FROM drive_dirs
    WHERE owner_wallet_id = ? AND deleted = 0
    ORDER BY CASE WHEN dir_path = '/' THEN 0 ELSE 1 END, dir_path COLLATE NOCASE ASC
  `);
  const findDirByPathStmt = db.prepare(`
    SELECT * FROM drive_dirs
    WHERE owner_wallet_id = ? AND dir_path = ? AND deleted = 0
    LIMIT 1
  `);
  const deleteOwnerDirsStmt = db.prepare(`DELETE FROM drive_dirs WHERE owner_wallet_id = ?`);

  const upsertFileStmt = db.prepare(`
    INSERT INTO drive_files (
      owner_wallet_id, file_id, parent_dir_id, name, file_path, local_relative_path,
      encrypted_name_json, size, original_size, chunk_count, content_ref, content_hash,
      downloaded, onchain_status, anchor_error, upload_task_id, deleted, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_wallet_id, file_id) DO UPDATE SET
      parent_dir_id = excluded.parent_dir_id,
      name = excluded.name,
      file_path = excluded.file_path,
      local_relative_path = excluded.local_relative_path,
      encrypted_name_json = excluded.encrypted_name_json,
      size = excluded.size,
      original_size = excluded.original_size,
      chunk_count = excluded.chunk_count,
      content_ref = excluded.content_ref,
      content_hash = excluded.content_hash,
      downloaded = excluded.downloaded,
      onchain_status = excluded.onchain_status,
      anchor_error = excluded.anchor_error,
      upload_task_id = excluded.upload_task_id,
      deleted = excluded.deleted,
      updated_at = excluded.updated_at,
      version = excluded.version
  `);
  const selectFileStmt = db.prepare(`
    SELECT * FROM drive_files
    WHERE owner_wallet_id = ? AND file_id = ?
    LIMIT 1
  `);
  const listFilesByParentStmt = db.prepare(`
    SELECT * FROM drive_files
    WHERE owner_wallet_id = ? AND parent_dir_id = ? AND deleted = 0
    ORDER BY name COLLATE NOCASE ASC
  `);
  const listAllFilesStmt = db.prepare(`
    SELECT * FROM drive_files
    WHERE owner_wallet_id = ? AND deleted = 0
    ORDER BY file_path COLLATE NOCASE ASC
  `);
  const listFilesUnderDirStmt = db.prepare(`
    SELECT * FROM drive_files
    WHERE owner_wallet_id = ?
      AND deleted = 0
      AND (parent_dir_id = ? OR file_path LIKE ?)
    ORDER BY file_path COLLATE NOCASE ASC
  `);
  const markFileDownloadedStmt = db.prepare(`
    UPDATE drive_files
    SET downloaded = ?, local_relative_path = ?, updated_at = ?
    WHERE owner_wallet_id = ? AND file_id = ?
  `);
  const deleteOwnerFilesStmt = db.prepare(`DELETE FROM drive_files WHERE owner_wallet_id = ?`);
  const markDirDeletedStmt = db.prepare(`
    UPDATE drive_dirs
    SET deleted = ?, updated_at = ?
    WHERE owner_wallet_id = ? AND dir_id = ?
  `);
  const markFileDeletedStmt = db.prepare(`
    UPDATE drive_files
    SET deleted = ?, updated_at = ?
    WHERE owner_wallet_id = ? AND file_id = ?
  `);
  const markDirsUnderPathDeletedStmt = db.prepare(`
    UPDATE drive_dirs
    SET deleted = ?, updated_at = ?
    WHERE owner_wallet_id = ?
      AND dir_path LIKE ?
  `);
  const markFilesUnderPathDeletedStmt = db.prepare(`
    UPDATE drive_files
    SET deleted = ?, updated_at = ?
    WHERE owner_wallet_id = ?
      AND file_path LIKE ?
  `);

  const upsertDeleteStmt = db.prepare(`
    INSERT INTO drive_deletes (
      owner_wallet_id, object_id, target_type, target_id, deleted_at, created_at, updated_at, version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_wallet_id, object_id) DO UPDATE SET
      target_type = excluded.target_type,
      target_id = excluded.target_id,
      deleted_at = excluded.deleted_at,
      updated_at = excluded.updated_at,
      version = excluded.version
  `);
  const listDeletesStmt = db.prepare(`
    SELECT * FROM drive_deletes
    WHERE owner_wallet_id = ?
    ORDER BY deleted_at ASC
  `);
  const deleteOwnerDeletesStmt = db.prepare(`DELETE FROM drive_deletes WHERE owner_wallet_id = ?`);

  const upsertTaskStmt = db.prepare(`
    INSERT INTO drive_tasks (task_id, task_kind, owner_wallet_id, payload_json, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(task_id) DO UPDATE SET
      task_kind = excluded.task_kind,
      owner_wallet_id = excluded.owner_wallet_id,
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `);
  const selectTaskStmt = db.prepare(`SELECT * FROM drive_tasks WHERE task_id = ? LIMIT 1`);
  const listTasksStmt = db.prepare(`SELECT * FROM drive_tasks ORDER BY updated_at DESC`);
  const deleteTaskStmt = db.prepare(`DELETE FROM drive_tasks WHERE task_id = ?`);

  function parseJson(text, fallback) {
    try {
      return text ? JSON.parse(text) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function rootDirId(ownerWalletId) {
    return `drive-root:${String(ownerWalletId || '').trim()}`;
  }

  function normalizeDirRow(row) {
    if (!row) return null;
    return {
      ownerWalletId: String(row.owner_wallet_id || ''),
      dirId: String(row.dir_id || ''),
      parentDirId: String(row.parent_dir_id || ''),
      name: String(row.name || ''),
      path: normalizePath(String(row.dir_path || '/')),
      localRelativePath: normalizePath(String(row.local_relative_path || row.dir_path || '/')),
      encryptedName: parseJson(String(row.encrypted_name_json || ''), null),
      deleted: Number(row.deleted || 0) === 1,
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      version: Math.max(1, Number(row.version || 1)),
    };
  }

  function normalizeFileRow(row) {
    if (!row) return null;
    return {
      ownerWalletId: String(row.owner_wallet_id || ''),
      fileId: String(row.file_id || ''),
      parentDirId: String(row.parent_dir_id || ''),
      name: String(row.name || ''),
      path: normalizePath(String(row.file_path || '/')),
      localRelativePath: normalizePath(String(row.local_relative_path || row.file_path || '/')),
      encryptedName: parseJson(String(row.encrypted_name_json || ''), null),
      size: Math.max(0, Number(row.size || 0)),
      originalSize: Math.max(0, Number(row.original_size || 0)),
      chunkCount: Math.max(1, Number(row.chunk_count || 1)),
      contentRef: String(row.content_ref || ''),
      contentHash: String(row.content_hash || ''),
      downloaded: Number(row.downloaded || 0) === 1,
      onchainStatus: String(row.onchain_status || 'anchored'),
      anchorError: String(row.anchor_error || ''),
      uploadTaskId: String(row.upload_task_id || ''),
      deleted: Number(row.deleted || 0) === 1,
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      version: Math.max(1, Number(row.version || 1)),
    };
  }

  function normalizeDeleteRow(row) {
    if (!row) return null;
    return {
      ownerWalletId: String(row.owner_wallet_id || ''),
      objectId: String(row.object_id || ''),
      targetType: String(row.target_type || ''),
      targetId: String(row.target_id || ''),
      deletedAt: String(row.deleted_at || ''),
      createdAt: String(row.created_at || ''),
      updatedAt: String(row.updated_at || ''),
      version: Math.max(1, Number(row.version || 1)),
    };
  }

  function ensureOwnerSettings(ownerWalletId) {
    const safeOwner = String(ownerWalletId || '').trim();
    const row = selectOwnerSettings.get(safeOwner);
    if (row) return row;
    upsertOwnerSettings.run(safeOwner, '', nowIso());
    return selectOwnerSettings.get(safeOwner);
  }

  function ensureRootDir(ownerWalletId) {
    const safeOwner = String(ownerWalletId || '').trim();
    const existing = selectDirStmt.get(safeOwner, rootDirId(safeOwner));
    if (existing) return normalizeDirRow(existing);
    const ts = nowIso();
    upsertDirStmt.run(
      safeOwner,
      rootDirId(safeOwner),
      '',
      '',
      '/',
      '/',
      '',
      0,
      ts,
      ts,
      1,
    );
    return normalizeDirRow(selectDirStmt.get(safeOwner, rootDirId(safeOwner)));
  }

  function loadOwnerSettings(ownerWalletId) {
    const row = ensureOwnerSettings(ownerWalletId);
    return {
      rootLocalDir: String(row?.root_local_dir || ''),
      updatedAt: String(row?.updated_at || ''),
    };
  }

  function saveOwnerSettings(ownerWalletId, settingsPatch) {
    const safeOwner = String(ownerWalletId || '').trim();
    const current = loadOwnerSettings(safeOwner);
    const next = {
      rootLocalDir: String(settingsPatch?.rootLocalDir ?? current.rootLocalDir ?? '').trim(),
      updatedAt: nowIso(),
    };
    upsertOwnerSettings.run(safeOwner, next.rootLocalDir, next.updatedAt);
    return next;
  }

  function saveDir(entry) {
    const safeOwner = String(entry?.ownerWalletId || '').trim();
    const dirId = String(entry?.dirId || '').trim();
    if (!safeOwner || !dirId) throw new Error('ownerWalletId and dirId are required');
    ensureRootDir(safeOwner);
    const ts = String(entry?.updatedAt || nowIso());
    upsertDirStmt.run(
      safeOwner,
      dirId,
      String(entry?.parentDirId || ''),
      String(entry?.name || ''),
      normalizePath(String(entry?.path || entry?.localRelativePath || '/')),
      normalizePath(String(entry?.localRelativePath || entry?.path || '/')),
      entry?.encryptedName ? JSON.stringify(entry.encryptedName) : '',
      entry?.deleted === true ? 1 : 0,
      String(entry?.createdAt || ts),
      ts,
      Math.max(1, Number(entry?.version || 1)),
    );
    return loadDir(safeOwner, dirId);
  }

  function saveFile(entry) {
    const safeOwner = String(entry?.ownerWalletId || '').trim();
    const fileId = String(entry?.fileId || '').trim();
    if (!safeOwner || !fileId) throw new Error('ownerWalletId and fileId are required');
    const ts = String(entry?.updatedAt || nowIso());
    upsertFileStmt.run(
      safeOwner,
      fileId,
      String(entry?.parentDirId || ''),
      String(entry?.name || ''),
      normalizePath(String(entry?.path || entry?.localRelativePath || '/')),
      normalizePath(String(entry?.localRelativePath || entry?.path || '/')),
      entry?.encryptedName ? JSON.stringify(entry.encryptedName) : '',
      Math.max(0, Number(entry?.size || 0)),
      Math.max(0, Number(entry?.originalSize || 0)),
      Math.max(1, Number(entry?.chunkCount || 1)),
      String(entry?.contentRef || ''),
      String(entry?.contentHash || ''),
      entry?.downloaded === true ? 1 : 0,
      String(entry?.onchainStatus || entry?.onchain_status || 'anchored'),
      String(entry?.anchorError || entry?.anchor_error || ''),
      String(entry?.uploadTaskId || entry?.upload_task_id || ''),
      entry?.deleted === true ? 1 : 0,
      String(entry?.createdAt || ts),
      ts,
      Math.max(1, Number(entry?.version || 1)),
    );
    return loadFile(safeOwner, fileId);
  }

  function saveDeleteMarker(entry) {
    const safeOwner = String(entry?.ownerWalletId || '').trim();
    const objectId = String(entry?.objectId || '').trim();
    if (!safeOwner || !objectId) throw new Error('ownerWalletId and objectId are required');
    const ts = String(entry?.updatedAt || nowIso());
    const targetType = String(entry?.targetType || '').trim();
    const targetId = String(entry?.targetId || '').trim();
    upsertDeleteStmt.run(
      safeOwner,
      objectId,
      targetType,
      targetId,
      String(entry?.deletedAt || ts),
      String(entry?.createdAt || ts),
      ts,
      Math.max(1, Number(entry?.version || 1)),
    );
    if (targetType === 'dir' && targetId) markDirDeleted(safeOwner, targetId, true);
    if (targetType === 'file' && targetId) markFileDeleted(safeOwner, targetId, true);
    return normalizeDeleteRow(listDeletesStmt.all(safeOwner).find((row) => String(row.object_id || '') === objectId) || null);
  }

  function saveTask(task) {
    const safeTaskId = String(task?.taskId || '').trim();
    if (!safeTaskId) throw new Error('taskId is required');
    const payload = { ...task };
    upsertTaskStmt.run(
      safeTaskId,
      String(task?.taskKind || task?.status || ''),
      String(task?.ownerWalletId || ''),
      JSON.stringify(payload),
      String(task?.updatedAt || nowIso()),
    );
    return loadTask(safeTaskId);
  }

  function loadTask(taskId) {
    const row = selectTaskStmt.get(String(taskId || '').trim());
    return row ? parseJson(String(row.payload_json || '{}'), null) : null;
  }

  function loadTasks() {
    const tasks = {};
    for (const row of listTasksStmt.all()) {
      const payload = parseJson(String(row.payload_json || '{}'), null);
      if (payload?.taskId) tasks[payload.taskId] = payload;
    }
    return tasks;
  }

  function deleteTask(taskId) {
    deleteTaskStmt.run(String(taskId || '').trim());
  }

  function loadDir(ownerWalletId, dirId) {
    ensureRootDir(ownerWalletId);
    return normalizeDirRow(selectDirStmt.get(String(ownerWalletId || '').trim(), String(dirId || '').trim()));
  }

  function loadFile(ownerWalletId, fileId) {
    return normalizeFileRow(selectFileStmt.get(String(ownerWalletId || '').trim(), String(fileId || '').trim()));
  }

  function listDirEntries(ownerWalletId, parentDirId) {
    const safeOwner = String(ownerWalletId || '').trim();
    const safeParent = String(parentDirId || '').trim() || rootDirId(safeOwner);
    return {
      dirs: listDirsByParentStmt.all(safeOwner, safeParent).map(normalizeDirRow),
      files: listFilesByParentStmt.all(safeOwner, safeParent).map(normalizeFileRow),
    };
  }

  function listAllDirs(ownerWalletId) {
    ensureRootDir(ownerWalletId);
    return listAllDirsStmt.all(String(ownerWalletId || '').trim()).map(normalizeDirRow);
  }

  function listAllFiles(ownerWalletId) {
    return listAllFilesStmt.all(String(ownerWalletId || '').trim()).map(normalizeFileRow);
  }

  function listDeletes(ownerWalletId) {
    return listDeletesStmt.all(String(ownerWalletId || '').trim()).map(normalizeDeleteRow);
  }

  function findDirByPath(ownerWalletId, dirPath) {
    const normalized = normalizePath(dirPath);
    const row = findDirByPathStmt.get(String(ownerWalletId || '').trim(), normalized);
    return normalizeDirRow(row);
  }

  function listFilesUnderDir(ownerWalletId, dirId) {
    const dir = loadDir(ownerWalletId, dirId);
    if (!dir) return [];
    const prefix = dir.path === '/' ? '/%' : `${dir.path}/%`;
    return listFilesUnderDirStmt.all(String(ownerWalletId || '').trim(), String(dirId || '').trim(), prefix).map(normalizeFileRow);
  }

  function markFileDownloaded(ownerWalletId, fileId, downloaded, localRelativePath = '') {
    const safeOwner = String(ownerWalletId || '').trim();
    const safeFileId = String(fileId || '').trim();
    const file = loadFile(safeOwner, safeFileId);
    if (!file) return null;
    markFileDownloadedStmt.run(
      downloaded === true ? 1 : 0,
      normalizePath(String(localRelativePath || file.localRelativePath || file.path || '/')),
      nowIso(),
      safeOwner,
      safeFileId,
    );
    return loadFile(safeOwner, safeFileId);
  }

  function markDirDeleted(ownerWalletId, dirId, deleted = true) {
    const safeOwner = String(ownerWalletId || '').trim();
    const safeDirId = String(dirId || '').trim();
    const dir = loadDir(safeOwner, safeDirId);
    const deletedValue = deleted === true ? 1 : 0;
    const ts = nowIso();
    markDirDeletedStmt.run(deletedValue, ts, safeOwner, safeDirId);
    if (dir?.path) {
      const normalized = normalizePath(dir.path);
      const prefix = normalized === '/' ? '/%' : `${normalized}/%`;
      markDirsUnderPathDeletedStmt.run(deletedValue, ts, safeOwner, prefix);
      markFilesUnderPathDeletedStmt.run(deletedValue, ts, safeOwner, prefix);
    }
    return loadDir(safeOwner, safeDirId);
  }

  function markFileDeleted(ownerWalletId, fileId, deleted = true) {
    markFileDeletedStmt.run(
      deleted === true ? 1 : 0,
      nowIso(),
      String(ownerWalletId || '').trim(),
      String(fileId || '').trim(),
    );
    return loadFile(ownerWalletId, fileId);
  }

  function loadOwnerIndex(ownerWalletId) {
    const safeOwner = String(ownerWalletId || '').trim();
    const root = ensureRootDir(safeOwner);
    const dirs = {};
    const files = {};
    const deletes = {};
    for (const entry of listAllDirs(safeOwner)) dirs[entry.dirId] = entry;
    for (const entry of listAllFiles(safeOwner)) files[entry.fileId] = entry;
    for (const entry of listDeletes(safeOwner)) deletes[entry.objectId] = entry;
    return {
      ownerWalletId: safeOwner,
      rootDirId: root.dirId,
      settings: loadOwnerSettings(safeOwner),
      dirs,
      files,
      deletes,
      updatedAt: nowIso(),
    };
  }

  function replaceOwnerIndex(ownerWalletId, ownerIndex) {
    const safeOwner = String(ownerWalletId || '').trim();
    db.exec('BEGIN IMMEDIATE');
    try {
      deleteOwnerDirsStmt.run(safeOwner);
      deleteOwnerFilesStmt.run(safeOwner);
      deleteOwnerDeletesStmt.run(safeOwner);
      ensureOwnerSettings(safeOwner);
      const settings = ownerIndex?.settings && typeof ownerIndex.settings === 'object' ? ownerIndex.settings : null;
      if (settings) saveOwnerSettings(safeOwner, settings);
      const dirs = ownerIndex?.dirs && typeof ownerIndex.dirs === 'object' ? Object.values(ownerIndex.dirs) : [];
      const files = ownerIndex?.files && typeof ownerIndex.files === 'object' ? Object.values(ownerIndex.files) : [];
      const deletes = ownerIndex?.deletes && typeof ownerIndex.deletes === 'object' ? Object.values(ownerIndex.deletes) : [];
      for (const entry of dirs) saveDir(entry);
      for (const entry of files) saveFile(entry);
      for (const entry of deletes) saveDeleteMarker(entry);
      if (!dirs.some((entry) => String(entry?.dirId || '') === rootDirId(safeOwner))) ensureRootDir(safeOwner);
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
    return loadOwnerIndex(safeOwner);
  }

  return {
    dbFile,
    normalizePath,
    ensureRootDir,
    loadOwnerSettings,
    saveOwnerSettings,
    saveDir,
    saveFile,
    saveDeleteMarker,
    saveTask,
    loadTask,
    loadTasks,
    deleteTask,
    loadDir,
    loadFile,
    listDirEntries,
    listAllDirs,
    listAllFiles,
    listDeletes,
    findDirByPath,
    listFilesUnderDir,
    markFileDownloaded,
    markDirDeleted,
    markFileDeleted,
    loadOwnerIndex,
    replaceOwnerIndex,
  };
}

module.exports = {
  createDriveIndexStore,
};
