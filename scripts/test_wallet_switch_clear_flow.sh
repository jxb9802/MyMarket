#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$BASE_DIR"

OUT_DIR="$BASE_DIR/data/diagnostics"
TS="$(date +%Y%m%d-%H%M%S)"
REPORT="$OUT_DIR/test-wallet-switch-clear-$TS.log"
COOKIE_JAR="/tmp/bsv_market_wallet_switch_test_cookie.txt"
TMP_BACKUP_DIR="$(mktemp -d /tmp/bsv_market_walletswitch_backup.XXXXXX)"
TEST_PASSWORD="TmpTest!${TS}"

mkdir -p "$OUT_DIR"
: >"$REPORT"

log() {
  printf '[%s] %s\n' "$(date +'%F %T')" "$1" | tee -a "$REPORT"
}

restore_data() {
  log "restoring backup files"
  for f in keystore.json wallet_state.json cache.json state.json anchors_global.json; do
    if [[ -f "$TMP_BACKUP_DIR/$f" ]]; then
      cp -f "$TMP_BACKUP_DIR/$f" "$BASE_DIR/data/$f"
    else
      rm -f "$BASE_DIR/data/$f"
    fi
  done
  ./market_ctl.sh restart >>"$REPORT" 2>&1 || true
  rm -rf "$TMP_BACKUP_DIR" >/dev/null 2>&1 || true
  rm -f "$COOKIE_JAR" >/dev/null 2>&1 || true
}

trap restore_data EXIT

log "backup current wallet+market files -> $TMP_BACKUP_DIR"
for f in keystore.json wallet_state.json cache.json state.json anchors_global.json; do
  if [[ -f "$BASE_DIR/data/$f" ]]; then
    cp -f "$BASE_DIR/data/$f" "$TMP_BACKUP_DIR/$f"
  fi
done

log "restart service before test"
./market_ctl.sh restart >>"$REPORT" 2>&1

log "seed local state with fake data to validate clear action"
tmp_json="$(mktemp)"
jq '.categories=[{"id":"c-test","name":"T","merchantId":"m-local"}]
    | .products=[{"id":"p-test","title":"T","merchantId":"m-local","categoryId":"c-test","price":1,"stock":1}]
    | .orders=[{"id":"o-test","status":"PLACED"}]
    | .anchors=[{"txid":"tx-test","eventType":"product_add","payload":{"id":"p-test"}}]
    | .localChanges={seq:2,queue:[{"id":"chg-test","status":"pending","targetType":"product","targetId":"p-test","eventType":"product_add","payload":{"id":"p-test"}}]}' \
    "$BASE_DIR/data/state.json" > "$tmp_json"
mv "$tmp_json" "$BASE_DIR/data/state.json"

log "restart service to load seeded state"
./market_ctl.sh restart >>"$REPORT" 2>&1

log "call wallet/switch mode=create"
curl -sS -c "$COOKIE_JAR" -b "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d "{\"password\":\"$TEST_PASSWORD\",\"mnemonic\":\"\",\"mode\":\"create\"}" \
  http://127.0.0.1:8091/api/wallet/switch > /tmp/test_wallet_switch_clear_flow.switch.json

if ! jq -e '.success == true' /tmp/test_wallet_switch_clear_flow.switch.json >/dev/null 2>&1; then
  log "FAIL: wallet/switch did not return success"
  cat /tmp/test_wallet_switch_clear_flow.switch.json | tee -a "$REPORT"
  exit 1
fi

log "read state after wallet/switch"
curl -sS http://127.0.0.1:8091/api/state > /tmp/test_wallet_switch_clear_flow.state.json

CATS="$(jq -r '.state.categories|length' /tmp/test_wallet_switch_clear_flow.state.json)"
PRODS="$(jq -r '.state.products|length' /tmp/test_wallet_switch_clear_flow.state.json)"
ORDS="$(jq -r '.state.orders|length' /tmp/test_wallet_switch_clear_flow.state.json)"
PENDING="$(jq -r '.state.sync.pendingUploads // 0' /tmp/test_wallet_switch_clear_flow.state.json)"

log "post-switch counts: categories=$CATS products=$PRODS orders=$ORDS pending=$PENDING"

if [[ "$ORDS" != "0" ]]; then
  log "FAIL: orders not cleared"
  exit 1
fi

if [[ "$PENDING" != "0" ]]; then
  log "FAIL: pending uploads not cleared"
  exit 1
fi

if [[ "$CATS" == "0" && "$PRODS" == "0" ]]; then
  log "PASS: local market data cleared after wallet/switch"
else
  log "INFO: categories/products reloaded from chain for the switched wallet (acceptable)"
fi

log "PASS: wallet switch clear-flow test completed"
log "report=$REPORT"
