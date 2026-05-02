# Frontend Event Gateway And Hub V1

Date: 2026-04-08
Workspace: `/home/jb9802/.openclaw/workspace/app/bsv_market`

This document refines `FRONTEND_EVENT_DRIVEN_ARCHITECTURE_V1.md` into concrete backend and frontend modules.

## 1. Goal

Define the first implementation version of:
- backend `frontend_event_gateway`
- frontend `event_hub`

This document focuses on module responsibility, data flow, event contract, and startup behavior.

## 2. Confirmed Decisions

The following are already confirmed:
- transport is `WebSocket`
- websocket is push-only in V1
- frontend commands remain HTTP-based
- one shared websocket carries all domain events
- V1 domains are:
  - `sync`
  - `chat`
  - `wallet`
  - `order`
  - `catalog`
  - `profile`
- bootstrap must preserve current visible initialization data
- migrated screens remove polling

## 3. Backend Module: `frontend_event_gateway`

## 3.1 Purpose

`frontend_event_gateway` is the backend adapter between internal domain/runtime events and frontend UI events.

It is the only backend module allowed to push runtime UI events to browser clients.

## 3.2 Responsibilities

The gateway must:
- subscribe to internal runtime bus / event bus
- normalize internal events into frontend UI events
- assign monotonic frontend event ids
- keep a small in-memory replay buffer
- manage websocket client sessions
- broadcast events to all eligible clients
- serve bootstrap snapshots
- emit heartbeat / warning events when needed

The gateway must not:
- own domain business logic
- mutate domain projections
- directly write sync/chat/wallet/order/catalog/profile state
- bypass public domain getters when building bootstrap payloads

## 3.3 Suggested File

Add:
- `frontend_event_gateway.js`

## 3.4 Suggested Public API

```js
startFrontendEventGateway({ bus, runtimeBus, domains })
stopFrontendEventGateway()
attachFrontendEventSocket(ws, req)
buildFrontendBootstrap(req)
publishFrontendEvent(event)
```

## 3.5 Event Sources

### Sync

Candidate source functions/events:
- `sync_domain.getSyncStatus()`
- `sync_domain.getSyncRuntimeSnapshot()`
- `runtime.updated`
- `sync.paused`
- `sync_domain.stopped:*`
- `sync.job.updated`
- `bhs.tip.changed`

### Chat

Candidate source events:
- `chat.handshake.started`
- `chat.handshake.succeeded`
- `chat.handshake.failed`
- `chat.message.received`
- `chat.message.sent`
- `chat.message.anchored`
- `chat.thread.read_marked`
- `chat.presence.received`
- `chat.presence.expired`

### Wallet

Candidate source functions/events:
- wallet session load/unload signals
- wallet balance/history refresh completion
- wallet send lifecycle
- wallet runtime policy changes

### Order

Candidate source events:
- order created / updated / status changed
- order evidence written
- order-linked chat summary changes

### Catalog / Profile

Candidate source events:
- catalog snapshot updated
- product/category local change committed
- profile updated

## 3.6 Client Session Model

V1 uses one websocket connection per browser session.

Each client session should track:
- `sessionId`
- `connectedAt`
- `lastSentEventId`
- `lastAckEventId` optional
- `walletScope` if needed later

V1 does not require per-client event filtering beyond normal auth/session rules.

## 3.7 Replay Buffer

V1 replay buffer is memory-only.

Suggested structure:

```js
{
  nextEventSeq: 1,
  recentEvents: [
    { eventId, seq, ts, domain, type, entityId, payload }
  ]
}
```

Suggested constraints:
- keep last `1000` to `5000` UI events
- drop oldest on overflow

## 3.8 Frontend UI Event Envelope

All pushed events should use one contract:

```json
{
  "eventId": "fevt-000001",
  "seq": 1,
  "ts": "2026-04-08T22:50:00.000Z",
  "domain": "sync",
  "type": "sync.status.changed",
  "entityId": "global",
  "payload": {}
}
```

Required:
- `eventId`
- `seq`
- `ts`
- `domain`
- `type`
- `entityId`
- `payload`

## 3.9 WebSocket Message Types

V1 websocket frame types:

### server -> client

- `hello`
- `bootstrap_required`
- `event`
- `heartbeat`
- `warning`

### client -> server

V1 client frames are minimal:
- `hello`
- `resume`
- `ping`

No business commands go over websocket in V1.

## 3.10 Suggested Message Shapes

### `hello`

```json
{
  "kind": "hello",
  "serverTs": "...",
  "lastEventId": "fevt-001000"
}
```

### `event`

```json
{
  "kind": "event",
  "event": {
    "eventId": "fevt-001001",
    "seq": 1001,
    "ts": "...",
    "domain": "chat",
    "type": "chat.message.added",
    "entityId": "wallet-abc",
    "payload": {}
  }
}
```

### `heartbeat`

```json
{
  "kind": "heartbeat",
  "serverTs": "..."
}
```

### `bootstrap_required`

```json
{
  "kind": "bootstrap_required",
  "reason": "replay_miss"
}
```

## 3.11 Bootstrap Builder

`buildFrontendBootstrap(req)` should assemble one payload covering current visible UI state.

Suggested top-level shape:

```json
{
  "success": true,
  "serverTs": "...",
  "bootstrapVersion": 1,
  "lastEventId": "fevt-001000",
  "sync": {},
  "chat": {},
  "wallet": {},
  "order": {},
  "catalog": {},
  "profile": {}
}
```

Suggested domain payloads:

### sync
- current phase
- local height
- network height
- lag
- active nodes
- queue/job summary
- pause state

