const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

function setupTempWalletEnv(t) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-parent-backfill-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
    BSV_MARKET_DB_DIR: process.env.BSV_MARKET_DB_DIR,
  };
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;
  process.env.BSV_MARKET_DB_DIR = dataDir;
  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
  return { dataDir };
}

function makeSignedChain() {
  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;
  const priv = new bsv.PrivateKey();
  const address = priv.toAddress('livenet').toString();
  const scriptHex = bsv.Script.buildPublicKeyHashOut(address).toHex();
  const grand = new bsv.Transaction()
    .from({
      txId: 'a'.repeat(64),
      outputIndex: 0,
      script: scriptHex,
      satoshis: 25000,
    })
    .to(address, 15000)
    .change(address)
    .sign(priv);
  const parent = new bsv.Transaction()
    .from({
      txId: grand.id,
      outputIndex: 0,
      script: scriptHex,
      satoshis: 15000,
    })
    .to(address, 12000)
    .change(address)
    .sign(priv);
  return { grand, parent };
}

test('direct parent tx_context backfill inserts only missing first-layer parents', async (t) => {
  const { dataDir } = setupTempWalletEnv(t);
  const wallet = loadFresh('../wallet');
  const { parent } = makeSignedChain();

  const calls = [];
  const result = await wallet._test.ensureDirectParentTxContexts([parent.id], {
    fetchRawTx: async (txid) => {
      calls.push(txid);
      return txid === parent.id ? parent.toString() : '';
    },
  });

  assert.equal(result.requested, 1);
  assert.equal(result.inserted, 1);
  assert.deepEqual(calls, [parent.id]);

  const db = new DatabaseSync(path.join(dataDir, 'market.db'), { readOnly: true });
  const row = db.prepare('SELECT txid, source, kind, confirmed FROM tx_contexts WHERE txid = ?').get(parent.id);
  assert.equal(row.txid, parent.id);
  assert.equal(row.source, 'woc');
  assert.equal(row.kind, 'direct_parent_backfill');
  assert.equal(Number(row.confirmed || 0), 0);
});

test('direct parent tx_context backfill does not recurse into grandparent ancestry', async (t) => {
  const { dataDir } = setupTempWalletEnv(t);
  const wallet = loadFresh('../wallet');
  const { grand, parent } = makeSignedChain();

  const calls = [];
  const result = await wallet._test.ensureDirectParentTxContexts([parent.id], {
    fetchRawTx: async (txid) => {
      calls.push(txid);
      if (txid === parent.id) return parent.toString();
      if (txid === grand.id) return grand.toString();
      return '';
    },
  });

  assert.equal(result.requested, 1);
  assert.equal(result.inserted, 1);
  assert.deepEqual(calls, [parent.id]);

  const db = new DatabaseSync(path.join(dataDir, 'market.db'), { readOnly: true });
  const parentRow = db.prepare('SELECT txid FROM tx_contexts WHERE txid = ?').get(parent.id);
  const grandRow = db.prepare('SELECT txid FROM tx_contexts WHERE txid = ?').get(grand.id);
  assert.equal(parentRow.txid, parent.id);
  assert.equal(grandRow, undefined);
});
