# TX Context Backfill - 2026-04-24

## Trigger

User requested checking which `tx_contexts` were missing and downloading them first.

## Initial Gap

Direct first-pass scan of `tx_contexts.input_txids_json` against local `tx_contexts.txid` found:

- local tx_context rows: `174`
- direct missing parent txids: `19`

## Backfill Action

Used WOC rawtx endpoints to download missing parent transactions and insert them into local `tx_contexts` as:

- `source = "woc"`
- `kind = "missing_parent_backfill"`

The backfill was recursive by nature: once parent transactions were inserted, their own parents became visible as new gaps.

## Current Result

Backfill run result:

- added tx_context rows: `206`
- fetch failures during run: `49`
- remaining unresolved missing txids after this run: `271`

Main failure reason during the run:

- WOC rate limiting (`HTTP 429`)

## Interpretation

This confirms a real local tx-context ancestry gap.

Important:

- the original direct-gap set was small (`19`)
- but recursive ancestry expansion is much larger (`271` remaining after adding `206`)
- so local `tx_contexts` are not ancestry-complete yet

## Next Step

If needed, continue staged backfill with:

1. retry queue for `429` responses
2. lower request rate / batching
3. optional proof-aware prioritization for wallet-relevant ancestors only

