import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoResetEveryHours } from '../../apps/api/src/health.controller';

test('a demo reset schedule is whole hours that divide a day, else none', () => {
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '2' }), 2);
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '24' }), 24);
  assert.equal(demoResetEveryHours({}), null);
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '' }), null);
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '5' }), null, '5 does not divide 24');
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '1.5' }), null);
});
