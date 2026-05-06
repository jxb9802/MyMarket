# ORDER_PROTOCOL_V3

## Goal

This protocol is designed for the BSV Market order flow where buyer and seller are usually not on the same network and may not be online at the same time.

After an order is created, either party only needs to connect their wallet and scan chain data to continue the order. All order conditions, state transitions, and cross-party signatures required to finish or cancel the trade must be recoverable from chain events.

The protocol must stay small enough for OP_RETURN use. Chain payloads use short field names and deterministic local reconstruction instead of raw transaction templates.

## Non-Negotiable Rules

1. Chain data is the transport.
2. `order_place` is the immutable order root.
3. Later events only add new facts or signatures.
4. No chain event may require hidden local state from the other party.
5. No raw transaction template is stored on chain.
6. Scripts and settlement transactions are reconstructed deterministically from compact fields.
7. Every reconstructed script is checked against an on-chain hash before use.
8. Every final settlement txid is verified against the deterministic settlement rule before state advances.
9. A party can publish its signature package on chain while the other party is offline.
10. State is derived by replaying chain events, not by trusting local optimistic UI state.
11. Every non-funding state event must carry an actor signature over the canonical event payload.
12. Funding events must be anchored in the same transaction that creates the referenced lock output.
13. Signature packages are valid only for a named template id and exact template hash.

## State Machine

Canonical states:

- `PLACED`
- `ACCEPTED`
- `SHIPPED`
- `COMPLETED`
- `REFUND_REQUESTED`
- `REFUNDED`
- `CANCELED`
- `TIMED_OUT`
- `DISPUTED`

Legal transitions:

- `PLACED -> ACCEPTED`
- `PLACED -> CANCELED`
- `PLACED -> TIMED_OUT`
- `ACCEPTED -> SHIPPED`
- `ACCEPTED -> CANCELED`
- `SHIPPED -> COMPLETED`
- `SHIPPED -> REFUND_REQUESTED`
- `SHIPPED -> DISPUTED`
- `REFUND_REQUESTED -> REFUNDED`
- `REFUND_REQUESTED -> DISPUTED`
- `DISPUTED -> COMPLETED`
- `DISPUTED -> REFUNDED`

Terminal states:

- `COMPLETED`
- `REFUNDED`
- `CANCELED`
- `TIMED_OUT`

`DISPUTED` is not terminal. It freezes automatic progress until both sides publish compatible settlement signatures.

## Money Rules

Protocol defaults:

- buyer deposit: `20%` of product price
- seller deposit: `10%` of product price
- seller deposit minimum: configured dust-safe minimum, default `1000 sat`

For a price `ps`:

- `bd = floor(ps * 2000 / 10000)`
- `sd = max(MIN_SELLER_DEPOSIT_SATS, floor(ps * 1000 / 10000))`
- buyer lock amount `bs = ps + bd`
- seller lock amount `ss = sd`

`sd` is the seller penalty deposit. `ss` is the total seller escrow output and does not include the product amount; seller product income is paid from the buyer lock on completion.

Completion settlement:

- seller receives `ps`
- buyer receives `bd`
- seller receives `ss`

Refund settlement:

- buyer receives `bs + ps`
- seller receives `sd`

Dispute:

- funds remain locked in 2-of-2 scripts until both sides publish compatible signatures for a later completion or refund settlement.

Cancellation after seller acceptance:

- Once `order_accept` is valid, cancellation uses the same deterministic refund settlement as the refund flow.
- The initiating party publishes `order_cancel_request` with its refund-settlement signature package.
- The other party later adds its signature, broadcasts the refund settlement, and writes `order_cancel_confirm`.
- State becomes `CANCELED`.

Seller cancellation before acceptance:

- The default safe path is request-only: seller writes `order_seller_cancel_request`; buyer wallet later broadcasts `order_cancel_before_accept`.
- Optional seller-completes-cancel mode is allowed only if `order_place` includes `cg` and the implementation can validate the exact cancel template before broadcast.
- Implementations may disable optional seller-completes-cancel mode by policy without violating v3 core compatibility.

## Scripts

### Buyer Lock Script

The buyer lock script locks `ps + bd`.

It must support:

- cooperative 2-of-2 spend by buyer and seller
- buyer cancel before seller acceptance
- timeout cancel by buyer after `to`
- optional seller cancel before acceptance only if the script guarantees refund output to buyer

The script is reconstructed from:

- buyer pubkey `bp`
- seller pubkey `sp`
- buyer refund address `br`
- timeout `to`
- order root txid `pt`
- buyer lock amount `bs`

