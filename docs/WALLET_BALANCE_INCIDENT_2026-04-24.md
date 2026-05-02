# Wallet Balance Incident - 2026-04-24

## Symptom

Linux wallet balance became too high again.

Current local snapshot before repair:

- `confirmed`: `1,879,854` sat
- `selfChangePending`: `16,224,930` sat
- `available`: `18,104,784` sat

The inflated part was entirely coming from local `selfChangePending`.

## What Was Found

This was **not** the same failure shape as the 2026-04-22 incident where confirmed balance was overstated by replaying incomplete historical tx contexts.

This time:

- `data/spv_index.json` had **no active `pendingWalletTxs`**
- but it still had **17 unconfirmed UTXOs**
- all 17 unconfirmed UTXOs belonged to txids already recorded in `stalePendingTxs`
- those 17 stale UTXOs summed to exactly `16,224,930` sat
- `buildWalletDisplayUtxoSummary()` classified them as `self_change_pending`
- cache/UI therefore added them into `available`

So the bug class was:

> stale pending txs were moved into `stalePendingTxs`, but some of their unconfirmed self-change UTXOs were left behind in `index.utxos`, and the display/cache layer still counted them as spendable pending change.

## Comparison With Previous Incidents

### 2026-04-22 incident

Documented in:

- `docs/WALLET_BALANCE_AUDIT.md`
- `memory/2026-04-22.md`

That incident was:

- confirmed/local truth overstated by unsafe confirmed tx-context replay
- older spent change outputs were re-added into confirmed truth

### 2026-04-24 incident

This incident is different:

- confirmed balance itself was not inflated
- the inflation came from stale unconfirmed self-change still present in local UTXO set
- the display/cache layer treated those stale change outputs as `available`

## Root Cause

There was an inconsistency gap between:

1. stale pending tx bookkeeping (`stalePendingTxs`)
2. local UTXO cleanup (`index.utxos`)
3. display/cache balance classification (`self_change_pending`)

In the observed state:

- stale tx rows had already been moved out of `index.txs`
- but their unconfirmed UTXOs still remained in `index.utxos`
- `buildWalletDisplayUtxoSummary()` had no guard against known stale txids

## Fix Applied

### Read-side guard

`buildWalletDisplayUtxoSummary()` now ignores unconfirmed UTXOs whose txid already exists in `stalePendingTxs`.

That prevents stale self-change from inflating:

- `selfChangePending`
- `available`
- `total`

### Index cleanup guard

Added `purgeKnownStalePendingUtxosFromIndex(index)` and called it at the start of `reconcileStalePendingWalletTxs()`.

That path now:

- removes leftover unconfirmed UTXOs for known stale txids
- removes matching `ownedOutpoints`
- rewrites cache and wallet state immediately

## Why This Matters

Without this fix, the wallet could show a much higher `available` balance even though those unconfirmed change outputs were already known stale and no longer visible in SPV mempool checks.

That is a dangerous sendability/UI bug even if confirmed truth is correct.

## Current Classification

This is a **new bug class**, not a repeat of the old confirmed-rebuild inflation bug.

Short label:

`stale_pending_utxo_residue_inflates_available_balance`

## Addendum - Second 2026-04-24 Balance Failure

Later the same day a second balance failure appeared with a different shape.

### Symptom

The wallet total dropped back down after order flows had already been created and locally applied.

Example affected order protocol txids:

- `efbb48b00fd233e21a60298cb29c862ee82579e72889adc933a42ee3873aaa04` (`place`)
- `40f296f7bbbb0a35d2c8ded47dc69c24646d197b5055c259077e2214d6271639` (`seller lock`)
- `d45743c10b112bae14e6c927fb5f94c5c6176ff1bd2a2104a2744dc29cf0908f` (`ship state`)
- `e3c044163a2676d25fa527b17eb4b2eecec53156a2ef5dd629ad929c687e66a5` (`completed settlement`)

Observed effect:

- local total dropped from about `2,823,760` sat
- down to about `1,893,630` sat

### Root Cause

`reconcileStalePendingWalletTxs()` only protected:

- unconfirmed ancestor txids referenced by active descendants

It did **not** protect the active order protocol package itself.

That allowed live order txs to be moved into `stalePendingTxs` when SPV mempool visibility checks temporarily missed them.

Once those order txs were marked stale:

- their local wallet effects were rolled back
- the displayed balance dropped

### Why The First Patch Was Not Enough

The first order-protection patch only prevented **future** stale classification for protected order txids.

It did not restore txs that had already been moved into `stalePendingTxs`.

