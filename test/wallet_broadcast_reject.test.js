const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const wallet = require('../wallet');

test('broadcast reject normalization exposes txid candidates from reject data', () => {
  const txid = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const normalized = wallet._test.normalizeRejectMessage({
    ccode: 16,
    message: 'tx',
    reason: 'mandatory-script-verify-flag-failed',
    data: Buffer.from(txid, 'hex'),
  });
  assert.equal(normalized.code, 16);
  assert.equal(normalized.message, 'tx');
  assert.equal(normalized.reason, 'mandatory-script-verify-flag-failed');
  assert.ok(normalized.dataTxidCandidates.includes(txid));
  assert.ok(normalized.dataTxidCandidates.includes(Buffer.from(txid, 'hex').reverse().toString('hex')));
});

test('bsv-p2p reject parser decodes command, code, reason and txid', () => {
  const Reject = require('../node_modules/bsv-p2p/src/messages/reject');
  const txid = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const reason = Buffer.from('txn-already-known', 'utf8');
  const payload = Buffer.concat([
    Buffer.from([2]),
    Buffer.from('tx', 'utf8'),
    Buffer.from([18]),
    Buffer.from([reason.length]),
    reason,
    Buffer.from(txid, 'hex').reverse(),
  ]);
  const parsed = Reject.read(payload);
  assert.equal(parsed.message, 'tx');
  assert.equal(parsed.ccode, 18);
  assert.equal(parsed.reason, 'txn-already-known');
  assert.equal(parsed.data.toString('hex'), txid);
});

test('broadcast candidate filter cools down recent transient failures', () => {
  const now = Date.now();
  assert.equal(wallet._test.isTransientBroadcastNodeFailure('connect timeout: 1.2.3.4:8333'), true);
  assert.equal(wallet._test.isPreferredBroadcastCandidate({
    endpoint: '1.2.3.4:8333',
    broadcastSuccessCount: 0,
    consecutiveFail: 1,
    lastFailAt: new Date(now - 30 * 1000).toISOString(),
    lastProbeError: 'connect timeout: 1.2.3.4:8333',
  }, now), false);
  assert.equal(wallet._test.isPreferredBroadcastCandidate({
    endpoint: '1.2.3.4:8333',
    broadcastSuccessCount: 3,
    consecutiveFail: 1,
    lastFailAt: new Date(now - 30 * 1000).toISOString(),
    lastProbeError: 'connect timeout: 1.2.3.4:8333',
  }, now), true);
});

test('broadcast pending-confirm return is blocked by requireVisibility', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'wallet.js'), 'utf8');
  const pendingReturnIndex = source.indexOf("appendSendLog('broadcast_pending_confirm_return'");
  assert.ok(pendingReturnIndex > 0);
  const precedingWindow = source.slice(Math.max(0, pendingReturnIndex - 900), pendingReturnIndex);
  assert.match(precedingWindow, /if \(!requireExternalVisibility && successes\.length >= BROADCAST_PENDING_MIN_NODES\)/);
});

test('send-all final signing keeps a post-signature fee safety margin', () => {
  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;
  const priv = new bsv.PrivateKey();
  const fromAddress = priv.toAddress('livenet').toString();
  const toAddress = new bsv.PrivateKey().toAddress('livenet').toString();
  const script = bsv.Script.buildPublicKeyHashOut(fromAddress).toHex();
  const utxos = Array.from({ length: 9 }, (_, index) => ({
    txId: String(index + 1).padStart(64, '0'),
    outputIndex: 0,
    address: fromAddress,
    script,
    satoshis: 150000,
    privKey: priv,
  }));
  const totalInputSat = utxos.reduce((sum, utxo) => sum + utxo.satoshis, 0);
  const tx = new bsv.Transaction().from(utxos).to(toAddress, totalInputSat - 1000);
  tx.change(fromAddress);
  tx.fee(1000);
  tx.sign(priv);

  const plan = wallet._test.finalizeSendAllFeeAndSign(tx, utxos, 0, wallet.DEFAULT_FEE_RATE);
  const rawtx = tx.serialize();
  const finalSizeBytes = Buffer.from(rawtx, 'hex').length;
  const finalFeeSat = totalInputSat - Number(tx.outputs[0].satoshis || 0);
  const requiredFeeSat = Math.ceil(finalSizeBytes * wallet.DEFAULT_FEE_RATE);

  assert.equal(plan.sizeBytes, finalSizeBytes);
  assert.equal(plan.feeSat, finalFeeSat);
  assert.ok(finalFeeSat >= requiredFeeSat + wallet.FINAL_SIGNED_FEE_SAFETY_SAT);
});
