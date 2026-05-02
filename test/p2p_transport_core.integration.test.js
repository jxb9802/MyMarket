const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');

const { P2PTransportCore } = require('../p2p_transport_core');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      server.close(() => resolve(addr.port));
    });
    server.on('error', reject);
  });
}

test('p2p transport supports direct send, offline rejection, holepunch and relay', async (t) => {
  const relayPort = await getFreePort();
  const alicePort = await getFreePort();
  const bobPort = await getFreePort();
  const carolPort = await getFreePort();

  const relay = new P2PTransportCore({
    walletId: 'relay-wallet',
    host: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    port: relayPort,
    udpPort: relayPort,
    enableRelay: true,
  });
  const alice = new P2PTransportCore({
    walletId: 'alice',
    host: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    port: alicePort,
    udpPort: alicePort,
  });
  const bob = new P2PTransportCore({
    walletId: 'bob',
    host: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    port: bobPort,
    udpPort: bobPort,
  });
  const carol = new P2PTransportCore({
    walletId: 'carol',
    host: '127.0.0.1',
    advertiseHost: '127.0.0.1',
    port: carolPort,
    udpPort: carolPort,
    relayUrl: `http://127.0.0.1:${relayPort}`,
  });

  const received = [];
  bob.on('message_received', (event) => received.push({ peer: 'bob', ...event }));
  carol.on('message_received', (event) => received.push({ peer: 'carol', ...event }));

  await relay.start();
  await alice.start();
  await bob.start();
  await carol.start();

  t.after(async () => {
    await carol.stop();
    await bob.stop();
    await alice.stop();
    await relay.stop();
  });

  const direct = await alice.directSendText(`http://127.0.0.1:${bobPort}`, 'hello-direct');
  assert.equal(direct.success, true);
  assert.equal(direct.path, 'direct');

  bob.setOnline(false);
  await assert.rejects(
    alice.directSendText(`http://127.0.0.1:${bobPort}`, 'should-fail'),
    /offline/,
  );
  bob.setOnline(true);

  const holepunch = await alice.holePunchSendText(`http://127.0.0.1:${bobPort}`, 'hello-udp');
  assert.equal(holepunch.success, true);
  assert.equal(holepunch.path, 'holepunch');

  await bob.connectRelay(`http://127.0.0.1:${relayPort}`);
  const relayResult = await carol.relaySendText('bob', 'hello-relay');
  assert.equal(relayResult.success, true);
  assert.equal(relayResult.path, 'relay');
  assert.equal(relayResult.delivered, true);

  await new Promise((resolve) => setTimeout(resolve, 250));

  assert.equal(received.some((row) => row.peer === 'bob' && row.path === 'direct' && row.text === 'hello-direct'), true);
  assert.equal(received.some((row) => row.peer === 'bob' && row.path === 'holepunch' && row.text === 'hello-udp'), true);
  assert.equal(received.some((row) => row.peer === 'bob' && row.path === 'relay' && row.text === 'hello-relay'), true);
});
