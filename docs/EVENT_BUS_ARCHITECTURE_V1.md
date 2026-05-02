# Event Bus Architecture V1

Date: 2026-04-04
Workspace: `/home/jb9802/.openclaw/workspace/app/bsv_market`

## Goal

Introduce an event-driven state architecture so modules are separated by responsibility and state ownership is explicit.

This architecture is intended to solve the current problems of:

- too many state sources
- too many write paths
- JSON state, SQLite projection tables, worker heartbeat files, and in-memory runtime overlays drifting apart
- difficult debugging when state is overwritten by stale writers or mixed responsibilities

## Core Model

The system is split into:

1. `event_log`
   - append-only fact source
2. `bus`
   - event distribution mechanism
3. `projection tables`
   - queryable current state
4. `writers`
   - the only components allowed to write a given projection

The system must pass events, not full state objects.

## Definitions

### Command

A request for work to be done.

Examples:

- `chat.connect_probe.requested`
- `sync.round.requested`
- `wallet_tx.broadcast.requested`

### Fact Event

Something that has happened and must not be mutated after being logged.

Examples:

- `chat.presence.received`
- `chat.handshake.succeeded`
- `chat.message.received`
- `sync.window.committed`
- `wallet_tx.broadcasted`

### Projection

Current derived state built from the event stream by a unique writer.

Examples:

- `chat_presence`
- `chat_thread_status`
- `chat_message_index`
- `sync_status`
- `wallet_pending_spend_reservations`

### Writer

The unique module allowed to commit a given projection.

### Subscriber

A module that reacts to events.

### Reader

A module that reads projections for display or decision-making.

## Rules

1. The bus carries events, not whole state snapshots.
2. `event_log` is the fact source.
3. `projection tables` are query state, not fact state.
4. Every projection must have exactly one writer.
5. Many producers may emit facts that affect a projection.
6. Only the unique writer may commit final projection state.
7. Modules subscribe to events for reactions.
8. Modules read projections for display and decisions.
9. Events are immutable once appended.
10. Corrections must be expressed by new events, not by editing old events.
11. Every projection must be rebuildable from `event_log` plus optional snapshots.
12. Event delivery may be at least once; consumers and writers must be idempotent.
13. The system is eventually consistent by default.
14. An in-memory bus may reduce latency, but it does not replace `event_log`.
15. Writer uniqueness is defined by projection domain, not by process name.

## Module State Access Principles

These principles apply to runtime modules such as `bhs_domain`, `sync_domain`, wallet runtime state, and similar cross-process state providers.

1. A module should read the latest state through a `get...()` function.
   - In normal runtime, that state should usually be loaded once at startup and then advanced by events.
   - `get...()` defines the module's authoritative read boundary.

2. Module state changes should be driven by events.
   - Producers publish facts or runtime signals.
   - Subscribers update their local runtime view from those events.
   - Repeated polling or ad hoc direct reads should not be the primary update mechanism.

3. External modules should only fall back to `get...()` when event-driven state is not reliable enough for the current decision.
   - Use this for startup hydration, recovery after restart, missed-event suspicion, integrity confirmation, or other trust-boundary checks.
   - In other words: react by event first, confirm by `get...()` only when confidence is low.

4. High-frequency small state such as "latest tip height" should prefer event-driven runtime propagation.
   - Example: `bhs.tip.changed` should broadcast `tipHeight` / `tipHash` so interested modules can update immediately.

5. Heavy or reconstructable state should remain projection-backed.
   - Example: full header maps, larger snapshots, and query-oriented state should still come from projection tables through the module `get...()` boundary.

6. Process-local memory caches must not silently become cross-process truth.
   - A cache may improve latency inside one process.
   - It must not be treated as authoritative unless it is explicitly maintained by the module's event stream and recovery contract.

## Ownership Model

Ownership is by projection domain.

Examples:

- `chat_message_index` has one writer
- `chat_thread_status` has one writer
- `chat_presence` has one writer

It is incorrect to say "the chat process writes all chat state" unless that process is the unique writer for each individual projection.

## Producer vs Writer

Producing a fact does not imply the right to write projection state.

Examples:

- a chat steward may emit `chat.handshake.succeeded`
- a P2P ingress handler may emit `chat.message.received`
- an anchor parser may emit `chat.message.anchored`

