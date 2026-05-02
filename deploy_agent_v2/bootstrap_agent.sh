#!/usr/bin/env bash
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_VERSION="${DEPLOY_AGENT_NODE_VERSION:-24.14.0}"
MIN_NODE_VERSION="${DEPLOY_AGENT_MIN_NODE_VERSION:-20.0.0}"
NODE_DIR="${BASE_DIR}/.agent_node"
NODE_BIN="${NODE_DIR}/bin/node"

version_ge() {
  local left="${1#v}"
  local right="${2#v}"
  local IFS=.
  local left_parts=(${left})
  local right_parts=(${right})
  local len="${#left_parts[@]}"
  if [[ "${#right_parts[@]}" -gt "${len}" ]]; then
    len="${#right_parts[@]}"
  fi
  local i l r
  for ((i=0; i<len; i+=1)); do
    l="${left_parts[i]:-0}"
    r="${right_parts[i]:-0}"
    if ((10#${l} > 10#${r})); then
      return 0
    fi
    if ((10#${l} < 10#${r})); then
      return 1
    fi
  done
  return 0
}

host_node_ok() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  local host_version
  host_version="$(node -p "process.version" 2>/dev/null || true)"
  if [[ -z "${host_version}" ]]; then
    return 1
  fi
  version_ge "${host_version}" "${MIN_NODE_VERSION}"
}

detect_platform() {
  local kernel
  kernel="$(uname -s)"
  case "${kernel}" in
    Linux) printf 'linux' ;;
    Darwin) printf 'darwin' ;;
    *)
      printf 'unsupported'
      return 1
      ;;
  esac
}

detect_arch() {
  local machine
  machine="$(uname -m)"
  case "${machine}" in
    x86_64|amd64) printf 'x64' ;;
    arm64|aarch64) printf 'arm64' ;;
    *)
      printf 'unsupported'
      return 1
      ;;
  esac
}

ensure_managed_node() {
  local platform arch tmp_dir archive url extracted_dir
  if [[ -x "${NODE_BIN}" ]]; then
    return 0
  fi
  platform="$(detect_platform)"
  arch="$(detect_arch)"
  tmp_dir="${BASE_DIR}/.agent_node_tmp"
  archive="node-v${NODE_VERSION}-${platform}-${arch}.tar.gz"
  url="https://nodejs.org/dist/v${NODE_VERSION}/${archive}"
  rm -rf "${tmp_dir}"
  mkdir -p "${tmp_dir}"
  curl -fsSL "${url}" -o "${tmp_dir}/${archive}"
  tar -xzf "${tmp_dir}/${archive}" -C "${tmp_dir}"
  extracted_dir="${tmp_dir}/node-v${NODE_VERSION}-${platform}-${arch}"
  if [[ ! -d "${extracted_dir}" ]]; then
    echo "failed to extract managed node from ${archive}" >&2
    exit 1
  fi
  rm -rf "${NODE_DIR}"
  mv "${extracted_dir}" "${NODE_DIR}"
  rm -rf "${tmp_dir}"
}

if host_node_ok; then
  exec node "${BASE_DIR}/agent_server.js"
fi

ensure_managed_node
exec "${NODE_BIN}" "${BASE_DIR}/agent_server.js"
