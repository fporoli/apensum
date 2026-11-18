import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneFormatter } from '../../apps/api/src/zone-format';
import { zonedDate, zoneOffsetMinutes } from '../../apps/api/src/report-schedule';
import { localDate, minutesByLocalDay } from '../../apps/api/src/work-time-model.service';

test('zoneFormatter reuses one formatter per format and zone', () => {
  assert.equal(zoneFormatter('date', 'Europe/Zurich'), zoneFormatter('date', 'Europe/Zurich'));
  assert.notEqual(zoneFormatter('date', 'Europe/Zurich'), zoneFormatter('date', 'UTC'));
  assert.notEqual(zoneFormatter('date', 'Europe/Zurich'), zoneFormatter('parts', 'Europe/Zurich'));
});

test('zoneFormatter formats ISO dates in the zone', () => {
  assert.equal(zoneFormatter('date', 'Europe/Zurich').format(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(zoneFormatter('date', 'America/New_York').format(new Date('2026-01-01T03:00:00Z')), '2025-12-31');
});

test('zoneFormatter throws for an unknown zone every time, without caching it', () => {
  assert.throws(() => zoneFormatter('date', 'Not/AZone'), RangeError);
  assert.throws(() => zoneFormatter('date', 'Not/AZone'), RangeError);
  assert.equal(localDate('2026-11-10T23:30:00Z', 'Not/AZone'), '2026-11-10');
});

test('cached formatters keep zone offsets and midnight splits right across DST', () => {
  assert.equal(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Europe/Zurich'), 60);
  assert.equal(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/Zurich'), 120);
  assert.equal(zonedDate(new Date('2026-03-28T23:30:00Z'), 'Europe/Zurich'), '2026-03-29');
  // 22:00 to 06:00 local over the spring-forward night: 2 h, then 5 h (02:00 is skipped).
  const days = minutesByLocalDay([{ start: '2026-03-28T21:00:00Z', end: '2026-03-29T04:00:00Z' }], '2026-03-01', '2026-04-01', 'Europe/Zurich');
  assert.deepEqual([...days], [['2026-03-28', 120], ['2026-03-29', 300]]);
});
