const marketDb = require('./market_db');
const messageQueue = require('./lib/message_queue');
const fs = require('fs');
const path = require('path');

const PROFILE_CONSUMER = 'profile_projection_writer_v1';
let runtimeProfileState = null;

function appendProfileTrace(event, payload = {}) {
  try {
    const file = path.join(marketDb.getLogDir(), 'market_db_trace.log');
    fs.appendFileSync(file, `${JSON.stringify({
      ts: new Date().toISOString(),
      source: 'profile_domain',
      pid: process.pid,
      event,
      ...payload,
    })}\n`);
  } catch (_) {}
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeProfile(row = {}) {
  return {
    profileKey: String(row.profileKey || 'self').trim() || 'self',
    merchantId: String(row.merchantId || '').trim(),
    walletId: String(row.walletId || '').trim(),
    name: String(row.name || '').trim(),
    localStatus: String(row.localStatus || '').trim(),
    localUpdatedAt: String(row.localUpdatedAt || '').trim(),
    updatedAt: String(row.updatedAt || nowIso()),
  };
}

function makeRuntimeState() {
  return {
    loaded: false,
    profileMap: new Map(),
    updatedAt: '',
  };
}

function cloneProfile(profile = null) {
  return profile ? normalizeProfile(profile) : null;
}

function cloneRuntimeState(state = null) {
  const current = state && typeof state === 'object' ? state : makeRuntimeState();
  return {
    loaded: current.loaded === true,
    profileMap: new Map(
      Array.from(current.profileMap instanceof Map ? current.profileMap.entries() : [])
        .map(([key, value]) => [String(key || '').trim(), cloneProfile(value)]),
    ),
    updatedAt: String(current.updatedAt || ''),
  };
}

function readProjectionProfile(profileKey = 'self') {
  const db = marketDb.openReadDb();
  try {
    const row = db.prepare(`
      SELECT profile_key, merchant_id, wallet_id, name, payload_json, updated_at
      FROM profiles
      WHERE profile_key = ?
      LIMIT 1
    `).get(String(profileKey || 'self').trim() || 'self');
    if (!row) return null;
    let payload = {};
    try {
      payload = JSON.parse(String(row.payload_json || '{}'));
    } catch (_) {}
    return normalizeProfile({
      profileKey: row.profile_key,
      merchantId: row.merchant_id,
      walletId: row.wallet_id,
      name: row.name,
      localStatus: payload.localStatus,
      localUpdatedAt: payload.localUpdatedAt || row.updated_at,
      updatedAt: row.updated_at,
    });
  } finally {
    db.close();
  }
}

function getProfileSnapshotSync(profileKey = 'self') {
  const safeKey = String(profileKey || 'self').trim() || 'self';
  if (runtimeProfileState?.loaded === true) {
    const cached = runtimeProfileState.profileMap.get(safeKey);
    return cached ? { ...cached } : null;
  }
  const loaded = readProjectionProfile(safeKey);
  if (!runtimeProfileState || runtimeProfileState.loaded !== true) {
    runtimeProfileState = {
      loaded: true,
      profileMap: new Map(loaded ? [[safeKey, loaded]] : []),
      updatedAt: String(loaded?.updatedAt || nowIso()),
    };
  }
  return loaded ? { ...loaded } : null;
}

async function ensureProfileRuntimeLoaded(options = {}) {
  if (runtimeProfileState?.loaded === true && options.forceReload !== true) {
    return cloneRuntimeState(runtimeProfileState);
  }
  const safeKey = String(options.profileKey || 'self').trim() || 'self';
  const loaded = readProjectionProfile(safeKey);
  runtimeProfileState = {
    loaded: true,
    profileMap: new Map(loaded ? [[safeKey, loaded]] : []),
    updatedAt: String(loaded?.updatedAt || nowIso()),
  };
  appendProfileTrace('runtime_state_loaded', {
    consumerName: PROFILE_CONSUMER,
    profileKey: safeKey,
    hasProfile: Boolean(loaded),
    forceReload: options.forceReload === true,
  });
  return cloneRuntimeState(runtimeProfileState);
}

function applyProfileToRuntime(profile = {}) {
  const payload = normalizeProfile(profile);
  if (!runtimeProfileState || runtimeProfileState.loaded !== true) {
    runtimeProfileState = makeRuntimeState();
    runtimeProfileState.loaded = true;
  }
  runtimeProfileState.profileMap.set(payload.profileKey, payload);
  runtimeProfileState.updatedAt = String(payload.updatedAt || nowIso());
  return payload;
}

async function applyProfileSnapshot(profile, meta = {}) {
  const payload = normalizeProfile(profile);
  if (!payload.profileKey) return null;
  const startedAt = Date.now();
  await marketDb.replaceProfileSnapshot(payload);
  const finishedAt = Date.now();
  applyProfileToRuntime(payload);
  appendProfileTrace('projection_applied', {
    profileKey: payload.profileKey,
    payloadBytes: Buffer.byteLength(JSON.stringify(payload), 'utf8'),
    source: String(meta.source || 'profile_domain'),
    seq: Math.max(0, Number(meta.seq || 0)),
    elapsedMs: finishedAt - startedAt,
  });
  return payload;
}

async function catchUpProjection() {
  appendProfileTrace('catchup_skipped_event_driven', {
    consumerName: PROFILE_CONSUMER,
  });
  return { applied: 0, lastSeq: 0 };
}

async function emitProfileUpsert(profile, meta = {}) {
  const payload = normalizeProfile(profile);
  await ensureProfileRuntimeLoaded({ profileKey: payload.profileKey });
  await messageQueue.publish('profile.updated', payload, {
    mode: messageQueue.MODE_TRANSIENT,
    source: String(meta.producer || 'profile_domain'),
  });
  applyProfileToRuntime(payload);
  await applyProfileSnapshot(payload, {
    source: String(meta.producer || 'profile_domain'),
    seq: 0,
  });
  return payload;
}

async function resetProfileSnapshot(profileKey = 'self') {
  const safeKey = String(profileKey || 'self').trim() || 'self';
  const empty = normalizeProfile({
    profileKey: safeKey,
    merchantId: '',
    walletId: '',
    name: '',
    localStatus: '',
    localUpdatedAt: '',
    updatedAt: nowIso(),
  });
  return emitProfileUpsert(empty, {
    producer: 'profile_domain.reset',
  });
}

async function rehydrateProfileRuntimeFromProjection(profileKey = 'self') {
  const state = await ensureProfileRuntimeLoaded({ profileKey, forceReload: true });
  const safeKey = String(profileKey || 'self').trim() || 'self';
  const profile = state.profileMap.get(safeKey) || null;
  return profile ? { ...profile } : null;
}

module.exports = {
  PROFILE_CONSUMER,
  applyProfileSnapshot,
  catchUpProjection,
  ensureProfileRuntimeLoaded,
  emitProfileUpsert,
  getProfileSnapshotSync,
  rehydrateProfileRuntimeFromProjection,
  resetProfileSnapshot,
};
