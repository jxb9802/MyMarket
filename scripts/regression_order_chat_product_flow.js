#!/usr/bin/env node
'use strict';

const puppeteer = require('puppeteer');

const DEFAULTS = {
  linuxBase: process.env.LINUX_BASE || 'http://127.0.0.1:8091',
  windowsBase: process.env.WINDOWS_BASE || 'http://192.168.2.10:8091',
  password: process.env.TEST_WALLET_PASSWORD || '1',
  waitOrderMs: Math.max(30000, Number(process.env.WAIT_ORDER_MS || 900000)),
  waitMessageMs: Math.max(15000, Number(process.env.WAIT_MESSAGE_MS || 120000)),
  rendezvousEndpoint: process.env.RENDEZVOUS_ENDPOINT || 'http://8.136.3.174:8091',
  linuxReachableFromWindows: process.env.LINUX_REACHABLE_FROM_WINDOWS || 'http://192.168.2.42:8091',
  resumeOrderId: process.env.RESUME_ORDER_ID || '',
};

class Session {
  constructor(baseUrl, label) {
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.label = label;
    this.cookie = '';
  }

  async request(path, options = {}) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || 'GET',
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(',').map((part) => part.split(';')[0]).join('; ');
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { raw: text }; }
    if (!res.ok || data?.success === false) {
      throw new Error(`${this.label} ${path} failed: ${data?.error || data?.message || `HTTP ${res.status}`}`);
    }
    return data;
  }
}

function log(message, extra = null) {
  const suffix = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[${new Date().toISOString()}] ${message}${suffix}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(label, fn, timeoutMs, intervalMs = 2000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} timeout${lastError ? `: ${lastError.message}` : ''}`);
}

async function login(session, password) {
  await session.request('/api/auth/login', { method: 'POST', body: { password } });
}

async function stateLite(session) {
  const payload = await session.request('/api/state-lite');
  return payload?.state || payload || {};
}

async function identity(session) {
  const payload = await session.request('/api/chat/identity');
  return payload?.identity || {};
}

async function pageLogin(page, baseUrl, password) {
  await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('#loginModal', { timeout: 30000 });
  const needsLogin = await page.$eval('#loginModal', (el) => !el.classList.contains('hidden')).catch(() => true);
  if (needsLogin) {
    await page.waitForSelector('#loginPassword', { visible: true, timeout: 30000 });
    await page.click('#loginPassword', { clickCount: 3 });
    await page.type('#loginPassword', password);
    await page.click('#btnLoginSubmit');
  }
  await page.waitForFunction(() => {
    const modal = document.querySelector('#loginModal');
    return modal && modal.classList.contains('hidden');
  }, { timeout: 60000 });
  await page.waitForFunction(() => {
    try {
      return typeof state !== 'undefined'
        && state?.ui?.orderNotifications?.baselineReady === true
        && state?.events?.connected === true;
    } catch (_) {
      return false;
    }
  }, { timeout: 60000 });
  await page.evaluate(() => {
    document.querySelector('#btnCloseOrderDetail')?.click();
    document.querySelector('#btnCloseChat')?.click();
  }).catch(() => {});
}

function selectWindowsProduct(linuxState, windowsState) {
  const sellerMerchantId = String(windowsState.currentMerchantId || '').trim();
  const products = Array.isArray(linuxState.products) ? linuxState.products : [];
  return products.find((p) => (
    String(p?.merchantId || p?.merchant_id || '').trim() === sellerMerchantId
    && p?.deleted !== true
    && Number(p?.stock || 0) > 0
    && Number(p?.price || 0) > 0
  )) || null;
}

async function getOrder(session, orderId) {
  const state = await stateLite(session);
  return (Array.isArray(state.orders) ? state.orders : [])
    .find((row) => String(row?.id || row?.orderId || '') === orderId) || null;
}

async function sendChat(session, walletId, text, orderId, options = {}) {
  return session.request('/api/chat/send', {
    method: 'POST',
    body: {
      walletId,
      text,
      orderId,
      clientMsgId: `reg:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      forceOnchain: options.forceOnchain === true,
      directOnly: options.directOnly === true,
    },
  });
}

