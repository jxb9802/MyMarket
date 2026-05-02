# Chat Refactor Baseline 2026-03-13

Date: 2026-03-13
Workspace: `/home/jb9802/.openclaw/workspace/app/bsv_market`
Parent repo branch: `master`
Parent repo HEAD: `6217f09`

## Scope

This baseline is for the chat refactor work inside `app/bsv_market`.
The parent repository has unrelated dirty and untracked changes, so this file is the project-local baseline instead of a repository commit baseline.

## Current Validation

- `node --test`: pass
- `node --check server_market.js wallet.js block_headers_service.js order_state_machine.js p2p_height_guard.js`: pass

## Key File Hashes

- `demo.js`: `f709aa68ec8e79df3494c4f4c8cf2faea147ef543891d2066be4f9906f579a17`
- `index.html`: `fb6ccc9218ecca67536d74144cd8013eeb9c9f02fb5501b860d778b380fc7b15`
- `package.json`: `859292c030a144f64940a92d67b7507bfeb3181078454fe5abd20528dd50cd9e`
- `server_market.js`: `84b4ce88f591ffee549c7634d1ea3c20d6be547446930bd52105dbf01b8260a2`
- `wallet.js`: `a20e19e847c9317f7f431247c29958cd548deeb96590a618b2ef6c374d4b55bc`

## Current Chat Behavior Snapshot

- Single chat modal entered from top-right button.
- UI mixes "P2P" and "on-chain" wording, but current implementation is not a true cross-node P2P transport.
- Existing global chat endpoint persists messages locally.
- Existing order chat anchors a chat event, but the current anchored payload does not carry full message content.
- Existing peer "online" status is heuristic, not actual bidirectional connectivity.

## Confirmed Refactor Direction

- One unified chat window.
- On-chain chat and P2P chat must coexist.
- Messages from `onchain` and `p2p` live in one local message store and are sorted by time.
- Each message keeps a transport marker.
- Chat thread primary key will be `walletId`.
- Public key ownership is determined by first valid on-chain bind only.
- Reuse wallet-derived chat keys for both `onchain` and `p2p` message encryption.
- "Direct connected" must remain gray until background stewards complete bidirectional reachability verification.
- Steward diagnostics stay in logs, not user-facing UI.
- Chat must be a fully independent module and communicate with wallet/order/sync only through the event bus/runtime bus.
- User online/offline state must be broadcast-capable, and going offline must automatically disable P2P listening while preserving on-chain chat sync and read behavior.

## Notes

- This baseline intentionally records the pre-refactor state after removing the obsolete profile-page "区块同步" button.
