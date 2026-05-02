#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

STATE_FILE="$BASE_DIR/data/state.json"
ENV_FILE="$BASE_DIR/.env.market"
BACKUP_DIR="$BASE_DIR/data/backup-latest-sync-$(date +%Y%m%d-%H%M%S)"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "state file not found: $STATE_FILE"
  exit 1
fi

NETWORK_HEIGHT="$(jq -r '.sync.networkHeight // 0' "$STATE_FILE")"
LOCAL_HEIGHT="$(jq -r '.sync.localHeight // 0' "$STATE_FILE")"
FIXED_LAST="$(jq -r '.sync.fixedSyncLastHeight // 0' "$STATE_FILE")"

for v in NETWORK_HEIGHT LOCAL_HEIGHT FIXED_LAST; do
  if ! [[ "${!v}" =~ ^[0-9]+$ ]]; then
    printf -v "$v" "0"
  fi
done

START_HEIGHT="$NETWORK_HEIGHT"
if (( LOCAL_HEIGHT > START_HEIGHT )); then START_HEIGHT="$LOCAL_HEIGHT"; fi
if (( FIXED_LAST > START_HEIGHT )); then START_HEIGHT="$FIXED_LAST"; fi
if (( START_HEIGHT < 947111 )); then START_HEIGHT=947111; fi

echo "[1/6] backup -> $BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
cp -a "$STATE_FILE" "$BACKUP_DIR/" || true
cp -a "$BASE_DIR/data/anchors_global.json" "$BACKUP_DIR/" || true
cp -a "$BASE_DIR/data/market-debug.log" "$BACKUP_DIR/" || true

echo "[2/6] set bootstrap height to latest: $START_HEIGHT"
cat > "$ENV_FILE" <<EOF
BSV_MARKET_BOOTSTRAP_HEIGHT=$START_HEIGHT
BSV_MARKET_SYNC_BLOCKS_PER_ROUND=8
BSV_MARKET_SYNC_TX_PER_BLOCK=300
BSV_MARKET_SYNC_ROUND_MS=8000
EOF

echo "[3/6] clear local market snapshot"
tmp_json="$(mktemp)"
jq --argjson h "$START_HEIGHT" '
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

echo "[4/6] restart service"
./market_ctl.sh restart || ./diagnose_market.sh --restart

echo "[5/6] sync once"
curl -sS -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8091/api/catalog/sync >/tmp/sync_from_latest_height.sync.json

echo "[6/6] key state"
curl -sS http://127.0.0.1:8091/api/state | jq '{
  success,
  currentMerchantId:.state.currentMerchantId,
  sync:{
    bootstrapHeight:.state.sync.bootstrapHeight,
    localHeight:.state.sync.localHeight,
    networkHeight:.state.sync.networkHeight
  },
  counts:{
    categories:(.state.categories|length),
    products:(.state.products|length),
    merchants:(.state.merchants|length),
    pending:(.state.sync.pendingUploads // 0)
  }
}'

echo "done"
