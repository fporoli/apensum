#!/usr/bin/env node
// Deploys the website (apps/site) by dispatching the `site` GitHub workflow and waiting for it:
//
//   npm run site:deploy -- [site|sitepp|all] [--remove]
//
//   site    apensum.ch on the prod server, linked to app/api.apensum.ch
//   sitepp  wwwpp.apensum.ch (noindex preview) on the preprod server, linked to apppp/apipp
//   all     both (the default)
//   --remove  take the site down instead of deploying it
//
// The workflow builds what is pushed to GitHub (the default branch), not the working tree: commit
// and push first. Deploy logic and config stay in .github/workflows/site.yml; this only fills in its
// inputs and follows the runs with the gh CLI.

import { spawnSync } from 'node:child_process';

const TARGETS = {
  site: {
    environment: 'prod',
    domain: 'apensum.ch',
    app_url: 'https://app.apensum.ch',
    contact_url: 'https://api.apensum.ch/api/v1/public/contact',
  },
  sitepp: {
    environment: 'preprod',
    domain: 'wwwpp.apensum.ch',
    app_url: 'https://apppp.apensum.ch',
    contact_url: 'https://apipp.apensum.ch/api/v1/public/contact',
  },
};

const args = process.argv.slice(2);
const action = args.includes('--remove') ? 'remove' : 'deploy';
const which = args.find((a) => !a.startsWith('--')) ?? 'all';
const names = which === 'all' ? Object.keys(TARGETS) : [which];
if (!names.every((n) => n in TARGETS)) {
  console.error(`Unknown target "${which}". Use: site, sitepp or all.`);
  process.exit(1);
}

function gh(argv, capture = false) {
  const r = spawnSync('gh', argv, { encoding: 'utf8', stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit', shell: process.platform === 'win32' });
  if (r.error) {
    console.error('The gh CLI is needed (https://cli.github.com), logged in with `gh auth login`.');
    process.exit(1);
  }
  return r;
}

const ahead = spawnSync('git', ['rev-list', '--count', '@{u}..HEAD'], { encoding: 'utf8' });
if (ahead.status === 0 && Number(ahead.stdout.trim()) > 0) {
  console.warn(`Note: ${ahead.stdout.trim()} local commit(s) are not pushed; the workflow deploys what is on GitHub.`);
}

const runs = [];
for (const name of names) {
  const t = TARGETS[name];
  const inputs = action === 'remove' ? { environment: t.environment, domain: t.domain } : t;
  const fields = Object.entries({ action, ...inputs }).flatMap(([k, v]) => ['-f', `${k}=${v}`]);
  console.log(`site: ${action} ${t.domain} on ${t.environment}`);
  const r = gh(['workflow', 'run', 'site.yml', ...fields], true);
  if (r.status !== 0) process.exit(r.status ?? 1);
  const url = /https:\/\/\S+\/actions\/runs\/(\d+)/.exec(r.stdout ?? '');
  if (url) {
    console.log(`  ${url[0]}`);
    runs.push({ name, id: url[1] });
  } else {
    console.log('  Started; follow it with `gh run list --workflow site.yml`.');
  }
}

let failed = false;
for (const { name, id } of runs) {
  const r = gh(['run', 'watch', id, '--exit-status', '--compact'], false);
  console.log(`${name}: ${r.status === 0 ? 'done' : 'FAILED'}`);
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