The script hash is stored as `bh`.

The preferred v3 core implementation does not rely on a seller-only script branch for pre-accept seller cancellation. Instead, seller writes `order_seller_cancel_request` and buyer wallet later performs the refund when online.

An optional acceleration mode lets buyer publish a pre-signed seller-cancel signature package in `order_place` as `cg`. This package signs the deterministic pre-accept cancel template, whose only protocol output is the buyer refund address `br`. This mode is not required for v3 core compatibility.

If a seller-only branch is implemented later, it must be proven by tests to be non-malleable with respect to refund output address and amount. Until then, seller cancellation before acceptance uses the request-only flow by default; implementations that enable optional acceleration may use `cg`.

### Seller Lock Script

The seller lock script locks `ss`, where `ss = sd`.

It is a 2-of-2 buyer/seller settlement script reconstructed from:

- buyer pubkey `bp`
- seller pubkey `sp`
- seller refund address `sf`
- seller receive address `sr`
- order root txid `pt`

The script hash is stored as `sh`.

### Signature Hash Policy

Settlement signatures must sign deterministic settlement templates.

The protocol must specify and test the exact sighash mode for:

- completion settlement signatures
- refund settlement signatures
- cancel signatures
- dispute resolution signatures

Required default:

- deterministic final settlements use `SIGHASH_ALL | FORKID`
- async settlement signature packages use the same deterministic template hash and `SIGHASH_ALL | FORKID`
- optional pre-accept seller-cancel package `cg` may use `SIGHASH_SINGLE | ANYONECANPAY | FORKID` only for the deterministic cancel template with fixed refund output position; implementation must verify the refund output before accepting the package
- arbitrary `ANYONECANPAY` signatures are invalid unless their package type explicitly permits them

Template id domain separation:

- completed settlement template id: `bsvmkt:v3:settle:completed:<pt>`
- refund settlement template id: `bsvmkt:v3:settle:refunded:<pt>`
- post-accept cancel template id: `bsvmkt:v3:settle:cancel:<pt>`
- dispute settlement template id: `bsvmkt:v3:settle:dispute:<mode>:<pt>`
- optional pre-accept seller cancel template id: `bsvmkt:v3:cancel:preaccept:seller:<pt>`

The template id is included in every signature package as `tid` and in every template hash preimage.

## Deterministic Templates

All parties must reconstruct the same unsigned transaction for each template.

### Input Order

Completion/refund settlement input order:

1. buyer lock input: `pt:bv`
2. seller lock input: `sx:sv`
3. optional fee inputs controlled by the broadcaster

### Output Order: Completed

1. seller receive output: `sr`, amount `ps`
2. buyer refund output: `br`, amount `bd`
3. seller refund output: `sf`, amount `ss`
4. optional broadcaster change output

### Output Order: Refunded

1. buyer refund output: `br`, amount `bs + ps`
2. seller refund output: `sf`, amount `sd`
3. optional broadcaster change output

### Pre-Accept Cancel Template

Input order:

1. buyer lock input: `pt:bv`
2. optional seller fee inputs controlled by the cancelling seller

Output order:

1. buyer refund output: `br`, amount `bs`
2. optional seller change output

The seller pays miner fees from seller wallet fee inputs. Buyer escrow output amount remains exact.

### Timeout Rule

`to` is a block height, not a wall-clock timestamp.

Buyer timeout cancel is valid only when the spending transaction has `nLockTime >= to` and the input sequence is non-final.

The buyer lock script must enforce timeout with `OP_CHECKLOCKTIMEVERIFY` or an equivalent consensus-valid locktime construction. Application-only timeout checks are not sufficient for v3 compliance.

### Fee Rule

Required rule:

- The final broadcaster pays miner fees using its own wallet fee inputs.
- Escrow amounts stay exact.
- Settlement, refund, cancel, and dispute-resolution outputs must not deduct protocol funds for fees.
- If the broadcaster has no fee inputs, the action waits until the broadcaster wallet has spendable fee funds.
- This rule keeps async signature packages stable and prevents fee-based output substitution attacks.

## Chain Envelope

All events use:

```text
BMMKT2|<eventType>|<json>
```

Payload JSON uses compact field names.

Field values are strings or integers. Binary data is hex unless specified otherwise.

### Event Authentication

Every event except `order_place` must include:

- `ap`: actor pubkey hex
- `ar`: actor role, `buyer` or `seller`
- `es`: actor signature over the canonical payload hash

The canonical payload hash excludes `es`.

