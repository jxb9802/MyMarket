# Wallet Balance Audit

Date: 2026-04-22

## Goal

Wallet balance correctness must be preserved by every local operation after wallet sync. Normal runtime paths must not use WOC to repair state. WOC is allowed only for explicit manual wallet refresh/sync, wallet switch, import, and recover/bootstrap operations.

Runtime paths must also not use automatic restore/replay helpers to patch over design gaps. If runtime behavior falls outside the intended state model, the fix must be applied at the point where the bad state is created or classified. If that point is not yet clear, add logging at that boundary first; do not add a new runtime restore path.

The local wallet truth should be:

1. `data/spv_index.json` UTXO set and tx rows.
2. `data/cache.json` and `data/wallet_state.json` derived from the SPV index.
3. Wallet read projection derived from the same live wallet snapshot, never treated as a newer balance truth than the local index.

## Balance-Affecting Entry Map

| Entry | Main code | Balance operation | WOC allowed |
| --- | --- | --- | --- |
| Normal BSV send | `wallet.sendBsv`, `/api/wallet/send` | Select local spendable UTXOs, broadcast, apply rawtx to SPV index, update wallet state/cache | No |
| Market/event anchor | `wallet.anchorDataOnChain`, `tryAnchorEvent` | Spend local UTXO, create OP_RETURN/change, apply rawtx to SPV index | No |
| Batch anchor | `wallet.anchorDataBatchOnChain`, `tryAnchorEventBatch` | Same as anchor, multiple payload outputs | No |
| Chat profile/friend anchors | `chat_routes.js`, `tryAnchorEvent` | Same as event anchor | No |
| Drive mkdir/rename/upload/delete anchors | `drive_browser_routes.js`, `tryAnchorEvent` | Same as event anchor | No |
| Order/change queue anchor | `server_market.js` queue workers | Same as event anchor, plus reservations | No |
| SPV/mempool tx observation | `applyTxToSpvIndex` | Apply relevant raw tx to index | No |
| Confirmed block summary | `applyConfirmedTxSummaryToSpvIndex` | Apply confirmed wallet inputs/outputs from parsed block summary | No |
| Confirm recent rawtx | `confirmWalletTransaction`, `reconcileRecentRawtxConfirmationState` | Mark local rawtx confirmed and update index/projection | No |
| Manual refresh/sync | `refreshBalancesAndHistory` from `/api/wallet/sync` | May bootstrap/reconcile confirmed UTXO set with WOC by explicit source | Yes |
| Wallet switch/import/recover | `recoverWallet`, import routes | Rebuild wallet state and bootstrap index | Yes |
| Read projection/display | `wallet_read_domain`, `buildWalletUiBundle`, state-lite | Display cached/projection/live wallet data | No |
| Wallet tx reservations | `wallet_tx_domain`, reserved outpoint projection | Exclude already queued local spends from a second spend | No |

## Findings

### Critical: confirmed summary cannot repair missing wallet outputs

Code: `wallet.js:3530-3664`

`applyConfirmedTxSummaryToSpvIndex` has an idempotent early return when a tx already has stable accounting and no currently-owned pending inputs. It only refreshes confirmation flags. Unlike `applyTxToSpvIndex`, it does not detect wallet outputs present in the confirmed summary but missing from `index.utxos`.

Why this matters:

- A previously applied tx can have `spentSat` recorded but its wallet change output missing, for example from an older `trackOutputs:false` anchor bug or a future caller that disables output tracking.
- Later block sync sees the tx summary with `walletOutputs`, but the early return skips adding the missing change output.
- The wallet then reports zero or too-low balance even though the transaction is known locally.

Required fix:

- Add `missingWalletOutputs` repair before the early return, matching the repair already in `applyTxToSpvIndex`.
- Add a regression test where an existing tx row has spent amount, summary includes a wallet output, and the output is inserted without recomputing unrelated rows.

### Critical: local tx-context rebuild can overstate balance

Code: `wallet.js:4217-4278`, `wallet.js:4306-4318`, `wallet.js:6590-6601`

`rebuildLocalIndexFromQueueRawtxs` resets the SPV index and replays confirmed tx contexts as a confirmed base. `rebuildWalletIndexFromLocalData` does the same. If `tx_contexts` is incomplete or lacks the full spend chain, old confirmed outputs can be re-added even though they were already spent.

