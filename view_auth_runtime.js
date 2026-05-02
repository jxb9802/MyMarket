const { createAuthStateService } = require('./auth_state_service');

function createViewAuthRuntime() {
  const authState = createAuthStateService();
  let initialized = false;

  function applySnapshot(snapshot = {}, meta = {}) {
    const next = authState.applySnapshot(snapshot, meta);
    initialized = next.loggedIn === true;
    return next;
  }

  function clear(meta = {}) {
    const next = authState.clearAuthenticated(meta);
    initialized = false;
    return next;
  }

  function getRuntimeReq() {
    const password = String(authState.getWalletPassword() || '').trim();
    return password ? { session: { walletPassword: password } } : {};
  }

  return {
    applySnapshot,
    clear,
    getSnapshot: authState.getSnapshot,
    getRuntimeReq,
    getWalletPassword: authState.getWalletPassword,
    isLoggedIn: authState.isLoggedIn,
    isInitialized: () => initialized === true,
  };
}

module.exports = {
  createViewAuthRuntime,
};
