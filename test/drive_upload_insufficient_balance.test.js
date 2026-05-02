const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-upload-insufficient-'));
process.env.BSV_MARKET_DATA_DIR = path.join(tmpRoot, 'data');
fs.mkdirSync(process.env.BSV_MARKET_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.BSV_MARKET_DATA_DIR, 'cache.json'), JSON.stringify({
  confirmed: 0,
  unconfirmed: 0,
  total: 0,
  incomeSat: 0,
  expenseSat: 0,
  txids: [],
  updatedAt: new Date().toISOString()
}));

const { createDriveUploadService } = require(path.join(process.cwd(), 'drive_upload_service'));

function makeTempFsService(rootDir) {
  const tempDir = path.join(rootDir, 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  return {
    createUploadTempFile(taskId) {
      const file = path.join(tempDir, taskId + '.bin');
      fs.writeFileSync(file, Buffer.alloc(0));
      return file;
    },
    appendTempChunk(file, chunkBuffer) {
      fs.appendFileSync(file, Buffer.from(chunkBuffer || ''));
      return fs.statSync(file).size;
    },
    finalizeTempFile(file) {
      return { file, size: fs.statSync(file).size };
    },
    readFileBuffer(file) {
      return fs.readFileSync(file);
    },
    ensureLocalDirectory(rootLocalDir, relativePath) {
      const target = path.join(rootLocalDir, String(relativePath || '/').replace(/^\\/+/, ''));
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

(async () => {
  try {
    const ownerWalletId = 'wallet-low-balance';
    const tasks = new Map();
    const files = new Map();
    const rootLocalDir = path.join(tmpRoot, 'drive-root');
    const runtimeDirs = new Map([
      ['root', { ownerWalletId, dirId: 'root', parentDirId: '', name: '', path: '/', localRelativePath: '/' }],
    ]);
    const runtime = {
      normalizePath(input) {
        const parts = String(input || '').replace(/\\\\/g, '/').split('/').filter(Boolean);
        return '/' + parts.join('/');
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
        return runtimeDirs.get(dirId) || null;
      },
      upsertDir(entry) {
        runtimeDirs.set(entry.dirId, entry);
      },
      upsertFile(entry) {
        files.set(entry.fileId, JSON.parse(JSON.stringify(entry)));
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
      saveDir() {},
      saveFile(entry) {
        files.set(entry.fileId, JSON.parse(JSON.stringify(entry)));
      },
      loadOwnerSettings() {
        return { ownerWalletId, rootLocalDir };
      },
    };
    const fsService = makeTempFsService(tmpRoot);
    let anchorCount = 0;
    const chainService = {
      isAnchorMode() {
        return true;
      },
      async anchorDirObject() {
        anchorCount += 1;
        return { txid: 'dir' };
      },
      async anchorChunkObject() {
        anchorCount += 1;
        return { txid: 'chunk' };
      },
      async anchorFileObject() {
        anchorCount += 1;
        return { txid: 'file' };
      },
    };
    const cryptoService = {
      encryptDirName(name) {
        return { name };
      },
      encryptFileName(name) {
        return { name };
      },
      encryptChunk(buffer) {
        const payload = Buffer.from(buffer);
        return { payload, payloadHash: 'hash-' + payload.length };
      },
      sha256Hex(buffer) {
        return 'sha256-' + Buffer.from(buffer).length;
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
    const service = createDriveUploadService({ runtime, store, fsService, chainService, cryptoService, codec });
    const task = service.createUploadTask({
      ownerWalletId,
      dirPath: '/',
      fileName: 'low-balance.txt',
      totalBytes: 4096,
    });
    service.appendUploadChunk(task.taskId, Buffer.alloc(4096, 0x61));

    const previewTask = await service.previewUploadTask(task.taskId, { password: 'pw' });
    assert.equal(previewTask.preview.insufficientBalance, true);
    assert.equal(previewTask.preview.canAfford, false);
    assert.ok(Number(previewTask.preview.shortfallSat) > 0);

    const result = await service.finishUploadTask(task.taskId, { password: 'pw' });
    assert.equal(result.insufficientBalance, true);
    assert.equal(result.onchainStatus, 'not_onchain');
    assert.equal(anchorCount, 0);
    const savedFiles = Array.from(files.values());
    assert.equal(savedFiles.length, 1);
    assert.equal(savedFiles[0].onchainStatus, 'not_onchain');
    assert.equal(savedFiles[0].downloaded, true);
    assert.equal(fs.existsSync(path.join(rootLocalDir, 'low-balance.txt')), true);
    const savedTask = store.loadTask(task.taskId);
    assert.equal(savedTask.status, 'not_onchain');
    assert.equal(savedTask.failure.failureStage, 'insufficient_balance');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
`;

test('drive upload preflight marks file not_onchain without anchoring when balance is insufficient', () => {
  const result = spawnSync(process.execPath, ['-e', SCRIPT], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `exit=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
});
