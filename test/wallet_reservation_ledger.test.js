const test = require('node:test');
const assert = require('node:assert/strict');

const { createReservationLedger } = require('../wallet/reservation_ledger');

test('reservation ledger keeps uncertain tx inputs reserved until hard failure', () => {
  const ledger = createReservationLedger();
  const outpoint = `${'1'.repeat(64)}:0`;
  ledger.reserve('r1', [outpoint], { txid: 'a'.repeat(64) });
  ledger.markUncertain('r1');

  assert.throws(() => ledger.reserve('r2', [outpoint]), {
    code: 'OUTPOINT_ALREADY_RESERVED',
  });

  assert.equal(ledger.release('r1'), true);
  assert.doesNotThrow(() => ledger.reserve('r2', [outpoint]));
});

test('confirmed reservation becomes spent and cannot be released', () => {
  const ledger = createReservationLedger();
  const outpoint = `${'2'.repeat(64)}:1`;
  ledger.reserve('r1', [outpoint], { txid: 'a'.repeat(64) });
  ledger.markPending('r1');
  assert.equal(ledger.confirm('r1', 'b'.repeat(64)), true);
  assert.equal(ledger.release('r1'), false);

  assert.throws(() => ledger.reserve('r2', [outpoint]), {
    code: 'OUTPOINT_ALREADY_SPENT',
  });
});
