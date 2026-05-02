#!/usr/bin/env bash
set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:8091}"

echo "[1/3] checking /api/state"
curl -fsS "$API_BASE/api/state" >/dev/null

echo "[2/3] checking /api/chat/threads"
threads_json="$(curl -sS "$API_BASE/api/chat/threads" || true)"
if [[ -z "$threads_json" ]]; then
  echo "chat threads endpoint returned empty response"
  exit 1
fi

echo "$threads_json" | jq -e '.success == true' >/dev/null
echo "$threads_json" | jq -e 'has("threads") and has("unreadTotal")' >/dev/null

echo "[3/3] checking /api/chat/unread"
unread_json="$(curl -sS "$API_BASE/api/chat/unread" || true)"
if [[ -z "$unread_json" ]]; then
  echo "chat unread endpoint returned empty response"
  exit 1
fi

echo "$unread_json" | jq -e '.success == true' >/dev/null
echo "$unread_json" | jq -e 'has("unreadTotal") and has("buttonHasUnread") and has("byWalletId")' >/dev/null

echo "chat thread regression ok"
