function normalizeString(value) {
  return String(value || '').trim();
}

function createChatMessageRuntime(deps = {}) {
  const appendMessage = typeof deps.appendMessage === 'function' ? deps.appendMessage : null;
  const markDelivered = typeof deps.markDelivered === 'function' ? deps.markDelivered : null;

  async function receiveMessage(frame = {}) {
    const walletId = normalizeString(frame.walletId || frame.fromWalletId);
    const messageId = normalizeString(frame.messageId);
    if (!walletId) throw new Error('walletId is required');
    if (!messageId) throw new Error('messageId is required');
    if (appendMessage) {
      await appendMessage(walletId, {
        ...frame,
        walletId,
        messageId,
      });
    }
    return {
      type: 'chat.message.delivered',
      walletId,
      messageId,
      createdAt: new Date().toISOString(),
    };
  }

  async function receiveDelivery(frame = {}) {
    const messageId = normalizeString(frame.messageId);
    if (!messageId) throw new Error('messageId is required');
    if (markDelivered) await markDelivered(messageId, frame);
    return {
      messageId,
      delivered: true,
    };
  }

  return {
    receiveMessage,
    receiveDelivery,
  };
}

module.exports = {
  createChatMessageRuntime,
};
