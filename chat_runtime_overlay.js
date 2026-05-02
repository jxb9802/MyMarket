function createChatRuntimeOverlay(deps = {}) {
  const {
    cloneRuntimeProjectionState,
    defaultChatIdentity,
    defaultChatUi,
    ensureChatState,
  } = deps;

  let runtimeChatStateOverlay = null;

  function cloneChatStateOverlay(state = null) {
    if (!state || typeof state !== 'object') return null;
    return {
      chatConfig: state?.chatConfig && typeof state.chatConfig === 'object'
        ? cloneRuntimeProjectionState(state.chatConfig)
        : {},
      chatIdentity: {
        ...defaultChatIdentity(),
        ...(state?.chatIdentity && typeof state.chatIdentity === 'object'
          ? cloneRuntimeProjectionState(state.chatIdentity) || {}
          : {}),
        self: {
          ...defaultChatIdentity().self,
          ...(state?.chatIdentity?.self && typeof state.chatIdentity.self === 'object'
            ? cloneRuntimeProjectionState(state.chatIdentity.self) || {}
            : {}),
        },
      },
      chatThreads: state?.chatThreads && typeof state.chatThreads === 'object'
        ? cloneRuntimeProjectionState(state.chatThreads) || {}
        : {},
      chatMessages: state?.chatMessages && typeof state.chatMessages === 'object'
        ? cloneRuntimeProjectionState(state.chatMessages) || {}
        : {},
      chatSessions: state?.chatSessions && typeof state.chatSessions === 'object'
        ? cloneRuntimeProjectionState(state.chatSessions) || {}
        : {},
      chatDiscovery: {
        profiles: state?.chatDiscovery?.profiles && typeof state.chatDiscovery.profiles === 'object'
          ? cloneRuntimeProjectionState(state.chatDiscovery.profiles) || {}
          : {},
        invites: state?.chatDiscovery?.invites && typeof state.chatDiscovery.invites === 'object'
          ? cloneRuntimeProjectionState(state.chatDiscovery.invites) || {}
          : {},
      },
      chatUi: {
        ...defaultChatUi(),
        ...(state?.chatUi && typeof state.chatUi === 'object'
          ? cloneRuntimeProjectionState(state.chatUi) || {}
          : {}),
      },
    };
  }

  function commit(state = null) {
    runtimeChatStateOverlay = cloneChatStateOverlay(state);
    return runtimeChatStateOverlay;
  }

  function mergeInto(state = null, overlay = null) {
    if (!state || typeof state !== 'object') return state;
    const source = overlay && typeof overlay === 'object' ? overlay : runtimeChatStateOverlay;
    if (!source || typeof source !== 'object') {
      ensureChatState(state);
      return state;
    }
    state.chatConfig = source?.chatConfig && typeof source.chatConfig === 'object'
      ? cloneRuntimeProjectionState(source.chatConfig) || {}
      : {};
    state.chatIdentity = {
      ...defaultChatIdentity(),
      ...(source?.chatIdentity && typeof source.chatIdentity === 'object'
        ? cloneRuntimeProjectionState(source.chatIdentity) || {}
        : {}),
      self: {
        ...defaultChatIdentity().self,
        ...(source?.chatIdentity?.self && typeof source.chatIdentity.self === 'object'
          ? cloneRuntimeProjectionState(source.chatIdentity.self) || {}
          : {}),
      },
    };
    state.chatThreads = source?.chatThreads && typeof source.chatThreads === 'object'
      ? cloneRuntimeProjectionState(source.chatThreads) || {}
      : {};
    state.chatMessages = source?.chatMessages && typeof source.chatMessages === 'object'
      ? cloneRuntimeProjectionState(source.chatMessages) || {}
      : {};
    state.chatSessions = source?.chatSessions && typeof source.chatSessions === 'object'
      ? cloneRuntimeProjectionState(source.chatSessions) || {}
      : {};
    state.chatDiscovery = {
      profiles: source?.chatDiscovery?.profiles && typeof source.chatDiscovery.profiles === 'object'
        ? cloneRuntimeProjectionState(source.chatDiscovery.profiles) || {}
        : {},
      invites: source?.chatDiscovery?.invites && typeof source.chatDiscovery.invites === 'object'
        ? cloneRuntimeProjectionState(source.chatDiscovery.invites) || {}
        : {},
    };
    state.chatUi = {
      ...defaultChatUi(),
      ...(source?.chatUi && typeof source.chatUi === 'object'
        ? cloneRuntimeProjectionState(source.chatUi) || {}
        : {}),
    };
    ensureChatState(state);
    return state;
  }

  function getSnapshot() {
    return cloneChatStateOverlay(runtimeChatStateOverlay);
  }

  return {
    cloneChatStateOverlay,
    commit,
    mergeInto,
    getSnapshot,
  };
}

module.exports = {
  createChatRuntimeOverlay,
};
