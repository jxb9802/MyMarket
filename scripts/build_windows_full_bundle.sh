#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR_INPUT="${1:-${ROOT_DIR}/dist}"
mkdir -p "${OUT_DIR_INPUT}"
OUT_DIR="$(cd "${OUT_DIR_INPUT}" && pwd)"
APP_NAME="${BSV_MARKET_BUNDLE_NAME:-bsv_market}"
OUT_ZIP="${OUT_DIR}/${APP_NAME}_fullbundle.zip"
STAGE_DIR="$(mktemp -d /tmp/bsv_market_bundle.XXXXXX)"
STAGE_APP="${STAGE_DIR}/${APP_NAME}"
RELEASE_PROTOCOL_VERSION="$(cd "${ROOT_DIR}" && node -p "require('./protocol_release').BSV_MARKET_PROTOCOL_VERSION")"
RELEASE_BOOTSTRAP_HEIGHT="$(cd "${ROOT_DIR}" && node -p "require('./protocol_release').BSV_MARKET_RELEASE_BOOTSTRAP_HEIGHT")"

cleanup() {
  rm -rf "${STAGE_DIR}"
}
trap cleanup EXIT

echo "[1/7] preparing dependencies"
cd "${ROOT_DIR}"
if [ -f package-lock.json ]; then
  npm install --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi

echo "[2/7] validating runtime modules"
node <<'NODE'
const pkg = require('./package.json');
for (const name of Object.keys(pkg.dependencies || {})) {
  require.resolve(name);
}
require('node:sqlite');
const raw = require('bsv');
const bsv = raw && raw.default ? raw.default : raw;
const hd = (bsv && bsv.HDPrivateKey) || (raw && raw.HDPrivateKey) || (raw && raw.default && raw.default.HDPrivateKey);
if (!hd || typeof hd.fromSeed !== 'function') {
  throw new Error('Invalid bsv runtime: HDPrivateKey.fromSeed missing');
}
console.log('runtime check passed');
NODE

echo "[3/7] staging application files"
mkdir -p "${STAGE_APP}"
if command -v rsync >/dev/null 2>&1; then
  rsync -a "${ROOT_DIR}/" "${STAGE_APP}/" \
    --exclude '/.git/' \
    --exclude '/.env*' \
    --exclude '/.tmp*' \
    --exclude '/baselines/' \
    --exclude '/data/' \
    --exclude '/dist/' \
    --exclude '/D:WSLdb/' \
    --exclude '/log/' \
    --exclude '/logs/' \
    --exclude '/memory/' \
    --exclude '**/keystore.json' \
    --exclude '**/wallet_state.json' \
    --exclude '**/spv_index.json' \
    --exclude '**/balance_cache.json' \
    --exclude '**/broadcast_monitor.json' \
    --exclude '**/wallet_send_queue.json' \
    --exclude '**/wallet_sync_state.json' \
    --exclude '**/tx_contexts*.json' \
    --exclude '**/*.db' \
    --exclude '**/*.sqlite' \
    --exclude '/node_modules/**/test/' \
    --exclude '/node_modules/**/tests/' \
    --exclude '/node_modules/**/__tests__/' \
    --exclude '/node_modules/**/benchmark/' \
    --exclude '/market.db' \
    --exclude '*.db-shm' \
    --exclude '*.db-wal' \
    --exclude '/market.sqlite' \
    --exclude '*.sqlite-shm' \
    --exclude '*.sqlite-wal' \
    --exclude '/perf.data' \
    --exclude '/server_market.js.bak.*' \
    --exclude '/deploy_agent_v2/.agent_node/' \
    --exclude '/deploy_agent_v2/.runtime/' \
    --exclude '/node_modules/.cache/'
else
  tar -C "${ROOT_DIR}" \
    --exclude='./.git' \
    --exclude='./.env*' \
    --exclude='./.tmp*' \
    --exclude='./baselines' \
    --exclude='./data' \
    --exclude='./dist' \
    --exclude='./D:WSLdb' \
    --exclude='./log' \
    --exclude='./logs' \
    --exclude='./memory' \
    --exclude='*/keystore.json' \
    --exclude='*/wallet_state.json' \
    --exclude='*/spv_index.json' \
    --exclude='*/balance_cache.json' \
    --exclude='*/broadcast_monitor.json' \
    --exclude='*/wallet_send_queue.json' \
    --exclude='*/wallet_sync_state.json' \
    --exclude='*/tx_contexts*.json' \
    --exclude='*.db' \
    --exclude='*.sqlite' \
    --exclude='./node_modules/*/test' \
    --exclude='./node_modules/*/tests' \
    --exclude='./node_modules/*/__tests__' \
    --exclude='./node_modules/*/benchmark' \
    --exclude='./node_modules/@*/*/test' \
    --exclude='./node_modules/@*/*/tests' \
    --exclude='./node_modules/@*/*/__tests__' \
    --exclude='./node_modules/@*/*/benchmark' \
    --exclude='./market.db' \
    --exclude='*.db-shm' \
    --exclude='*.db-wal' \
    --exclude='./market.sqlite' \
    --exclude='*.sqlite-shm' \
    --exclude='*.sqlite-wal' \
    --exclude='./perf.data' \
    --exclude='./server_market.js.bak.*' \
    --exclude='./deploy_agent_v2/.agent_node' \
    --exclude='./deploy_agent_v2/.runtime' \
    --exclude='./node_modules/.cache' \
    -cf - . | tar -C "${STAGE_APP}" -xf -
fi
echo "[4/7] writing release metadata"
cat > "${STAGE_APP}/RELEASE.txt" <<EOF
bsv_market full bundle
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
source=${ROOT_DIR}
node_required=24+
protocol_version=${RELEASE_PROTOCOL_VERSION}
bootstrap_height=${RELEASE_BOOTSTRAP_HEIGHT}
start_windows=start.bat
start_linux=start.sh
runtime_data_dir=./data
runtime_log_dir=./log
EOF
echo "portable-full-bundle-v2" > "${STAGE_APP}/.portable_bundle"

echo "[5/7] checking staged server entry"
(cd "${STAGE_APP}" && node --check server_market.js && node --check app.js)
for required in \
  app.js index.html demo.css server_market.js wallet.js package.json package-lock.json \
  start.bat start.sh market_ctl.sh locales/zh.json locales/en.json \
  chat_transport_v2_service.js chat_webrtc_transport.js catalog_routes.js drive_browser_routes.js
do
  if [ ! -e "${STAGE_APP}/${required}" ]; then
    echo "missing required release file: ${required}" >&2
    exit 1
  fi
done

echo "[6/7] creating zip"
mkdir -p "${OUT_DIR}"
rm -f "${OUT_ZIP}" "${OUT_ZIP}.sha256"
cd "${STAGE_DIR}"
zip -r -q "${OUT_ZIP}" "${APP_NAME}"

echo "[7/7] done"
cd "${ROOT_DIR}"
sha256sum "${OUT_ZIP}" | tee "${OUT_ZIP}.sha256"
ls -lh "${OUT_ZIP}"
