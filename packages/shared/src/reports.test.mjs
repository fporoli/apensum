import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORTS, groupReport, monthsBetween, parseGroupBy, reportById } from './reports.ts';
import { NAV_OBJECTS } from './permissions.ts';

test('every report reads through a page that exists, and groups only by its own dimensions', () => {
  const nav = new Set(NAV_OBJECTS.map((o) => o.id));
  for (const r of REPORTS) {
    assert.ok(nav.has(r.object), r.id);
    for (const d of r.defaultGroupBy) assert.ok(r.dimensions.includes(d), `${r.id}: ${d}`);
    for (const c of r.chart) assert.ok(r.measures.some((m) => m.key === c), `${r.id}: ${c}`);
  }
});

test('parseGroupBy keeps known dimensions once, in order, and falls back to the default', () => {
  const def = reportById('projectHours');
  assert.deepEqual(parseGroupBy(def, 'month,person,month,salary'), ['month', 'person']);
  assert.deepEqual(parseGroupBy(def, ''), ['project', 'person']);
  assert.deepEqual(parseGroupBy(def, undefined), ['project', 'person']);
});

test('monthsBetween lists months across years and refuses nonsense', () => {
  assert.deepEqual(monthsBetween('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']);
  assert.equal(monthsBetween('2026-03', '2026-01'), null);
  assert.equal(monthsBetween('2026-13', '2026-14'), null);
  assert.equal(monthsBetween('2020-01', '2026-01'), null, 'more than 36 months');
});

test('groupReport sums hours and sorts by name', () => {
  const def = reportById('projectHours');
  const raw = [
    { person: 'u2', personName: 'Ueli', project: 'Web', month: '2026-01', hours: 3 },
    { person: 'u1', personName: 'Anna', project: 'Web', month: '2026-01', hours: 2.5 },
    { person: 'u1', personName: 'Anna', project: 'Web', month: '2026-02', hours: 1 },
  ];
  const out = groupReport(def, raw, ['person'], (d, r) => (d === 'person' ? String(r.personName) : String(r[d])));
  assert.deepEqual(out.rows, [
    { person: 'u1', personName: 'Anna', hours: 3.5 },
    { person: 'u2', personName: 'Ueli', hours: 3 },
  ]);
  assert.deepEqual(out.totals, { hours: 6.5 });
});

test("a balance is each person's last month, summed over people, never added up over months", () => {
  const def = reportById('attendance');
  const m = (person, month, overtimeBalance, worked) => ({ person, personName: person, month, overtimeBalance, worked, target: 0, difference: 0, legalOvertime: 0, vacationDays: 0 });
  const raw = [m('a', '2026-01', 5, 100), m('a', '2026-02', 7, 90), m('b', '2026-01', -2, 80), m('b', '2026-02', -1, 70)];
  const byPerson = groupReport(def, raw, ['person']);
  assert.deepEqual(byPerson.rows.map((r) => [r.person, r.overtimeBalance, r.worked]), [['a', 7, 190], ['b', -1, 150]]);
  const byMonth = groupReport(def, raw, ['month']);
  assert.deepEqual(byMonth.rows.map((r) => [r.month, r.overtimeBalance]), [['2026-01', 3], ['2026-02', 6]]);
  assert.equal(byPerson.totals.overtimeBalance, 6);
  assert.equal(byPerson.totals.worked, 340);
});
