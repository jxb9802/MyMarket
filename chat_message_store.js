function normalizeString(value) {
  return String(value || '').trim();
}

function createChatMessageStore() {
  const rows = new Map();

  function saveMessage(message = {}) {
    const messageId = normalizeString(message.messageId || message.msgId || message.txid);
    if (!messageId) throw new Error('messageId is required');
    const next = {
      ...message,
      messageId,
    };
    rows.set(messageId, next);
    return { ...next };
  }

  function getMessage(messageId) {
    const safeId = normalizeString(messageId);
    return safeId ? rows.get(safeId) || null : null;
  }

  function listMessagesByThread(walletId) {
    const safeWalletId = normalizeString(walletId);
    return Array.from(rows.values())
      .filter((row) => normalizeString(row.walletId) === safeWalletId)
      .sort((a, b) => Date.parse(String(a.createdAt || 0)) - Date.parse(String(b.createdAt || 0)))
      .map((row) => ({ ...row }));
  }

  return {
    saveMessage,
    getMessage,
    listMessagesByThread,
  };
}

module.exports = {
  createChatMessageStore,
};
