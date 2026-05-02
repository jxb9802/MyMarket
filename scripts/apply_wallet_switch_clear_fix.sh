#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

echo "[1/2] restart service"
./market_ctl.sh restart || ./diagnose_market.sh --restart

echo "[2/2] health"
./market_ctl.sh status
./market_ctl.sh probe

echo "done"
