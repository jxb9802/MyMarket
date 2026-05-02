const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function readSource(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

test('manual wallet operations remain allowed to use WOC recovery paths', () => {
  const walletSource = readSource('wallet.js');
  const serverSource = readSource('server_market.js');

  assert.match(walletSource, /const MANUAL_WOC_WALLET_SOURCES = new Set\(\[[\s\S]*'wallet_sync_api'/);
  assert.match(walletSource, /const MANUAL_WOC_WALLET_SOURCES = new Set\(\[[\s\S]*'wallet_sync_button'/);
  assert.match(walletSource, /const MANUAL_WOC_WALLET_SOURCES = new Set\(\[[\s\S]*'wallet_switch_manual'/);
  assert.match(walletSource, /const MANUAL_WOC_WALLET_SOURCES = new Set\(\[[\s\S]*'wallet_recover_bootstrap'/);
  assert.match(walletSource, /const MANUAL_WOC_WALLET_SOURCES = new Set\(\[[\s\S]*'wallet_refresh_bootstrap'/);

  assert.match(serverSource, /refreshSource === 'wallet_sync_api'/);
  assert.match(serverSource, /refreshSource === 'wallet_sync_button'/);
  assert.match(serverSource, /refreshSource === 'wallet_switch_manual'/);
  assert.match(serverSource, /bootstrapMode \|\| 'woc_once'/);
});

test('import and recover endpoints use WOC bootstrap recovery, not lightweight import', () => {
  const serverSource = readSource('server_market.js');

  assert.match(serverSource, /mode === 'import'[\s\S]*?wallet\.recoverWallet\(mnemonic, password\)/);
  assert.match(serverSource, /app\.post\('\/api\/wallet\/recover'[\s\S]*?wallet\.recoverWallet\(mnemonic, password\)/);
});
