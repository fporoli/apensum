#!/usr/bin/env node
// Runs a seed .sql file against $DATABASE_URL via psql, then each plugin's seed.sql
// (plugins/<id>/seed.sql, APENSUM_PLUGINS_DIR overrides the folder) in the same psql session and
// transaction, so a plugin's seed can use the core seed's pg_temp helpers and rows.
// A plain `psql $DATABASE_URL -f ...` npm script only works on shells that
// expand $VARS (bash); on Windows, npm runs scripts through cmd.exe, which
// passes "$DATABASE_URL" through literally and psql silently falls back to
// its defaults (localhost:5432). Reading the env var in Node sidesteps that.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No env-file fallback here: run it through `npm run dev:seed` / `local:seed`
// (scripts/with-env.mjs), or with DATABASE_URL set (CI, VPS), so the seed can't
// silently hit a different database than intended.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set. Use npm run dev:seed or npm run local:seed, or set DATABASE_URL.');
  process.exit(1);
}

const sqlFile = process.argv[2];
if (!sqlFile) {
  console.error('Usage: node infra/postgres/run-seed.mjs <path-to-seed.sql>');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const pluginsDir = process.env.APENSUM_PLUGINS_DIR?.trim() ? resolve(process.env.APENSUM_PLUGINS_DIR.trim()) : join(root, 'plugins');
const pluginSeeds = existsSync(pluginsDir)
  ? readdirSync(pluginsDir).sort().map((id) => join(pluginsDir, id, 'seed.sql')).filter((f) => existsSync(f))
  : [];
for (const f of pluginSeeds) console.log(`seed: plugin ${f}`);

// One psql call: --single-transaction wraps every -f in one BEGIN/COMMIT.
execFileSync(
  'psql',
  ['--no-psqlrc', '--set=ON_ERROR_STOP=1', '--single-transaction', databaseUrl, '-f', sqlFile, ...pluginSeeds.flatMap((f) => ['-f', f])],
  { stdio: 'inherit' },
);
