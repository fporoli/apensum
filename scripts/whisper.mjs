#!/usr/bin/env node
// The one shared Whisper sidecar on this machine (compose/docker-compose.whisper.yml), used by
// dev and local alike. Local development only; the VPS has its own (infra/whisper, vps workflow).
//
//   node scripts/whisper.mjs network   create the internal network `apensum-whisper` if missing
//   node scripts/whisper.mjs up        network, then build and start the sidecar
//   node scripts/whisper.mjs down      stop and remove the sidecar (the network stays: local's API uses it)
import { spawnSync } from 'node:child_process';

export const NETWORK = 'apensum-whisper';
const COMPOSE = ['compose', '-f', 'compose/docker-compose.whisper.yml'];

function docker(args, { quiet = false } = {}) {
  const r = spawnSync('docker', args, { stdio: quiet ? 'ignore' : 'inherit' });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

function ensureNetwork() {
  if (docker(['network', 'inspect', NETWORK], { quiet: true }) === 0) return;
  // Internal: containers on it reach each other but not the outside world.
  if (docker(['network', 'create', '--internal', NETWORK]) !== 0) process.exit(1);
}

const action = process.argv[2];
if (action === 'network') ensureNetwork();
else if (action === 'up') {
  ensureNetwork();
  process.exit(docker([...COMPOSE, 'up', '-d', '--build']));
} else if (action === 'down') process.exit(docker([...COMPOSE, 'down']));
else {
  console.error('usage: node scripts/whisper.mjs <network|up|down>');
  process.exit(2);
}
