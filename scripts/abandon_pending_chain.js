#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const stateFile = path.join(dataDir, 'state.json');
const spvIndexFile = path.join(dataDir, 'spv_index.json');
const cacheFile = path.join(dataDir, 'cache.json');
const notesFile = path.join(dataDir, 'tx_notes.json');

const restoreUtxos = [
  {
    txId: 'd41735167899f4cfc2b25ac33817a4fcc757000c8932685bfac30913551c69b6',
    vout: 0,
    address: '14GsPhLX89V3xak62RpcietMNL2zoDv53v',
    satoshis: 1000,
    confirmed: true,
  },
  {
    txId: 'd41735167899f4cfc2b25ac33817a4fcc757000c8932685bfac30913551c69b6',
    vout: 1,
    address: '14GsPhLX89V3xak62RpcietMNL2zoDv53v',
    satoshis: 119758,
    confirmed: true,
  },
  {
    txId: '9be2a273d399bf73faa853dff8bfe45c85325759086477983592263af51742f2',
    vout: 0,
    address: '14GsPhLX89V3xak62RpcietMNL2zoDv53v',
    satoshis: 1000,
    confirmed: true,
  },
];

const abandonTxids = new Set([
  'd820e084d8f52da1421508ec6bc823979bf0c99a3a873382be6be14a224b24cf',
  'c90d35a33d88d21d380b456ccb68a584c3a58a798c585060e1133f49609532f5',
  '8fd89568281e1ae2c2ce2c84c4f27f4138e7a8b94a785a34e78e14afa98107a5',
  'ccb445a2e36ac143e3b6f707f9ef3473ea344fa08b3ed1691d175cb52caf4fb2',
  '4af224641723336f3d8181952df55994bb9fd38c9f523950f5b2e2baf2918c1d',
  'ee1b0dc9b473339ae81628858dddb959a50d52bffdfe5b1e035a438b173e641c',
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function main() {
  const state = readJson(stateFile);
  const idx = readJson(spvIndexFile);
  const notes = fs.existsSync(notesFile) ? readJson(notesFile) : {};

  idx.utxos = {};
  idx.ownedOutpoints = {};
  idx.spentOutpoints = {};

  for (const utxo of restoreUtxos) {
    const key = `${utxo.txId}:${utxo.vout}`;
    idx.utxos[key] = {
      ...utxo,
      seenAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ancestorDepth: 0,
    };
    idx.ownedOutpoints[key] = Number(utxo.satoshis);
  }

  for (const txid of abandonTxids) {
    delete idx.txs[txid];
    delete notes[txid];
  }

  const queue = (((state.localChanges || {}).queue) || []);
  for (const item of queue) {
    if (!item || !abandonTxids.has(String(item.txid || ''))) continue;
    item.status = 'pending';
    item.attempts = 0;
    delete item.txid;
    delete item.broadcastedAt;
    delete item.lastBroadcastAt;
    delete item.feeSat;
    delete item.rawtx;
    delete item.broadcastNodes;
    delete item.broadcastSuccessCount;
    delete item.broadcastAttemptedCount;
    delete item.rebroadcastCount;
    delete item.failedAt;
    delete item.lastError;
  }

  state.anchors = (state.anchors || []).filter((row) => !abandonTxids.has(String(row?.txid || '')));

  writeJson(spvIndexFile, idx);
  if (fs.existsSync(cacheFile)) {
    const txids = Object.keys(idx.txs || {}).sort((a, b) => {
      const ta = new Date(idx.txs[b]?.lastSeenAt || 0).getTime();
      const tb = new Date(idx.txs[a]?.lastSeenAt || 0).getTime();
      return ta - tb;
    });
    const utxos = Object.values(idx.utxos || {});
    const confirmed = utxos.filter((u) => u.confirmed).reduce((sum, u) => sum + Number(u.satoshis || 0), 0);
    const unconfirmed = utxos.filter((u) => !u.confirmed).reduce((sum, u) => sum + Number(u.satoshis || 0), 0);
    writeJson(cacheFile, {
      confirmed,
      unconfirmed,
      pendingDelta: 0,
      incomeSat: confirmed + unconfirmed,
      expenseSat: 0,
      total: confirmed + unconfirmed,
      txids,
      updatedAt: new Date().toISOString(),
    });
  }
  writeJson(notesFile, notes);
  writeJson(stateFile, state);

  console.log(JSON.stringify({
    success: true,
    restoredUtxos: restoreUtxos.length,
    resetQueueItems: queue.filter((item) => !item.txid && item.status === 'pending').length,
    removedAnchors: true,
  }));
}

main();
