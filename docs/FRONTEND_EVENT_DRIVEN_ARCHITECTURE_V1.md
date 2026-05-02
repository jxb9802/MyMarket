# Frontend Event-Driven Architecture V1

Date: 2026-04-08
Workspace: `/home/jb9802/.openclaw/workspace/app/bsv_market`

## 1. Goal

Replace the current frontend polling model with an event-driven model.

Current problems:
- frontend actively refreshes multiple APIs
- different APIs return state from different moments
- UI is delayed under load
- chat/sync/runtime state is hard to express as live process state
- repeated polling adds avoidable load to the main process

V1 goal:
- backend pushes state changes to frontend
- frontend updates local stores from events
- UI renders from stores instead of periodic API polling
- frontend commands remain HTTP-based in V1

This design does not attempt to migrate every screen at once.

## 2. Core Principles

1. Frontend must have a unified event center.
2. Frontend event center must not directly operate DOM.
3. Frontend event center may only dispatch to registered handlers or update stores.
4. Backend must have a dedicated module for frontend event delivery.
5. Domain modules must not directly push browser events.
6. Backend and frontend communicate through stable UI event contracts, not internal domain event shapes.
7. Initial page load uses bootstrap snapshot; live updates use event stream.
8. Existing polling remains only as fallback during transition.

## 3. V1 Scope

### Included domains

V1 includes automatic push for these six domains:
- `sync`
- `chat`
- `wallet`
- `order`
- `catalog`
- `profile`

## 4. Backend Data That Should Be Auto-Pushed

### 4.1 Sync

Frontend needs live updates for:
- sync phase
- local height
- network height
- lag
- active job
- pending / claimed command counts
- current parallel block count
- current window result
- active sync nodes
- pause / resume / done / error transitions

### 4.2 Chat

Frontend needs live updates for:
- thread list changes
- new messages
- message delivery/anchor status changes
- unread count changes
- thread read state changes
- peer online / reachable / chatable state changes
- transport state changes
- self online / offline state changes

### 4.3 Wallet

Frontend needs live updates for:
- wallet session loaded / unloaded
- current wallet identity / wallet key change
- balance change
- recent history change
- send job progress/result
- wallet runtime policy change

### 4.4 Order

Frontend needs live updates for:
- order created
- order updated
- order status changed
- order-related chat summary changed

## 5. Backend V1 Design

## 5.1 New Module

Add:
- `frontend_event_gateway.js`

This module is the only backend component responsible for browser event delivery.

## 5.2 Responsibilities

`frontend_event_gateway` is responsible for:
- subscribing to internal bus/runtime events
- filtering frontend-relevant events
- converting internal events into stable UI events
- assigning event ids
- keeping a small replay buffer for reconnect
- broadcasting events to connected SSE clients
- building bootstrap snapshots
- sending heartbeat events

It must not:
- mutate domain state
- make business decisions
- directly own sync/chat/wallet/order logic
- directly access random private module internals when a domain getter exists

## 5.3 Backend Module Relationship

```text
domain modules
  -> internal bus/runtime events
  -> frontend_event_gateway
  -> SSE stream
  -> frontend event hub
  -> frontend domain handlers
  -> frontend stores
  -> UI
```

## 5.4 Backend HTTP / WebSocket Endpoints

V1 introduces:

1. `GET /api/bootstrap`
2. `GET /api/ws` or equivalent websocket upgrade route

Existing command endpoints stay as-is for now:
- sync pause/resume/now
- chat send/read/config
- wallet actions
- order actions

## 5.5 Bootstrap Endpoint

Purpose:
- initialize frontend stores once on page load
- recover from event stream desync

Suggested response:

```json
{
  "success": true,
  "serverTs": "2026-04-08T22:30:00.000Z",
  "bootstrapVersion": 1,
  "lastEventId": "evt-12345",
  "sync": {},
  "chat": {},
  "wallet": {},
  "order": {}
}
```

## 5.6 Event Stream Endpoint

Transport:
- WebSocket

Endpoint:
- single websocket connection for all frontend event domains

V1 websocket usage rules:
- websocket is used only for backend-to-frontend push
- frontend user commands remain on existing HTTP APIs
- one frontend session uses one shared websocket event stream
- all domain events flow through that one connection

## 5.7 Frontend UI Event Envelope

All browser-facing events should use one stable envelope:

```json
{
  "eventId": "evt-12346",
  "ts": "2026-04-08T22:31:00.000Z",
  "domain": "chat",
  "type": "chat.message.added",
  "entityId": "wallet-abc",
  "payload": {}
}
```

Required fields:
- `eventId`
- `ts`
- `domain`
- `type`
- `entityId`
- `payload`

Optional fields:
- `correlationId`
- `causationId`
- `schemaVersion`

## 5.8 V1 UI Event Types

### Sync
- `sync.status.changed`
- `sync.phase.changed`
- `sync.window.finished`
- `sync.job.changed`

### Chat
- `chat.thread.upserted`
- `chat.message.added`
- `chat.message.updated`
- `chat.unread.changed`
- `chat.presence.changed`
- `chat.transport.changed`
- `chat.self_status.changed`

### Wallet
- `wallet.session.changed`
- `wallet.balance.changed`
- `wallet.history.changed`
- `wallet.send.changed`
- `wallet.policy.changed`

### Order
- `order.upserted`
- `order.status.changed`

