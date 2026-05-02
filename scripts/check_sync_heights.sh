#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/2] api sync status"
curl -fsS "http://127.0.0.1:8091/api/sync/status" | jq '{
  success,
  bootstrapHeight: (.sync.bootstrapHeight // 0),
  localHeight: (.sync.localHeight // 0),
  networkHeight: (.sync.networkHeight // 0),
  lag: (.sync.lag // 0),
  p2pHeaderCursorHeight: (.sync.p2pHeaderCursorHeight // 0),
  p2pTipHeight: (.sync.p2pTipHeight // 0)
}'

echo "[2/2] state.json sync"
jq '.sync | {
  bootstrapHeight,
  fixedSyncLastHeight,
  localHeight,
  networkHeight,
  scannedFrom,
  p2pHeaderCursorHeight,
  p2pTipHeight
}' "$ROOT_DIR/data/state.json"

echo done
