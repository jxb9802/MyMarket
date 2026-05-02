function createDeferredPostLoginRuntime(deps = {}) {
  const {
    buildRuntimeAuthReq,
    chooseRicherStateSnapshot,
    isDeferredPostLoginBusy,
    getLagAdjustedDelayMs,
    appendMarketDebug,
    runChatProjectionBackfillForReq,
    getRuntimeProjectionStateSnapshot,
    writeStateJsonSnapshot,
    isRetriableDeferredPostLoginError,
  } = deps;

  const getRuntimeReq = typeof buildRuntimeAuthReq === 'function'
    ? buildRuntimeAuthReq
    : deps.buildRuntimeWalletReq;

  let deferredPostLoginTimer = null;
  let deferredPostLoginRunning = false;
  let deferredPostLoginQueued = false;
  let deferredPostLoginReq = null;
  let deferredPostLoginReason = 'auth_login_saved';
  let deferredPostLoginStateSnapshot = null;
  let deferredPostLoginPhase = 'wallet';
  let deferredPostLoginAttempt = 1;

  function getSnapshot() {
    return {
      running: deferredPostLoginRunning === true,
      queued: deferredPostLoginQueued === true,
      phase: String(deferredPostLoginPhase || ''),
      attempt: Math.max(0, Number(deferredPostLoginAttempt || 0)),
    };
  }

  function clearDeferredPostLoginTimer() {
    if (!deferredPostLoginTimer) return;
    clearTimeout(deferredPostLoginTimer);
    deferredPostLoginTimer = null;
  }

  function scheduleDeferredPostLoginTasks(
    req,
    stateSnapshot = null,
    reason = 'auth_login_saved',
    phase = null,
    attempt = 1,
  ) {
    deferredPostLoginReq = req?.session?.walletPassword ? req : getRuntimeReq();
    deferredPostLoginReason = String(reason || deferredPostLoginReason || 'auth_login_saved').trim() || 'auth_login_saved';
    if (stateSnapshot && typeof stateSnapshot === 'object') {
      deferredPostLoginStateSnapshot = deferredPostLoginStateSnapshot
        ? chooseRicherStateSnapshot(deferredPostLoginStateSnapshot, stateSnapshot, `${deferredPostLoginReason}_queued`)
        : stateSnapshot;
    }
    const requestedPhase = String(phase || '').trim();
    if (requestedPhase) deferredPostLoginPhase = requestedPhase;
    else if (!String(deferredPostLoginPhase || '').trim()) deferredPostLoginPhase = 'chat';
    deferredPostLoginAttempt = Math.max(1, Number(attempt || deferredPostLoginAttempt || 1));
    deferredPostLoginQueued = true;
    if (deferredPostLoginRunning) return;
    clearDeferredPostLoginTimer();
    const busy = isDeferredPostLoginBusy();
    const normalizedPhase = deferredPostLoginPhase === 'wallet' ? 'chat' : deferredPostLoginPhase;
    deferredPostLoginPhase = normalizedPhase;
    const baseDelayMs = busy.busy ? 20000 : normalizedPhase === 'chat' ? 15000 : 30000;
    const delayMs = Math.min(
      120000,
      getLagAdjustedDelayMs(baseDelayMs * Math.max(1, deferredPostLoginAttempt), { minimumDelayMs: 4000 }),
    );
    deferredPostLoginTimer = setTimeout(() => {
      deferredPostLoginTimer = null;
      if (deferredPostLoginRunning || !deferredPostLoginQueued) return;
      deferredPostLoginQueued = false;
      deferredPostLoginRunning = true;
      const runtimeReq = deferredPostLoginReq?.session?.walletPassword ? deferredPostLoginReq : getRuntimeReq();
      const effectiveReason = String(deferredPostLoginReason || 'auth_login_saved');
      const effectivePhase = String(deferredPostLoginPhase || 'chat');
      const effectiveAttempt = Math.max(1, Number(deferredPostLoginAttempt || 1));
      const busyNow = isDeferredPostLoginBusy();
      if (busyNow.busy) {
        deferredPostLoginRunning = false;
        appendMarketDebug('auth_login_post_tasks_deferred', {
          reason: effectiveReason,
          phase: effectivePhase,
          attempt: effectiveAttempt,
          delayMs,
          busyReason: busyNow.reason,
          lagMs: Number(busyNow.lagMs || 0),
        });
        scheduleDeferredPostLoginTasks(runtimeReq, deferredPostLoginStateSnapshot, effectiveReason, effectivePhase, effectiveAttempt + 1);
        return;
      }
      appendMarketDebug('auth_login_post_tasks_started', {
        reason: effectiveReason,
        phase: effectivePhase,
        attempt: effectiveAttempt,
        delayMs,
      });
      Promise.resolve()
        .then(async () => {
          if (effectivePhase === 'chat') {
            await runChatProjectionBackfillForReq(runtimeReq, effectiveReason);
            deferredPostLoginPhase = 'state';
            deferredPostLoginAttempt = 1;
            scheduleDeferredPostLoginTasks(runtimeReq, deferredPostLoginStateSnapshot, effectiveReason, 'state', 1);
            return;
          }
          const runtimeState = getRuntimeProjectionStateSnapshot(runtimeReq);
          const preferredState = deferredPostLoginStateSnapshot && runtimeState
            ? chooseRicherStateSnapshot(deferredPostLoginStateSnapshot, runtimeState, effectiveReason)
            : (runtimeState || deferredPostLoginStateSnapshot);
          if (!preferredState || typeof preferredState !== 'object') {
            appendMarketDebug('auth_login_post_tasks_state_skipped', {
              reason: effectiveReason,
              phase: effectivePhase,
              attempt: effectiveAttempt,
            });
            return;
          }
          await writeStateJsonSnapshot(preferredState, {
            reason: effectiveReason,
          });
        })
        .catch((err) => {
          appendMarketDebug('auth_login_post_tasks_failed', {
            reason: effectiveReason,
            phase: effectivePhase,
            attempt: effectiveAttempt,
            message: String(err?.message || 'auth_login_post_tasks_failed'),
          });
          if (isRetriableDeferredPostLoginError(err)) {
            scheduleDeferredPostLoginTasks(runtimeReq, deferredPostLoginStateSnapshot, effectiveReason, effectivePhase, effectiveAttempt + 1);
          }
        })
        .finally(() => {
          deferredPostLoginRunning = false;
          if (deferredPostLoginQueued && !deferredPostLoginTimer) {
            scheduleDeferredPostLoginTasks(
              deferredPostLoginReq,
              deferredPostLoginStateSnapshot,
              deferredPostLoginReason,
              deferredPostLoginPhase,
              deferredPostLoginAttempt,
            );
          }
        });
    }, delayMs);
    deferredPostLoginTimer.unref?.();
  }

  return {
    getSnapshot,
    clearDeferredPostLoginTimer,
    scheduleDeferredPostLoginTasks,
  };
}

module.exports = {
  createDeferredPostLoginRuntime,
};
