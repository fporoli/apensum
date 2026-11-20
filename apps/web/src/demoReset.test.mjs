import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEMO_RESET_MINUTE_UTC, demoResetWarning, inDemoResetWindow, lastDemoReset, nextDemoReset } from './demoReset.ts';

const at = (iso) => Date.parse(iso);

test('the next reset is every two hours at minute 7 UTC, across midnight', () => {
  assert.equal(new Date(nextDemoReset(at('2026-11-20T14:00:00Z'), 2)).toISOString(), '2026-11-20T14:07:00.000Z');
  assert.equal(new Date(nextDemoReset(at('2026-11-20T14:07:00Z'), 2)).toISOString(), '2026-11-20T16:07:00.000Z');
  assert.equal(new Date(nextDemoReset(at('2026-11-20T23:30:00Z'), 2)).toISOString(), '2026-11-21T00:07:00.000Z');
  assert.equal(new Date(lastDemoReset(at('2026-11-20T15:00:00Z'), 2)).toISOString(), '2026-11-20T14:07:00.000Z');
});

test('the warning shows in the last ten minutes, the waiting page only around a scheduled time', () => {
  assert.equal(demoResetWarning(at('2026-11-20T13:50:00Z'), 2), null);
  assert.equal(demoResetWarning(at('2026-11-20T14:00:30Z'), 2).minutes, 7);
  assert.ok(inDemoResetWindow(at('2026-11-20T14:06:30Z'), 2));
  assert.ok(inDemoResetWindow(at('2026-11-20T14:30:00Z'), 2), 'GitHub may start the run late');
  assert.ok(!inDemoResetWindow(at('2026-11-20T15:00:00Z'), 2));
});

test('the minute and the hours match the workflow schedule', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/demo-reset.yml', import.meta.url), 'utf8');
  const cron = /cron: '(\d+) \*\/(\d+) \* \* \*'/.exec(workflow);
  assert.ok(cron, 'demo-reset.yml has a cron like "7 */2 * * *"');
  assert.equal(Number(cron[1]), DEMO_RESET_MINUTE_UTC);
  const compose = readFileSync(new URL('../../../.github/workflows/vps.yml', import.meta.url), 'utf8');
  assert.match(compose, /DEMO_RESET_EVERY_HOURS/, 'vps.yml passes DEMO_RESET_EVERY_HOURS to the server');
});
