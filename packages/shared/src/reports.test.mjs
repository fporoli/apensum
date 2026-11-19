import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORTS, groupReport, monthEnd, monthsBetween, parseGroupBy, reportById, sanitizeSavedSettings } from './reports.ts';
import { PERMISSION_OBJECTS } from './permissions.ts';

test('every report reads through a page that exists, and groups only by its own dimensions', () => {
  // The expenses report reads the expenses plugin's page (plugins/expenses, its manifest's permissions).
  const nav = new Set([...PERMISSION_OBJECTS.map((o) => o.id), 'nav.expenses']);
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

test('expenses always keep the currency and never add up amounts in different currencies', () => {
  const def = reportById('expenses');
  assert.deepEqual(parseGroupBy(def, 'person'), ['person', 'currency']);
  const raw = [
    { person: 'u1', personName: 'Anna', category: 'travel', currency: 'CHF', amount: 10, count: 1 },
    { person: 'u1', personName: 'Anna', category: 'travel', currency: 'EUR', amount: 5, count: 1 },
    { person: 'u2', personName: 'Ueli', category: 'meals', currency: 'CHF', amount: 2.5, count: 1 },
  ];
  const out = groupReport(def, raw, ['category', 'currency']);
  assert.deepEqual(out.rows.map((r) => [r.category, r.currency, r.amount, r.count]), [
    ['meals', 'CHF', 2.5, 1],
    ['travel', 'CHF', 10, 1],
    ['travel', 'EUR', 5, 1],
  ]);
  assert.deepEqual(out.totals, { count: 3 }, 'no amount total across CHF and EUR');
  assert.deepEqual(groupReport(def, raw.filter((r) => r.currency === 'CHF'), ['currency']).totals, { amount: 12.5, count: 2 });
});

test('people rows carry the start date when grouped by person', () => {
  const def = reportById('people');
  const raw = [{ person: 'u1', personName: 'Anna', department: 'IT', function: 'Dev', manager: 'Bea', startDate: '2024-03-01', headcount: 1, fte: 0.8 }];
  assert.deepEqual(groupReport(def, raw, ['department', 'person']).rows, [{ department: 'IT', person: 'u1', personName: 'Anna', startDate: '2024-03-01', headcount: 1, fte: 0.8 }]);
  assert.deepEqual(groupReport(def, raw, ['department']).rows, [{ department: 'IT', headcount: 1, fte: 0.8 }]);
});

test('monthEnd knows leap years', () => {
  assert.equal(monthEnd('2028-02'), '2028-02-29');
  assert.equal(monthEnd('2026-02'), '2026-02-28');
  assert.equal(monthEnd('2026-12'), '2026-12-31');
});

test('sanitizeSavedSettings keeps valid choices only', () => {
  const def = reportById('projectHours');
  const id = '0b7c6f0e-1d2a-4c3b-9e8f-112233445566';
  assert.deepEqual(sanitizeSavedSettings(def, { preset: 'lastMonth', groupBy: ['month', 'x'], projectId: id, extra: 1 }), { preset: 'lastMonth', groupBy: ['month'], projectId: id });
  assert.deepEqual(sanitizeSavedSettings(def, { preset: 'custom', from: '2026-01', to: '2026-03', groupBy: [] }), { preset: 'custom', from: '2026-01', to: '2026-03', groupBy: ['project', 'person'] });
  assert.equal(sanitizeSavedSettings(def, { preset: 'custom', from: '2026-05', to: '2026-03' }), null);
  assert.equal(sanitizeSavedSettings(def, { preset: 'someday' }), null);
  assert.equal(sanitizeSavedSettings(def, { preset: 'thisYear', userId: 'robert' }), null);
});
