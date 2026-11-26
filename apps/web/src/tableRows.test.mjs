import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { filterRows, fold, nextSort, sortRows } from './tableRows.ts';

const rows = [
  { name: 'Müller Anna', dept: 'HR', days: 12, since: '2024-03-01' },
  { name: 'Ziegler Bea', dept: 'Finance', days: 3, since: null },
  { name: 'Ärni Carl', dept: 'HR', days: 120, since: '2019-11-15' },
  { name: 'Projekt 10', dept: '', days: null, since: '2026-01-05' },
  { name: 'Projekt 2', dept: 'IT', days: 7, since: '2026-01-05' },
];
const cols = [
  { key: 'name', value: (r) => r.name },
  { key: 'dept', value: (r) => r.dept },
  { key: 'days', value: (r) => r.days, search: false },
  { key: 'since', value: (r) => r.since },
];
const names = (list) => list.map((r) => r.name);

test('search: every word, any column, without case or accents', () => {
  assert.equal(fold('Zürich Ärni'), 'zurich arni');
  assert.deepEqual(names(filterRows(rows, 'muller', cols)), ['Müller Anna']);
  assert.deepEqual(names(filterRows(rows, 'hr arni', cols)), ['Ärni Carl']);
  assert.deepEqual(names(filterRows(rows, '  ', cols)), names(rows));
  // A column that is not searched: 120 is no match.
  assert.deepEqual(names(filterRows(rows, '120', cols)), []);
});

test('sort: language order with umlauts, numbers as numbers, dates in order, empty last both ways', () => {
  assert.deepEqual(names(sortRows(rows, { key: 'name', dir: 'asc' }, cols)), ['Ärni Carl', 'Müller Anna', 'Projekt 2', 'Projekt 10', 'Ziegler Bea']);
  assert.deepEqual(names(sortRows(rows, { key: 'days', dir: 'desc' }, cols)), ['Ärni Carl', 'Müller Anna', 'Projekt 2', 'Ziegler Bea', 'Projekt 10']);
  assert.deepEqual(names(sortRows(rows, { key: 'days', dir: 'asc' }, cols)), ['Ziegler Bea', 'Projekt 2', 'Müller Anna', 'Ärni Carl', 'Projekt 10']);
  // Equal dates keep the rows' order; the empty date is last.
  assert.deepEqual(names(sortRows(rows, { key: 'since', dir: 'asc' }, cols)), ['Ärni Carl', 'Müller Anna', 'Projekt 10', 'Projekt 2', 'Ziegler Bea']);
  assert.deepEqual(names(sortRows(rows, null, cols)), names(rows));
  assert.deepEqual(names(sortRows(rows, { key: 'gone', dir: 'asc' }, cols)), names(rows));
});

test('a head click: ascending, descending, then the table\'s own order', () => {
  assert.deepEqual(nextSort(null, 'name'), { key: 'name', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'name', dir: 'asc' }, 'name'), { key: 'name', dir: 'desc' });
  assert.equal(nextSort({ key: 'name', dir: 'desc' }, 'name'), null);
  assert.deepEqual(nextSort({ key: 'name', dir: 'desc' }, 'days'), { key: 'days', dir: 'asc' });
});
