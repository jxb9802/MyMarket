# Pure P2P Chat Redesign

Date: 2026-04-17

## Problem

Current "p2p" chat is not true peer-to-peer transport.

Today these operations still go over direct HTTP to the peer's service endpoint:

- `/api/chat/p2p/hello`
- `/api/chat/p2p/message`
- `/api/chat/p2p/disconnect`
- `/api/chat/p2p/ping`
- `deliverDirectChatMessage(...)`

That means the current system is really:

- encrypted application payload
- over peer HTTP reachability

This is not a true punched-through peer session. If two peers cannot directly reach each other's HTTP service, the current "p2p" path is invalid.

## Relevant Standards / Primary Sources

The redesign should follow the standard NAT traversal stack instead of ad hoc HTTP control calls.

Primary sources:

- RFC 8445, ICE: <https://www.rfc-editor.org/rfc/rfc8445>
- RFC 8489, STUN: <https://www.rfc-editor.org/rfc/rfc8489.html>
- RFC 8656, TURN: <https://www.rfc-editor.org/rfc/rfc8656>
- RFC 8831, WebRTC Data Channels: <https://www.rfc-editor.org/rfc/rfc8831.html>
- RFC 8832, WebRTC Data Channel Establishment Protocol: <https://www.rfc-editor.org/rfc/rfc8832.html>
- RFC 8835, WebRTC Transports: <https://www.rfc-editor.org/rfc/rfc8835>
- libp2p hole punching / relay docs: <https://docs.libp2p.io/>

Key takeaways from the standards:

- STUN alone is not enough for NAT traversal.
- ICE is the connectivity-check framework that decides the best working candidate pair.
- TURN is required as relay fallback when direct traversal fails.
- For browser-style peer data transport, WebRTC data channels run on:
  - SCTP
  - over DTLS
  - over ICE/UDP

## Design Goal

Split chat networking into:

- signaling plane
- data plane
- persistence plane

### Hard Rule

Chat payload, heartbeats, disconnects, and status updates must not use peer HTTP endpoints.

Peer HTTP may exist only for:

- local app API
- optional bootstrap diagnostics

It must not be the chat transport.

## Recommended Architecture

### 1. Signaling Plane

Use the existing steward concept only as a signaling broker.

Its job becomes:

- exchange SDP / ICE offer-answer data
- exchange trickle ICE candidates
- distribute TURN credentials if needed
- notify connect intent
- notify reconnect intent

It must not carry:

- chat message payload
- disconnect payload
- heartbeat payload

Signaling can be:

- steward subprocess to server
- server to remote steward
- or a lightweight relay/signal service

But only for session setup.

### 2. Data Plane

Real transport should be a persistent peer channel:

- preferred: WebRTC data channel
- fallback: TURN-relayed WebRTC data channel
- final business fallback: on-chain message

Per peer, create one connection object:

- `peerConnection`
- `controlChannel`
- `messageChannel`
- runtime state

Recommended channels:

- `control`
  - ordered, reliable
  - session open / close
  - ack
  - explicit disconnect
  - capability sync
- `message`
  - ordered, reliable
  - chat payload
  - message ack
  - delivery receipts
- optional `presence`
  - unordered, unreliable
  - heartbeat / liveness only

### 3. Persistence Plane

Persistence remains local:

- append message to local DB
- maintain unread / summary / thread cache

No network transport decision should depend on DB rebuild.

## Session Model

Each peer has one runtime object in the chat worker:

- `walletId`
- `sessionId`
- `transport`
- `iceState`
- `dtlsState`
- `channelState`
- `connected`
- `closing`
- `manuallyDisconnected`
- `lastHeartbeatAt`
- `lastMessageAt`
- `pendingAcks`

This object is the connection truth.

Main process should not hold this state.

## Correct Message Flow

### Connect

1. User clicks connect.
2. Local chat worker creates peer session.
3. Signaling exchanges SDP/ICE through steward.
4. ICE checks run.
5. Data channel opens.
6. Chat worker marks session `connected`.
7. Frontend gets `chat.status.updated`.

### Send

1. Frontend appends pending local message immediately.
2. Chat worker sends encrypted payload on `messageChannel`.
3. Remote worker receives on data channel.
4. Remote worker decrypts, persists, emits append event.
5. Remote worker sends delivery ack on `controlChannel`.
6. Local worker reconciles pending local message.

No peer HTTP call is involved.

### Disconnect

1. Local worker marks `manuallyDisconnected = true`.
2. Local worker sends `disconnect` control frame on `controlChannel`.
3. Remote worker receives the frame and marks disconnected locally.
4. Both sides close the peer connection.
5. Both sides emit `chat.status.updated`.

If the control frame is not delivered:

- ICE / channel close event still transitions to disconnected.

No peer HTTP disconnect endpoint is needed.

### Heartbeat

Heartbeat goes only on channel:

