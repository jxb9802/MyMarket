const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CHAT_CONFIG_FILE = path.join(DATA_DIR, 'chat_config.json');

function defaultChatConfig() {
  return {
    enabled: true,
    displayName: '',
    listenPort: 8787,
    publicHost: '',
    publicPort: 8787,
    manualPeerEndpoints: {},
    manualPeerNames: {},
    manualDisconnects: {},
    allowOnchainInvite: true,
    autoPublishEndpoint: true,
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeConfig(config = {}) {
  const merged = {
    ...defaultChatConfig(),
    ...(config && typeof config === 'object' ? config : {}),
  };
  merged.manualPeerEndpoints = merged.manualPeerEndpoints && typeof merged.manualPeerEndpoints === 'object'
    ? { ...merged.manualPeerEndpoints }
    : {};
  merged.manualPeerNames = merged.manualPeerNames && typeof merged.manualPeerNames === 'object'
    ? { ...merged.manualPeerNames }
    : {};
  merged.manualDisconnects = merged.manualDisconnects && typeof merged.manualDisconnects === 'object'
    ? { ...merged.manualDisconnects }
    : {};
  return merged;
}

function loadChatConfigSnapshot() {
  try {
    if (!fs.existsSync(CHAT_CONFIG_FILE)) return defaultChatConfig();
    const parsed = JSON.parse(fs.readFileSync(CHAT_CONFIG_FILE, 'utf8'));
    return normalizeConfig(parsed);
  } catch (_) {
    return defaultChatConfig();
  }
}

function saveChatConfigSnapshot(config = {}) {
  ensureDataDir();
  const normalized = normalizeConfig(config);
  fs.writeFileSync(CHAT_CONFIG_FILE, JSON.stringify(normalized, null, 2));
  return normalized;
}

function updateChatConfig(mutator) {
  const current = loadChatConfigSnapshot();
  const working = normalizeConfig(current);
  if (typeof mutator === 'function') mutator(working);
  return saveChatConfigSnapshot(working);
}

module.exports = {
  CHAT_CONFIG_FILE,
  defaultChatConfig,
  loadChatConfigSnapshot,
  normalizeConfig,
  saveChatConfigSnapshot,
  updateChatConfig,
};
