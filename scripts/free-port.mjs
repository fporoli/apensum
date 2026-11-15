#!/usr/bin/env node
// Stops a leftover Node process listening on a port, e.g. an API from an earlier debug session that
// outlived it (the "Development API: Debug" launch runs this first). Only Node processes are
// stopped; anything else on the port is reported and the script fails, so it never kills, say, Docker.
// Usage: node scripts/free-port.mjs <port>
import { execFileSync } from 'node:child_process';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port <= 0) {
  console.error('usage: node scripts/free-port.mjs <port>');
  process.exit(2);
}

const run = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return ''; // lsof exits 1 when nothing listens
  }
};

function listeners() {
  if (process.platform === 'win32') {
    const pids = new Set();
    for (const line of run('netstat', ['-ano', '-p', 'tcp']).split(/\r?\n/)) {
      const cols = line.trim().split(/\s+/);
      if (cols[3] === 'LISTENING' && cols[1]?.endsWith(`:${port}`)) pids.add(Number(cols[4]));
    }
    return [...pids].map((pid) => {
      const csv = run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH']);
      return { pid, name: (csv.split(',')[0] ?? '').replace(/"/g, '') };
    });
  }
  return run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
    .split(/\s+/)
    .filter(Boolean)
    .map((pid) => ({ pid: Number(pid), name: run('ps', ['-o', 'comm=', '-p', pid]).trim() }));
}

const found = listeners();
if (found.length === 0) process.exit(0);

let failed = false;
for (const { pid, name } of found) {
  if (!/(^|[\\/])node(\.exe)?$/i.test(name)) {
    console.error(`port ${port} is held by ${name || 'an unknown process'} (pid ${pid}), not Node; stop it yourself`);
    failed = true;
    continue;
  }
  console.log(`port ${port}: stopping leftover Node process ${pid}`);
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/F'], { stdio: 'ignore' });
    else process.kill(pid, 'SIGTERM');
  } catch (e) {
    console.error(`could not stop ${pid}: ${e.message}`);
    failed = true;
  }
}
if (failed) process.exit(1);

// Wait until the port is actually released.
for (let i = 0; i < 50 && listeners().length > 0; i++) await new Promise((r) => setTimeout(r, 100));
if (listeners().length > 0) {
  console.error(`port ${port} is still in use`);
  process.exit(1);
}
