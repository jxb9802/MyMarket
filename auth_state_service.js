function isoNow() {
  return new Date().toISOString();
}

function normalizePassword(password) {
  return String(password || '').trim();
}

function sanitizeMeta(meta = {}) {
  return {
    source: String(meta.source || '').trim(),
    reason: String(meta.reason || '').trim(),
    requestId: String(meta.requestId || '').trim(),
  };
}

function createAuthStateService(initialState = null) {
  let authEpoch = 0;
  let loginEpoch = 0;
  let state = {
    loggedIn: false,
    walletPassword: '',
    authenticatedAt: '',
    logoutAt: '',
    updatedAt: '',
    source: 'startup',
    reason: '',
    requestId: '',
  };

  function buildSnapshot(options = {}) {
    const includeSecret = options.includeSecret !== false;
    const snapshot = {
      authEpoch,
      loginEpoch,
      loggedIn: state.loggedIn === true,
      hasWalletPassword: Boolean(state.walletPassword),
      authenticatedAt: String(state.authenticatedAt || ''),
      logoutAt: String(state.logoutAt || ''),
      updatedAt: String(state.updatedAt || ''),
      source: String(state.source || ''),
      reason: String(state.reason || ''),
      requestId: String(state.requestId || ''),
    };
    if (includeSecret) snapshot.walletPassword = String(state.walletPassword || '');
    return snapshot;
  }

  function commit(nextState = {}) {
    const prevLoggedIn = state.loggedIn === true;
    const prevPassword = String(state.walletPassword || '');
    state = {
      ...state,
      ...nextState,
      loggedIn: nextState.loggedIn === true,
      walletPassword: normalizePassword(nextState.walletPassword),
      updatedAt: String(nextState.updatedAt || isoNow()),
      source: String(nextState.source || state.source || ''),
      reason: String(nextState.reason || ''),
      requestId: String(nextState.requestId || ''),
    };
    authEpoch += 1;
    if (state.loggedIn && (!prevLoggedIn || prevPassword !== state.walletPassword)) {
      loginEpoch = Math.max(loginEpoch + 1, 1);
    }
    return buildSnapshot({ includeSecret: true });
  }

  function setAuthenticated(password, meta = {}) {
    const normalizedPassword = normalizePassword(password);
    const cleanMeta = sanitizeMeta(meta);
    return commit({
      loggedIn: Boolean(normalizedPassword),
      walletPassword: normalizedPassword,
      authenticatedAt: normalizedPassword ? String(meta.authenticatedAt || isoNow()) : '',
      logoutAt: normalizedPassword ? '' : String(meta.logoutAt || isoNow()),
      source: cleanMeta.source || 'runtime_login',
      reason: cleanMeta.reason || '',
      requestId: cleanMeta.requestId || '',
      updatedAt: String(meta.updatedAt || isoNow()),
    });
  }

  function clearAuthenticated(meta = {}) {
    const cleanMeta = sanitizeMeta(meta);
    return commit({
      loggedIn: false,
      walletPassword: '',
      logoutAt: String(meta.logoutAt || isoNow()),
      source: cleanMeta.source || 'runtime_logout',
      reason: cleanMeta.reason || '',
      requestId: cleanMeta.requestId || '',
      updatedAt: String(meta.updatedAt || isoNow()),
    });
  }

  function applySnapshot(snapshot = {}, meta = {}) {
    if (!snapshot || typeof snapshot !== 'object') return buildSnapshot({ includeSecret: true });
    authEpoch = Math.max(
      authEpoch,
      Number.isFinite(Number(snapshot.authEpoch)) ? Number(snapshot.authEpoch) : authEpoch,
    );
    loginEpoch = Math.max(
      loginEpoch,
      Number.isFinite(Number(snapshot.loginEpoch)) ? Number(snapshot.loginEpoch) : loginEpoch,
    );
    state = {
      loggedIn: snapshot.loggedIn === true,
      walletPassword: normalizePassword(snapshot.walletPassword),
      authenticatedAt: String(snapshot.authenticatedAt || ''),
      logoutAt: String(snapshot.logoutAt || ''),
      updatedAt: String(snapshot.updatedAt || meta.updatedAt || isoNow()),
      source: String(snapshot.source || meta.source || ''),
      reason: String(snapshot.reason || meta.reason || ''),
      requestId: String(snapshot.requestId || meta.requestId || ''),
    };
    return buildSnapshot({ includeSecret: true });
  }

  function getWalletPassword() {
    return String(state.walletPassword || '');
  }

  function isLoggedIn() {
    return state.loggedIn === true && Boolean(state.walletPassword);
  }

  if (initialState && typeof initialState === 'object') {
    applySnapshot(initialState, { source: 'initial_state' });
  }

  return {
    buildSnapshot,
    getSnapshot: buildSnapshot,
    setAuthenticated,
    clearAuthenticated,
    applySnapshot,
    getWalletPassword,
    isLoggedIn,
  };
}

module.exports = {
  createAuthStateService,
};
