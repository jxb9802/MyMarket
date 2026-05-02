'use strict';

const path = require('path');
const crypto = require('crypto');
const messageQueue = require('./lib/message_queue');

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function createDriveDownloadService(deps = {}) {
  const runtime = deps.runtime;
  const store = deps.store;
  const fsService = deps.fsService;
  const chainService = deps.chainService;
  const cryptoService = deps.cryptoService;
  const codec = deps.codec;

  function emit(topic, payload) {
    return messageQueue.publish(topic, payload, { mode: messageQueue.MODE_TRANSIENT, source: 'drive' });
  }

  function saveTask(task) {
    store.saveTask(task);
    emit('drive.download.progress', {
      taskId: task.taskId,
      status: task.status,
      completedCount: task.completedCount,
      totalCount: task.totalCount,
      targetDir: task.targetDir,
    });
    return task;
  }

  function markDownloadTaskFailed(task, error, extra = {}) {
    return saveTask({
      ...task,
      status: 'failed',
      error: String(error?.message || error || 'download failed'),
      failure: {
        fileId: String(extra.fileId || '').trim(),
        dirId: String(extra.dirId || '').trim(),
        targetDir: String(task?.targetDir || '').trim(),
        failureStage: String(extra.failureStage || 'download_failed').trim() || 'download_failed',
        message: String(error?.message || error || 'download failed'),
        updatedAt: new Date().toISOString(),
      },
      updatedAt: new Date().toISOString(),
    });
  }

  function emitDownloaded(ownerWalletId, restored) {
    emit('drive.file.downloaded', {
      ownerWalletId,
      fileId: String(restored?.fileId || '').trim(),
      outputPath: String(restored?.outputPath || '').trim(),
      relativePath: String(restored?.relativePath || '').trim(),
      fileName: String(restored?.fileName || '').trim(),
      size: Number(restored?.size || 0),
    });
    emit('drive.tree.updated', {
      ownerWalletId,
      dirPath: path.posix.dirname(String(restored?.relativePath || '/')).replace(/\/+/g, '/') || '/',
    });
  }

  function localAbsolutePath(rootDir, relativePath) {
    return path.resolve(String(rootDir || '').trim() || fsService.rootDir, `.${String(relativePath || '/').trim() || '/'}`);
  }

  function cleanupChunkCache(fileId) {
    if (typeof fsService.removeChunkSet === 'function' && typeof chainService?.isAnchorMode === 'function' && chainService.isAnchorMode()) {
      fsService.removeChunkSet(fileId);
    }
  }

  function restoreSingleFile(ownerWalletId, fileId, targetDir, options = {}) {
    const password = String(options.password || '').trim();
    if (!password) throw new Error('wallet password is required');
    const file = runtime.getFileById(ownerWalletId, fileId);
    if (!file) throw new Error('file not found');
    const targetRoot = path.resolve(String(targetDir || '').trim() || fsService.rootDir);
    const relativePath = runtime.buildFileRelativePath(ownerWalletId, fileId);
    const outputPath = localAbsolutePath(targetRoot, relativePath);
    if (fsService.pathExists(outputPath)) {
      if (file.downloaded !== true) {
        store.markFileDownloaded(ownerWalletId, fileId, true, relativePath);
        runtime.upsertFile({ ...file, downloaded: true, localRelativePath: relativePath, path: relativePath });
      }
      cleanupChunkCache(fileId);
      return {
        fileId,
        outputPath,
        size: fsService.readFileBuffer(outputPath).length,
        relativePath,
        fileName: file.name,
      };
    }
    const anchoredChunks = chainService.loadChunkPayloads(ownerWalletId, fileId);
    const anchorMode = typeof chainService?.isAnchorMode === 'function' && chainService.isAnchorMode();
    const chunks = [];
    for (let index = 0; index < Number(file.chunkCount || 0); index += 1) {
      const anchored = anchoredChunks.find((entry) => Number(entry?.chunkIndex) === index);
      let payload = anchored?.payload || null;
      if (!payload && !anchorMode) payload = fsService.readChunk(fileId, index);
      if (!payload) {
        const error = new Error(`drive file chunk is missing on chain: fileId=${fileId} chunkIndex=${index}`);
        error.code = 'DRIVE_CHUNK_MISSING';
        error.fileId = fileId;
        error.chunkIndex = index;
        throw error;
      }
      chunks.push(cryptoService.decryptChunk(payload, fileId, index, { password }));
    }
    const compressed = codec.mergeChunks(chunks);
    const restored = codec.decompressBuffer(compressed);
    fsService.writeRestoredFile(outputPath, restored);
    store.markFileDownloaded(ownerWalletId, fileId, true, relativePath);
    runtime.upsertFile({ ...file, downloaded: true, localRelativePath: relativePath, path: relativePath });
    cleanupChunkCache(fileId);
    return {
      fileId,
      outputPath,
      size: restored.length,
      relativePath,
      fileName: file.name,
    };
  }

  function downloadFileToServer({ ownerWalletId, fileId, targetDir, password }) {
    const file = runtime.getFileById(ownerWalletId, fileId);
    if (!file) throw new Error('file not found');
    const taskId = makeId('drive-download');
    const task = saveTask({
      taskId,
      ownerWalletId,
      targetDir: path.resolve(targetDir),
      totalCount: 1,
      completedCount: 0,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    try {
      const restored = restoreSingleFile(ownerWalletId, fileId, targetDir, { password });
      emitDownloaded(ownerWalletId, restored);
      saveTask({
        taskId,
        ownerWalletId,
        targetDir: path.resolve(targetDir),
        totalCount: 1,
        completedCount: 1,
        status: 'completed',
        failure: null,
        updatedAt: new Date().toISOString(),
      });
      return {
        taskId,
        restoredFiles: [restored],
      };
    } catch (error) {
      markDownloadTaskFailed(task, error, { fileId, failureStage: 'restore_file_failed' });
      throw error;
    }
  }

  function downloadDirectoryToServer({ ownerWalletId, dirId, targetDir, password }) {
    const files = store.listFilesUnderDir(ownerWalletId, dirId);
    const taskId = makeId('drive-download');
    const task = saveTask({
      taskId,
      ownerWalletId,
      targetDir: path.resolve(targetDir),
      totalCount: files.length,
      completedCount: 0,
      status: 'running',
      updatedAt: new Date().toISOString(),
    });
    try {
      const restoredFiles = [];
      for (let index = 0; index < files.length; index += 1) {
        const restored = restoreSingleFile(ownerWalletId, files[index].fileId, targetDir, { password });
        restoredFiles.push(restored);
        emitDownloaded(ownerWalletId, restored);
        saveTask({
          taskId,
          ownerWalletId,
          targetDir: path.resolve(targetDir),
          totalCount: files.length,
          completedCount: index + 1,
          status: 'running',
          updatedAt: new Date().toISOString(),
        });
      }
      saveTask({
        taskId,
        ownerWalletId,
        targetDir: path.resolve(targetDir),
        totalCount: files.length,
        completedCount: files.length,
        status: 'completed',
        failure: null,
        updatedAt: new Date().toISOString(),
      });
      return { taskId, restoredFiles };
    } catch (error) {
      markDownloadTaskFailed(task, error, { dirId, failureStage: 'restore_directory_failed' });
      throw error;
    }
  }

  function downloadFileForBrowser({ ownerWalletId, fileId, password }) {
    const file = runtime.getFileById(ownerWalletId, fileId);
    if (!file) throw new Error('file not found');
    const settings = store.loadOwnerSettings(ownerWalletId);
    const targetRoot = String(settings?.rootLocalDir || '').trim() || fsService.tempDir;
    const restored = restoreSingleFile(ownerWalletId, fileId, targetRoot, { password });
    return {
      fileName: file.name,
      buffer: fsService.readFileBuffer(restored.outputPath),
    };
  }

  return {
    downloadFileToServer,
    downloadDirectoryToServer,
    downloadFileForBrowser,
  };
}

module.exports = {
  createDriveDownloadService,
};
