import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoResetEveryHours, instanceInfo } from '../../apps/api/src/health.controller';

test('a demo reset schedule is whole hours that divide a day, else none', () => {
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '2' }), 2);
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '24' }), 24);
  assert.equal(demoResetEveryHours({}), null);
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '' }), null);
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '5' }), null, '5 does not divide 24');
  assert.equal(demoResetEveryHours({ DEMO_RESET_EVERY_HOURS: '1.5' }), null);
});

test('instanceInfo: every instance but prod is named, with its last deploy', () => {
  assert.deepEqual(instanceInfo({ INSTANCE: 'demo', DEPLOYED_AT: '2026-11-26T20:24:00Z' }), { name: 'demo', deployedAt: '2026-11-26T20:24:00.000Z' });
  assert.deepEqual(instanceInfo({ INSTANCE: 'Test' }), { name: 'test', deployedAt: null });
  assert.deepEqual(instanceInfo({ INSTANCE: 'development', DEPLOYED_AT: 'yesterday' }), { name: 'development', deployedAt: null });
  assert.equal(instanceInfo({ INSTANCE: 'prod', DEPLOYED_AT: '2026-11-26T20:24:00Z' }), null);
  assert.equal(instanceInfo({}), null);
  assert.equal(instanceInfo({ INSTANCE: 'azure' }), null);
});
