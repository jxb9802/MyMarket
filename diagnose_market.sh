#!/usr/bin/env bash
set -u

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="$BASE_DIR/data"
DIAG_DIR="$DATA_DIR/diagnostics"
ENV_FILE="$BASE_DIR/.env.market"
PORT_DEFAULT="8091"
PORT="$PORT_DEFAULT"
TMP_RUN_LOG="/tmp/bsv_market_run.log"
MARKET_DEBUG_LOG="$DATA_DIR/market-debug.log"
TS="$(date +%Y%m%d-%H%M%S)"
OUT_LOG="$DIAG_DIR/diagnose-$TS.log"
STATE_BODY="$DIAG_DIR/api-state-$TS.json"
PENDING_BODY="$DIAG_DIR/api-debug-pending-$TS.json"
INDEX_HEADERS="$DIAG_DIR/http-index-$TS.headers"
JS_HEADERS="$DIAG_DIR/http-demojs-$TS.headers"

RESTART=0
if [[ "${1:-}" == "--restart" ]]; then
  RESTART=1
fi

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
PORT="${BSV_MARKET_PORT:-$PORT_DEFAULT}"

mkdir -p "$DIAG_DIR"
touch "$OUT_LOG"

log() {
  local msg="$1"
  printf '[%s] %s\n' "$(date +'%F %T')" "$msg" | tee -a "$OUT_LOG"
}

run_cmd() {
  local title="$1"
  shift
  log "=== $title ==="
  {
    echo "+ $*"
    "$@"
  } >>"$OUT_LOG" 2>&1
  local code=$?
  log "$title exit_code=$code"
  return 0
}

probe_http() {
  local url="$1"
  local headers_file="$2"
  local body_file="$3"
  log "HTTP GET $url"
  if curl -sS -D "$headers_file" -o "$body_file" "$url" >>"$OUT_LOG" 2>&1; then
    local status_line
    status_line="$(head -n 1 "$headers_file" 2>/dev/null || true)"
    log "HTTP OK: $status_line"
  else
    log "HTTP FAIL: $url"
  fi
}

log "diagnose_market.sh started"
log "base_dir=$BASE_DIR"
log "output_log=$OUT_LOG"
log "usage: ./diagnose_market.sh [--restart]"

run_cmd "Node syntax check" bash -lc "cd '$BASE_DIR' && node --check server_market.js && node --check app.js && node --check wallet.js"
run_cmd "Node process list" bash -lc "ps -ef | grep 'server_market.js' | grep -v grep || true"
run_cmd "Port listener check" bash -lc "ss -ltn | grep $PORT || true"

if [[ "$RESTART" -eq 1 ]]; then
  log "=== Restart server ==="
  run_cmd "Kill existing server process" bash -lc "pkill -9 -f '$BASE_DIR/server_market.js' || true; pkill -9 -f '$BASE_DIR/steward_subprocess.js' || true"
  run_cmd "Start server with nohup" bash -lc "cd '$BASE_DIR' && nohup node server_market.js >'$TMP_RUN_LOG' 2>&1 &"
  run_cmd "Wait 1s after restart" sleep 1
  run_cmd "Process list after restart" bash -lc "ps -ef | grep 'server_market.js' | grep -v grep || true"
  run_cmd "Port listener after restart" bash -lc "ss -ltn | grep $PORT || true"
fi

probe_http "http://127.0.0.1:$PORT/index.html" "$INDEX_HEADERS" "$DIAG_DIR/http-index-$TS.body"
probe_http "http://127.0.0.1:$PORT/app.js" "$JS_HEADERS" "$DIAG_DIR/http-appjs-$TS.body"
probe_http "http://127.0.0.1:$PORT/api/state" "$DIAG_DIR/http-state-$TS.headers" "$STATE_BODY"
probe_http "http://127.0.0.1:$PORT/api/debug/pending" "$DIAG_DIR/http-pending-$TS.headers" "$PENDING_BODY"

if command -v jq >/dev/null 2>&1; then
  log "=== API summary (jq) ==="
  {
    echo "state summary:"
    jq '{success, pending: .state.sync.pendingUploads, pendingDetails: (.state.sync.pendingDetails|length), categories:(.state.categories|length), products:(.state.products|length)}' "$STATE_BODY" 2>/dev/null || true
    echo
    echo "pending debug summary:"
    jq '{success, queueSize, pendingSize, categories:(.categories|length), products:(.products|length)}' "$PENDING_BODY" 2>/dev/null || true
  } >>"$OUT_LOG" 2>&1
else
  log "jq not found; skip JSON summary"
fi

run_cmd "Asset files listing" bash -lc "cd '$BASE_DIR' && ls -l index.html app.js demo.css"
run_cmd "Tail /tmp run log" bash -lc "tail -n 120 '$TMP_RUN_LOG' 2>/dev/null || true"
run_cmd "Tail market debug log" bash -lc "tail -n 120 '$MARKET_DEBUG_LOG' 2>/dev/null || true"
run_cmd "Error keyword scan in run log" bash -lc "grep -nE 'NotFoundError|EADDRINUSE|SyntaxError|ERR_|ECONN|404|500' '$TMP_RUN_LOG' 2>/dev/null || true"
run_cmd "Error keyword scan in market debug" bash -lc "grep -nE 'asset_missing|asset_send_error|asset_read_error|push_item_failed|queue_merge_drop|state_loaded|state_saved' '$MARKET_DEBUG_LOG' 2>/dev/null || true"

log "diagnose completed"
log "main report: $OUT_LOG"
log "state body: $STATE_BODY"
log "pending body: $PENDING_BODY"

cat <<EOF

Diagnostic completed.
Main report:
  $OUT_LOG

Raw API outputs:
  $STATE_BODY
  $PENDING_BODY

Tip:
  Run with restart:
    ./diagnose_market.sh --restart
EOF
