# Bootstrap Index Fast Sync V1

## Goal

Bootstrap Index Fast Sync is an optional acceleration layer for new clients.
It lets a client restore BMMKT2 business state by validating a small release
index instead of downloading and scanning every block in the historical range.

It must not become a trusted data source. The blockchain remains the source of
truth.

The design goals are:

- New clients should automatically get the latest bootstrap index from the
  software package or GitHub Release without manual user action.
- The index should accelerate product, category, order, profile, chat/drive
  metadata, and other BMMKT2 business state.
- Wallet balance must still be derived from the local wallet address UTXO set.
- If the index is missing, stale, invalid, or cannot be downloaded, the client
  must silently fall back to normal chain sync.
- Existing clients that have already synced do not need to depend on this path.

## Current Measurement

The first benchmark tool is:

```bash
node scripts/sync_index_benchmark.js build-index --from 947110 --to latest --gzip
node scripts/sync_index_benchmark.js replay-index --index data/bootstrap_index/bmmkt2-index-mainnet-948088.json.gz
node scripts/sync_index_benchmark.js sample-full-blocks --from 947110 --to 948088 --sample 20
node scripts/sync_index_benchmark.js report --index data/bootstrap_index/bmmkt2-index-mainnet-948088.json.gz --sample data/bootstrap_index/full-block-sample-947110-948088.json
```

Local benchmark on 2026-05-07:

```text
Height range: 947110 -> 948088
Total blocks: 979
BMMKT2 relevant blocks: 44
BMMKT2 events: 78
Distinct txids: 77
Generated gzip index: about 46 KB
Embedded rawtx: 50
Missing rawtx: 28
Missing merkle proof: 78
Replay validation time: about 28 ms
Sampled average block size: about 3.88 MB
Estimated full-block download for range: about 3626 MB
Estimated size reduction with index: about 99.9988%
```

The measurement shows that most blocks in this range do not contain BMMKT2
data. A release index can therefore remove most of the initial sync bandwidth
and parsing cost for business state.

Full release asset generated on 2026-05-07:

```text
Release folder: dist/bootstrap_index_release_full/
Full index: bmmkt2-index-full-mainnet-947110-948088.json.gz
Full index gzip size: 138497 bytes
Lite index gzip size: 11487 bytes
Rawtx coverage: 78/78
Merkle proof coverage: 78/78
Replay validation: 78/78 BHS block hashes, 78/78 rawtx txids, 78/78 BMMKT2 markers
Isolated recovery test: 78 anchor events, 4 products, 2 categories, 11 orders
```

## What The Index Is

The index is a release asset, not a durable source of truth.

It is a compact list of BMMKT2 transactions known at release time, including
enough information for a new client to verify and replay them.

Recommended release asset layout:

```text
bootstrap_index/
  manifest.json
  bmmkt2-index-full-mainnet-948088.json.gz
```

For development and benchmarks, generated files may live under:

```text
data/bootstrap_index/
```

Generated index files should not be treated as source code. They should be
packaged into release artifacts or uploaded as GitHub Release assets.

## Manifest

`manifest.json` is the stable entry point.

Example:

```json
{
  "version": 1,
  "network": "mainnet",
  "marker": "BMMKT2",
  "fromHeight": 947110,
  "toHeight": 948088,
  "tipHash": "0000000000000000046c16f52b2ae29bd39f2fe03fac504413b1200329e0dd72",
  "indexFile": "bmmkt2-index-full-mainnet-948088.json.gz",
  "indexSha256": "938852d90ad770cc7e884d693fd7c6ea3fb96d30c3d2e3092a53bb8ee13decdb",
  "eventCount": 78,
  "txCount": 77,
  "relevantBlockCount": 44,
  "createdAt": "2026-05-07T16:16:00.000Z"
}
```

The client must validate:

- `network` matches the current chain.
- `marker` is `BMMKT2`.
- `indexSha256` matches the downloaded index file.
- `toHeight` has a local BHS header.
- local BHS `height -> blockHash` matches the manifest `tipHash`.

