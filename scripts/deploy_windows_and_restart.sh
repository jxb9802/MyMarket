#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_URL="${DEPLOY_AGENT_URL:-}"
AGENT_HOST="${DEPLOY_AGENT_HOST_TARGET:-${BSV_MARKET_WINDOWS_AGENT_HOST:-}}"
AGENT_PORT="${DEPLOY_AGENT_PORT_TARGET:-${BSV_MARKET_WINDOWS_AGENT_PORT:-18766}}"
TOKEN="${DEPLOY_AGENT_TOKEN:-local-dev-token}"

if [[ -z "${AGENT_URL}" ]]; then
  if [[ -z "${AGENT_HOST}" ]]; then
    cat >&2 <<'EOF'
Windows deploy agent URL is not configured.

Start the Windows agent first:
  cd deploy_agent_v2
  bootstrap_agent.bat

Then run this script with either:
  DEPLOY_AGENT_URL=http://WindowsIP:18766 scripts/deploy_windows_and_restart.sh

or:
  BSV_MARKET_WINDOWS_AGENT_HOST=WindowsIP scripts/deploy_windows_and_restart.sh
EOF
    exit 1
  fi
  AGENT_URL="http://${AGENT_HOST}:${AGENT_PORT}"
fi

cd "${ROOT_DIR}/deploy_agent_v2"
node client.js deploy-bsv-market \
  --url "${AGENT_URL}" \
  --token "${TOKEN}" \
  --source "${ROOT_DIR}"