async function getOrderThread(session, peerWalletId, orderId) {
  return session.request(`/api/chat/thread?walletId=${encodeURIComponent(peerWalletId)}&orderId=${encodeURIComponent(orderId)}&pageSize=50&page=1`);
}

async function waitForOrderMessage(session, peerWalletId, orderId, text, timeoutMs) {
  return waitFor(`message ${text}`, async () => {
    const thread = await getOrderThread(session, peerWalletId, orderId);
    const messages = Array.isArray(thread?.messages) ? thread.messages : [];
    const bad = messages.find((row) => String(row?.orderId || '') !== orderId);
    if (bad) throw new Error(`thread contains non-order message ${bad.msgId || ''} orderId=${bad.orderId || ''}`);
    return messages.find((row) => String(row?.text || '') === text) || null;
  }, timeoutMs, 1500);
}

async function setPeerEndpoint(session, walletId, endpoint) {
  return session.request('/api/chat/peer-endpoint', {
    method: 'POST',
    body: { walletId, endpoint },
  });
}

async function main() {
  const cfg = { ...DEFAULTS };
  const linux = new Session(cfg.linuxBase, 'linux');
  const windows = new Session(cfg.windowsBase, 'windows');

  log('login api sessions');
  await login(linux, cfg.password);
  await login(windows, cfg.password);

  const linuxIdentity = await identity(linux);
  const windowsIdentity = await identity(windows);
  const linuxWalletId = String(linuxIdentity.walletId || '').trim();
  const windowsWalletId = String(windowsIdentity.walletId || '').trim();
  if (!linuxWalletId || !windowsWalletId) throw new Error('chat identities unavailable');
  log('identities', { linuxWalletId, windowsWalletId });

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  let page;
  try {
    page = await browser.newPage();
    page.on('console', (msg) => {
      const text = String(msg.text() || '');
      if (/order|chat|error|failed/i.test(text)) log(`windows page console: ${text}`);
    });
    log('open windows page and establish notification baseline');
    await pageLogin(page, cfg.windowsBase, cfg.password);

    const linuxState = await stateLite(linux);
    const windowsState = await stateLite(windows);
    const product = selectWindowsProduct(linuxState, windowsState);
    if (!product) throw new Error(`no visible product for windows merchant ${windowsState.currentMerchantId || ''}`);
    log('selected product', { productId: product.id, title: product.title, merchantId: product.merchantId });

    let place = null;
    const orderId = String(cfg.resumeOrderId || '').trim() || await (async () => {
      place = await linux.request('/api/orders/place', {
        method: 'POST',
        body: {
          productId: String(product.id || ''),
          quantity: 1,
          clientActionId: `reg-place:${Date.now()}`,
        },
      });
      const placedOrderId = String(place.orderId || '').trim();
      if (!placedOrderId) throw new Error('order place did not return orderId');
      log('linux placed order', { orderId: placedOrderId, anchorTxid: place.anchorTxid });
      return placedOrderId;
    })();
    if (cfg.resumeOrderId) log('resume existing order', { orderId });

    const windowsOrder = await waitFor('windows receives order via listener/sync', () => getOrder(windows, orderId), cfg.waitOrderMs, 5000);
    log('windows order visible', {
      orderId,
      status: windowsOrder.status,
      placeTxid: windowsOrder?.chain?.placeTxid || '',
    });

    if (cfg.resumeOrderId) {
      await page.evaluate((wantedOrderId) => {
        if (typeof openOrderDetailModal === 'function') openOrderDetailModal(wantedOrderId, 'seller');
      }, orderId).catch(() => {});
    }
    await page.waitForFunction((wantedOrderId) => {
      const modal = document.querySelector('#orderDetailModal');
      if (!modal || modal.classList.contains('hidden')) return false;
      try {
        if (typeof state !== 'undefined' && String(state?.ui?.orderDetail?.orderId || '') === wantedOrderId) return true;
      } catch (_) {}
      return document.body.innerText.includes(wantedOrderId);
    }, { timeout: 45000 }, orderId);
    const popupState = await page.evaluate(() => ({
      orderDetailVisible: !document.querySelector('#orderDetailModal')?.classList.contains('hidden'),
      orderDetailOrderId: typeof state !== 'undefined' ? String(state?.ui?.orderDetail?.orderId || '') : '',
      actions: document.querySelector('#orderDetailActions')?.innerText || '',
    }));
    log('windows order popup verified', popupState);

    await page.evaluate(() => {
      const btn = document.querySelector('#orderDetailActions [data-seller-order-action="chat"], #orderDetailActions [data-order-action="chat"]');
      if (!btn) throw new Error('order chat button not found');
      btn.click();
    });
    await page.waitForFunction((wantedOrderId) => {
      const modal = document.querySelector('#chatModal');
      if (!modal || modal.classList.contains('hidden')) return false;
      try {
        return typeof state !== 'undefined'
          && state.chat?.mode === 'order'
          && String(state.chat?.activeOrderId || '') === wantedOrderId;
      } catch (_) {
        return false;
      }
    }, { timeout: 30000 }, orderId);
    log('windows order chat popup verified', await page.evaluate(() => ({
      chatVisible: !document.querySelector('#chatModal')?.classList.contains('hidden'),
      mode: typeof state !== 'undefined' ? String(state.chat?.mode || '') : '',
      activeOrderId: typeof state !== 'undefined' ? String(state.chat?.activeOrderId || '') : '',
      title: document.querySelector('#chatTitle')?.innerText || '',
    })));

    await setPeerEndpoint(linux, windowsWalletId, cfg.windowsBase);
    await setPeerEndpoint(windows, linuxWalletId, cfg.linuxReachableFromWindows || cfg.rendezvousEndpoint);

    const w2lOnchain = `order-onchain-w2l-${Date.now()}`;
    const l2wOnchain = `order-onchain-l2w-${Date.now()}`;
    log('send windows->linux on-chain order chat', { text: w2lOnchain });
    await sendChat(windows, linuxWalletId, w2lOnchain, orderId, { forceOnchain: true });
    await waitForOrderMessage(linux, windowsWalletId, orderId, w2lOnchain, cfg.waitMessageMs);
    log('linux received windows on-chain order chat');

    log('send linux->windows on-chain order chat', { text: l2wOnchain });
    await sendChat(linux, windowsWalletId, l2wOnchain, orderId, { forceOnchain: true });
    await waitForOrderMessage(windows, linuxWalletId, orderId, l2wOnchain, cfg.waitMessageMs);
    log('windows received linux on-chain order chat');

    const linuxThread = await getOrderThread(linux, windowsWalletId, orderId);
    const windowsThread = await getOrderThread(windows, linuxWalletId, orderId);
    const linuxMessages = Array.isArray(linuxThread.messages) ? linuxThread.messages : [];
    const windowsMessages = Array.isArray(windowsThread.messages) ? windowsThread.messages : [];
    const badMessages = [...linuxMessages, ...windowsMessages].filter((row) => String(row?.orderId || '') !== orderId);
    if (badMessages.length) throw new Error(`order thread leaked ${badMessages.length} non-order messages`);
    log('order chat isolation verified', {
      linuxMessages: linuxMessages.length,
      windowsMessages: windowsMessages.length,
      orderId,
    });

    console.log(JSON.stringify({
      success: true,
      orderId,
      placeTxid: place?.anchorTxid || orderId.replace(/^order:/, ''),
      productId: product.id,
      linuxWalletId,
      windowsWalletId,
      checked: {
        windowsOrderReceived: true,
        windowsOrderPopup: true,
        windowsOrderChatPopup: true,
        onchainBothDirections: true,
        directBothDirections: false,
        orderChatIsolation: true,
      },
    }, null, 2));
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: String(error?.message || error || 'regression failed'),
    stack: String(error?.stack || ''),
  }, null, 2));
  process.exitCode = 1;
});
