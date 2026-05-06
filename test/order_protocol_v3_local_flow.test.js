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

test('v3 local order can be generated and buyer cancel is disabled', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-order-v3-local-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
    BSV_MARKET_DISABLE_SPV_LISTENER: process.env.BSV_MARKET_DISABLE_SPV_LISTENER,
  };
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';

  const wallet = loadFresh('../wallet');
  const protocol = loadFresh('../order_protocol_v3');
  const {
    ORDER_STATUS,
    applyTransition,
    deriveEscrowNumbers,
  } = loadFresh('../order_state_machine');
  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;

  t.after(() => {
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const password = 'order-v3-local-password';
  const { mnemonic, firstAddress } = await wallet.createWallet(password);
  const addressScriptHex = bsv.Script.buildPublicKeyHashOut(firstAddress).toHex();
  const fundingTxid = '1'.repeat(64);
  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {
      [`${fundingTxid}:0`]: {
        txId: fundingTxid,
        vout: 0,
        address: firstAddress,
        script: addressScriptHex,
        satoshis: 150000,
        confirmed: true,
        ancestorDepth: 0,
      },
    },
    ownedOutpoints: {
      [`${fundingTxid}:0`]: 150000,
    },
    spentOutpoints: {},
    txs: {
      [fundingTxid]: {
        txid: fundingTxid,
        receivedSat: 150000,
        spentSat: 0,
        netSat: 50000,
        confirmed: true,
        applied: true,
      },
    },
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const buyerContext = wallet.getOrderPlaceContext(mnemonic);
  const sellerMnemonic = wallet.generateMnemonic();
  const sellerChatPubKey = wallet.deriveChatPublicKeyFromMnemonic(sellerMnemonic);
  const timeoutAt = Math.floor(Date.now() / 1000) + 3600;
  const buyerLockRedeemScriptHex = bsv.Script.buildPublicKeyHashOut(buyerContext.buyerRefundAddress).toHex();
  const jointRedeemScriptHex = wallet.buildOrderJointRedeemScript({
    buyerChatPubKey: buyerContext.buyerChatPubKey,
    sellerChatPubKey,
  }).toHex();
  const priceSats = 10000;
  const escrow = deriveEscrowNumbers(priceSats, 2000, 1000);
  const placePayload = {
    v: 3,
    pt: '',
    sm: 'm-test',
    pid: 'p-test',
    pv: 1,
    q: 1,
    ps: priceSats,
    bd: escrow.buyerDepositSats,
    sd: escrow.sellerDepositSats,
    bp: buyerContext.buyerChatPubKey,
    sp: sellerChatPubKey,
    br: buyerContext.buyerRefundAddress,
    bv: 0,
    bs: escrow.buyerLockTotalSats,
    bh: protocol.scriptHashHex(buyerLockRedeemScriptHex),
    jh: protocol.scriptHashHex(jointRedeemScriptHex),
    to: timeoutAt,
  };
  assert.equal(protocol.validatePlacePayload(placePayload, {
    expectedBuyerScriptHash: placePayload.bh,
    expectedJointScriptHash: placePayload.jh,
  }), true);

  const placeTx = wallet.buildOrderPlaceLockTx({
    mnemonic,
    orderId: '',
    priceSats,
    sellerChatPubKey,
    timeoutAt,
    anchorText: JSON.stringify({ t: 'order_place', p: placePayload }),
    note: 'order_place:p-test',
  });
  assert.equal(placeTx.buyerLockSats, escrow.buyerLockTotalSats);
  const placeBsvTx = new bsv.Transaction(placeTx.rawtx);
  assert.equal(placeBsvTx.outputs[0].script.isPublicKeyHashOut(), true);
  assert.equal(placeBsvTx.outputs[placeTx.anchorVout].script.isDataOut(), true);
  assert.equal(placeBsvTx.outputs[placeTx.anchorVout].satoshis, wallet.ORDER_ANCHOR_OUTPUT_SAT);

  let order = applyTransition({
    id: `order:${placeTx.txid}`,
    status: ORDER_STATUS.NEW,
    snapshot: { price_snapshot: priceSats, quantity: 1 },
    funds: { priceSats },
    chain: {
      orderProtocolVersion: 3,
      placeTxid: placeTx.txid,
      buyerLockTxid: placeTx.txid,
      buyerLockVout: placeTx.buyerLockVout,
      buyerLockRedeemScriptHex: placeTx.buyerLockRedeemScriptHex,
      buyerLockSats: placeTx.buyerLockSats,
      buyerRefundAddress: placeTx.buyerRefundAddress,
      buyerChatPubKey: placeTx.buyerChatPubKey,
      sellerChatPubKey,
      jointRedeemScriptHex,
    },
    transitionIds: [],
  }, 'place', { transitionId: `place:${placeTx.txid}` });
  assert.equal(order.status, ORDER_STATUS.PLACED);

  assert.throws(() => applyTransition(order, 'cancel_by_buyer', { transitionId: `cancel:${placeTx.txid}` }), {
    code: 'UNSUPPORTED_ORDER_ACTION',
  });
});

