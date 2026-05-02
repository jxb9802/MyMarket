const { listCatalogSummary } = require('./catalog/catalog_query');
const { listOrderSummary, getOrderById, listOrderTimeline } = require('./order/order_query');

function parseDomainSet(raw) {
  return new Set(String(raw || 'catalog,order')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean));
}

function registerTradeRoutes(app) {
  app.get('/health', (_req, res) => {
    res.json({
      success: true,
      service: 'trade_service',
      ts: new Date().toISOString(),
    });
  });

  app.get('/api/catalog/summary', (_req, res) => {
    res.json({
      success: true,
      ...listCatalogSummary(),
    });
  });

  app.get('/api/orders', (_req, res) => {
    res.json({
      success: true,
      ...listOrderSummary(),
    });
  });

  app.get('/api/orders/:id', (req, res) => {
    const order = getOrderById(req.params.id);
    if (!order) {
      res.status(404).json({
        success: false,
        error: 'Order not found',
      });
      return;
    }
    res.json({
      success: true,
      order,
    });
  });

  app.get('/api/orders/:id/timeline', (req, res) => {
    res.json({
      success: true,
      orderId: String(req.params.id || '').trim(),
      events: listOrderTimeline(req.params.id),
    });
  });

  app.get('/api/bootstrap-lite', (req, res) => {
    const domainSet = parseDomainSet(req.query?.domains);
    const domains = {};
    if (domainSet.has('catalog')) {
      domains.catalog = listCatalogSummary();
    }
    if (domainSet.has('order')) {
      const orderSummary = listOrderSummary();
      domains.order = {
        orders: Array.isArray(orderSummary.orders) ? orderSummary.orders : [],
      };
    }
    res.json({
      success: true,
      bootstrapVersion: 1,
      serverTs: new Date().toISOString(),
      domains,
    });
  });
}

module.exports = {
  registerTradeRoutes,
};
