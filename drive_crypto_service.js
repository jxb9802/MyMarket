'use strict';

const crypto = require('crypto');

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromBase64url(text) {
  return Buffer.from(String(text || ''), 'base64url');
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function hmac256(key, value) {
  return crypto.createHmac('sha256', key).update(String(value || ''), 'utf8').digest();
}

function createDriveCryptoService(deps = {}) {
  const wallet = deps.wallet;
  const getPassword = typeof deps.getPassword === 'function' ? deps.getPassword : () => '';

  function getDriveMasterKey(options = {}) {
    const password = String(options.password || getPassword() || '').trim();
    if (!password) throw new Error('wallet password is required');
    if (!wallet || typeof wallet.getMnemonicFromPassword !== 'function') {
      throw new Error('wallet mnemonic access is unavailable');
    }
    const mnemonic = String(wallet.getMnemonicFromPassword(password) || '').trim();
    if (!mnemonic) throw new Error('wallet mnemonic is unavailable');
    return crypto.createHash('sha256').update(`drive-master:${mnemonic}`, 'utf8').digest();
  }

  function deriveDirKey(dirId, options = {}) {
    return hmac256(getDriveMasterKey(options), `dir:${String(dirId || '').trim()}`);
  }

  function deriveFileKey(fileId, options = {}) {
    return hmac256(getDriveMasterKey(options), `file:${String(fileId || '').trim()}`);
  }

  function encryptTextWithKey(key, text, aad = '') {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    if (aad) cipher.setAAD(Buffer.from(String(aad), 'utf8'));
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(String(text || ''), 'utf8')),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return {
      alg: 'aes-256-gcm',
      iv: base64url(iv),
      authTag: base64url(authTag),
      ciphertext: base64url(ciphertext),
    };
  }

  function decryptTextWithKey(key, payload, aad = '') {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, fromBase64url(payload?.iv));
    if (aad) decipher.setAAD(Buffer.from(String(aad), 'utf8'));
    decipher.setAuthTag(fromBase64url(payload?.authTag));
    const text = Buffer.concat([
      decipher.update(fromBase64url(payload?.ciphertext)),
      decipher.final(),
    ]);
    return text.toString('utf8');
  }

  function encryptDirName(name, meta = {}, options = {}) {
    return encryptTextWithKey(deriveDirKey(meta.dirId, options), name, `dir-name:${meta.dirId}`);
  }

  function decryptDirName(payload, meta = {}, options = {}) {
    return decryptTextWithKey(deriveDirKey(meta.dirId, options), payload, `dir-name:${meta.dirId}`);
  }

  function encryptFileName(name, meta = {}, options = {}) {
    return encryptTextWithKey(deriveFileKey(meta.fileId, options), name, `file-name:${meta.fileId}`);
  }

  function decryptFileName(payload, meta = {}, options = {}) {
    return decryptTextWithKey(deriveFileKey(meta.fileId, options), payload, `file-name:${meta.fileId}`);
  }

  function encryptChunk(buffer, fileId, chunkIndex, options = {}) {
    const key = options.fileKey ? Buffer.from(options.fileKey) : deriveFileKey(fileId, options);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`chunk:${fileId}:${Number(chunkIndex)}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(buffer || '')), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return {
      payload: Buffer.concat([iv, authTag, ciphertext]),
      payloadHash: sha256Hex(ciphertext),
    };
  }

  function decryptChunk(payload, fileId, chunkIndex, options = {}) {
    const buffer = Buffer.from(payload || '');
    const iv = buffer.subarray(0, 12);
    const authTag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveFileKey(fileId, options), iv);
    decipher.setAAD(Buffer.from(`chunk:${fileId}:${Number(chunkIndex)}`, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  return {
    getDriveMasterKey,
    deriveDirKey,
    deriveFileKey,
    encryptDirName,
    decryptDirName,
    encryptFileName,
    decryptFileName,
    encryptChunk,
    decryptChunk,
    sha256Hex,
  };
}

module.exports = {
  createDriveCryptoService,
};
