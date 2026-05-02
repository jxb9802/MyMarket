# UI Entry Audit

Scope: current release only. Product catalog and order flows are intentionally excluded except when shared state affects chat, drive, wallet, sync, profile, or login.

## Summary

The current frontend is mostly event-driven after login. Initial login loads only core domains (`sync`, `wallet`, `profile`), then feature modules load on demand. Chat and drive no longer depend on catalog/order prefetch for their main entry.

The main checked files are:

- `index.html`
- `app.js`
- `server_market.js`
- `chat_routes.js`
- `drive_browser_routes.js`
- `wallet.js`

Syntax checks passed for all of them:

```text
node --check app.js
node --check server_market.js
node --check chat_routes.js
node --check drive_browser_routes.js
node --check wallet.js
```

## Entry Map

### Login and Wallet Session

| Entry | Frontend handler | API/backend | Expected behavior | Audit result |
| --- | --- | --- | --- | --- |
| Password login | `btnLoginSubmit` in password mode | `POST /api/auth/login` | Verify password, save session, load core bootstrap, connect `/api/ws` | OK |
| Create wallet | `btnGenerateMnemonic`, then `btnLoginSubmit` | `POST /api/wallet/switch` mode `create` | Generate mnemonic, set logged-in state, load core bootstrap | OK, but naming is confusing because generate already creates/switches wallet |
| Import wallet | `btnLoginSubmit` import mode | `POST /api/wallet/switch` mode `import` | Import mnemonic, defer chain/catalog sync, load core bootstrap | OK |
| Logout | `btnLogout` | `POST /api/auth/logout` | Clear session, stop wallet/catalog timers, close WebSocket, reopen auth gate | OK |
| Switch wallet | `btnWalletSwitch`, `btnSwitchStep1Next`, `btnConfirmSwitchWallet` | `POST /api/auth/login`, `POST /api/wallet/switch`, `POST /api/wallet/sync` | Verify old password, import new mnemonic, sync wallet cache | OK, but long operation depends on command polling |

### Profile and Settings

| Entry | Frontend handler | API/backend | Expected behavior | Audit result |
| --- | --- | --- | --- | --- |
| Open profile | `btnProfile`, wallet card click | local view switch + lazy wallet ledger if active | Should switch immediately and load wallet details only when wallet area active | OK |
| Save profile/chat config | `btnSaveProfile` | `POST /api/profile`, `POST /api/chat/config`, optional `POST /api/chat/profile/publish` | Save name/config, publish chat profile if needed | OK with risk: two independent API writes can partially succeed |
| Language select | `langSelect.change` | locale JSON load | Update UI text and rerender | OK |
| Steward settings | `btnApplySteward` | `POST /api/steward` | Save polling/replay settings | Inactive: `btnApplySteward` is referenced in JS but missing from HTML |

### Sync and Nodes

| Entry | Frontend handler | API/backend | Expected behavior | Audit result |
| --- | --- | --- | --- | --- |
| Sync card | `syncCard.click` | `GET /api/spv/nodes` through `openSpvNodesModal` | Show connected nodes | OK |
| Connected nodes | `btnShowConnectedNodes` | node snapshot | Show connected list | OK |
| Candidate nodes | `btnShowCandidateNodes` | node snapshot | Show candidate list | OK |
| Sync now | `btnSyncNow` | opens resync modal | User chooses bootstrap height and confirms | OK after fix below |
| Resync confirm | `btnConfirmResync` | `POST /api/catalog/resync` | Clear local sync state and start background resync flow | Fixed bug: failure path previously referenced out-of-scope `flowNonce` |
| Push pending chain changes | `btnPushChain`, `btnConfirmPushInModal` | `GET /api/changes/preview`, `POST /api/changes/push` | Show pending queue, submit background publish, track progress | OK |
| Recover failed pending change | delegated click in `recoverableList` | `POST /api/changes/recover` | Cancel local reservation for unconfirmed failed chain item | OK |
| Data rebuild | `btnRebuildData` | `POST /api/data/rebuild` | Rebuild projections from local anchors | OK |

### Wallet

| Entry | Frontend handler | API/backend | Expected behavior | Audit result |
| --- | --- | --- | --- | --- |
| Wallet sync | `btnWalletSync` | `POST /api/wallet/sync`, `GET /api/command-status/:id`, `GET /api/wallet/sync-progress` | Queue wallet refresh, show progress, update balance/preflight | OK |
| Receive | `btnWalletReceive` | `GET /api/wallet/receive-address` | Show current receive address and QR | OK, but QR endpoint can cause repeated event-loop lag in logs |
| Copy receive address | `btnCopyReceive` | Clipboard API | Copy current address | OK |
| Open send modal | `btnWalletSend` | local preflight | Only opens if balance and send gate are ready | OK |
| Send all | `btnSendAll` | `GET /api/wallet/status` then local estimate | Estimate fee and set amount field | OK after previous send-all fix |
| Confirm send | `btnSendConfirm` | `POST /api/wallet/send`, command polling | Queue send, show active step progress, refresh send eligibility | OK |
| Show mnemonic | `btnShowMnemonic`, `btnMnemonicConfirm` | `POST /api/wallet/mnemonic` | Verify password and display mnemonic | OK |

### Chat

