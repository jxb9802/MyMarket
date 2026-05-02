const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDriveUploadService } = require('../drive_upload_service');
const { createDriveUploadSpoolStore } = require('../drive_upload_spool_store');

function makeFsService(rootDir) {
  return {
    finalizeTempFile(file) {
      return { file, size: fs.statSync(file).size };
    },
    readFileBuffer(file) {
      return fs.readFileSync(file);
    },
    appendTempChunk(file, chunkBuffer) {
      fs.appendFileSync(file, Buffer.from(chunkBuffer || ''));
      return fs.statSync(file).size;
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

test('drive upload spool task completes and removes intermediate files', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-upload-spool-'));
  try {
    const ownerWalletId = 'wallet-spool';
    const dataDir = path.join(tmpRoot, 'data');
    const rootLocalDir = path.join(tmpRoot, 'drive-root');
    const files = new Map();
    const dirs = new Map([
      ['root', { ownerWalletId, dirId: 'root', parentDirId: '', name: '', path: '/', localRelativePath: '/' }],
    ]);
    const runtime = {
      normalizePath(input) {
        const parts = String(input || '').replace(/\\/g, '/').split('/').filter(Boolean);
        return `/${parts.join('/')}`.replace(/\/+/g, '/');
      },
      loadOwner() {
        return { ownerWalletId, rootDirId: 'root' };
      },
      listDir() {
        return { dirs: [], files: [] };
      },
      findDirByPath(_owner, dirPath) {
        return String(dirPath || '/') === '/' ? 'root' : '';
      },
      getDirById(_owner, dirId) {
        return dirs.get(dirId) || null;
      },
      upsertDir(entry) {
        dirs.set(entry.dirId, entry);
      },
      upsertFile(entry) {
        files.set(entry.fileId, JSON.parse(JSON.stringify(entry)));
      },
    };
    const store = {
      saveTask() {},
      loadTask() { return null; },
      deleteTask() {},
      saveDir(entry) {
        dirs.set(entry.dirId, JSON.parse(JSON.stringify(entry)));
      },
      saveFile(entry) {
        files.set(entry.fileId, JSON.parse(JSON.stringify(entry)));
      },
      loadOwnerSettings() {
        return { ownerWalletId, rootLocalDir };
      },
    };
    const spoolStore = createDriveUploadSpoolStore({ dataDir });
    const fsService = makeFsService(tmpRoot);
    const anchoredBatches = [];
    const chainService = {
      isAnchorMode() {
        return true;
      },
      async anchorDirObject(dirObject) {
        return { txid: `dir-${dirObject.dirId}` };
      },
      async anchorChunkAndFileObjectsBatch(chunkPlans, fileObject) {
        anchoredBatches.push({
          chunkCount: chunkPlans.length,
          includesFile: Boolean(fileObject),
        });
        return {
          txid: `tx-${anchoredBatches.length}`,
          feeSat: 1234,
          observed: true,
          observedNode: 'test-node',
        };
      },
    };
    const cryptoService = {
      encryptDirName(name) {
        return JSON.stringify({ name });
      },
      encryptFileName(name) {
        return JSON.stringify({ name });
      },
      deriveFileKey() {
        return Buffer.alloc(32, 1);
      },
      encryptChunk(buffer) {
        const payload = Buffer.from(buffer).reverse();
        return { payload, payloadHash: `hash-${payload.length}` };
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
      spoolStore,
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
      dirPath: '/',
      fileName: 'spool.txt',
      totalBytes: 2048,
    });
    service.appendUploadChunk(task.taskId, Buffer.alloc(2048, 0x61));
    const previewTask = await service.previewUploadTask(task.taskId, { password: 'pw' });
    assert.equal(previewTask.status, 'awaiting_confirm');
    assert.equal(fs.existsSync(spoolStore.taskRoot(task.taskId)), true);

    const result = await service.finishUploadTask(task.taskId, { password: 'pw' });
    assert.equal(result.status, 'completed');
    assert.ok(result.fileId);
    assert.equal(files.size, 1);
    assert.equal(anchoredBatches.length >= 1, true);
    assert.equal(anchoredBatches.at(-1).includesFile, true);
    assert.equal(fs.existsSync(spoolStore.taskRoot(task.taskId)), false);
    assert.equal(fs.existsSync(path.join(rootLocalDir, 'spool.txt')), true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('drive upload spool recovery marks active tasks paused', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-upload-spool-recover-'));
  try {
    const spoolStore = createDriveUploadSpoolStore({ dataDir: path.join(tmpRoot, 'data') });
    const task = spoolStore.createTask({
      taskId: 'task-recover',
      ownerWalletId: 'wallet',
      dirPath: '/docs',
      fileName: 'recover.txt',
      totalBytes: 10,
    });
    spoolStore.saveTask({ ...task, status: 'anchoring' });
    const recovered = spoolStore.recoverInterruptedTasks();
    assert.equal(recovered.length, 1);
    assert.equal(spoolStore.loadTask('task-recover').status, 'paused');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('drive upload rejects duplicate file names in the same directory', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-upload-duplicate-'));
  try {
    const ownerWalletId = 'wallet-spool';
    const dataDir = path.join(tmpRoot, 'data');
    const runtime = {
      normalizePath(input) {
        const parts = String(input || '').replace(/\\/g, '/').split('/').filter(Boolean);
        return `/${parts.join('/')}`.replace(/\/+/g, '/');
      },
      findDirByPath(_owner, dirPath) {
        return String(dirPath || '/') === '/' ? 'root' : '';
      },
      listDir() {
        return { dirs: [], files: [] };
      },
    };
    const store = {
      saveTask() {},
      loadTask() { return null; },
      loadOwnerSettings() {
        return { ownerWalletId, rootLocalDir: '' };
      },
    };
    const spoolStore = createDriveUploadSpoolStore({ dataDir });
    const service = createDriveUploadService({
      runtime,
      store,
      spoolStore,
      fsService: makeFsService(tmpRoot),
      chainService: {},
      cryptoService: {},
      codec: {},
      wallet: {
        MAX_ANCHOR_PAYLOAD_BYTES: 10000,
        DEFAULT_FEE_RATE: 1,
      },
    });

    service.createUploadTask({
      ownerWalletId,
      dirPath: '/',
      fileName: 'same.txt',
      totalBytes: 10,
    });

    assert.throws(
      () => service.createUploadTask({
        ownerWalletId,
        dirPath: '/',
        fileName: 'SAME.txt',
        totalBytes: 20,
      }),
      /same name is already uploading/i,
    );

    service.createUploadTask({
      ownerWalletId,
      dirPath: '/other',
      fileName: 'same.txt',
      totalBytes: 30,
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('drive upload rejects a file name that already exists in the target directory', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-upload-existing-name-'));
  try {
    const ownerWalletId = 'wallet-spool';
    const runtime = {
      normalizePath(input) {
        const parts = String(input || '').replace(/\\/g, '/').split('/').filter(Boolean);
        return `/${parts.join('/')}`.replace(/\/+/g, '/');
      },
      findDirByPath(_owner, dirPath) {
        return String(dirPath || '/') === '/' ? 'root' : '';
      },
      listDir() {
        return {
          dirs: [],
          files: [{ fileId: 'file-1', name: 'exists.txt', deleted: false }],
        };
      },
    };
    const service = createDriveUploadService({
      runtime,
      store: {
        saveTask() {},
        loadTask() { return null; },
        loadOwnerSettings() {
          return { ownerWalletId, rootLocalDir: '' };
        },
      },
      spoolStore: createDriveUploadSpoolStore({ dataDir: path.join(tmpRoot, 'data') }),
      fsService: makeFsService(tmpRoot),
      chainService: {},
      cryptoService: {},
      codec: {},
      wallet: {
        MAX_ANCHOR_PAYLOAD_BYTES: 10000,
        DEFAULT_FEE_RATE: 1,
      },
    });

    assert.throws(
      () => service.createUploadTask({
        ownerWalletId,
        dirPath: '/',
        fileName: 'EXISTS.txt',
        totalBytes: 10,
      }),
      /same name already exists/i,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
