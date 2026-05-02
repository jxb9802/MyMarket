#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${1:-/home/jb9802/share/bsv_market}"
MANIFEST_FILE="${ROOT_DIR}/scripts/windows_share_manifest.txt"

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync not found" >&2
  exit 1
fi

if [[ ! -f "${MANIFEST_FILE}" ]]; then
  echo "manifest not found: ${MANIFEST_FILE}" >&2
  exit 1
fi

mkdir -p "${TARGET_DIR}"

echo "Deploying program files to ${TARGET_DIR}"
echo "Manifest: ${MANIFEST_FILE}"
echo "Note: update scripts/windows_share_manifest.txt whenever deployable files are added or removed."

set +e
rsync -aL --delete --delete-excluded --prune-empty-dirs \
  --filter='protect /data/***' \
  --filter='protect /log/***' \
  --filter='protect /.env.market' \
  --filter="merge ${MANIFEST_FILE}" \
  "${ROOT_DIR}/" "${TARGET_DIR}/"
status=$?
set -e

mkdir -p "${TARGET_DIR}/data" "${TARGET_DIR}/log"

if [[ ${status} -ne 0 ]]; then
  echo "Deploy incomplete (rsync exit ${status})." >&2
  exit "${status}"
fi

echo "Deploy complete"
