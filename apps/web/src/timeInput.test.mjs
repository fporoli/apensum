import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockToMinutes, formatClockTime, formatDurationInput, parseClockTime, parseDuration, sessionFromParts } from './timeInput.ts';

test('parseDuration reads hours, h:mm, minutes and mixed forms', () => {
  assert.equal(parseDuration('8h'), 480);
  assert.equal(parseDuration('8:10'), 490);
  assert.equal(parseDuration('45m'), 45);
  assert.equal(parseDuration('45 min'), 45);
  assert.equal(parseDuration('8h10'), 490);
  assert.equal(parseDuration('8h 10m'), 490);
  assert.equal(parseDuration('1.5h'), 90);
  assert.equal(parseDuration('1,5h'), 90);
  assert.equal(parseDuration('0:45'), 45);
  assert.equal(parseDuration(' 8H '), 480);
});

test('parseDuration: a bare number is hours up to 24, minutes above', () => {
  assert.equal(parseDuration('8'), 480);
  assert.equal(parseDuration('1.5'), 90);
  assert.equal(parseDuration('24'), 1440);
  assert.equal(parseDuration('90'), 90);
});

test('parseDuration rounds to 5 minutes', () => {
  assert.equal(parseDuration('8:12'), 490);
  assert.equal(parseDuration('8:13'), 495);
  assert.equal(parseDuration('43m'), 45);
});

test('parseDuration: empty is null, nonsense, zero and over 24h are undefined', () => {
  assert.equal(parseDuration(''), null);
  assert.equal(parseDuration('  '), null);
  assert.equal(parseDuration('abc'), undefined);
  assert.equal(parseDuration('8:75'), undefined);
  assert.equal(parseDuration('2m'), undefined);
  assert.equal(parseDuration('0'), undefined);
  assert.equal(parseDuration('25h'), undefined);
});

test('formatDurationInput round-trips through parseDuration', () => {
  for (const mins of [5, 45, 60, 490, 480, 1440]) assert.equal(parseDuration(formatDurationInput(mins)), mins);
  assert.equal(formatDurationInput(490), '8h 10m');
  assert.equal(formatDurationInput(45), '45m');
  assert.equal(formatDurationInput(480), '8h');
});

test('parseClockTime reads digits-only and separated times', () => {
  assert.equal(parseClockTime('1800'), 18 * 60);
  assert.equal(parseClockTime('945'), 9 * 60 + 45);
  assert.equal(parseClockTime('0945'), 9 * 60 + 45);
  assert.equal(parseClockTime('9'), 9 * 60);
  assert.equal(parseClockTime('18'), 18 * 60);
  assert.equal(parseClockTime('9:45'), 9 * 60 + 45);
  assert.equal(parseClockTime('9.45'), 9 * 60 + 45);
  assert.equal(parseClockTime('9h45'), 9 * 60 + 45);
  assert.equal(parseClockTime('0'), 0);
  assert.equal(parseClockTime(''), null);
  assert.equal(parseClockTime('2400'), undefined);
  assert.equal(parseClockTime('960'), undefined);
  assert.equal(parseClockTime('25'), undefined);
  assert.equal(parseClockTime('9:5'), undefined);
});

test('formatClockTime and clockToMinutes', () => {
  assert.equal(formatClockTime(585), '09:45');
  assert.equal(clockToMinutes('09:45'), 585);
  assert.equal(clockToMinutes(''), null);
});

const local = (iso) => {
  const d = new Date(iso);
  return [d.getDate(), d.getHours(), d.getMinutes()];
};

test('sessionFromParts with an end time, same day and over midnight', () => {
  const day = sessionFromParts('2026-11-17', '08:00', { kind: 'end', time: '17:30' });
  assert.deepEqual(local(day.checkIn), [17, 8, 0]);
  assert.deepEqual(local(day.checkOut), [17, 17, 30]);
  assert.equal(day.nextDay, false);
  const night = sessionFromParts('2026-11-17', '22:00', { kind: 'end', time: '06:00' });
  assert.deepEqual(local(night.checkOut), [18, 6, 0]);
  assert.equal(night.nextDay, true);
});

test('sessionFromParts with a duration, and an open session', () => {
  const s = sessionFromParts('2026-11-17', '08:00', { kind: 'duration', minutes: 510 });
  assert.deepEqual(local(s.checkOut), [17, 16, 30]);
  assert.equal(sessionFromParts('2026-11-17', '08:00', { kind: 'end', time: null }).checkOut, null);
  assert.equal(sessionFromParts('2026-11-17', '', { kind: 'end', time: null }), null);
});