None of those modules should directly update `chat_thread_status` unless that module is the registered writer for that projection.

## Event Categories

Two event namespaces should be kept separate:

### Domain Events

Examples:

- `chat.*`
- `sync.*`
- `wallet_tx.*`
- `command.*`

### System Events

Examples:

- `system.worker.started`
- `system.worker.exited`
- `system.bus.delivery_failed`
- `system.projection.rebuild.completed`

This separation keeps the business event stream readable and debuggable.

## Suggested Event Envelope

```json
{
  "eventId": "evt_...",
  "eventType": "chat.handshake.succeeded",
  "producer": "chat_steward",
  "entityType": "chat_peer",
  "entityId": "wallet_xxx",
  "ts": "2026-04-04T12:34:56.000Z",
  "schemaVersion": 1,
  "causationId": "cmd_or_evt_id",
  "correlationId": "flow_id",
  "dedupeKey": "optional_dedupe_key",
  "payload": {}
}
```

Required fields:

- `eventId`
- `eventType`
- `producer`
- `entityType`
- `entityId`
- `ts`
- `payload`

Strongly recommended:

- `schemaVersion`
- `causationId`
- `correlationId`
- `dedupeKey`

## Suggested Persistent Tables

### `event_log`

Append-only source of facts.

Suggested columns:

- `seq INTEGER PRIMARY KEY AUTOINCREMENT`
- `event_id TEXT NOT NULL UNIQUE`
- `event_type TEXT NOT NULL`
- `producer TEXT NOT NULL`
- `entity_type TEXT NOT NULL`
- `entity_id TEXT NOT NULL`
- `ts TEXT NOT NULL`
- `schema_version INTEGER NOT NULL DEFAULT 1`
- `causation_id TEXT NOT NULL DEFAULT ''`
- `correlation_id TEXT NOT NULL DEFAULT ''`
- `dedupe_key TEXT NOT NULL DEFAULT ''`
- `payload_json TEXT NOT NULL`

### `event_consumers`

Consumer checkpoints for replay/resume.

Suggested columns:

- `consumer_name TEXT PRIMARY KEY`
- `last_seq INTEGER NOT NULL DEFAULT 0`
- `updated_at TEXT NOT NULL`

## First-Wave Projection Domains

The first implementation wave should focus on the domains with the worst state drift and overlapping writers.

### 1. Chat

Projections:

- `chat_presence`
- `chat_thread_status`
- `chat_message_index`

Suggested events:

- `chat.profile.bound`
- `chat.presence.received`
- `chat.presence.expired`
- `chat.handshake.started`
- `chat.handshake.succeeded`
- `chat.handshake.failed`
- `chat.message.received`
- `chat.message.sent`
- `chat.message.anchored`
- `chat.thread.read_marked`

### 2. Sync and Job Status

Projections:

- `sync_status`
- `job_status`

Suggested events:

- `sync.round.started`
- `sync.headers.advanced`
- `sync.window.committed`
- `sync.round.failed`
- `command.enqueued`
- `command.claimed`
- `command.done`
- `command.failed`
- `command.interrupted`

### 3. Wallet Transaction Reservations

Projections:

- `wallet_pending_spend_reservations`

Suggested events:

- `wallet_tx.reservation.requested`
- `wallet_tx.reserved`
- `wallet_tx.broadcasted`
- `wallet_tx.confirmed`
- `wallet_tx.dead`
- `wallet_tx.reservation.released`

## First Version Implementation Strategy

Do not attempt a whole-system rewrite first.

Phase 1 should:

1. add `event_log`
2. add consumer checkpoints
3. add event envelope helpers
4. introduce one domain writer end-to-end
5. move one unstable state domain onto event -> writer -> projection flow

Recommended first domain: `chat`

Reason:

- it already has multiple producers
- it currently mixes JSON state, SQLite projection, runtime session state, and worker callbacks
- it contains several state semantics that should be separated cleanly:
  - presence
  - reachability
  - thread state
  - message index

## Non-Goals For V1

- replacing every existing table in one step
- removing SQLite snapshot tables immediately
- making the entire system strongly consistent
- introducing a distributed external message broker

V1 is local, SQLite-backed, append-only, and incremental.
