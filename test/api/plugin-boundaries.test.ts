import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// A module reads another module's data only through the core (its interfaces: billables, documents, reports, slots),
// never by SQL on the other's tables or schema; and no module imports another's code. Each plugin's manifest names what
// it owns (package.json apensum.tables, apensum.dbSchema). Migrations (changelog/) may move data between them once.
const PLUGINS = join(__dirname, '../../plugins');

interface Owned { id: string; dir: string; tables: string[]; schema: string | null }

function plugins(): Owned[] {
  if (!existsSync(PLUGINS)) return [];
  return readdirSync(PLUGINS).filter((d) => existsSync(join(PLUGINS, d, 'package.json'))).map((d) => {
    const m = JSON.parse(readFileSync(join(PLUGINS, d, 'package.json'), 'utf8')).apensum ?? {};
    return { id: m.id ?? d, dir: join(PLUGINS, d), tables: m.tables ?? [], schema: m.dbSchema ?? null };
  });
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const part of ['api', 'web', 'shared']) {
    const walk = (d: string) => {
      if (!existsSync(d)) return;
      for (const f of readdirSync(d)) {
        const path = join(d, f);
        if (statSync(path).isDirectory()) { if (f !== 'db' && f !== 'node_modules' && f !== 'dist') walk(path); }
        else if (/\.(ts|tsx)$/.test(f)) out.push(path);
      }
    };
    walk(join(dir, part));
  }
  return out;
}

test('no module reads another module\'s tables or imports its code', () => {
  const all = plugins();
  const problems: string[] = [];
  for (const p of all) {
    const others = all.filter((o) => o.id !== p.id);
    for (const file of sources(p.dir)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:public\.)?([a-z_][a-z0-9_]*)(?:\.([a-z_][a-z0-9_]*))?/g)) {
        const owner = others.find((o) => (m[2] && o.schema === m[1]) || (!m[2] && o.tables.includes(m[1])));
        if (owner) problems.push(`${file.slice(PLUGINS.length + 1)}: ${m[0]} (owned by ${owner.id})`);
      }
      for (const m of text.matchAll(/from\s+['"](\.\.\/)+(?:plugins\/)?([a-z]+)\//g)) {
        const owner = others.find((o) => o.dir.endsWith(`/${m[2]}`));
        if (owner) problems.push(`${file.slice(PLUGINS.length + 1)}: imports ${owner.id}'s code`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

/**
 * A plugin reads and writes the core's tables only through the core's services (PeopleService, ProjectsService,
 * EmploymentService, DocumentsService, ...), never by SQL or the generated schema: every plugin has moved, so any
 * direct use fails. A service a plugin needs is added to the core (docs/PLUGINS.md).
 */
test('a plugin reaches the core\'s data only through its services', () => {
  const schema = readFileSync(join(__dirname, '../../apps/api/src/db/schema.ts'), 'utf8');
  const core = new Set([...schema.matchAll(/pgTable\("(\w+)"/g)].map((m) => m[1]));
  const problems: string[] = [];
  for (const p of plugins()) {
    const used = new Set<string>();
    for (const file of sources(p.dir)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:public\.)?([a-z_][a-z0-9_]*)\b(?!\.)/g)) {
        if (core.has(m[1]) && !p.tables.includes(m[1])) used.add(m[1]);
      }
      if (text.includes('@worktime3/api/schema')) used.add('@worktime3/api/schema');
    }
    for (const t of used) problems.push(`${p.id} reads the core's ${t} directly: use a core service`);
  }
  assert.deepEqual(problems, []);
});
