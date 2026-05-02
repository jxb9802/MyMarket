const test = require('node:test');
const assert = require('node:assert/strict');

const protocol = require('../order_protocol_v3');
const wallet = require('../wallet');

test('canonicalize is stable regardless of object key insertion order', () => {
  const a = { b: 2, a: 1, c: { z: 'last', d: [3, 2, 1] } };
  const b = { c: { d: [3, 2, 1], z: 'last' }, a: 1, b: 2 };
  assert.equal(protocol.canonicalize(a), protocol.canonicalize(b));
  assert.equal(protocol.eventHash(a), protocol.eventHash(b));
});

test('v3 order_place validation rejects bad deposits and hash mismatches', () => {
  const payload = {
    v: 3,
    ps: 10000,
    bd: 2000,
    sd: 1000,
    bs: 12000,
    bh: protocol.sha256Hex(Buffer.from('aa', 'hex')),
    jh: protocol.sha256Hex(Buffer.from('bb', 'hex')),
  };
  assert.equal(protocol.validatePlacePayload(payload, {
    expectedBuyerScriptHash: payload.bh,
    expectedJointScriptHash: payload.jh,
  }), true);
  assert.throws(() => protocol.validatePlacePayload({ ...payload, sd: 500 }), /seller deposit/);
  assert.throws(() => protocol.validatePlacePayload(payload, {
    expectedBuyerScriptHash: '00',
    expectedJointScriptHash: payload.jh,
  }), /Buyer lock script hash mismatch/);
});

test('actor signature binds payload and rejects tampering', () => {
  const bsvRaw = require('bsv');
  const bsv = bsvRaw && bsvRaw.default ? bsvRaw.default : bsvRaw;
  const mnemonic = wallet.generateMnemonic();
  const keypair = wallet.deriveChatKeypairFromMnemonic(mnemonic);
  const signed = protocol.attachActorSignature({
    v: 3,
    pt: 'a'.repeat(64),
    cx: 'b'.repeat(64),
  }, {
    role: 'buyer',
    pubKey: keypair.chatPubKey,
    privateKey: keypair.privateKey,
    bsv,
  });
  assert.equal(protocol.verifyPayload(signed, bsv), true);
  assert.equal(protocol.verifyPayload({ ...signed, cx: 'c'.repeat(64) }, bsv), false);
});
