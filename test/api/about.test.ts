import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { AboutController, buildInfo, databaseInfo } from '../../apps/api/src/about.controller';
import type { DbService } from '../../apps/api/src/db.service';

test('buildInfo reads the values baked into the image', () => {
  const info = buildInfo({ BUILD_RELEASE: 'v1.2.0', BUILD_COMMIT: 'abc123', BUILD_DATE: '2026-10-31T08:00:00+01:00' });
  assert.deepEqual(info, { release: 'v1.2.0', commit: 'abc123', date: '2026-10-31T08:00:00+01:00' });
});

test('buildInfo treats unset and empty build args as unknown', () => {
  // A Dockerfile `ENV X=$X` with no build arg yields an empty string, not an unset variable.
  assert.deepEqual(buildInfo({ BUILD_RELEASE: '', BUILD_COMMIT: '' }), { release: null, commit: null, date: null });
});

test('databaseInfo reports the last applied changeset', async () => {
  const db = { execute: async () => ({ rows: [{ filename: 'changelog/040-example.sql' }] }) };
  assert.deepEqual(await databaseInfo(db as never), { status: 'ok', lastChangeset: 'changelog/040-example.sql' });
});

test('databaseInfo distinguishes offline mode from a failing database', async () => {
  assert.deepEqual(await databaseInfo(null), { status: 'offline', lastChangeset: null });
  const db = { execute: async () => { throw new Error('connection refused'); } };
  assert.deepEqual(await databaseInfo(db as never), { status: 'unavailable', lastChangeset: null });
});

test('about still answers in offline mode and exposes no configuration', async () => {
  const controller = new AboutController({ getDb: () => null } as unknown as DbService);
  const result = await controller.about();
  assert.equal(result.ok, true);
  assert.equal(result.database.status, 'offline');
  assert.deepEqual(Object.keys(result.server).sort(), ['environment', 'hostname', 'nodeVersion', 'startedAt', 'time', 'timeZone']);
});

test('plugins: version, and the commit from the image build, a git checkout, or the core for a bundled one', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { pluginInfos } = await import('../../apps/api/src/about.controller');
  const dir = mkdtempSync(join(tmpdir(), 'plugins-'));
  const plugin = (id: string, extra: Record<string, unknown> = {}) => {
    mkdirSync(join(dir, id));
    writeFileSync(join(dir, id, 'package.json'), JSON.stringify({ version: '1.2.3', apensum: { id, apensumApi: 1, ...extra } }));
  };
  plugin('built', { module: { id: 'built', caption: 'modules.built' } });
  writeFileSync(join(dir, 'built', 'build-info.json'), JSON.stringify({ commit: 'a'.repeat(40), date: '2026-11-23T10:00:00+01:00' }));
  plugin('checkout');
  const git = (...args: string[]) => execFileSync('git', ['-C', join(dir, 'checkout'), ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.ch', 'commit', '-q', '--allow-empty', '-m', 'x');
  const head = git('rev-parse', 'HEAD').trim();
  plugin('bundled');
  const infos = pluginInfos(dir, { BUILD_COMMIT: 'c'.repeat(40), BUILD_DATE: '2026-11-22T08:00:00Z' });
  assert.deepEqual(infos.find((p) => p.id === 'built'), { id: 'built', caption: 'modules.built', version: '1.2.3', commit: 'a'.repeat(40), date: '2026-11-23T10:00:00+01:00' });
  assert.equal(infos.find((p) => p.id === 'checkout')?.commit, head);
  assert.deepEqual(infos.find((p) => p.id === 'bundled'), { id: 'bundled', caption: null, version: '1.2.3', commit: 'c'.repeat(40), date: '2026-11-22T08:00:00Z' });
});
