const wallet = require('../wallet');

function readWalletSummary() {
  let address = '';
  try {
    address = String(wallet.getReceiveAddress() || '').trim();
  } catch (_) {}
  let snapshot = null;
  try {
    snapshot = wallet.getWalletReadSnapshot();
  } catch (_) {
    snapshot = null;
  }
  return {
    exists: wallet.walletExists(),
    address,
    snapshot,
  };
}

function registerWalletRoutes(app) {
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      service: 'wallet_service',
      ts: new Date().toISOString(),
    });
  });

  app.get('/api/wallet/summary', (_req, res) => {
    res.json({
      success: true,
      wallet: readWalletSummary(),
    });
  });
}

module.exports = {
  registerWalletRoutes,
};
