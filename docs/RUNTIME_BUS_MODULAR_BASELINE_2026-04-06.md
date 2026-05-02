# 总线模块化的第一个版本

Date: 2026-04-06
Workspace: `/home/jb9802/.openclaw/workspace/app/bsv_market`
Parent repo branch: `master`
Parent repo HEAD: `6217f09`

## Scope

This baseline records the first validated runtime-bus modularization state inside `app/bsv_market`.

The parent repository does not track `app/bsv_market` as a normal Git subtree, and the parent worktree also contains unrelated dirty and untracked files. Because of that, this baseline is recorded as a project-local document instead of a repository commit or tag.

## Baseline Goals Reached

- Runtime messaging defaults to non-persistent, no replay, and no-consumer means drop.
- Active runtime modules no longer depend on `event_log` replay for their main update path.
- `bhs`, `sync`, `catalog`, `profile`, `local_state`, `wallet_read`, `order`, and `wallet_tx` use direct projection updates in active runtime paths.
- Sync production is BHS-event-driven instead of old fixed-interval polling.
- Persist writes are further centralized through the writer layer for state and runtime snapshot files.
- Resync/reset uses a dedicated reset service and clears runtime-visible state through the sync path instead of ad hoc manual cleanup.
- Node accounting is unified:
  - `connectedNodes` means currently listening or actively syncing nodes
  - candidate/testable nodes are reported separately
  - listener and sync roles may coexist on the same node
  - sync-active nodes are excluded from broadcast/send selection
- Sync node scoring prefers `firstDataElapsedMs` over pure total elapsed time.
- `sync.job.updated` was reduced to meaningful display-state updates with unchanged-value skipping and throttling.

## Current Validation Snapshot

- `node --check server_market.js`: pass
- `node --check sync_domain.js`: pass
- `node --check wallet.js`: pass
- `node --check independent_sync_service.js`: pass
- `node --check app.js`: pass
- Linux runtime validation:
  - no new `request_timeout`
  - no new `WRITER_ERROR`
  - no new `Invalid string length`
  - sync windows continue to finish normally
  - `sync.state.snapshot_replaced` frequency reduced to window-level writes
  - `sync.job.updated` reduced to stage/window-level updates

## Current Runtime Model

### Runtime Bus

- File: [lib/runtime_bus.js](/home/jb9802/.openclaw/workspace/app/bsv_market/lib/runtime_bus.js)
- Default semantics:
  - cross-process
  - non-persistent
  - no replay
  - no subscriber means drop

### Persist Model

- Modules decide when and what to persist.
- Actual writes are executed through the persist/writer layer.
- Main runtime paths do not use `event_log` replay as a recovery mechanism.

### Recovery Model

- Runtime recovery prefers projections and dedicated persisted snapshots.
- The system no longer relies on replaying a shared global event log to rebuild active runtime views.

## Unified Node Policy Baseline

- Wallet remains the single owner of node inventory.
- A node may simultaneously carry:
  - `listener`
  - `sync_active`
- A `sync_active` node must not be selected for `broadcast`.
- In high-lag mode:
  - listener target may be reduced to `0`
  - wallet send/broadcast is disabled
  - sync gets the full node budget
- `connectedNodes` only counts nodes currently in listener or sync-active roles.
- Candidate/test-only nodes are exposed separately and do not count as connected.

## Key File Hashes

- `server_market.js`: `101c2f358bacd9fdde86739776671b75d7da92f4d89cca8e7f55d915fa3554b6`
- `sync_domain.js`: `bb4ffc9e03d7d4e8e30a88021204d58165fdfaf94058cb93e368d51dba8d5a85`
- `wallet.js`: `37d67ea6241d74518b41d9341f2f787353ce9344ad10c5ce7c3ff5c1eb8062e1`
- `independent_sync_service.js`: `441f279382509868d17568cc7db887bdeeb89b59a3561e8f669290f3fd72561e`
- `app.js`: `289ca1c36c0848105e490a6b09d2195bb24dfdeb8c2bec3cf525acb39af1305a`
- `lib/runtime_bus.js`: `3ee53849ac6c2ded824673938d09fc5b8d4e2a4c898cb9214f2fd5a700230870`
- `bhs_domain.js`: `f2d0fc185478edadcb0c2af7c9140b02b0f5c7f4569650d32d896db6a4e4bf07`
- `catalog_domain.js`: `2d3ce3d005717a0c59697bdde2874a9e12362d4028f76f29704bad6692cc5810`
- `profile_domain.js`: `c2cf4d8a843bc2157b1d4caa1481bacd37436a7cae487e8ec56b1507fb3001f4`
- `local_state_domain.js`: `76590e7249211f294dbf071937c952be92e2a7a4a8975fe6e3a7d24741c972dc`
- `wallet_read_domain.js`: `a081f9e822de7d6817c9ff6def2393c8ae886b579223d9467859fb938e0095eb`
- `order_domain.js`: `877ddfab26137977194a25577bb2e2ff4904d13961dc9cae5af0d04693bf4d77`
- `wallet_tx_domain.js`: `c3ff0ec5bb587f8679428d81562962a5c8fa60f1685a2fcdc1c1e44a5157e9ab`

## Notes

- This baseline is intentionally project-local.
- If a later refactor needs comparison, compare against this document first instead of the parent repository state.
- Windows deployment copies should continue to come only from Linux-validated files.
