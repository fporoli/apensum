import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { clock, todayIn } from '../../apps/api/src/clock';

test('the clock is the real time, another one only inside clock.at, also across awaits', async () => {
  const before = Date.now();
  assert.ok(Math.abs(clock.now().getTime() - before) < 1000);
  assert.equal(clock.isSet(), false);
  const seen = await clock.at(new Date('2018-03-05T09:30:00Z'), async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return [clock.now().toISOString(), todayIn('Europe/Zurich'), clock.isSet()];
  });
  assert.deepEqual(seen, ['2018-03-05T09:30:00.000Z', '2018-03-05', true]);
  assert.equal(clock.isSet(), false, 'set only inside');
});

test('clock.at with a function: time that runs on (the simulation)', () => {
  let t = Date.parse('2020-01-31T22:58:00Z');
  const days = clock.at(() => new Date((t += 60_000)), () => [todayIn('Europe/Zurich'), todayIn('Europe/Zurich')]);
  assert.deepEqual(days, ['2020-01-31', '2020-02-01'], '23:59 and 00:00 in Zurich');
});

// The files moved to the business clock keep to it: no SQL now()/CURRENT_DATE and no new Date() (technical time,
// such as the role cache's Date.now(), stays allowed). Extend the list as more files move.
const ON_THE_CLOCK = [
  'flows.controller.ts', 'flows.service.ts', 'flow-steps.ts', 'workflows.service.ts', 'workflows.controller.ts', 'workflow-dues.service.ts',
  'access.ts', 'work-time-model.service.ts', 'balances.service.ts', 'balances.controller.ts', 'notifications.service.ts', 'audit.service.ts',
];

test('files on the business clock do not read the real time', () => {
  for (const file of ON_THE_CLOCK) {
    const text = readFileSync(join(__dirname, '../../apps/api/src', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    assert.ok(!/(?<![\w.])now\(\)/.test(text), `${file}: SQL now() (use sqlNow())`);
    assert.ok(!/\bCURRENT_DATE\b/i.test(text), `${file}: CURRENT_DATE (use sqlToday())`);
    assert.ok(!/new Date\(\)/.test(text), `${file}: new Date() (use clock.now())`);
  }
});
