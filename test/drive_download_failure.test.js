const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createDriveDownloadService } = require('../drive_download_service');

test('drive download marks task failed when restore from chain fails', () => {
  const tasks = new Map();
  const runtimeFiles = new Map([
    ['file-1', {
      fileId: 'file-1',
      name: 'missing.txt',
      chunkCount: 1,
      downloaded: false,
      localRelativePath: '/docs/missing.txt',
      path: '/docs/missing.txt',
    }],
  ]);

  const store = {
    saveTask(task) {
      tasks.set(task.taskId, JSON.parse(JSON.stringify(task)));
    },
    loadOwnerSettings() {
      return { rootLocalDir: '/tmp/drive-root' };
    },
    markFileDownloaded() {},
    listFilesUnderDir() {
      return [];
    },
  };

  const runtime = {
    getFileById(_ownerWalletId, fileId) {
      return runtimeFiles.get(fileId) || null;
    },
    buildFileRelativePath() {
      return '/docs/missing.txt';
    },
    upsertFile(entry) {
      runtimeFiles.set(entry.fileId, entry);
    },
  };

  const fsService = {
    rootDir: '/tmp',
    tempDir: '/tmp',
    pathExists() {
      return false;
    },
    readChunk() {
      throw new Error('chunk not cached');
    },
    writeRestoredFile() {
      throw new Error('should not write restored file on failure');
    },
    readFileBuffer() {
      return Buffer.alloc(0);
    },
    removeChunkSet() {},
  };

  const chainService = {
    isAnchorMode() {
      return true;
    },
    loadChunkPayloads() {
      return [];
    },
  };

  const cryptoService = {
    decryptChunk() {
      throw new Error('missing anchored chunk');
    },
  };

  const codec = {
    mergeChunks() {
      return Buffer.alloc(0);
    },
    decompressBuffer() {
      return Buffer.alloc(0);
    },
  };

  const service = createDriveDownloadService({
    runtime,
    store,
    fsService,
    chainService,
    cryptoService,
    codec,
  });

  assert.throws(
    () => service.downloadFileToServer({
      ownerWalletId: 'wallet-test',
      fileId: 'file-1',
      targetDir: path.resolve('/tmp/restore'),
      password: 'pw',
    }),
    /drive file chunk is missing on chain|missing anchored chunk|chunk not cached/,
  );

  const failedTask = Array.from(tasks.values()).find((row) => row.status === 'failed');
  assert.ok(failedTask);
  assert.equal(failedTask.failure.failureStage, 'restore_file_failed');
  assert.match(String(failedTask.failure.message || ''), /drive file chunk is missing on chain|missing anchored chunk|chunk not cached/);
});
