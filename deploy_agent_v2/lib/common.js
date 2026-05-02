'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function nowIso() {
  return new Date().toISOString();
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(String(text || ''));
  } catch (_) {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function tailFile(file, maxBytes = 32768) {
  try {
    const stats = fs.statSync(file);
    const size = Math.max(0, Number(stats.size || 0));
    const start = Math.max(0, size - Math.max(1, Number(maxBytes || 32768)));
    const fd = fs.openSync(file, 'r');
    try {
      const buffer = Buffer.alloc(size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return '';
  }
}

function detectPlatform() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'darwin';
  return 'linux';
}

function normalizeRelPath(input) {
  const normalized = String(input || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized === '.' || normalized.includes('..')) {
    throw new Error(`invalid relative path: ${input}`);
  }
  return normalized;
}

function pickPlatformValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const platform = detectPlatform();
  if (Array.isArray(value[platform])) return value[platform];
  if (Array.isArray(value.default)) return value.default;
  return value[platform] || value.default || null;
}

function toEnvObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    out[String(key)] = String(raw == null ? '' : raw);
  }
  return out;
}

function makeId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))));
}

function redactToken(token = '') {
  const text = String(token || '');
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

function defaultAgentRoot() {
  return path.join(__dirname, '..', '.runtime');
}

function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return fallback;
  }
}

module.exports = {
  defaultAgentRoot,
  detectPlatform,
  ensureDir,
  makeId,
  normalizeRelPath,
  nowIso,
  pickPlatformValue,
  readJson,
  readText,
  redactToken,
  safeJsonParse,
  sha256,
  sleep,
  tailFile,
  toEnvObject,
  writeJson,
  os,
  path,
  fs,
};
