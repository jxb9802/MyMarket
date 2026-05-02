const BUS_TOPICS = Object.freeze({
  trade: Object.freeze({
    orderStateChanged: 'trade.event.order.state_changed',
    orderPendingChanged: 'trade.event.order.pending_changed',
    orderFailed: 'trade.event.order.failed',
  }),
  wallet: Object.freeze({
    orderTxBroadcasted: 'wallet.event.order_tx.broadcasted',
    orderTxConfirmed: 'wallet.event.order_tx.confirmed',
    orderTxFailed: 'wallet.event.order_tx.failed',
  }),
  ui: Object.freeze({
    openOrderThread: 'ui.chat.open_order_thread',
  }),
});

module.exports = {
  BUS_TOPICS,
};
