#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="/tmp/bsv_market_run.log"
DEBUG_LOG="$BASE_DIR/data/market-debug.log"

echo "[1/4] restart"
pkill -9 -f "server_market.js|steward_subprocess.js" >/dev/null 2>&1 || true
nohup node "$BASE_DIR/server_market.js" >"$LOG_FILE" 2>&1 &
sleep 1

echo "[2/4] probe /api/state"
curl -sS "http://127.0.0.1:8091/api/state" | jq '{success,localHeight:.state.sync.localHeight,networkHeight:.state.sync.networkHeight,p2pHeaderCursorHeight:.state.sync.p2pHeaderCursorHeight,p2pTipHeight:.state.sync.p2pTipHeight}'

echo "[3/4] trigger one sync"
curl -sS -X POST "http://127.0.0.1:8091/api/catalog/sync" -H 'content-type: application/json' -d '{}' | jq '{success,localHeight:.state.sync.localHeight,networkHeight:.state.sync.networkHeight,p2pHeaderCursorHeight:.state.sync.p2pHeaderCursorHeight,p2pTipHeight:.state.sync.p2pTipHeight,pendingUploads:.state.sync.pendingUploads}'

echo "[4/4] key debug tail"
if [[ -f "$DEBUG_LOG" ]]; then
  rg -n "p2p_header_cursor_reset|p2p_headers_batch|p2p_sync_scheduler|p2p_task_assigned|p2p_task_done|p2p_task_retry|p2p_task_failed|catalog_sync_join_inflight" "$DEBUG_LOG" | tail -n 120
else
  echo "debug log missing: $DEBUG_LOG"
fi

echo "done"
