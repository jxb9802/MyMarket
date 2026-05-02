const test = require('node:test');
const assert = require('node:assert/strict');

const { createDriveChainService } = require('../drive_chain_service');

test('drive single anchors track wallet change outputs by default', async () => {
  let receivedOptions = null;
  const service = createDriveChainService({
    anchorEvent: async (_eventType, _payload, options) => {
      receivedOptions = options;
      return { txid: 'a'.repeat(64) };
    },
  });

  await service.anchorFileObject({
    ownerWalletId: 'wallet-test',
    fileId: 'file-test',
    path: '/file.txt',
    name: 'file.txt',
    size: 1,
    mimeType: 'text/plain',
    sha256: 'b'.repeat(64),
    chunkCount: 1,
    chunkSize: 1,
  }, { password: 'secret' });

  assert.equal(receivedOptions.trackOutputs, true);
});

test('drive batch anchors track wallet change outputs by default', async () => {
  let receivedOptions = null;
  const service = createDriveChainService({
    anchorBatchEvent: async (_events, options) => {
      receivedOptions = options;
      return { txid: 'c'.repeat(64) };
    },
  });

  await service.anchorChunkAndFileObjectsBatch([], {
    ownerWalletId: 'wallet-test',
    fileId: 'file-test',
    path: '/file.txt',
    name: 'file.txt',
    size: 1,
    mimeType: 'text/plain',
    sha256: 'b'.repeat(64),
    chunkCount: 1,
    chunkSize: 1,
  }, { password: 'secret' });

  assert.equal(receivedOptions.trackOutputs, true);
});

test('drive anchors can explicitly disable wallet output tracking', async () => {
  const seen = [];
  const service = createDriveChainService({
    anchorEvent: async (_eventType, _payload, options) => {
      seen.push(options.trackOutputs);
      return { txid: 'd'.repeat(64) };
    },
    anchorBatchEvent: async (_events, options) => {
      seen.push(options.trackOutputs);
      return { txid: 'e'.repeat(64) };
    },
  });

  await service.anchorDeleteObject({
    ownerWalletId: 'wallet-test',
    objectId: 'file-test',
    targetType: 'file',
    path: '/file.txt',
  }, { password: 'secret', trackOutputs: false });
  await service.anchorChunkAndFileObjectsBatch([], {
    ownerWalletId: 'wallet-test',
    fileId: 'file-test',
    path: '/file.txt',
    name: 'file.txt',
    size: 1,
    mimeType: 'text/plain',
    sha256: 'b'.repeat(64),
    chunkCount: 1,
    chunkSize: 1,
  }, { password: 'secret', trackOutputs: false });

  assert.deepEqual(seen, [false, false]);
});