There was also an execution-order bug:

- `reconcileStalePendingWalletTxs()` returned early when `candidateCount = 0`
- so the new restore step never ran for already-stale order txs

### Fix Applied At The Time

1. `buildProtectedOrderProtocolTxidSet()` now reads both:
   - `index.txs`
   - `index.stalePendingTxs`

2. Added `restoreProtectedOrderProtocolTxs(...)`
   - if a protected order tx is already in `stalePendingTxs`
   - and its `rawtx` exists in `tx_contexts`
   - reapply it into the live SPV index
   - remove it from `stalePendingTxs`

3. Moved the restore step **before** the `candidateCount = 0` early return

4. Wired stale reconcile into the manual wallet sync path as well, not only the background refresh path

### Verified Local Recovery

Manual local reconcile restored `26` protected order txs from `stalePendingTxs`, including the entire affected order package above.

This bug class should be tracked separately from the earlier stale-UTXO-residue issue.

Short label:

`order_protocol_txs_false_stale_reconcile_rolls_back_wallet_balance`

### Later Decision

The runtime restore approach above was only a temporary containment step and is no longer the accepted design direction.

Permanent rule:

- normal runtime stale reconcile must not restore pending order txs from `stalePendingTxs`
- active-order protection must be expressed directly in stale classification / prune conditions
- if runtime classification is still ambiguous, add logs at the decision point instead of adding a restore path

This incident remains useful as history, but `restoreProtectedOrderProtocolTxs(...)` should not remain part of the steady-state runtime design.

## Addendum - Third 2026-04-24 Balance Failure

Later the same day the wallet balance became inflated again even after the stale-order protection above had been added.

### Symptom

- runtime `/api/state-lite` still reported about `10,380,902` sat
- while the corrected display cache was only `908,030` sat

The wrong value was coming from historical terminal order chains being shown again as live unconfirmed wallet outputs.

### Root Cause

This failure had three linked parts:

1. **Terminal order-chain prune was incomplete**
   - `pruneTerminalOrderProtocolPendingTxs()` treated txids inside the same terminal order chain as protected ancestors
   - that blocked full-package prune for terminal chains like:
     - `COMPLETED`
     - `REFUNDED`
     - `CANCELED`
     - `TIMED_OUT`

2. **Wallet refresh could replay terminal order txs back into live index**
   - `listUnconfirmedAnchorTxidsWithRawtx()` was feeding historical terminal order txids back into the wallet refresh / replay path
   - those txs could then be rehydrated into `spv_index.json` even though they belonged to already-finished order packages

3. **`getCachedBalanceAndHistory()` trusted stale `cache.json`**
   - once `cache.json` had been inflated, runtime API reads kept serving it
   - the function only rebuilt cache for legacy-shape incompatibility
   - it did not verify the cache against the current SPV/display summary

### Fix Applied

1. `pruneTerminalOrderProtocolPendingTxs()` now prunes terminal order chains as a package
   - internal parent/child links inside the same terminal chain no longer count as external protection

2. `listUnconfirmedAnchorTxidsWithRawtx()` now excludes txids belonging to terminal orders

3. Added terminal-order filtering to:
   - `buildWalletDisplayUtxoSummary()`
   - `updateAddressBalancesFromSpv()`

4. `getCachedBalanceAndHistory()` now hot-validates `cache.json` against `buildCacheFromSpvIndex()`
   - if cache differs, it rewrites and returns the rebuilt value immediately

### Verified Result

After restart:

- `data/cache.json` returned to:
  - `confirmed = 908030`
  - `available = 908030`
  - `total = 908030`
- runtime `/api/state-lite` wallet summary also returned:
  - `totalSat = 908030`

The stale `wallet_state.json` address field had older inflated data, but the runtime wallet summary and UI-facing balance were corrected.

Short label:

`terminal_order_chain_replay_and_stale_cache_reinflate_wallet_balance`

## Addendum - 2026-04-27 Protected Order Pending Replayed Local-Only Tx

This is related to the stale pending balance failures above, but it is a distinct
failure shape.

The earlier 2026-04-24 stale-pending incident was:

- txids were already in `stalePendingTxs`
- their unconfirmed UTXOs remained in `index.utxos`
- display/cache counted those stale UTXOs as `selfChangePending`

The 2026-04-27 failure was different:

- the failed tx had **not** been moved into `stalePendingTxs`
- the local UTXO was still considered live pending change
- manual WOC reconcile skipped pruning because the tx was treated as protected
  order rawtx
- pending replay could then keep re-applying the same local-only rawtx

### Symptom

