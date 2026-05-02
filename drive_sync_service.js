'use strict';

const { OBJECT_TYPES } = require('./drive_manifest_protocol');

function createDriveSyncService(deps = {}) {
  const fsService = deps.fsService;
  const chainService = deps.chainService || null;
  const runtime = deps.runtime;
  const store = deps.store;
  const cryptoService = deps.cryptoService;
  const syncedOwners = new Set();
  const syncedOwnerRevisions = new Map();

  function rebuildOwnerIndex(ownerWalletId, options = {}) {
    const safeOwner = String(ownerWalletId || '').trim();
    const objects = chainService
      ? chainService.listOwnerObjects(safeOwner)
      : fsService.listObjectPayloads().filter((entry) => String(entry?.ownerWalletId || '') === safeOwner);
    const settings = store.loadOwnerSettings(safeOwner);
    const owner = {
      ownerWalletId: safeOwner,
      rootDirId: `drive-root:${safeOwner}`,
      settings,
      dirs: {},
      files: {},
      deletes: {},
      updatedAt: new Date().toISOString(),
    };
    store.ensureRootDir(safeOwner);
    owner.dirs[owner.rootDirId] = store.loadDir(safeOwner, owner.rootDirId);
    const sorted = objects.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    for (const object of sorted) {
      if (object.objectType === OBJECT_TYPES.DIR) {
        const entry = {
          ...object,
          path: runtime.normalizePath(`${runtime.pathForDir(safeOwner, object.parentDirId || owner.rootDirId)}/${''}`),
          localRelativePath: runtime.normalizePath(`${runtime.pathForDir(safeOwner, object.parentDirId || owner.rootDirId)}/${''}`),
          name: object.encryptedName
            ? cryptoService.decryptDirName(object.encryptedName, { dirId: object.dirId }, options)
            : '',
        };
        entry.path = runtime.normalizePath(`${runtime.pathForDir(safeOwner, entry.parentDirId || owner.rootDirId)}/${entry.name}`);
        entry.localRelativePath = entry.path;
        owner.dirs[object.dirId] = store.saveDir(entry);
        continue;
      }
      if (object.objectType === OBJECT_TYPES.FILE) {
        const entry = {
          ...object,
          path: runtime.normalizePath(`${runtime.pathForDir(safeOwner, object.parentDirId || owner.rootDirId)}/placeholder`),
          localRelativePath: runtime.normalizePath(`${runtime.pathForDir(safeOwner, object.parentDirId || owner.rootDirId)}/placeholder`),
          name: object.encryptedName
            ? cryptoService.decryptFileName(object.encryptedName, { fileId: object.fileId }, options)
            : '',
        };
        entry.path = runtime.normalizePath(`${runtime.pathForDir(safeOwner, entry.parentDirId || owner.rootDirId)}/${entry.name}`);
        entry.localRelativePath = entry.path;
        owner.files[object.fileId] = store.saveFile({
          ...entry,
          downloaded: store.loadFile(safeOwner, entry.fileId)?.downloaded === true,
        });
        continue;
      }
      if (object.objectType === OBJECT_TYPES.DELETE) {
        owner.deletes[object.objectId] = store.saveDeleteMarker({ ...object });
      }
    }
    runtime.resetOwner(safeOwner);
    syncedOwners.add(safeOwner);
    if (chainService && typeof chainService.getOwnerRevision === 'function') {
      syncedOwnerRevisions.set(safeOwner, chainService.getOwnerRevision(safeOwner));
    }
    return owner;
  }

  function ensureOwnerIndex(ownerWalletId, options = {}) {
    const safeOwner = String(ownerWalletId || '').trim();
    if (!syncedOwners.has(safeOwner)) {
      const localIndex = store.loadOwnerIndex(safeOwner);
      const localDirCount = Object.keys(localIndex?.dirs || {})
        .filter((dirId) => String(dirId || '') !== String(localIndex?.rootDirId || '')).length;
      const localObjectCount = localDirCount
        + Object.keys(localIndex?.files || {}).length
        + Object.keys(localIndex?.deletes || {}).length;
      if (localObjectCount > 0) {
        syncedOwners.add(safeOwner);
        if (chainService && typeof chainService.getOwnerRevision === 'function') {
          syncedOwnerRevisions.set(safeOwner, chainService.getOwnerRevision(safeOwner));
        }
        return localIndex;
      }
    }
    if (chainService && typeof chainService.getOwnerRevision === 'function') {
      const revision = chainService.getOwnerRevision(safeOwner);
      if (revision && syncedOwnerRevisions.get(safeOwner) !== revision) {
        return rebuildOwnerIndex(safeOwner, options);
      }
    }
    if (!syncedOwners.has(safeOwner)) return rebuildOwnerIndex(safeOwner, options);
    return store.loadOwnerIndex(safeOwner);
  }

  return {
    rebuildOwnerIndex,
    ensureOwnerIndex,
  };
}

module.exports = {
  createDriveSyncService,
};
