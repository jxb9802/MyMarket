#!/usr/bin/env bash
set -u

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$BASE_DIR/data/diagnostics"
TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/regression-thirdparty-$TS.log"
COOKIE_JAR="/tmp/bsv_market_regression_cookie.txt"

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

expect_http() {
  local name="$1"
  local method="$2"
  local url="$3"
  local body="${4:-}"
  local expected="$5"
  local got
  if [[ -n "$body" ]]; then
    got="$(curl -sS -X "$method" "$url" -H 'Content-Type: application/json' -d "$body" -o /tmp/bsv_reg_body.json -w '%{http_code}' || echo '000')"
  else
    got="$(curl -sS -X "$method" "$url" -o /tmp/bsv_reg_body.json -w '%{http_code}' || echo '000')"
  fi
  if [[ "$got" == "$expected" ]]; then
    pass "$name (HTTP $got)"
  else
    fail "$name expected HTTP $expected got $got"
    cat /tmp/bsv_reg_body.json >>"$REPORT" 2>/dev/null || true
  fi
}

expect_http_cookie() {
  local name="$1"
  local method="$2"
  local url="$3"
  local body="${4:-}"
  local expected="$5"
  local got
  if [[ -n "$body" ]]; then
    got="$(curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" "$url" -H 'Content-Type: application/json' -d "$body" -o /tmp/bsv_reg_body.json -w '%{http_code}' || echo '000')"
  else
    got="$(curl -sS -b "$COOKIE_JAR" -c "$COOKIE_JAR" -X "$method" "$url" -o /tmp/bsv_reg_body.json -w '%{http_code}' || echo '000')"
  fi
  if [[ "$got" == "$expected" ]]; then
    pass "$name (HTTP $got)"
  else
    fail "$name expected HTTP $expected got $got"
    cat /tmp/bsv_reg_body.json >>"$REPORT" 2>/dev/null || true
  fi
}

assert_jq() {
  local name="$1"
  local expr="$2"
  if jq -e "$expr" /tmp/bsv_reg_body.json >/dev/null 2>&1; then
    pass "$name"
  else
    fail "$name"
    cat /tmp/bsv_reg_body.json >>"$REPORT" 2>/dev/null || true
  fi
}

log "Regression started: third-party tools curl+jq+bash"
log "Base dir: $BASE_DIR"

# 0) Ensure service is up.
probe_code="$(curl -sS -o /tmp/bsv_reg_probe.json -w '%{http_code}' http://127.0.0.1:8091/api/state || echo '000')"
if [[ "$probe_code" != "200" ]]; then
  log "service probe got $probe_code, trying restart"
  "$BASE_DIR/market_ctl.sh" restart >>"$REPORT" 2>&1 || true
  sleep 1
  probe_code="$(curl -sS -o /tmp/bsv_reg_probe.json -w '%{http_code}' http://127.0.0.1:8091/api/state || echo '000')"
fi
if [[ "$probe_code" == "200" ]]; then
  pass "service probe (HTTP 200)"
else
  fail "service probe failed (HTTP $probe_code)"
fi

# 1) Static assets / basic APIs.
expect_http "index.html reachable" "GET" "http://127.0.0.1:8091/index.html" "" "200"
expect_http "app.js reachable" "GET" "http://127.0.0.1:8091/app.js" "" "200"
expect_http "api/state reachable" "GET" "http://127.0.0.1:8091/api/state" "" "200"
assert_jq "api/state success=true" '.success == true'
assert_jq "api/state has sync pending fields" '.state.sync | has("pendingUploads") and has("pendingDetails")'
assert_jq "api/state has fee estimate fields" '.state.sync | has("pendingEstimatedFeeSat") and has("maxPayloadBytes")'
assert_jq "pending count matches details length" '(.state.sync.pendingUploads|tonumber) == (.state.sync.pendingDetails|length)'

expect_http "api/debug/pending reachable" "GET" "http://127.0.0.1:8091/api/debug/pending" "" "200"
assert_jq "api/debug/pending success=true" '.success == true'
assert_jq "api/debug/pending counts sane" '(.queueSize|tonumber) >= (.pendingSize|tonumber)'

expect_http "api/changes/preview reachable" "GET" "http://127.0.0.1:8091/api/changes/preview" "" "200"
assert_jq "api/changes/preview success=true" '.success == true'
assert_jq "api/changes/preview has estimate" 'has("estimatedTotalFeeSat") and has("pendingDetails")'
assert_jq "api/changes/preview count matches details" '(.pendingUploads|tonumber) == (.pendingDetails|length)'

expect_http "api/wallet/status reachable" "GET" "http://127.0.0.1:8091/api/wallet/status" "" "200"
assert_jq "api/wallet/status success=true" '.success == true'

# 2) Auth boundary checks (no mutation risk).
expect_http "wallet balance requires auth" "GET" "http://127.0.0.1:8091/api/wallet/balance" "" "401"
assert_jq "wallet balance unauthorized shape" '.success == false'

expect_http "changes push requires auth" "POST" "http://127.0.0.1:8091/api/changes/push" '{"password":""}' "401"
assert_jq "changes push unauthorized shape" '.success == false'

# 3) Session flow smoke test with cookie jar.
rm -f "$COOKIE_JAR"
expect_http_cookie "logout endpoint works" "POST" "http://127.0.0.1:8091/api/auth/logout" "" "200"
assert_jq "logout success=true" '.success == true'
expect_http_cookie "wallet status after logout" "GET" "http://127.0.0.1:8091/api/wallet/status" "" "200"
assert_jq "wallet status loggedIn=false after logout" '.loggedIn == false'

# 4) Frontend static regression checks (source-level).
if rg -n "buyerMerchants\\(\\)" "$BASE_DIR/app.js" >/dev/null 2>&1; then pass "buyer filter function exists"; else fail "buyer filter function missing"; fi
if rg -n "id=\"btnPendingDetails\"" "$BASE_DIR/index.html" >/dev/null 2>&1; then fail "pending-details standalone button still exists"; else pass "pending-details standalone button removed"; fi
if rg -n "btnConfirmPushInModal|pendingFeeSummary|pendingPassword" "$BASE_DIR/index.html" >/dev/null 2>&1; then pass "push modal fields exist"; else fail "push modal fields missing"; fi

log "Regression completed: pass=$PASS fail=$FAIL"
log "Report: $REPORT"
if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
