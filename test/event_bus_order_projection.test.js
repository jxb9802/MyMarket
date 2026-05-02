const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadFresh(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(modulePath);
}

test('event bus appends order facts and builds order projection', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bsv-market-event-bus-order-'));
  const dataDir = path.join(tmpRoot, 'data');
  const logDir = path.join(tmpRoot, 'log');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });

  const previousEnv = {
    BSV_MARKET_DATA_DIR: process.env.BSV_MARKET_DATA_DIR,
    BSV_MARKET_LOG_DIR: process.env.BSV_MARKET_LOG_DIR,
  };

  process.env.BSV_MARKET_DATA_DIR = dataDir;
  process.env.BSV_MARKET_LOG_DIR = logDir;

  const marketDb = loadFresh('../market_db');
  const eventBus = loadFresh('../lib/event_bus');
  const orderDomain = loadFresh('../order_domain');

  t.after(async () => {
    await marketDb.stopWriterService().catch(() => {});
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  await marketDb.ensureWriterService();

  await orderDomain.emitOrderUpsert({
    id: 'ORD-001',
    status: 'OPENED',
    snapshot: {
      product_id: 'p-1',
      product_version: 1,
      price_snapshot: 1500,
    },
    funds: {
      priceSats: 1500,
      buyerLockedSats: 1800,
    },
    transitionIds: ['open:ORD-001'],
    tip: 'opened',
    updatedAt: '2026-04-04T16:00:00.000Z',
  }, {
    producer: 'order_test',
    dedupeKey: 'order-test:ORD-001:opened',
  });

  await orderDomain.emitOrderUpsert({
    id: 'ORD-001',
    status: 'SHIPPED',
    snapshot: {
      product_id: 'p-1',
      product_version: 1,
      price_snapshot: 1500,
    },
    funds: {
      priceSats: 1500,
      buyerLockedSats: 1800,
      sellerLockedSats: 150,
    },
    transitionIds: ['open:ORD-001', 'ship:ORD-001'],
    tip: 'shipped',
    updatedAt: '2026-04-04T16:05:00.000Z',
  }, {
    producer: 'order_test',
    dedupeKey: 'order-test:ORD-001:shipped',
  });

  const events = await eventBus.listEventsAfter(0, 20);
  assert.equal(events.length, 2);
  assert.equal(events[0].eventType, 'order.upsert');
  assert.equal(events[1].eventType, 'order.upsert');

  const orders = await orderDomain.listOrders();
  assert.equal(orders.length, 1);
  assert.equal(orders[0].id, 'ORD-001');
  assert.equal(orders[0].status, 'SHIPPED');
  assert.equal(orders[0].tip, 'shipped');
  assert.deepEqual(orders[0].transitionIds, ['open:ORD-001', 'ship:ORD-001']);

  const byId = orderDomain.getOrderByIdSync('ORD-001');
  assert.equal(byId.status, 'SHIPPED');
  assert.equal(byId.funds.sellerLockedSats, 150);
});