| Entry | Frontend handler | API/backend | Expected behavior | Audit result |
| --- | --- | --- | --- | --- |
| Open chat | `btnChat` | background `ensureDomainLoaded("chat")` + `GET /api/chat/open` through worker | Modal paints immediately, then contacts load | OK |
| Close chat | `btnCloseChat` | local | Hide modal, stop status polling | OK |
| Search user | `btnChatSearch`, Enter in search input | `GET /api/chat/search` | Show search results without moving existing list order | OK |
| Select contact | delegated `chatUserPane` click | `GET /api/chat/thread` in background | Active state/input immediate, cached messages first, DB messages replace after fetch | OK |
| Scroll to top | `chatBox.scroll` | `GET /api/chat/thread?page=n` | Auto-load older 30 messages, preserve scroll position | OK |
| Direct chat connect | removed | HTTP signaling disabled by protocol policy | Future direct chat must use a non-HTTP P2P transport | Removed from current UI/test flow |
| Disconnect | delegated `data-chat-disconnect` | `POST /api/chat/disconnect` | Clear connection state, refresh active status | OK |
| Send message | `btnSendChat`, Enter | `POST /api/chat/send`, worker `send` | Show local pending immediately, replace with server result, preserve message order | Mostly OK; see risks |
| Chain fallback confirmation | `chatFeeModal` buttons/Enter | local resolver | Confirm chain fallback only when no direct connection | OK |
| Emoji shortcut | `chatEmojiBar.click` | local input insert | Insert at caret, do not auto-send | OK |
| Online/offline | `btnChatToggleOnline` | `POST /api/chat/self-state` | Toggle self state and broadcast snapshot | OK |
| Friend/block menu | `btnChatFriendAction`, `btnChatBlockAction` | chat friend/block APIs | Update relationships and refresh threads | OK |
| Display menu | metadata checkboxes | local preference | Rerender messages with selected metadata | OK |

### Drive

| Entry | Frontend handler | API/backend | Expected behavior | Audit result |
| --- | --- | --- | --- | --- |
| Open drive | `btnDrive` | `GET /api/drive/tree` | Load drive tree/listing and show modal | Works, but modal waits for API before first paint |
| Close drive | `btnCloseDrive` | local | Hide modal | OK |
| Set root dir | `btnPickDriveRootDir`, dir picker rows, confirm | `GET /api/drive/server-dirs`, `POST /api/drive/root-dir` | Browse server dirs, save root, refresh drive | OK |
| Dir picker up/root | `btnDriveDirGoUp`, root chips | `GET /api/drive/server-dirs` | Navigate fixed-height picker | OK |
| View mode | `btnDriveViewList`, `btnDriveViewGrid` | local render | Switch list/grid without API | OK |
| Refresh | `btnDriveRefresh` | `GET /api/drive/tree` | Reload current directory | OK |
| Tree click/expand | delegated tree click | `GET /api/drive/tree` or local expand | Navigate or expand tree | OK |
| Tree right click | `contextmenu` + dynamic menu | local modal open | New dir / rename dir | OK |
| New directory | `btnDriveNewDir`, right-click menu, Enter | `POST /api/drive/mkdir` | Optimistic local directory, no full tree refresh during chain write | OK |
| Rename directory | right-click menu, modal confirm/Enter | `POST /api/drive/dir/:dirId/rename` | Modal rename, then refresh final path | Works, but not optimistic and still can show misleading UTXO error if wallet index rebuild cannot fix it |
| Upload files | file input change | upload start/chunk/preview/finish APIs | Prepare each file, confirm once, queue chain anchoring | OK with risk: files are prepared sequentially |
| Confirm existing upload | `data-drive-confirm-upload` | `POST /api/drive/upload/:taskId/finish` | Resume from awaiting confirmation | OK |
| Resume upload | `data-drive-resume-upload` | `POST /api/drive/upload/:taskId/resume` | Mark queued locally, call resume, poll tasks | OK |
| Cancel upload | `data-drive-cancel-upload` | `POST /api/drive/upload/:taskId/cancel` | Remove local progress, refresh current dir | OK |
| Download file/dir to server | listing buttons | `POST /api/drive/download/server` | Restore to configured root | OK |
| Browser download | filename click + confirm | `GET /api/drive/download/browser` | Download already-local file | OK |
| Manual anchor file | `data-drive-anchor-file` | `POST /api/drive/file/:fileId/anchor` | Anchor not-on-chain file | OK |
| Delete file/dir | delete buttons + confirm | preview/delete APIs | Cost preview, mark deleting, remove after chain success | OK |

### WebSocket and Background Events

| Event | Handler | Effect | Audit result |
| --- | --- | --- | --- |
| `/api/ws` open/close/error | `connectEventStream` | Maintains frontend event stream, reconnects on close | OK |
| `sync.snapshot.updated`, `sync.nodes.updated` | `handleFrontendEvent` | Merge sync state, update header/modal/progress | OK |
| `wallet.snapshot.updated`, `wallet.ledger.updated` | `handleFrontendEvent` | Update wallet summary/history | OK |
| `drive.upload.progress` | `upsertDriveUploadProgress` | Update upload row only, no full tree refresh | OK |
| `drive.tree.updated` | `fetchDriveTree` if modal open and not suppressed | Refresh current drive view | OK with suppression windows for chain ops |
| `chat.snapshot.updated` | unread/status/thread refresh | Update unread and contact status | OK with risk: can still force status render and hide stale-name bugs |
| `chat.message.appended` | cache merge + unread + sound | Insert message if current/loaded, mark unread otherwise | OK |
| `chat.status.updated` | contact connection state merge | Update status buttons/list | OK |
