#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$BASE_DIR/log"
DATA_DIR="$BASE_DIR/data"
LOG_FILE="$LOG_DIR/bsv_market_run.log"
PORT_MIN="${BSV_MARKET_PORT_MIN:-8091}"
PORT_MAX="${BSV_MARKET_PORT_MAX:-8100}"

cd "$BASE_DIR"

open_browser() {
  local url="$1"
  if command -v open >/dev/null 2>&1; then
    open "$url" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 || true
  fi
}

echo "[1/6] checking Node.js..."
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Please install Node.js 24+ first."
  exit 1
fi

echo "[2/6] checking npm..."
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Please reinstall Node.js with npm."
  exit 1
fi

echo "[3/6] checking node:sqlite..."
if ! node -e "require('node:sqlite')" >/dev/null 2>&1; then
  echo "This build of Node.js does not provide node:sqlite."
  echo "Please install Node.js 24+ and retry."
  exit 1
fi

echo "[4/6] checking dependencies..."
if [[ ! -d "$BASE_DIR/node_modules" ]]; then
  npm install
fi
if ! node -e "require.resolve('axios');require.resolve('bsv');require.resolve('bsv-p2p');require.resolve('express');require.resolve('express-session')" >/dev/null 2>&1; then
  npm install
fi

mkdir -p "$LOG_DIR" "$DATA_DIR"

echo "[5/6] resolving port..."
PORT="$(node "$BASE_DIR/scripts/resolve_runtime_port.js" "$PORT_MIN" "$PORT_MAX" --write)"
export BSV_MARKET_PORT="$PORT"
export BSV_MARKET_SESSION_SECRET="${BSV_MARKET_SESSION_SECRET:-bsv-market-local}"
export BSV_MARKET_BOOTSTRAP_HEIGHT="${BSV_MARKET_BOOTSTRAP_HEIGHT:-947111}"
export BSV_MARKET_UNCONFIRMED_MAX_AGE_MS="${BSV_MARKET_UNCONFIRMED_MAX_AGE_MS:-86400000}"
export NODE_NO_WARNINGS=1
echo "using port: $PORT"

echo "[6/6] starting server..."
URL="http://127.0.0.1:${PORT}/index.html"
echo "url: $URL"
echo "log: $LOG_FILE"
echo "Closing this terminal will stop the service."
( sleep 2; open_browser "$URL" ) >/dev/null 2>&1 &
node server_market.js
