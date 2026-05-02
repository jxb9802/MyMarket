'use strict';

const { OBJECT_TYPES, buildDirObject, buildFileObject, buildChunkObject, buildDeleteObject } = require('./drive_manifest_protocol');

const EVENT_TYPES = Object.freeze({
  DIR_UPSERT: 'drive_dir_upsert',
  FILE_UPSERT: 'drive_file_upsert',
  CHUNK_PUT: 'drive_chunk_put',
  DELETE_PUT: 'drive_delete_put',
});

function createDriveChainService(deps = {}) {
  const mode = String(deps.mode || process.env.BSV_MARKET_DRIVE_CHAIN_MODE || 'anchor').trim().toLowerCase();
  const anchorEvent = typeof deps.anchorEvent === 'function' ? deps.anchorEvent : null;
  const anchorBatchEvent = typeof deps.anchorBatchEvent === 'function' ? deps.anchorBatchEvent : null;
  const loadAnchorRows = typeof deps.loadAnchorRows === 'function' ? deps.loadAnchorRows : () => [];
  const fsService = deps.fsService || null;

  function isAnchorMode() {
    return mode !== 'cache';
  }

  async function anchor(eventType, payload, options = {}) {
    if (!isAnchorMode()) return null;
    if (!anchorEvent) throw new Error('drive chain anchor event is unavailable');
    const result = await anchorEvent(eventType, payload, {
      ...options,
      trackOutputs: options.trackOutputs !== false,
    });
    const errorMessage = String(result?.error || result?.message || '').trim();
    const txid = String(result?.txid || '').trim();
    if (errorMessage || !txid) {
      const error = new Error(errorMessage || `drive chain anchor failed: ${eventType}`);
      error.anchorResult = result || null;
      error.txid = txid;
      error.failureStage = String(result?.failureStage || 'anchor_failed').trim() || 'anchor_failed';
      throw error;
    }
    return result;
  }

  async function anchorBatch(events, options = {}) {
    if (!isAnchorMode()) return null;
    if (!anchorBatchEvent) {
      const results = [];
      for (const event of events) {
        results.push(await anchor(event.eventType, event.payload, options));
      }
      return {
        txid: String(results[0]?.txid || ''),
        results,
        payloadCount: results.length,
      };
    }
    const result = await anchorBatchEvent(events, {
      ...options,
      trackOutputs: options.trackOutputs !== false,
    });
    const errorMessage = String(result?.error || result?.message || '').trim();
    const txid = String(result?.txid || '').trim();
    if (errorMessage || !txid) {
      const error = new Error(errorMessage || 'drive chain batch anchor failed');
      error.anchorResult = result || null;
      error.txid = txid;
      error.failureStage = String(result?.failureStage || 'anchor_failed').trim() || 'anchor_failed';
      throw error;
    }
    return result;
  }

  function cacheObject(object) {
    if (!fsService || typeof fsService.writeObject !== 'function') return;
    fsService.writeObject(object.objectType, object.objectId, object);
  }

  function cacheChunk(fileId, chunkIndex, payload) {
    if (!fsService || typeof fsService.writeChunk !== 'function') return;
    fsService.writeChunk(fileId, chunkIndex, payload);
  }

  async function anchorDirObject(dirObject, options = {}) {
    const payload = {
      walletId: String(dirObject.ownerWalletId || '').trim(),
      ownerWalletId: String(dirObject.ownerWalletId || '').trim(),
      dir: dirObject,
    };
    cacheObject(dirObject);
    return anchor(EVENT_TYPES.DIR_UPSERT, payload, options);
  }

  async function anchorFileObject(fileObject, options = {}) {
    const payload = {
      walletId: String(fileObject.ownerWalletId || '').trim(),
      ownerWalletId: String(fileObject.ownerWalletId || '').trim(),
      file: fileObject,
    };
    cacheObject(fileObject);
    return anchor(EVENT_TYPES.FILE_UPSERT, payload, options);
  }

  async function anchorChunkObject(chunkObject, chunkPayload, options = {}) {
    const payloadBuffer = Buffer.from(chunkPayload || '');
    const payload = {
      walletId: String(chunkObject.ownerWalletId || '').trim(),
      ownerWalletId: String(chunkObject.ownerWalletId || '').trim(),
      fileId: String(chunkObject.fileId || '').trim(),
      chunkIndex: Number(chunkObject.chunkIndex || 0),
      payloadHash: String(chunkObject.payloadHash || '').trim(),
      chunkSize: Number(chunkObject.chunkSize || payloadBuffer.length || 0),
      compression: String(chunkObject.compression || 'gzip').trim() || 'gzip',
      payloadBase64: payloadBuffer.toString('base64'),
      chunk: {
        ...chunkObject,
        payloadRef: '',
      },
    };
    cacheChunk(chunkObject.fileId, chunkObject.chunkIndex, payloadBuffer);
    cacheObject({
      ...chunkObject,
      payloadRef: '',
    });
    return anchor(EVENT_TYPES.CHUNK_PUT, payload, options);
  }

  async function anchorDeleteObject(deleteObject, options = {}) {
    const payload = {
      walletId: String(deleteObject.ownerWalletId || '').trim(),
      ownerWalletId: String(deleteObject.ownerWalletId || '').trim(),
      delete: deleteObject,
    };
    cacheObject(deleteObject);
    return anchor(EVENT_TYPES.DELETE_PUT, payload, options);
  }

  async function anchorChunkAndFileObjectsBatch(chunkEntries, fileObject, options = {}) {
    const events = [];
    for (const entry of (Array.isArray(chunkEntries) ? chunkEntries : [])) {
      const chunkObject = entry?.chunkObject;
      if (!chunkObject) continue;
      const payloadBuffer = Buffer.from(entry?.encryptedPayload || entry?.payload || '');
      cacheChunk(chunkObject.fileId, chunkObject.chunkIndex, payloadBuffer);
      cacheObject({
        ...chunkObject,
        payloadRef: '',
      });
      events.push({
        eventType: EVENT_TYPES.CHUNK_PUT,
        payload: {
          walletId: String(chunkObject.ownerWalletId || '').trim(),
          ownerWalletId: String(chunkObject.ownerWalletId || '').trim(),
          fileId: String(chunkObject.fileId || '').trim(),
          chunkIndex: Number(chunkObject.chunkIndex || 0),
          payloadHash: String(chunkObject.payloadHash || '').trim(),
          chunkSize: Number(chunkObject.chunkSize || payloadBuffer.length || 0),
          compression: String(chunkObject.compression || 'gzip').trim() || 'gzip',
          payloadBase64: payloadBuffer.toString('base64'),
          chunk: {
            ...chunkObject,
            payloadRef: '',
          },
        },
      });
    }
    if (fileObject) {
      cacheObject(fileObject);
      events.push({
        eventType: EVENT_TYPES.FILE_UPSERT,
        payload: {
          walletId: String(fileObject.ownerWalletId || '').trim(),
          ownerWalletId: String(fileObject.ownerWalletId || '').trim(),
          file: fileObject,
        },
      });
    }
    if (!events.length) throw new Error('drive batch contains no events');
    return anchorBatch(events, options);
  }

  function listOwnerObjects(ownerWalletId) {
    const safeOwner = String(ownerWalletId || '').trim();
    if (!safeOwner) return [];
    if (!isAnchorMode()) {
      return fsService && typeof fsService.listObjectPayloads === 'function'
        ? fsService.listObjectPayloads().filter((entry) => String(entry?.ownerWalletId || '') === safeOwner)
        : [];
    }
    const rows = loadAnchorRows({
      walletId: safeOwner,
      eventTypes: Object.values(EVENT_TYPES),
      desc: false,
    });
    const objects = [];
    for (const row of rows) {
      const eventType = String(row?.eventType || '').trim();
      const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
      if (eventType === EVENT_TYPES.DIR_UPSERT && payload.dir) {
        objects.push(buildDirObject(payload.dir));
        continue;
      }
      if (eventType === EVENT_TYPES.FILE_UPSERT && payload.file) {
        objects.push(buildFileObject(payload.file));
        continue;
      }
      if (eventType === EVENT_TYPES.CHUNK_PUT) {
        const chunk = payload.chunk && typeof payload.chunk === 'object'
          ? buildChunkObject(payload.chunk)
          : buildChunkObject({
              ownerWalletId: safeOwner,
              fileId: payload.fileId,
              chunkIndex: payload.chunkIndex,
              payloadHash: payload.payloadHash,
              chunkSize: payload.chunkSize,
              compression: payload.compression,
              payloadRef: '',
            });
        objects.push(chunk);
        continue;
      }
      if (eventType === EVENT_TYPES.DELETE_PUT && payload.delete) {
        objects.push(buildDeleteObject(payload.delete));
      }
    }
    return objects;
  }

  function loadChunkPayloads(ownerWalletId, fileId) {
    const safeOwner = String(ownerWalletId || '').trim();
    const safeFileId = String(fileId || '').trim();
    if (!safeOwner || !safeFileId) return [];
    if (!isAnchorMode()) {
      const chunks = [];
      if (!fsService || typeof fsService.readChunk !== 'function') return chunks;
      for (let index = 0; ; index += 1) {
        try {
          chunks.push({
            chunkIndex: index,
            payload: fsService.readChunk(safeFileId, index),
          });
        } catch (_) {
          break;
        }
      }
      return chunks;
    }
    const rows = loadAnchorRows({
      walletId: safeOwner,
      eventTypes: [EVENT_TYPES.CHUNK_PUT],
      desc: false,
    });
    const deduped = new Map();
    for (const row of rows) {
      const payload = row?.payload && typeof row.payload === 'object' ? row.payload : {};
      if (String(payload.fileId || '') !== safeFileId) continue;
      const chunkIndex = Number(payload.chunkIndex || 0);
      deduped.set(chunkIndex, {
        chunkIndex,
        payload: Buffer.from(String(payload.payloadBase64 || ''), 'base64'),
      });
    }
    return Array.from(deduped.values()).sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  function getOwnerRevision(ownerWalletId) {
    const safeOwner = String(ownerWalletId || '').trim();
    if (!safeOwner) return '';
    if (!isAnchorMode()) {
      return String(listOwnerObjects(safeOwner).length);
    }
    const latest = loadAnchorRows({
      walletId: safeOwner,
      eventTypes: Object.values(EVENT_TYPES),
      desc: true,
      limit: 1,
    })[0];
    if (!latest) return '';
    return String(latest.eventId || `${latest.txid || ''}:${latest.ts || ''}`);
  }

  return {
    mode,
    EVENT_TYPES,
    anchorDirObject,
    anchorFileObject,
    anchorChunkObject,
    anchorChunkAndFileObjectsBatch,
    anchorDeleteObject,
    listOwnerObjects,
    loadChunkPayloads,
    getOwnerRevision,
    isAnchorMode,
    OBJECT_TYPES,
  };
}

module.exports = {
  EVENT_TYPES,
  createDriveChainService,
};
