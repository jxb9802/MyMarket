#!/usr/bin/env node

const { P2PTransportCore } = require('../p2p_transport_core');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const part = String(argv[i] || '');
    if (!part.startsWith('--')) {
      args._.push(part);
      continue;
    }
    const key = part.slice(2);
    const next = argv[i + 1];
    if (next && !String(next).startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = 'true';
    }
  }
  return args;
}

function asBool(value, fallback = false) {
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function printUsage() {
  process.stdout.write(`
Usage:
  node tools/p2p_probe_device.js serve --wallet-id alice --port 9777 --advertise-host 192.168.1.10 [--udp-port 9777] [--relay-url http://host:9780] [--enable-relay true]
  node tools/p2p_probe_device.js probe --target http://host:9777
  node tools/p2p_probe_device.js direct-send --wallet-id alice --target http://host:9777 --text hello
  node tools/p2p_probe_device.js holepunch-send --wallet-id alice --target http://host:9777 --advertise-host 192.168.1.10 --udp-port 9777 --text hello
  node tools/p2p_probe_device.js relay-send --wallet-id alice --relay http://relay-host:9780 --target-wallet bob --text hello
`);
}

async function run() {
  const args = parseArgs(process.argv);
  const command = String(args._[0] || '').trim();
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (command === 'serve') {
    const device = new P2PTransportCore({
      walletId: args['wallet-id'] || args.walletId,
      deviceId: args['device-id'] || args.deviceId,
      host: args.host || '0.0.0.0',
      port: asNumber(args.port, 9777),
      udpPort: asNumber(args['udp-port'] || args.udpPort, asNumber(args.port, 9777)),
      advertiseHost: args['advertise-host'] || args.advertiseHost || '127.0.0.1',
      online: !args.online || asBool(args.online, true),
      enableRelay: !args['enable-relay'] || asBool(args['enable-relay'], true),
      relayUrl: args['relay-url'] || args.relayUrl || '',
      blacklist: String(args.blacklist || '').split(',').filter(Boolean),
      logger: (event, payload) => {
        process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...payload })}\n`);
      },
    });
    device.on('message_received', (event) => {
      process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event: 'message_received', ...event })}\n`);
    });
    device.on('message_acked', (event) => {
      process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event: 'message_acked', ...event })}\n`);
    });
    await device.start();
    process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event: 'serve.ready', info: device.getInfo() })}\n`);
    const stop = async () => {
      await device.stop();
      process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }

  if (command === 'probe') {
    const device = new P2PTransportCore({
      walletId: args['wallet-id'] || 'probe-client',
      advertiseHost: args['advertise-host'] || '127.0.0.1',
      port: asNumber(args.port, 0) || 9779,
      udpPort: asNumber(args['udp-port'] || args.udpPort, asNumber(args.port, 0) || 9779),
    });
    const info = await device.fetchPeerInfo(args.target);
    process.stdout.write(`${JSON.stringify({ success: true, info }, null, 2)}\n`);
    return;
  }

  if (command === 'direct-send') {
    const device = new P2PTransportCore({
      walletId: args['wallet-id'] || 'probe-client',
      advertiseHost: args['advertise-host'] || '127.0.0.1',
      port: asNumber(args.port, 9781),
      udpPort: asNumber(args['udp-port'] || args.udpPort, 9781),
      logger: (event, payload) => {
        process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...payload })}\n`);
      },
    });
    await device.start();
    const result = await device.directSendText(args.target, args.text || 'hello');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    await device.stop();
    return;
  }

  if (command === 'holepunch-send') {
    const device = new P2PTransportCore({
      walletId: args['wallet-id'] || 'probe-client',
      advertiseHost: args['advertise-host'] || '127.0.0.1',
      host: args.host || '0.0.0.0',
      port: asNumber(args.port, 9782),
      udpPort: asNumber(args['udp-port'] || args.udpPort, 9782),
      logger: (event, payload) => {
        process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...payload })}\n`);
      },
    });
    await device.start();
    const result = await device.holePunchSendText(args.target, args.text || 'hello');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    await device.stop();
    return;
  }

  if (command === 'relay-send') {
    const relayUrl = args.relay;
    const targetWalletId = args['target-wallet'] || args.targetWallet;
    if (!relayUrl || !targetWalletId) {
      throw new Error('relay and target-wallet are required');
    }
    const device = new P2PTransportCore({
      walletId: args['wallet-id'] || 'probe-client',
      advertiseHost: args['advertise-host'] || '127.0.0.1',
      port: asNumber(args.port, 9783),
      udpPort: asNumber(args['udp-port'] || args.udpPort, 9783),
      logger: (event, payload) => {
        process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...payload })}\n`);
      },
    });
    await device.start();
    await device.connectRelay(relayUrl);
    const result = await device.relaySendText(targetWalletId, args.text || 'hello');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    await device.stop();
    return;
  }

  printUsage();
  process.exitCode = 1;
}

run().catch((err) => {
  process.stderr.write(`${String(err?.stack || err)}\n`);
  process.exitCode = 1;
});
