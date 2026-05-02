const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing function ${name}`);
  const paramsStart = source.indexOf('(', start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let i = paramsStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') parenDepth += 1;
    if (ch === ')') parenDepth -= 1;
    if (parenDepth === 0) {
      bodyStart = source.indexOf('{', i);
      break;
    }
  }
  assert.notEqual(bodyStart, -1, `missing function body ${name}`);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function loadChatPairHooks() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const module = { exports: {} };
  const state = {
    chat: {
      pairs: {},
      threads: [],
      people: [],
      friends: [],
      recent: [],
      unreadTotal: 0,
      buttonHasUnread: false,
      nextPairListOrder: 1,
    },
  };
  const code = [
    extractFunction(source, 'defaultChatPair'),
    extractFunction(source, 'isGeneratedChatName'),
    extractFunction(source, 'resolveChatPairDisplayName'),
    extractFunction(source, 'upsertChatPair'),
    extractFunction(source, 'rebuildChatPairCollections'),
    'module.exports = { state, upsertChatPair, rebuildChatPairCollections };',
  ].join('\n\n');
  vm.runInNewContext(code, { module, state, Math, Number, Object, String });
  return module.exports;
}

test('chat pair real display name is not overwritten by generated wallet id', () => {
  const { state, upsertChatPair } = loadChatPairHooks();
  const walletId = 'wallet-m53cada73f2';

  upsertChatPair(walletId, { displayName: 'Windows测试节点3', inList: true });
  upsertChatPair(walletId, { displayName: walletId, directConnected: true });
  upsertChatPair(walletId, { displayName: 'm-53cada73f2', presenceStatus: 'chatable' });

  assert.equal(state.chat.pairs[walletId].displayName, 'Windows测试节点3');
});

test('chat status patch without displayName keeps existing contact name', () => {
  const { state, upsertChatPair } = loadChatPairHooks();
  const walletId = 'wallet-mdb5d332549';

  upsertChatPair(walletId, { displayName: 'Windows far', inList: true });
  upsertChatPair(walletId, { directConnected: true, statusLabel: '已连接', __forceConnectionStatus: true });

  assert.equal(state.chat.pairs[walletId].displayName, 'Windows far');
  assert.equal(state.chat.pairs[walletId].directConnected, true);
});

test('chat pairs with same display name remain separate wallet rows', () => {
  const { state, upsertChatPair, rebuildChatPairCollections } = loadChatPairHooks();

  upsertChatPair('wallet-a', { displayName: 'Windows far', inList: true });
  upsertChatPair('wallet-b', { displayName: 'Windows far', inList: true });
  rebuildChatPairCollections();

  assert.deepEqual(state.chat.people.map((row) => row.walletId), ['wallet-a', 'wallet-b']);
  assert.equal(state.chat.people.length, 2);
});
