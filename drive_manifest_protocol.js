'use strict';

const OBJECT_TYPES = Object.freeze({
  DIR: 'drive_dir',
  FILE: 'drive_file',
  CHUNK: 'drive_chunk',
  DELETE: 'drive_delete',
});

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeInt(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : fallback;
}

function validateBaseFields(input = {}) {
  const objectType = normalizeString(input.objectType);
  const objectId = normalizeString(input.objectId);
  const ownerWalletId = normalizeString(input.ownerWalletId);
  if (!objectType) throw new Error('objectType is required');
  if (!objectId) throw new Error('objectId is required');
  if (!ownerWalletId) throw new Error('ownerWalletId is required');
  return {
    objectType,
    objectId,
    ownerWalletId,
    createdAt: normalizeString(input.createdAt) || nowIso(),
    updatedAt: normalizeString(input.updatedAt) || nowIso(),
    version: Math.max(1, normalizeInt(input.version, 1)),
  };
}

function buildDirObject(input = {}) {
  const base = validateBaseFields({
    ...input,
    objectType: OBJECT_TYPES.DIR,
    objectId: normalizeString(input.dirId || input.objectId),
  });
  return {
    ...base,
    dirId: base.objectId,
    parentDirId: normalizeString(input.parentDirId),
    encryptedName: input.encryptedName && typeof input.encryptedName === 'object' ? { ...input.encryptedName } : null,
  };
}

function buildFileObject(input = {}) {
  const base = validateBaseFields({
    ...input,
    objectType: OBJECT_TYPES.FILE,
    objectId: normalizeString(input.fileId || input.objectId),
  });
  return {
    ...base,
    fileId: base.objectId,
    parentDirId: normalizeString(input.parentDirId),
    encryptedName: input.encryptedName && typeof input.encryptedName === 'object' ? { ...input.encryptedName } : null,
    size: normalizeInt(input.size, 0),
    originalSize: normalizeInt(input.originalSize, 0),
    chunkCount: Math.max(1, normalizeInt(input.chunkCount, 1)),
    contentRef: normalizeString(input.contentRef),
    contentHash: normalizeString(input.contentHash),
  };
}

function buildChunkObject(input = {}) {
  const fileId = normalizeString(input.fileId);
  const chunkIndex = normalizeInt(input.chunkIndex, 0);
  const objectId = normalizeString(input.objectId) || `${fileId}:${chunkIndex}`;
  const base = validateBaseFields({
    ...input,
    objectType: OBJECT_TYPES.CHUNK,
    objectId,
  });
  return {
    ...base,
    fileId,
    chunkIndex,
    payloadHash: normalizeString(input.payloadHash),
    chunkSize: normalizeInt(input.chunkSize, 0),
    compression: normalizeString(input.compression) || 'gzip',
    payloadRef: normalizeString(input.payloadRef),
  };
}

function buildDeleteObject(input = {}) {
  const targetType = normalizeString(input.targetType);
  const targetId = normalizeString(input.targetId);
  const objectId = normalizeString(input.objectId) || `${targetType}:${targetId}:${normalizeString(input.deletedAt) || nowIso()}`;
  const base = validateBaseFields({
    ...input,
    objectType: OBJECT_TYPES.DELETE,
    objectId,
  });
  return {
    ...base,
    targetType,
    targetId,
    deletedAt: normalizeString(input.deletedAt) || nowIso(),
  };
}

function parseDriveObject(raw = null) {
  if (!raw || typeof raw !== 'object') throw new Error('drive object must be an object');
  const objectType = normalizeString(raw.objectType);
  if (objectType === OBJECT_TYPES.DIR) return buildDirObject(raw);
  if (objectType === OBJECT_TYPES.FILE) return buildFileObject(raw);
  if (objectType === OBJECT_TYPES.CHUNK) return buildChunkObject(raw);
  if (objectType === OBJECT_TYPES.DELETE) return buildDeleteObject(raw);
  throw new Error(`unknown drive object type: ${objectType}`);
}

function validateDriveObject(raw = null) {
  parseDriveObject(raw);
  return true;
}

function getObjectType(raw = null) {
  return normalizeString(raw?.objectType);
}

module.exports = {
  OBJECT_TYPES,
  buildDirObject,
  buildFileObject,
  buildChunkObject,
  buildDeleteObject,
  parseDriveObject,
  validateDriveObject,
  getObjectType,
};
