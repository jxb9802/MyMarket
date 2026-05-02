'use strict';

const path = require('path');
const crypto = require('crypto');
const messageQueue = require('./lib/message_queue');
const defaultWallet = require('./wallet');
const {
  buildDirObject,
  buildFileObject,
  buildChunkObject,
} = require('./drive_manifest_protocol');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function createDriveUploadService(deps = {}) {
  const runtime = deps.runtime;
  const store = deps.store;
  const fsService = deps.fsService;
  const chainService = deps.chainService;
  const cryptoService = deps.cryptoService;
  const codec = deps.codec;
  const wallet = deps.wallet || defaultWallet;
  const spoolStore = deps.spoolStore || null;
  const backgroundQueue = deps.backgroundQueue === true;
  const MAX_ANCHOR_PAYLOAD_BYTES = Math.max(1024, Number(wallet.MAX_ANCHOR_PAYLOAD_BYTES || 10000));
  const DEFAULT_MAX_BATCH_TX_BYTES = Math.max(64 * 1024, Number(process.env.DRIVE_MAX_BATCH_TX_BYTES || (768 * 1024)));
  const SLOW_BATCH_MAX_TX_BYTES = Math.max(64 * 1024, Number(process.env.DRIVE_SLOW_BATCH_MAX_TX_BYTES || (512 * 1024)));
  const SLOW_BATCH_THRESHOLD_MS = Math.max(1000, Number(process.env.DRIVE_SLOW_BATCH_THRESHOLD_MS || 60000));
  const DEFAULT_CHUNK_SIZE = Math.max(2048, Number(process.env.DRIVE_DEFAULT_CHUNK_SIZE || 6144));
  const MIN_CHUNK_SIZE = 256;
  const finishTaskInFlight = new Map();
  const queuePasswords = new Map();
  let queueWorkerRunning = false;
  let adaptiveMaxBatchTxBytes = DEFAULT_MAX_BATCH_TX_BYTES;
  let consecutiveFastBatchCount = 0;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function emit(topic, payload) {
    return messageQueue.publish(topic, payload, { mode: messageQueue.MODE_TRANSIENT, source: 'drive' });
  }

  function emitTaskProgress(task, status, progress, extra = {}) {
    if (!task?.taskId) return;
    emit('drive.upload.progress', {
      taskId: task.taskId,
      status,
      uploadedBytes: Math.max(0, Number(task.uploadedBytes || task.totalBytes || 0)),
      totalBytes: Math.max(0, Number(task.totalBytes || 0)),
      progress: Math.max(0, Math.min(1, Number(progress || 0))),
      fileName: task.fileName,
      dirPath: task.dirPath,
      ...extra,
    });
  }

  function normalizeFileNameForConflict(fileName) {
    return String(fileName || '').trim().normalize('NFC').toLocaleLowerCase();
  }

  function uploadTaskIsActive(task) {
    const status = String(task?.status || '').trim();
    return !['completed', 'cancelled', 'failed'].includes(status);
  }

  function assertFileNameAvailable(ownerWalletId, dirPath, fileName, options = {}) {
    const safeOwner = String(ownerWalletId || '').trim();
    const normalizedDirPath = runtime.normalizePath(dirPath || '/');
    const safeFileName = String(fileName || '').trim();
    const conflictName = normalizeFileNameForConflict(safeFileName);
    if (!safeOwner || !conflictName) return true;
    const dirId = runtime.findDirByPath(safeOwner, normalizedDirPath);
    if (dirId) {
      const listing = runtime.listDir(safeOwner, dirId, { preloadChildDirs: false });
      const existing = (Array.isArray(listing?.files) ? listing.files : []).find((entry) => (
        entry?.deleted !== true
        && normalizeFileNameForConflict(entry.name) === conflictName
      ));
      if (existing) {
        throw new Error(`A file with the same name already exists in this directory: ${safeFileName}`);
      }
    }
    const excludeTaskId = String(options?.excludeTaskId || '').trim();
    const pending = listUploadTasks(safeOwner).find((task) => (
      uploadTaskIsActive(task)
      && String(task.taskId || '') !== excludeTaskId
      && runtime.normalizePath(task.dirPath || task.targetDirPath || '/') === normalizedDirPath
      && normalizeFileNameForConflict(task.fileName) === conflictName
    ));
    if (pending) {
      throw new Error(`A file with the same name is already uploading in this directory: ${safeFileName}`);
    }
    return true;
  }

  function estimateAnchorFeeSat(payloadBytes, inputCount = 1) {
    const safeInputs = Math.max(1, Number(inputCount || 1));
    const safeOutputs = 2;
    const safeDataBytes = Math.max(0, Number(payloadBytes || 0));
    const scriptOverhead = safeDataBytes > 0 ? (safeDataBytes + 16) : 0;
    const sizeBytes = 10 + (safeInputs * 148) + (safeOutputs * 34) + scriptOverhead;
    return Math.max(1, Math.ceil(sizeBytes * Number(wallet.DEFAULT_FEE_RATE || 1)));
  }

  function estimateBatchTxBytes(payloadBytes, eventCount, inputCount = 2) {
    const safePayloadBytes = Math.max(0, Number(payloadBytes || 0));
    const safeEventCount = Math.max(1, Number(eventCount || 1));
    const safeInputCount = Math.max(1, Number(inputCount || 1));
    return 10
      + (safeInputCount * 148)
      + 34
      + (safeEventCount * 24)
      + safePayloadBytes;
  }

  function estimateBatchFeeSat(payloadBytes, eventCount) {
    return Math.max(1, Math.ceil(estimateBatchTxBytes(payloadBytes, eventCount) * Number(wallet.DEFAULT_FEE_RATE || 1)));
  }

  function loadTask(taskId) {
    if (spoolStore) return spoolStore.loadTask(taskId);
    return store.loadTask(taskId);
  }

  function saveTask(task) {
    if (spoolStore) spoolStore.saveTask(task);
    else store.saveTask(task);
    emit('drive.upload.progress', {
      taskId: task.taskId,
      status: task.status,
      uploadedBytes: task.uploadedBytes,
      totalBytes: task.totalBytes,
      progress: task.totalBytes > 0 ? Math.min(1, task.uploadedBytes / task.totalBytes) : 0,
      fileName: task.fileName,
      dirPath: task.dirPath,
    });
    return task;
  }

  function deleteTask(taskId) {
    if (spoolStore) return spoolStore.deleteTask(taskId);
    if (typeof store.deleteTask === 'function') return store.deleteTask(taskId);
    return false;
  }

  function buildFailureSummary({
    task,
    fileId = '',
    parentDirId = '',
    completedChunkIndexes = [],
    completedChunkTxids = [],
    failedChunkIndex = null,
    failedTxid = '',
    failureStage = 'upload_failed',
    error = '',
    chunkCount = 0,
    dirPath = '',
  }) {
    return {
      taskId: String(task?.taskId || '').trim(),
      fileId: String(fileId || '').trim(),
      parentDirId: String(parentDirId || '').trim(),
      dirPath: String(dirPath || task?.dirPath || '').trim(),
      fileName: String(task?.fileName || '').trim(),
      failureStage: String(failureStage || 'upload_failed').trim() || 'upload_failed',
      error: String(error || '').trim(),
      chunkCount: Math.max(0, Number(chunkCount || 0)),
      completedChunkCount: Array.isArray(completedChunkIndexes) ? completedChunkIndexes.length : 0,
      completedChunkIndexes: Array.isArray(completedChunkIndexes) ? completedChunkIndexes.slice() : [],
      completedChunkTxids: Array.isArray(completedChunkTxids) ? completedChunkTxids.slice() : [],
      failedChunkIndex: Number.isInteger(failedChunkIndex) ? failedChunkIndex : null,
      failedTxid: String(failedTxid || '').trim(),
      recoverable: true,
      updatedAt: new Date().toISOString(),
    };
  }

  function markUploadTaskFailed(task, summary) {
    const completedChunkCount = Math.max(0, Number(summary?.completedChunkCount || 0));
    const nextStatus = completedChunkCount > 0 ? 'partial_failed' : 'failed';
    return saveTask({
      ...task,
      status: nextStatus,
      failure: summary,
      updatedAt: new Date().toISOString(),
    });
  }

  function walletBalanceSnapshot() {
    const balance = typeof wallet.getCachedBalanceAndHistory === 'function'
      ? wallet.getCachedBalanceAndHistory()
      : {};
    const confirmedSat = Math.max(0, Number(balance?.confirmed || 0));
    const selfChangePendingSat = Math.max(0, Number(balance?.selfChangePending || 0));
    const availableSat = Math.max(confirmedSat + selfChangePendingSat, Number(balance?.available || 0));
    const totalSat = Math.max(0, Number(balance?.total || confirmedSat));
    return {
      confirmedSat,
      selfChangePendingSat,
      availableSat,
      totalSat,
    };
  }

  function withBalancePreflight(preview) {
    if (typeof chainService?.isAnchorMode === 'function' && !chainService.isAnchorMode()) {
      return {
        ...preview,
        walletConfirmedSat: 0,
        walletTotalSat: 0,
        canAfford: true,
        insufficientBalance: false,
        shortfallSat: 0,
        balancePolicy: 'not_required_in_cache_mode',
      };
    }
    const balance = walletBalanceSnapshot();
    const estimatedFeeSat = Math.max(0, Number(preview?.estimatedFeeSat || 0));
    const spendableSat = Math.max(0, Number(balance.availableSat || balance.confirmedSat || 0));
    const shortfallSat = Math.max(0, estimatedFeeSat - spendableSat);
    return {
      ...preview,
      walletConfirmedSat: balance.confirmedSat,
      walletSelfChangePendingSat: balance.selfChangePendingSat,
      walletSpendableSat: spendableSat,
      walletTotalSat: balance.totalSat,
      canAfford: shortfallSat <= 0,
      insufficientBalance: shortfallSat > 0,
      shortfallSat,
      balancePolicy: 'confirmed_plus_local_self_change',
    };
  }

  function buildInsufficientBalanceMessage(preview) {
    return `Insufficient spendable balance for whole file upload: need ${Number(preview?.estimatedFeeSat || 0)} sat, spendable ${Number(preview?.walletSpendableSat || preview?.walletConfirmedSat || 0)} sat, short ${Number(preview?.shortfallSat || 0)} sat`;
  }

  function buildDirPlan({ ownerWalletId, dirPath, password }) {
    const normalized = runtime.normalizePath(dirPath);
    const owner = runtime.loadOwner(ownerWalletId);
    let currentDirId = owner.rootDirId;
    let currentPath = '/';
    const parts = normalized.split('/').filter(Boolean);
    const missingDirs = [];
    for (const part of parts) {
      const already = runtime.listDir(ownerWalletId, currentDirId, { preloadChildDirs: true }).dirs.find((entry) => String(entry.name || '') === part);
      if (already) {
        currentDirId = already.dirId;
        currentPath = String(already.path || '/');
        continue;
      }
      const dirId = makeId('dir');
      const nextPath = runtime.normalizePath(`${currentPath}/${part}`);
      const dirObject = buildDirObject({
        ownerWalletId,
        dirId,
        parentDirId: currentDirId,
        encryptedName: cryptoService.encryptDirName(part, { dirId }, { password }),
      });
      const payload = {
        walletId: String(ownerWalletId || '').trim(),
        ownerWalletId: String(ownerWalletId || '').trim(),
        dir: dirObject,
      };
      missingDirs.push({
        dirId,
        name: part,
        path: nextPath,
        payloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
      });
      currentDirId = dirId;
      currentPath = nextPath;
    }
    return {
      normalizedDirPath: normalized,
      parentDirId: currentDirId,
      parentDirPath: currentPath,
      missingDirs,
    };
  }

  function buildChunkAnchorPayload(ownerWalletId, chunkObject, payloadBuffer) {
    return {
      walletId: String(ownerWalletId || '').trim(),
      ownerWalletId: String(ownerWalletId || '').trim(),
      fileId: String(chunkObject.fileId || '').trim(),
      chunkIndex: Number(chunkObject.chunkIndex || 0),
      payloadHash: String(chunkObject.payloadHash || '').trim(),
      chunkSize: Number(chunkObject.chunkSize || payloadBuffer.length || 0),
      compression: String(chunkObject.compression || 'gzip').trim() || 'gzip',
      payloadBase64: Buffer.from(payloadBuffer || '').toString('base64'),
      chunk: {
        ...chunkObject,
        payloadRef: '',
      },
    };
  }

  function buildFileAnchorPayload(ownerWalletId, fileObject) {
    return {
      walletId: String(ownerWalletId || '').trim(),
      ownerWalletId: String(ownerWalletId || '').trim(),
      file: fileObject,
    };
  }

  function getAdaptiveMaxBatchTxBytes() {
    return Math.max(64 * 1024, Number(adaptiveMaxBatchTxBytes || DEFAULT_MAX_BATCH_TX_BYTES));
  }

  function buildChunkFileBatches(chunkPlans, fileObject, ownerWalletId, options = {}) {
    const maxBatchTxBytes = Math.max(64 * 1024, Number(options.maxBatchTxBytes || getAdaptiveMaxBatchTxBytes()));
    const plans = Array.isArray(chunkPlans) ? chunkPlans : [];
    const filePayloadBytes = fileObject
      ? Buffer.byteLength(JSON.stringify(buildFileAnchorPayload(ownerWalletId, fileObject)), 'utf8')
      : 0;
    if (filePayloadBytes > MAX_ANCHOR_PAYLOAD_BYTES) {
      throw new Error(`file metadata exceeds anchor payload limit (max ${MAX_ANCHOR_PAYLOAD_BYTES} bytes UTF-8)`);
    }
    const batches = [];
    let current = [];
    let currentPayloadBytes = 0;
    function pushCurrent(includeFile) {
      if (!current.length && !includeFile) return;
      const payloadBytes = currentPayloadBytes + (includeFile ? filePayloadBytes : 0);
      const eventCount = current.length + (includeFile ? 1 : 0);
      batches.push({
        chunkPlans: current,
        fileObject: includeFile ? fileObject : null,
        payloadBytes,
        estimatedTxBytes: estimateBatchTxBytes(payloadBytes, eventCount),
        estimatedFeeSat: estimateBatchFeeSat(payloadBytes, eventCount),
      });
      current = [];
      currentPayloadBytes = 0;
    }
    for (const plan of plans) {
      const nextPayloadBytes = currentPayloadBytes + Math.max(0, Number(plan?.payloadBytes || 0));
      const nextEventCount = current.length + 1;
      if (current.length && estimateBatchTxBytes(nextPayloadBytes + filePayloadBytes, nextEventCount + 1) > maxBatchTxBytes) {
        pushCurrent(false);
      }
      const singlePayloadBytes = Math.max(0, Number(plan?.payloadBytes || 0)) + filePayloadBytes;
      if (!current.length && estimateBatchTxBytes(singlePayloadBytes, 1 + (fileObject ? 1 : 0)) > maxBatchTxBytes) {
        throw new Error(`drive batch item exceeds max transaction size (${maxBatchTxBytes} bytes)`);
      }
      current.push(plan);
      currentPayloadBytes += Math.max(0, Number(plan?.payloadBytes || 0));
    }
    pushCurrent(Boolean(fileObject));
    if (!batches.length && fileObject) {
      pushCurrent(true);
    }
    return {
      batches,
      batchCount: batches.length,
      filePayloadBytes,
      maxBatchTxBytes,
      estimatedFeeSat: batches.reduce((sum, batch) => sum + Math.max(0, Number(batch.estimatedFeeSat || 0)), 0),
      estimatedMaxTxBytes: batches.reduce((max, batch) => Math.max(max, Number(batch.estimatedTxBytes || 0)), 0),
    };
  }

  function normalizeBatchStatus(status) {
    const safe = String(status || '').trim();
    if (['observed', 'broadcasted', 'completed'].includes(safe)) return safe;
    if (['signing', 'broadcasting', 'failed', 'paused'].includes(safe)) return safe;
    return 'pending';
  }

  function completedBatchCount(taskId) {
    if (!spoolStore) return 0;
    return spoolStore.listBatches(taskId)
      .filter((batch) => ['observed', 'broadcasted', 'completed'].includes(normalizeBatchStatus(batch.status))).length;
  }

  function persistSpoolPlan(task, { fileId, compressed, chunkPlan, batchPlan, preview }) {
    if (!spoolStore) return;
    for (const chunkEntry of chunkPlan.chunkPlans) {
      spoolStore.writeChunk(
        task.taskId,
        Number(chunkEntry.chunkObject.chunkIndex || 0),
        chunkEntry.chunkObject,
        chunkEntry.encryptedPayload,
      );
    }
    for (let index = 0; index < batchPlan.batches.length; index += 1) {
      const batch = batchPlan.batches[index];
      const chunkIndexes = (Array.isArray(batch.chunkPlans) ? batch.chunkPlans : [])
        .map((entry) => Number(entry?.chunkObject?.chunkIndex || 0));
      spoolStore.saveBatch(task.taskId, {
        batchIndex: index,
        chunkIndexes,
        chunkStart: chunkIndexes.length ? Math.min(...chunkIndexes) : 0,
        chunkEnd: chunkIndexes.length ? Math.max(...chunkIndexes) : 0,
        includesFileObject: Boolean(batch.fileObject),
        payloadBytes: Number(batch.payloadBytes || 0),
        estimatedTxBytes: Number(batch.estimatedTxBytes || 0),
        estimatedFeeSat: Number(batch.estimatedFeeSat || 0),
        status: 'pending',
        txid: '',
        feeSat: 0,
        observed: false,
        observedNode: '',
        attempts: 0,
        lastError: '',
      });
    }
    spoolStore.saveTask({
      ...task,
      fileId,
      sourceFileReady: true,
      compressedSize: Buffer.from(compressed || '').length,
      originalSize: Number(preview?.originalSize || 0),
      contentHash: cryptoService.sha256Hex(compressed),
      chunkCount: Number(chunkPlan.chunkCount || 0),
      chunkSize: Number(chunkPlan.chunkSize || 0),
      batchCount: Number(batchPlan.batchCount || 0),
      completedBatchCount: 0,
      estimatedFeeSat: Number(preview?.estimatedFeeSat || 0),
      estimatedFeeBsv: Number(preview?.estimatedFeeBsv || 0),
      spentFeeSat: 0,
      status: 'awaiting_confirm',
      preview,
    });
  }

  function loadSpoolChunkPlansForBatch(taskId, batch) {
    const indexes = Array.isArray(batch?.chunkIndexes) ? batch.chunkIndexes.map((n) => Number(n)) : [];
    return indexes.map((index) => {
      const row = spoolStore.readChunk(taskId, index);
      return {
        chunkObject: row.chunkObject,
        encryptedPayload: row.encryptedPayload,
        payloadBytes: Buffer.byteLength(JSON.stringify(buildChunkAnchorPayload(
          row.chunkObject.ownerWalletId,
          row.chunkObject,
          row.encryptedPayload,
        )), 'utf8'),
      };
    });
  }

  async function anchorChunkFileBatches({ chunkPlans, fileObject, ownerWalletId, password, task = null }) {
    const plan = buildChunkFileBatches(chunkPlans, fileObject, ownerWalletId);
    const completedChunkIndexes = [];
    const completedChunkTxids = [];
    if (typeof chainService.anchorChunkAndFileObjectsBatch === 'function') {
      for (let batchIndex = 0; batchIndex < plan.batches.length; batchIndex += 1) {
        const batch = plan.batches[batchIndex];
        const batchCount = Math.max(1, Number(plan.batches.length || 0));
        const batchStartProgress = plan.batches.length > 0
          ? Math.min(0.99, (batchIndex + 0.1) / batchCount)
          : 0;
        if (task) {
          emit('drive.upload.progress', {
            taskId: task.taskId,
            status: 'anchoring',
            uploadedBytes: Number(task.totalBytes || 0),
            totalBytes: Number(task.totalBytes || 0),
            progress: batchStartProgress,
            onchainProgress: batchStartProgress,
            batchIndex: batchIndex + 1,
            batchCount: plan.batches.length,
            stage: 'batch_started',
            fileName: task.fileName,
            dirPath: task.dirPath,
          });
        }
        const batchStartedAt = Date.now();
        const batchResult = await chainService.anchorChunkAndFileObjectsBatch(batch.chunkPlans, batch.fileObject, {
          password,
          updatedAt: String(fileObject?.updatedAt || new Date().toISOString()),
          includeUnconfirmed: true,
          trackOutputs: true,
          onStage: (stage, extra = {}) => {
            if (!task) return;
            const safeStage = String(stage || '').trim();
            const stageProgress = safeStage === 'wallet_anchor_batch_broadcasted'
              ? Math.min(0.99, (batchIndex + 0.85) / batchCount)
              : Math.min(0.99, (batchIndex + 0.25) / batchCount);
            emit('drive.upload.progress', {
              taskId: task.taskId,
              status: 'anchoring',
              uploadedBytes: Number(task.totalBytes || 0),
              totalBytes: Number(task.totalBytes || 0),
              progress: stageProgress,
              onchainProgress: stageProgress,
              batchIndex: batchIndex + 1,
              batchCount: plan.batches.length,
              stage: safeStage,
              txid: String(extra?.txid || ''),
              observed: Boolean(extra?.observed),
              observedNode: String(extra?.observedNode || ''),
              fileName: task.fileName,
              dirPath: task.dirPath,
            });
          },
        });
        const batchElapsedMs = Date.now() - batchStartedAt;
        if (batchElapsedMs > SLOW_BATCH_THRESHOLD_MS && adaptiveMaxBatchTxBytes > SLOW_BATCH_MAX_TX_BYTES) {
          consecutiveFastBatchCount = 0;
          adaptiveMaxBatchTxBytes = SLOW_BATCH_MAX_TX_BYTES;
          if (task) {
            emit('drive.upload.progress', {
              taskId: task.taskId,
              status: 'anchoring',
              uploadedBytes: Number(task.totalBytes || 0),
              totalBytes: Number(task.totalBytes || 0),
              progress: plan.batches.length > 0 ? Math.min(0.99, (batchIndex + 1) / plan.batches.length) : 0.95,
              onchainProgress: plan.batches.length > 0 ? (batchIndex + 1) / plan.batches.length : 0,
              batchIndex: batchIndex + 1,
              batchCount: plan.batches.length,
              stage: 'batch_size_downgraded',
              adaptiveMaxBatchTxBytes,
              slowBatchElapsedMs: batchElapsedMs,
              fileName: task.fileName,
              dirPath: task.dirPath,
            });
          }
        } else if (batchElapsedMs < Math.max(1000, Math.floor(SLOW_BATCH_THRESHOLD_MS / 2))) {
          consecutiveFastBatchCount += 1;
          if (consecutiveFastBatchCount >= 2 && adaptiveMaxBatchTxBytes < DEFAULT_MAX_BATCH_TX_BYTES) {
            adaptiveMaxBatchTxBytes = DEFAULT_MAX_BATCH_TX_BYTES;
          }
        } else {
          consecutiveFastBatchCount = 0;
        }
        const txid = String(batchResult?.txid || '').trim();
        for (const chunkEntry of batch.chunkPlans) {
          completedChunkIndexes.push(Number(chunkEntry.chunkObject.chunkIndex || 0));
          if (txid) completedChunkTxids.push(txid);
        }
        if (txid && batch.fileObject) completedChunkTxids.push(txid);
        if (task) {
          emit('drive.upload.progress', {
            taskId: task.taskId,
            status: 'anchoring',
            uploadedBytes: Number(task.totalBytes || 0),
            totalBytes: Number(task.totalBytes || 0),
            progress: plan.batches.length > 0 ? Math.min(0.99, (batchIndex + 1) / plan.batches.length) : 0.95,
            onchainProgress: plan.batches.length > 0 ? (batchIndex + 1) / plan.batches.length : 0,
            batchIndex: batchIndex + 1,
            batchCount: plan.batches.length,
            stage: 'batch_completed',
            txid,
            observed: Boolean(batchResult?.observed),
            observedNode: String(batchResult?.observedNode || ''),
            batchElapsedMs,
            fileName: task.fileName,
            dirPath: task.dirPath,
          });
        }
      }
    } else {
      for (const chunkEntry of chunkPlans) {
        try {
          const chunkResult = await chainService.anchorChunkObject(chunkEntry.chunkObject, chunkEntry.encryptedPayload, {
            password,
            updatedAt: chunkEntry.chunkObject.updatedAt,
            includeUnconfirmed: true,
            trackOutputs: true,
          });
          completedChunkIndexes.push(Number(chunkEntry.chunkObject.chunkIndex || 0));
          const chunkTxid = String(chunkResult?.txid || '').trim();
          if (chunkTxid) completedChunkTxids.push(chunkTxid);
        } catch (err) {
          err.failureStage = 'chunk_anchor_failed';
          err.completedChunkIndexes = completedChunkIndexes.slice();
          err.completedChunkTxids = completedChunkTxids.slice();
          err.failedChunkIndex = Number(chunkEntry?.chunkObject?.chunkIndex || 0);
          throw err;
        }
      }
      const fileResult = await chainService.anchorFileObject(fileObject, {
        password,
        updatedAt: fileObject.updatedAt,
        includeUnconfirmed: true,
        trackOutputs: true,
      });
      const fileTxid = String(fileResult?.txid || '').trim();
      if (fileTxid) completedChunkTxids.push(fileTxid);
    }
    return {
      ...plan,
      completedChunkIndexes,
      completedChunkTxids,
    };
  }

  async function chooseChunkPlan({ ownerWalletId, password, compressed, fileId, task = null }) {
    let chunkSize = Math.min(DEFAULT_CHUNK_SIZE, Math.max(MIN_CHUNK_SIZE, Number(compressed.length || 0) || DEFAULT_CHUNK_SIZE));
    while (chunkSize >= MIN_CHUNK_SIZE) {
      const chunks = codec.splitBuffer(compressed, { chunkSize });
      const chunkPlans = [];
      let maxPayloadBytes = 0;
      const fileKey = typeof cryptoService.deriveFileKey === 'function'
        ? cryptoService.deriveFileKey(fileId, { password })
        : null;
      for (let index = 0; index < chunks.length; index += 1) {
        const encrypted = cryptoService.encryptChunk(chunks[index], fileId, index, fileKey ? { fileKey } : { password });
        const chunkObject = buildChunkObject({
          ownerWalletId,
          fileId,
          chunkIndex: index,
          payloadHash: encrypted.payloadHash,
          chunkSize: encrypted.payload.length,
          payloadRef: '',
        });
        const payloadBytes = Buffer.byteLength(JSON.stringify(buildChunkAnchorPayload(ownerWalletId, chunkObject, encrypted.payload)), 'utf8');
        maxPayloadBytes = Math.max(maxPayloadBytes, payloadBytes);
        chunkPlans.push({
          chunkObject,
          encryptedPayload: encrypted.payload,
          payloadBytes,
        });
        if (index === 0 || index === chunks.length - 1 || index % 50 === 0) {
          emitTaskProgress(task, 'encrypting', 0.55 + (0.35 * ((index + 1) / Math.max(1, chunks.length))), {
            chunkIndex: index + 1,
            chunkCount: chunks.length,
          });
          await sleep(0);
        }
      }
      if (maxPayloadBytes <= MAX_ANCHOR_PAYLOAD_BYTES) {
        return {
          chunkSize,
          chunkCount: chunkPlans.length,
          maxPayloadBytes,
          chunkPlans,
        };
      }
      if (chunkSize === MIN_CHUNK_SIZE) break;
      chunkSize = Math.max(MIN_CHUNK_SIZE, Math.floor(chunkSize / 2));
    }
    throw new Error(`file still exceeds anchor payload limit after chunking (max ${MAX_ANCHOR_PAYLOAD_BYTES} bytes UTF-8)`);
  }

  async function ensureDirPathExists({ ownerWalletId, dirPath, password }) {
    const normalized = runtime.normalizePath(dirPath);
    const existing = runtime.findDirByPath(ownerWalletId, normalized);
    const rootSettings = store.loadOwnerSettings(ownerWalletId);
    if (existing) {
      const existingDir = runtime.getDirById(ownerWalletId, existing);
      if (rootSettings.rootLocalDir && existingDir?.path) {
        fsService.ensureLocalDirectory(rootSettings.rootLocalDir, existingDir.path);
      }
      return existing;
    }
    const owner = runtime.loadOwner(ownerWalletId);
    let currentDirId = owner.rootDirId;
    let currentPath = '/';
    const parts = normalized.split('/').filter(Boolean);
    for (const part of parts) {
      const already = runtime.listDir(ownerWalletId, currentDirId, { preloadChildDirs: true }).dirs.find((entry) => String(entry.name || '') === part);
      if (already) {
        currentDirId = already.dirId;
        currentPath = String(already.path || '/');
        if (rootSettings.rootLocalDir && currentPath) fsService.ensureLocalDirectory(rootSettings.rootLocalDir, currentPath);
        continue;
      }
      const dirId = makeId('dir');
      const nextPath = runtime.normalizePath(`${currentPath}/${part}`);
      const dirObject = buildDirObject({
        ownerWalletId,
        dirId,
        parentDirId: currentDirId,
        encryptedName: cryptoService.encryptDirName(part, { dirId }, { password }),
      });
      await chainService.anchorDirObject(dirObject, { password, updatedAt: dirObject.updatedAt });
      const runtimeEntry = {
        ...dirObject,
        name: part,
        path: nextPath,
        localRelativePath: nextPath,
      };
      store.saveDir(runtimeEntry);
      runtime.upsertDir(runtimeEntry);
      if (rootSettings.rootLocalDir) fsService.ensureLocalDirectory(rootSettings.rootLocalDir, nextPath);
      currentDirId = dirId;
      currentPath = nextPath;
    }
    emit('drive.tree.updated', { ownerWalletId, dirPath: normalized });
    return currentDirId;
  }

  async function renameDir({ ownerWalletId, dirId, name, password }) {
    const safeOwner = String(ownerWalletId || '').trim();
    const safeDirId = String(dirId || '').trim();
    const safeName = String(name || '').trim();
    if (!safeOwner) throw new Error('ownerWalletId is required');
    if (!safeDirId) throw new Error('dirId is required');
    if (!safeName) throw new Error('name is required');
    if (/[\\/]/.test(safeName) || safeName === '.' || safeName === '..') throw new Error('invalid directory name');
    const owner = runtime.loadOwner(safeOwner);
    if (safeDirId === owner.rootDirId) throw new Error('root directory cannot be renamed');
    const dir = runtime.getDirById(safeOwner, safeDirId);
    if (!dir || dir.deleted === true) throw new Error('directory not found');
    const parentDirId = String(dir.parentDirId || owner.rootDirId);
    const siblings = runtime.listDir(safeOwner, parentDirId, { preloadChildDirs: false }).dirs || [];
    const conflictName = safeName.normalize('NFC').toLocaleLowerCase();
    const conflict = siblings.find((entry) => (
      String(entry.dirId || '') !== safeDirId
      && entry.deleted !== true
      && String(entry.name || '').trim().normalize('NFC').toLocaleLowerCase() === conflictName
    ));
    if (conflict) throw new Error(`A directory with the same name already exists: ${safeName}`);
    const parentPath = runtime.pathForDir(safeOwner, parentDirId) || '/';
    const oldPath = runtime.normalizePath(dir.path || dir.localRelativePath || '/');
    const newPath = runtime.normalizePath(`${parentPath === '/' ? '' : parentPath}/${safeName}`);
    if (oldPath === '/' || !oldPath) throw new Error('root directory cannot be renamed');
    if (oldPath === newPath && String(dir.name || '') === safeName) {
      return { dir, oldPath, newPath };
    }
    const updatedAt = new Date().toISOString();
    const dirObject = buildDirObject({
      ownerWalletId: safeOwner,
      dirId: safeDirId,
      parentDirId,
      encryptedName: cryptoService.encryptDirName(safeName, { dirId: safeDirId }, { password }),
      createdAt: dir.createdAt || updatedAt,
      updatedAt,
      version: Math.max(1, Number(dir.version || 1)) + 1,
    });
    await chainService.anchorDirObject(dirObject, { password, updatedAt: dirObject.updatedAt });
    const renamed = store.saveDir({
      ...dir,
      ...dirObject,
      name: safeName,
      path: newPath,
      localRelativePath: newPath,
      updatedAt,
    });
    const childPrefix = `${oldPath}/`;
    const newPrefix = `${newPath}/`;
    for (const child of store.listAllDirs(safeOwner)) {
      const childPath = runtime.normalizePath(child.path || child.localRelativePath || '/');
      if (child.dirId === safeDirId || !childPath.startsWith(childPrefix)) continue;
      const nextPath = runtime.normalizePath(`${newPrefix}${childPath.slice(childPrefix.length)}`);
      store.saveDir({
        ...child,
        path: nextPath,
        localRelativePath: nextPath,
        updatedAt,
      });
    }
    for (const file of store.listAllFiles(safeOwner)) {
      const filePath = runtime.normalizePath(file.path || file.localRelativePath || '/');
      if (!filePath.startsWith(childPrefix)) continue;
      const nextPath = runtime.normalizePath(`${newPrefix}${filePath.slice(childPrefix.length)}`);
      store.saveFile({
        ...file,
        path: nextPath,
        localRelativePath: nextPath,
        updatedAt,
      });
    }
    runtime.resetOwner(safeOwner);
    emit('drive.tree.updated', { ownerWalletId: safeOwner, dirPath: newPath, oldPath, newPath });
    return { dir: renamed, oldPath, newPath };
  }

  function createUploadTask({ ownerWalletId, dirPath, fileName, totalBytes }) {
    assertFileNameAvailable(ownerWalletId, dirPath, fileName);
    const taskId = makeId('drive-upload');
    if (spoolStore) {
      const task = spoolStore.createTask({
        taskId,
        ownerWalletId,
        dirPath: runtime.normalizePath(dirPath),
        fileName,
        totalBytes,
      });
      emit('drive.upload.progress', {
        taskId,
        status: 'preparing',
        uploadedBytes: 0,
        totalBytes: Math.max(0, Number(totalBytes || 0)),
        progress: 0,
        fileName: String(fileName || '').trim(),
        dirPath: runtime.normalizePath(dirPath),
      });
      return task;
    }
    const tempFile = fsService.createUploadTempFile(taskId);
    return saveTask({
      taskId,
      ownerWalletId,
      dirPath: runtime.normalizePath(dirPath),
      fileName: String(fileName || '').trim(),
      totalBytes: Math.max(0, Number(totalBytes || 0)),
      uploadedBytes: 0,
      tempFile,
      status: 'receiving',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  function appendUploadChunk(taskId, chunkBuffer) {
    const task = loadTask(taskId);
    if (!task) throw new Error('upload task not found');
    const uploadedBytes = spoolStore
      ? spoolStore.appendSourceChunk(taskId, chunkBuffer)
      : fsService.appendTempChunk(task.tempFile, chunkBuffer);
    return saveTask({
      ...task,
      uploadedBytes,
      updatedAt: new Date().toISOString(),
      status: spoolStore ? 'preparing' : 'receiving',
    });
  }

  async function previewUploadTask(taskId, options = {}) {
    const task = loadTask(taskId);
    if (!task) throw new Error('upload task not found');
    assertFileNameAvailable(task.ownerWalletId, task.dirPath || task.targetDirPath || '/', task.fileName, { excludeTaskId: task.taskId });
    if (spoolStore && task.preview && ['awaiting_confirm', 'queued', 'anchoring', 'paused'].includes(String(task.status || ''))) {
      return task;
    }
    const password = String(options.password || '').trim();
    if (!password) throw new Error('wallet password is required');
    const startedAt = Date.now();
    emitTaskProgress(task, 'preparing', 0.36);
    const dirPlan = buildDirPlan({
      ownerWalletId: task.ownerWalletId,
      dirPath: task.dirPath,
      password,
    });
    emitTaskProgress(task, 'reading', 0.4);
    const readyTask = spoolStore ? spoolStore.markSourceReady(taskId) : task;
    const finalized = fsService.finalizeTempFile(readyTask.tempFile || readyTask.sourceFile || task.tempFile);
    const originalBuffer = fsService.readFileBuffer(finalized.file);
    emitTaskProgress(task, 'compressing', 0.45);
    const compressed = typeof codec.compressBufferAsync === 'function'
      ? await codec.compressBufferAsync(originalBuffer)
      : codec.compressBuffer(originalBuffer);
    const fileId = String(task.fileId || '').trim() || makeId('file');
    emitTaskProgress(task, 'encrypting', 0.55);
    const chunkPlan = await chooseChunkPlan({
      ownerWalletId: task.ownerWalletId,
      password,
      compressed,
      fileId,
      task,
    });
    emitTaskProgress(task, 'estimating', 0.92);
    const fileObject = buildFileObject({
      ownerWalletId: task.ownerWalletId,
      fileId,
      parentDirId: dirPlan.parentDirId,
      encryptedName: cryptoService.encryptFileName(task.fileName, { fileId }, { password }),
      size: compressed.length,
      originalSize: originalBuffer.length,
      chunkCount: chunkPlan.chunkCount,
      contentRef: `drive-chunks:${fileId}`,
      contentHash: cryptoService.sha256Hex(compressed),
    });
    const batchPlan = buildChunkFileBatches(chunkPlan.chunkPlans, fileObject, task.ownerWalletId);
    const dirFeeSat = dirPlan.missingDirs.reduce((sum, entry) => sum + estimateAnchorFeeSat(entry.payloadBytes), 0);
    const preview = withBalancePreflight({
      taskId: task.taskId,
      fileName: task.fileName,
      dirPath: dirPlan.normalizedDirPath,
      missingDirCount: dirPlan.missingDirs.length,
      chunkCount: chunkPlan.chunkCount,
      chunkSize: chunkPlan.chunkSize,
      maxChunkPayloadBytes: chunkPlan.maxPayloadBytes,
      maxAllowedPayloadBytes: MAX_ANCHOR_PAYLOAD_BYTES,
      originalSize: originalBuffer.length,
      compressedSize: compressed.length,
      anchorCount: dirPlan.missingDirs.length + chunkPlan.chunkCount + 1,
      batchCount: batchPlan.batchCount,
      maxBatchTxBytes: batchPlan.maxBatchTxBytes,
      estimatedMaxBatchTxBytes: batchPlan.estimatedMaxTxBytes,
      estimatedFeeSat: dirFeeSat + batchPlan.estimatedFeeSat,
      estimatedFeeBsv: (dirFeeSat + batchPlan.estimatedFeeSat) / 100000000,
      previewElapsedMs: Date.now() - startedAt,
    });
    const nextTask = saveTask({
      ...task,
      fileId,
      status: spoolStore ? 'awaiting_confirm' : 'previewed',
      sourceFileReady: true,
      chunkCount: chunkPlan.chunkCount,
      batchCount: batchPlan.batchCount,
      completedBatchCount: 0,
      estimatedFeeSat: Number(preview.estimatedFeeSat || 0),
      estimatedFeeBsv: Number(preview.estimatedFeeBsv || 0),
      preview,
      updatedAt: new Date().toISOString(),
    });
    persistSpoolPlan(nextTask, { fileId, compressed, chunkPlan, batchPlan, preview });
    return spoolStore ? spoolStore.loadTask(taskId) : nextTask;
  }

  async function finishUploadTask(taskId, options = {}) {
    const key = String(taskId || '').trim();
    if (!key) throw new Error('upload task not found');
    const existing = finishTaskInFlight.get(key);
    if (existing) return existing;
    const promise = finishUploadTaskUnlocked(key, options)
      .finally(() => {
        if (finishTaskInFlight.get(key) === promise) finishTaskInFlight.delete(key);
      });
    finishTaskInFlight.set(key, promise);
    return promise;
  }

  function emitSpoolTask(task, extra = {}) {
    const batchCount = Math.max(0, Number(task.batchCount || extra.batchCount || 0));
    const completed = Math.max(0, Number(task.completedBatchCount || 0));
    const extraBatchIndex = Math.max(0, Number(extra.batchIndex || 0));
    const stage = String(extra.stage || '').trim();
    const activeBatchProgress = batchCount > 0 && extraBatchIndex > completed
      ? Math.min(0.99, (completed + (stage === 'wallet_anchor_batch_broadcasted' ? 0.85 : 0.25)) / Math.max(1, batchCount))
      : 0;
    const persistedProgress = batchCount > 0 ? completed / Math.max(1, batchCount) : 0;
    emit('drive.upload.progress', {
      taskId: task.taskId,
      status: task.status,
      uploadedBytes: Number(task.totalBytes || task.uploadedBytes || 0),
      totalBytes: Number(task.totalBytes || 0),
      progress: Math.max(persistedProgress, activeBatchProgress),
      onchainProgress: Math.max(persistedProgress, activeBatchProgress),
      batchIndex: completed,
      batchCount,
      fileName: task.fileName,
      dirPath: task.dirPath || task.targetDirPath,
      estimatedFeeSat: Number(task.estimatedFeeSat || task.preview?.estimatedFeeSat || 0),
      spentFeeSat: Number(task.spentFeeSat || 0),
      error: String(task.lastError || ''),
      ...extra,
    });
  }

  async function runQueueWorker(password) {
    if (!spoolStore || queueWorkerRunning) return;
    queueWorkerRunning = true;
    try {
      while (true) {
        const queue = spoolStore.loadQueue();
        const taskId = queue.taskOrder.find((id) => {
          const task = spoolStore.loadTask(id);
          const status = String(task?.status || '');
          return task && ['queued', 'paused'].includes(status);
        });
        if (!taskId) break;
        const taskPassword = queuePasswords.get(taskId) || password;
        if (!taskPassword) break;
        spoolStore.saveQueue({
          ...spoolStore.loadQueue(),
          activeTaskId: taskId,
        });
        try {
          await anchorSpoolTask(taskId, { password: taskPassword });
        } finally {
          const latestQueue = spoolStore.loadQueue();
          if (String(latestQueue.activeTaskId || '') === taskId) {
            spoolStore.saveQueue({
              ...latestQueue,
              activeTaskId: '',
            });
          }
        }
      }
    } finally {
      queueWorkerRunning = false;
    }
  }

  function triggerQueueWorker(password) {
    runQueueWorker(password).catch((error) => {
      emit('drive.upload.queue.error', {
        error: String(error?.message || error || 'upload queue failed'),
      });
    });
  }

  async function confirmSpoolTask(taskId, options = {}) {
    const task = loadTask(taskId);
    if (!task) throw new Error('upload task not found');
    const password = String(options.password || '').trim();
    if (!password) throw new Error('wallet password is required');
    const previewTask = task.preview ? task : await previewUploadTask(taskId, options);
    const preview = withBalancePreflight(previewTask.preview || {});
    if (preview.insufficientBalance === true) {
      const next = spoolStore.saveTask({
        ...previewTask,
        status: 'failed',
        lastError: buildInsufficientBalanceMessage(preview),
        preview,
      });
      emitSpoolTask(next, { progress: 0 });
      return {
        taskId,
        queued: false,
        insufficientBalance: true,
        warning: next.lastError,
        preview,
      };
    }
    queuePasswords.set(taskId, password);
    spoolStore.enqueue(taskId);
    const queued = spoolStore.saveTask({
      ...previewTask,
      status: 'queued',
      preview,
      confirmedAt: new Date().toISOString(),
    });
    emitSpoolTask(queued, { progress: 0 });
    if (backgroundQueue) {
      triggerQueueWorker(password);
      return {
        taskId,
        queued: true,
        status: 'queued',
        preview,
      };
    }
    const completed = await anchorSpoolTask(taskId, { password });
    return {
      taskId,
      queued: false,
      status: 'completed',
      fileId: String(completed?.fileId || previewTask.fileId || ''),
      parentDirId: String(completed?.parentDirId || ''),
    };
  }

  async function anchorSpoolTask(taskId, options = {}) {
    if (!spoolStore) throw new Error('spool store is unavailable');
    let task = spoolStore.loadTask(taskId);
    if (!task) throw new Error('upload task not found');
    const password = String(options.password || '').trim();
    if (!password) throw new Error('wallet password is required');
    assertFileNameAvailable(task.ownerWalletId, task.dirPath || task.targetDirPath || '/', task.fileName, { excludeTaskId: task.taskId });
    if (!task.preview) task = await previewUploadTask(taskId, options);
    const preview = withBalancePreflight(task.preview || {});
    if (preview.insufficientBalance === true) {
      const failed = spoolStore.saveTask({
        ...task,
        status: 'failed',
        lastError: buildInsufficientBalanceMessage(preview),
        preview,
      });
      emitSpoolTask(failed);
      return failed;
    }
    task = spoolStore.saveTask({ ...task, status: 'anchoring', lastError: '' });
    emitSpoolTask(task);

    const rootSettings = store.loadOwnerSettings(task.ownerWalletId);
    const parentDirId = await ensureDirPathExists({
      ownerWalletId: task.ownerWalletId,
      dirPath: task.dirPath || task.targetDirPath || '/',
      password,
    });
    const parentDir = runtime.getDirById(task.ownerWalletId, parentDirId);
    let sourceFile = String(task.sourceFile || task.tempFile || spoolStore.sourceFile(task.taskId));
    let localRelativePath = runtime.normalizePath(`${String(parentDir?.path || task.dirPath || '/')}/${task.fileName}`);
    let downloaded = false;
    if (rootSettings.rootLocalDir) {
      const finalTargetDir = fsService.ensureLocalDirectory(rootSettings.rootLocalDir, parentDir?.path || task.dirPath || '/');
      const finalSourceFile = path.resolve(finalTargetDir, task.fileName);
      if (path.resolve(sourceFile) !== path.resolve(finalSourceFile)) {
        fsService.copyFile(sourceFile, finalSourceFile);
        sourceFile = finalSourceFile;
      }
      downloaded = true;
    }
    const contentRef = `drive-chunks:${task.fileId}`;
    const fileObject = buildFileObject({
      ownerWalletId: task.ownerWalletId,
      fileId: task.fileId,
      parentDirId,
      encryptedName: cryptoService.encryptFileName(task.fileName, { fileId: task.fileId }, { password }),
      size: Number(task.compressedSize || task.preview?.compressedSize || 0),
      originalSize: Number(task.originalSize || task.preview?.originalSize || task.totalBytes || 0),
      chunkCount: Number(task.chunkCount || task.preview?.chunkCount || 0),
      contentRef,
      contentHash: String(task.contentHash || ''),
    });

    const batches = spoolStore.listBatches(task.taskId);
    for (const batch of batches) {
      const current = spoolStore.loadBatch(task.taskId, batch.batchIndex) || batch;
      if (['observed', 'broadcasted', 'completed'].includes(normalizeBatchStatus(current.status))) continue;
      const batchIndex = Number(current.batchIndex || 0);
      spoolStore.saveBatch(task.taskId, {
        ...current,
        status: 'broadcasting',
        attempts: Number(current.attempts || 0) + 1,
        lastError: '',
      });
      task = spoolStore.saveTask({
        ...spoolStore.loadTask(task.taskId),
        status: 'anchoring',
        completedBatchCount: completedBatchCount(task.taskId),
      });
      emitSpoolTask(task, {
        batchIndex: batchIndex + 1,
        batchCount: batches.length,
        stage: 'batch_started',
      });
      const chunkPlans = loadSpoolChunkPlansForBatch(task.taskId, current);
      const batchFileObject = current.includesFileObject ? fileObject : null;
      try {
        const result = await chainService.anchorChunkAndFileObjectsBatch(chunkPlans, batchFileObject, {
          password,
          updatedAt: new Date().toISOString(),
          includeUnconfirmed: true,
          trackOutputs: true,
          onStage: (stage, extra = {}) => {
            emitSpoolTask(spoolStore.loadTask(task.taskId) || task, {
              status: 'anchoring',
              batchIndex: batchIndex + 1,
              batchCount: batches.length,
              stage: String(stage || ''),
              txid: String(extra?.txid || ''),
              observed: Boolean(extra?.observed),
              observedNode: String(extra?.observedNode || ''),
            });
          },
        });
        const txid = String(result?.txid || '').trim();
        const feeSat = Math.max(0, Number(result?.feeSat || current.estimatedFeeSat || 0));
        spoolStore.saveTxResult(task.taskId, batchIndex, {
          status: result?.observed ? 'observed' : 'broadcasted',
          txid,
          feeSat,
          observed: Boolean(result?.observed),
          observedNode: String(result?.observedNode || ''),
          broadcastedAt: new Date().toISOString(),
          rawtx: String(result?.rawtx || ''),
        });
        spoolStore.saveBatch(task.taskId, {
          ...current,
          status: result?.observed ? 'observed' : 'broadcasted',
          txid,
          feeSat,
          observed: Boolean(result?.observed),
          observedNode: String(result?.observedNode || ''),
          lastError: '',
        });
        task = spoolStore.saveTask({
          ...spoolStore.loadTask(task.taskId),
          status: 'anchoring',
          completedBatchCount: completedBatchCount(task.taskId),
          spentFeeSat: Number(spoolStore.listBatches(task.taskId).reduce((sum, row) => sum + Number(row.feeSat || 0), 0)),
        });
        emitSpoolTask(task, {
          batchIndex: batchIndex + 1,
          batchCount: batches.length,
          stage: 'batch_completed',
          txid,
        });
      } catch (err) {
        const message = String(err?.message || 'batch anchor failed');
        spoolStore.saveBatch(task.taskId, {
          ...current,
          status: 'failed',
          txid: String(err?.txid || current.txid || ''),
          lastError: message,
        });
        const failed = spoolStore.saveTask({
          ...spoolStore.loadTask(task.taskId),
          status: 'paused',
          completedBatchCount: completedBatchCount(task.taskId),
          lastError: message,
        });
        emitSpoolTask(failed);
        throw err;
      }
    }

    const runtimeEntry = {
      ...fileObject,
      name: task.fileName,
      path: localRelativePath,
      localRelativePath,
      downloaded,
    };
    store.saveFile(runtimeEntry);
    runtime.upsertFile(runtimeEntry);
    const completed = spoolStore.saveTask({
      ...spoolStore.loadTask(task.taskId),
      status: 'completed',
      fileId: task.fileId,
      parentDirId,
      completedBatchCount: batches.length,
      spentFeeSat: Number(spoolStore.listBatches(task.taskId).reduce((sum, row) => sum + Number(row.feeSat || 0), 0)),
    });
    emit('drive.file.added', {
      ownerWalletId: task.ownerWalletId,
      fileId: task.fileId,
      parentDirId,
      fileName: task.fileName,
      dirPath: task.dirPath,
    });
    emit('drive.tree.updated', {
      ownerWalletId: task.ownerWalletId,
      dirPath: task.dirPath,
    });
    emitSpoolTask(completed, { progress: 1 });
    spoolStore.removeFromQueue(task.taskId);
    queuePasswords.delete(task.taskId);
    spoolStore.deleteTask(task.taskId);
    return completed;
  }

  async function finishUploadTaskUnlocked(taskId, options = {}) {
    const task = loadTask(taskId);
    if (!task) throw new Error('upload task not found');
    assertFileNameAvailable(task.ownerWalletId, task.dirPath || task.targetDirPath || '/', task.fileName, { excludeTaskId: task.taskId });
    if (spoolStore) {
      return confirmSpoolTask(taskId, options);
    }
    const password = String(options.password || '').trim();
    if (!password) throw new Error('wallet password is required');
    const previewTask = task.preview ? task : await previewUploadTask(taskId, options);
    const preview = withBalancePreflight(previewTask.preview || {});
    const finalized = fsService.finalizeTempFile(task.tempFile);
    const rootSettings = store.loadOwnerSettings(task.ownerWalletId);
    let parentDirId = runtime.findDirByPath(task.ownerWalletId, task.dirPath);
    if (!parentDirId) parentDirId = runtime.loadOwner(task.ownerWalletId).rootDirId;
    const parentDirForPath = runtime.getDirById(task.ownerWalletId, parentDirId);
    let sourceFile = finalized.file;
    let localRelativePath = runtime.normalizePath(`${String(parentDirForPath?.path || task.dirPath || '/')}/${task.fileName}`);
    let downloaded = false;
    if (rootSettings.rootLocalDir) {
      const targetDir = fsService.ensureLocalDirectory(rootSettings.rootLocalDir, parentDirForPath?.path || task.dirPath || '/');
      sourceFile = path.resolve(targetDir, task.fileName);
      fsService.copyFile(finalized.file, sourceFile);
      downloaded = true;
    }
    const originalBuffer = fsService.readFileBuffer(sourceFile);
    const compressed = typeof codec.compressBufferAsync === 'function'
      ? await codec.compressBufferAsync(originalBuffer)
      : codec.compressBuffer(originalBuffer);
    const fileId = makeId('file');
    const chunkPlan = await chooseChunkPlan({
      ownerWalletId: task.ownerWalletId,
      password,
      compressed,
      fileId,
      task,
    });
    const contentRef = `drive-chunks:${fileId}`;
    if (preview.insufficientBalance === true) {
      const message = buildInsufficientBalanceMessage(preview);
      const fileObject = buildFileObject({
        ownerWalletId: task.ownerWalletId,
        fileId,
        parentDirId,
        encryptedName: cryptoService.encryptFileName(task.fileName, { fileId }, { password }),
        size: compressed.length,
        originalSize: originalBuffer.length,
        chunkCount: chunkPlan.chunkCount,
        contentRef,
        contentHash: cryptoService.sha256Hex(compressed),
      });
      const runtimeEntry = {
        ...fileObject,
        name: task.fileName,
        path: localRelativePath,
        localRelativePath,
        downloaded,
        onchainStatus: 'not_onchain',
        anchorError: message,
        uploadTaskId: taskId,
      };
      store.saveFile(runtimeEntry);
      runtime.upsertFile(runtimeEntry);
      fsService.cleanupTemp(task.tempFile);
      saveTask({
        ...task,
        status: 'not_onchain',
        uploadedBytes: finalized.size,
        fileId,
        parentDirId,
        preview,
        failure: buildFailureSummary({
          task,
          fileId,
          parentDirId,
          failureStage: 'insufficient_balance',
          error: message,
          chunkCount: chunkPlan.chunkCount,
        }),
        updatedAt: new Date().toISOString(),
      });
      emit('drive.file.not_onchain', {
        ownerWalletId: task.ownerWalletId,
        fileId,
        parentDirId,
        fileName: task.fileName,
        dirPath: task.dirPath,
        error: message,
      });
      emit('drive.tree.updated', {
        ownerWalletId: task.ownerWalletId,
        dirPath: task.dirPath,
      });
      return {
        taskId,
        fileId,
        parentDirId,
        chunkCount: chunkPlan.chunkCount,
        size: originalBuffer.length,
        compressedSize: compressed.length,
        estimatedFeeSat: Number(preview?.estimatedFeeSat || 0),
        walletConfirmedSat: Number(preview?.walletConfirmedSat || 0),
        shortfallSat: Number(preview?.shortfallSat || 0),
        onchainStatus: 'not_onchain',
        insufficientBalance: true,
        warning: message,
      };
    }
    parentDirId = await ensureDirPathExists({
      ownerWalletId: task.ownerWalletId,
      dirPath: task.dirPath,
      password,
    });
    const parentDir = runtime.getDirById(task.ownerWalletId, parentDirId);
    localRelativePath = runtime.normalizePath(`${String(parentDir?.path || task.dirPath || '/')}/${task.fileName}`);
    if (rootSettings.rootLocalDir) {
      const finalTargetDir = fsService.ensureLocalDirectory(rootSettings.rootLocalDir, parentDir?.path || task.dirPath || '/');
      const finalSourceFile = path.resolve(finalTargetDir, task.fileName);
      if (path.resolve(sourceFile) !== path.resolve(finalSourceFile)) {
        fsService.copyFile(finalized.file, finalSourceFile);
        sourceFile = finalSourceFile;
        if (typeof fsService.removePath === 'function') {
          try { fsService.removePath(path.resolve(rootSettings.rootLocalDir, task.fileName)); } catch (_) {}
        }
      }
      downloaded = true;
    }
    const fileObject = buildFileObject({
      ownerWalletId: task.ownerWalletId,
      fileId,
      parentDirId,
      encryptedName: cryptoService.encryptFileName(task.fileName, { fileId }, { password }),
      size: compressed.length,
      originalSize: originalBuffer.length,
      chunkCount: chunkPlan.chunkCount,
      contentRef,
      contentHash: cryptoService.sha256Hex(compressed),
    });
    const completedChunkIndexes = [];
    const completedChunkTxids = [];
    try {
      const anchorResult = await anchorChunkFileBatches({
        chunkPlans: chunkPlan.chunkPlans,
        fileObject,
        ownerWalletId: task.ownerWalletId,
        password,
        task,
      });
      completedChunkIndexes.push(...anchorResult.completedChunkIndexes);
      completedChunkTxids.push(...anchorResult.completedChunkTxids);
    } catch (err) {
      if (Array.isArray(err?.completedChunkIndexes)) completedChunkIndexes.push(...err.completedChunkIndexes);
      if (Array.isArray(err?.completedChunkTxids)) completedChunkTxids.push(...err.completedChunkTxids);
      const summary = buildFailureSummary({
        task,
        fileId,
        parentDirId,
        completedChunkIndexes,
        completedChunkTxids,
        failedChunkIndex: Number.isInteger(err?.failedChunkIndex) ? err.failedChunkIndex : (completedChunkIndexes.length < chunkPlan.chunkCount ? completedChunkIndexes.length : null),
        failedTxid: String(err?.txid || '').trim(),
        failureStage: String(err?.failureStage || 'batch_anchor_failed'),
        error: String(err?.message || 'batch anchor failed'),
        chunkCount: chunkPlan.chunkCount,
      });
      markUploadTaskFailed(task, summary);
      throw err;
    }
    const runtimeEntry = {
      ...fileObject,
      name: task.fileName,
      path: localRelativePath,
      localRelativePath,
      downloaded,
    };
    store.saveFile(runtimeEntry);
    runtime.upsertFile(runtimeEntry);
    if (typeof fsService.removeChunkSet === 'function' && typeof chainService?.isAnchorMode === 'function' && chainService.isAnchorMode()) {
      fsService.removeChunkSet(fileId);
    }
    fsService.cleanupTemp(task.tempFile);
    saveTask({
      ...task,
      status: 'completed',
      uploadedBytes: finalized.size,
      fileId,
      parentDirId,
      uploadProgress: {
        chunkCount: chunkPlan.chunkCount,
        completedChunkCount: chunkPlan.chunkCount,
        completedChunkIndexes: completedChunkIndexes.slice(),
        completedChunkTxids: completedChunkTxids.slice(),
      },
      failure: null,
      updatedAt: new Date().toISOString(),
    });
    emit('drive.file.added', {
      ownerWalletId: task.ownerWalletId,
      fileId,
      parentDirId,
      fileName: task.fileName,
      dirPath: task.dirPath,
    });
    emit('drive.tree.updated', {
      ownerWalletId: task.ownerWalletId,
      dirPath: task.dirPath,
    });
    return {
      taskId,
      fileId,
      parentDirId,
      chunkCount: chunkPlan.chunkCount,
      size: originalBuffer.length,
      compressedSize: compressed.length,
      estimatedFeeSat: Number(preview?.estimatedFeeSat || 0),
    };
  }

  async function anchorLocalFile(fileId, options = {}) {
    const ownerWalletId = String(options.ownerWalletId || '').trim();
    const password = String(options.password || '').trim();
    if (!ownerWalletId) throw new Error('ownerWalletId is required');
    if (!password) throw new Error('wallet password is required');
    const file = runtime.getFileById(ownerWalletId, fileId);
    if (!file) throw new Error('drive file not found');
    if (String(file.onchainStatus || 'anchored') !== 'not_onchain') {
      return {
        fileId: file.fileId,
        parentDirId: file.parentDirId,
        onchainStatus: String(file.onchainStatus || 'anchored'),
        alreadyAnchored: true,
      };
    }
    const rootSettings = store.loadOwnerSettings(ownerWalletId);
    if (!rootSettings.rootLocalDir) throw new Error('root local directory is not configured');
    const relativePath = runtime.normalizePath(file.localRelativePath || file.path || '/');
    const sourceFile = path.resolve(rootSettings.rootLocalDir, `.${relativePath}`);
    const originalBuffer = fsService.readFileBuffer(sourceFile);
    const compressed = typeof codec.compressBufferAsync === 'function'
      ? await codec.compressBufferAsync(originalBuffer)
      : codec.compressBuffer(originalBuffer);
    const chunkPlan = await chooseChunkPlan({
      ownerWalletId,
      password,
      compressed,
      fileId: file.fileId,
    });
    const fileObject = buildFileObject({
      ownerWalletId,
      fileId: file.fileId,
      parentDirId: file.parentDirId,
      encryptedName: cryptoService.encryptFileName(file.name, { fileId: file.fileId }, { password }),
      size: compressed.length,
      originalSize: originalBuffer.length,
      chunkCount: chunkPlan.chunkCount,
      contentRef: `drive-chunks:${file.fileId}`,
      contentHash: cryptoService.sha256Hex(compressed),
    });
    const batchPlan = buildChunkFileBatches(chunkPlan.chunkPlans, fileObject, ownerWalletId);
    const estimatedFeeSat = batchPlan.estimatedFeeSat;
    const preview = withBalancePreflight({
      taskId: String(file.uploadTaskId || ''),
      fileName: file.name,
      dirPath: runtime.pathForDir ? runtime.pathForDir(ownerWalletId, file.parentDirId) : '',
      missingDirCount: 0,
      chunkCount: chunkPlan.chunkCount,
      chunkSize: chunkPlan.chunkSize,
      maxChunkPayloadBytes: chunkPlan.maxPayloadBytes,
      maxAllowedPayloadBytes: MAX_ANCHOR_PAYLOAD_BYTES,
      originalSize: originalBuffer.length,
      compressedSize: compressed.length,
      anchorCount: chunkPlan.chunkCount + 1,
      batchCount: batchPlan.batchCount,
      maxBatchTxBytes: batchPlan.maxBatchTxBytes,
      estimatedMaxBatchTxBytes: batchPlan.estimatedMaxTxBytes,
      estimatedFeeSat,
      estimatedFeeBsv: estimatedFeeSat / 100000000,
    });
    if (preview.insufficientBalance === true) {
      const message = buildInsufficientBalanceMessage(preview);
      const nextEntry = {
        ...file,
        onchainStatus: 'not_onchain',
        anchorError: message,
        downloaded: true,
      };
      store.saveFile(nextEntry);
      runtime.upsertFile(nextEntry);
      throw new Error(message);
    }
    const completedChunkIndexes = [];
    const completedChunkTxids = [];
    try {
      const anchorResult = await anchorChunkFileBatches({
        chunkPlans: chunkPlan.chunkPlans,
        fileObject,
        ownerWalletId,
        password,
      });
      completedChunkIndexes.push(...anchorResult.completedChunkIndexes);
      completedChunkTxids.push(...anchorResult.completedChunkTxids);
    } catch (err) {
      const message = String(err?.message || 'file anchor failed');
      const nextEntry = {
        ...file,
        onchainStatus: 'not_onchain',
        anchorError: message,
        downloaded: true,
      };
      store.saveFile(nextEntry);
      runtime.upsertFile(nextEntry);
      throw err;
    }
    const runtimeEntry = {
      ...fileObject,
      name: file.name,
      path: relativePath,
      localRelativePath: relativePath,
      downloaded: true,
      onchainStatus: 'anchored',
      anchorError: '',
      uploadTaskId: String(file.uploadTaskId || ''),
    };
    store.saveFile(runtimeEntry);
    runtime.upsertFile(runtimeEntry);
    if (typeof fsService.removeChunkSet === 'function' && typeof chainService?.isAnchorMode === 'function' && chainService.isAnchorMode()) {
      fsService.removeChunkSet(file.fileId);
    }
    emit('drive.file.anchored', {
      ownerWalletId,
      fileId: file.fileId,
      parentDirId: file.parentDirId,
      fileName: file.name,
    });
    emit('drive.tree.updated', {
      ownerWalletId,
      dirPath: runtime.pathForDir ? runtime.pathForDir(ownerWalletId, file.parentDirId) : '',
    });
    return {
      fileId: file.fileId,
      parentDirId: file.parentDirId,
      chunkCount: chunkPlan.chunkCount,
      completedChunkIndexes,
      completedChunkTxids,
      estimatedFeeSat,
      onchainStatus: 'anchored',
    };
  }

  function cancelUploadTask(taskId) {
    const task = loadTask(taskId);
    if (!task) return false;
    try {
      if (task.tempFile) fsService.cleanupTemp(task.tempFile);
    } catch (_) {}
    deleteTask(taskId);
    emit('drive.upload.progress', {
      taskId,
      status: 'cancelled',
      uploadedBytes: 0,
      totalBytes: Number(task.totalBytes || 0),
      progress: 0,
      fileName: task.fileName,
      dirPath: task.dirPath,
    });
    return true;
  }

  function listUploadTasks(ownerWalletId = '') {
    const safeOwner = String(ownerWalletId || '').trim();
    if (spoolStore) {
      return spoolStore.listTasks()
        .filter((task) => !safeOwner || String(task.ownerWalletId || '') === safeOwner)
        .map((task) => {
          const batches = spoolStore.listBatches(task.taskId);
          const activeBatch = batches.find((batch) => !['observed', 'broadcasted', 'completed'].includes(normalizeBatchStatus(batch.status))) || null;
          return {
            ...task,
            batches: undefined,
            activeBatchStatus: String(activeBatch?.status || ''),
            activeBatchIndex: activeBatch ? Number(activeBatch.batchIndex || 0) : Math.max(0, Number(task.completedBatchCount || 0)),
            batchIndex: Math.max(0, Number(task.completedBatchCount || 0)),
            batchCount: Math.max(0, Number(task.batchCount || batches.length || 0)),
          };
        });
    }
    const tasks = typeof store.loadTasks === 'function' ? Object.values(store.loadTasks()) : [];
    return tasks.filter((task) => !safeOwner || String(task.ownerWalletId || '') === safeOwner);
  }

  function listUploadTasksForDir(ownerWalletId, dirPath) {
    const safePath = runtime.normalizePath(dirPath || '/');
    return listUploadTasks(ownerWalletId).filter((task) => {
      const status = String(task.status || '');
      if (['completed', 'cancelled'].includes(status)) return false;
      return runtime.normalizePath(task.dirPath || task.targetDirPath || '/') === safePath;
    });
  }

  async function resumeUploadTask(taskId, options = {}) {
    if (!spoolStore) return finishUploadTask(taskId, options);
    const task = spoolStore.loadTask(taskId);
    if (!task) throw new Error('upload task not found');
    const password = String(options.password || '').trim();
    if (!password) throw new Error('wallet password is required');
    queuePasswords.set(taskId, password);
    spoolStore.enqueue(taskId);
    const next = spoolStore.saveTask({
      ...task,
      status: 'queued',
      lastError: '',
    });
    emitSpoolTask(next);
    if (backgroundQueue) {
      triggerQueueWorker(password);
      return { taskId, queued: true, status: 'queued' };
    }
    await anchorSpoolTask(taskId, { password });
    return { taskId, status: 'completed' };
  }

  function recoverInterruptedUploadTasks() {
    if (!spoolStore) return [];
    const recovered = spoolStore.recoverInterruptedTasks();
    for (const task of recovered) emitSpoolTask(task);
    return recovered;
  }

  return {
    ensureDirPathExists,
    renameDir,
    createUploadTask,
    appendUploadChunk,
    previewUploadTask,
    finishUploadTask,
    resumeUploadTask,
    listUploadTasks,
    listUploadTasksForDir,
    recoverInterruptedUploadTasks,
    anchorLocalFile,
    cancelUploadTask,
  };
}

module.exports = {
  createDriveUploadService,
};
