import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).apensum;
const dir = join(root, 'changelog');
const master = readFileSync(join(dir, 'db.changelog-master.xml'), 'utf8');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const sql = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');

test('every changelog file is in the master, with changesets by "cases"', () => {
  for (const f of files) {
    assert.match(f, /^\d{3}-[\w-]+\.sql$/);
    assert.ok(master.includes(`file="${f}"`), f);
  }
  for (const m of sql.matchAll(/^--changeset (\S+):/gm)) assert.equal(m[1], 'cases');
});

test('the changelog creates exactly the manifest permission ids and grants only those', () => {
  const expected = new Set(manifest.permissions.flatMap((o) => ['see', 'edit'].flatMap((a) => o.scopes.map((s) => `${o.id}:${a}:${s}`))));
  const created = new Set([...sql.matchAll(/\('((?:nav|section)\.[\w.]+:\w+:\w+)', '[^']*'\)/g)].map((m) => m[1]));
  assert.deepEqual([...created].sort(), [...expected].sort());
  const granted = [...sql.matchAll(/\('\w+', '((?:nav|section)\.[\w.]+:\w+:\w+)'\)/g)].map((m) => m[1]);
  assert.ok(granted.length > 0);
  for (const id of granted) assert.ok(expected.has(id), id);
});

test("the module's objects are the plugin's own", () => {
  const ids = new Set(manifest.permissions.map((o) => o.id));
  for (const o of manifest.module.objects) assert.ok(ids.has(o), o);
});
