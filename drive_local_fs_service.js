'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function atomicWriteJson(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

function safeObjectFilePart(value) {
  return Buffer.from(String(value || '').trim(), 'utf8').toString('base64url');
}

function createDriveLocalFsService(options = {}) {
  const dataDir = path.resolve(String(options.dataDir || path.join(__dirname, 'data')));
  const rootDir = ensureDir(path.join(dataDir, 'drive'));
  const tempDir = ensureDir(path.join(rootDir, 'temp'));
  const objectsDir = ensureDir(path.join(rootDir, 'objects'));
  const chunksDir = ensureDir(path.join(rootDir, 'chunks'));

  function objectFile(objectType, objectId) {
    const typePart = safeObjectFilePart(objectType);
    const idPart = safeObjectFilePart(objectId);
    return path.join(objectsDir, `${typePart}__${idPart}.json`);
  }

  function legacyObjectFile(objectType, objectId) {
    return path.join(objectsDir, `${String(objectType || '').trim()}__${String(objectId || '').trim()}.json`);
  }

  function chunkFile(fileId, chunkIndex) {
    const fileDir = ensureDir(path.join(chunksDir, String(fileId || '').trim()));
    return path.join(fileDir, `${Number(chunkIndex)}.bin`);
  }

  function createUploadTempFile(taskId) {
    const file = path.join(tempDir, `${String(taskId || '').trim()}.upload.bin`);
    ensureDir(path.dirname(file));
    fs.writeFileSync(file, Buffer.alloc(0));
    return file;
  }

  function appendTempChunk(tempFile, buffer) {
    fs.appendFileSync(tempFile, Buffer.from(buffer || ''));
    return fs.statSync(tempFile).size;
  }

  function finalizeTempFile(tempFile) {
    return {
      file: tempFile,
      size: fs.statSync(tempFile).size,
    };
  }

  function readFileBuffer(file) {
    return fs.readFileSync(file);
  }

  function writeObject(objectType, objectId, payload) {
    const file = objectFile(objectType, objectId);
    atomicWriteJson(file, payload);
    const legacyFile = legacyObjectFile(objectType, objectId);
    if (legacyFile !== file) {
      try {
        if (fs.existsSync(legacyFile)) fs.rmSync(legacyFile, { force: true });
      } catch (_) {}
    }
    return file;
  }

  function listObjectPayloads() {
    const entries = fs.existsSync(objectsDir) ? fs.readdirSync(objectsDir) : [];
    return entries
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(objectsDir, name), 'utf8')));
  }

  function writeChunk(fileId, chunkIndex, buffer) {
    const file = chunkFile(fileId, chunkIndex);
    fs.writeFileSync(file, Buffer.from(buffer || ''));
    return file;
  }

  function readChunk(fileId, chunkIndex) {
    return fs.readFileSync(chunkFile(fileId, chunkIndex));
  }

  function removeChunkSet(fileId) {
    const fileDir = path.join(chunksDir, String(fileId || '').trim());
    try {
      fs.rmSync(fileDir, { recursive: true, force: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  function ensureRestoreDir(baseDir, relativeDir = '') {
    const target = path.resolve(baseDir, relativeDir);
    ensureDir(target);
    return target;
  }

  function writeRestoredFile(targetFile, buffer) {
    ensureDir(path.dirname(targetFile));
    fs.writeFileSync(targetFile, Buffer.from(buffer || ''));
    return targetFile;
  }

  function ensureLocalDirectory(rootLocalDir, relativeDir = '/') {
    const normalized = String(relativeDir || '/').replace(/\\/g, '/');
    const target = path.resolve(String(rootLocalDir || '').trim() || rootDir, `.${normalized}`);
    ensureDir(target);
    return target;
  }

  function copyFile(sourceFile, targetFile) {
    ensureDir(path.dirname(targetFile));
    fs.copyFileSync(sourceFile, targetFile);
    return targetFile;
  }

  function pathExists(targetPath) {
    try {
      return fs.existsSync(targetPath);
    } catch (_) {
      return false;
    }
  }

  function removePath(targetPath) {
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return true;
    } catch (_) {
      return false;
    }
  }

  function cleanupTemp(tempFile) {
    try {
      fs.rmSync(tempFile, { force: true });
    } catch (_) {}
  }

  return {
    rootDir,
    tempDir,
    objectsDir,
    chunksDir,
    createUploadTempFile,
    appendTempChunk,
    finalizeTempFile,
    readFileBuffer,
    writeObject,
    listObjectPayloads,
    writeChunk,
    readChunk,
    removeChunkSet,
    ensureRestoreDir,
    writeRestoredFile,
    ensureLocalDirectory,
    copyFile,
    pathExists,
    removePath,
    cleanupTemp,
  };
}

module.exports = {
  createDriveLocalFsService,
};
