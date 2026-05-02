#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

STATE_FILE="$BASE_DIR/data/state.json"
ENV_FILE="$BASE_DIR/.env.market"
BACKUP_DIR="$BASE_DIR/data/backup-retest-$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "state.json not found: $STATE_FILE"
  exit 1
fi

NETWORK_HEIGHT="$(jq -r '.sync.networkHeight // 938500' "$STATE_FILE")"
if [[ -z "${NETWORK_HEIGHT:-}" || "$NETWORK_HEIGHT" == "null" ]]; then
  NETWORK_HEIGHT="938500"
fi
if ! [[ "$NETWORK_HEIGHT" =~ ^[0-9]+$ ]]; then
  NETWORK_HEIGHT="938500"
fi

# Raise bootstrap close to current tip so retest is based on new marker data.
NEW_BOOTSTRAP=$((NETWORK_HEIGHT - 200))
if (( NEW_BOOTSTRAP < 947111 )); then
  NEW_BOOTSTRAP=947111
fi

echo "[1/6] backup local data -> $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -a data/state.json "$BACKUP_DIR/" || true
cp -a data/anchors_global.json "$BACKUP_DIR/" || true
cp -a data/market-debug.log "$BACKUP_DIR/" || true
cp -a data/cache.json "$BACKUP_DIR/" || true

echo "[2/6] write env bootstrap: BSV_MARKET_BOOTSTRAP_HEIGHT=$NEW_BOOTSTRAP"
cat > "$ENV_FILE" <<EOF
BSV_MARKET_BOOTSTRAP_HEIGHT=$NEW_BOOTSTRAP
BSV_MARKET_SYNC_BLOCKS_PER_ROUND=12
BSV_MARKET_SYNC_TX_PER_BLOCK=500
BSV_MARKET_SYNC_ROUND_MS=12000
EOF

echo "[3/6] reset local market snapshot (keep wallet)"
tmp_json="$(mktemp)"
jq --argjson h "$NEW_BOOTSTRAP" '
  .sync.bootstrapHeight=$h
  | .sync.fixedSyncLastHeight=null
  | .sync.localHeight=($h-1)
  | .sync.networkHeight=($h-1)
  | .sync.scannedFrom=$h
  | .sync.online=false
  | .categories=[]
  | .products=[]
  | .merchants=[]
  | .orders=[]
  | .anchors=[]
  | .localChanges={seq:1,queue:[]}
' "$STATE_FILE" > "$tmp_json"
mv "$tmp_json" "$STATE_FILE"

echo "[4/6] restart service with new bootstrap"
./market_ctl.sh restart || ./diagnose_market.sh --restart

echo "[5/6] trigger sync"
curl -sS -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8091/api/catalog/sync >/tmp/retest_with_high_bootstrap.sync.json

echo "[6/6] key state"
curl -sS http://127.0.0.1:8091/api/state | jq '{
  success,
  currentMerchantId:.state.currentMerchantId,
  sync:{
    bootstrapHeight:.state.sync.bootstrapHeight,
    localHeight:.state.sync.localHeight,
    networkHeight:.state.sync.networkHeight,
    pendingUploads:.state.sync.pendingUploads
  },
  categories:(.state.categories|map({id,name,merchantId})|.[:20]),
  products:(.state.products|map({id,title,merchantId})|.[:20]),
  merchants:(.state.merchants|.[:20])
}'

echo "done"
