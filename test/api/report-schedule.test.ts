import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextRunAt, parseScheduleRule, zonedDate, zonedTime, zoneOffsetMinutes } from '../../apps/api/src/report-schedule';

const ZH = 'Europe/Zurich';

test('zone offsets and wall-clock times in Zurich, summer and winter', () => {
  assert.equal(zoneOffsetMinutes(new Date('2026-01-15T12:00:00Z'), ZH), 60);
  assert.equal(zoneOffsetMinutes(new Date('2026-07-15T12:00:00Z'), ZH), 120);
  assert.equal(zonedTime('2026-01-15', 6, ZH).toISOString(), '2026-01-15T05:00:00.000Z');
  assert.equal(zonedTime('2026-07-15', 6, ZH).toISOString(), '2026-07-15T04:00:00.000Z');
  assert.equal(zonedDate(new Date('2026-12-31T23:30:00Z'), ZH), '2027-01-01');
});

test('weekly: the next chosen weekday at the hour, today if still ahead', () => {
  const rule = { frequency: 'weekly' as const, weekday: 1, hour: 6, timeZone: ZH }; // Mondays 06:00
  // Tuesday 17.11.2026 -> Monday 23.11.
  assert.equal(nextRunAt(rule, new Date('2026-11-17T10:00:00Z')).toISOString(), '2026-11-23T05:00:00.000Z');
  // Monday 23.11. at 04:00 UTC (05:00 local) -> the same day; at 06:00 local -> a week later.
  assert.equal(nextRunAt(rule, new Date('2026-11-23T04:00:00Z')).toISOString(), '2026-11-23T05:00:00.000Z');
  assert.equal(nextRunAt(rule, new Date('2026-11-23T05:00:00Z')).toISOString(), '2026-11-30T05:00:00.000Z');
});

test('monthly: the day this month if ahead, else next month; 06:00 stays 06:00 over the DST switch', () => {
  const rule = { frequency: 'monthly' as const, monthDay: 1, hour: 6, timeZone: ZH };
  assert.equal(nextRunAt(rule, new Date('2026-11-17T10:00:00Z')).toISOString(), '2026-12-01T05:00:00.000Z');
  // 1 Jan 00:30 in Zurich: 06:00 that day is still ahead.
  assert.equal(nextRunAt(rule, new Date('2026-12-31T23:30:00Z')).toISOString(), '2027-01-01T05:00:00.000Z');
  // After the switch to summer time on 28 March 2027, 06:00 is 04:00 UTC.
  assert.equal(nextRunAt(rule, new Date('2027-03-15T12:00:00Z')).toISOString(), '2027-04-01T04:00:00.000Z');
});

test('parseScheduleRule checks the choices', () => {
  assert.deepEqual(parseScheduleRule({ frequency: 'weekly', weekday: 5 }, ZH), { frequency: 'weekly', weekday: 5, hour: 6, timeZone: ZH });
  assert.deepEqual(parseScheduleRule({ frequency: 'monthly', monthDay: 28, hour: 7 }, ZH), { frequency: 'monthly', monthDay: 28, hour: 7, timeZone: ZH });
  assert.deepEqual(parseScheduleRule({ frequency: 'monthly', monthDay: 31 }, ZH), { error: 'invalid-schedule' });
  assert.deepEqual(parseScheduleRule({ frequency: 'daily' }, ZH), { error: 'invalid-schedule' });
  assert.deepEqual(parseScheduleRule({ frequency: 'weekly', weekday: 1, hour: 24 }, ZH), { error: 'invalid-schedule' });
});

import { runPeriod } from '../../apps/api/src/report-schedules.service';

test('a run covers its preset relative to the run day, or the fixed months', () => {
  assert.deepEqual(runPeriod({ preset: 'lastMonth', groupBy: [] }, '2026-12-01'), ['2026-11', '2026-11']);
  assert.deepEqual(runPeriod({ preset: 'thisYear', groupBy: [] }, '2026-12-01'), ['2026-01', '2026-12']);
  assert.deepEqual(runPeriod({ preset: 'custom', from: '2026-01', to: '2026-06', groupBy: [] }, '2026-12-01'), ['2026-01', '2026-06']);
});
