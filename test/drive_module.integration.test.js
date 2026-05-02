const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const SCRIPT = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PASSWORD = 'drive-test-password';

function getFreePort() {
  const net = require('node:net');
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => resolve(addr.port));
    });
    server.on('error', reject);
  });
}

function parseSetCookie(headers) {
  const setCookie = headers.get('set-cookie') || '';
  return String(setCookie || '').split(';')[0];
}

async function requestJson(baseUrl, pathname, { method = 'GET', body = null, cookie = '' } = {}) {
  const requestHeaders = { connection: 'close' };
  if (body !== null) requestHeaders['content-type'] = 'application/json';
  if (cookie) requestHeaders.cookie = cookie;
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: requestHeaders,
    body: body !== null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (_) {
    json = null;
  }
  return { status: res.status, json, headers: res.headers, raw: text };
}

async function main() {
  const repoRoot = process.cwd();
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-drive-test-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;
  process.env.BSV_MARKET_DISABLE_BHS = '1';
  process.env.BSV_MARKET_DISABLE_STEWARD_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_CHAT_SERVICE = '1';
  process.env.BSV_MARKET_DISABLE_CATALOG_WORKER = '1';
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';
  process.env.BSV_MARKET_DISABLE_STARTUP_CHAIN_SYNC = '1';
  process.env.BSV_MARKET_DRIVE_CHAIN_MODE = 'cache';
  const driveChainMode = String(process.env.BSV_MARKET_DRIVE_CHAIN_MODE || 'anchor');

  const serverMarket = require(path.join(repoRoot, 'server_market'));
  const port = await getFreePort();
  const server = await serverMarket.startServer({ port, host: '127.0.0.1' });
  const baseUrl = 'http://127.0.0.1:' + port;

  try {
    const createRes = await requestJson(baseUrl, '/api/wallet/create', {
      method: 'POST',
      body: { password: PASSWORD },
    });
    assert.equal(createRes.status, 200);
    const cookie = parseSetCookie(createRes.headers);
    assert.match(cookie, /connect\\.sid=/);

    const sampleText = 'drive integration sample\\nline two\\nline three\\n';
    const sampleFile = path.join(tmpRoot, 'sample.txt');
    fs.writeFileSync(sampleFile, sampleText, 'utf8');
    const sampleBuffer = fs.readFileSync(sampleFile);
    const rootLocalDir = path.join(tmpRoot, 'drive-root');

    const rootDirRes = await requestJson(baseUrl, '/api/drive/root-dir', {
      method: 'POST',
      cookie,
      body: { rootLocalDir },
    });
    assert.equal(rootDirRes.status, 200);
    assert.equal(rootDirRes.json && rootDirRes.json.success, true);

    const startRes = await requestJson(baseUrl, '/api/drive/upload/start', {
      method: 'POST',
      cookie,
      body: {
        path: '/docs/specs',
        fileName: 'sample.txt',
        totalBytes: sampleBuffer.length,
      },
    });
    assert.equal(startRes.status, 200);
    assert.equal(startRes.json && startRes.json.success, true);
    const taskId = String(startRes.json && startRes.json.task && startRes.json.task.taskId || '');
    assert.ok(taskId);

    const chunkSize = 8;
    for (let offset = 0; offset < sampleBuffer.length; offset += chunkSize) {
      const chunk = sampleBuffer.subarray(offset, Math.min(sampleBuffer.length, offset + chunkSize));
      const chunkRes = await requestJson(baseUrl, '/api/drive/upload/' + encodeURIComponent(taskId) + '/chunk', {
        method: 'POST',
        cookie,
        body: { chunkBase64: chunk.toString('base64') },
      });
      assert.equal(chunkRes.status, 200);
      assert.equal(chunkRes.json && chunkRes.json.success, true);
    }

    const finishRes = await requestJson(baseUrl, '/api/drive/upload/' + encodeURIComponent(taskId) + '/finish', {
      method: 'POST',
      cookie,
      body: {},
    });
    assert.equal(finishRes.status, 200);
    assert.equal(finishRes.json && finishRes.json.success, true);
    const fileId = String(finishRes.json && finishRes.json.fileId || '');
    assert.ok(fileId);

    const encryptedChunkPath = path.join(dataDir, 'drive', 'chunks', fileId, '0.bin');
    assert.equal(fs.existsSync(encryptedChunkPath), driveChainMode === 'cache');
    if (fs.existsSync(encryptedChunkPath)) {
      assert.equal(fs.readFileSync(encryptedChunkPath).includes(Buffer.from(sampleText, 'utf8')), false);
    }

    const treeRes = await requestJson(baseUrl, '/api/drive/tree?path=%2Fdocs%2Fspecs', { cookie });
    assert.equal(treeRes.status, 200);
    assert.equal(treeRes.json && treeRes.json.success, true);
    assert.equal(Array.isArray(treeRes.json && treeRes.json.files), true);
    assert.equal(treeRes.json.files.length, 1);
    assert.equal(String(treeRes.json.files[0] && treeRes.json.files[0].name || ''), 'sample.txt');
    assert.equal(Boolean(treeRes.json.files[0] && treeRes.json.files[0].downloaded), true);

    const mirroredPath = path.join(rootLocalDir, 'docs', 'specs', 'sample.txt');
    assert.equal(fs.existsSync(mirroredPath), true);
    assert.equal(fs.readFileSync(mirroredPath, 'utf8'), sampleText);
    fs.rmSync(mirroredPath, { force: true });
    assert.equal(fs.existsSync(mirroredPath), false);

    const targetDir = path.join(tmpRoot, 'restored');
    const downloadRes = await requestJson(baseUrl, '/api/drive/download/server', {
      method: 'POST',
      cookie,
      body: {
        fileId,
        targetDir,
      },
    });
    assert.equal(downloadRes.status, 200);
    assert.equal(downloadRes.json && downloadRes.json.success, true);
    const restoredPath = String(downloadRes.json && downloadRes.json.restoredFiles && downloadRes.json.restoredFiles[0] && downloadRes.json.restoredFiles[0].outputPath || '');
    assert.ok(restoredPath);
    assert.equal(fs.readFileSync(restoredPath, 'utf8'), sampleText);
    assert.equal(fs.existsSync(encryptedChunkPath), driveChainMode === 'cache');

    const browserRes = await fetch(baseUrl + '/api/drive/download/browser?fileId=' + encodeURIComponent(fileId), {
      headers: { cookie, connection: 'close' },
    });
    assert.equal(browserRes.status, 200);
    const browserBuffer = Buffer.from(await browserRes.arrayBuffer());
    assert.equal(browserBuffer.toString('utf8'), sampleText);
    assert.equal(fs.existsSync(mirroredPath), true);
    assert.equal(fs.readFileSync(mirroredPath, 'utf8'), sampleText);
    assert.equal(fs.existsSync(encryptedChunkPath), driveChainMode === 'cache');

    const resyncRes = await requestJson(baseUrl, '/api/drive/resync', {
      method: 'POST',
      cookie,
      body: {},
    });
    assert.equal(resyncRes.status, 200);
    assert.equal(resyncRes.json && resyncRes.json.success, true);
    assert.ok(Number(resyncRes.json && resyncRes.json.fileCount || 0) >= 1);

    process.stdout.write(JSON.stringify({
      ok: true,
      fileId,
      restoredPath,
    }) + '\\n');
  } finally {
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    try { server.close(); } catch (_) {}
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}).then(() => {
  process.exit(0);
});
`;

test('drive module supports upload, local mirror, delete-local restore, tree listing, and server/browser download', () => {
  const result = spawnSync(process.execPath, ['-e', SCRIPT], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `exit=${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /"ok":true/);
});
