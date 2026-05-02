'use strict';

function normalizePath(pathText = '') {
  const parts = String(pathText || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return `/${parts.join('/')}`.replace(/\/+/g, '/');
}

function createOwnerState(ownerWalletId, store) {
  const safeOwner = String(ownerWalletId || '').trim();
  const root = store.ensureRootDir(safeOwner);
  return {
    ownerWalletId: safeOwner,
    rootDirId: root.dirId,
    settings: store.loadOwnerSettings(safeOwner),
    dirsById: new Map([[root.dirId, root]]),
    filesById: new Map(),
    deleteByObjectId: new Map(),
    childrenByDirId: new Map(),
    loadedDirIds: new Set(),
  };
}

function createDriveIndexRuntime(deps = {}) {
  const store = deps.store;
  const owners = new Map();

  function ownerState(ownerWalletId) {
    const safeOwner = String(ownerWalletId || '').trim();
    if (!owners.has(safeOwner)) owners.set(safeOwner, createOwnerState(safeOwner, store));
    return owners.get(safeOwner);
  }

  function resetOwner(ownerWalletId) {
    const safeOwner = String(ownerWalletId || '').trim();
    owners.set(safeOwner, createOwnerState(safeOwner, store));
    return owners.get(safeOwner);
  }

  function refreshOwnerSettings(ownerWalletId) {
    const owner = ownerState(ownerWalletId);
    owner.settings = store.loadOwnerSettings(owner.ownerWalletId);
    return owner.settings;
  }

  function loadOwner(ownerWalletId) {
    const owner = ownerState(ownerWalletId);
    return {
      ownerWalletId: owner.ownerWalletId,
      rootDirId: owner.rootDirId,
      settings: { ...owner.settings },
    };
  }

  function cacheDir(owner, entry) {
    if (!entry?.dirId) return null;
    owner.dirsById.set(entry.dirId, { ...entry });
    return owner.dirsById.get(entry.dirId) || null;
  }

  function cacheFile(owner, entry) {
    if (!entry?.fileId) return null;
    owner.filesById.set(entry.fileId, { ...entry });
    return owner.filesById.get(entry.fileId) || null;
  }

  function markChildren(owner, dirId, dirs, files) {
    owner.childrenByDirId.set(String(dirId || '').trim(), {
      dirs: dirs.map((entry) => entry.dirId),
      files: files.map((entry) => entry.fileId),
    });
    owner.loadedDirIds.add(String(dirId || '').trim());
  }

  function reloadDirChildren(owner, dirId, options = {}) {
    const safeDirId = String(dirId || '').trim() || owner.rootDirId;
    const listing = store.listDirEntries(owner.ownerWalletId, safeDirId);
    const dirs = listing.dirs.map((entry) => cacheDir(owner, entry)).filter(Boolean);
    const files = listing.files.map((entry) => cacheFile(owner, entry)).filter(Boolean);
    markChildren(owner, safeDirId, dirs, files);
    if (options.preloadChildDirs === true) {
      for (const child of dirs) {
        if (!owner.loadedDirIds.has(child.dirId)) continue;
        reloadDirChildren(owner, child.dirId, { preloadChildDirs: false });
      }
    }
    return owner.childrenByDirId.get(safeDirId) || { dirs: [], files: [] };
  }

  function loadDir(ownerWalletId, dirId) {
    const owner = ownerState(ownerWalletId);
    const safeDirId = String(dirId || '').trim() || owner.rootDirId;
    if (owner.dirsById.has(safeDirId)) return owner.dirsById.get(safeDirId) || null;
    const entry = store.loadDir(owner.ownerWalletId, safeDirId);
    return entry ? cacheDir(owner, entry) : null;
  }

  function loadFile(ownerWalletId, fileId) {
    const owner = ownerState(ownerWalletId);
    const safeFileId = String(fileId || '').trim();
    if (owner.filesById.has(safeFileId)) return owner.filesById.get(safeFileId) || null;
    const entry = store.loadFile(owner.ownerWalletId, safeFileId);
    return entry ? cacheFile(owner, entry) : null;
  }

  function ensureDirLoaded(ownerWalletId, dirId, options = {}) {
    const owner = ownerState(ownerWalletId);
    const safeDirId = String(dirId || '').trim() || owner.rootDirId;
    loadDir(owner.ownerWalletId, safeDirId);
    if (owner.loadedDirIds.has(safeDirId) && options.force !== true) {
      return owner.childrenByDirId.get(safeDirId) || { dirs: [], files: [] };
    }
    const result = reloadDirChildren(owner, safeDirId, options);
    if (options.preloadChildDirs === true) {
      for (const childId of result.dirs || []) {
        const child = owner.dirsById.get(childId);
        if (!child) continue;
        if (!owner.loadedDirIds.has(child.dirId)) {
          reloadDirChildren(owner, child.dirId, { preloadChildDirs: false });
        }
      }
    }
    return owner.childrenByDirId.get(safeDirId) || { dirs: [], files: [] };
  }

  function listDir(ownerWalletId, dirId = '', options = {}) {
    const owner = ownerState(ownerWalletId);
    const safeDirId = String(dirId || '').trim() || owner.rootDirId;
    const entryIds = ensureDirLoaded(owner.ownerWalletId, safeDirId, options);
    return {
      dirs: (entryIds?.dirs || []).map((childId) => owner.dirsById.get(childId)).filter((entry) => entry && entry.deleted !== true),
      files: (entryIds?.files || []).map((childId) => owner.filesById.get(childId)).filter((entry) => entry && entry.deleted !== true),
    };
  }

  function getDirById(ownerWalletId, dirId) {
    return loadDir(ownerWalletId, dirId);
  }

  function getFileById(ownerWalletId, fileId) {
    return loadFile(ownerWalletId, fileId);
  }

  function pathForDir(ownerWalletId, dirId) {
    const entry = loadDir(ownerWalletId, dirId);
    return entry ? normalizePath(entry.path || '/') : '/';
  }

  function buildFileRelativePath(ownerWalletId, fileId) {
    const entry = loadFile(ownerWalletId, fileId);
    return entry ? normalizePath(entry.path || entry.localRelativePath || '/') : '';
  }

  function findDirByPath(ownerWalletId, dirPath = '') {
    const owner = ownerState(ownerWalletId);
    const entry = store.findDirByPath(owner.ownerWalletId, dirPath);
    if (!entry) return '';
    cacheDir(owner, entry);
    return entry.dirId;
  }

  function allVisibleFiles(ownerWalletId) {
    return store.listAllFiles(String(ownerWalletId || '').trim());
  }

  function loadedTree(ownerWalletId) {
    const owner = ownerState(ownerWalletId);
    const loaded = [];
    for (const dirId of owner.loadedDirIds) {
      const children = owner.childrenByDirId.get(dirId) || { dirs: [] };
      const entry = owner.dirsById.get(dirId);
      if (entry) loaded.push(entry);
      for (const childId of children.dirs || []) {
        const child = owner.dirsById.get(childId);
        if (child) loaded.push(child);
      }
    }
    if (loaded.length === 0) {
      const root = loadDir(owner.ownerWalletId, owner.rootDirId);
      return root ? [root] : [];
    }
    const seen = new Map();
    for (const entry of loaded) {
      if (entry?.dirId) seen.set(entry.dirId, entry);
    }
    return Array.from(seen.values())
      .sort((a, b) => String(a.path || '/').localeCompare(String(b.path || '/')));
  }

  function snapshot(ownerWalletId) {
    return store.loadOwnerIndex(String(ownerWalletId || '').trim());
  }

  function upsertDir(entry) {
    const owner = ownerState(entry.ownerWalletId);
    const saved = cacheDir(owner, entry);
    if (saved?.parentDirId && owner.loadedDirIds.has(saved.parentDirId)) {
      ensureDirLoaded(owner.ownerWalletId, saved.parentDirId, { force: true });
    }
    return saved;
  }

  function upsertFile(entry) {
    const owner = ownerState(entry.ownerWalletId);
    const saved = cacheFile(owner, entry);
    if (saved?.parentDirId && owner.loadedDirIds.has(saved.parentDirId)) {
      ensureDirLoaded(owner.ownerWalletId, saved.parentDirId, { force: true });
    }
    return saved;
  }

  function applyDeleteMarker(entry) {
    const owner = ownerState(entry.ownerWalletId);
    owner.deleteByObjectId.set(entry.objectId, { ...entry });
    if (String(entry.targetType || '') === 'dir') {
      const dir = loadDir(owner.ownerWalletId, entry.targetId);
      if (dir) dir.deleted = true;
      if (dir?.parentDirId && owner.loadedDirIds.has(dir.parentDirId)) ensureDirLoaded(owner.ownerWalletId, dir.parentDirId, { force: true });
    }
    if (String(entry.targetType || '') === 'file') {
      const file = loadFile(owner.ownerWalletId, entry.targetId);
      if (file) file.deleted = true;
      if (file?.parentDirId && owner.loadedDirIds.has(file.parentDirId)) ensureDirLoaded(owner.ownerWalletId, file.parentDirId, { force: true });
    }
    return entry;
  }

  return {
    loadOwner,
    resetOwner,
    refreshOwnerSettings,
    loadDir,
    loadFile,
    ensureDirLoaded,
    upsertDir,
    upsertFile,
    applyDeleteMarker,
    getDirById,
    getFileById,
    listDir,
    findDirByPath,
    buildFileRelativePath,
    allVisibleFiles,
    snapshot,
    pathForDir,
    normalizePath,
    loadedTree,
  };
}

module.exports = {
  createDriveIndexRuntime,
};
