#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

OUT_DIR="$BASE_DIR/data/diagnostics"
TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/regression-wallet-sync-core-$TS.log"
COOKIE_JAR="/tmp/bsv_market_reg_wallet_sync_cookie.txt"
TMP_BACKUP_DIR="$(mktemp -d /tmp/bsv_market_reg_walletsync_backup.XXXXXX)"
STATE_FILE="$BASE_DIR/data/state.json"
DEBUG_LOG_FILE="$BASE_DIR/data/market-debug.log"
BOOTSTRAP_HEIGHT="${BSV_MARKET_BOOTSTRAP_HEIGHT:-947111}"
TEST_PASSWORD="RegWS!${TS}"

PASS=0
FAIL=0
RUNTIME_SKIPPED=0

mkdir -p "$OUT_DIR"
: >"$REPORT"

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

restore_data() {
  log "restore backup files"
  for f in keystore.json wallet_state.json cache.json state.json anchors_global.json market-debug.log; do
    if [[ -f "$TMP_BACKUP_DIR/$f" ]]; then
      cp -f "$TMP_BACKUP_DIR/$f" "$BASE_DIR/data/$f"
    else
      rm -f "$BASE_DIR/data/$f"
    fi
  done
  "$BASE_DIR/market_ctl.sh" restart >>"$REPORT" 2>&1 || true
  rm -rf "$TMP_BACKUP_DIR" >/dev/null 2>&1 || true
  rm -f "$COOKIE_JAR" >/dev/null 2>&1 || true
}

trap restore_data EXIT

assert_code_pattern() {
  local name="$1"
  local pattern="$2"
  if rg -n "$pattern" "$BASE_DIR/server_market.js" >/dev/null 2>&1; then
    pass "$name"
  else
    fail "$name (pattern: $pattern)"
  fi
}

assert_jq_file() {
  local name="$1"
  local expr="$2"
  local file="$3"
  if jq -e "$expr" "$file" >/dev/null 2>&1; then
    pass "$name"
  else
    fail "$name"
  fi
}

log "wallet/sync core regression started"
log "report=$REPORT"

log "backup current files -> $TMP_BACKUP_DIR"
for f in keystore.json wallet_state.json cache.json state.json anchors_global.json market-debug.log; do
  if [[ -f "$BASE_DIR/data/$f" ]]; then
    cp -f "$BASE_DIR/data/$f" "$TMP_BACKUP_DIR/$f"
  fi
done

log "phase 1: static regression guards"
assert_code_pattern "wallet switch/create/recover disable sync hint inheritance" "preserveSyncHints: false"
assert_code_pattern "catalog sync invokes mergeAnchorsFromChain" "mergeAnchorsFromChain\\(req, state, \\{"
assert_code_pattern "catalog sync enables global cache merge" "includeGlobalCache: true"
assert_code_pattern "wallet reset clears fixed sync cursor" "fresh\\.sync\\.fixedSyncLastHeight = null"
assert_code_pattern "wallet reset local height set to bootstrap-1" "fresh\\.sync\\.localHeight = Math\\.max\\(0, fresh\\.sync\\.bootstrapHeight - 1\\)"
assert_code_pattern "sync epoch stale cancellation log exists" "p2p_sync_cancelled_stale_epoch"
assert_code_pattern "inflight epoch isolation exists" "catalogSyncInFlightEpoch"

log "phase 2: runtime regression checks"
"$BASE_DIR/market_ctl.sh" restart >>"$REPORT" 2>&1 || true

probe_code="$(curl -sS -o /tmp/reg_walletsync_probe.json -w '%{http_code}' http://127.0.0.1:8091/api/state || echo '000')"
if [[ "$probe_code" == "200" ]]; then
  pass "service probe ok"
else
  fail "service probe failed (HTTP $probe_code)"
  RUNTIME_SKIPPED=1
fi

if [[ "$RUNTIME_SKIPPED" == "0" && -f "$STATE_FILE" ]]; then
  tmp_json="$(mktemp)"
  jq '
    .sync.localHeight = 999999
    | .sync.networkHeight = 999999
    | .sync.fixedSyncLastHeight = 999999
    | .sync.p2pHeaderCursorHeight = 999999
    | .sync.p2pHeaderCursorHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    | .sync.p2pTipHeight = 999999
    | .sync.p2pTipHash = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    | .sync.p2pHeightHashCache = {"999999":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}
    | .categories = [{"id":"c-reg","name":"REG","merchantId":"m-reg"}]
    | .products = [{"id":"p-reg","title":"REG","merchantId":"m-reg","categoryId":"c-reg","price":1,"stock":1}]
    | .orders = [{"id":"o-reg","status":"PLACED"}]
    | .anchors = [{"txid":"tx-reg","eventType":"product_add","payload":{"id":"p-reg"}}]
  ' "$STATE_FILE" > "$tmp_json"
  mv "$tmp_json" "$STATE_FILE"
  "$BASE_DIR/market_ctl.sh" restart >>"$REPORT" 2>&1 || true
