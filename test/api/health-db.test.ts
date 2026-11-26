import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { HealthController, databaseAnswers } from '../../apps/api/src/health.controller';

const answering = { execute: async () => ({ rows: [{ '?column?': 1 }] }) } as never;
const failing = { execute: async () => { throw new Error('connection refused'); } } as never;
const hanging = { execute: () => new Promise(() => {}) } as never;

test('the database answers, fails, hangs, or there is none', async () => {
  assert.equal(await databaseAnswers(answering), true);
  assert.equal(await databaseAnswers(failing), false);
  assert.equal(await databaseAnswers(hanging, 20), false);
  assert.equal(await databaseAnswers(null), false);
});

test('health/db answers 200 or 503 and tells nothing more', async () => {
  const res = () => { const r = { code: 200, status(c: number) { r.code = c; return r; } }; return r; };
  const up = res();
  assert.deepEqual(await new HealthController({ getDb: () => answering } as never).database(up as never), { status: 'ok' });
  assert.equal(up.code, 200);
  const down = res();
  assert.deepEqual(await new HealthController({ getDb: () => failing } as never).database(down as never), { status: 'unavailable' });
  assert.equal(down.code, 503);
  const offline = res();
  await new HealthController({ getDb: () => null } as never).database(offline as never);
  assert.equal(offline.code, 503);
});
