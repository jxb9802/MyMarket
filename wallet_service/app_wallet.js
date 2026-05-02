const express = require('express');
const { registerWalletRoutes } = require('./wallet_routes');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

registerWalletRoutes(app);

const port = Number(process.env.WALLET_PORT || 8094);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`wallet_service listening on http://127.0.0.1:${port}`);
});
