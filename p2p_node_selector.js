function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const DEFAULT_PURPOSE = 'general';
const PURPOSE_SYNC_BLOCK = 'sync_block';

function normalizePurpose(purpose) {
  const key = String(purpose || '').trim().toLowerCase();
  if (!key) return DEFAULT_PURPOSE;
  return key;
}

function emptyBucket() {
  return {
    score: 0,
    successCount: 0,
    failCount: 0,
    consecutiveFails: 0,
    bannedUntil: 0,
    avgLatencyMs: 0,
    avgDownloadBytesPerSec: 0,
    lastDownloadBytesPerSec: 0,
    downloadSampleCount: 0,
    lastError: '',
    lastFailureAt: 0,
    lastTimeoutAt: 0,
    lastSuccessAt: 0,
    updatedAt: 0,
  };
}

function createP2PNodeSelector(config = {}) {
  const nodeHealth = new Map();
  const nodeLeases = new Map();
  const leaseSessions = new Map();
  let nextLeaseSeq = 1;

  const settings = {
    snapshotLimit: Math.max(1, Number(config.snapshotLimit || 24)),
    nodeStateMax: Math.max(16, Number(config.nodeStateMax || 64)),
    defaultCandidateLimit: Math.max(1, Number(config.defaultCandidateLimit || 16)),
    timeoutCooldownMs: Math.max(1000, Number(config.timeoutCooldownMs || 60000)),
    nodeMaxConsecFail: Math.max(1, Number(config.nodeMaxConsecFail || 2)),
    nodeBanMs: Math.max(1000, Number(config.nodeBanMs || 120000)),
    walletApi: config.walletApi || null,
  };

  function normalizeBucket(row = {}) {
    return {
      score: clampNumber(row.score, -100, 100, 0),
      successCount: Math.max(0, Number(row.successCount || 0)),
      failCount: Math.max(0, Number(row.failCount || 0)),
      consecutiveFails: Math.max(0, Number(row.consecutiveFails || 0)),
      bannedUntil: Math.max(0, Number(row.bannedUntil || 0)),
      avgLatencyMs: Math.max(0, Number(row.avgLatencyMs || 0)),
      avgDownloadBytesPerSec: Math.max(0, Number(row.avgDownloadBytesPerSec || row.avgBytesPerSec || 0)),
      lastDownloadBytesPerSec: Math.max(0, Number(row.lastDownloadBytesPerSec || row.lastBytesPerSec || 0)),
      downloadSampleCount: Math.max(0, Number(row.downloadSampleCount || 0)),
      lastError: String(row.lastError || '').slice(0, 240),
      lastFailureAt: Math.max(0, Number(row.lastFailureAt || 0)),
      lastTimeoutAt: Math.max(0, Number(row.lastTimeoutAt || 0)),
      lastSuccessAt: Math.max(0, Number(row.lastSuccessAt || 0)),
      updatedAt: Math.max(0, Number(row.updatedAt || 0)),
    };
  }

  function getPurposeBuckets(node) {
    const key = String(node || '').trim();
    if (!key) return { [DEFAULT_PURPOSE]: emptyBucket() };
    const curr = nodeHealth.get(key) || {};
    const buckets = {};
    const statsByPurpose = curr.statsByPurpose && typeof curr.statsByPurpose === 'object'
      ? curr.statsByPurpose
      : {};
    Object.entries(statsByPurpose).forEach(([purpose, row]) => {
      buckets[normalizePurpose(purpose)] = normalizeBucket(row);
    });
    if (!buckets[DEFAULT_PURPOSE]) buckets[DEFAULT_PURPOSE] = emptyBucket();
    if (
      Number(curr.updatedAt || 0) > 0
      || Number(curr.score || 0) !== 0
      || Number(curr.successCount || 0) > 0
      || Number(curr.failCount || 0) > 0
      || String(curr.lastError || '')
    ) {
      const legacyRow = normalizeBucket(curr);
      const targetPurpose = buckets[PURPOSE_SYNC_BLOCK]?.updatedAt ? DEFAULT_PURPOSE : PURPOSE_SYNC_BLOCK;
      buckets[targetPurpose] = {
        ...legacyRow,
        ...(buckets[targetPurpose] || {}),
      };
    }
    return buckets;
  }

  function collapseBuckets(buckets = {}, purpose = DEFAULT_PURPOSE) {
    const selectedPurpose = normalizePurpose(purpose);
    const selected = normalizeBucket(buckets[selectedPurpose] || {});
    const fallback = normalizeBucket(buckets[DEFAULT_PURPOSE] || {});
    if (selectedPurpose === DEFAULT_PURPOSE) return selected;
    return {
      score: Number(selected.updatedAt || 0) ? selected.score : fallback.score,
      successCount: selected.successCount,
      failCount: selected.failCount,
      consecutiveFails: selected.consecutiveFails,
      bannedUntil: selected.bannedUntil,
      avgLatencyMs: selected.avgLatencyMs || fallback.avgLatencyMs,
      avgDownloadBytesPerSec: selected.avgDownloadBytesPerSec || fallback.avgDownloadBytesPerSec,
      lastDownloadBytesPerSec: selected.lastDownloadBytesPerSec || fallback.lastDownloadBytesPerSec,
      downloadSampleCount: selected.downloadSampleCount || fallback.downloadSampleCount,
      lastError: selected.lastError,
      lastFailureAt: selected.lastFailureAt,
      lastTimeoutAt: selected.lastTimeoutAt,
      lastSuccessAt: selected.lastSuccessAt,
      updatedAt: selected.updatedAt,
    };
  }

  function setPurposeBuckets(node, buckets = {}) {
    const key = String(node || '').trim();
    if (!key) return;
    nodeHealth.set(key, {
      statsByPurpose: Object.fromEntries(
        Object.entries(buckets)
          .map(([purpose, row]) => [normalizePurpose(purpose), normalizeBucket(row)])
          .filter(([purpose]) => Boolean(purpose)),
      ),
    });
  }

  function getHealth(node, options = {}) {
    const purpose = normalizePurpose(typeof options === 'string' ? options : options?.purpose);
    return collapseBuckets(getPurposeBuckets(node), purpose);
  }

  function importStats(statsLike = {}) {
    Object.entries(statsLike || {}).forEach(([endpointRaw, row]) => {
      const endpoint = String(endpointRaw || '').trim();
      if (!endpoint || !row || typeof row !== 'object') return;
      const prev = getHealth(endpoint, { purpose: PURPOSE_SYNC_BLOCK });
      const normalized = normalizeBucket(row);
      if (Number(prev.updatedAt || 0) > Number(normalized.updatedAt || 0)) return;
      const buckets = getPurposeBuckets(endpoint);
      buckets[PURPOSE_SYNC_BLOCK] = normalized;
      setPurposeBuckets(endpoint, buckets);
    });
  }

  function exportStats() {
    const entries = Array.from(nodeHealth.keys())
      .map((endpoint) => [endpoint, getHealth(endpoint, { purpose: PURPOSE_SYNC_BLOCK })])
      .filter(([endpoint]) => Boolean(endpoint))
      .sort((a, b) => {
        if (Number(a[1].avgDownloadBytesPerSec || 0) !== Number(b[1].avgDownloadBytesPerSec || 0)) return Number(b[1].avgDownloadBytesPerSec || 0) - Number(a[1].avgDownloadBytesPerSec || 0);
        if (Number(a[1].score || 0) !== Number(b[1].score || 0)) return Number(b[1].score || 0) - Number(a[1].score || 0);
        if (Number(a[1].lastSuccessAt || 0) !== Number(b[1].lastSuccessAt || 0)) return Number(b[1].lastSuccessAt || 0) - Number(a[1].lastSuccessAt || 0);
        return String(a[0]).localeCompare(String(b[0]));
      })
      .slice(0, settings.nodeStateMax);
    return Object.fromEntries(entries);
  }

  function trimStatsObject(statsLike = {}) {
    const entries = Object.entries(statsLike || {})
      .map(([endpoint, row]) => [String(endpoint || '').trim(), row])
      .filter(([endpoint, row]) => Boolean(endpoint) && row && typeof row === 'object')
      .sort((a, b) => {
        if (Number(a[1].avgDownloadBytesPerSec || 0) !== Number(b[1].avgDownloadBytesPerSec || 0)) return Number(b[1].avgDownloadBytesPerSec || 0) - Number(a[1].avgDownloadBytesPerSec || 0);
        if (Number(a[1].score || 0) !== Number(b[1].score || 0)) return Number(b[1].score || 0) - Number(a[1].score || 0);
        if (Number(a[1].lastSuccessAt || 0) !== Number(b[1].lastSuccessAt || 0)) return Number(b[1].lastSuccessAt || 0) - Number(a[1].lastSuccessAt || 0);
        return String(a[0]).localeCompare(String(b[0]));
      })
      .slice(0, settings.nodeStateMax);
    return Object.fromEntries(entries);
  }

  function persistNodeHealthToState(state, node, health = null) {
    if (!state || typeof state !== 'object') return;
    if (!state.sync || typeof state.sync !== 'object') state.sync = {};
    if (!state.sync.p2pNodeStats || typeof state.sync.p2pNodeStats !== 'object') state.sync.p2pNodeStats = {};
    const endpoint = String(node || '').trim();
    if (!endpoint) {
      state.sync.p2pNodeStats = trimStatsObject(state.sync.p2pNodeStats);
      return;
    }
    state.sync.p2pNodeStats[endpoint] = {
      ...(health || getHealth(endpoint, { purpose: PURPOSE_SYNC_BLOCK })),
    };
    state.sync.p2pNodeStats = trimStatsObject(state.sync.p2pNodeStats);
  }

  function releaseBans(endpoints = null) {
    const targets = Array.isArray(endpoints) && endpoints.length
      ? endpoints.map((x) => String(x || '').trim()).filter(Boolean)
      : Array.from(nodeHealth.keys());
    targets.forEach((endpoint) => {
      const buckets = getPurposeBuckets(endpoint);
      Object.keys(buckets).forEach((purpose) => {
        buckets[purpose] = {
          ...normalizeBucket(buckets[purpose]),
          bannedUntil: 0,
          updatedAt: Date.now(),
        };
      });
      setPurposeBuckets(endpoint, buckets);
    });
  }

  function isBanned(node, now = Date.now(), options = {}) {
    const purpose = normalizePurpose(typeof options === 'string' ? options : options?.purpose);
    return Number(getHealth(node, { purpose }).bannedUntil || 0) > Number(now || Date.now());
  }

  function isCooling(node, now = Date.now(), options = {}) {
    const purpose = normalizePurpose(typeof options === 'string' ? options : options?.purpose);
    const row = getHealth(node, { purpose });
    return Number(row.lastTimeoutAt || 0) + settings.timeoutCooldownMs > Number(now || Date.now());
  }

  function markSuccess(node, latencyMs = 0, options = {}) {
    const key = String(node || '').trim();
    const purpose = normalizePurpose(typeof options === 'string' ? options : options?.purpose);
    if (!key) return getHealth(key, { purpose });
    const buckets = getPurposeBuckets(key);
    const prev = collapseBuckets(buckets, purpose);
    const sampleLatency = Math.max(0, Number(latencyMs || 0));
    const sampleDownloadBytesPerSec = Math.max(0, Number(options.downloadBytesPerSec || options.bytesPerSec || 0));
    const previousDownloadBytesPerSec = Math.max(0, Number(prev.avgDownloadBytesPerSec || 0));
    const downloadSampleCount = Math.max(0, Number(prev.downloadSampleCount || 0));
    const next = {
      score: Math.min(100, Number(prev.score || 0) + (sampleLatency > 0 && sampleLatency <= 1500 ? 4 : 3) + (sampleDownloadBytesPerSec >= 512 * 1024 ? 2 : 0)),
      successCount: Math.max(0, Number(prev.successCount || 0)) + 1,
      failCount: Math.max(0, Number(prev.failCount || 0)),
      consecutiveFails: 0,
      bannedUntil: 0,
      avgLatencyMs: sampleLatency > 0
        ? (Number(prev.avgLatencyMs || 0) > 0 ? Math.round(Number(prev.avgLatencyMs || 0) * 0.7 + sampleLatency * 0.3) : sampleLatency)
        : Math.max(0, Number(prev.avgLatencyMs || 0)),
      avgDownloadBytesPerSec: sampleDownloadBytesPerSec > 0
        ? (previousDownloadBytesPerSec > 0 ? Math.round(previousDownloadBytesPerSec * 0.7 + sampleDownloadBytesPerSec * 0.3) : sampleDownloadBytesPerSec)
        : previousDownloadBytesPerSec,
      lastDownloadBytesPerSec: sampleDownloadBytesPerSec > 0
        ? sampleDownloadBytesPerSec
        : Math.max(0, Number(prev.lastDownloadBytesPerSec || 0)),
      downloadSampleCount: sampleDownloadBytesPerSec > 0
        ? downloadSampleCount + 1
        : downloadSampleCount,
      lastError: '',
      lastFailureAt: 0,
      lastTimeoutAt: 0,
      lastSuccessAt: Date.now(),
      updatedAt: Date.now(),
    };
    buckets[purpose] = next;
    setPurposeBuckets(key, buckets);
    return next;
  }

  function markFailure(node, errorMessage = '', options = {}) {
    const key = String(node || '').trim();
    const purpose = normalizePurpose(typeof options === 'string' ? options : options?.purpose);
    if (!key) return getHealth(key, { purpose });
    const now = Date.now();
    const buckets = getPurposeBuckets(key);
    const prev = collapseBuckets(buckets, purpose);
    const errMsg = String(errorMessage || '').trim();
    const transportLike = /timeout|not connected|connect timeout|getblock failed|getheaders timeout|headers failed|worker failed/i.test(errMsg);
    const timeoutLike = /timeout|getblock timeout|getheaders timeout|connect timeout/i.test(errMsg);
    const consecutiveFails = Math.max(1, Number(prev.consecutiveFails || 0) + 1);
    let bannedUntil = Math.max(0, Number(prev.bannedUntil || 0));
    if (transportLike && consecutiveFails >= settings.nodeMaxConsecFail) {
      const multiplier = Math.max(1, consecutiveFails - settings.nodeMaxConsecFail + 1);
      bannedUntil = now + Math.min(settings.nodeBanMs * multiplier, settings.nodeBanMs * 10);
    }
    const next = {
      score: Math.max(-100, Number(prev.score || 0) - (timeoutLike ? 8 : (transportLike ? 4 : 2))),
      successCount: Math.max(0, Number(prev.successCount || 0)),
      failCount: Math.max(0, Number(prev.failCount || 0)) + 1,
      consecutiveFails,
      bannedUntil,
      avgLatencyMs: Math.max(0, Number(prev.avgLatencyMs || 0)),
      avgDownloadBytesPerSec: Math.max(0, Number(prev.avgDownloadBytesPerSec || 0)),
      lastDownloadBytesPerSec: Math.max(0, Number(prev.lastDownloadBytesPerSec || 0)),
      downloadSampleCount: Math.max(0, Number(prev.downloadSampleCount || 0)),
      lastError: errMsg.slice(0, 240),
      lastFailureAt: now,
      lastTimeoutAt: timeoutLike ? now : Math.max(0, Number(prev.lastTimeoutAt || 0)),
      lastSuccessAt: Math.max(0, Number(prev.lastSuccessAt || 0)),
      updatedAt: now,
    };
    buckets[purpose] = next;
    setPurposeBuckets(key, buckets);
    return next;
  }

  function compareNodes(a, b, walletRows = new Map(), options = {}) {
    const purpose = normalizePurpose(typeof options === 'string' ? options : options?.purpose);
    const ah = getHealth(a, { purpose });
    const bh = getHealth(b, { purpose });
    const now = Date.now();
    const aCooling = isCooling(a, now, { purpose }) ? 1 : 0;
    const bCooling = isCooling(b, now, { purpose }) ? 1 : 0;
    if (aCooling !== bCooling) return aCooling - bCooling;
    const adl = Number(ah.avgDownloadBytesPerSec || 0);
    const bdl = Number(bh.avgDownloadBytesPerSec || 0);
    if (adl > 0 || bdl > 0) {
      if (bdl !== adl) return bdl - adl;
    }
    if (Number(ah.score || 0) !== Number(bh.score || 0)) return Number(bh.score || 0) - Number(ah.score || 0);
    if (Number(ah.lastSuccessAt || 0) !== Number(bh.lastSuccessAt || 0)) return Number(bh.lastSuccessAt || 0) - Number(ah.lastSuccessAt || 0);
    const aw = walletRows.get(a) || {};
    const bw = walletRows.get(b) || {};
    if (Number(aw.score || 0) !== Number(bw.score || 0)) return Number(bw.score || 0) - Number(aw.score || 0);
    const aRank = Number(aw.rank || 9999);
    const bRank = Number(bw.rank || 9999);
    if (aRank !== bRank) return aRank - bRank;
    const alat = Number(ah.avgLatencyMs || 0);
    const blat = Number(bh.avgLatencyMs || 0);
    if (alat !== blat) return alat - blat;
    return String(a).localeCompare(String(b));
  }

  function compareQuickstartNodes(a, b, walletRows = new Map()) {
    const ah = getHealth(a, { purpose: PURPOSE_SYNC_BLOCK });
    const bh = getHealth(b, { purpose: PURPOSE_SYNC_BLOCK });
    const now = Date.now();
    const aCooling = isCooling(a, now, { purpose: PURPOSE_SYNC_BLOCK }) ? 1 : 0;
    const bCooling = isCooling(b, now, { purpose: PURPOSE_SYNC_BLOCK }) ? 1 : 0;
    if (aCooling !== bCooling) return aCooling - bCooling;
    const aHasSuccess = Number(ah.successCount || 0) > 0 ? 1 : 0;
    const bHasSuccess = Number(bh.successCount || 0) > 0 ? 1 : 0;
    if (aHasSuccess !== bHasSuccess) return bHasSuccess - aHasSuccess;
    const adl = Number(ah.avgDownloadBytesPerSec || 0);
    const bdl = Number(bh.avgDownloadBytesPerSec || 0);
    if (adl > 0 || bdl > 0) {
      if (bdl !== adl) return bdl - adl;
    }
    if (Number(ah.lastSuccessAt || 0) !== Number(bh.lastSuccessAt || 0)) return Number(bh.lastSuccessAt || 0) - Number(ah.lastSuccessAt || 0);
    if (Number(ah.consecutiveFails || 0) !== Number(bh.consecutiveFails || 0)) return Number(ah.consecutiveFails || 0) - Number(bh.consecutiveFails || 0);
    if (Number(ah.failCount || 0) !== Number(bh.failCount || 0)) return Number(ah.failCount || 0) - Number(bh.failCount || 0);
    if (Number(ah.successCount || 0) !== Number(bh.successCount || 0)) return Number(bh.successCount || 0) - Number(ah.successCount || 0);
    const alat = Number(ah.avgLatencyMs || 0);
    const blat = Number(bh.avgLatencyMs || 0);
    if (alat > 0 && blat > 0 && alat !== blat) return alat - blat;
    return compareNodes(a, b, walletRows, { purpose: PURPOSE_SYNC_BLOCK });
  }

  function loadWalletSnapshot(snapshotLimit = settings.snapshotLimit) {
    if (!settings.walletApi || typeof settings.walletApi.getSpvNodeSnapshot !== 'function') {
      return { connected: [], candidates: [] };
    }
    try {
      return settings.walletApi.getSpvNodeSnapshot(snapshotLimit) || { connected: [], candidates: [] };
    } catch (_) {
      return { connected: [], candidates: [] };
    }
  }

  function buildCandidateContext(limit = settings.defaultCandidateLimit, options = {}) {
    const purpose = normalizePurpose(options.purpose);
    const snapshot = loadWalletSnapshot();
    const connectedRows = Array.isArray(snapshot.connected) ? snapshot.connected : [];
    const candidateRows = Array.isArray(snapshot.candidates) ? snapshot.candidates : [];
    const rows = [...connectedRows, ...candidateRows];
    const unique = [];
    const seen = new Set();
    const walletRows = new Map();
    rows.forEach((row) => {
      const endpoint = String(row?.endpoint || '').trim();
      if (!endpoint || seen.has(endpoint)) return;
      seen.add(endpoint);
      walletRows.set(endpoint, row);
      unique.push(endpoint);
    });
    Array.from(nodeHealth.keys()).forEach((endpointRaw) => {
      const endpoint = String(endpointRaw || '').trim();
      if (!endpoint || seen.has(endpoint)) return;
      seen.add(endpoint);
      unique.push(endpoint);
    });
    const compare = purpose === PURPOSE_SYNC_BLOCK
      ? (a, b) => compareQuickstartNodes(a, b, walletRows)
      : (a, b) => compareNodes(a, b, walletRows, { purpose });
    const sorted = unique.slice().sort(compare);
    const fresh = sorted.filter((endpoint) => !isBanned(endpoint, Date.now(), { purpose }));
    const all = fresh.length ? fresh : sorted;
    return {
      snapshot,
      walletRows,
      sorted,
      fresh,
      candidates: all.slice(0, Math.max(1, Number(limit || settings.defaultCandidateLimit))),
    };
  }

  function getCandidates(options = {}) {
    const limit = Math.max(1, Number(options.limit || settings.defaultCandidateLimit));
    const purpose = normalizePurpose(options.purpose);
    const context = buildCandidateContext(limit, { purpose });
    if (!context.fresh.length && context.sorted.length) releaseBans(context.sorted);
    return (context.fresh.length ? context.fresh : context.sorted).slice(0, limit);
  }

  function acquireNodes({ count = 1, exclude = [], purpose = 'general' } = {}) {
    const target = Math.max(1, Number(count || 1));
    const normalizedPurpose = normalizePurpose(purpose);
    const excluded = new Set((Array.isArray(exclude) ? exclude : []).map((x) => String(x || '').trim()).filter(Boolean));
    const candidates = getCandidates({ limit: Math.max(settings.defaultCandidateLimit, target * 4), purpose: normalizedPurpose });
    const picked = [];
    for (const endpoint of candidates) {
      const key = String(endpoint || '').trim();
      if (!key || excluded.has(key)) continue;
      const lease = nodeLeases.get(key) || { leasedCount: 0, lastPurpose: '' };
      const allowSharedLease = normalizedPurpose === 'broadcast';
      if (lease.leasedCount > 0 && !allowSharedLease) continue;
      nodeLeases.set(key, {
        leasedCount: lease.leasedCount + 1,
        lastPurpose: normalizedPurpose,
        lastLeaseAt: Date.now(),
      });
      picked.push(key);
      if (picked.length >= target) break;
    }
    return picked;
  }

  function acquirePreferredNodes({ preferred = [], count = 1, exclude = [], purpose = 'general', strictPreferred = false } = {}) {
    const target = Math.max(1, Number(count || 1));
    const normalizedPurpose = normalizePurpose(purpose);
    const excluded = new Set((Array.isArray(exclude) ? exclude : []).map((x) => String(x || '').trim()).filter(Boolean));
    const picked = [];
    const tryLease = (endpoint) => {
      const key = String(endpoint || '').trim();
      if (!key || excluded.has(key) || picked.includes(key)) return false;
      const lease = nodeLeases.get(key) || { leasedCount: 0, lastPurpose: '' };
      const allowSharedLease = normalizedPurpose === 'broadcast';
      if (lease.leasedCount > 0 && !allowSharedLease) return false;
      nodeLeases.set(key, {
        leasedCount: lease.leasedCount + 1,
        lastPurpose: normalizedPurpose,
        lastLeaseAt: Date.now(),
      });
      picked.push(key);
      return true;
    };
    for (const endpoint of (Array.isArray(preferred) ? preferred : [])) {
      if (picked.length >= target) break;
      tryLease(endpoint);
    }
    if (picked.length >= target) return picked;
    if (strictPreferred) return picked;
    const rest = acquireNodes({
      count: target - picked.length,
      exclude: [...excluded, ...picked],
      purpose: normalizedPurpose,
    });
    return [...picked, ...rest];
  }

  function acquireBackupNode({ exclude = [], purpose = 'backup' } = {}) {
    const [picked] = acquireNodes({ count: 1, exclude, purpose });
    return picked || '';
  }

  function createLeaseRecord(node, purpose = DEFAULT_PURPOSE, mode = 'persistent') {
    const key = String(node || '').trim();
    if (!key) return null;
    const id = `lease-${String(nextLeaseSeq).padStart(6, '0')}`;
    nextLeaseSeq += 1;
    const now = Date.now();
    const record = {
      id,
      node: key,
      purpose: normalizePurpose(purpose),
      mode: String(mode || 'persistent').trim().toLowerCase() || 'persistent',
      createdAt: now,
      lastUsedAt: now,
      releasedAt: 0,
      releaseReason: '',
      status: 'active',
    };
    leaseSessions.set(id, record);
    return record;
  }

  function resolveLeaseRecord(leaseOrId) {
    if (!leaseOrId) return null;
    if (typeof leaseOrId === 'string') return leaseSessions.get(String(leaseOrId || '').trim()) || null;
    if (typeof leaseOrId === 'object') {
      const id = String(leaseOrId.id || '').trim();
      if (id && leaseSessions.has(id)) return leaseSessions.get(id) || null;
    }
    return null;
  }

  function makeLeaseHandle(record) {
    if (!record) return null;
    return {
      id: record.id,
      node: record.node,
      purpose: record.purpose,
      mode: record.mode,
      createdAt: record.createdAt,
      isActive() {
        const curr = resolveLeaseRecord(record.id);
        return Boolean(curr && curr.status === 'active');
      },
      snapshot() {
        const curr = resolveLeaseRecord(record.id);
        return curr ? { ...curr } : null;
      },
      reportSuccess(meta = {}) {
        const curr = resolveLeaseRecord(record.id);
        if (!curr) return null;
        curr.lastUsedAt = Date.now();
        return reportSuccess(curr.node, {
          ...meta,
          purpose: meta.purpose || curr.purpose,
        });
      },
      reportFailure(meta = {}) {
        const curr = resolveLeaseRecord(record.id);
        if (!curr) return null;
        curr.lastUsedAt = Date.now();
        return reportFailure(curr.node, {
          ...meta,
          purpose: meta.purpose || curr.purpose,
        });
      },
      release(meta = {}) {
        return releaseLease(record.id, meta);
      },
    };
  }

  function acquireLease({ exclude = [], purpose = 'general', mode = 'persistent' } = {}) {
    const picked = acquireNodes({ count: 1, exclude, purpose });
    if (!picked.length) return null;
    return makeLeaseHandle(createLeaseRecord(picked[0], purpose, mode));
  }

  function acquirePreferredLease({ preferred = [], exclude = [], purpose = 'general', mode = 'persistent', strictPreferred = false } = {}) {
    const picked = acquirePreferredNodes({ preferred, count: 1, exclude, purpose, strictPreferred });
    if (!picked.length) return null;
    return makeLeaseHandle(createLeaseRecord(picked[0], purpose, mode));
  }

  function releaseLease(leaseOrId, meta = {}) {
    const record = resolveLeaseRecord(leaseOrId);
    if (!record || record.status !== 'active') return false;
    record.status = 'released';
    record.releasedAt = Date.now();
    record.releaseReason = String(meta.outcome || meta.reason || '').trim();
    record.lastUsedAt = record.releasedAt;
    releaseNode(record.node, meta);
    return true;
  }

  function getActiveLeases() {
    return Array.from(leaseSessions.values())
      .filter((row) => row && row.status === 'active')
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .map((row) => ({ ...row }));
  }

  function releaseNode(node, meta = {}) {
    const key = String(node || '').trim();
    if (!key) return;
    const lease = nodeLeases.get(key);
    if (!lease) return;
    const leasedCount = Math.max(0, Number(lease.leasedCount || 0) - 1);
    if (leasedCount <= 0) {
      nodeLeases.delete(key);
      return;
    }
    nodeLeases.set(key, {
      ...lease,
      leasedCount,
      lastReleaseAt: Date.now(),
      lastOutcome: String(meta.outcome || ''),
    });
  }

  function reportSuccess(node, meta = {}) {
    return markSuccess(node, Number(meta.latencyMs || 0), {
      purpose: meta.purpose,
      downloadBytesPerSec: Number(meta.downloadBytesPerSec || meta.bytesPerSec || 0),
    });
  }

  function reportFailure(node, meta = {}) {
    return markFailure(node, String(meta.error || meta.message || 'failure'), { purpose: meta.purpose });
  }

  function getSnapshot() {
    return {
      nodeCount: nodeHealth.size,
      leasedCount: nodeLeases.size,
      activeLeases: getActiveLeases(),
      candidates: getCandidates({ limit: settings.defaultCandidateLimit }),
      health: exportStats(),
    };
  }

  return {
    importStats,
    exportStats,
    trimStatsObject,
    persistNodeHealthToState,
    getHealth,
    releaseBans,
    isBanned,
    isCooling,
    markSuccess,
    markFailure,
    compareNodes,
    compareQuickstartNodes,
    getCandidates,
    acquireNodes,
    acquirePreferredNodes,
    acquireBackupNode,
    acquireLease,
    acquirePreferredLease,
    releaseLease,
    releaseNode,
    reportSuccess,
    reportFailure,
    getActiveLeases,
    getSnapshot,
  };
}

module.exports = {
  createP2PNodeSelector,
};
