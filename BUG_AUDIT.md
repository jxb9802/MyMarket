# Bug Audit

Scope excludes product catalog and order flows unless they affect shared state.

## Fixed During Audit

### 1. Resync failure path could throw `ReferenceError`

- Severity: high
- File: `app.js`
- Entry: `btnConfirmResync`
- Problem: `flowNonce` was declared inside the `try` block but referenced from `catch`. If `/api/catalog/resync` failed, the UI could throw `ReferenceError: flowNonce is not defined`, hiding the real sync error and leaving the resync modal in a bad state.
- Fix: moved `flowNonce` declaration outside the `try` block and assigned it before starting the flow.
- Verification: `node --check app.js` passed.

### 2. Resync percent progress UI was referenced but missing from HTML

- Severity: low to medium
- Entry: `btnSyncNow` / resync modal
- Code references: `resyncProgressBar`, `resyncProgressText`
- HTML currently has `resyncProgressPanel`, `resyncProgressTitle`, `resyncProgressSummary`, `resyncStepList`, and `resyncElapsed`, but no `resyncProgressBar` or `resyncProgressText`.
- Current behavior: guarded null checks prevent crashes, but percent progress UI never appears.
- Fix: added the missing progress bar/text DOM, reusing the existing sync progress styles.

### 3. Debug endpoint used `_req` but referenced `req`

- Severity: low
- File: `server_market.js`
- Route: `/api/debug/pending`
- Problem: route declared `(_req, res)` but used `buildProjectionBackedState(req)`, so the debug endpoint threw if called.
- Fix: renamed `_req` to `req`.

### 4. Drive window first paint waited for `/api/drive/tree`

- Severity: medium
- Entry: topbar `btnDrive`
- Code path: `btnDrive.click -> openDriveExplorer()`
- Problem: the modal stayed hidden until `/api/drive/tree` returned, so any directory-tree delay looked like the button did nothing.
- Fix: open the modal immediately, render cached state or a loading row, then fetch the tree in the background and replace the panes when it returns.

### 5. Chat contact display-name regressions now have coverage

- Severity: medium
- Entry: chat open/status update/contact refresh
- Problem: this issue had recurred several times: real names could appear to regress to wallet ids, and same display names could make contacts look merged even when thread data stayed separate.
- Fix: added `test/chat_contact_display_name_regression.test.js`, which loads the real `app.js` helper functions and verifies:
  - a real display name is not overwritten by generated wallet ids
  - status patches without `displayName` preserve existing names
  - two different wallet ids with the same display name remain separate rows
- Verification: `node --test test/chat_contact_display_name_regression.test.js` passed.

### 6. Chat status updates no longer require full contact-list redraw

- Severity: medium
- Entry: chat open, connect/disconnect, incoming status event
- Problem: pure status changes called `renderChatUsers()`, so the entire left contact list was rebuilt even when only one row's connection state changed.
- Fix: added single-row contact rendering/update. `chat.status.updated`, direct-status refreshes, connect countdowns, and disconnect updates now prefer `updateChatUserRow(walletId)` and only fall back to full render if the row is not present.
- Verification: `node --check app.js` and `node --test test/chat_contact_display_name_regression.test.js` passed.

### 7. Chat connect timeout now has a grace verification window

- Severity: medium
- Entry: contact `连接`
- Problem: if the connect API timed out while P2P finished shortly afterward, the UI could briefly show failed until a later status event corrected it.
- Fix: after API failure or 30s countdown expiry, the row enters an 8s `正在确认连接状态...` phase and keeps checking `/api/chat/status`. A late `directConnected` status immediately wins and clears the failure state.
- Verification: `node --check app.js` passed.

### 8. Drive directory rename is optimistic and clearer on wallet spendability errors

- Severity: medium
- Entry: directory tree right-click `改名目录`
- Problem: rename waited for the chain operation before UI changed, and UTXO failures looked like “no balance” even when total balance existed.
- Fix: frontend now renames the local tree/listing immediately with `改名中`, suppresses noisy tree refresh during the chain write, rolls back on failure, and shows available/confirmed/self-change sats when the backend reports no spendable UTXO. Backend rename errors now include a `NO_SPENDABLE_UTXO` code and wallet spendability snapshot.
- Verification: `node --check app.js`, `node --check drive_browser_routes.js`, and drive tests passed.

### 9. Multi-file upload preparation uses small concurrency

- Severity: low to medium
- Entry: file input multi-select
- Problem: selected files were prepared one by one before the confirm modal, making several-file uploads feel slow.
- Fix: local preparation now runs with concurrency 2. Chain finish remains sequential. If some files fail during preparation, successfully prepared files can still continue.
- Verification: drive upload tests passed.

### 10. Stale DOM references were restored or reduced

- Severity: low
- Problem: JS referenced multiple DOM ids that were not present in HTML.
- Fix: restored intended UI placeholders/buttons/status rows for sync gate, steward apply, recover sync, chat status/load-more, and drive root-dir hint. The only remaining missing id is `driveTreeContextMenu`, which is dynamically created at runtime.
- Verification: mechanical DOM id check now reports only `driveTreeContextMenu`.

## Findings To Fix

No release-blocking findings remain from this audit scope. Product catalog and order flows remain excluded by release plan.

## Checks Passed

- Frontend event stream remains WebSocket based: `connectEventStream()` opens `/api/ws`.
- Chat thread load path is now cache-first for contact switch.
- Chat message events update cache/unread/sound without needing HTTP polling.
- Drive upload progress events update listing only and avoid full tree refresh during active upload.
- New directory is optimistic and suppresses tree refresh during chain write.
- Send-all wallet flow uses command progress and no longer relies on synchronous send completion.

## Suggested Next Fix Order

1. Run a real browser smoke test for chat row stability and drive rename UI.
2. Run P2P chat smoke test across known nodes after deployment.
3. Keep `driveTreeContextMenu` documented as dynamic in future DOM-id checks.