`order_place` is authenticated by the buyer lock transaction itself and by the buyer pubkey `bp` embedded in the buyer lock script. It may still include `ap/ar/es` for uniformity, but replay validation must not depend on local session state.

Validation:

- `ap` must match `bp` when `ar=buyer`
- `ap` must match `sp` when `ar=seller`
- `es` must verify against the canonical event hash
- event txid must be unique for that `pt/eventType/ap`

### Funding Event Binding

Funding events must be in the transaction that creates the lock output they reference:

- `order_place` must be in `pt`, and `pt:bv` must be the buyer lock output.
- `order_accept` must be in `sx`, and `sx:sv` must be the seller lock output.

State-only events may use separate anchor transactions, but they must be actor-signed.

## Events

### `order_place`

Root order event. It is written in the buyer lock transaction.

```json
{
  "v": 3,
  "sm": "sellerMerchantId",
  "pid": "productId",
  "pv": 1,
  "q": 1,
  "ps": 10000,
  "bd": 2000,
  "sd": 1000,
  "bp": "buyerPubKeyHex",
  "sp": "sellerPubKeyHex",
  "br": "buyerRefundAddress",
  "bv": 0,
  "bs": 12000,
  "bh": "sha256(buyerLockScriptHex)",
  "jh": "sha256(jointSettlementScriptHex)",
  "cg": "optionalBuyerPreAcceptSellerCancelSignaturePackageHex",
  "to": 1770000000
}
```

Derived values:

- order id: `order:<placeTxid>`
- place txid `pt`: envelope transaction id
- buyer lock outpoint: `pt:bv`

Validation:

- `bs == ps + bd`
- `bd` matches buyer deposit policy
- `sd` matches seller deposit policy
- product snapshot matches `pid/pv/q/ps`
- reconstructed buyer lock script hash equals `bh`
- reconstructed joint script hash equals `jh`
- if present, `cg` verifies against the deterministic pre-accept seller-cancel template

### `order_accept`

Seller accepts the order and locks seller escrow (`ss = sd`).

```json
{
  "v": 3,
  "pt": "placeTxid",
  "sx": "sellerLockTxid",
  "sv": 0,
  "ss": 11000,
  "sh": "sha256(sellerLockScriptHex)",
  "sr": "sellerReceiveAddress",
  "sf": "sellerRefundAddress",
  "ap": "sellerPubKeyHex",
  "ar": "seller",
  "es": "eventSignatureHex"
}
```

Validation:

- referenced `pt` has valid `order_place`
- `ss == ps + sd`
- seller lock output exists at `sx:sv`
- reconstructed seller lock script hash equals `sh`
- actor pubkey matches seller pubkey `sp`
- event is embedded in seller lock transaction `sx`

### `order_ship`

Seller marks shipped and publishes the seller-side signature package for completion.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "sx": "sellerLockTxid",
  "sg": "sellerSignedCompletedSettlementRawtxHex",
  "ap": "sellerPubKeyHex",
  "ar": "seller",
  "es": "eventSignatureHex"
}
```

Validation:

- order is `ACCEPTED`
- `sx` matches accepted seller lock txid
- `sg` verifies against the deterministic completed settlement template
- `sg` spends both buyer lock and seller lock, pays seller goods amount from the buyer lock, refunds buyer deposit, and returns seller deposit `ss`
- any fee inputs/change in `sg` are prepared and signed by the seller at ship time, so the buyer can complete while the seller is offline

Buyer completion path:

1. scan `order_place`, `order_accept`, `order_ship`
2. validate seller-signed completed settlement rawtx `sg`
3. add buyer signatures to the buyer lock and seller lock inputs
4. broadcast settlement
5. write `order_confirm`

### `order_confirm`

Buyer confirms receipt by broadcasting the completed settlement tx and anchoring the txid.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "fx": "completedSettlementTxid",
  "ap": "buyerPubKeyHex",
  "ar": "buyer",
  "es": "eventSignatureHex"
}
```

Validation:

- `fx` spends `pt:bv` and `sx:sv`
- outputs match completed settlement rule
- state becomes `COMPLETED`

### `order_refund_request`

Buyer requests refund and publishes buyer-side signature package for refund settlement.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "bg": "buyerRefundSettlementSignaturePackageHex",
  "rr": "reasonCode",
  "ap": "buyerPubKeyHex",
  "ar": "buyer",
  "es": "eventSignatureHex"
}
```

Validation:

- order is `SHIPPED` or `DISPUTED`
- `bg` verifies against deterministic refund settlement template
- state becomes `REFUND_REQUESTED`

Seller refund path:

1. scan `order_refund_request`
2. reconstruct refund settlement template
3. validate buyer signature package `bg`
4. add seller signatures
5. broadcast refund settlement
6. write `order_refund_confirm`

### `order_refund_confirm`

Seller confirms refund by broadcasting refund settlement.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "fx": "refundSettlementTxid",
  "ap": "sellerPubKeyHex",
  "ar": "seller",
  "es": "eventSignatureHex"
}
```

