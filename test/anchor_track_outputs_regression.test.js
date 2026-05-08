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

test('p2p block sync applies confirmed wallet transaction summaries', () => {
  const serverSource = readSource('server_market.js');

  assert.match(serverSource, /function applyConfirmedWalletTxSummaries\(summaries = \[\]\)/);
  assert.match(serverSource, /const walletSummaryApplyCount = applyConfirmedWalletTxSummaries\(found\.walletTxSummaries \|\| \[\]\)/);
  assert.match(serverSource, /appliedWalletTxSummaries \+= Number\(walletSummaryApplyCount \|\| 0\)/);
  assert.match(serverSource, /walletApplied: appliedWalletTxSummaries/);
});

test('sync final refresh publishes business domains for already-open pages', () => {
  const serverSource = readSource('server_market.js');
  const syncPipelineSource = readSource('sync_business_pipeline.js');

  assert.match(serverSource, /sync_final_state_saved[\s\S]*return \['sync', 'catalog', 'profile', 'order', 'chat'\]/);
  assert.match(syncPipelineSource, /domains: \['sync', 'catalog', 'profile', 'order', 'chat'\]/);
});

test('frontend sync merge accepts manual resync height rollback', () => {
  const appSource = readSource('app.js');

  assert.match(appSource, /const resetLocalRollback = liveBootstrapHeight > 0/);
  assert.match(appSource, /pickNumber\(live\.localHeight, 0\) <= Math\.max\(0, liveBootstrapHeight - 1\)/);
  assert.match(appSource, /const allowResetReplace = resetEpochAdvance \|\| resetBootstrapRollback \|\| resetLocalRollback/);
  assert.match(appSource, /next\.p2pHeaderCursorHeight = allowResetReplace/);
});

test('frontend websocket bootstrap does not send empty unrequested domains', () => {
  const gatewaySource = readSource('frontend_event_gateway.js');

  assert.match(gatewaySource, /const domainSpecs = \[/);
  assert.match(gatewaySource, /\.filter\(\(\[key\]\) => Object\.prototype\.hasOwnProperty\.call\(domains, key\)\)/);
  assert.match(gatewaySource, /const envelopes = domainSpecs\s*\.filter\(\(\[key\]\) => Object\.prototype\.hasOwnProperty\.call\(domains, key\)\)\s*\.map\(\(\[key, type, domain\]\) => makeEnvelope\(type, domain, domains\[key\] \|\| \{\}/);
});

test('p2p wallet summaries preserve block height for future optimized resync', () => {
  const walletSource = readSource('wallet.js');
  const serverSource = readSource('server_market.js');

  assert.match(walletSource, /firstSeenHeight: normalizeWalletSyncHeight\(options\.firstSeenHeight \|\| options\.localHeight \|\| options\.blockHeight\)/);
  assert.match(walletSource, /summary\?\.firstSeenHeight[\s\S]*summary\?\.blockHeight/);
  assert.match(walletSource, /updateWalletSyncHints\(\{[\s\S]*earliestTxHeight: firstSeenHeight/);
  assert.match(walletSource, /ensureWalletSyncHintsBackfilled\(\{[\s\S]*_pre_clear/);
  assert.match(serverSource, /buildConfirmedBlockTxSummary\(walletTxInput, \{[\s\S]*firstSeenHeight: height/);
  assert.match(serverSource, /applyConfirmedTxSummaryToSpvIndex\(summary, \{[\s\S]*firstSeenHeight: Number\(summary\?\.firstSeenHeight/);
});

test('independent sync only commits contiguous blocks and rewinds on commit gaps', () => {
  const runtimeSource = readSource('independent_sync_runtime.js');
  const serviceSource = readSource('independent_sync_service.js');

  assert.match(runtimeSource, /const contiguousBlocks = \[\]/);
  assert.match(runtimeSource, /for \(let height = initialCommittedHeight \+ 1; ; height \+= 1\)/);
  assert.match(runtimeSource, /for \(const blockState of contiguousBlocks\)/);
  assert.match(runtimeSource, /independent_sync_commit_gap_detected/);
  assert.match(runtimeSource, /skippedSuccessCount/);
  assert.match(serviceSource, /independent_sync_window_rewind_after_commit_gap/);
  assert.match(serviceSource, /cursor = nextCursorOverride/);
});

test('sync status shows active command as running instead of idle', () => {
  const syncDomainSource = readSource('sync_domain.js');

  assert.match(syncDomainSource, /const independentPhaseRaw = String\(independentSync\.phase \|\| ''\)/);
  assert.match(syncDomainSource, /const displayIndependentPhase = \(/);
  assert.match(syncDomainSource, /hasManagedSyncActivity[\s\S]*lag > 0[\s\S]*independentPhaseRaw === 'idle'/);
  assert.match(syncDomainSource, /independentPhase: displayIndependentPhase/);
});

test('frontend disables business actions while sync is prioritized', () => {
  const appSource = readSource('app.js');

  assert.match(appSource, /function businessSyncGateStatus\(\)/);
  assert.match(appSource, /mode === "full_sync"/);
  assert.match(appSource, /mode === "catchup_sync"/);
  assert.match(appSource, /lag >= 16/);
  assert.match(appSource, /function requireBusinessAvailable\(\)/);
  assert.match(appSource, /function applyBusinessSyncDisabledState\(\)/);
  assert.match(appSource, /applyBusinessSyncDisabledState\(\);/);
  assert.match(appSource, /async function runBuyerProductPurchase\(productId\) \{\s*if \(!requireBusinessAvailable\(\)\) return;/);
  assert.match(appSource, /async function openGlobalChat\(options = \{\}\) \{\s*if \(!requireBusinessAvailable\(\)\) return;/);
  assert.match(appSource, /async function openChatThreadWindow\(options = \{\}\) \{\s*if \(!requireBusinessAvailable\(\)\) return;/);
  assert.match(appSource, /async function openDriveExplorer\(\) \{\s*if \(!requireBusinessAvailable\(\)\) return;/);
  assert.match(appSource, /async function downloadDriveFileToServer\(fileId\) \{\s*if \(!requireBusinessAvailable\(\)\) return;/);
  assert.match(appSource, /async function uploadFilesToCurrentDriveDir\(files\) \{\s*if \(!requireBusinessAvailable\(\)\) return;/);
});

test('sync artifact reset preserves bootstrap index recovery height', () => {
  const serverSource = readSource('server_market.js');

  assert.match(serverSource, /const bootstrapIndexMeta = getSyncBootstrapIndexMeta\(syncState\)/);
  assert.match(serverSource, /Number\(syncState\.businessRecoveredHeight \|\| 0\)/);
  assert.match(serverSource, /Number\(bootstrapIndexMeta\?\.recoveredHeight \|\| 0\)/);
  assert.match(serverSource, /Number\(bootstrapIndexMeta\?\.toHeight \|\| 0\)/);
  assert.match(serverSource, /const fixedSyncLastHeight = Math\.max\([\s\S]*localHeight[\s\S]*\)/);
  assert.match(serverSource, /fixedSyncLastHeight,\s*\n\s*receiptCommittedHeight: localHeight/);
});
