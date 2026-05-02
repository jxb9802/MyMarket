function normalizeString(value) {
  return String(value || '').trim();
}

function createChatSummaryStore() {
  const summaries = new Map();

  function upsertSummary(walletId, patch = {}) {
    const safeWalletId = normalizeString(walletId);
    if (!safeWalletId) throw new Error('walletId is required');
    const next = {
      ...(summaries.get(safeWalletId) || { walletId: safeWalletId }),
      ...patch,
      walletId: safeWalletId,
    };
    summaries.set(safeWalletId, next);
    return { ...next };
  }

  function getSummary(walletId) {
    const safeWalletId = normalizeString(walletId);
    return safeWalletId ? summaries.get(safeWalletId) || null : null;
  }

  function listSummaries() {
    return Array.from(summaries.values()).map((row) => ({ ...row }));
  }

  return {
    upsertSummary,
    getSummary,
    listSummaries,
  };
}

module.exports = {
  createChatSummaryStore,
};
