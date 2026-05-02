#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "[1/4] restart service"
./market_ctl.sh restart || ./diagnose_market.sh --restart

echo "[2/4] trigger catalog rebuild"
curl -sS -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8091/api/merchants/refresh >/tmp/fix_merchant_owner_view.refresh.json

echo "[3/4] trigger full sync"
curl -sS -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8091/api/catalog/sync >/tmp/fix_merchant_owner_view.sync.json

echo "[4/4] show key state"
curl -sS http://127.0.0.1:8091/api/state | jq '{success, currentMerchantId:.state.currentMerchantId, products:[.state.products[]?|{id,title,merchantId}], categories:[.state.categories[]?|{id,name,merchantId}], merchants:.state.merchants}'

echo "done"
