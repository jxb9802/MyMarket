const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

test('confirmWalletTransaction removes stale spent confirmed UTXO using local tx context only', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-confirmed-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
  };
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;

  const wallet = loadFresh('../wallet');
  const marketDb = loadFresh('../market_db');
  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();

  const priv = new bsv.PrivateKey();
  const address = priv.toAddress('livenet').toString();
  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const scriptHex = bsv.Script.buildPublicKeyHashOut(address).toHex();
  const fundingUtxo = {
    txId: 'a'.repeat(64),
    outputIndex: 0,
    script: scriptHex,
    satoshis: 20000,
  };
  const tx1 = new bsv.Transaction().from(fundingUtxo).to(address, 12000).change(address).sign(priv);
  const tx2 = new bsv.Transaction().from({
    txId: tx1.id,
    outputIndex: 0,
    script: scriptHex,
    satoshis: 12000,
  }).to(address, 11000).change(address).sign(priv);

  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {
      [`${tx1.id}:0`]: {
        txId: tx1.id,
        vout: 0,
        address,
        satoshis: 12000,
        confirmed: true,
        ancestorDepth: 0,
        seenAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      [`${tx2.id}:0`]: {
        txId: tx2.id,
        vout: 0,
        address,
        satoshis: 11000,
        confirmed: true,
        ancestorDepth: 0,
        seenAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    },
    ownedOutpoints: {
      [`${tx1.id}:0`]: 12000,
      [`${tx2.id}:0`]: 11000,
    },
    spentOutpoints: {},
    txs: {
      [tx1.id]: {
        txid: tx1.id,
        receivedSat: 19798,
        spentSat: 0,
        netSat: 19798,
        confirmed: true,
        ancestorDepth: 0,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        applied: true,
      },
      [tx2.id]: {
        txid: tx2.id,
        receivedSat: 11766,
        spentSat: 0,
        netSat: 11766,
        confirmed: true,
        ancestorDepth: 0,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        applied: true,
      },
    },
    updatedAt: new Date().toISOString(),
  }, null, 2));

  await marketDb.upsertTxContext({
    txid: tx2.id,
    rawtxHex: tx2.toString(),
    inputTxids: [tx1.id],
    source: 'test',
    kind: 'confirmed',
    confirmed: true,
  });

  assert.equal(wallet.confirmWalletTransaction(tx2.id, { source: 'test', allowCreateFromRawtx: true }), true);

  const nextIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(Boolean(nextIndex.utxos[`${tx1.id}:0`]), false);
  assert.equal(nextIndex.spentOutpoints[`${tx1.id}:0`]?.spentBy, tx2.id);
  assert.equal(nextIndex.txs[tx2.id]?.spentSat, 12000);
  assert.ok(Number(nextIndex.txs[tx2.id]?.netSat) < 0);
});

test('confirmed parent output is not added when known child already spent it', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-known-spender-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
  };
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;

  const wallet = loadFresh('../wallet');
  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const priv = new bsv.PrivateKey();
  const address = priv.toAddress('livenet').toString();
  const externalAddress = new bsv.PrivateKey().toAddress('livenet').toString();
  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: new Date().toISOString(),
  }, null, 2));

  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {},
    ownedOutpoints: {},
    spentOutpoints: {},
    txs: {},
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const scriptHex = bsv.Script.buildPublicKeyHashOut(address).toHex();
  const fundingUtxo = {
    txId: 'b'.repeat(64),
    outputIndex: 0,
    script: scriptHex,
    satoshis: 20000,
  };
  const parentTx = new bsv.Transaction().from(fundingUtxo).to(address, 12000).change(address).sign(priv);
  const childTx = new bsv.Transaction().from({
    txId: parentTx.id,
    outputIndex: 0,
    script: scriptHex,
    satoshis: 12000,
  }).to(externalAddress, 11000).sign(priv);

  wallet.upsertTxContext(childTx.toString(), {
    source: 'test',
    kind: 'confirmed_child_first',
    confirmed: true,
  });
  wallet.upsertTxContext(parentTx.toString(), {
    source: 'test',
    kind: 'confirmed_parent_later',
    confirmed: true,
  });

  assert.equal(wallet.confirmWalletTransaction(parentTx.id, {
    source: 'test',
    allowCreateFromRawtx: true,
  }), true);

  const nextIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(nextIndex.utxos[`${parentTx.id}:0`], undefined);
  assert.equal(nextIndex.spentOutpoints[`${parentTx.id}:0`]?.spentBy, childTx.id);
});