Linux wallet balance showed:

- `confirmed = 1583073`
- `selfChangePending = 982780`
- `available = 2565853`
- `total = 2565853`

WOC for wallet address `14GsPhLX89V3xak62RpcietMNL2zoDv53v` showed:

- `19` unspent outputs
- total `1583073` sat

The inflated part was exactly one local pending self-change output:

`a1009c28107b1ff91344a7df77b3940c1d9ef52857af5781597db2cb4b75bac9:1 = 982780`

WOC returned 404 for the txid, so it was not public chain or public mempool
truth.

### Root Cause

Manual wallet sync uses WOC as explicit reconcile truth, but it also protected
unconfirmed order rawtxs:

- `listUnconfirmedAnchorTxidsWithRawtx()`
- recent rawtxs from runtime state

That protection was too broad. A local-only failed order tx with rawtx could stay
protected forever, even after WOC reported no unconfirmed tx for the wallet
addresses.

The result:

1. `reconcilePendingWalletIndexWithWoc()` saw WOC unconfirmed count `0`
2. the local-only failed tx was skipped because it was in protected txids
3. `localOnlyPendingTxCount` became `0`
4. prune did not run
5. later pending replay could re-apply the rawtx and restore its self-change UTXO

This is why the wallet showed more available balance than WOC confirmed
unspent truth.

### Fix Applied

1. Protected pending txids are now protected only while they are recent.
   - after the protected freshness window expires
   - and WOC does not list the tx as unconfirmed
   - the tx is allowed into local-only prune

2. `collectKnownStalePendingTxidSet()` now includes every txid in
   `stalePendingTxs`.
   - it no longer requires `index.txs[txid]` to be missing
   - this makes display/cache defensive even if stale bookkeeping is partially
     inconsistent

3. Pending replay skips unconfirmed rawtxs already present in `stalePendingTxs`.
   - stale rawtxs must not be rehydrated into `index.utxos`

4. `listUnconfirmedAnchorTxidsWithRawtx()` filters out known stale txids.
   - stale order anchors are not treated as protected replay candidates

### Verified Result

After restarting Linux and running explicit `/api/wallet/sync`:

- `confirmed = 1583073`
- `selfChangePending = 0`
- `available = 1583073`
- `total = 1583073`

Local index:

- removed `a1009c...:1` from `index.utxos`
- removed `a1009c...` from live `index.txs`
- moved `a1009c...` into `stalePendingTxs`

WOC address unspent still showed `19` outputs totaling `1583073` sat, matching
local state.

Short label:

`protected_order_rawtx_keeps_local_only_pending_change_alive`

## 2026-04-27 Code Audit After Incident Review

After reviewing the incident classes above against the current code, two extra
guardrails were added.

### Stale Pending Must Be Excluded From Spend Selection

The display/cache layer already ignored stale pending UTXOs, but spend
selection also has to enforce the same rule.

Risk if missing:

- UI balance can look correct
- but transaction building can still pick a residual stale unconfirmed UTXO
- the next send/order action then fails or creates another local-only pending
  chain

Current rule:

- `listSpendableUtxosForState()` excludes unconfirmed UTXOs whose txid is in
  `stalePendingTxs`
- this keeps wallet display, cache, and spend selection aligned

Regression test:

`wallet spendable selection excludes residual stale pending change`

### Confirmed Summary Repair Must Not Lose Known Input Spend

When repairing a missing wallet output from a confirmed block summary, rawtx
input extraction can return `0` if the direct parent context is not available.
That must not overwrite an already known `spentSat`.

Risk if missing:

- a confirmed tx that previously recorded `spentSat`
- later receives a wallet output repair
- but parent context is missing
- `walletInputSat` is extracted as `0`
- `netSat` becomes falsely positive

Current rule:

- if extracted wallet input sat is `0`, keep existing `prev.spentSat`
- only replace spent amount when rawtx extraction has a positive wallet input
  value

Regression test:

`confirmed summary repairs wallet output missing from previously applied tx`

### Interaction Check

The current intended interactions are:

- active order txs are protected from SPV stale prune while they are still
  active and visible enough
- terminal order txs are allowed to be pruned as a package
- protected order rawtxs are protected only while recent; expired local-only
  protected txs are pruned by explicit WOC manual sync
- stale pending txids are never counted in display/cache and are never selected
  for spending
- stale pending rawtxs are not replayed back into the wallet index

These rules are not contradictory as long as the protection is scoped by both
order status and freshness. The dangerous pattern is any future broad
"protected txid" list that bypasses stale classification indefinitely.
