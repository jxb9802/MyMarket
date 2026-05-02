#!/usr/bin/env bash
set -u

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$BASE_DIR/data/diagnostics"
TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/regression-chain-sync-push-$TS.log"
COOKIE_JAR="/tmp/bsv_market_reg_chain_cookie.txt"

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

api_json() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS --max-time 25 -X "$method" "$url" -H 'Content-Type: application/json' -d "$body"
  else
    curl -sS --max-time 25 -X "$method" "$url"
  fi
}

api_json_cookie() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS --max-time 25 -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" "$url" -H 'Content-Type: application/json' -d "$body"
  else
    curl -sS --max-time 25 -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" "$url"
  fi
}

log "Chain+Sync regression started"
log "report=$REPORT"

# 0) service probe
probe_code="$(curl -sS -o /tmp/bsv_chain_probe.json -w '%{http_code}' --max-time 5 http://127.0.0.1:8091/api/state || echo '000')"
if [[ "$probe_code" != "200" ]]; then
  "$BASE_DIR/market_ctl.sh" restart >>"$REPORT" 2>&1 || true
  sleep 1
  probe_code="$(curl -sS -o /tmp/bsv_chain_probe.json -w '%{http_code}' --max-time 5 http://127.0.0.1:8091/api/state || echo '000')"
fi
if [[ "$probe_code" == "200" ]]; then pass "service probe"; else fail "service probe http=$probe_code"; fi

# 1) preview endpoint
api_json "GET" "http://127.0.0.1:8091/api/changes/preview" > /tmp/bsv_chain_preview.json || true
if jq -e '.success == true' /tmp/bsv_chain_preview.json >/dev/null 2>&1; then pass "changes preview reachable"; else fail "changes preview failed"; fi
if jq -e 'has("pendingUploads") and has("pendingDetails") and has("estimatedTotalFeeSat")' /tmp/bsv_chain_preview.json >/dev/null 2>&1; then pass "preview fields present"; else fail "preview fields missing"; fi

# 2) sync progression check
api_json "GET" "http://127.0.0.1:8091/api/state" > /tmp/bsv_chain_state_before.json || true
before_last="$(jq -r '.state.sync.fixedSyncLastHeight // -1' /tmp/bsv_chain_state_before.json 2>/dev/null || echo -1)"
before_local="$(jq -r '.state.sync.localHeight // -1' /tmp/bsv_chain_state_before.json 2>/dev/null || echo -1)"
before_network="$(jq -r '.state.sync.networkHeight // -1' /tmp/bsv_chain_state_before.json 2>/dev/null || echo -1)"
log "sync before: fixedLast=$before_last local=$before_local network=$before_network"

api_json "POST" "http://127.0.0.1:8091/api/catalog/sync" "{}" > /tmp/bsv_chain_sync_1.json || true
if jq -e '.success == true' /tmp/bsv_chain_sync_1.json >/dev/null 2>&1; then pass "catalog sync #1 success"; else fail "catalog sync #1 failed"; fi

api_json "POST" "http://127.0.0.1:8091/api/catalog/sync" "{}" > /tmp/bsv_chain_sync_2.json || true
if jq -e '.success == true' /tmp/bsv_chain_sync_2.json >/dev/null 2>&1; then pass "catalog sync #2 success"; else fail "catalog sync #2 failed"; fi

after_last="$(jq -r '.state.sync.fixedSyncLastHeight // -1' /tmp/bsv_chain_sync_2.json 2>/dev/null || echo -1)"
after_local="$(jq -r '.state.sync.localHeight // -1' /tmp/bsv_chain_sync_2.json 2>/dev/null || echo -1)"
after_network="$(jq -r '.state.sync.networkHeight // -1' /tmp/bsv_chain_sync_2.json 2>/dev/null || echo -1)"
log "sync after: fixedLast=$after_last local=$after_local network=$after_network"

if [[ "$after_last" =~ ^-?[0-9]+$ ]] && [[ "$before_last" =~ ^-?[0-9]+$ ]] && (( after_last >= before_last )); then
  pass "fixed height cursor non-decreasing"
else
  fail "fixed height cursor regression"
fi

if [[ "$after_local" =~ ^-?[0-9]+$ ]] && [[ "$after_network" =~ ^-?[0-9]+$ ]] && (( after_network >= after_local )); then
  pass "sync height relation valid"
else
  fail "sync height relation invalid"
fi

# 3) push path checks
unauth_code="$(curl -sS --max-time 10 -X POST http://127.0.0.1:8091/api/changes/push -H 'Content-Type: application/json' -d '{"password":"x"}' -o /tmp/bsv_chain_push_unauth.json -w '%{http_code}' || echo '000')"
if [[ "$unauth_code" == "401" ]]; then
  pass "changes push protected by auth"
else
  fail "changes push auth boundary expected 401 got $unauth_code"
fi

if [[ -n "${TEST_WALLET_PASSWORD:-}" ]]; then
  rm -f "$COOKIE_JAR"
  api_json_cookie "POST" "http://127.0.0.1:8091/api/auth/login" "{\"password\":\"${TEST_WALLET_PASSWORD}\"}" > /tmp/bsv_chain_login.json || true
  if jq -e '.success == true' /tmp/bsv_chain_login.json >/dev/null 2>&1; then
    pass "wallet login success (password provided)"
    api_json_cookie "POST" "http://127.0.0.1:8091/api/changes/push" "{\"password\":\"${TEST_WALLET_PASSWORD}\"}" > /tmp/bsv_chain_push_auth.json || true
    if jq -e '.success == true and has("uploaded") and has("failed") and has("totalFeeSat")' /tmp/bsv_chain_push_auth.json >/dev/null 2>&1; then
      pass "authenticated push API path success"
    else
      fail "authenticated push API path failed"
    fi
  else
    fail "wallet login failed (provided password)"
  fi
else
  log "skip authenticated push: TEST_WALLET_PASSWORD not provided"
fi

log "Chain+Sync regression done pass=$PASS fail=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
