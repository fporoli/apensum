import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bucket, minutesPerDay, periodRange, startOfWeek } from './aggregate.ts';

test('bucket groups entries by local calendar day rather than UTC day', () => {
  const localMidnight = new Date(2026, 8, 7, 0, 15, 0); // 2026-09-07 00:15 local
  const end = new Date(localMidnight.getTime() + 45 * 60000);
  const rows = bucket(
    [{ id: '1', start_time: localMidnight.toISOString(), end_time: end.toISOString() }],
    'daily',
  );
  assert.deepEqual(rows, [{ label: '2026-09-07', minutes: 45 }]);
});

test('bucket groups weekly and monthly entries using local week start and month', () => {
  const sundayLate = new Date(2026, 8, 13, 23, 30, 0); // Sunday 2026-09-13 23:30 local
  const mondayEarly = new Date(2026, 8, 14, 0, 30, 0); // Monday 2026-09-14 00:30 local
  const rows = bucket(
    [
      { id: '1', start_time: sundayLate.toISOString(), end_time: new Date(sundayLate.getTime() + 30 * 60000).toISOString() },
      { id: '2', start_time: mondayEarly.toISOString(), end_time: new Date(mondayEarly.getTime() + 60 * 60000).toISOString() },
    ],
    'weekly',
  );
  assert.deepEqual(rows, [
    { label: startOfWeek('2026-09-13'), minutes: 30 },
    { label: startOfWeek('2026-09-14'), minutes: 60 },
  ]);
  const monthly = bucket(
    [{ id: '2', start_time: mondayEarly.toISOString(), end_time: new Date(mondayEarly.getTime() + 60 * 60000).toISOString() }],
    'monthly',
  );
  assert.deepEqual(monthly, [{ label: '2026-09', minutes: 60 }]);
});

test('periodRange spans exact local day bounds', () => {
  const { from, to } = periodRange('day', '2026-09-07');
  assert.equal(new Date(from).getDate(), 7);
  assert.equal(new Date(to).getTime() - new Date(from).getTime(), 86400000);
});

test('bucket splits an entry past midnight between both local days', () => {
  const iso = (y, m, d, h) => new Date(y, m - 1, d, h).toISOString();
  const night = { id: 'n', start_time: iso(2026, 11, 30, 22), end_time: iso(2026, 12, 1, 6) };
  assert.deepEqual(bucket([night], 'daily'), [
    { label: '2026-11-30', minutes: 120 },
    { label: '2026-12-01', minutes: 360 },
  ]);
  assert.deepEqual(bucket([night], 'monthly'), [
    { label: '2026-11', minutes: 120 },
    { label: '2026-12', minutes: 360 },
  ]);
  // Ending at midnight stays on one day.
  assert.deepEqual(minutesPerDay({ start_time: iso(2026, 11, 30, 18), end_time: iso(2026, 12, 1, 0) }), [['2026-11-30', 360]]);
});