fi

if [[ "$RUNTIME_SKIPPED" == "0" ]]; then
  rm -f "$COOKIE_JAR"
  switch_code="$(curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" -H 'Content-Type: application/json' \
    -d "{\"password\":\"$TEST_PASSWORD\",\"mnemonic\":\"\",\"mode\":\"create\"}" \
    -o /tmp/reg_walletsync_switch.json -w '%{http_code}' \
    http://127.0.0.1:8091/api/wallet/switch || echo '000')"

  if [[ "$switch_code" == "200" ]]; then
    pass "wallet/switch create API reachable"
  else
    fail "wallet/switch create failed (HTTP $switch_code)"
  fi

  if [[ "$switch_code" == "200" ]]; then
    assert_jq_file "wallet/switch success=true" '.success == true' /tmp/reg_walletsync_switch.json
    assert_jq_file "wallet/switch immediate categories cleared" '(.state.categories|length) == 0' /tmp/reg_walletsync_switch.json
    assert_jq_file "wallet/switch immediate products cleared" '(.state.products|length) == 0' /tmp/reg_walletsync_switch.json
    assert_jq_file "wallet/switch immediate orders cleared" '(.state.orders|length) == 0' /tmp/reg_walletsync_switch.json
    assert_jq_file "wallet/switch localHeight reset to bootstrap-1" ".state.sync.localHeight == (($BOOTSTRAP_HEIGHT|tonumber)-1)" /tmp/reg_walletsync_switch.json
    assert_jq_file "wallet/switch bootstrap set" ".state.sync.bootstrapHeight == ($BOOTSTRAP_HEIGHT|tonumber)" /tmp/reg_walletsync_switch.json
  fi

  curl -sS -X POST http://127.0.0.1:8091/api/catalog/sync >/tmp/reg_walletsync_catalog_sync.json || true

  scheduler_ok=0
  if [[ "$switch_code" == "200" ]]; then
    for _ in $(seq 1 20); do
      sleep 1
      if [[ ! -f "$DEBUG_LOG_FILE" ]]; then
        continue
      fi
      switch_line="$(grep -n '"event":"wallet_switch_sync_start"' "$DEBUG_LOG_FILE" | tail -n 1 | cut -d: -f1 || true)"
      if [[ -z "$switch_line" ]]; then
        continue
      fi
      scheduler_line="$(sed -n "${switch_line},\$p" "$DEBUG_LOG_FILE" | grep -m1 '"event":"p2p_sync_scheduler"' || true)"
      if [[ -z "$scheduler_line" ]]; then
        continue
      fi
      sched_start="$(printf '%s' "$scheduler_line" | jq -r '.startHeight // empty' 2>/dev/null || true)"
      sched_boot="$(printf '%s' "$scheduler_line" | jq -r '.bootstrapHeight // empty' 2>/dev/null || true)"
      if [[ "$sched_start" == "$BOOTSTRAP_HEIGHT" && "$sched_boot" == "$BOOTSTRAP_HEIGHT" ]]; then
        scheduler_ok=1
        break
      fi
    done
  fi

  if [[ "$scheduler_ok" == "1" ]]; then
    pass "wallet switch sync starts from bootstrap height"
  else
    fail "wallet switch sync did not confirm bootstrap start in logs"
  fi

  sync_code="$(curl -sS http://127.0.0.1:8091/api/sync/status -o /tmp/reg_walletsync_sync_status.json -w '%{http_code}' || echo '000')"
  if [[ "$sync_code" == "200" ]]; then
    pass "sync status reachable"
    assert_jq_file "sync status bootstrap height consistent" ".sync.bootstrapHeight == ($BOOTSTRAP_HEIGHT|tonumber)" /tmp/reg_walletsync_sync_status.json
  else
    fail "sync status unreachable (HTTP $sync_code)"
  fi
else
  log "runtime checks skipped due to service unavailable"
fi

log "phase 3: post-sync data path regression guard (static)"
assert_code_pattern "runtime sync round merges with global cache" "includeGlobalCache: true"
assert_code_pattern "wallet switch deferred sync requests steward wake-up" "notifyStewardSyncNow\\(\\)"

log "wallet/sync core regression completed: pass=$PASS fail=$FAIL"
log "report=$REPORT"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
exit 0
