function getTradeBaseUrl() {
  if (typeof window !== 'undefined' && window.TRADE_SERVICE_BASE_URL) {
    return String(window.TRADE_SERVICE_BASE_URL).replace(/\/+$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return String(window.location.origin).replace(/\/+$/, '');
  }
  return '';
}

async function request(path, options = {}) {
  const response = await fetch(`${getTradeBaseUrl()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (_) {
    data = { success: false, error: text || response.statusText };
  }
  if (!response.ok || data?.success === false) {
    const err = new Error(String(data?.error || response.statusText || 'trade request failed'));
    err.payload = data;
    err.status = response.status;
    throw err;
  }
  return data;
}

const tradeClient = {
  health() {
    return request('/health', { method: 'GET', headers: {} });
  },
  bootstrapLite(domains = 'catalog,order') {
    return request(`/api/bootstrap-lite?domains=${encodeURIComponent(domains)}`, {
      method: 'GET',
      headers: {},
    });
  },
  getCatalogSummary() {
    return request('/api/catalog/summary', { method: 'GET', headers: {} });
  },
  listOrders() {
    return request('/api/orders', { method: 'GET', headers: {} });
  },
  getOrder(orderId) {
    return request(`/api/orders/${encodeURIComponent(orderId)}`, { method: 'GET', headers: {} });
  },
  getOrderTimeline(orderId) {
    return request(`/api/orders/${encodeURIComponent(orderId)}/timeline`, { method: 'GET', headers: {} });
  },
};

if (typeof window !== 'undefined') {
  window.tradeClient = tradeClient;
}

module.exports = {
  tradeClient,
  getTradeBaseUrl,
};
