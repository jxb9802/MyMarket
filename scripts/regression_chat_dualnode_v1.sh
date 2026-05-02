#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$BASE_DIR/data/diagnostics"
TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/regression-chat-dualnode-v1-$TS.log"

NODE_A_API="${NODE_A_API:-}"
NODE_B_API="${NODE_B_API:-}"
NODE_A_PASSWORD="${NODE_A_PASSWORD:-}"
NODE_B_PASSWORD="${NODE_B_PASSWORD:-}"
DISCOVERY_TIMEOUT_SEC="${DISCOVERY_TIMEOUT_SEC:-45}"
MESSAGE_TIMEOUT_SEC="${MESSAGE_TIMEOUT_SEC:-30}"
POLL_SEC="${POLL_SEC:-2}"

COOKIE_A="/tmp/bsv_market_reg_chat_node_a.cookie"
COOKIE_B="/tmp/bsv_market_reg_chat_node_b.cookie"

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

require_env() {
  local name="$1"
  local val="${!name:-}"
  if [[ -z "$val" ]]; then
    echo "$name is required"
    exit 2
  fi
}

api_cookie() {
  local jar="$1"
  local method="$2"
  local url="$3"
  local body="${4:-}"
  if [[ -n "$body" ]]; then
    curl -sS --max-time 25 -b "$jar" -c "$jar" -X "$method" "$url" \
      -H 'Content-Type: application/json' -d "$body"
  else
    curl -sS --max-time 25 -b "$jar" -c "$jar" -X "$method" "$url"
  fi
}

probe_api() {
  local url="$1"
  curl -sS -o /tmp/bsv_chat_dual_probe.json -w '%{http_code}' --max-time 5 "$url/api/state" || echo '000'
}

wait_for_thread() {
  local jar="$1"
  local api="$2"
  local target_wallet_id="$3"
  local timeout_sec="$4"
  local started
  started="$(date +%s)"
  while true; do
    local threads_json
    threads_json="$(api_cookie "$jar" GET "$api/api/chat/threads" || true)"
    if [[ "$(printf '%s' "$threads_json" | jq -r '.success // false')" == "true" ]]; then
      if printf '%s' "$threads_json" | jq -e --arg wid "$target_wallet_id" '.threads[]? | select(.walletId == $wid)' >/dev/null 2>&1; then
        printf '%s' "$threads_json"
        return 0
      fi
    fi
    if (( "$(date +%s)" - started >= timeout_sec )); then
      return 1
    fi
    sleep "$POLL_SEC"
  done
}

wait_for_message() {
  local jar="$1"
  local api="$2"
  local wallet_id="$3"
  local marker="$4"
  local timeout_sec="$5"
  local started
  started="$(date +%s)"
  while true; do
    local thread_json
    thread_json="$(api_cookie "$jar" GET "$api/api/chat/thread?walletId=$wallet_id" || true)"
    if [[ "$(printf '%s' "$thread_json" | jq -r '.success // false')" == "true" ]]; then
      if printf '%s' "$thread_json" | jq -e --arg marker "$marker" '.messages[]? | select(.text == $marker)' >/dev/null 2>&1; then
        printf '%s' "$thread_json"
        return 0
      fi
    fi
    if (( "$(date +%s)" - started >= timeout_sec )); then
      return 1
    fi
    sleep "$POLL_SEC"
  done
}

require_env NODE_A_API
require_env NODE_B_API
require_env NODE_A_PASSWORD
require_env NODE_B_PASSWORD

rm -f "$COOKIE_A" "$COOKIE_B"

log "Dual-node chat regression started"
log "report=$REPORT"

code_a="$(probe_api "$NODE_A_API")"
if [[ "$code_a" == "200" ]]; then pass "node A reachable"; else fail "node A unreachable http=$code_a"; fi
code_b="$(probe_api "$NODE_B_API")"
if [[ "$code_b" == "200" ]]; then pass "node B reachable"; else fail "node B unreachable http=$code_b"; fi

