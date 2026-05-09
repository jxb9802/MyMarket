const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBmmkt2AnchorText } = require('../chain/event_parser');

test('parses BMMKT2 anchor text without side effects', () => {
  const parsed = parseBmmkt2AnchorText('BMMKT2|order_accept|{"v":3,"pt":"x"}');
  assert.deepEqual(parsed, {
    marker: 'BMMKT2',
    eventType: 'order_accept',
    payload: { v: 3, pt: 'x' },
  });
  assert.equal(parseBmmkt2AnchorText('not-anchor'), null);
  assert.equal(parseBmmkt2AnchorText('BMMKT2|order_accept|{bad'), null);
});