test('seller accept tx splits a dedicated settlement fee UTXO', { concurrency: false }, async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-order-v3-accept-fee-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
    BSV_MARKET_DISABLE_SPV_LISTENER: process.env.BSV_MARKET_DISABLE_SPV_LISTENER,
  };
  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;
  process.env.BSV_MARKET_DISABLE_SPV_LISTENER = '1';

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

  const password = 'order-v3-accept-fee-password';
  const { mnemonic, firstAddress } = await wallet.createWallet(password);
  const addressScriptHex = bsv.Script.buildPublicKeyHashOut(firstAddress).toHex();
  const fundingTxid = '2'.repeat(64);
  fs.writeFileSync(path.join(dataDir, 'spv_index.json'), JSON.stringify({
    version: 1,
    utxos: {
      [`${fundingTxid}:0`]: {
        txId: fundingTxid,
        vout: 0,
        address: firstAddress,
        script: addressScriptHex,
        satoshis: 150000,
        confirmed: true,
        ancestorDepth: 0,
      },
    },
    ownedOutpoints: {
      [`${fundingTxid}:0`]: 150000,
    },
    spentOutpoints: {},
    txs: {
      [fundingTxid]: {
        txid: fundingTxid,
        receivedSat: 150000,
        spentSat: 0,
        netSat: 150000,
        confirmed: true,
        applied: true,
      },
    },
    updatedAt: new Date().toISOString(),
  }, null, 2));

  const buyerMnemonic = wallet.generateMnemonic();
  const buyerChatPubKey = wallet.deriveChatPublicKeyFromMnemonic(buyerMnemonic);
  const buyerNotifyAddress = firstAddress;
  const sellerChatPubKey = wallet.deriveChatPublicKeyFromMnemonic(mnemonic);
  const priceSats = 10000;
  const acceptTx = wallet.buildOrderSellerLockTx({
    mnemonic,
    orderId: 'order:test',
    priceSats,
    buyerChatPubKey,
    sellerChatPubKey,
    anchorText: JSON.stringify({ t: 'order_accept', p: { v: 3, pt: '1'.repeat(64) } }),
    notifyAddresses: [buyerNotifyAddress],
  });
  const tx = new bsv.Transaction(acceptTx.rawtx);
  assert.equal(acceptTx.sellerLockVout, 0);
  assert.equal(acceptTx.sellerDepositSats, wallet.computeOrderSellerDepositSats(priceSats));
  assert.equal(acceptTx.sellerLockSats, acceptTx.sellerDepositSats);
  assert.equal(tx.outputs[0].satoshis, acceptTx.sellerDepositSats);
  assert.equal(tx.outputs[0].script.isPublicKeyHashOut(), true);
  assert.equal(acceptTx.anchorVout, 1);
  assert.equal(tx.outputs[acceptTx.anchorVout].script.isDataOut(), true);
  assert.equal(tx.outputs[acceptTx.anchorVout].satoshis, wallet.ORDER_ANCHOR_OUTPUT_SAT);
  assert.equal(acceptTx.settlementFeeVout, 2);
  assert.equal(tx.outputs[2].satoshis, acceptTx.settlementFeeReserveSats);
  assert.equal(acceptTx.shipAnchorFeeVout, -1);
  assert.equal(acceptTx.shipAnchorFeeUtxo, null);
  assert.ok(acceptTx.settlementFeeReserveSats >= wallet.estimateOrderSettlementFeeReserveSat({ mode: 'completed', includeSellerSource: true }));
  assert.ok(acceptTx.shipAnchorFeeReserveSats >= wallet.estimateAnchorDataFeeReserveSat({
    payloadBytes: Buffer.byteLength(JSON.stringify({ t: 'order_accept', p: { v: 3, pt: '1'.repeat(64) } }), 'utf8'),
    notifyOutputCount: 1,
  }));
  assert.equal(String(tx.outputs[3].script.toAddress(wallet.NETWORK)), buyerNotifyAddress);

  wallet.commitWalletLocalMutation(acceptTx.rawtx, {
    source: 'test_accept_fee_split',
    kind: 'order_accept',
    confirmed: true,
    trackOutputs: true,
  });
  wallet.upsertTxContext(acceptTx.rawtx, {
    source: 'test_accept_fee_split',
    kind: 'order_accept',
    confirmed: true,
  });

  const timeoutAt = Math.floor(Date.now() / 1000) + 3600;
  const buyerLockRedeemScriptHex = bsv.Script.buildPublicKeyHashOut(firstAddress).toHex();
  const draft = await wallet.buildOrderSettlementDraft({
    mnemonic,
    mode: 'completed',
    priceSats,
    buyerSourceTxid: '3'.repeat(64),
    buyerSourceVout: 0,
    buyerSourceSats: 12000,
    buyerSourceRedeemScriptHex: buyerLockRedeemScriptHex,
    sellerSourceTxid: acceptTx.txid,
    sellerSourceVout: 0,
    sellerSourceSats: acceptTx.sellerLockSats,
    sellerSourceRedeemScriptHex: acceptTx.jointRedeemScriptHex,
    buyerChatPubKey,
    sellerChatPubKey,
    buyerRefundAddress: firstAddress,
    sellerReceiveAddress: firstAddress,
    sellerRefundAddress: firstAddress,
    spendSellerSource: true,
    anchorText: JSON.stringify({ t: 'order_confirm', p: { v: 3, pt: '1'.repeat(64) } }),
    preferredFeeOutpoints: [`${acceptTx.txid}:${acceptTx.settlementFeeVout}`],
  });
  assert.ok(draft.feeInputOutpoints.includes(`${acceptTx.txid}:${acceptTx.settlementFeeVout}`));
  assert.equal(draft.buyerRefundSats, 2000);
  assert.equal(draft.sellerRefundSats, acceptTx.sellerDepositSats);
  const sellerSigned = wallet.signOrderSettlementDraft({
    mnemonic,
    draftRawtx: draft.rawtx,
    buyerSourceRedeemScriptHex: buyerLockRedeemScriptHex,
    sellerSourceRedeemScriptHex: acceptTx.jointRedeemScriptHex,
    buyerSourceSats: 12000,
    sellerSourceSats: acceptTx.sellerLockSats,
    spendSellerSource: true,
    signerRole: 'seller',
  });
  const sellerSignedTx = new bsv.Transaction(sellerSigned.rawtx);
  assert.ok(String(sellerSignedTx.inputs[1]?.script || '').length > 0);
  const buyerSigned = wallet.signOrderSettlementDraft({
    mnemonic,
    draftRawtx: sellerSigned.rawtx,
    buyerSourceRedeemScriptHex: buyerLockRedeemScriptHex,
    sellerSourceRedeemScriptHex: acceptTx.jointRedeemScriptHex,
    buyerSourceSats: 12000,
    sellerSourceSats: acceptTx.sellerLockSats,
    spendSellerSource: true,
    signerRole: 'buyer',
  });
  const buyerSignedTx = new bsv.Transaction(buyerSigned.rawtx);
  assert.ok(String(buyerSignedTx.inputs[0]?.script || '').length > 0);

  const refundDraft = await wallet.buildOrderSettlementDraft({
    mnemonic,
    mode: 'refunded',
    priceSats,
    buyerSourceTxid: '4'.repeat(64),
    buyerSourceVout: 0,
    buyerSourceSats: 12000,
    buyerSourceRedeemScriptHex: buyerLockRedeemScriptHex,
    sellerSourceTxid: acceptTx.txid,
    sellerSourceVout: 0,
    sellerSourceSats: acceptTx.sellerLockSats,
    sellerSourceRedeemScriptHex: acceptTx.jointRedeemScriptHex,
    buyerChatPubKey,
    sellerChatPubKey,
    buyerRefundAddress: firstAddress,
    sellerReceiveAddress: firstAddress,
    sellerRefundAddress: firstAddress,
    spendSellerSource: true,
    anchorText: JSON.stringify({ t: 'order_refund_confirm', p: { v: 3, pt: '1'.repeat(64) } }),
    preferredFeeOutpoints: [`${acceptTx.txid}:${acceptTx.settlementFeeVout}`],
  });
  assert.equal(refundDraft.buyerRefundSats, 12000);
  assert.equal(refundDraft.sellerRefundSats, acceptTx.sellerDepositSats);
});