This is the concrete failure class observed on Linux: local rebuild inflated the wallet to about 3.18 BSV by replaying historical change outputs from incomplete local rawtx context, while the actual currently spendable UTXO set was 976,974 sat.

Required fix:

- Stop using tx-context replay as an automatic confirmed balance rebuild.
- Rename or restrict full local rebuild to an explicit diagnostic command with strong warnings.
- In manual WOC bootstrap, after WOC establishes confirmed truth, do not reset confirmed base while replaying pending rawtxs. Only apply allowed pending rawtxs on top of the current trusted SPV index.
- `syncLocalIndexFromRecentRawtxs` should become "store/replay recent pending on top of current index", not "reset and rebuild".

### High: send and anchor paths ignore local-index apply failure

Code: `wallet.js:7173-7184`, `wallet.js:7391`, `wallet.js:7577`

After broadcast succeeds, these paths call `applyTxToSpvIndex` but do not require it to return `true`.

Why this matters:

- A successful broadcast is a wallet mutation. If local apply fails, the next balance shown can be stale or wrong.
- Current logs still say `send_local_index_applied` even if `applyTxToSpvIndex` returned false.

Required fix:

- Introduce a single post-broadcast commit helper that applies the raw tx, requires success, updates `wallet_state.json`, writes `cache.json`, and returns the new balance snapshot.
- If local apply fails after broadcast, keep the rawtx recoverable, mark wallet index untrusted/send-disabled, and surface a clear local-index error instead of silently continuing.

### High: anchor paths do not update wallet state/cache immediately

Code: `wallet.js:7391`, `wallet.js:7577`

Normal send updates wallet state and `cache.json` after applying the transaction. Single and batch anchors only save through `saveSpvIndex`; they do not call `updateAddressBalancesFromSpv` / `saveWalletState` / write cache in the same path.

Required fix:

- Use the same post-broadcast commit helper for send, single anchor, and batch anchor.
- The helper must update SPV index, wallet state, cache, and emit or schedule projection refresh exactly once.

### High: display can prefer stale projection over live local index

Code: `server_market.js:15662-15675`, `server_market.js:15824-15825`, `wallet_read_domain.js:446-486`

`buildWalletSummarySnapshot` calls `buildWalletUiBundle` with `skipLive:true`. That makes state-lite and summary views prefer wallet read projection. If projection lags behind a corrected local SPV index, the UI can continue showing stale balance.

Required fix:

- Balance summaries should compare projection with `wallet.getWalletReadSnapshot`.
- If live local snapshot and projection differ, use live local snapshot for displayed balance and schedule projection refresh.
- Projection can be a fast cache, but it must not override a newer local wallet snapshot for total/available balance.

### Medium: negative tx observation cache can suppress later relevance

Code: `wallet.js:3684-3710`

`applyTxToSpvIndex` remembers irrelevant tx observations and returns early on later observations. If a tx is first seen before the wallet knows a relevant owned outpoint, it can remain skipped until process restart.

Required fix:

- Bind negative observation entries to a wallet index generation or watched-address/outpoint version.
- At minimum, do not let a negative unconfirmed observation suppress a later confirmed parse.

### Medium: projection refresh is indirect after confirmation/apply

Code: `confirmWalletTransaction`, `reconcileRecentRawtxConfirmationState`, `bridgeWalletFactsToDomain`

Confirmation paths update wallet index/cache, then rely on server-side bridge/throttled projection refresh. A throttled or failed refresh leaves read projection stale even though wallet truth is correct.

Required fix:

- Wallet index mutations should return a mutation summary or publish a wallet-index-updated event.
- Callers must bridge the exact updated snapshot to `wallet_read_domain` without relying only on periodic refresh.

### Medium: reservation projection affects spend safety, not true balance

Code: `wallet_tx_domain.js`, `server_market.js` reservation helpers

Reserved outpoints are correctly used to avoid selecting already queued spends. They must never be subtracted from persisted wallet truth. They should only affect send availability and UX.

Required fix:

- Keep reservations outside `spv_index.json`.
- Add tests that an active reservation reduces selectable spendable UTXOs but does not change `cache.total` or `wallet_state` balance.

### Medium: broadcast queue cleanup can leave local wallet tx state behind

Code: `server_market.js:9790-9864`, `server_market.js:17680-17800`, `server_market.js:17803-17922`

