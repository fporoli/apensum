import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { checkWorkingTimeAct, requiredBreakMinutes, type ActFinding } from '../../apps/api/src/working-time-act';

/** Zurich in November is UTC+1: local "2026-11-10 08:00" is 07:00Z. */
const z = (local: string) => {
  const [d, t] = local.split(' ');
  const [h, m] = t.split(':').map(Number);
  return new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)), h - 1, m)).toISOString();
};
const s = (from: string, to: string) => ({ start: z(from), end: z(to) });
const opts = { timeZone: 'Europe/Zurich', from: '2026-11-01', toExclusive: '2026-12-01', maxWeeklyMinutes: 45 * 60, yearLimitMinutes: 170 * 60 };
const of = (findings: ActFinding[], check: string) => findings.filter((f) => f.check === check);

test('requiredBreakMinutes follows the 5½ / 7 / 9 hour thresholds', () => {
  assert.equal(requiredBreakMinutes(330), 0);
  assert.equal(requiredBreakMinutes(331), 15);
  assert.equal(requiredBreakMinutes(421), 30);
  assert.equal(requiredBreakMinutes(541), 60);
});

test('a normal day with a lunch break has no findings', () => {
  const f = checkWorkingTimeAct([s('2026-11-10 08:00', '2026-11-10 12:00'), s('2026-11-10 13:00', '2026-11-10 17:30')], opts);
  assert.deepEqual(f, []);
});

test('breaks: 8h without a break misses 30 minutes; a 10-minute gap is not a break', () => {
  const none = checkWorkingTimeAct([s('2026-11-10 08:00', '2026-11-10 16:00')], opts);
  assert.deepEqual(of(none, 'breaks'), [{ check: 'breaks', date: '2026-11-10', minutes: 30 }]);
  const tiny = checkWorkingTimeAct([s('2026-11-10 08:00', '2026-11-10 12:00'), s('2026-11-10 12:10', '2026-11-10 16:10')], opts);
  assert.deepEqual(of(tiny, 'breaks'), [{ check: 'breaks', date: '2026-11-10', minutes: 30 }]);
});

test('daily rest under 11 hours and a day longer than 14 hours', () => {
  const f = checkWorkingTimeAct(
    [
      s('2026-11-10 07:00', '2026-11-10 12:00'),
      s('2026-11-10 13:00', '2026-11-10 22:00'), // span 15h
      s('2026-11-11 06:00', '2026-11-11 10:00'), // 8h after 22:00
    ],
    opts,
  );
  assert.deepEqual(of(f, 'span'), [{ check: 'span', date: '2026-11-10', minutes: 60 }]);
  assert.deepEqual(of(f, 'dailyRest'), [{ check: 'dailyRest', date: '2026-11-11', minutes: 180 }]);
});

test('night work: the minutes between 23:00 and 06:00, on the day they fall on', () => {
  const f = checkWorkingTimeAct([s('2026-11-10 22:00', '2026-11-11 06:30')], opts);
  assert.deepEqual(of(f, 'night'), [
    { check: 'night', date: '2026-11-10', minutes: 60 },
    { check: 'night', date: '2026-11-11', minutes: 360 },
  ]);
});

test('Sunday work is listed with its minutes', () => {
  // 15 November 2026 is a Sunday.
  const f = checkWorkingTimeAct([s('2026-11-15 10:00', '2026-11-15 14:00')], opts);
  assert.deepEqual(of(f, 'sunday'), [{ check: 'sunday', date: '2026-11-15', minutes: 240 }]);
});

test('weekly maximum: a 50-hour week is 5 hours of Überzeit, on its Monday', () => {
  const week = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].flatMap((d) => [
    s(`${d} 07:00`, `${d} 12:00`),
    s(`${d} 13:00`, `${d} 18:00`),
  ]);
  const f = checkWorkingTimeAct(week, opts);
  assert.deepEqual(of(f, 'weeklyMaximum'), [{ check: 'weeklyMaximum', date: '2026-11-09', minutes: 300 }]);
  assert.deepEqual(of(f, 'yearlyOvertime'), []);
});

test('yearly Überzeit: reported on the day the limit is passed', () => {
  const f = checkWorkingTimeAct(
    ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].flatMap((d) => [s(`${d} 07:00`, `${d} 12:00`), s(`${d} 13:00`, `${d} 18:00`)]),
    { ...opts, yearLimitMinutes: 120 },
  );
  // 45h are reached on Friday morning; Friday adds 300 minutes beyond them, 180 above the limit.
  assert.deepEqual(of(f, 'yearlyOvertime'), [{ check: 'yearlyOvertime', date: '2026-11-13', minutes: 180 }]);
});

test('only days in the period are reported; earlier sessions still count for the rest', () => {
  const f = checkWorkingTimeAct([s('2026-10-31 13:00', '2026-10-31 23:00'), s('2026-11-01 07:00', '2026-11-01 08:00')], opts);
  assert.deepEqual(of(f, 'dailyRest'), [{ check: 'dailyRest', date: '2026-11-01', minutes: 180 }]);
  assert.deepEqual(of(f, 'breaks'), []);
});
