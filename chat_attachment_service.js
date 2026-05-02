'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHAT_ATTACHMENT_PREFIX = '__chat_attachment_payload_v1__:';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ATTACHMENTS = 4;

function normalizeString(value) {
  return String(value || '').trim();
}

function sanitizeFileName(value = '') {
  const raw = normalizeString(value).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  return (raw || 'attachment').slice(0, 160);
}

function normalizeMimeType(value = '') {
  const raw = normalizeString(value).toLowerCase();
  if (!raw || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(raw)) return 'application/octet-stream';
  return raw.slice(0, 120);
}

function isImageMime(mimeType = '') {
  return /^image\/(png|jpe?g|gif|webp|bmp)$/i.test(normalizeMimeType(mimeType));
}

function decodeBase64(value = '') {
  const raw = String(value || '');
  const m = raw.match(/^data:([^;,]+)?;base64,(.*)$/i);
  const base64 = m ? m[2] : raw;
  return Buffer.from(base64, 'base64');
}

function encodeChatAttachmentPayload(text = '', attachments = []) {
  const cleanAttachments = (Array.isArray(attachments) ? attachments : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ ...item }));
  if (!cleanAttachments.length) return String(text || '');
  return `${CHAT_ATTACHMENT_PREFIX}${JSON.stringify({
    text: String(text || ''),
    attachments: cleanAttachments,
  })}`;
}

function decodeChatAttachmentPayload(raw = '') {
  const text = String(raw || '');
  if (!text.startsWith(CHAT_ATTACHMENT_PREFIX)) {
    return { text, attachments: [], isPayload: false };
  }
  try {
    const parsed = JSON.parse(text.slice(CHAT_ATTACHMENT_PREFIX.length));
    return {
      text: String(parsed?.text || ''),
      attachments: Array.isArray(parsed?.attachments) ? parsed.attachments : [],
      isPayload: true,
    };
  } catch (_) {
    return { text, attachments: [], isPayload: false };
  }
}

function chatAttachmentPreview(raw = '') {
  const parsed = decodeChatAttachmentPayload(raw);
  if (!parsed.isPayload) return String(raw || '');
  const names = parsed.attachments
    .map((item) => sanitizeFileName(item?.fileName || ''))
    .filter(Boolean);
  const marks = parsed.attachments.map((item) => (item?.isImage || isImageMime(item?.mimeType) ? '[image]' : '[attachment]'));
  return [parsed.text, names.length ? `${marks.join(' ')} ${names.join(', ')}` : marks.join(' ')]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}

