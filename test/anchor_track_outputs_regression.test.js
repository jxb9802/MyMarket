const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readSource(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('wallet anchor helpers track wallet change outputs by default', () => {
  const source = readSource('wallet.js');

  assert.match(source, /async function anchorDataOnChain\(\{[\s\S]*?trackOutputs = true,/);
  assert.match(source, /async function anchorDataBatchOnChain\(\{[\s\S]*?trackOutputs = true,/);
  assert.match(source, /commitWalletLocalMutation\(rawtx, \{[\s\S]*?source: 'wallet_anchor'[\s\S]*?trackOutputs: trackOutputs !== false[\s\S]*?requireApplied: true/);
  assert.match(source, /commitWalletLocalMutation\(rawtx, \{[\s\S]*?source: 'wallet_anchor_batch'[\s\S]*?trackOutputs: trackOutputs !== false[\s\S]*?requireApplied: true/);
  assert.match(source, /commitWalletLocalMutation\(rawtx, \{[\s\S]*?source: 'wallet_send'[\s\S]*?requireApplied: true/);
});

test('market anchor wrappers preserve trackOutputs unless explicitly disabled', () => {
  const serverSource = readSource('server_market.js');
  const chatSource = readSource('chat_routes.js');

  assert.doesNotMatch(serverSource, /trackOutputs:\s*options\.trackOutputs === true/);
  assert.match(serverSource, /trackOutputs:\s*options\.trackOutputs !== false/);
  assert.match(chatSource, /trackOutputs:\s*options\.trackOutputs !== false/);
});

test('wallet summary display prefers live snapshot when projection is stale', () => {
  const serverSource = readSource('server_market.js');

  assert.match(serverSource, /wallet_projection_stale_live_used/);
  assert.match(serverSource, /const fields = \['confirmed', 'unconfirmed', 'pendingDelta', 'available', 'selfChangePending', 'unconfirmedIncoming', 'total'\]/);
  assert.match(serverSource, /projection = liveProjection/);
});
