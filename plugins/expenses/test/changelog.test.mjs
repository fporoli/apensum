import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allPermissionIds, registerPermissionObjects } from '../../../packages/shared/src/permissions.ts';

const root = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).apensum;
const changelogDir = join(root, 'changelog');
const master = readFileSync(join(changelogDir, 'db.changelog-master.xml'), 'utf8');
const sqlFiles = readdirSync(changelogDir).filter((f) => f.endsWith('.sql')).sort();
const sql = sqlFiles.map((f) => readFileSync(join(changelogDir, f), 'utf8')).join('\n');

test('every changelog file is in the master, as an NNN-name.sql with changesets by "expenses"', () => {
  for (const f of sqlFiles) {
    assert.match(f, /^\d{3}-[\w-]+\.sql$/);
    assert.ok(master.includes(`file="${f}"`), `${f} is not in db.changelog-master.xml`);
  }
  for (const m of sql.matchAll(/^--changeset (\S+):/gm)) assert.equal(m[1], 'expenses');
});

test('the changelog creates exactly the manifest permission ids and grants only those', () => {
  registerPermissionObjects(manifest.permissions);
  const expected = new Set(
    manifest.permissions.flatMap((o) => ['see', 'edit'].flatMap((a) => o.scopes.map((s) => `${o.id}:${a}:${s}`))),
  );
  for (const id of expected) assert.ok(allPermissionIds().includes(id), id);
  // ('<object>', 'people' | 'org') rows, cross-joined with the actions and the kind's scopes.
  const created = new Set();
  for (const m of sql.matchAll(/\('((?:nav|section)\.[\w.]+)', '(people|org)'\)/g)) {
    for (const a of ['see', 'edit']) for (const s of m[2] === 'people' ? ['own', 'team', 'reports', 'all'] : ['all']) created.add(`${m[1]}:${a}:${s}`);
  }
  assert.deepEqual([...created].sort(), [...expected].sort());
  const granted = [...sql.matchAll(/'((?:nav|section)\.[\w.]+:\w+:\w+)'/g)].map((m) => m[1]);
  assert.ok(granted.length > 0);
  for (const id of granted) assert.ok(expected.has(id), `${id} is granted but not in the manifest`);
});

test("the module's objects are the plugin's own", () => {
  const ids = new Set(manifest.permissions.map((o) => o.id));
  for (const o of manifest.module.objects) assert.ok(ids.has(o), o);
});
