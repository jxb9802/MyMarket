const test = require('node:test');
const assert = require('node:assert/strict');

function loadFreshServerMarket() {
  const modulePath = require.resolve('../server_market');
  delete require.cache[modulePath];
  return require('../server_market');
}

function encodePushData(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf || '');
  if (buf.length <= 75) return Buffer.concat([Buffer.from([buf.length]), buf]);
  if (buf.length <= 0xff) return Buffer.concat([Buffer.from([0x4c, buf.length]), buf]);
  if (buf.length <= 0xffff) {
    const len = Buffer.alloc(2);
    len.writeUInt16LE(buf.length, 0);
    return Buffer.concat([Buffer.from([0x4d]), len, buf]);
  }
  throw new Error('pushdata too large for test helper');
}

function buildOpReturnScriptFromText(text) {
  const payload = Buffer.from(String(text || ''), 'utf8');
  return Buffer.concat([Buffer.from([0x6a]), encodePushData(payload)]);
}

function createFakeBlock({ txid, script, time = 1_775_000_000 }) {
  return {
    header: { time },
    getTransactionsAsync(cb) {
      cb({
        transactions: [[0, {
          getHash() {
            return Buffer.from(String(txid || '').toLowerCase(), 'hex');
          },
          outputs: [{ script }],
        }]],
      });
    },
  };
}

test('BMMKT2 writer/parser only accepts BMMKT2 payloads', () => {
  const serverMarket = loadFreshServerMarket();
  const text = serverMarket.buildAnchorWireText('profile_set', { _v: 3, name: 'Alice' });
  assert.match(text, /^BMMKT2\|profile_set\|/);

  const parsed = serverMarket.parseAnchorPayloadText(text);
  assert.equal(parsed?.marker, 'BMMKT2');
  assert.equal(parsed?.eventType, 'profile_set');
  assert.equal(parsed?.payload?.name, 'Alice');

  assert.equal(serverMarket.parseAnchorPayloadText('BMMKT1|profile_set|{"name":"Old"}'), null);
  assert.equal(
    serverMarket.parseAnchorPayloadText('{"protocol":"MARKETPLACE_RESPONSE","type":"marketplace"}'),
    null,
  );
});

test('spool replay parser ignores legacy rows and only emits BMMKT2 rows', () => {
  const serverMarket = loadFreshServerMarket();
  const txid = 'a'.repeat(64);

  const bmmkt2Rows = serverMarket.parseAnchorRowsFromSpoolRecord({
    txid,
    ts: '2026-03-31T12:00:00.000Z',
    node: 'spool',
    height: 1,
    text: 'BMMKT2|category_add|{"_v":3,"id":"c-1","name":"Cat"}',
  });
  assert.equal(bmmkt2Rows.length, 1);
  assert.equal(bmmkt2Rows[0].eventType, 'category_add');
  assert.equal(bmmkt2Rows[0].payload.id, 'c-1');

  const legacyRows = serverMarket.parseAnchorRowsFromSpoolRecord({
    txid,
    ts: '2026-03-31T12:00:00.000Z',
    node: 'spool',
    height: 1,
    text: 'BMMKT1|category_add|{"_v":3,"id":"c-old","name":"Old"}',
  });
  assert.deepEqual(legacyRows, []);
});

test('p2p block extraction only emits BMMKT2 anchors', async () => {
  const serverMarket = loadFreshServerMarket();

  const bmmkt2Script = buildOpReturnScriptFromText(
    'BMMKT2|chat_message|{"_v":3,"msgId":"m-1","fromWalletId":"w1","toWalletId":"w2"}',
  );
  const bmmkt2Block = createFakeBlock({
    txid: 'b'.repeat(64),
    script: bmmkt2Script,
  });
  const ok = await serverMarket.extractAnchorRowsFromP2PBlock(
    bmmkt2Block,
    '2026-03-31T12:00:00.000Z',
    100,
    '127.0.0.1:8333',
  );
  assert.equal(ok.rows.length, 1);
  assert.equal(ok.rows[0].eventType, 'chat_message');
  assert.equal(ok.rows[0].payload.msgId, 'm-1');

  const legacyScript = buildOpReturnScriptFromText(
    'BMMKT1|chat_message|{"_v":3,"msgId":"legacy","fromWalletId":"w1","toWalletId":"w2"}',
  );
  const legacyBlock = createFakeBlock({
    txid: 'c'.repeat(64),
    script: legacyScript,
  });
  const legacy = await serverMarket.extractAnchorRowsFromP2PBlock(
    legacyBlock,
    '2026-03-31T12:00:00.000Z',
    101,
    '127.0.0.1:8333',
  );
  assert.deepEqual(legacy.rows, []);
});

