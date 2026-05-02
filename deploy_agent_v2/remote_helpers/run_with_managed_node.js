#!/usr/bin/env node
'use strict';

const path = require('path');
const { spawn } = require('child_process');

function managedNodeRoot() {
  return path.resolve('.deploy/node');
}

function prependNodePath(env) {
  const root = managedNodeRoot();
  const nodeBinDir = process.platform === 'win32'
    ? root
    : path.join(root, 'bin');
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return {
    ...env,
    PATH: `${nodeBinDir}${delimiter}${String(env.PATH || '')}`,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length <= 0) {
    throw new Error('command is required');
  }
  const child = spawn(args[0], args.slice(1), {
    cwd: process.cwd(),
    env: prependNodePath(process.env),
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(Number(code || 0));
  });
  child.on('error', (error) => {
    process.stderr.write(`${String(error && error.message ? error.message : error)}\n`);
    process.exit(1);
  });
}

main();