Validation:

- `fx` spends `pt:bv` and `sx:sv`
- outputs match refund settlement rule
- state becomes `REFUNDED`

### `order_cancel_before_accept`

Buyer cancels before seller acceptance.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "cx": "cancelTxid",
  "ap": "buyerPubKeyHex",
  "ar": "buyer",
  "es": "eventSignatureHex"
}
```

Validation:

- order is still `PLACED`
- no valid earlier `order_accept`
- `cx` spends buyer lock outpoint and refunds buyer according to cancel rule
- state becomes `CANCELED`

### `order_seller_cancel_request`

Seller requests cancellation before acceptance and may complete it using the buyer pre-signed cancel package `cg`.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "cr": "sellerCancelReasonCode",
  "cx": "optionalCancelTxid",
  "ap": "sellerPubKeyHex",
  "ar": "seller",
  "es": "eventSignatureHex"
}
```

Validation:

- order is `PLACED`
- actor is seller
- if `cx` is present, `order_place.cg` must exist, `cx` must spend buyer lock outpoint, use `cg`, and refund exactly `bs` to `br`

Buyer wallet behavior:

- If `cx` is absent and buyer wallet later sees this event while order is still `PLACED`, it may auto-build and broadcast `order_cancel_before_accept`.

Seller wallet behavior:

- If `cg` is valid and seller has fee inputs, seller may build and broadcast the deterministic pre-accept cancel tx and include `cx`.

### `order_cancel_request`

Either party requests cancellation after seller acceptance. This is a refund-settlement signature publication event.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "by": "buyer|seller",
  "cg": "cancelRefundSettlementSignaturePackageHex",
  "cr": "cancelReasonCode",
  "ap": "actorPubKeyHex",
  "ar": "buyer|seller",
  "es": "eventSignatureHex"
}
```

Validation:

- order is `ACCEPTED`, `SHIPPED`, or `DISPUTED`
- `cg` verifies against deterministic refunded settlement template
- actor matches `by`
- state remains current but records a pending cancellation signature package

### `order_cancel_confirm`

The counterparty confirms cancellation by broadcasting the refund settlement.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "fx": "cancelRefundSettlementTxid",
  "ap": "counterpartyPubKeyHex",
  "ar": "buyer|seller",
  "es": "eventSignatureHex"
}
```

Validation:

- there is a valid earlier `order_cancel_request`
- `fx` spends `pt:bv` and `sx:sv`
- outputs match refund settlement rule
- state becomes `CANCELED`

### `order_timeout_cancel`

Buyer cancels after timeout if seller did not accept.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "cx": "timeoutCancelTxid",
  "ap": "buyerPubKeyHex",
  "ar": "buyer",
  "es": "eventSignatureHex"
}
```

Validation:

- current chain time/height satisfies `to`
- no valid earlier `order_accept`
- `cx` spends buyer lock and refunds buyer
- state becomes `TIMED_OUT`

### `order_dispute_lock`

Either side marks dispute.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "dr": "reasonCode",
  "ap": "actorPubKeyHex",
  "ar": "buyer|seller",
  "es": "eventSignatureHex"
}
```

Validation:

- order is `SHIPPED` or `REFUND_REQUESTED`
- actor is buyer or seller
- state becomes `DISPUTED`
- funds remain locked

### `order_dispute_settle`