## Index Entry Format

Recommended full entry:

```json
{
  "height": 947119,
  "blockHash": "000000...",
  "txid": "9e8ba4...",
  "txIndex": 0,
  "eventType": "profile_set",
  "entityId": "",
  "merchantId": "m-14700e16f7",
  "walletId": "",
  "payloadHash": "sha256-of-canonical-payload",
  "rawtxHash": "sha256-of-rawtx-bytes",
  "rawtx": "010000...",
  "proofType": "merkle-path-tsc",
  "proofHex": "...",
  "proofEncoding": "hex",
  "proofVerified": true,
  "proofBlockHeight": 947119,
  "proofBlockHash": "000000...",
  "proofMerkleRoot": "...",
  "source": "release",
  "updatedAt": "2026-05-07T16:16:00.000Z"
}
```

The first benchmark version can generate entries without proof, but production
fast sync should treat missing proof as an incomplete verification state.

## Lite And Full Indexes

Two index classes are useful:

```text
bmmkt2-index-lite-mainnet-{height}.json.gz
bmmkt2-index-full-mainnet-{height}.json.gz
```

Lite index:

- height
- blockHash
- txid
- eventType
- payloadHash

Full index:

- all lite fields
- rawtx
- merkle proof
- proof metadata

Client behavior:

- Prefer full index.
- Use lite only as a locator and prefetch hint.
- Never mark a business event as fully verified from lite alone.

## Automatic Download Sources

Users must not manage index files manually.

On startup, the client checks sources in this order:

1. Package-local index:

   ```text
   bootstrap_index/manifest.json
   ```

2. Cached index in the data directory:

   ```text
   data/bootstrap_index/manifest.json
   ```

3. GitHub Release assets.

4. Public node index API, for example:

   ```text
   http://8.136.3.174:8091/api/bootstrap-index/manifest
   ```

5. Normal full block sync fallback.

The GitHub source is configured centrally, not exposed to users. The intended
lookup is:

```text
https://api.github.com/repos/{owner}/{repo}/releases/latest
```

The client finds assets named like:

```text
manifest.json
bmmkt2-index-full-mainnet-*.json.gz
bmmkt2-index-lite-mainnet-*.json.gz
```

If GitHub is unavailable, the client falls back to the package-local index,
cached index, public nodes, or normal sync.

## Startup Flow

New client startup:

1. Start BHS/header sync.
2. Locate the best bootstrap index source.
3. Download or load `manifest.json`.
4. Download or load the index file.
5. Verify file hash and manifest fields.
6. Wait until BHS covers `toHeight`.
7. Validate each entry:
   - local BHS block hash matches `height/blockHash`
   - rawtx calculates to `txid`
   - rawtx contains a valid BMMKT2 OP_RETURN event
   - payload hash matches `payloadHash` when the indexed payload encoding is the same as the rawtx payload
   - merkle proof proves the txid is in the block
8. Insert verified rawtx/proof into `tx_contexts`.
9. Insert business events into the local event/projection path.
10. Set business sync cursor to `toHeight`.
11. Continue normal incremental sync from `toHeight + 1`.

If any step fails, log the reason and fall back to normal chain sync.

Current implementation note:

- `server_market.js` exposes `importBootstrapIndexRelease()`.
- `POST /api/bootstrap-index/import` imports or dry-runs a local manifest/index after wallet login.
- `scripts/import_bootstrap_index_release.js` is the CLI validation/recovery tool.
- `/api/wallet/sync` will apply the bootstrap index when `forceBootstrap`,
  `clearLocalFirst`, or `BSV_MARKET_BOOTSTRAP_INDEX_AUTO=1` is used and a local
  release manifest is available.
- Some historical `order_place` entries were indexed from expanded projection
  payload JSON, while the rawtx contains the compact order protocol payload.
  Those produce `payload_hash_mismatch` warnings only; rawtx txid, BMMKT2 marker,
  BHS block hash, and merkle proof remain mandatory.
- The bootstrap index restores business projections. Wallet balance and spendable
  UTXOs still require normal wallet synchronization.

