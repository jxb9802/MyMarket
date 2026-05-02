#!/usr/bin/env node
'use strict';

const http = require('http');

const port = Math.max(1, Number(process.env.SAMPLE_APP_PORT || 18889) || 18889);
let counter = 0;

setInterval(() => {
  counter += 1;
  process.stdout.write(`[sample-app] tick=${counter} ts=${new Date().toISOString()}\n`);
}, 1000).unref();

http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    ok: true,
    port,
    counter,
    now: new Date().toISOString(),
  }));
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`[sample-app] listening on 127.0.0.1:${port}\n`);
});
