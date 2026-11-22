import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoWeek, projectTotals, weekDates, weekGrid, type WeekEntry } from '../../apps/api/src/week-report';

const zone = 'Europe/Zurich';
const entry = (start: string, end: string, project: [string, string] | null, sub: [string, string] | null = null): WeekEntry => ({
  start,
  end,
  projectId: project?.[0] ?? null,
  projectName: project?.[1] ?? null,
  subprojectId: sub?.[0] ?? null,
  subprojectName: sub?.[1] ?? null,
});

test('isoWeek follows ISO 8601 across year ends', () => {
  assert.equal(isoWeek('2026-11-16'), 47);
  assert.equal(isoWeek('2026-11-22'), 47);
  assert.equal(isoWeek('2026-01-01'), 1); // a Thursday
  assert.equal(isoWeek('2027-01-01'), 53); // Friday of 2026's week 53
  assert.equal(isoWeek('2024-12-30'), 1); // Monday of 2025's week 1
});

test('weekDates runs Monday to Sunday', () => {
  assert.deepEqual(weekDates('2026-11-16'), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
});

test('weekGrid groups by project and subproject, per local day', () => {
  const montage: [string, string] = ['p1', '1420. Montage'];
  const grid = weekGrid(
    '2026-11-16',
    [
      // 08:00-14:00 Zurich (UTC+1) on Monday, 6 h.
      entry('2026-11-16T07:00:00Z', '2026-11-16T13:00:00Z', montage, ['s1', '40011. Trafostation 101']),
      entry('2026-11-17T07:00:00Z', '2026-11-17T14:30:00Z', montage, ['s1', '40011. Trafostation 101']),
      entry('2026-11-17T15:00:00Z', '2026-11-17T16:00:00Z', montage, null),
      entry('2026-11-18T07:00:00Z', '2026-11-18T08:00:00Z', null),
      // Outside the week: ignored.
      entry('2026-11-23T07:00:00Z', '2026-11-23T08:00:00Z', montage),
    ],
    zone,
  );
  assert.equal(grid.projects.length, 2);
  const [p, none] = grid.projects;
  assert.equal(p.name, '1420. Montage');
  assert.deepEqual(p.minutes, [360, 510, 0, 0, 0, 0, 0]);
  assert.equal(p.total, 870);
  assert.deepEqual(p.subprojects.map((s) => [s.name, s.total]), [['40011. Trafostation 101', 810], [null, 60]]);
  // Hours without a project come last and have no breakdown.
  assert.equal(none.id, null);
  assert.deepEqual(none.subprojects, []);
  assert.deepEqual(projectTotals(grid), [360, 510, 60, 0, 0, 0, 0]);
});

test('weekGrid splits an entry past midnight onto both days', () => {
  // Sunday 22:00 to Monday 02:00 Zurich: only Monday's 2 h belong to this week.
  const grid = weekGrid('2026-11-16', [entry('2026-11-15T21:00:00Z', '2026-11-16T01:00:00Z', ['p', 'Night'])], zone);
  assert.deepEqual(grid.projects[0].minutes, [120, 0, 0, 0, 0, 0, 0]);
  // Sunday 22:00 to Monday 02:00 at the end of the week: Sunday's 2 h.
  const late = weekGrid('2026-11-16', [entry('2026-11-22T21:00:00Z', '2026-11-23T01:00:00Z', ['p', 'Night'])], zone);
  assert.deepEqual(late.projects[0].minutes, [0, 0, 0, 0, 0, 0, 120]);
});
