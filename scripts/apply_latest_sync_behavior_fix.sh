#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "[1/3] restart service"
./market_ctl.sh restart || ./diagnose_market.sh --restart

echo "[2/3] health"
./market_ctl.sh status
./market_ctl.sh probe

echo "[3/3] key sync flags"
curl -sS http://127.0.0.1:8091/api/state | jq '{
  success,
  currentMerchantId:.state.currentMerchantId,
  sync:{
    bootstrapHeight:.state.sync.bootstrapHeight,
    localHeight:.state.sync.localHeight,
    networkHeight:.state.sync.networkHeight,
    fixedSyncLastHeight:.state.sync.fixedSyncLastHeight
  },
  counts:{
    merchants:(.state.merchants|length),
    categories:(.state.categories|length),
    products:(.state.products|length)
  }
}'

echo "done"
