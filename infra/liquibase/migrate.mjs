#!/usr/bin/env node
// Runs Liquibase against $DATABASE_URL with infra/liquibase/changelog and then each plugin's
// changelog (plugins/<id>/changelog, mounted from the repository), via the dockerized Liquibase
// image (built from ./Dockerfile; its entrypoint apensum-migrate.sh runs them in turn).
// docker-compose environments run the `migrate` service directly instead (compose/docker-compose.*.yml).
//
//   node migrate.mjs          `update`: apply the pending changesets (npm run db:migrate, CI)
//   node migrate.mjs status   read-only (npm run db:status): compares the database's
//                             DATABASECHANGELOG with the changelogs in this checkout (the core's
//                             and every plugin's) and exits 1
//                             when changesets are pending, the database ran changesets this
//                             checkout doesn't have (it is ahead, or on another branch), or an
//                             applied changeset was edited afterwards (checksum mismatch).
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pluginsDir = process.env.APENSUM_PLUGINS_DIR?.trim() ? resolve(process.env.APENSUM_PLUGINS_DIR.trim()) : join(here, '../../plugins');
/** Plugins with a changelog (plugins/<id>/changelog/db.changelog-master.xml). */
const pluginChangelogs = existsSync(pluginsDir)
  ? readdirSync(pluginsDir).filter((id) => existsSync(join(pluginsDir, id, 'changelog/db.changelog-master.xml'))).sort()
  : [];
const command = process.argv[2] ?? 'update';
if (!['update', 'status'].includes(command)) {
  console.error(`Unknown command "${command}" (update or status).`);
  process.exit(2);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('Set DATABASE_URL, e.g. postgresql://worktime:pw@localhost:5431/worktime');
  process.exit(2);
}

const u = new URL(databaseUrl.replace(/^postgres(ql)?:/, 'http:'));
// The migration runs inside a container; "localhost" there is the container
// itself, not the host running docker. host-gateway (below) resolves this.
const host = u.hostname === 'localhost' || u.hostname === '127.0.0.1' ? 'host.docker.internal' : u.hostname;
const port = u.port || '5432';
const dbName = u.pathname.replace(/^\//, '');
const user = decodeURIComponent(u.username);
const pass = decodeURIComponent(u.password);

const image = execFileSync('docker', ['build', '-q', '-f', 'Dockerfile', '.'], { cwd: here }).toString().trim();

/** `changelog`: unset = the core's, then every plugin's; 'core' or a plugin id = that one only. */
const liquibaseArgs = (cmd, changelog) => [
  'run', '--rm',
  '--add-host=host.docker.internal:host-gateway',
  '-v', `${here}/changelog:/liquibase/changelog:ro`,
  ...(existsSync(pluginsDir) ? ['-v', `${pluginsDir}:/liquibase/plugins:ro`] : []),
  ...(changelog ? ['-e', `APENSUM_CHANGELOG=${changelog}`] : []),
  image,
  '--changelog-file=db.changelog-master.xml',
  `--url=jdbc:postgresql://${host}:${port}/${dbName}`,
  `--username=${user}`,
  `--password=${pass}`,
  ...cmd,
];

if (command === 'update') {
  execFileSync('docker', liquibaseArgs(['update']), { stdio: 'inherit' });
  process.exit(0);
}

/** Runs one read-only Liquibase command on one changelog; returns its output without the banner. */
function liquibase(changelog, ...cmd) {
  const r = spawnSync('docker', liquibaseArgs(cmd, changelog), { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    .split('\n')
    .filter((l) => l.trim() && !/^(#|Starting Liquibase|Liquibase Version|Liquibase command .* was executed successfully)/.test(l))
    .join('\n');
  return { ok: r.status === 0, out };
}

const target = `${dbName} on ${u.hostname}:${port}`;
const problems = [];
const changelogs = ['core', ...pluginChangelogs];
const label = (c) => (c === 'core' ? 'core' : `plugin ${c}`);

// status and unexpected-changesets validate checksums first and fail the same way, so a
// checksum problem is reported once, from validate.
for (const changelog of changelogs) {
  const checksums = liquibase(changelog, 'validate');
  if (!checksums.ok) {
    const detail = checksums.out.split('\n').filter((l) => !/^(ERROR: Exception|Unexpected error|For more information|Plugin changelog:)/.test(l));
    // Liquibase prints the failure twice (exception reason and error message).
    const detailText = [...new Set(detail)].join('\n');
    console.error(`db:status: ${target} does not match this checkout.\n\nValidation of the ${label(changelog)} changelog failed (an applied changeset was edited afterwards, or the database is broken):\n${detailText}`);
    process.exit(1);
  }
}

for (const changelog of changelogs) {
  const pending = liquibase(changelog, 'status', '--verbose');
  if (!pending.ok) problems.push(`status of the ${label(changelog)} changelog failed:\n${pending.out}`);
  else if (!/is up to date/.test(pending.out)) {
    problems.push(`Pending in the ${label(changelog)} changelog (in this checkout, not yet applied; npm run db:migrate applies them):\n${pending.out}`);
  }
}

// Each changelog reports every changeset of the others as unexpected; a changeset is really
// unexpected when none of them has it (the database is ahead, from another branch, or from a
// plugin that is not installed here).
let unexpected = null;
for (const changelog of changelogs) {
  const r = liquibase(changelog, 'unexpected-changesets', '--verbose');
  if (!r.ok) {
    problems.push(`unexpected-changesets of the ${label(changelog)} changelog failed:\n${r.out}`);
    unexpected = null;
    break;
  }
  const ids = new Set(r.out.split('\n').map((l) => l.trim()).filter((l) => l.includes('::')));
  unexpected = unexpected === null ? ids : new Set([...unexpected].filter((id) => ids.has(id)));
}
if (unexpected && unexpected.size > 0) {
  problems.push(`Applied to the database but in no changelog of this checkout (the database is ahead, migrated from another branch, or a plugin is missing):\n${[...unexpected].map((id) => `     ${id}`).join('\n')}`);
}

if (problems.length === 0) {
  console.log(`db:status: ${target} has exactly the changesets of this checkout (${changelogs.map(label).join(', ')}), with matching checksums.`);
  process.exit(0);
}
console.error(`db:status: ${target} does not match this checkout.\n\n${problems.join('\n\n')}`);
process.exit(1);
