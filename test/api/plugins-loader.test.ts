import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApiPlugins } from '../../apps/api/src/plugins';

/** A plugins folder with one manifest-only plugin (no api part). */
function withPlugin(id: string, manifest: Record<string, unknown>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'apensum-plugins-'));
  try {
    mkdirSync(join(dir, id));
    writeFileSync(join(dir, id, 'package.json'), JSON.stringify({ name: id, apensum: { id, apensumApi: 3, ...manifest } }));
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a plugin may own a Postgres schema named after it; its tables need no prefix', () => {
  withPlugin('demo', { dbSchema: 'demo' }, (dir) => assert.deepEqual(loadApiPlugins(dir).ids, ['demo']));
  withPlugin('demo', { dbSchema: 'demo_archive' }, (dir) => assert.deepEqual(loadApiPlugins(dir).ids, ['demo']));
});

test('tables and a schema together, an odd schema name or a foreign one are refused', () => {
  withPlugin('demo', { dbSchema: 'demo', tables: ['demo_x'] }, (dir) => assert.throws(() => loadApiPlugins(dir), /either apensum.tables .* or apensum.dbSchema/));
  withPlugin('demo', { dbSchema: 'public' }, (dir) => assert.throws(() => loadApiPlugins(dir), /lowercase Postgres schema name other than public/));
  withPlugin('demo', { dbSchema: 'Demo' }, (dir) => assert.throws(() => loadApiPlugins(dir), /lowercase/));
  withPlugin('demo', { dbSchema: 'other' }, (dir) => assert.throws(() => loadApiPlugins(dir), /must start with "demo".*database schema other/));
});

test('a plugin loads after the plugins it requires; a missing one stops the start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'apensum-plugins-'));
  try {
    for (const [id, extra] of [['alpha', { requires: ['zeta'] }], ['zeta', {}], ['mid', {}]] as const) {
      mkdirSync(join(dir, id));
      writeFileSync(join(dir, id, 'package.json'), JSON.stringify({ name: id, apensum: { id, apensumApi: 3, ...extra } }));
    }
    assert.deepEqual(loadApiPlugins(dir).ids, ['mid', 'zeta', 'alpha']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  withPlugin('billing', { requires: ['expenses'] }, (d) => assert.throws(() => loadApiPlugins(d), /billing requires expenses, which is not installed/));
});