## Trust Model

The index is untrusted.

The client must trust only:

- locally verified block headers from BHS
- rawtx hash and txid calculation
- merkle proof against the BHS block header merkle root
- BMMKT2 protocol parsing
- local projection rules

GitHub Release, package files, and public nodes are delivery channels only.

## Wallet Boundary

Bootstrap index does not determine wallet balance.

Wallet balance rules:

- Final balance must come from the wallet address UTXO set.
- Wallet scan still starts from local wallet metadata:
  - existing `walletScanCursorHeight`, or
  - wallet birth height, or
  - user-selected import scan height.
- Order and business transactions from the index may annotate wallet history
  labels, but cannot replace UTXO verification.
- A new imported mnemonic still needs wallet-specific UTXO discovery.

This boundary is mandatory. It avoids false balances when a bootstrap index is
incomplete or unrelated to the user's wallet addresses.

## Public Node Role

Public nodes can help discover and serve bootstrap index files, but do not need
to relay user data.

Recommended API:

```text
GET /api/bootstrap-index/manifest
GET /api/bootstrap-index/download/:file
```

Optional peer directory support can advertise:

- node id
- current BHS tip
- supported index height
- supported index type: lite/full
- rawtx/proof fetch capability

The public node remains a hint provider. The client still verifies all data.

## Reorg Handling

The index covers a fixed height and block hash range.

On startup and periodically after header sync:

- If BHS block hash at any indexed height differs from the index entry, mark
  that entry invalid.
- If the manifest `toHeight/tipHash` no longer matches the local chain, do not
  use the index beyond the last matching height.
- For invalid ranges, remove affected derived projections and fall back to
  normal block sync.

Because release indexes are historical, deep reorg risk should be low, but the
client must still treat mismatch as a hard verification failure.

## Release Pipeline

Future release flow:

1. Run normal sync on the release builder node.
2. Generate full index:

   ```bash
   node scripts/sync_index_benchmark.js build-index --from 947110 --to latest --gzip
   ```

3. Backfill missing rawtx and merkle proof before marking it production-ready.
4. Generate `manifest.json`.
5. Include files in the application release package.
6. Upload files as GitHub Release assets.
7. Do not require users to download or place files manually.

## Open Work

The benchmark tool is implemented, but production integration still needs:

- merkle proof backfill for all indexed txids
- production index generator command, separate from benchmark reporting
- startup index source resolver
- GitHub Release asset downloader
- manifest and index verifier
- projection replay path that consumes verified index entries
- cache retention and upgrade rules for `data/bootstrap_index`
- optional public node bootstrap-index API
- UI sync messages:
  - preparing fast sync data
  - downloading fast sync index
  - verifying fast sync index
  - falling back to normal sync

## Risks And Mitigations

### 1. Missing merkle proof

Risk:

The current benchmark index can contain rawtx and business metadata, but the
first generated index had no merkle proofs. Without merkle proof, a client can
check `rawtx -> txid` and parse BMMKT2, but cannot prove that the transaction is
confirmed in the claimed block without another chain source.

Mitigation:

- Benchmark indexes may be used for measurement only.
- Production full indexes must include merkle proof for every entry.
- Entries without proof may be imported only into a staging or hint table.
- A business projection must not be advanced from an unproved entry.

Production gate:

```text
missingProofCount must be 0 for a production full index.
```

### 2. Release asset tampering

Risk:

GitHub Release, package-local files, or public node downloads can be tampered
with. The index is a delivery artifact, not a trusted authority.

Mitigation:

- Validate manifest hash.
- Validate local BHS header coverage and block hashes.
- Validate `rawtx -> txid`.
- Validate merkle proof against the local BHS block header merkle root.
- Validate BMMKT2 marker and canonical payload hash.
- Reject or stage invalid entries; never trust GitHub or a public node by itself.

### 3. Chain mismatch or reorg

Risk:

An index may reference a block hash that does not match the client's current
BHS chain. Applying it would create business state from the wrong chain.

Mitigation:

