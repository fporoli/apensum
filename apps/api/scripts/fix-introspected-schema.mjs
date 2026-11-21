#!/usr/bin/env node
// Patches schema.ts right after drizzle-kit introspect, so `npm run db:introspect`
// stays a single, rerunnable command instead of "regenerate, then hand-fix":
//  - drizzle-kit doesn't know Postgres's `citext` type (users.email,
//    organizations.slug, organization_domains.domain, organization_invitations.email)
//    and emits an uncompilable `unknown("col")` placeholder for each column.
//  - drizzle-kit 0.31 truncates expression index elements at the `'::` of a cast, so
//    `COALESCE(organization_id, '0000…'::uuid)` (uq_static_data_org_entity_enum,
//    uq_field_config) comes out as `COALESCE(organization_id, '0000…`, or cut a little later
//    (`COALESCE(location_id, '0000…'::u`, uq_org_holidays).
//  - drizzle-kit pairs the operator classes of a multi-column index with its columns in the
//    order the catalog returns them, which varies between databases (a fresh CI database writes
//    `check_in ... .op("uuid_ops")` for a timestamp column). They are all default classes and
//    Liquibase owns the indexes, so they are dropped: `.op("uuid_ops")` and the like.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Patches src/db/schema.ts, or the file given as the first argument (check-schema.mjs patches
// a fresh introspection in a scratch folder before comparing it).
const schemaPath = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'db', 'schema.ts');
const before = readFileSync(schemaPath, 'utf8');
let src = before;

src = src.replace(/\t\/\/ TODO: failed to parse database type 'citext'\n/g, '');
src = src.replace(/\bunknown\((["'])(\w+)\1\)/g, 'citext($1$2$1)');
const patchedCitext = src !== before;

const afterCitext = src;
// Cut anywhere after the zero uuid's quote (`'::u` too, uq_org_holidays), for any column.
src = src.replace(
  /sql`COALESCE\((\w+), '00000000-0000-0000-0000-000000000000(?:'[:uid]*)?`/g,
  (_m, column) => `sql\`COALESCE(${column}, '00000000-0000-0000-0000-000000000000'::uuid)\``,
);
const patchedCoalesce = src !== afterCitext;

const afterCoalesce = src;
src = src.replace(/\.op\("\w+_ops"\)/g, '');
const patchedOps = src !== afterCoalesce;

if (!patchedCitext && !patchedCoalesce && !patchedOps) {
  console.log('fix-introspected-schema: nothing to patch.');
  process.exit(0);
}

if (patchedCitext) {
  // Add `customType` to the existing drizzle-orm/pg-core import instead of a new line.
  src = src.replace(/import \{([^}]*)\} from "drizzle-orm\/pg-core"/, (full, names) =>
    names.includes('customType') ? full : `import {${names.trimEnd()}, customType } from "drizzle-orm/pg-core"`,
  );

  // Define the citext customType once, right after the drizzle-orm imports.
  const citextDef =
    "\nconst citext = customType<{ data: string }>({\n  dataType() {\n    return 'citext';\n  },\n});\n";
  src = src.replace(/(import \{ sql \} from "drizzle-orm"\n)/, `$1${citextDef}`);
}

writeFileSync(schemaPath, src);
if (patchedCitext) console.log('fix-introspected-schema: patched citext columns (users.email, organizations.slug, and others).');
if (patchedCoalesce) console.log('fix-introspected-schema: repaired truncated COALESCE(..., zero uuid) index expressions.');
if (patchedOps) console.log('fix-introspected-schema: dropped index operator classes (drizzle-kit pairs them with the wrong columns).');