### Catalog / Profile
- `catalog.snapshot.changed`
- `catalog.product.upserted`
- `catalog.category.upserted`
- `profile.snapshot.changed`

### System
- `system.connection.heartbeat`
- `system.runtime.warning`

## 5.9 Replay and Reconnect

V1 should support:
- websocket heartbeat
- frontend reconnect
- backend replay by `Last-Event-ID` if still in buffer
- fallback to bootstrap re-sync if requested event is too old

Backend replay buffer can be memory-first in V1.

## 6. Frontend V1 Design

## 6.1 New Frontend Modules

Add:
- `event_transport`
- `event_hub`
- domain handlers
- domain stores

Suggested structure:

```text
frontend/
  events/
    event_transport.js
    event_hub.js
    event_types.js
  domains/
    sync/
      sync_store.js
      sync_handler.js
    chat/
      chat_store.js
      chat_handler.js
    wallet/
      wallet_store.js
      wallet_handler.js
      order/
        order_store.js
        order_handler.js
    catalog/
      catalog_store.js
      catalog_handler.js
    profile/
      profile_store.js
      profile_handler.js
```

## 6.2 `event_transport`

Responsibilities:
- open websocket connection
- parse raw websocket payloads
- reconnect when disconnected
- pass events to `event_hub`
- track `lastEventId`

It must not:
- apply business logic
- update UI directly

## 6.3 `event_hub`

Responsibilities:
- receive normalized events from transport
- validate event envelope
- dedupe by `eventId`
- route by `type` or `domain`
- call registered handlers

It must not:
- directly manipulate DOM
- contain domain business rules

Allowed operations:
- invoke registered handler
- call domain store update path

Suggested interface:

```js
subscribe(type, handler)
subscribeDomain(domain, handler)
dispatch(event)
```

## 6.4 Domain Handlers

Each domain handler:
- subscribes to its event types
- updates its domain store
- contains domain-specific mapping logic

Examples:
- `sync_handler` handles `sync.*`
- `chat_handler` handles `chat.*`
- `wallet_handler` handles `wallet.*`
- `order_handler` handles `order.*`

## 6.5 Domain Stores

Each store:
- holds frontend query state
- exposes getter/subscription methods for UI
- is updated only through handler/store actions

UI components must read from stores, not from websocket events directly.

## 7. Startup Flow

V1 startup flow:

1. frontend requests `GET /api/bootstrap`
2. frontend initializes stores from bootstrap payload
3. frontend registers all domain handlers with `event_hub`
4. frontend opens websocket event stream
5. backend pushes events
6. `event_transport` receives events
7. `event_hub` dispatches events
8. domain handlers update stores
9. UI re-renders from store state

## 8. Failure Strategy

V1 removes the current polling path for migrated screens.

Recommended behavior:
- if websocket disconnects, frontend shows degraded connection state
- frontend attempts reconnect
- after reconnect, frontend replays missed events or refreshes bootstrap
- migrated screens do not resume periodic polling

## 9. Domain-Specific Notes

## 9.1 Chat

This design must support the already-confirmed chat direction:
- on-chain chat and P2P chat coexist
- chat remains a fully independent module
- chat communicates with other modules only through bus contracts
- online/offline status changes are broadcast-capable
- offline state disables P2P listening/monitoring
- offline state does not disable on-chain chat reading/sync

Suggested chat bootstrap state:
- self chat identity
- thread list
- unread total
- recent active thread summaries
- self online/offline state

## 9.2 Sync

Sync is the first migration target because:
- it currently depends heavily on active refresh
- it already has runtime summary concepts
- it benefits immediately from event-driven UI

## 9.3 Catalog / Profile

Catalog and profile are included in V1 because:
- current page initialization already depends on them
- product/category/profile changes need to stay visible without manual refresh
- frontend bootstrap must continue to display the same visible data as current pages

## 10. V1 Implementation Order

1. Add `frontend_event_gateway`
2. Add `GET /api/bootstrap`
3. Add websocket event endpoint
4. Add frontend `event_transport`
5. Add frontend `event_hub`
6. Migrate sync UI to event-driven updates
7. Migrate chat UI to event-driven updates
8. Migrate wallet, order, catalog, and profile UI
9. Remove polling from migrated screens

## 11. V1 Non-Goals

V1 does not include:
- full websocket command protocol
- replacement of frontend command HTTP APIs
- full chat-domain redesign implementation
- complete runtime diagnostics streaming
- direct event exposure of every internal domain event

## 12. Required Confirmations

The following items were confirmed for V1:

1. Transport is `WebSocket`.
2. WebSocket is push-only in V1; frontend commands remain HTTP-based.
3. Event delivery uses one shared websocket connection for all domains.
4. V1 event-driven domains are `sync`, `chat`, `wallet`, `order`, `catalog`, and `profile`.
5. Bootstrap response must preserve current page-visible initialization data.
6. Replay buffer may be in-memory only for V1.
7. Frontend stores become the only live UI state source for migrated screens.
8. Polling is removed from migrated screens instead of kept as fallback.
9. Websocket route is `/api/ws`.
10. Replay buffer default is `2000` events.
11. Heartbeat interval default is `15s`.
12. Frontend event `seq` is generated by `frontend_event_gateway`.
13. Websocket auth reuses existing session/cookie auth; push channels are not unauthenticated.
