#!/usr/bin/env bash
set -euo pipefail

LOG_FILE="/home/jb9802/.openclaw/workspace/app/bsv_market/data/market-debug.log"

echo "[1/2] recent api failures"
if [ ! -f "$LOG_FILE" ]; then
  echo "log file not found: $LOG_FILE"
  exit 1
fi

tail -n 400 "$LOG_FILE" | jq -c 'select(.event=="api_fail" or .event=="api_unhandled_error") | {ts,event,method,path,status,code,message,rid}' 2>/dev/null || true

echo "[2/2] stats by endpoint"
tail -n 400 "$LOG_FILE" | jq -r 'select(.event=="api_fail") | [.method,.path,.code] | @tsv' 2>/dev/null | sort | uniq -c | sort -nr | head -n 30 || true

echo done
