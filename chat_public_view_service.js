function createChatPublicViewService(deps = {}) {
  const {
    CHAT_MODULE_ENABLED,
    defaultChatConfig,
  } = deps;

  function emptyPublicChatViews(req = null) {
    const authCode = req?.session?.walletPassword ? '' : 'AUTH_REQUIRED';
    return {
      chatIdentity: authCode
        ? { success: false, error: 'Not logged in', code: authCode }
        : { success: true, identity: null },
      chatThreads: authCode
        ? { success: false, threads: [], unreadTotal: 0, code: authCode }
        : { success: true, threads: [], unreadTotal: 0 },
      chatUnread: authCode
        ? { success: false, unreadTotal: 0, buttonHasUnread: false, byWalletId: {}, code: authCode }
        : { success: true, unreadTotal: 0, buttonHasUnread: false, byWalletId: {} },
      chatConfig: defaultChatConfig(),
    };
  }

  function buildChatSignalSnapshot(req = null, options = {}) {
    return {
      enabled: CHAT_MODULE_ENABLED,
      dirty: true,
      hasSession: Boolean(req?.session?.walletPassword),
      reason: String(options.reason || 'chat_domain_signal'),
      ts: new Date().toISOString(),
    };
  }

  return {
    emptyPublicChatViews,
    buildChatSignalSnapshot,
  };
}

module.exports = {
  createChatPublicViewService,
};
