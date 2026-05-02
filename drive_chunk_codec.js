'use strict';

const zlib = require('zlib');
const { promisify } = require('util');

const gzipAsync = promisify(zlib.gzip);

function compressBuffer(buffer) {
  return zlib.gzipSync(Buffer.from(buffer || ''), { level: 9 });
}

async function compressBufferAsync(buffer) {
  return gzipAsync(Buffer.from(buffer || ''), { level: 6 });
}

function decompressBuffer(buffer) {
  return zlib.gunzipSync(Buffer.from(buffer || ''));
}

function splitBuffer(buffer, options = {}) {
  const source = Buffer.from(buffer || '');
  const chunkSize = Math.max(256, Number(options.chunkSize || 256 * 1024));
  const chunks = [];
  for (let offset = 0; offset < source.length; offset += chunkSize) {
    chunks.push(source.subarray(offset, Math.min(source.length, offset + chunkSize)));
  }
  return chunks.length > 0 ? chunks : [Buffer.alloc(0)];
}

function mergeChunks(chunks) {
  return Buffer.concat((Array.isArray(chunks) ? chunks : []).map((chunk) => Buffer.from(chunk || '')));
}

module.exports = {
  compressBuffer,
  compressBufferAsync,
  decompressBuffer,
  splitBuffer,
  mergeChunks,
};
