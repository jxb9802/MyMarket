function normalizeString(value) {
  return String(value || '').trim();
}

function createChatThreadStore() {
  const threads = new Map();

  function upsertThread(walletId, patch = {}) {
    const safeWalletId = normalizeString(walletId);
    if (!safeWalletId) throw new Error('walletId is required');
    const current = threads.get(safeWalletId) || {
      walletId: safeWalletId,
      unread: 0,
      lastMessage: '',
      lastTs: '',
    };
    const next = {
      ...current,
      ...patch,
      walletId: safeWalletId,
    };
    threads.set(safeWalletId, next);
    return { ...next };
  }

  function getThread(walletId) {
    const safeWalletId = normalizeString(walletId);
    return safeWalletId ? threads.get(safeWalletId) || null : null;
  }

  function listThreads() {
    return Array.from(threads.values()).map((row) => ({ ...row }));
  }

  return {
    upsertThread,
    getThread,
    listThreads,
  };
}

module.exports = {
  createChatThreadStore,
};
