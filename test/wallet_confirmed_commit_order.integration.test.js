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

test('confirmed wallet tx summaries applied in commit order do not leave stale UTXOs', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-summary-'));
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
  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const scriptHex = bsv.Script.buildPublicKeyHashOut(address).toHex();
  const fundingUtxo = {
    txId: 'f'.repeat(64),
    outputIndex: 0,
    script: scriptHex,
    satoshis: 20000,
  };
  const txCreate = new bsv.Transaction().from(fundingUtxo).to(address, 12000).change(address).sign(priv);
  const txSpend = new bsv.Transaction().from({
    txId: txCreate.id,
    outputIndex: 0,
    script: scriptHex,
    satoshis: 12000,
  }).to('1FwMkhMEbydwMKnvXcf75MTMFTmu2f2ok', 10000).change(address).sign(priv);

  const spendSummary = wallet.buildConfirmedBlockTxSummary(txSpend, { txIndex: 0 });
  const createSummary = wallet.buildConfirmedBlockTxSummary(txCreate, { txIndex: 0 });

  assert.equal(wallet.applyConfirmedTxSummaryToSpvIndex(createSummary, { confirmed: true, source: 'test' }), true);
  let index = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(Boolean(index.utxos[`${txCreate.id}:0`]), true);
  assert.equal(wallet.applyConfirmedTxSummaryToSpvIndex(spendSummary, { confirmed: true, source: 'test' }), true);
  index = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(Boolean(index.utxos[`${txCreate.id}:0`]), false);
  assert.equal(index.spentOutpoints[`${txCreate.id}:0`]?.spentBy, txSpend.id);
});

test('confirmed summary repairs wallet output missing from previously applied tx', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-summary-repair-'));
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
  const external = '1FwMkhMEbydwMKnvXcf75MTMFTmu2f2ok';
  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address, index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const scriptHex = bsv.Script.buildPublicKeyHashOut(address).toHex();
  const tx = new bsv.Transaction()
    .from({
      txId: 'a'.repeat(64),
      outputIndex: 0,
      script: scriptHex,
      satoshis: 20000,
    })
    .to(external, 10000)
    .change(address)
    .sign(priv);
  const summary = wallet.buildConfirmedBlockTxSummary(tx, { txIndex: 0 });
  const walletOutput = summary.walletOutputs.find((output) => output.address === address);
  assert.ok(walletOutput, 'test transaction must create wallet change');

  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {},
    ownedOutpoints: {},
    spentOutpoints: {
      [`${'a'.repeat(64)}:0`]: {
        spentBy: tx.id,
        spentAt: new Date().toISOString(),
      },
    },
    txs: {
      [tx.id]: {
        txid: tx.id,
        receivedSat: 0,
        spentSat: 20000,
        netSat: -20000,
        confirmed: false,
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
        applied: true,
      },
    },
    updatedAt: new Date().toISOString(),
  }, null, 2));

  assert.equal(wallet.applyConfirmedTxSummaryToSpvIndex(summary, { confirmed: true, source: 'test' }), true);
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  const outpoint = `${tx.id}:${walletOutput.vout}`;
  assert.equal(index.utxos[outpoint]?.satoshis, walletOutput.satoshis);
  assert.equal(index.ownedOutpoints[outpoint], walletOutput.satoshis);
  assert.equal(index.txs[tx.id].receivedSat, walletOutput.satoshis);
  assert.equal(index.txs[tx.id].netSat, walletOutput.satoshis - 20000);
});

test('pending rawtx replay preserves existing confirmed base without reset', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-pending-replay-'));
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

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const txid = 'b'.repeat(64);
  fs.writeFileSync(path.join(dataDir, 'wallet_state.json'), JSON.stringify({
    pathBase: "m/44'/0'/0'/0",
    addresses: [{ address: '14GsPhLX89V3xak62RpcietMNL2zoDv53v', index: 0, path: "m/44'/0'/0'/0/0" }],
    lastReceiveIndex: 0,
    addressCursor: 0,
    updatedAt: new Date().toISOString(),
  }, null, 2));
  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {
      [`${txid}:1`]: {
        txId: txid,
        vout: 1,
        address: '14GsPhLX89V3xak62RpcietMNL2zoDv53v',
        satoshis: 976974,
        confirmed: true,
        ancestorDepth: 0,
      },
    },
    ownedOutpoints: {
      [`${txid}:1`]: 976974,
    },
    spentOutpoints: {},
    txs: {
      [txid]: {
        txid,
        receivedSat: 976974,
        spentSat: 0,
        netSat: 976974,
        confirmed: true,
        applied: true,
      },
    },
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const result = wallet.rebuildLocalIndexFromQueueRawtxs([], { source: 'wallet_refresh_pending_replay' });
  assert.equal(result.reconciledConfirmedApplied, 0);
  const index = JSON.parse(fs.readFileSync(path.join(dataDir, 'spv_index.json'), 'utf8'));
  assert.equal(index.utxos[`${txid}:1`]?.satoshis, 976974);
  assert.equal(index.txs[txid]?.netSat, 976974);
});

test('confirmed tx-context rebuild is blocked unless explicitly unsafe', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-wallet-unsafe-rebuild-'));
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

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  assert.throws(
    () => wallet.rebuildWalletIndexFromLocalData({ source: 'rebuild_wallet_index_from_local_data' }),
    /Local tx-context confirmed replay is disabled/,
  );
});