function createChatAttachmentService(options = {}) {
  const dataDir = path.resolve(options.dataDir || process.env.BSV_MARKET_DATA_DIR || path.join(__dirname, 'data'));
  const baseDir = path.join(dataDir, 'chat_attachments');
  const ttlMs = Math.max(60 * 1000, Number(options.ttlMs || process.env.BSV_MARKET_CHAT_ATTACHMENT_TTL_MS || DEFAULT_TTL_MS));
  const maxBytes = Math.max(1, Number(options.maxBytes || process.env.BSV_MARKET_CHAT_ATTACHMENT_MAX_BYTES || DEFAULT_MAX_BYTES));
  const maxAttachments = Math.max(1, Number(options.maxAttachments || process.env.BSV_MARKET_CHAT_ATTACHMENT_MAX_COUNT || DEFAULT_MAX_ATTACHMENTS));
  let cleanupTimer = null;

  function ensureDir() {
    if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  }

  function metadataPath(id) {
    return path.join(baseDir, `${id}.json`);
  }

  function filePath(id) {
    return path.join(baseDir, `${id}.bin`);
  }

  function readMetadata(id) {
    const safeId = normalizeString(id).replace(/[^a-f0-9-]/gi, '');
    if (!safeId) return null;
    const file = metadataPath(safeId);
    if (!fs.existsSync(file)) return null;
    try {
      const meta = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!meta || typeof meta !== 'object') return null;
      if (Date.parse(String(meta.expiresAt || '')) <= Date.now()) return null;
      return meta;
    } catch (_) {
      return null;
    }
  }

  function publicMetadata(meta) {
    const id = normalizeString(meta?.attachmentId);
    return {
      attachmentId: id,
      fileName: sanitizeFileName(meta?.fileName || ''),
      mimeType: normalizeMimeType(meta?.mimeType || ''),
      size: Math.max(0, Number(meta?.size || 0)),
      isImage: Boolean(meta?.isImage),
      url: `/api/chat/attachment/${encodeURIComponent(id)}`,
      downloadUrl: `/api/chat/attachment/${encodeURIComponent(id)}?download=1`,
      expiresAt: normalizeString(meta?.expiresAt),
    };
  }

  function storeBuffer({ fileName, mimeType, buffer, source = 'upload', expiresAt = '' } = {}) {
    ensureDir();
    const body = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
    if (!body.length) throw new Error('attachment file is empty');
    if (body.length > maxBytes) throw new Error(`attachment exceeds ${maxBytes} bytes`);
    const id = crypto.randomUUID();
    const safeMime = normalizeMimeType(mimeType);
    const meta = {
      attachmentId: id,
      fileName: sanitizeFileName(fileName),
      mimeType: safeMime,
      size: body.length,
      isImage: isImageMime(safeMime),
      source: normalizeString(source) || 'upload',
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : new Date(Date.now() + ttlMs).toISOString(),
    };
    fs.writeFileSync(filePath(id), body);
    fs.writeFileSync(metadataPath(id), JSON.stringify(meta, null, 2));
    return publicMetadata(meta);
  }

  function storeUploadedAttachment(body = {}) {
    return storeBuffer({
      fileName: body.fileName,
      mimeType: body.mimeType,
      buffer: decodeBase64(body.dataBase64),
      source: 'upload',
    });
  }

  function readAttachmentForSend(id) {
    const meta = readMetadata(id);
    if (!meta) throw new Error('attachment not found or expired');
    const body = fs.readFileSync(filePath(meta.attachmentId));
    return {
      ...publicMetadata(meta),
      dataBase64: body.toString('base64'),
    };
  }

  function prepareOutgoingAttachments(ids = []) {
    const safeIds = (Array.isArray(ids) ? ids : [])
      .map((id) => normalizeString(id))
      .filter(Boolean)
      .slice(0, maxAttachments);
    return safeIds.map(readAttachmentForSend);
  }

  function stripTransferData(attachments = []) {
    return (Array.isArray(attachments) ? attachments : [])
      .filter((item) => item && typeof item === 'object')
      .map((item) => publicMetadata(item));
  }

  function storeReceivedAttachments(attachments = []) {
    const list = Array.isArray(attachments) ? attachments.slice(0, maxAttachments) : [];
    return list.map((item) => storeBuffer({
      fileName: item?.fileName,
      mimeType: item?.mimeType,
      buffer: decodeBase64(item?.dataBase64),
      source: 'p2p',
      expiresAt: item?.expiresAt,
    }));
  }

  function sendAttachment(req, res) {
    const id = normalizeString(req?.params?.attachmentId || '').replace(/[^a-f0-9-]/gi, '');
    const meta = readMetadata(id);
    if (!meta) return res.status(404).json({ success: false, error: 'attachment not found or expired' });
    const file = filePath(id);
    if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'attachment missing' });
    const name = sanitizeFileName(meta.fileName);
    res.setHeader('content-type', normalizeMimeType(meta.mimeType));
    res.setHeader('cache-control', 'private, max-age=60');
    const disposition = req?.query?.download ? 'attachment' : 'inline';
    res.setHeader('content-disposition', `${disposition}; filename="${encodeURIComponent(name)}"`);
    return fs.createReadStream(file).pipe(res);
  }

  function cleanupExpiredAttachments() {
    ensureDir();
    const now = Date.now();
    let removed = 0;
    for (const name of fs.readdirSync(baseDir)) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      let expired = false;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(baseDir, name), 'utf8'));
        expired = Date.parse(String(meta?.expiresAt || '')) <= now;
      } catch (_) {
        expired = true;
      }
      if (!expired) continue;
      for (const target of [metadataPath(id), filePath(id)]) {
        try {
          if (fs.existsSync(target)) fs.unlinkSync(target);
        } catch (_) {}
      }
      removed += 1;
    }
    return { removed };
  }

  function startCleanupTimer() {
    if (cleanupTimer) return cleanupTimer;
    cleanupExpiredAttachments();
    cleanupTimer = setInterval(() => {
      try { cleanupExpiredAttachments(); } catch (_) {}
    }, Math.max(60 * 1000, Math.min(ttlMs, 60 * 60 * 1000)));
    cleanupTimer.unref?.();
    return cleanupTimer;
  }

  return {
    baseDir,
    maxBytes,
    maxAttachments,
    ensureDir,
    storeUploadedAttachment,
    prepareOutgoingAttachments,
    stripTransferData,
    storeReceivedAttachments,
    sendAttachment,
    cleanupExpiredAttachments,
    startCleanupTimer,
    encodeChatAttachmentPayload,
    decodeChatAttachmentPayload,
    chatAttachmentPreview,
  };
}

module.exports = {
  CHAT_ATTACHMENT_PREFIX,
  createChatAttachmentService,
  encodeChatAttachmentPayload,
  decodeChatAttachmentPayload,
  chatAttachmentPreview,
};
