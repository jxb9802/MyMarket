function createChatRuntimeStore(deps = {}) {
  const {
    ensureChatState,
    ensureChatThread,
  } = deps;

  function getThreadByWalletId(state, walletId, req = null) {
    ensureChatState(state, req);
    return state?.chatThreads?.[String(walletId || '').trim()] || null;
  }

  function listSessionsByWalletId(state, walletId, req = null) {
    ensureChatState(state, req);
    const safeWalletId = String(walletId || '').trim();
    return Object.values(state?.chatSessions || {}).filter((row) => (
      String(row?.walletId || '').trim() === safeWalletId
    ));
  }

  function upsertThreadConnectionState(state, walletId, patch = {}, req = null) {
    ensureChatState(state, req);
    const threadPatch = {};
    if (Object.prototype.hasOwnProperty.call(patch || {}, 'displayName')) {
      threadPatch.displayName = String(patch.displayName || '');
    }
    const thread = ensureChatThread(state, walletId, threadPatch);
    if (!thread) return null;
    if (patch.directConnected !== undefined) thread.directConnected = patch.directConnected === true;
    if (patch.connecting !== undefined) thread.connecting = patch.connecting === true;
    if (patch.presenceStatus !== undefined) thread.presenceStatus = String(patch.presenceStatus || '');
    if (patch.statusLabel !== undefined) thread.statusLabel = String(patch.statusLabel || '');
    if (patch.activeSessionId !== undefined) thread.activeSessionId = String(patch.activeSessionId || '');
    if (patch.lastMessageAt !== undefined) thread.lastMessageAt = String(patch.lastMessageAt || '');
    return thread;
  }

  return {
    getThreadByWalletId,
    listSessionsByWalletId,
    upsertThreadConnectionState,
  };
}

module.exports = {
  createChatRuntimeStore,
};
