# Trade Execution Plan 2026-04-23

## Goal

Push the product/order module to a testable state in one pass:

- seller catalog is stable across login/refresh/publish
- buyer browsing flows are stable
- product image flow is usable
- order main path is testable end to end
- `trade_service` stops being read-only scaffolding and starts owning trade APIs

## Completed Before This Plan

- Fixed Windows seller page blank-after-login caused by missing static asset allowlist.
- Fixed frontend state overwrite path that could clear catalog/order arrays after bootstrap.
- Added login-time bootstrap repair for `catalog,order`.
- Verified via rendered browser session against `192.168.2.10:8091`.

## Remaining Work

### P0 Stabilization

1. Keep seller catalog stable after:
   - add category
   - add product
   - refresh
   - publish
   - relogin
2. Keep buyer product list stable after:
   - search
   - category switch
   - merchant switch
   - sync refresh

### P1 Product UX

1. Product image file selection:
   - thumbnail generation
   - preview
   - backend validation
2. Product cards:
   - fixed-size tile layout
   - image-first display
   - no blank description rows

### P1 Order Flow

1. Validate end-to-end path:
   - place
   - accept/ship
   - confirm
2. Align UI state labels with current protocol path.
3. Make order timeline visible and readable from buyer/seller views.

### P2 Service Split

1. Expand `trade_service` from query-only shell into:
   - catalog query routes
   - order query routes
   - catalog command routes
   - order command routes
2. Route frontend product/order operations through `tradeClient`.
3. Reduce direct dependence on monolithic market routes.

## Implementation Order

1. Stabilize frontend state and static asset loading.
2. Finish product image flow.
3. Verify seller/buyer catalog behavior on Linux + Windows.
4. Move first write APIs into `trade_service`.
5. Validate order main path again across nodes.

## Acceptance

- Windows and Linux show same seller catalog after refresh/login.
- Product image can be selected, previewed, saved, and displayed in list cards.
- Buyer can browse by category and merchant without empty-state regressions.
- Linux place -> Windows seller action -> Linux buyer state change remains visible in UI.
