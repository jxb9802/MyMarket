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

test('wallet accounting treats non-order anchor txs by owned inputs and owned outputs', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-unified-'));
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

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;
  const priv = new bsv.PrivateKey();
  const address = priv.toAddress('livenet').toString();
  const now = new Date().toISOString();
  const parentTxid = '1'.repeat(64);
  const parentOutpoint = `${parentTxid}:0`;
  const scriptHex = bsv.Script.buildPublicKeyHashOut(address).toHex();

  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: now,
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {
      [parentOutpoint]: {
        txId: parentTxid,
        vout: 0,
        address,
        satoshis: 1000000,
        confirmed: true,
        ancestorDepth: 0,
        seenAt: now,
        updatedAt: now,
      },
    },
    ownedOutpoints: { [parentOutpoint]: 1000000 },
    spentOutpoints: {},
    txs: {
      [parentTxid]: {
        txid: parentTxid,
        receivedSat: 1000000,
        spentSat: 0,
        netSat: 1000000,
        confirmed: true,
        ancestorDepth: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        applied: true,
      },
    },
    updatedAt: now,
  }, null, 2));

  const tx = new bsv.Transaction()
    .from({
      txId: parentTxid,
      outputIndex: 0,
      script: scriptHex,
      satoshis: 1000000,
    })
    .addData('BMMKT2|chat_message|{"orderId":"order:test"}')
    .to(address, 995000)
    .sign(priv);

  const wallet = loadFresh('../wallet');
  assert.equal(wallet._test.applyTxToSpvIndex(tx.toString(), { confirmed: true }), true);

  const nextIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  const changeOutpoint = `${tx.id}:1`;
  assert.equal(nextIndex.utxos[parentOutpoint], undefined);
  assert.equal(nextIndex.spentOutpoints[parentOutpoint]?.spentBy, tx.id);
  assert.equal(nextIndex.utxos[changeOutpoint]?.satoshis, 995000);
  assert.equal(nextIndex.txs[tx.id]?.receivedSat, 995000);
  assert.equal(nextIndex.txs[tx.id]?.spentSat, 1000000);
  assert.equal(nextIndex.txs[tx.id]?.netSat, -5000);

  const summary = wallet._test.buildWalletDisplayUtxoSummary();
  assert.equal(summary.confirmed, 995000);
  assert.equal(summary.total, 995000);
});

test('wallet accounting is idempotent across duplicate mempool events and confirmation', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-idempotent-'));
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

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;
  const priv = new bsv.PrivateKey();
  const address = priv.toAddress('livenet').toString();
  const now = new Date().toISOString();
  const parentTxid = '2'.repeat(64);
  const parentOutpoint = `${parentTxid}:0`;
  const scriptHex = bsv.Script.buildPublicKeyHashOut(address).toHex();

  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: now,
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {
      [parentOutpoint]: {
        txId: parentTxid,
        vout: 0,
        address,
        satoshis: 1000000,
        confirmed: true,
        ancestorDepth: 0,
        seenAt: now,
        updatedAt: now,
      },
    },
    ownedOutpoints: { [parentOutpoint]: 1000000 },
    spentOutpoints: {},
    txs: {
      [parentTxid]: {
        txid: parentTxid,
        receivedSat: 1000000,
        spentSat: 0,
        netSat: 1000000,
        confirmed: true,
        ancestorDepth: 0,
        firstSeenAt: now,
        lastSeenAt: now,
        applied: true,
      },
    },
    updatedAt: now,
  }, null, 2));

  const tx = new bsv.Transaction()
    .from({
      txId: parentTxid,
      outputIndex: 0,
      script: scriptHex,
      satoshis: 1000000,
    })
    .addData('BMMKT2|chat_message|{"orderId":"order:idempotent"}')
    .to(address, 995000)
    .sign(priv);

  const wallet = loadFresh('../wallet');
  assert.equal(wallet._test.applyTxToSpvIndex(tx.toString(), { confirmed: false }), true);
  assert.equal(wallet._test.applyTxToSpvIndex(tx.toString(), { confirmed: false }), false);
  assert.equal(wallet._test.applyTxToSpvIndex(tx.toString(), { confirmed: true }), true);
  assert.equal(wallet._test.applyTxToSpvIndex(tx.toString(), { confirmed: true }), true);

  const nextIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(Object.values(nextIndex.utxos).filter((utxo) => utxo.txId === tx.id).length, 1);
  assert.equal(nextIndex.utxos[`${tx.id}:1`]?.satoshis, 995000);
  assert.equal(nextIndex.utxos[`${tx.id}:1`]?.confirmed, true);
  assert.equal(nextIndex.spentOutpoints[parentOutpoint]?.spentBy, tx.id);
  assert.equal(nextIndex.txs[tx.id]?.receivedSat, 995000);
  assert.equal(nextIndex.txs[tx.id]?.spentSat, 1000000);
  assert.equal(nextIndex.txs[tx.id]?.netSat, -5000);
  assert.equal(nextIndex.txs[tx.id]?.confirmed, true);

  const summary = wallet._test.buildWalletDisplayUtxoSummary();
  assert.equal(summary.confirmed, 995000);
  assert.equal(summary.total, 995000);
});

