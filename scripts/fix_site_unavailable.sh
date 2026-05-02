#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${BSV_MARKET_PORT:-8091}"
HEALTH_URL="http://127.0.0.1:${PORT}/api/state"

wait_health() {
  local timeout_sec="${1:-20}"
  local waited=0
  while (( waited < timeout_sec )); do
    if curl -sS -m 2 "$HEALTH_URL" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

cd "$BASE_DIR"

echo "[1/3] restart service"
if ! ./market_ctl.sh restart; then
  echo "restart returned unhealthy, waiting extra window..."
fi
if ! wait_health 20; then
  echo "still unhealthy, running diagnose --restart once..."
  ./diagnose_market.sh --restart || true
  wait_health 20 || true
fi

echo "[2/3] check status"
./market_ctl.sh status

echo "[3/3] probe api"
./market_ctl.sh probe

echo "done"
