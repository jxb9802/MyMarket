'use strict';

const crypto = require('crypto');
const {
  isGlobalPublicIpv4,
  collectLocalIpv4Candidates,
  detectObservedPublicIpv4,
} = require('./public_ip_utils');
const { createEmbeddedStunServer } = require('./embedded_stun_server');

function normalizeString(value) {
  return String(value || '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function boolEnv(name, fallback = false) {
  const raw = normalizeString(process.env[name]).toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function endpointForHttp(host, port) {
  const safeHost = normalizeString(host);
  const safePort = Math.max(1, Number(port || 0));
  return safeHost && safePort ? `http://${safeHost}:${safePort}` : '';
}

function createPublicNodeService(deps = {}) {
  const os = deps.os || require('os');
  const wallet = deps.wallet || null;
  const appendDebug = typeof deps.appendDebug === 'function' ? deps.appendDebug : (() => {});
  const getRuntimeAuthSnapshot = typeof deps.getRuntimeAuthSnapshot === 'function'
    ? deps.getRuntimeAuthSnapshot
    : (() => null);
  const getSelfChatIdentity = typeof deps.getSelfChatIdentity === 'function'
    ? deps.getSelfChatIdentity
    : (() => ({}));

  let cachedStatus = null;
  let remotePublicNodes = [];
  const selfCheckToken = crypto.randomBytes(16).toString('hex');
  const embeddedStun = createEmbeddedStunServer({
    host: normalizeString(process.env.BSV_MARKET_STUN_HOST) || '0.0.0.0',
    port: Math.max(1, Number(process.env.BSV_MARKET_STUN_PORT || process.env.BSV_MARKET_TURN_PORT || 3478)),
    appendDebug,
  });

  function getExplicitPublicIp() {
    return normalizeString(
      process.env.BSV_MARKET_PUBLIC_NODE_IP
      || process.env.BSV_MARKET_CHAT_PUBLIC_HOST
      || process.env.BSV_MARKET_PUBLIC_HOST
      || '',
    );
  }

  function getPublicPort(state = {}) {
    return Math.max(1, Number(
      process.env.BSV_MARKET_PUBLIC_NODE_PORT
      || state?.chatConfig?.publicPort
      || process.env.BSV_MARKET_PORT
      || process.env.PORT
      || 8091,
    ));
  }

  function getTurnPort() {
    return Math.max(1, Number(process.env.BSV_MARKET_TURN_PORT || 3478));
  }

  function isTurnRelayEnabled() {
    return boolEnv('BSV_MARKET_ENABLE_TURN_RELAY', false);
  }

  function buildTurnCredentials() {
    const username = normalizeString(process.env.BSV_MARKET_TURN_USERNAME) || 'bsvmarket';
    const credential = normalizeString(process.env.BSV_MARKET_TURN_PASSWORD)
      || crypto.createHash('sha256')
        .update(`${os.hostname()}:${process.cwd()}:bsv-market-turn`, 'utf8')
        .digest('hex')
        .slice(0, 24);
    return { username, credential };
  }

  function buildIceServersFromCapability(capability = {}) {
    const servers = [];
    const publicIp = normalizeString(capability.publicIp);
    const turnPort = Math.max(1, Number(capability.turnPort || getTurnPort()));
    const stunPort = Math.max(1, Number(capability.stunPort || capability.turnPort || getTurnPort()));
    if (publicIp && capability.capabilities?.stun === true) {
      servers.push({ urls: `stun:${publicIp}:${stunPort}` });
    }
    if (isTurnRelayEnabled() && publicIp && capability.capabilities?.turn === true) {
      const creds = capability.turn || buildTurnCredentials();
      servers.push({
        urls: [
          `turn:${publicIp}:${turnPort}?transport=udp`,
          `turn:${publicIp}:${turnPort}?transport=tcp`,
        ],
        username: normalizeString(creds.username),
        credential: normalizeString(creds.credential),
      });
    }
    return servers.filter((row) => row?.urls);
  }

  function getConfiguredIceServers() {
    const raw = normalizeString(process.env.BSV_MARKET_ICE_SERVERS_JSON);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function iceServerKey(server = {}) {
    const urls = Array.isArray(server.urls) ? server.urls.slice().sort().join(',') : normalizeString(server.urls);
    return `${urls}|${normalizeString(server.username)}|${normalizeString(server.credential)}`;
  }

  function dedupeIceServers(servers = []) {
    const seen = new Set();
    const rows = [];
    for (const server of servers) {
      if (!server?.urls) continue;
      const key = iceServerKey(server);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(server);
    }
    return rows;
  }

  function getIceServers() {
    const configured = getConfiguredIceServers();
    const fromSelf = cachedStatus?.publicNode === true
      ? buildIceServersFromCapability(cachedStatus.capability)
      : [];
    const fromRemote = remotePublicNodes.flatMap((row) => (
      Array.isArray(row?.iceServers) ? row.iceServers : buildIceServersFromCapability(row?.capability || {})
    ));
    return dedupeIceServers([...configured, ...fromSelf, ...fromRemote]);
  }

  function getBootstrapPublicNodeEndpoints() {
    const raw = normalizeString(process.env.BSV_MARKET_PUBLIC_NODE_BOOTSTRAPS)
      || 'http://8.136.3.174:8091';
    return raw.split(/[,\s]+/).map((item) => normalizeString(item).replace(/\/+$/, '')).filter(Boolean);
  }

  async function refreshRemotePublicNodes() {
    if (boolEnv('BSV_MARKET_DISABLE_PUBLIC_NODE_BOOTSTRAPS', false) || typeof fetch !== 'function') {
      remotePublicNodes = [];
      return remotePublicNodes;
    }
    const timeoutMs = Math.max(500, Number(process.env.BSV_MARKET_PUBLIC_NODE_BOOTSTRAP_TIMEOUT_MS || 2500));
    const rows = [];
    for (const endpoint of getBootstrapPublicNodeEndpoints()) {
      try {
        const res = await fetch(`${endpoint}/api/public-node/status`, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: 'application/json' },
        });
        if (!res.ok) continue;
        const json = await res.json();
        if (json?.publicNode !== true) continue;
        rows.push({
          endpoint,
          capability: json.capability && typeof json.capability === 'object' ? json.capability : null,
          iceServers: Array.isArray(json.iceServers) ? json.iceServers : [],
          checkedAt: nowIso(),
        });
      } catch (_) {}
    }
    remotePublicNodes = rows;
    return remotePublicNodes;
  }

  async function detectPublicStatus(state = {}, options = {}) {
    const disabled = boolEnv('BSV_MARKET_DISABLE_PUBLIC_NODE_AUTO', false)
      || state?.chatConfig?.publicNodeAuto === false;
    const localCandidates = collectLocalIpv4Candidates(os);
    const explicit = getExplicitPublicIp();
    let publicIp = '';
    let source = '';
    if (explicit && isGlobalPublicIpv4(explicit)) {
      publicIp = explicit;
      source = 'explicit';
    }
    if (!publicIp) {
      const configured = normalizeString(state?.chatConfig?.publicHost);
      if (configured && isGlobalPublicIpv4(configured)) {
        publicIp = configured;
        source = 'chat_config';
      }
    }
    if (!publicIp) {
      const local = localCandidates.find((row) => row.global === true);
      if (local?.address) {
        publicIp = local.address;
        source = 'local_interface';
      }
    }
    if (!publicIp && options.skipExternal !== true && boolEnv('BSV_MARKET_PUBLIC_NODE_EXTERNAL_DETECT', true)) {
      publicIp = await detectObservedPublicIpv4({ timeoutMs: Number(process.env.BSV_MARKET_PUBLIC_IP_DETECT_TIMEOUT_MS || 2500) });
      if (publicIp) source = 'external_observed';
    }
    return {
      checkedAt: nowIso(),
      disabled,
      publicIp,
      isPublic: Boolean(publicIp && !disabled),
      source,
      localCandidates,
    };
  }

  async function checkHttpReachability(endpoint) {
    const base = normalizeString(endpoint).replace(/\/+$/, '');
    if (!base || typeof fetch !== 'function') return { ok: false, reason: 'no_endpoint' };
    if (boolEnv('BSV_MARKET_PUBLIC_NODE_SKIP_SELF_CHECK', false)) {
      return { ok: true, skipped: true };
    }
    try {
      const res = await fetch(`${base}/api/public-node/self-check?token=${encodeURIComponent(selfCheckToken)}`, {
        signal: AbortSignal.timeout(Math.max(500, Number(process.env.BSV_MARKET_PUBLIC_NODE_SELF_CHECK_TIMEOUT_MS || 3000))),
        headers: { accept: 'application/json' },
      });
      const json = await res.json().catch(() => ({}));
      return {
        ok: res.ok === true && String(json?.token || '') === selfCheckToken,
        status: res.status,
        tokenMatched: String(json?.token || '') === selfCheckToken,
      };
    } catch (error) {
      return { ok: false, reason: String(error?.message || error || 'self_check_failed') };
    }
  }

  function signCapability(capability = {}, state = {}, req = null) {
    if (!wallet || typeof wallet.signWalletKeyBind !== 'function') return '';
    try {
      const snapshot = getRuntimeAuthSnapshot({ includeSecret: true }) || {};
      const password = normalizeString(snapshot.walletPassword || req?.session?.walletPassword || '');
      const mnemonic = password && typeof wallet.getMnemonicFromPassword === 'function'
        ? normalizeString(wallet.getMnemonicFromPassword(password))
        : '';
      if (!mnemonic) return '';
      const self = getSelfChatIdentity(state, req) || {};
      return wallet.signWalletKeyBind({
        mnemonic,
        walletId: normalizeString(self.walletId || capability.nodeId),
        merchantId: normalizeString(self.merchantId || ''),
        chatPubKey: normalizeString(self.chatPubKey || ''),
        endpointHints: [normalizeString(capability.signalEndpoint)].filter(Boolean),
        relayHints: [],
        createdAt: normalizeString(capability.timestamp),
      });
    } catch (_) {
      return '';
    }
  }

  async function refresh(state = {}, req = null, options = {}) {
    const detection = await detectPublicStatus(state, options);
    await refreshRemotePublicNodes();
    const port = getPublicPort(state);
    const candidateSignalEndpoint = detection.isPublic === true ? endpointForHttp(detection.publicIp, port) : '';
    const selfCheck = candidateSignalEndpoint
      ? await checkHttpReachability(candidateSignalEndpoint)
      : { ok: false, reason: 'not_public_ip' };
    const publicNode = detection.isPublic === true && selfCheck.ok === true;
    const signalEndpoint = publicNode ? candidateSignalEndpoint : '';
    const stunResult = publicNode && !boolEnv('BSV_MARKET_DISABLE_EMBEDDED_STUN', false)
      ? await embeddedStun.start()
      : { started: false, reason: publicNode ? 'disabled' : 'not_public' };
    const turnResult = { started: false, reason: publicNode ? 'turn_relay_disabled_by_policy' : 'not_public' };
    const turnEnabled = false;
    const stunEnabled = stunResult.started === true;
    const turnPort = getTurnPort();
    const stunPort = Math.max(1, Number(process.env.BSV_MARKET_STUN_PORT || turnPort));
    const capability = {
      nodeId: normalizeString(state?.chatIdentity?.self?.walletId || ''),
      publicIp: normalizeString(detection.publicIp),
      signalEndpoint,
      stunEndpoint: stunEnabled ? `stun:${detection.publicIp}:${stunPort}` : '',
      turnEndpoint: '',
      relayEndpoint: '',
      stunPort,
      turnPort,
      turn: turnEnabled ? buildTurnCredentials() : null,
      capabilities: {
        signaling: publicNode,
        rendezvous: publicNode,
        relay: false,
        stun: stunEnabled,
        turn: false,
      },
      timestamp: nowIso(),
      expiresAt: new Date(Date.now() + Math.max(60000, Number(process.env.BSV_MARKET_PUBLIC_NODE_ANNOUNCE_TTL_MS || 10 * 60 * 1000))).toISOString(),
    };
    capability.signature = publicNode ? signCapability(capability, state, req) : '';
    const selfIceServers = publicNode ? buildIceServersFromCapability(capability) : [];
    const remoteIceServers = remotePublicNodes.flatMap((row) => (
      Array.isArray(row?.iceServers) ? row.iceServers : buildIceServersFromCapability(row?.capability || {})
    ));
    cachedStatus = {
      success: true,
      publicNode,
      detection,
      selfCheck,
      capability,
      stun: stunResult,
      turn: turnResult,
      remotePublicNodes,
      iceServers: dedupeIceServers([...getConfiguredIceServers(), ...selfIceServers, ...remoteIceServers]),
    };
    appendDebug('public_node_status_refreshed', {
      publicNode,
      source: detection.source,
      publicIp: detection.publicIp,
      signalEndpoint,
      selfCheckOk: selfCheck.ok === true,
      stunStarted: stunResult.started === true,
      turnStarted: turnResult.started === true,
      turnReason: String(turnResult.reason || ''),
    });
    return cachedStatus;
  }

  function getStatus() {
    return cachedStatus || {
      success: true,
      publicNode: false,
      detection: null,
      selfCheck: null,
      capability: null,
      stun: embeddedStun.status(),
      turn: { started: false, reason: 'not_checked' },
      remotePublicNodes,
      iceServers: getIceServers(),
    };
  }

  function stop() {
    embeddedStun.stop();
  }

  return {
    detectPublicStatus,
    refresh,
    getStatus,
    getIceServers,
    buildIceServersFromCapability,
    getSelfCheckToken() { return selfCheckToken; },
    stop,
  };
}

module.exports = {
  createPublicNodeService,
};
