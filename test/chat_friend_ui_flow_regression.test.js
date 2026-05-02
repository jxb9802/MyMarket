const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

test('chat friend UI uses right-click add and menu friend confirmation', () => {
  const html = read('index.html');
  const app = read('app.js');

  assert.match(html, /id="btnChatFriendAction"[^>]*>好友确认</);
  assert.match(html, /id="chatUserContextMenu"/);
  assert.match(html, /id="btnChatContextAddFriend"[^>]*>添加好友</);
  assert.match(html, /id="chatFriendConfirmModal"/);
  assert.match(app, /addEventListener\("contextmenu"/);
  assert.match(app, /openChatUserContextMenu\(row\.dataset\.chatUserContext/);
  assert.match(app, /openChatFriendConfirmModal\(\)/);
});

test('chat friend reject persists rejected status only for requester side', () => {
  const domain = read('chat_domain.js');
  const routes = read('chat_routes.js');
  const bridge = read('chat_anchor_bridge_service.js');

  assert.match(domain, /payload\.action \|\| 'reject'/);
  assert.match(domain, /action === 'delete' \? 'none' : 'rejected'/);
  assert.match(routes, /action: 'reject'/);
  assert.match(routes, /action: 'delete'/);
  assert.match(bridge, /action: String\(payload\.action \|\| 'reject'\)/);
});