test('confirmed rawtx creates wallet output even when tx was not previously indexed', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-confirm-create-'));
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

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;
  const walletPriv = new bsv.PrivateKey();
  const walletAddress = walletPriv.toAddress('livenet').toString();
  const externalPriv = new bsv.PrivateKey();
  const externalAddress = externalPriv.toAddress('livenet').toString();
  const now = new Date().toISOString();
  const parentTxid = '3'.repeat(64);
  const externalScriptHex = bsv.Script.buildPublicKeyHashOut(externalAddress).toHex();

  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address: walletAddress, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: now,
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {},
    ownedOutpoints: {},
    spentOutpoints: {},
    txs: {},
    updatedAt: now,
  }, null, 2));

  const tx = new bsv.Transaction()
    .from({
      txId: parentTxid,
      outputIndex: 0,
      script: externalScriptHex,
      satoshis: 100000,
    })
    .to(walletAddress, 4400)
    .to(externalAddress, 90000)
    .sign(externalPriv);

  const wallet = loadFresh('../wallet');
  assert.equal(wallet.isTxSeenInSpvIndex(tx.id), false);
  assert.equal(wallet.applyConfirmedWalletRawtx(tx.toString(), { source: 'test_confirm_create' }), true);

  const nextIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(nextIndex.utxos[`${tx.id}:0`]?.satoshis, 4400);
  assert.equal(nextIndex.utxos[`${tx.id}:0`]?.confirmed, true);
  assert.equal(nextIndex.txs[tx.id]?.receivedSat, 4400);
  assert.equal(nextIndex.txs[tx.id]?.spentSat, 0);
  assert.equal(nextIndex.txs[tx.id]?.netSat, 4400);
  assert.equal(nextIndex.txs[tx.id]?.confirmed, true);

  const summary = wallet._test.buildWalletDisplayUtxoSummary();
  assert.equal(summary.confirmed, 4400);
  assert.equal(summary.total, 4400);
});

test('confirmed rawtx records spent amount from parent context when owned input is already removed', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-confirm-parent-spend-'));
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

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;
  const walletPriv = new bsv.PrivateKey();
  const walletAddress = walletPriv.toAddress('livenet').toString();
  const sellerPriv = new bsv.PrivateKey();
  const sellerAddress = sellerPriv.toAddress('livenet').toString();
  const fundingPriv = new bsv.PrivateKey();
  const fundingAddress = fundingPriv.toAddress('livenet').toString();
  const now = new Date().toISOString();

  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address: walletAddress, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: now,
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {},
    ownedOutpoints: {},
    spentOutpoints: {},
    txs: {},
    updatedAt: now,
  }, null, 2));

  const parentTxid = '4'.repeat(64);
  const fundingScriptHex = bsv.Script.buildPublicKeyHashOut(fundingAddress).toHex();
  const parent = new bsv.Transaction()
    .from({
      txId: parentTxid,
      outputIndex: 0,
      script: fundingScriptHex,
      satoshis: 40000,
    })
    .to(walletAddress, 36000)
    .to(fundingAddress, 3000)
    .sign(fundingPriv);
  const settlement = new bsv.Transaction()
    .from({
      txId: parent.id,
      outputIndex: 0,
      script: bsv.Script.buildPublicKeyHashOut(walletAddress).toHex(),
      satoshis: 36000,
    })
    .to(sellerAddress, 30000)
    .to(walletAddress, 6000)
    .sign(walletPriv);

  const wallet = loadFresh('../wallet');
  wallet.upsertTxContext(parent.toString(), {
    source: 'test_parent_context',
    confirmed: true,
  });
  assert.equal(wallet.applyConfirmedWalletRawtx(settlement.toString(), {
    source: 'test_confirm_parent_spend',
  }), true);

  const nextIndex = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(nextIndex.utxos[`${settlement.id}:1`]?.satoshis, 6000);
  assert.equal(nextIndex.txs[settlement.id]?.receivedSat, 6000);
  assert.equal(nextIndex.txs[settlement.id]?.spentSat, 36000);
  assert.equal(nextIndex.txs[settlement.id]?.netSat, -30000);
});
