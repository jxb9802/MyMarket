#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "[1/3] restart"
./market_ctl.sh restart || ./diagnose_market.sh --restart

echo "[2/3] rebuild catalog"
curl -sS -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8091/api/catalog/sync >/tmp/rebuild_catalog_once.sync.json

echo "[3/3] key state"
curl -sS http://127.0.0.1:8091/api/state | jq '{
  success,
  currentMerchantId:.state.currentMerchantId,
  products:(.state.products|map({id,title,merchantId})|.[:20]),
  categories:(.state.categories|map({id,name,merchantId})|.[:20]),
  merchants:(.state.merchants|.[:20])
}'

echo "done"
