function createChatPostLoginRuntime(deps = {}) {
  const {
    buildRuntimeAuthReq,
    appendMarketDebug,
    yieldToEventLoop,
    getRuntimeProjectionStateSnapshot,
    buildProjectionBackedState,
    rebuildDataFromLocalAnchors,
    isDeferredPostLoginBusy,
    isHeavySyncActivityInProgress,
    getLagAdjustedDelayMs,
  } = deps;

  const getRuntimeReq = typeof buildRuntimeAuthReq === 'function'
    ? buildRuntimeAuthReq
    : deps.buildRuntimeWalletReq;

  let chatProjectionBackfillAfterLoginTimer = null;
  let chatProjectionBackfillAfterLoginPromise = null;
  let chatProjectionBackfillAfterLoginQueued = false;
  let chatProjectionBackfillAfterLoginReq = null;
  let chatProjectionBackfillAfterLoginReason = 'wallet_login';

  function clearChatProjectionBackfillAfterLoginTimer() {
    if (!chatProjectionBackfillAfterLoginTimer) return;
    clearTimeout(chatProjectionBackfillAfterLoginTimer);
    chatProjectionBackfillAfterLoginTimer = null;
  }

  async function runChatProjectionBackfillForReq(req, reason = 'wallet_login') {
    const runtimeReq = req?.session?.walletPassword ? req : getRuntimeReq();
    appendMarketDebug('chat_projection_backfill_after_login_started', { reason });
    await yieldToEventLoop();
    const state = getRuntimeProjectionStateSnapshot(runtimeReq) || buildProjectionBackedState(runtimeReq);
    await rebuildDataFromLocalAnchors(state, runtimeReq, {
      reason: `${reason}_chat_backfill`,
      source: `${reason}_chat_backfill`,
      chatOnly: true,
    });
    appendMarketDebug('chat_projection_backfill_after_login_done', {
      reason,
      localHeight: Number(state?.sync?.localHeight || 0),
    });
  }

  function runChatProjectionBackfillAfterLogin() {
    if (chatProjectionBackfillAfterLoginPromise) {
      chatProjectionBackfillAfterLoginQueued = true;
      return chatProjectionBackfillAfterLoginPromise;
    }
    const runtimeReq = chatProjectionBackfillAfterLoginReq?.session?.walletPassword
      ? chatProjectionBackfillAfterLoginReq
      : getRuntimeReq();
    const reason = String(chatProjectionBackfillAfterLoginReason || 'wallet_login');
    chatProjectionBackfillAfterLoginReq = null;
    chatProjectionBackfillAfterLoginQueued = false;
    chatProjectionBackfillAfterLoginPromise = Promise.resolve()
      .then(async () => {
        const busy = isDeferredPostLoginBusy();
        if (busy.busy) {
          appendMarketDebug('chat_projection_backfill_after_login_delayed', {
            reason,
            delayMs: 12000,
            busyReason: busy.reason,
            lagMs: Number(busy.lagMs || 0),
          });
          chatProjectionBackfillAfterLoginQueued = true;
          clearChatProjectionBackfillAfterLoginTimer();
          chatProjectionBackfillAfterLoginTimer = setTimeout(() => {
            chatProjectionBackfillAfterLoginTimer = null;
            void runChatProjectionBackfillAfterLogin();
          }, 12000);
          return;
        }
        await runChatProjectionBackfillForReq(runtimeReq, reason);
      })
      .catch((err) => {
        appendMarketDebug('chat_projection_backfill_after_login_failed', {
          reason,
          message: String(err?.message || 'chat projection backfill failed'),
        });
      })
      .finally(() => {
        chatProjectionBackfillAfterLoginPromise = null;
        if (chatProjectionBackfillAfterLoginQueued) {
          chatProjectionBackfillAfterLoginQueued = false;
          clearChatProjectionBackfillAfterLoginTimer();
          chatProjectionBackfillAfterLoginTimer = setTimeout(() => {
            chatProjectionBackfillAfterLoginTimer = null;
            void runChatProjectionBackfillAfterLogin();
          }, 2500);
        }
      });
    return chatProjectionBackfillAfterLoginPromise;
  }

  function scheduleChatProjectionBackfillAfterLogin(req, reason = 'wallet_login') {
    chatProjectionBackfillAfterLoginReq = req?.session?.walletPassword ? req : getRuntimeReq();
    chatProjectionBackfillAfterLoginReason = String(reason || 'wallet_login');
    chatProjectionBackfillAfterLoginQueued = true;
    clearChatProjectionBackfillAfterLoginTimer();
    const delayMs = isHeavySyncActivityInProgress() ? 12000 : 2500;
    chatProjectionBackfillAfterLoginTimer = setTimeout(() => {
      chatProjectionBackfillAfterLoginTimer = null;
      void runChatProjectionBackfillAfterLogin();
    }, getLagAdjustedDelayMs(delayMs, { minimumDelayMs: 2500 }));
    chatProjectionBackfillAfterLoginTimer.unref?.();
  }

  return {
    clearChatProjectionBackfillAfterLoginTimer,
    runChatProjectionBackfillForReq,
    runChatProjectionBackfillAfterLogin,
    scheduleChatProjectionBackfillAfterLogin,
  };
}

module.exports = {
  createChatPostLoginRuntime,
};
