import test from 'node:test';
import assert from 'node:assert/strict';
import { crossesMonthEnd, dayContextFrom, dayContextTo, dayFindings, overlappingSessions, sessionsOverlap, splitAtMonthEnds } from '../../apps/api/src/work-time-day';

const tz = 'Europe/Zurich';
const opts = { timeZone: tz, maxWeeklyMinutes: 45 * 60, yearLimitMinutes: 170 * 60 };
// Zurich is UTC+1 in November.
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00+01:00`).toISOString();
const session = (id: string, day: string, from: string, to: string | null) => ({ id, check_in: at(day, from), check_out: to ? at(day, to) : null });

test('sessions overlap when they share a minute; touching ends do not', () => {
  const other = session('a', '2026-11-16', '08:00', '12:00');
  assert.equal(sessionsOverlap(at('2026-11-16', '11:00'), at('2026-11-16', '13:00'), other), true);
  assert.equal(sessionsOverlap(at('2026-11-16', '12:00'), at('2026-11-16', '13:00'), other), false);
  assert.equal(sessionsOverlap(at('2026-11-16', '06:00'), at('2026-11-16', '08:00'), other), false);
  assert.equal(sessionsOverlap(at('2026-11-16', '09:00'), at('2026-11-16', '10:00'), other), true);
});

test('an open session runs until it is closed, on either side', () => {
  const running = session('r', '2026-11-16', '08:00', null);
  assert.equal(sessionsOverlap(at('2026-11-16', '15:00'), at('2026-11-16', '16:00'), running), true);
  assert.equal(sessionsOverlap(at('2026-11-16', '06:00'), at('2026-11-16', '07:00'), running), false);
  // A check-in now (open end) meets a session entered by hand for later today.
  assert.equal(sessionsOverlap(at('2026-11-16', '10:00'), null, session('l', '2026-11-16', '14:00', '15:00')), true);
});

test('the edited session is not its own overlap', () => {
  const list = [session('a', '2026-11-16', '08:00', '12:00'), session('b', '2026-11-16', '13:00', '17:00')];
  assert.deepEqual(overlappingSessions(list, at('2026-11-16', '08:30'), at('2026-11-16', '12:00'), 'a').map((x) => x.id), []);
  assert.deepEqual(overlappingSessions(list, at('2026-11-16', '08:30'), at('2026-11-16', '13:30'), 'a').map((x) => x.id), ['b']);
});

test('context covers the year for Überzeit and the week plus the next day', () => {
  assert.equal(dayContextFrom('2026-11-18'), '2025-12-28');
  assert.equal(dayContextTo('2026-11-18'), '2026-11-23');
  assert.equal(dayContextTo('2026-11-22'), '2026-11-24');
});

test('the day shows a too short break with the draft in place of the stored session', () => {
  const stored = [session('a', '2026-11-16', '08:00', '12:00'), session('b', '2026-11-16', '12:30', '17:00')];
  // As stored: 8.5 h with a 30 min break, fine.
  assert.deepEqual(dayFindings(stored, null, '2026-11-16', opts), []);
  // The afternoon moved to 12:10: 8 h 50 min of work with a 10 min gap, which is no break.
  const findings = dayFindings(stored, { id: 'b', checkIn: at('2026-11-16', '12:10'), checkOut: at('2026-11-16', '17:00') }, '2026-11-16', opts);
  assert.deepEqual(findings.map((f) => [f.check, f.minutes]), [['breaks', 30]]);
});

test('a short rest before the next day is shown on the edited day', () => {
  const stored = [session('a', '2026-11-16', '08:00', '12:00'), session('n', '2026-11-17', '05:00', '09:00')];
  const findings = dayFindings(stored, { id: null, checkIn: at('2026-11-16', '13:00'), checkOut: at('2026-11-16', '22:00') }, '2026-11-16', opts);
  const rest = findings.find((f) => f.check === 'dailyRest');
  assert.ok(rest?.after);
  assert.equal(rest?.date, '2026-11-16');
  assert.equal(rest?.minutes, 4 * 60);
});

test('Sunday work is a hint on that day only', () => {
  const findings = dayFindings([], { checkIn: at('2026-11-22', '10:00'), checkOut: at('2026-11-22', '12:00') }, '2026-11-22', opts);
  assert.deepEqual(findings.map((f) => [f.check, f.minutes]), [['sunday', 120]]);
});

test('past midnight is one entry; past a month end (in the person\'s zone) it is not', () => {
  // 22:00 to 03:00 within November.
  assert.equal(crossesMonthEnd(at('2026-11-17', '22:00'), at('2026-11-18', '03:00'), tz), false);
  // 30 November 22:00 to 1 December 03:00 local.
  assert.equal(crossesMonthEnd(at('2026-11-30', '22:00'), at('2026-12-01', '03:00'), tz), true);
  // Ending exactly at midnight stays in November.
  assert.equal(crossesMonthEnd(at('2026-11-30', '22:00'), at('2026-12-01', '00:00'), tz), false);
  // 23:30 UTC on 30 November is already 1 December in Zurich: one month, December.
  assert.equal(crossesMonthEnd('2026-11-30T23:30:00Z', '2026-12-01T02:00:00Z', tz), false);
});

test('a check-out past a month end is cut at local midnight', () => {
  assert.deepEqual(splitAtMonthEnds(at('2026-11-30', '22:00'), at('2026-12-01', '03:00'), tz), [
    { start: at('2026-11-30', '22:00'), end: at('2026-12-01', '00:00') },
    { start: at('2026-12-01', '00:00'), end: at('2026-12-01', '03:00') },
  ]);
  assert.equal(splitAtMonthEnds(at('2026-11-17', '22:00'), at('2026-11-18', '03:00'), tz).length, 1);
  // A forgotten check-out over two month ends: three pieces.
  assert.equal(splitAtMonthEnds(at('2026-10-31', '08:00'), at('2026-12-02', '08:00'), tz).length, 3);
});

test('night work of a shift past midnight counts in full on the day it starts', () => {
  const findings = dayFindings([], { checkIn: at('2026-11-17', '22:00'), checkOut: at('2026-11-18', '03:00') }, '2026-11-17', opts);
  assert.deepEqual(findings.filter((f) => f.check === 'night').map((f) => f.minutes), [4 * 60]);
  // Saturday 22:00 to Sunday 02:00: the two Sunday hours show on Saturday's entry.
  const weekend = dayFindings([], { checkIn: at('2026-11-21', '22:00'), checkOut: at('2026-11-22', '02:00') }, '2026-11-21', opts);
  assert.deepEqual(weekend.find((f) => f.check === 'sunday')?.minutes, 120);
});

test('seconds from check-in and check-out are no overlap; a shared minute is', () => {
  // Checked out at 02:02:18, the next session typed from 02:02.
  const other = { id: 'c', check_in: '2026-11-19T00:58:05Z', check_out: '2026-11-19T01:02:18Z' };
  assert.equal(sessionsOverlap('2026-11-19T01:02:00Z', '2026-11-19T08:03:00Z', other), false);
  assert.equal(sessionsOverlap('2026-11-19T01:01:00Z', '2026-11-19T08:03:00Z', other), true);
});
