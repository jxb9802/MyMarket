#!/usr/bin/env bash
set -euo pipefail
LOG_FILE="/home/jb9802/.openclaw/workspace/app/bsv_market/data/send-debug.log"
CACHE_FILE="/home/jb9802/.openclaw/workspace/app/bsv_market/data/cache.json"
SPV_FILE="/home/jb9802/.openclaw/workspace/app/bsv_market/data/spv_index.json"

echo "[1/3] cache snapshot"
jq '{updatedAt,confirmed,unconfirmed,incomeSat,expenseSat,total}' "$CACHE_FILE" 2>/dev/null || echo "cache missing"

echo
echo "[2/3] latest tx accounting"
jq '.txs|to_entries|map({txid:.key,netSat:.value.netSat,receivedSat:.value.receivedSat,spentSat:.value.spentSat,applied:.value.applied,confirmed:.value.confirmed,lastSeenAt:.value.lastSeenAt})|sort_by(.lastSeenAt)|reverse|.[0:12]' "$SPV_FILE" 2>/dev/null || echo "spv index missing"

echo
echo "[3/3] key debug logs"
if [[ -f "$LOG_FILE" ]]; then
  grep -E 'balance_total_changed|tx_apply_accounted|tx_apply_skip_recompute|anchor_broadcast_done|send_broadcast_done|utxo_upsert_ok|utxo_upsert_skipped_spent_outpoint' "$LOG_FILE" | tail -n 180 || true
else
  echo "send-debug.log missing"
fi