- lightweight ping/pong frame on `presence` or `control`
- update `lastHeartbeatAt`
- if timeout exceeded, session becomes disconnected

No DB write.
No HTTP ping.
No projection rebuild.

## Deletion / Replacement Scope

The following pieces should be removed from the chat data plane:

- `/api/chat/p2p/ping`
- `/api/chat/p2p/hello`
- `/api/chat/p2p/message`
- `/api/chat/p2p/disconnect`
- HTTP-based `deliverDirectChatMessage(...)`
- HTTP keepalive in `chat_steward_subprocess.js`

They should be replaced with:

- signaling handlers:
  - `chat.signal.offer`
  - `chat.signal.answer`
  - `chat.signal.ice_candidate`
- worker-side peer transport runtime
- data-channel frame handlers

## Encryption Model

Keep message encryption end-to-end at the application layer if desired.

Recommended model:

- retain current wallet-based message envelope encryption for message body
- transport channel also uses DTLS because WebRTC already does

That gives:

- transport security from DTLS
- app-level payload security from existing chat envelope encryption

## State Machine

Per peer:

- `idle`
- `signaling`
- `checking`
- `connected`
- `degraded`
- `closing`
- `disconnected`
- `fallback_onchain`

Only these transitions should emit status updates.

Heartbeats must not emit state changes unless timeout is crossed.

## Relay Policy

True P2P for this system does not require public nodes to forward chat data.

Correct policy:

- first try direct ICE candidate pair
- use public STUN/signaling nodes only for discovery, address probing, and handshake exchange
- if direct traversal still fails, fallback to on-chain

TURN/relay data forwarding is disabled by default because it consumes public-node traffic.

## Public Node Auto Role

Nodes with a globally routable public IP should automatically become P2P infrastructure candidates.

At startup, each node must determine whether its externally observed IP is a global public IP. The detector must reject loopback, private LAN, link-local, carrier-grade NAT, multicast, documentation, reserved, and otherwise non-global ranges.

If the node has a global public IP and the operator has not disabled this behavior, it should automatically start:

- signaling / rendezvous service
- STUN binding service
- public reachability self-check
- signed capability announcement

It must not start TURN/relay data forwarding by default.

The announcement must include:

- `nodeId`
- `publicIp`
- `signalEndpoint`
- `stunEndpoint`
- `capabilities`
- `timestamp`
- `expiresAt`
- `signature`

Non-public nodes must not announce TURN/relay capability, but they should consume verified public-node announcements as ICE/STUN candidates.

Example: a node such as `8.136.3.174` should become a signaling + STUN candidate only after public-IP detection and reachability self-check pass. A public IP alone is not enough; the service must be running and externally reachable.

## Migration Plan

### Phase 1: Build True P2P Side-by-Side

Add new modules:

- `chat_signal_service.js`
- `chat_peer_transport_runtime.js`
- `chat_webrtc_transport.js`
- `chat_channel_protocol.js`
- `chat_delivery_ack_runtime.js`

Keep old HTTP pseudo-p2p temporarily behind a feature flag.

### Phase 2: Move Connect / Disconnect / Heartbeat

Switch these first:

- connect
- disconnect
- heartbeat
- status

These should run purely on session/channel state.

### Phase 3: Move Message Delivery

Replace `deliverDirectChatMessage(...)` with channel send.

Then remote ingress happens only from transport channel frames, not HTTP route handlers.

### Phase 4: Remove Peer HTTP P2P Routes

Delete:

- `/api/chat/p2p/ping`
- `/api/chat/p2p/hello`
- `/api/chat/p2p/message`
- `/api/chat/p2p/disconnect`

After this point, peer HTTP is no longer part of chat transport.

## Recommended Implementation Choice

For this codebase, the cleanest path is:

- WebRTC data channels for transport
- ICE/STUN/TURN for NAT traversal
- steward as signaling only

Reason:

- directly matches IETF standards
- gives reliable ordered message channels
- supports heartbeat / disconnect control frames naturally
- avoids inventing a custom NAT traversal stack

libp2p remains a viable alternative, but it would be a larger runtime substitution. WebRTC data channels map more directly to "two peers exchanging chat messages over a session".

## Acceptance Criteria

The redesign is only complete when all are true:

- chat messages are not delivered by peer HTTP
- disconnect is not delivered by peer HTTP
- heartbeat is not delivered by peer HTTP
- status is derived from peer channel state
- peer HTTP endpoint unreachability does not invalidate an already-established direct session
- NAT traversal uses ICE
- direct failure uses TURN relay or on-chain fallback

## Practical Note

Do not hard-delete the current code before the new transport runtime is in place.

Correct execution order:

1. build the new transport
2. route connect/disconnect/heartbeat through it
3. route message delivery through it
4. verify Linux/Windows direct sessions
5. delete the old HTTP pseudo-p2p path

Deleting first would break chat before replacement exists.
