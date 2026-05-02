function createChatThreadFlow(deps = {}) {
  const {
    appendMarketDebug,
    getRuntimeProjectionStateSnapshot,
    buildRuntimeAuthReq,
    ensureChatState,
    buildChatDomainThreadPayloadFromState,
  } = deps;

  async function buildThreadPayload(req, walletId) {
    const safeWalletId = String(walletId || '').trim();
    if (!safeWalletId) {
      const error = new Error('walletId is required');
      error.statusCode = 400;
      throw error;
    }
    const startedAt = Date.now();
    const runtimeReq = typeof buildRuntimeAuthReq === 'function' ? buildRuntimeAuthReq() : {};
    const state = typeof getRuntimeProjectionStateSnapshot === 'function'
      ? getRuntimeProjectionStateSnapshot(runtimeReq)
      : null;
    if (!state || typeof state !== 'object') {
      const error = new Error('chat runtime unavailable');
      error.statusCode = 503;
      throw error;
    }
    ensureChatState(state, runtimeReq);
    const payload = await buildChatDomainThreadPayloadFromState(state, req, safeWalletId);
    appendMarketDebug('chat_thread_served', {
      elapsedMs: Date.now() - startedAt,
      walletId: safeWalletId,
      messageCount: Array.isArray(payload?.messages) ? payload.messages.length : 0,
      page: Math.max(1, Number(req?.query?.page || 1)),
      pageSize: Math.max(1, Number(req?.query?.pageSize || 10)),
    });
    return {
      success: true,
      ...payload,
    };
  }

  return {
    buildThreadPayload,
  };
}

module.exports = {
  createChatThreadFlow,
};
