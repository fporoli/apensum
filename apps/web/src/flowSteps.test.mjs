import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { stepProgress } from './flowSteps.ts';

const steps = [{ key: 'ok' }, { key: 'big' }, { key: 'give' }, { key: 'mail' }, { key: 'buy' }];
const ev = (workflow, step, name, at, extra = {}) => ({ data: { workflow, step: step ? { key: step } : null, ...extra }, author_name: name, posted_at: at });

test('done with who and when, a condition skipped, the current step with who did it so far, the rest to come', () => {
  const p = stepProgress(steps, [
    ev('approved', 'ok', 'Marta A', '2026-11-24T08:00:00Z'),
    ev('done', 'give', 'Marco A', '2026-11-24T09:00:00Z'),
    ev('done', 'give', 'Uma A', '2026-11-24T10:00:00Z'),
  ], { step: 'give', status: 'pending' });
  assert.deepEqual(p.map((s) => s.state), ['done', 'skipped', 'current', 'upcoming', 'upcoming']);
  assert.deepEqual(p[0].by, ['Marta A']);
  assert.equal(p[0].at, '2026-11-24T08:00:00Z');
  assert.deepEqual(p[2].by, ['Marco A', 'Uma A']);
});

test('a mail step and a review without a manager are the system\'s; finished, all are done or skipped', () => {
  const p = stepProgress(steps, [
    ev('approved', 'ok', 'Ueli A', '2026-11-24T08:00:00Z', { automatic: true }),
    ev('done', 'give', 'Marco A', '2026-11-24T09:00:00Z'),
    ev('mailed', 'mail', 'Marco A', '2026-11-24T09:00:01Z'),
    ev('done', 'buy', 'Ueli A', '2026-11-25T09:00:00Z'),
    ev('finished', null, 'Ueli A', '2026-11-25T09:00:00Z'),
  ], { step: 'buy', status: 'approved' });
  assert.deepEqual(p.map((s) => s.state), ['done', 'skipped', 'done', 'done', 'done']);
  assert.equal(p[0].automatic, true);
  assert.deepEqual(p[0].by, []);
  assert.equal(p[3].automatic, true);
  assert.equal(p[4].automatic, false);
});

test('sent back: the step is marked; submitted again, the steps start over', () => {
  const back = [
    ev('approved', 'ok', 'Marta A', '2026-11-24T08:00:00Z'),
    ev('returned', 'give', 'Uma A', '2026-11-24T09:00:00Z'),
  ];
  assert.deepEqual(stepProgress(steps, back, { step: 'give', status: 'rejected' }).map((s) => s.state), ['done', 'skipped', 'returned', 'upcoming', 'upcoming']);
  const again = stepProgress(steps, [...back, ev('resubmitted', null, 'Ueli A', '2026-11-24T10:00:00Z')], { step: 'ok', status: 'pending' });
  assert.deepEqual(again.map((s) => s.state), ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  assert.deepEqual(again[0].by, []);
});
