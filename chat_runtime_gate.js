function createChatRuntimeGate(deps = {}) {
  const {
    getLagDrivenSyncPolicy,
    buildTrustedWalletPolicyState,
  } = deps;

  function getStatus(state = null) {
    const trustedState = typeof buildTrustedWalletPolicyState === 'function'
      ? buildTrustedWalletPolicyState(state)
      : state;
    const policy = typeof getLagDrivenSyncPolicy === 'function'
      ? getLagDrivenSyncPolicy(trustedState)
      : null;
    const mode = String(policy?.mode || '').trim().toLowerCase();
    const enabled = mode !== 'full_sync';
    return {
      enabled,
      mode,
      policy: policy && typeof policy === 'object' ? policy : null,
      reason: enabled
        ? ''
        : 'chat runtime disabled during full sync',
    };
  }

  function assertEnabled(state = null) {
    const status = getStatus(state);
    if (status.enabled) return status;
    const error = new Error(status.reason || 'chat runtime disabled');
    error.statusCode = 409;
    error.chatRuntimeGate = status;
    throw error;
  }

  return {
    getStatus,
    assertEnabled,
  };
}

module.exports = {
  createChatRuntimeGate,
};
