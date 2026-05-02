#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_FILE="/tmp/bsv_market_run.log"

cd "$ROOT_DIR"

echo "[1/4] stop old server"
pkill -9 -f "server_market.js" || true

echo "[2/4] start server"
nohup node server_market.js >"$LOG_FILE" 2>&1 &
PID=$!
echo "pid=$PID"

echo "[3/4] wait health"
for i in {1..20}; do
  if curl -fsS "http://127.0.0.1:8091/api/state" >/dev/null 2>&1; then
    echo "healthy_at=${i}s"
    break
  fi
  sleep 1
  if [[ "$i" -eq 20 ]]; then
    echo "server not healthy within 20s"
    tail -n 120 "$LOG_FILE" || true
    exit 1
  fi
done

echo "[4/4] print sync status"
curl -fsS "http://127.0.0.1:8091/api/sync/status" | jq '{
  success,
  bootstrapHeight: (.sync.bootstrapHeight // .state.sync.bootstrapHeight // 0),
  localHeight: (.sync.localHeight // .state.sync.localHeight // 0),
  networkHeight: (.sync.networkHeight // .state.sync.networkHeight // 0),
  lag: (.sync.lag // .state.sync.lag // 0),
  p2pHeaderCursorHeight: (.sync.p2pHeaderCursorHeight // .state.sync.p2pHeaderCursorHeight // 0),
  p2pTipHeight: (.sync.p2pTipHeight // .state.sync.p2pTipHeight // 0)
}'

echo "done"
