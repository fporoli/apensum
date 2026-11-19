import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Tables a plugin owns (its package.json `apensum.tables`) and Postgres schemas it owns
// (`apensum.dbSchema`) are left out: they are introspected into the plugin's own api/db/schema.ts
// (scripts/plugin-schemas.mjs).
const pluginsDir = process.env.APENSUM_PLUGINS_DIR?.trim() ? resolve(process.env.APENSUM_PLUGINS_DIR.trim()) : join(__dirname, '../../plugins');
const manifests: { tables?: string[]; dbSchema?: string }[] = existsSync(pluginsDir)
  ? readdirSync(pluginsDir).flatMap((id) => {
      const pkg = join(pluginsDir, id, 'package.json');
      return existsSync(pkg) ? [JSON.parse(readFileSync(pkg, 'utf8')).apensum ?? {}] : [];
    })
  : [];
const pluginTables = manifests.flatMap((m) => m.tables ?? []);
const pluginSchemas = manifests.flatMap((m) => (m.dbSchema ? [m.dbSchema] : []));

// Drizzle never owns migrations here — Liquibase does (see infra/liquibase).
// This config exists only for `drizzle-kit introspect`: after applying a
// Liquibase changelog, regenerate src/db/schema.ts from the live database so
// the app's types stay in sync with it. Never hand-edit schema.ts.
export default defineConfig({
  dialect: 'postgresql',
  // Scratch dir: drizzle-kit also writes its own migration-snapshot
  // bookkeeping here (meta/, a numbered .sql file) which we don't want —
  // Liquibase owns migrations. `npm run db:introspect` copies out only
  // schema.ts/relations.ts and discards the rest.
  out: './.drizzle-introspect',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://worktime:worktime_dev_only@localhost:5431/worktime',
  },
  introspect: {
    casing: 'preserve',
  },
  schemaFilter: ['public', 'cases'].filter((s) => !pluginSchemas.includes(s)),
  ...(pluginTables.length ? { tablesFilter: pluginTables.map((t) => `!${t}`) } : {}),
});
