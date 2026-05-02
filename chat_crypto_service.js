function createChatCryptoService(deps = {}) {
  const {
    wallet,
    appendMarketDebug,
    getRuntimeAuthPassword,
    ensureChatState,
    getEffectiveAnchorRows,
  } = deps;

  const readRuntimePassword = typeof getRuntimeAuthPassword === 'function'
    ? getRuntimeAuthPassword
    : deps.getRuntimeWalletPassword;
  let cachedMnemonicPassword = '';
  let cachedMnemonicValue = '';

  function getMnemonicForPassword(passwordLike = '') {
    const password = String(passwordLike || '').trim();
    if (!password) return '';
    if (cachedMnemonicPassword === password && cachedMnemonicValue) return cachedMnemonicValue;
    const mnemonic = String(wallet.getMnemonicFromPassword(password) || '').trim();
    cachedMnemonicPassword = password;
    cachedMnemonicValue = mnemonic;
    return mnemonic;
  }

  function verifyChatEnvelopeWithRuntime({
    senderPubKey,
    recipientPubKey = '',
    ciphertext,
    nonce,
    authTag,
    msgId = '',
    sessionId = '',
    fromWalletId = '',
    toWalletId = '',
    ts = '',
    orderId = '',
    signature = '',
    password: explicitPassword = '',
  }) {
    const effectiveRecipientPubKey = String(recipientPubKey || '').trim();
    const debugPayload = [
      String(senderPubKey || '').trim(),
      effectiveRecipientPubKey,
      String(ciphertext || ''),
      String(nonce || ''),
      String(authTag || ''),
      String(msgId || ''),
      String(sessionId || ''),
      String(fromWalletId || ''),
      String(toWalletId || ''),
      String(ts || ''),
      String(orderId || ''),
    ].join('|');
    const password = String(explicitPassword || readRuntimePassword() || '').trim();
    if (!password) return false;
    try {
      const mnemonic = getMnemonicForPassword(password);
      const selfChatPubKey = String(wallet.deriveChatPublicKeyFromMnemonic(mnemonic) || '').trim();
      let peerPublicKey = String(senderPubKey || '').trim();
      if (selfChatPubKey && String(senderPubKey || '').trim() === selfChatPubKey && effectiveRecipientPubKey) {
        peerPublicKey = effectiveRecipientPubKey;
      } else if (selfChatPubKey && effectiveRecipientPubKey === selfChatPubKey && String(senderPubKey || '').trim()) {
        peerPublicKey = String(senderPubKey || '').trim();
      }
      const ok = wallet.verifyChatEnvelope({
        mnemonic,
        peerPublicKey,
        senderPubKey,
        recipientPubKey: effectiveRecipientPubKey,
        ciphertext,
        nonce,
        authTag,
        msgId,
        sessionId,
        fromWalletId,
        toWalletId,
        ts,
        orderId,
        signature,
      });
      if (!ok) {
        appendMarketDebug('chat_signature_verify_mismatch', {
          msgId: String(msgId || ''),
          sessionId: String(sessionId || ''),
          fromWalletId: String(fromWalletId || ''),
          toWalletId: String(toWalletId || ''),
          selfChatPubKey,
          peerPublicKey,
          senderPubKey: String(senderPubKey || ''),
          recipientPubKey: effectiveRecipientPubKey,
          ts: String(ts || ''),
          orderId: String(orderId || ''),
          payload: debugPayload,
          signature: String(signature || ''),
        });
      }
      return ok;
    } catch (_) {
      return false;
    }
  }

  function decryptChatEnvelopeWithRuntime({
    senderPubKey,
    ciphertext,
    nonce,
    authTag,
    password: explicitPassword = '',
  }) {
    const password = String(explicitPassword || readRuntimePassword() || '').trim();
    if (!password) return '';
    try {
      const mnemonic = getMnemonicForPassword(password);
      return String(wallet.decryptChatMessage({
        mnemonic,
        peerPublicKey: senderPubKey,
        ciphertext,
        nonce,
        authTag,
      }) || '');
    } catch (_) {
      return '';
    }
  }

  function decryptChatEnvelopeWithPeerPubKey({
    peerPubKey,
    ciphertext,
    nonce,
    authTag,
    password: explicitPassword = '',
  }) {
    const password = String(explicitPassword || readRuntimePassword() || '').trim();
    if (!password) return '';
    try {
      const mnemonic = getMnemonicForPassword(password);
      return String(wallet.decryptChatMessage({
        mnemonic,
        peerPublicKey: String(peerPubKey || '').trim(),
        ciphertext,
        nonce,
        authTag,
      }) || '');
    } catch (_) {
      return '';
    }
  }

  function verifyWalletKeyBindPayload(payload = {}) {
    const base = {
      walletId: String(payload.walletId || '').trim(),
      merchantId: String(payload.merchantId || '').trim(),
      chatPubKey: String(payload.chatPubKey || '').trim(),
      endpointHints: Array.isArray(payload.endpointHints) ? payload.endpointHints : [],
      relayHints: Array.isArray(payload.relayHints) ? payload.relayHints : [],
      signature: String(payload.signature || ''),
    };
    const createdAt = String(payload.createdAt || '').trim();
    const updatedAt = String(payload._updatedAt || '').trim();
    if (wallet.verifyWalletKeyBind({ ...base, createdAt: createdAt || updatedAt })) return true;
    if (!createdAt && wallet.verifyWalletKeyBind({ ...base, createdAt: '' })) return true;
    return false;
  }

  function getRecentChatAnchorRowsForPeer(state, peerWalletId, limit = 24) {
    ensureChatState(state);
    const selfWalletId = String(state.chatIdentity?.self?.walletId || '').trim();
    const peer = String(peerWalletId || '').trim();
    if (!selfWalletId || !peer) return [];
    const rows = getEffectiveAnchorRows(state);
    return rows
      .filter((row) => {
        const eventType = String(row?.eventType || '').trim();
        if (!['wallet_key_bind', 'chat_message', 'chat_invite', 'chat_connect_ack'].includes(eventType)) return false;
        if (eventType === 'wallet_key_bind') {
          const walletId = String(row?.payload?.walletId || '').trim();
          return walletId === selfWalletId || walletId === peer;
        }
        const fromWalletId = String(row?.payload?.fromWalletId || '').trim();
        const toWalletId = String(row?.payload?.toWalletId || '').trim();
        return (fromWalletId === selfWalletId && toWalletId === peer)
          || (fromWalletId === peer && toWalletId === selfWalletId);
      })
      .sort((a, b) => {
        const ta = Date.parse(String(a?.ts || '')) || 0;
        const tb = Date.parse(String(b?.ts || '')) || 0;
        return ta - tb;
      })
      .slice(-Math.max(1, Number(limit || 24)));
  }

  return {
    verifyChatEnvelopeWithRuntime,
    decryptChatEnvelopeWithRuntime,
    decryptChatEnvelopeWithPeerPubKey,
    verifyWalletKeyBindPayload,
    getRecentChatAnchorRowsForPeer,
  };
}

module.exports = {
  createChatCryptoService,
};
