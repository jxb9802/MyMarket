const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDriveIndexStore } = require('../drive_index_store');

test('drive store recursively marks child dirs and files deleted when deleting a directory', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-delete-recursive-'));
  try {
    const store = createDriveIndexStore({ dataDir: tmpRoot });
    const ownerWalletId = 'wallet-test';
    const root = store.ensureRootDir(ownerWalletId);
    store.saveDir({
      ownerWalletId,
      dirId: 'dir-a',
      parentDirId: root.dirId,
      name: 'A',
      path: '/A',
      localRelativePath: '/A',
      encryptedName: '{}',
      deleted: false,
    });
    store.saveDir({
      ownerWalletId,
      dirId: 'dir-b',
      parentDirId: 'dir-a',
      name: 'B',
      path: '/A/B',
      localRelativePath: '/A/B',
      encryptedName: '{}',
      deleted: false,
    });
    store.saveFile({
      ownerWalletId,
      fileId: 'file-1',
      parentDirId: 'dir-a',
      name: 'one.txt',
      path: '/A/one.txt',
      localRelativePath: '/A/one.txt',
      encryptedName: '{}',
      size: 1,
      originalSize: 1,
      chunkCount: 1,
      contentRef: 'chunks:file-1',
      contentHash: 'hash-1',
      downloaded: true,
      deleted: false,
    });
    store.saveFile({
      ownerWalletId,
      fileId: 'file-2',
      parentDirId: 'dir-b',
      name: 'two.txt',
      path: '/A/B/two.txt',
      localRelativePath: '/A/B/two.txt',
      encryptedName: '{}',
      size: 1,
      originalSize: 1,
      chunkCount: 1,
      contentRef: 'chunks:file-2',
      contentHash: 'hash-2',
      downloaded: true,
      deleted: false,
    });

    store.markDirDeleted(ownerWalletId, 'dir-a', true);

    assert.equal(store.loadDir(ownerWalletId, 'dir-a').deleted, true);
    assert.equal(store.loadDir(ownerWalletId, 'dir-b').deleted, true);
    assert.equal(store.loadFile(ownerWalletId, 'file-1').deleted, true);
    assert.equal(store.loadFile(ownerWalletId, 'file-2').deleted, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('drive store applies delete marker to target file and directory indexes', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drive-delete-marker-'));
  try {
    const store = createDriveIndexStore({ dataDir: tmpRoot });
    const ownerWalletId = 'wallet-test';
    const root = store.ensureRootDir(ownerWalletId);
    store.saveDir({
      ownerWalletId,
      dirId: 'dir-a',
      parentDirId: root.dirId,
      name: 'A',
      path: '/A',
      localRelativePath: '/A',
      encryptedName: '{}',
      deleted: false,
    });
    store.saveFile({
      ownerWalletId,
      fileId: 'file-1',
      parentDirId: 'dir-a',
      name: 'one.txt',
      path: '/A/one.txt',
      localRelativePath: '/A/one.txt',
      encryptedName: '{}',
      size: 1,
      originalSize: 1,
      chunkCount: 1,
      contentRef: 'chunks:file-1',
      contentHash: 'hash-1',
      downloaded: true,
      deleted: false,
    });

    store.saveDeleteMarker({
      ownerWalletId,
      objectId: 'delete:file-1',
      targetType: 'file',
      targetId: 'file-1',
      deletedAt: '2026-04-19T00:00:00.000Z',
    });

    assert.equal(store.loadFile(ownerWalletId, 'file-1').deleted, true);

    store.saveDeleteMarker({
      ownerWalletId,
      objectId: 'delete:dir-a',
      targetType: 'dir',
      targetId: 'dir-a',
      deletedAt: '2026-04-19T00:01:00.000Z',
    });

    assert.equal(store.loadDir(ownerWalletId, 'dir-a').deleted, true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});
