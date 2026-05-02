# Process Boundary Rules

## Core Rule

`server_market.js` is the UI gateway, not the execution engine.

The main process may only do these things:

- accept HTTP requests
- read precomputed cache/state snapshots
- return lightweight status data
- enqueue commands for background workers
- wait for command completion using lightweight polling

The main process must not do these things on user-facing request paths:

- read and rebuild large state from disk for UI rendering
- scan anchors or replay chat/event history
- verify signatures or decrypt chat payloads
- refresh wallet balances/history from the chain
- broadcast transactions
- perform long-running wallet or sync work

## Worker Ownership

Background workers own all heavy work:

- chain sync and index rebuilds
- wallet refresh/rescan work
- wallet send/broadcast work
- chat derivation and UI view-cache generation
- expensive file reads, validations, and full-state recomputation

## UI Contract

Frontend refresh flows must consume worker-produced caches.

If the UI needs fresher data, the main process should:

1. enqueue a worker command
2. optionally wait for command completion in a lightweight way
3. return the updated cached view

The UI must not depend on main-process endpoints that recompute large state inline.

## Change Policy

Any new endpoint should be reviewed against this rule:

- If it computes or scans, move it to a worker.
- If it mutates or broadcasts, dispatch it to a worker.
- If it only displays, serve from cache.
