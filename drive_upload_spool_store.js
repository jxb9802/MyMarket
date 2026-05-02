'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function nowIso() {
  return new Date().toISOString();
}

function parseJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function atomicWriteJson(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function normalizePath(pathText = '') {
  const parts = String(pathText || '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => String(part || '').trim())
    .filter(Boolean);
  return `/${parts.join('/')}`.replace(/\/+/g, '/');
}

function taskDirName(taskId) {
  return `upload-${String(taskId || '').trim()}`;
}

function createDriveUploadSpoolStore(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || path.join(__dirname, 'data')));
  const rootDir = ensureDir(path.join(dataDir, 'drive', 'spool'));
  const groupsDir = ensureDir(path.join(rootDir, 'groups'));
  const queueFile = path.join(rootDir, 'queue.json');

  function taskRoot(taskId) {
    const safeTaskId = String(taskId || '').trim();
    if (!safeTaskId) throw new Error('taskId is required');
    return path.join(rootDir, taskDirName(safeTaskId));
  }

  function manifestFile(taskId) {
    return path.join(taskRoot(taskId), 'manifest.json');
  }

  function sourceFile(taskId) {
    return path.join(taskRoot(taskId), 'source.bin');
  }

  function batchFile(taskId, batchIndex) {
    return path.join(taskRoot(taskId), 'batches', `${String(Number(batchIndex || 0)).padStart(6, '0')}.json`);
  }

  function chunkPayloadFile(taskId, chunkIndex) {
    return path.join(taskRoot(taskId), 'chunks', `${String(Number(chunkIndex || 0)).padStart(6, '0')}.bin.enc`);
  }

  function chunkObjectFile(taskId, chunkIndex) {
    return path.join(taskRoot(taskId), 'chunks', `${String(Number(chunkIndex || 0)).padStart(6, '0')}.json`);
  }

  function txResultFile(taskId, batchIndex) {
    return path.join(taskRoot(taskId), 'tx', `${String(Number(batchIndex || 0)).padStart(6, '0')}.result.json`);
  }

  function loadQueue() {
    const queue = parseJsonFile(queueFile, null);
    if (queue && typeof queue === 'object') {
      return {
        version: 1,
        activeTaskId: String(queue.activeTaskId || ''),
        taskOrder: Array.isArray(queue.taskOrder) ? queue.taskOrder.map(String).filter(Boolean) : [],
        updatedAt: String(queue.updatedAt || ''),
      };
    }
    return { version: 1, activeTaskId: '', taskOrder: [], updatedAt: '' };
  }

  function saveQueue(queue) {
    const next = {
      version: 1,
      activeTaskId: String(queue?.activeTaskId || ''),
      taskOrder: Array.from(new Set(Array.isArray(queue?.taskOrder) ? queue.taskOrder.map(String).filter(Boolean) : [])),
      updatedAt: nowIso(),
    };
    atomicWriteJson(queueFile, next);
    return next;
  }

  function loadTask(taskId) {
    const manifest = parseJsonFile(manifestFile(taskId), null);
    return manifest && typeof manifest === 'object' ? manifest : null;
  }

  function saveTask(task) {
    const safeTaskId = String(task?.taskId || '').trim();
    if (!safeTaskId) throw new Error('taskId is required');
    const previous = loadTask(safeTaskId) || {};
    const next = {
      ...previous,
      ...task,
      version: 1,
      taskId: safeTaskId,
      spoolTask: true,
      dirPath: normalizePath(task?.dirPath || task?.targetDirPath || previous.dirPath || previous.targetDirPath || '/'),
      targetDirPath: normalizePath(task?.targetDirPath || task?.dirPath || previous.targetDirPath || previous.dirPath || '/'),
      sourceFile: String(task?.sourceFile || previous.sourceFile || sourceFile(safeTaskId)),
      updatedAt: nowIso(),
    };
    atomicWriteJson(manifestFile(safeTaskId), next);
    return next;
  }

  function createTask({ taskId, ownerWalletId, dirPath, fileName, totalBytes, groupId = '' }) {
    const safeTaskId = String(taskId || '').trim();
    const root = ensureDir(taskRoot(safeTaskId));
    ensureDir(path.join(root, 'chunks'));
    ensureDir(path.join(root, 'batches'));
    ensureDir(path.join(root, 'tx'));
    const source = sourceFile(safeTaskId);
    if (!fs.existsSync(source)) fs.writeFileSync(source, Buffer.alloc(0));
    return saveTask({
      taskId: safeTaskId,
      groupId: String(groupId || ''),
      ownerWalletId: String(ownerWalletId || '').trim(),
      dirPath: normalizePath(dirPath),
      targetDirPath: normalizePath(dirPath),
      fileName: String(fileName || '').trim(),
      totalBytes: Math.max(0, Number(totalBytes || 0)),
      uploadedBytes: 0,
      tempFile: source,
      sourceFile: source,
      sourceFileReady: false,
      status: 'preparing',
      createdAt: nowIso(),
    });
  }

  function appendSourceChunk(taskId, buffer) {
    const file = sourceFile(taskId);
    ensureDir(path.dirname(file));
    fs.appendFileSync(file, Buffer.from(buffer || ''));
    const size = fs.statSync(file).size;
    const task = loadTask(taskId);
    if (task) saveTask({ ...task, uploadedBytes: size, tempFile: file, sourceFile: file });
    return size;
  }

  function markSourceReady(taskId) {
    const task = loadTask(taskId);
    if (!task) throw new Error('upload task not found');
    const file = sourceFile(taskId);
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
    return saveTask({
      ...task,
      uploadedBytes: size,
      sourceFileReady: true,
      tempFile: file,
      sourceFile: file,
    });
  }

  function writeChunk(taskId, chunkIndex, chunkObject, encryptedPayload) {
    const index = Number(chunkIndex || 0);
    ensureDir(path.join(taskRoot(taskId), 'chunks'));
    fs.writeFileSync(chunkPayloadFile(taskId, index), Buffer.from(encryptedPayload || ''));
    atomicWriteJson(chunkObjectFile(taskId, index), chunkObject || {});
  }

  function readChunk(taskId, chunkIndex) {
    const index = Number(chunkIndex || 0);
    return {
      chunkObject: parseJsonFile(chunkObjectFile(taskId, index), null),
      encryptedPayload: fs.readFileSync(chunkPayloadFile(taskId, index)),
    };
  }

  function saveBatch(taskId, batch) {
    const safeIndex = Number(batch?.batchIndex || 0);
    const previous = loadBatch(taskId, safeIndex) || {};
    const next = {
      ...previous,
      ...batch,
      batchIndex: safeIndex,
      updatedAt: nowIso(),
    };
    atomicWriteJson(batchFile(taskId, safeIndex), next);
    return next;
  }

  function loadBatch(taskId, batchIndex) {
    return parseJsonFile(batchFile(taskId, Number(batchIndex || 0)), null);
  }

  function listBatches(taskId) {
    const dir = path.join(taskRoot(taskId), 'batches');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => parseJsonFile(path.join(dir, name), null))
      .filter(Boolean)
      .sort((a, b) => Number(a.batchIndex || 0) - Number(b.batchIndex || 0));
  }

  function saveTxResult(taskId, batchIndex, result) {
    const next = {
      ...(result || {}),
      batchIndex: Number(batchIndex || 0),
      updatedAt: nowIso(),
    };
    atomicWriteJson(txResultFile(taskId, batchIndex), next);
    return next;
  }

  function loadTxResult(taskId, batchIndex) {
    return parseJsonFile(txResultFile(taskId, Number(batchIndex || 0)), null);
  }

  function listTasks() {
    if (!fs.existsSync(rootDir)) return [];
    return fs.readdirSync(rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('upload-'))
      .map((entry) => parseJsonFile(path.join(rootDir, entry.name, 'manifest.json'), null))
      .filter(Boolean)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  }

  function enqueue(taskId) {
    const safeTaskId = String(taskId || '').trim();
    if (!safeTaskId) throw new Error('taskId is required');
    const queue = loadQueue();
    if (!queue.taskOrder.includes(safeTaskId)) queue.taskOrder.push(safeTaskId);
    return saveQueue(queue);
  }

  function removeFromQueue(taskId) {
    const safeTaskId = String(taskId || '').trim();
    const queue = loadQueue();
    return saveQueue({
      ...queue,
      activeTaskId: queue.activeTaskId === safeTaskId ? '' : queue.activeTaskId,
      taskOrder: queue.taskOrder.filter((id) => id !== safeTaskId),
    });
  }

  function saveGroup(group) {
    const groupId = String(group?.groupId || '').trim();
    if (!groupId) throw new Error('groupId is required');
    const file = path.join(groupsDir, `${groupId}.json`);
    const next = {
      ...group,
      groupId,
      updatedAt: nowIso(),
    };
    atomicWriteJson(file, next);
    return next;
  }

  function deleteGroup(groupId) {
    fs.rmSync(path.join(groupsDir, `${String(groupId || '').trim()}.json`), { force: true });
  }

  function deleteTask(taskId) {
    removeFromQueue(taskId);
    fs.rmSync(taskRoot(taskId), { recursive: true, force: true });
  }

  function recoverInterruptedTasks() {
    const recovered = [];
    for (const task of listTasks()) {
      const status = String(task.status || '');
      if (['anchoring', 'signing', 'broadcasting'].includes(status)) {
        recovered.push(saveTask({
          ...task,
          status: 'paused',
          lastError: task.lastError || 'drive_upload_interrupted_resumable',
        }));
      }
    }
    const all = listTasks();
    const queue = loadQueue();
    const existing = new Set(all.map((task) => String(task.taskId || '')));
    saveQueue({
      ...queue,
      activeTaskId: '',
      taskOrder: queue.taskOrder.filter((id) => existing.has(id)),
    });
    return recovered;
  }

  return {
    rootDir,
    groupsDir,
    queueFile,
    taskRoot,
    sourceFile,
    createTask,
    loadTask,
    saveTask,
    deleteTask,
    listTasks,
    appendSourceChunk,
    markSourceReady,
    writeChunk,
    readChunk,
    saveBatch,
    loadBatch,
    listBatches,
    saveTxResult,
    loadTxResult,
    loadQueue,
    saveQueue,
    enqueue,
    removeFromQueue,
    saveGroup,
    deleteGroup,
    recoverInterruptedTasks,
  };
}

module.exports = {
  createDriveUploadSpoolStore,
};
