'use strict';

function normalizeTxBuildResult(input = {}) {
  const txid = String(input?.txid || '').trim().toLowerCase();
  const rawtx = String(input?.rawtx || '').trim();
  const kind = String(input?.kind || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(txid)) {
    const err = new Error('Invalid transaction id');
    err.code = 'INVALID_TX_BUILD_RESULT';
    throw err;
  }
  if (!/^[0-9a-f]+$/i.test(rawtx) || rawtx.length % 2 !== 0) {
    const err = new Error('Invalid raw transaction hex');
    err.code = 'INVALID_TX_BUILD_RESULT';
    throw err;
  }
  if (!kind) {
    const err = new Error('Transaction kind is required');
    err.code = 'INVALID_TX_BUILD_RESULT';
    throw err;
  }
  return {
    ...input,
    txid,
    rawtx,
    kind,
    rawtxBytes: Math.floor(rawtx.length / 2),
  };
}

function buildAcceptSellerLockTx({ wallet, mnemonic, order, anchorText, notifyAddresses = [], reserves = {} } = {}) {
  if (!wallet || typeof wallet.buildOrderSellerLockTx !== 'function') {
    throw new Error('wallet.buildOrderSellerLockTx is required');
  }
  const result = wallet.buildOrderSellerLockTx({
    mnemonic,
    orderId: order?.id,
    priceSats: Number(order?.funds?.priceSats || 0),
    buyerChatPubKey: String(order?.chain?.buyerChatPubKey || '').trim(),
    sellerChatPubKey: String(order?.chain?.sellerChatPubKey || '').trim(),
    anchorText,
    notifyAddresses,
    settlementFeeReserveSats: Number(reserves.settlementFeeReserveSats || 0),
    shipAnchorFeeReserveSats: Number(reserves.shipAnchorFeeReserveSats || 0),
    note: `order_accept:${order?.id || ''}`,
  });
  return normalizeTxBuildResult({
    ...result,
    kind: 'order_accept_seller_lock',
  });
}

module.exports = {
  buildAcceptSellerLockTx,
  normalizeTxBuildResult,
};
