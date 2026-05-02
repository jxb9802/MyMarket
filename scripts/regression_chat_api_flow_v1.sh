#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$BASE_DIR/data/diagnostics"
TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/regression-chat-api-flow-v1-$TS.log"
COOKIE_JAR="/tmp/bsv_market_reg_chat_cookie.txt"
API_BASE="${API_BASE:-http://127.0.0.1:8091}"

mkdir -p "$OUT_DIR"
: >"$REPORT"

PASS=0
FAIL=0

log() {
  printf '[%s] %s\n' "$(date +'%F %T')" "$1" | tee -a "$REPORT"
}

pass() {
  PASS=$((PASS + 1))
  log "PASS: $1"
}

fail() {
  FAIL=$((FAIL + 1))
  log "FAIL: $1"
}

api_cookie() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS --max-time 25 -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" "$url" \
      -H 'Content-Type: application/json' -d "$body"
  else
    curl -sS --max-time 25 -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" "$url"
  fi
}

if [[ -z "${TEST_WALLET_PASSWORD:-}" ]]; then
  echo "TEST_WALLET_PASSWORD is required"
  exit 2
fi

rm -f "$COOKIE_JAR"

log "Chat API flow regression started"
log "report=$REPORT"

probe_code="$(curl -sS -o /tmp/bsv_chat_probe.json -w '%{http_code}' --max-time 5 "$API_BASE/api/state" || echo '000')"
if [[ "$probe_code" == "200" ]]; then
  pass "service reachable"
else
  fail "service unreachable http=$probe_code"
fi

login_json="$(api_cookie POST "$API_BASE/api/auth/login" "{\"password\":\"${TEST_WALLET_PASSWORD}\"}" || true)"
if [[ "$(printf '%s' "$login_json" | jq -r '.success // false')" == "true" ]]; then
  pass "wallet login success"
else
  fail "wallet login failed"
fi

threads_json="$(api_cookie GET "$API_BASE/api/chat/threads" || true)"
if [[ "$(printf '%s' "$threads_json" | jq -r '.success // false')" == "true" ]]; then
  pass "chat threads success"
else
  fail "chat threads failed"
fi
if printf '%s' "$threads_json" | jq -e 'has("threads") and has("unreadTotal")' >/dev/null 2>&1; then
  pass "chat threads fields present"
else
  fail "chat threads fields missing"
fi

unread_json="$(api_cookie GET "$API_BASE/api/chat/unread" || true)"
if [[ "$(printf '%s' "$unread_json" | jq -r '.success // false')" == "true" ]]; then
  pass "chat unread success"
else
  fail "chat unread failed"
fi

identity_json="$(api_cookie GET "$API_BASE/api/chat/identity" || true)"
if [[ "$(printf '%s' "$identity_json" | jq -r '.success // false')" == "true" ]]; then
  pass "chat identity success"
else
  fail "chat identity failed"
fi

publish_json="$(api_cookie POST "$API_BASE/api/chat/profile/publish" '{"confirmFee":true}' || true)"
if [[ "$(printf '%s' "$publish_json" | jq -r '.success // false')" == "true" ]]; then
  pass "chat profile publish success"
else
  fail "chat profile publish failed"
fi

first_wallet_id="$(printf '%s' "$threads_json" | jq -r '.threads[0].walletId // empty')"
if [[ -n "$first_wallet_id" ]]; then
  preview_json="$(api_cookie POST "$API_BASE/api/chat/send-preview" "{\"walletId\":\"$first_wallet_id\",\"text\":\"regression-chat-preview\"}" || true)"
  if [[ "$(printf '%s' "$preview_json" | jq -r '.success // false')" == "true" ]]; then
    pass "chat send-preview success"
  else
    fail "chat send-preview failed"
  fi

  thread_json="$(api_cookie GET "$API_BASE/api/chat/thread?walletId=$first_wallet_id" || true)"
  if [[ "$(printf '%s' "$thread_json" | jq -r '.success // false')" == "true" ]]; then
    pass "chat thread success"
  else
    fail "chat thread failed"
  fi

  pass "chat direct HTTP signaling skipped by policy"

  read_json="$(api_cookie POST "$API_BASE/api/chat/thread/read" "{\"walletId\":\"$first_wallet_id\"}" || true)"
  if [[ "$(printf '%s' "$read_json" | jq -r '.success // false')" == "true" ]]; then
    pass "chat thread/read success"
  else
    fail "chat thread/read failed"
  fi
else
  log "No chat thread available; skipped thread-specific checks"
fi

log "Chat API flow regression done pass=$PASS fail=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