- Before replay, compare every indexed `height/blockHash` against local BHS.
- If any mismatch appears, stop using the index at the first mismatched height.
- Remove or ignore derived staged entries from the mismatched range.
- Fall back to normal chain sync for the affected range.

### 4. Wallet balance misuse

Risk:

Bootstrap index could be mistakenly used to calculate wallet balance. This
would be wrong because wallet balance is address-specific and depends on the
client's own wallet UTXO set.

Mitigation:

- Index replay must not write final wallet UTXO state.
- Index replay may write tx context and business labels only after verification.
- Wallet balance must continue to come from local wallet address scanning and
  UTXO reconciliation.
- Tests must assert that bootstrap index replay does not change wallet total
  balance by itself.

### 5. Duplicate event application

Risk:

A client may apply events from bootstrap index and later see the same
transactions during normal block sync.

Mitigation:

- Event writes must be idempotent.
- Dedupe key should include at least:

  ```text
  txid + eventType + payloadHash
  ```

- Projection replay must tolerate duplicate inputs.

### 6. Incomplete release index

Risk:

The release builder node may have missed some BMMKT2 transactions. A fresh
client using the index could see incomplete business state until normal sync
catches up.

Mitigation:

- Treat the index as an acceleration layer, not a completeness guarantee.
- After index replay, normal incremental sync still runs from `toHeight + 1`.
- For the indexed range, background audit can compare sampled blocks or
  peer-provided indexes.
- Release pipeline should generate indexes from at least two independently
  synced nodes and compare event counts before publishing.

### 7. GitHub availability

Risk:

GitHub Release asset downloads may be slow or unavailable in some networks.

Mitigation:

- Package releases should include a recent local index.
- Cached `data/bootstrap_index` should be reused when valid.
- Public nodes may provide `/api/bootstrap-index/manifest` as a fallback.
- Failure to download must not block startup; normal sync remains the final
  fallback.

### 8. Index growth

Risk:

The index may grow as usage increases, especially if it includes rawtx, merkle
proofs, chat, or drive metadata.

Mitigation:

- Support lite and full index variants.
- Split index files by height range, for example:

  ```text
  bmmkt2-index-full-mainnet-947110-950000.json.gz
  bmmkt2-index-full-mainnet-950001-955000.json.gz
  ```

- Keep large drive payloads out of the base business bootstrap index unless
  explicitly needed.
- Store generated assets as release assets, not as normal source files.

### 9. Release process mistakes

Risk:

Manual release steps can upload the wrong manifest, wrong index file, or stale
hashes.

Mitigation:

- Release script must generate index, manifest, hash, and upload assets as one
  atomic workflow.
- CI/release checks must run `replay-index` before upload.
- A release should fail closed if index validation fails.

### 10. Partial import state

Risk:

The client may crash or fail halfway through index import, leaving partially
applied business state.

Mitigation:

- Import into staging tables or a staging scope first.
- Commit verified entries in a transaction.
- Record `bootstrapIndexImportId`, manifest hash, and applied height range.
- On startup, clean stale incomplete imports before trying again.

## Production Readiness Gates

Bootstrap index must not be enabled as a default trusted fast-sync path until
these gates pass:

```text
1. full index has rawtx for every entry
2. full index has merkle proof for every entry
3. replay-index validates all entries against local BHS
4. import path is idempotent
5. import path uses staging or equivalent atomic commit
6. wallet balance is unchanged by index replay alone
7. invalid manifest/hash/proof causes fallback
8. missing GitHub/network access causes fallback
9. normal chain sync can still recover missing or invalid ranges
```

## Acceptance Criteria

Minimum acceptance:

- Fresh client with no local data can auto-load a package-local or GitHub
  Release index.
- No manual user file operation is required.
- Invalid index hash causes fallback, not broken startup.
- Missing GitHub access causes fallback.
- BHS mismatch causes fallback for affected range.
- Verified index entries restore business state without reading full blocks.
- Wallet balance still matches UTXO scan results, not index-derived totals.
- Existing synced clients continue to work without using this path.