### chat
- self identity summary
- self online/offline state
- thread list
- unread summary
- currently opened thread summary if available later

### wallet
- wallet loaded state
- wallet key / receive address
- balance summary
- send policy
- recent history summary

### order
- current order list summary
- highlighted order states

### catalog
- visible category/product snapshot used by current UI

### profile
- visible self profile snapshot

## 3.12 Domain Event Mapping

The gateway should convert internal events into stable UI events.

Examples:

### sync mapping

- internal runtime summary update
  -> `sync.status.changed`

- sync window committed
  -> `sync.window.finished`

- job state changed
  -> `sync.job.changed`

### chat mapping

- `chat.message.received`
  -> `chat.message.added`

- `chat.message.sent`
  -> `chat.message.updated`

- `chat.message.anchored`
  -> `chat.message.updated`

- `chat.handshake.succeeded`
  -> `chat.transport.changed`
  -> `chat.presence.changed`

- `chat.thread.read_marked`
  -> `chat.unread.changed`
  -> `chat.thread.upserted`

### wallet mapping

- wallet balance refresh done
  -> `wallet.balance.changed`

- wallet send lifecycle
  -> `wallet.send.changed`

### order mapping

- order projection updated
  -> `order.upserted`
  -> `order.status.changed` when state transition occurs

### catalog/profile mapping

- catalog commit complete
  -> `catalog.snapshot.changed`

- profile upsert complete
  -> `profile.snapshot.changed`

## 4. Frontend Module: `event_hub`

## 4.1 Purpose

`event_hub` is the only frontend module responsible for receiving normalized backend UI events and routing them to domain handlers.

It must never manipulate DOM directly.

## 4.2 Suggested Files

Add:
- `frontend/events/event_transport.js`
- `frontend/events/event_hub.js`
- `frontend/events/event_types.js`

## 4.3 `event_transport` Responsibilities

- open websocket
- send initial client hello/resume frame
- parse inbound websocket frames
- reconnect on disconnect
- pass only normalized `event` payloads into `event_hub`
- track last seen event id / seq

It must not:
- update stores directly
- contain domain business rules

## 4.4 `event_hub` Responsibilities

- validate incoming event envelope
- dedupe by `eventId`
- guard ordering by `seq`
- dispatch by exact `type`
- optionally dispatch by `domain`
- invoke registered handlers

It must not:
- touch DOM
- fetch fallback data by itself
- embed domain business decisions

## 4.5 Suggested `event_hub` Interface

```js
registerHandler(type, handler)
registerDomainHandler(domain, handler)
dispatch(event)
reset()
```

## 4.6 Suggested Internal State

```js
{
  lastSeq: 0,
  seenEventIds: Set,
  handlersByType: Map,
  handlersByDomain: Map
}
```

## 5. Frontend Domain Handlers

Each domain gets one handler module and one store module.

## 5.1 Sync Handler

Consumes:
- `sync.status.changed`
- `sync.phase.changed`
- `sync.window.finished`
- `sync.job.changed`

Updates:
- sync store

## 5.2 Chat Handler

Consumes:
- `chat.thread.upserted`
- `chat.message.added`
- `chat.message.updated`
- `chat.unread.changed`
- `chat.presence.changed`
- `chat.transport.changed`
- `chat.self_status.changed`

Updates:
- thread store
- message store
- unread store
- chat status store

## 5.3 Wallet Handler

Consumes:
- `wallet.session.changed`
- `wallet.balance.changed`
- `wallet.history.changed`
- `wallet.send.changed`
- `wallet.policy.changed`

Updates:
- wallet store

## 5.4 Order Handler

Consumes:
- `order.upserted`
- `order.status.changed`

Updates:
- order store

## 5.5 Catalog Handler

Consumes:
- `catalog.snapshot.changed`
- `catalog.product.upserted`
- `catalog.category.upserted`

Updates:
- catalog store

## 5.6 Profile Handler

Consumes:
- `profile.snapshot.changed`

Updates:
- profile store

## 6. Startup Sequence

Frontend startup:

1. request `GET /api/bootstrap`
2. initialize all stores
3. create `event_hub`
4. register all domain handlers
5. create `event_transport`
6. connect websocket
7. send client hello/resume info
8. process incoming UI events

## 7. Remove Polling Scope

For migrated screens, polling should be deleted from:
- sync status refresh path
- chat thread/unread periodic refresh path
- wallet live status refresh path
- order live status refresh path
- catalog/profile live display refresh path

Command-style HTTP requests remain:
- send chat message
- mark thread read
- pause/resume sync
- wallet actions
- order actions

## 8. V1 Implementation Notes

### 8.1 First Backend Iteration

The first backend iteration should ship:
- websocket endpoint
- bootstrap endpoint
- gateway replay buffer
- sync + chat event mapping first

Then add:
- wallet + order
- catalog + profile

### 8.2 First Frontend Iteration

The first frontend iteration should ship:
- event transport
- event hub
- sync store/handler
- chat store/handler

Then add:
- wallet/order handlers
- catalog/profile handlers

## 9. Open Implementation Questions

These implementation defaults are confirmed for V1:

1. Exact websocket route name:
   - `/api/ws`
2. Replay buffer size:
   - `2000` events initial default
3. Heartbeat interval:
   - `15s`
4. Sequence source:
   - dedicated frontend event seq in gateway, not raw internal event seq
5. Auth binding:
   - reuse existing session auth used by HTTP APIs
6. Event stream auth rule:
   - push channels must be authenticated
   - this applies equally to `WebSocket` and `SSE`
   - V1 websocket auth reuses existing session/cookie boundaries
