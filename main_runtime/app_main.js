const express = require('express');
const { createRuntimeBus } = require('./runtime_bus');
const { createRuntimeSupervisor } = require('./runtime_supervisor');
const { registerHealthRoutes } = require('./health_routes');
const { registerAuthGateway } = require('./auth_gateway');

const app = express();
const runtime = {
  supervisor: createRuntimeSupervisor(),
  bus: createRuntimeBus(),
};

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

registerHealthRoutes(app, runtime.supervisor);
registerAuthGateway(app);

app.get('/api/runtime/bus/topics', (_req, res) => {
  res.json({
    success: true,
    topics: [
      'trade.event.order.state_changed',
      'trade.event.order.pending_changed',
      'wallet.event.order_tx.broadcasted',
      'wallet.event.order_tx.confirmed',
      'wallet.event.order_tx.failed',
      'ui.chat.open_order_thread',
    ],
  });
});

const port = Number(process.env.MAIN_PORT || 8091);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`main_runtime listening on http://127.0.0.1:${port}`);
});
