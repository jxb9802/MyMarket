function createChatOpenFlow(deps = {}) {
  const {
    appendMarketDebug,
    getRuntimeProjectionStateSnapshot,
    buildRuntimeAuthReq,
    ensureChatState,
    buildChatDomainOpenPayloadFromState,
  } = deps;

  async function buildOpenPayload(req, options = {}) {
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
    const payload = await buildChatDomainOpenPayloadFromState(state, req, options);
    appendMarketDebug('chat_threads_served', {
      elapsedMs: Date.now() - startedAt,
      people: Array.isArray(payload?.people) ? payload.people.length : 0,
      friends: Array.isArray(payload?.friends) ? payload.friends.length : 0,
      unreadTotal: Math.max(0, Number(payload?.unreadTotal || 0)),
    });
    return {
      success: true,
      threads: [],
      people: payload.people,
      friends: payload.friends,
      recent: payload.recent,
      unreadTotal: payload.unreadTotal,
      selfState: payload.selfState,
      identity: payload.identity,
    };
  }

  return {
    buildOpenPayload,
  };
}

module.exports = {
  createChatOpenFlow,
};
