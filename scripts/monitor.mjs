#!/usr/bin/env node
// The outside monitor (.github/workflows/monitor.yml): checks every target of MONITOR_TARGETS (a JSON list of
// { id, url, kind: 'health' | 'page' }) and the certificates of their hosts, compares with the last run's state
// and writes the events to mail. No dependencies; Node's fetch and tls.
//
//   MONITOR_TARGETS='[...]' node scripts/monitor.mjs <state.json> <alert.txt>
//
// Writes the new state over <state.json>; writes <alert.txt> (subject on the first line) only when there is
// something to report, and sets the step output `alert=true` then.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import tls from 'node:tls';
import { alertMail, evaluate, judgeHealth, judgePage } from './monitor-lib.mjs';

const [statePath, alertPath] = process.argv.slice(2);
const targets = JSON.parse(process.env.MONITOR_TARGETS || '[]');
if (!statePath || !alertPath || !Array.isArray(targets) || !targets.length) {
  console.error('usage: MONITOR_TARGETS=[...] node scripts/monitor.mjs <state.json> <alert.txt>');
  process.exit(2);
}

async function check(t) {
  try {
    const res = await fetch(t.url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'apensum-monitor' } });
    if (t.kind === 'health') {
      const body = await res.json().catch(() => null);
      return { id: t.id, ...judgeHealth(res.status, body) };
    }
    return { id: t.id, ...judgePage(res.status) };
  } catch (err) {
    return { id: t.id, ok: false, detail: `unreachable (${err?.cause?.code ?? err?.name ?? 'error'})` };
  }
}

function certDaysLeft(host) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? Math.floor((Date.parse(cert.valid_to) - Date.now()) / 86_400_000) : null);
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => { socket.destroy(); resolve(null); });
  });
}

const now = new Date();
const results = await Promise.all(targets.map(check));
const hosts = [...new Set(targets.map((t) => new URL(t.url).hostname))];
const certs = await Promise.all(hosts.map(async (host) => ({ host, daysLeft: await certDaysLeft(host) })));
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.id}  ${r.detail}`);
for (const c of certs) console.log(`cert  ${c.host}  ${c.daysLeft ?? '?'} days`);

const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const { state, events } = evaluate(previous, results, certs, now);
writeFileSync(statePath, JSON.stringify(state));
if (events.length) {
  const mail = alertMail(events, now);
  writeFileSync(alertPath, `${mail.subject}\n${mail.text}`);
  console.log(`alert: ${mail.subject}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'alert=true\n');
}
