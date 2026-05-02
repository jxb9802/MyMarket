const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDriveUploadService } = require('../drive_upload_service');

function makeTempFsService(rootDir) {
  const tempDir = path.join(rootDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  return {
    createUploadTempFile(taskId) {
      const file = path.join(tempDir, `${taskId}.bin`);
      fs.writeFileSync(file, Buffer.alloc(0));
      return file;
    },
    appendTempChunk(file, chunkBuffer) {
      fs.appendFileSync(file, Buffer.from(chunkBuffer || ''));
      return fs.statSync(file).size;
    },
    finalizeTempFile(file) {
      return {
        file,
        size: fs.existsSync(file) ? fs.statSync(file).size : 0,
      };
    },
    readFileBuffer(file) {
      return fs.readFileSync(file);
    },
    ensureLocalDirectory(rootLocalDir, relativePath) {
      const target = path.join(rootLocalDir, String(relativePath || '/').replace(/^\/+/, ''));
      fs.mkdirSync(target, { recursive: true });
      return target;
    },
    copyFile(source, target) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(source, target);
    },
    cleanupTemp(file) {
      fs.rmSync(file, { force: true });
    },
    removeChunkSet() {},
  };
}

test('drive upload marks task as partial_failed when chunk anchoring fails mid-stream', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-upload-partial-fail-'));
  try {
    const ownerWalletId = 'wallet-test';
    const tasks = new Map();
    const dirs = new Map();
    const files = new Map();
    const ownerSettings = {
      [ownerWalletId]: {
        ownerWalletId,
        rootLocalDir: path.join(tmpRoot, 'drive-root'),
      },
    };
    const runtimeDirs = new Map([
      ['root', { dirId: 'root', path: '/', name: '', ownerWalletId, parentDirId: '' }],
    ]);

    const runtime = {
      normalizePath(input) {
        const parts = String(input || '').replace(/\\/g, '/').split('/').filter(Boolean);
        return `/${parts.join('/')}`.replace(/\/+/g, '/');
      },
      loadOwner() {
        return { rootDirId: 'root' };
      },
      listDir() {
        return { dirs: [], files: [] };
      },
      findDirByPath() {
        return null;
      },
      getDirById(_ownerWalletId, dirId) {
        return runtimeDirs.get(dirId) || null;
      },
      upsertDir(entry) {
        runtimeDirs.set(entry.dirId, entry);
      },
      upsertFile(entry) {
        files.set(entry.fileId, entry);
      },
    };

    const store = {
      saveTask(task) {
        tasks.set(task.taskId, JSON.parse(JSON.stringify(task)));
      },
      loadTask(taskId) {
        const row = tasks.get(taskId);
        return row ? JSON.parse(JSON.stringify(row)) : null;
      },
      deleteTask(taskId) {
        tasks.delete(taskId);
      },
      saveDir(entry) {
        dirs.set(entry.dirId, JSON.parse(JSON.stringify(entry)));
      },
      saveFile(entry) {
        files.set(entry.fileId, JSON.parse(JSON.stringify(entry)));
      },
      loadOwnerSettings(walletId) {
        return ownerSettings[walletId] || { ownerWalletId: walletId, rootLocalDir: '' };
      },
    };

    const fsService = makeTempFsService(tmpRoot);
    const chainService = {
      isAnchorMode() {
        return true;
      },
      async anchorDirObject(dirObject) {
        return { txid: `dir-${dirObject.dirId}` };
      },
      async anchorChunkObject(chunkObject) {
        if (Number(chunkObject.chunkIndex || 0) === 1) {
          const err = new Error('forced chunk failure');
          err.txid = 'failed-chunk-txid';
          throw err;
        }
        return { txid: `chunk-${chunkObject.chunkIndex}` };
      },
      async anchorFileObject() {
        throw new Error('file object should not be anchored after chunk failure');
      },
    };
    const cryptoService = {
      encryptDirName(name) {
        return JSON.stringify({ name });
      },
      encryptFileName(name) {
        return JSON.stringify({ name });
      },
      encryptChunk(buffer) {
        const payload = Buffer.from(buffer);
        return {
          payload,
          payloadHash: `hash-${payload.length}-${payload.toString('hex').slice(0, 8)}`,
        };
      },
      sha256Hex(buffer) {
        return `sha256-${Buffer.from(buffer).length}`;
      },
    };
    const codec = {
      compressBuffer(buffer) {
        return Buffer.from(buffer);
      },
      splitBuffer(buffer, { chunkSize }) {
        const parts = [];
        for (let i = 0; i < buffer.length; i += chunkSize) {
          parts.push(buffer.subarray(i, Math.min(buffer.length, i + chunkSize)));
        }
        return parts;
      },
    };

    const service = createDriveUploadService({
      runtime,
      store,
      fsService,
      chainService,
      cryptoService,
      codec,
      wallet: {
        MAX_ANCHOR_PAYLOAD_BYTES: 10000,
        DEFAULT_FEE_RATE: 1,
        getCachedBalanceAndHistory() {
          return { confirmed: 100000000, total: 100000000 };
        },
      },
    });

    const task = service.createUploadTask({
      ownerWalletId,
      dirPath: '/docs/specs',
      fileName: 'partial.txt',
      totalBytes: 9000,
    });
    service.appendUploadChunk(task.taskId, Buffer.alloc(9000, 0x61));

    await assert.rejects(
      () => service.finishUploadTask(task.taskId, { password: 'pw' }),
      /forced chunk failure/,
    );

    const failedTask = store.loadTask(task.taskId);
    assert.equal(failedTask.status, 'partial_failed');
    assert.equal(failedTask.failure.failureStage, 'chunk_anchor_failed');
    assert.equal(failedTask.failure.completedChunkCount, 1);
    assert.deepEqual(failedTask.failure.completedChunkIndexes, [0]);
    assert.equal(failedTask.failure.failedChunkIndex, 1);
    assert.equal(failedTask.failure.failedTxid, 'failed-chunk-txid');
    assert.equal(failedTask.failure.recoverable, true);
    assert.equal(files.size, 0);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
