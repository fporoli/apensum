#!/usr/bin/env node
// `npm run db:introspect`: regenerates src/db/schema.ts + relations.ts from the database at
// $DATABASE_URL (drizzle.config.ts; the plugins' tables left out), then each plugin's
// api/db/schema.ts with only its tables (plugin-schemas.mjs). Liquibase owns the schema; these
// files only mirror it. Never edit them by hand.
import { execFileSync } from 'node:child_process';
import { copyFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { apiDir, introspectPlugin, pluginsWithTables } from './plugin-schemas.mjs';

const shell = process.platform === 'win32';
const scratch = join(apiDir, '.drizzle-introspect');

rmSync(scratch, { recursive: true, force: true });
execFileSync('npx', ['drizzle-kit', 'introspect'], { cwd: apiDir, stdio: 'inherit', shell });
for (const f of ['schema.ts', 'relations.ts']) copyFileSync(join(scratch, f), join(apiDir, 'src', 'db', f));
rmSync(scratch, { recursive: true, force: true });
execFileSync('node', [join(apiDir, 'scripts', 'fix-introspected-schema.mjs')], { stdio: 'inherit' });

for (const plugin of pluginsWithTables()) {
  const src = introspectPlugin(plugin);
  mkdirSync(dirname(plugin.schema), { recursive: true });
  writeFileSync(plugin.schema, src);
  console.log(`introspect: plugin ${plugin.id} -> ${relative(join(apiDir, '../..'), plugin.schema)} (${plugin.dbSchema ? `schema ${plugin.dbSchema}` : `${plugin.tables.length} tables`})`);
}
