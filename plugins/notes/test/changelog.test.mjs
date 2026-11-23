import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).apensum;
const changelogDir = join(root, 'changelog');
const master = readFileSync(join(changelogDir, 'db.changelog-master.xml'), 'utf8');
const sqlFiles = readdirSync(changelogDir).filter((f) => f.endsWith('.sql')).sort();
const sql = sqlFiles.map((f) => readFileSync(join(changelogDir, f), 'utf8')).join('\n');

test('every changelog file is in the master, as an NNN-name.sql with changesets by "notes"', () => {
  for (const f of sqlFiles) {
    assert.match(f, /^\d{3}-[\w-]+\.sql$/);
    assert.ok(master.includes(`file="${f}"`), `${f} is not in db.changelog-master.xml`);
  }
  for (const m of sql.matchAll(/^--changeset (\S+):/gm)) assert.equal(m[1], 'notes');
});

test('the changelog creates exactly the manifest permission ids and grants only those', () => {
  const expected = manifest.permissions.flatMap((o) => ['see', 'edit'].flatMap((a) => o.scopes.map((s) => `${o.id}:${a}:${s}`))).sort();
  const created = [...sql.matchAll(/\('((?:nav|section)\.[\w.]+:\w+:\w+)', '[^']*'\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, expected);
  const granted = [...sql.matchAll(/SELECT r\.id, '((?:nav|section)\.[\w.]+:\w+:\w+)'/g)].map((m) => m[1]);
  assert.ok(granted.length > 0);
  for (const id of granted) assert.ok(expected.includes(id), `${id} is granted but not in the manifest`);
});

test("the module's objects are the plugin's own, and the table lives in the plugin's schema", () => {
  const ids = new Set(manifest.permissions.map((o) => o.id));
  for (const o of manifest.module.objects) assert.ok(ids.has(o), o);
  for (const m of sql.matchAll(/CREATE TABLE (\w+)\./g)) assert.equal(m[1], manifest.dbSchema);
});
