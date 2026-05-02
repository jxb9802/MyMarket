#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

STATE_FILE="$BASE_DIR/data/state.json"
ENV_FILE="$BASE_DIR/.env.market"
BOOTSTRAP=947111

echo "[1/5] reset env bootstrap to $BOOTSTRAP"
cat > "$ENV_FILE" <<EOF
BSV_MARKET_BOOTSTRAP_HEIGHT=$BOOTSTRAP
BSV_MARKET_SYNC_BLOCKS_PER_ROUND=8
BSV_MARKET_SYNC_TX_PER_BLOCK=300
BSV_MARKET_SYNC_ROUND_MS=8000
EOF

if [[ -f "$STATE_FILE" ]]; then
  echo "[2/5] normalize local sync flags"
  tmp_json="$(mktemp)"
  jq --argjson h "$BOOTSTRAP" '
    .sync.bootstrapHeight = $h
    | .sync.fixedSyncLastHeight = null
    | .sync.localHeight = (if (.sync.localHeight // 0) < ($h-1) then ($h-1) else .sync.localHeight end)
    | .sync.networkHeight = (if (.sync.networkHeight // 0) < ($h-1) then ($h-1) else .sync.networkHeight end)
    | .sync.scannedFrom = $h
    | .sync.online = false
  ' "$STATE_FILE" > "$tmp_json"
  mv "$tmp_json" "$STATE_FILE"
fi

echo "[3/5] restart service"
./market_ctl.sh restart || ./diagnose_market.sh --restart

echo "[4/5] trigger one sync round"
curl -sS -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8091/api/catalog/sync >/tmp/fix_wallet_sync_flags.sync.json

echo "[5/5] key state"
curl -sS http://127.0.0.1:8091/api/state | jq '{
  success,
  currentMerchantId:.state.currentMerchantId,
  sync:{
    bootstrapHeight:.state.sync.bootstrapHeight,
    localHeight:.state.sync.localHeight,
    networkHeight:.state.sync.networkHeight,
    scannedFrom:.state.sync.scannedFrom
  },
  counts:{
    categories:(.state.categories|length),
    products:(.state.products|length),
    merchants:(.state.merchants|length)
  }
}'

echo "done"