Both sides resolve a dispute by publishing a final compatible settlement tx.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "mode": "completed|refunded",
  "fx": "settlementTxid",
  "ap": "actorPubKeyHex",
  "ar": "buyer|seller",
  "es": "eventSignatureHex"
}
```

Validation:

- order is `DISPUTED`
- `fx` spends the expected lock outpoints
- outputs match `mode`
- state becomes `COMPLETED` or `REFUNDED`

### `order_chat_msg`

Order-bound encrypted message.

```json
{
  "v": 3,
  "pt": "placeTxid",
  "seq": 1,
  "snd": "senderPubKeyHex",
  "ct": "cipherHex",
  "nn": "nonceHex",
  "cs": "cipherSuite",
  "ap": "senderPubKeyHex",
  "ar": "buyer|seller",
  "es": "eventSignatureHex"
}
```

Validation:

- sender is buyer or seller
- sequence is monotonic per sender
- duplicate message ids are ignored

## Signature Packages

Signature package payloads must be compact and canonical.

Recommended encoded form:

```json
{
  "v": 3,
  "tid": "templateId",
  "t": "completed|refunded",
  "si": [0, 1],
  "sg": ["sigHexForInput0", "sigHexForInput1"],
  "ht": "templateHash"
}
```

Before putting it on chain:

1. Serialize canonical JSON with sorted keys.
2. Hex encode the UTF-8 bytes.
3. Store as `sg` or `bg`.

`templateHash` is the sha256 hash of the deterministic unsigned template excluding signatures.

Validation:

- package type matches event
- template id matches the event and order
- input indexes match protocol
- each signature validates against the deterministic template
- template hash equals local reconstruction

Canonical serialization:

- JSON object keys are sorted lexicographically at every level.
- No whitespace outside string values.
- Integers are base-10 JSON numbers.
- Hex strings are lowercase.
- Unknown fields invalidate signature packages unless the package type version explicitly allows extensions.

If size becomes too large for OP_RETURN policy:

- split into `order_sig_part` events keyed by `pt`, `kind`, `part`, `total`, `hash`
- state cannot advance until all parts are present and hash verifies

`order_sig_part` payload:

```json
{
  "v": 3,
  "pt": "placeTxid",
  "k": "ship_completed|refund|cancel|dispute",
  "p": 0,
  "n": 2,
  "h": "sha256(fullSignaturePackageHex)",
  "d": "partHex",
  "ap": "actorPubKeyHex",
  "ar": "buyer|seller",
  "es": "eventSignatureHex"
}
```

Validation:

- all parts `0..n-1` are present exactly once
- concatenated `d` hashes to `h`
- `n` is at or below protocol maximum
- total reconstructed bytes are at or below protocol maximum
- state cannot advance from partial packages
- every part must be signed by the same actor pubkey and role

Hard limits:

- maximum signature package bytes: `2048`
- maximum split parts: `8`
- maximum part bytes: `300`
- maximum pending split packages per order: `4`
- unknown or over-limit split packages are ignored and may be pruned

## Functional Completeness Matrix

| Function | Protocol support |
|---|---|
| Buyer places order | `order_place` plus buyer lock tx |
| Seller reconstructs order from chain | `order_place` fields and script hashes |
| Seller accepts | `order_accept` plus seller lock tx |
| Seller cancels before accept | `order_seller_cancel_request`, or safe seller-cancel branch if proven |
| Buyer cancels before accept | `order_cancel_before_accept` |
| Either party cancels after accept | `order_cancel_request` plus `order_cancel_confirm` refund settlement |
| Timeout cancel | `order_timeout_cancel` |
| Seller ships | `order_ship` plus completed settlement seller signatures |
| Buyer confirms receipt while seller offline | uses `order_ship.sg`, then writes `order_confirm` |
| Buyer requests refund while seller offline | `order_refund_request.bg` |
| Seller confirms refund while buyer offline | uses `order_refund_request.bg`, then writes `order_refund_confirm` |
| Dispute freeze | `order_dispute_lock` |
| Dispute resolution | `order_dispute_settle` |
| Order chat | `order_chat_msg` |
| New device recovery | replay all order events from chain |
| Third-party audit | verify txids, scripts, hashes, signatures, output rules |

## Implementation Requirements

1. Add an order protocol module that owns field names, canonical serialization, script reconstruction, template reconstruction, and validation.
2. Update seller deposit policy to 10% unless overridden by explicit protocol config, and lock `ps + sd` as seller escrow.
3. Move current order payload from `v:2` to `v:3`.
4. Add `jh` to `order_place`.
5. Add mandatory script-hash validation during order replay.
6. Add `order_ship.sg` seller-signed completed settlement generation and validation.
7. Add `order_refund_request.bg` signature package generation and validation.
8. Add `DISPUTED` state and legal transitions.
9. Add tests for deterministic template hashes.
10. Add tests proving offline completion and offline refund from chain events only.
11. Add tests proving seller pre-accept cancellation from `order_place.cg`.
12. Add tests proving post-accept cancellation from `order_cancel_request`.
13. Add tests proving CLTV timeout enforcement.
14. Add tests proving fee inputs cannot alter escrow outputs.

## Compatibility

Existing `v:2` orders may be displayed and canceled if possible, but they are not considered fully compatible with this protocol.

Only `v:3` orders satisfy the design goal: after order creation, both sides can complete confirmation or cancellation by connecting their wallets and reading chain data, without direct network connectivity between buyer and seller.