Recent rawtx cleanup and local change/chat reconciliation call `confirmWalletTransaction` when a tx becomes confirmed, then rely on `propagateWalletEventToViews`. This confirms rows but does not verify the displayed projection has accepted the new wallet snapshot before cleanup continues.

Required fix:

- Treat `confirmWalletTransaction` as a wallet mutation and require a local snapshot bridge after a `true` return.
- If projection bridge fails, keep a pending wallet-projection-refresh marker instead of silently relying on the next periodic update.

### Medium: recover path is valid WOC usage but must not be followed by unsafe local replay

Code: `wallet.js:6899-6959`, `server_market.js:17931-18088`

`recoverWallet` and wallet switch/import routes are explicit operator actions, so WOC bootstrap is allowed. The risk is not the WOC use itself; the risk is any later local tx-context replay that resets or overwrites the WOC-confirmed UTXO truth.

Required fix:

- Preserve recover/import WOC bootstrap as the only source for confirmed UTXO truth during that operation.
- After recover/import, only pending locally-broadcast txs may be replayed, and only on top of the bootstrapped index.

## Immediate Fix Order

1. Repair missing wallet outputs in `applyConfirmedTxSummaryToSpvIndex`.
2. Replace unsafe pending replay after manual WOC bootstrap so it does not reset confirmed truth.
3. Add a shared post-broadcast wallet commit helper and use it from send/anchor/batch anchor.
4. Make state-lite and wallet summary prefer live local wallet snapshot when projection differs.
5. Add regression tests for confirmed summary repair, unsafe rebuild prevention, post-broadcast apply failure, anchor state/cache update, and projection-vs-live display.
6. Add projection bridge guarantees for confirmation cleanup paths.

## Runtime Recovery Policy

These rules are mandatory:

1. Automatic restore/replay is not allowed in normal runtime reconcile, refresh, broadcast follow-up, or background maintenance.
2. Restore/recover paths are allowed only for explicit operator actions:
   - wallet recover/import/bootstrap
   - explicit manual wallet sync/refresh
   - dedicated diagnostic/manual recovery commands
3. If stale cleanup or pending classification is missing an order-specific condition, add that condition to the cleanup/classification logic itself.
4. If the correct condition cannot yet be proven locally, add logs at the decision boundary and stop there. Do not add a runtime restore helper as a temporary workaround.
5. Any new restore helper must document:
   - why manual invocation is required
   - which operator action can call it
   - why the problem cannot be fixed at the original mutation/classification site

## Non-Negotiable Tests

1. Existing applied tx row with missing change output is repaired by confirmed summary.
2. Manual WOC bootstrap with one real confirmed UTXO plus stale historic tx contexts must keep the WOC-confirmed UTXO set and only replay allowed pending rawtxs.
3. A broadcasted send where `applyTxToSpvIndex` fails must not log success or leave send status as normal.
4. Single and batch anchors update `spv_index`, `cache.json`, and `wallet_state.json` in the same operation.
5. `/api/state-lite` uses live local wallet totals when projection is stale.
6. Reserved outpoints block double-selection but do not change persisted total balance.

## Open Audit Items

The above findings cover the balance bugs already seen in runtime. The remaining paths still need line-by-line follow-up before release:

- Order open/action anchor queue and failed-anchor retry behavior.
- `pending_anchor_projection` and `anchor_events` interaction with recent rawtx cleanup.
- Wallet read projection async writer hang in `test/event_bus_wallet_read_projection.test.js`.
- `wallet_and_nodes_built` latency in `/api/state-lite`.
- Import/recover bootstrap history ordering and projection reset timing.

## Current Audit Status

Completed in this pass:

- All direct wallet mutation functions in `wallet.js`.
- Send/anchor/batch anchor routes and command worker flow.
- Chat, drive, and local-change anchor entry points.
- Manual sync/recover/import WOC boundaries.
- Wallet read projection and state-lite display selection.
- Wallet tx reservation projection and queued-spend exclusion.

Fixed after this audit:

- Confirmed summary now repairs missing wallet outputs before the stable early return.
- Pending rawtx replay now preserves the existing confirmed base and does not reset/replay confirmed tx contexts.
- Confirmed tx-context full rebuild is blocked by default unless explicitly marked unsafe.
- Send, single anchor, and batch anchor now use one post-broadcast local commit helper that requires local index application and updates wallet state/cache.
- Wallet summary display now uses the live local wallet snapshot when the read projection differs.
