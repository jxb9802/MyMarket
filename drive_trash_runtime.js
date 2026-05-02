'use strict';

function createDriveTrashRuntime(deps = {}) {
  const runtime = deps.runtime;
  const store = deps.store;

  function applyDeleteMarker(entry) {
    runtime.applyDeleteMarker(entry);
    if (store) store.saveDeleteMarker(entry);
    return entry;
  }

  function isDeleted(ownerWalletId, targetType, targetId) {
    const snapshot = runtime.snapshot(ownerWalletId);
    return Object.values(snapshot.deletes || {}).some((entry) => (
      String(entry.targetType || '') === String(targetType || '')
      && String(entry.targetId || '') === String(targetId || '')
    ));
  }

  return {
    applyDeleteMarker,
    isDeleted,
  };
}

module.exports = {
  createDriveTrashRuntime,
};
