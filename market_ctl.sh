#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$BASE_DIR/log"
PID_FILE="/tmp/bsv_market.pid"
LOG_FILE="$LOG_DIR/bsv_market_run.log"
ENV_FILE="$BASE_DIR/.env.market"
PORT_DEFAULT="8091"
STOP_WAIT_SEC="${BSV_MARKET_STOP_WAIT_SEC:-8}"
LINUX_DATA_DIR_DEFAULT="${BSV_MARKET_LINUX_DATA_DIR:-$HOME/.openclaw/workspace/app/bsv_market/data}"

IS_WINDOWS_SHELL=0
case "$(uname -s 2>/dev/null || echo '')" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS_SHELL=1 ;;
esac

if [[ "$IS_WINDOWS_SHELL" == "1" && -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi
PORT="${BSV_MARKET_PORT:-$PORT_DEFAULT}"
START_HEALTH_WAIT_SEC="${BSV_MARKET_START_HEALTH_WAIT_SEC:-20}"

is_running() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && ps -p "$pid" >/dev/null 2>&1; then
      return 0
    fi
  fi
  return 1
}

is_healthy() {
  if ! is_running; then
    return 1
  fi
  curl -sS -m 2 "http://127.0.0.1:${PORT}/api/state-lite" >/dev/null 2>&1
}

kill_stray_processes() {
  pkill -9 -f "$BASE_DIR/server_market.js" >/dev/null 2>&1 || true
  pkill -9 -f "$BASE_DIR/chat_service_subprocess.js" >/dev/null 2>&1 || true
  pkill -9 -f "$BASE_DIR/steward_subprocess.js" >/dev/null 2>&1 || true
  pkill -9 -f "$BASE_DIR/view_state_subprocess.js" >/dev/null 2>&1 || true
  # Some manual launches have argv like "node server_market.js" without BASE_DIR.
  # Kill only matching processes whose cwd is this workspace.
  while read -r pid; do
    [[ -n "${pid:-}" ]] || continue
    local cwd
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
    if [[ "$cwd" == "$BASE_DIR" ]]; then
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done < <(pgrep -f "node server_market\\.js" 2>/dev/null || true)
}

kill_pid_if_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 0
  ps -p "$pid" >/dev/null 2>&1 || return 0
  kill "$pid" >/dev/null 2>&1 || true
  local waited=0
  while (( waited < STOP_WAIT_SEC )); do
    ps -p "$pid" >/dev/null 2>&1 || return 0
    sleep 1
    waited=$((waited + 1))
  done
  kill -9 "$pid" >/dev/null 2>&1 || true
}

kill_processes_on_port() {
  local pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  if [[ -z "$pids" ]] && command -v fuser >/dev/null 2>&1; then
    pids="$(fuser "${PORT}/tcp" 2>/dev/null || true)"
  fi
  for pid in $pids; do
    kill_pid_if_alive "$pid"
  done
}

wait_port_free() {
  local waited=0
  while (( waited < STOP_WAIT_SEC )); do
    if curl -sS -m 1 "http://127.0.0.1:${PORT}/api/state-lite" >/dev/null 2>&1; then
      sleep 1
      waited=$((waited + 1))
      continue
    fi
    return 0
  done
  kill_processes_on_port
}

choose_log_file() {
  local candidate="$LOG_FILE"
  mkdir -p "$LOG_DIR"
  if (: >>"$candidate") 2>/dev/null; then
    printf '%s\n' "$candidate"
    return 0
  fi
  candidate="$LOG_DIR/bsv_market_run_$(date +%Y%m%d_%H%M%S).log"
  : >>"$candidate"
  printf '%s\n' "$candidate"
}

start_server() {
  if is_running; then
    if is_healthy; then
      echo "bsv_market already running and healthy (pid=$(cat "$PID_FILE"))."
      return 0
    fi
    echo "bsv_market process exists but unhealthy, restarting..."
    stop_server
  fi
  # Ensure no stale sibling process from manual/nohup runs remains.
  kill_stray_processes
  kill_processes_on_port
  wait_port_free
  cd "$BASE_DIR"
  mkdir -p "$LOG_DIR"
  if [[ "$IS_WINDOWS_SHELL" != "1" ]]; then
    if [[ -d "$LINUX_DATA_DIR_DEFAULT" ]]; then
      export BSV_MARKET_DATA_DIR="${BSV_MARKET_DATA_DIR:-$LINUX_DATA_DIR_DEFAULT}"
      export BSV_MARKET_DB_DIR="${BSV_MARKET_DB_DIR:-$BSV_MARKET_DATA_DIR}"
    else
      unset BSV_MARKET_DATA_DIR
      unset BSV_MARKET_DB_DIR
    fi
    export BSV_MARKET_LOG_DIR="${BSV_MARKET_LOG_DIR:-$LOG_DIR}"
  fi
  local run_log_file
  run_log_file="$(choose_log_file)"
  # Detach from terminal/session to avoid being cleaned up with parent shell.
  BSV_MARKET_DB_TIMEOUT_MS="${BSV_MARKET_DB_TIMEOUT_MS:-30000}" setsid nohup node server_market.js >>"$run_log_file" 2>&1 < /dev/null &
  local pid=$!
  echo "$pid" > "$PID_FILE"
  local waited=0
  while (( waited < START_HEALTH_WAIT_SEC )); do
    if ! ps -p "$pid" >/dev/null 2>&1; then
      echo "bsv_market failed to start, check $run_log_file"
      exit 1
    fi
    if is_healthy; then
      echo "bsv_market started and healthy (pid=$pid), log=$run_log_file"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  if ps -p "$pid" >/dev/null 2>&1; then
    echo "bsv_market started (pid=$pid) but not healthy after ${START_HEALTH_WAIT_SEC}s, log=$run_log_file"
    return 1
  else
    echo "bsv_market failed to start, check $run_log_file"
    exit 1
  fi
}

stop_server() {
  local had_running=0
  if is_running; then
    had_running=1
    kill_pid_if_alive "$(cat "$PID_FILE")"
  fi
  # Clean up any unmanaged stale processes and any process still holding the port.
  kill_stray_processes
  kill_processes_on_port
  wait_port_free
  rm -f "$PID_FILE"
  if [[ "$had_running" == "1" ]]; then
    echo "bsv_market stopped."
  else
    echo "bsv_market is not running."
  fi
}

status_server() {
  if is_healthy; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "running+healthy (pid=$pid)"
  elif is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "running+unhealthy (pid=$pid)"
  else
    echo "stopped"
  fi
}

probe_server() {
  curl -sS -m 2 -i "http://127.0.0.1:${PORT}/api/state-lite" | head -n 5 || true
}

case "${1:-}" in
  start) start_server ;;
  stop) stop_server ;;
  restart) stop_server; start_server ;;
  status) status_server ;;
  probe) probe_server ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|probe}"
    exit 1
    ;;
esac
