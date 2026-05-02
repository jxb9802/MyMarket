#!/usr/bin/env node
'use strict';

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function defaultDbPath() {
  if (process.platform === 'win32') return 'D:\\WSL\\db\\market.db';
  return '/mnt/d/WSL/db/market.db';
}

const HOST = String(process.env.SQL_PROBE_HOST || '127.0.0.1').trim() || '127.0.0.1';
const PORT = Math.max(1, Math.min(65535, Number(process.env.SQL_PROBE_PORT || 8099)));
const DB_PATH = String(process.env.SQL_PROBE_DB || defaultDbPath()).trim();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
      const total = chunks.reduce((sum, item) => sum + item.length, 0);
      if (total > 1024 * 1024) {
        reject(new Error('request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function isReadOnlySql(sql) {
  const normalized = String(sql || '')
    .replace(/^\uFEFF/, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (normalized.includes(';')) return false;
  return /^(select|with|pragma|explain|values)\b/.test(normalized);
}

function openDb() {
  return new DatabaseSync(DB_PATH, { readonly: true });
}

function executeReadOnlyQuery(sql, params) {
  const db = openDb();
  try {
    const stmt = db.prepare(String(sql));
    const values = Array.isArray(params) ? params : [];
    const rows = stmt.all(...values);
    return {
      rowCount: Array.isArray(rows) ? rows.length : 0,
      rows: Array.isArray(rows) ? rows : [],
    };
  } finally {
    db.close();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, {
        success: true,
        host: HOST,
        port: PORT,
        dbPath: DB_PATH,
        pid: process.pid,
        platform: process.platform,
        uptimeSec: Number(process.uptime().toFixed(3)),
        memory: process.memoryUsage(),
        hostname: os.hostname(),
      });
    }

    if (req.method === 'POST' && req.url === '/query') {
      const body = await readJsonBody(req);
      const sql = String(body?.sql || '');
      const params = Array.isArray(body?.params) ? body.params : [];
      if (!isReadOnlySql(sql)) {
        return sendJson(res, 400, {
          success: false,
          error: 'Only single-statement read-only SQL is allowed.',
        });
      }
      const startedAt = Date.now();
      const result = executeReadOnlyQuery(sql, params);
      return sendJson(res, 200, {
        success: true,
        dbPath: DB_PATH,
        elapsedMs: Date.now() - startedAt,
        rowCount: result.rowCount,
        rows: result.rows,
      });
    }

    return sendJson(res, 404, {
      success: false,
      error: 'Not found',
    });
  } catch (error) {
    return sendJson(res, 500, {
      success: false,
      error: String(error?.message || error || 'sql_probe_failed'),
    });
  }
});

server.listen(PORT, HOST, () => {
  process.stdout.write(JSON.stringify({
    success: true,
    host: HOST,
    port: PORT,
    dbPath: DB_PATH,
    pid: process.pid,
  }) + '\n');
});