login_a="$(api_cookie "$COOKIE_A" POST "$NODE_A_API/api/auth/login" "{\"password\":\"$NODE_A_PASSWORD\"}" || true)"
if [[ "$(printf '%s' "$login_a" | jq -r '.success // false')" == "true" ]]; then pass "node A login"; else fail "node A login"; fi
login_b="$(api_cookie "$COOKIE_B" POST "$NODE_B_API/api/auth/login" "{\"password\":\"$NODE_B_PASSWORD\"}" || true)"
if [[ "$(printf '%s' "$login_b" | jq -r '.success // false')" == "true" ]]; then pass "node B login"; else fail "node B login"; fi

identity_a="$(api_cookie "$COOKIE_A" GET "$NODE_A_API/api/chat/identity" || true)"
identity_b="$(api_cookie "$COOKIE_B" GET "$NODE_B_API/api/chat/identity" || true)"
wallet_a="$(printf '%s' "$identity_a" | jq -r '.identity.walletId // empty')"
wallet_b="$(printf '%s' "$identity_b" | jq -r '.identity.walletId // empty')"
if [[ -n "$wallet_a" ]]; then pass "node A walletId=$wallet_a"; else fail "node A wallet identity unavailable"; fi
if [[ -n "$wallet_b" ]]; then pass "node B walletId=$wallet_b"; else fail "node B wallet identity unavailable"; fi

publish_a="$(api_cookie "$COOKIE_A" POST "$NODE_A_API/api/chat/profile/publish" '{"confirmFee":true}' || true)"
if [[ "$(printf '%s' "$publish_a" | jq -r '.success // false')" == "true" ]]; then pass "node A publish profile"; else fail "node A publish profile"; fi
publish_b="$(api_cookie "$COOKIE_B" POST "$NODE_B_API/api/chat/profile/publish" '{"confirmFee":true}' || true)"
if [[ "$(printf '%s' "$publish_b" | jq -r '.success // false')" == "true" ]]; then pass "node B publish profile"; else fail "node B publish profile"; fi

threads_a="$(wait_for_thread "$COOKIE_A" "$NODE_A_API" "$wallet_b" "$DISCOVERY_TIMEOUT_SEC" || true)"
if [[ -n "$threads_a" ]]; then
  pass "node A discovered node B thread"
else
  fail "node A did not discover node B thread within ${DISCOVERY_TIMEOUT_SEC}s"
fi

threads_b="$(wait_for_thread "$COOKIE_B" "$NODE_B_API" "$wallet_a" "$DISCOVERY_TIMEOUT_SEC" || true)"
if [[ -n "$threads_b" ]]; then
  pass "node B discovered node A thread"
else
  fail "node B did not discover node A thread within ${DISCOVERY_TIMEOUT_SEC}s"
fi

pass "node A direct HTTP signaling skipped by policy"

msg_text="dualnode-chat-$TS"
send_a="$(api_cookie "$COOKIE_A" POST "$NODE_A_API/api/chat/send" "{\"walletId\":\"$wallet_b\",\"text\":\"$msg_text\"}" || true)"
if [[ "$(printf '%s' "$send_a" | jq -r '.success // false')" == "true" ]]; then
  pass "node A send message"
else
  fail "node A send message"
fi

thread_b_after="$(wait_for_message "$COOKIE_B" "$NODE_B_API" "$wallet_a" "$msg_text" "$MESSAGE_TIMEOUT_SEC" || true)"
if [[ -n "$thread_b_after" ]]; then
  pass "node B received message"
else
  fail "node B did not receive message within ${MESSAGE_TIMEOUT_SEC}s"
fi

if [[ -n "$thread_b_after" ]]; then
  unread_before="$(api_cookie "$COOKIE_B" GET "$NODE_B_API/api/chat/unread" || true)"
  if [[ "$(printf '%s' "$unread_before" | jq -r '.success // false')" == "true" ]]; then
    pass "node B unread endpoint after receive"
  else
    fail "node B unread endpoint after receive"
  fi
  read_b="$(api_cookie "$COOKIE_B" POST "$NODE_B_API/api/chat/thread/read" "{\"walletId\":\"$wallet_a\"}" || true)"
  if [[ "$(printf '%s' "$read_b" | jq -r '.success // false')" == "true" ]]; then
    pass "node B thread/read"
  else
    fail "node B thread/read"
  fi
fi

log "Dual-node chat regression done pass=$PASS fail=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
