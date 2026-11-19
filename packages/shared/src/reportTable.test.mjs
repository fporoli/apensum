import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReportTable, labelFor, periodText, presetRange, sortRows, textsOf } from './reportTable.ts';
import { registerReport, reportById } from './reports.ts';
import { REPORT_TEXTS } from './reportTexts.ts';

// A report as a plugin registers one (plugins/expenses/shared/report.ts is the real one): money in
// several currencies, labels from static data and from texts.
const MONEY = {
  id: 'testMoney',
  object: 'nav.time',
  dimensions: ['person', 'category', 'status', 'currency'],
  defaultGroupBy: ['category'],
  alwaysGroupBy: ['currency'],
  measures: [{ key: 'amount', kind: 'money', aggregate: 'sum' }, { key: 'count', kind: 'count', aggregate: 'sum' }],
  chart: ['amount'],
  labels: {
    category: { staticData: { entity: 'test', enum: 'test_category' }, fallback: { mileage: 'reports.noProject' } },
    status: { textPrefix: 'reports.period.' },
  },
};
registerReport(MONEY);

const sources = {
  static: {
    type: { translation: { de: { vacation: 'Ferien' }, en: { vacation: 'Vacation' } } },
    category: { translation: { de: { travel: 'Reisen' } }, values: { travel: 'Travel', meals: 'Meals' } },
  },
};

test('presetRange takes a yyyy-mm-dd day too (scheduled runs use the day in the schedule zone)', () => {
  assert.deepEqual(presetRange('lastMonth', '2026-12-01'), ['2026-11', '2026-11']);
  assert.deepEqual(presetRange('lastMonth', '2027-01-01'), ['2026-12', '2026-12']);
  assert.deepEqual(presetRange('lastQuarter', '2026-11-17'), ['2026-07', '2026-09']);
  assert.deepEqual(presetRange('thisYear', '2026-11-17'), ['2026-01', '2026-11']);
});

test('labels come from static data in the language, with the texts for the rest', () => {
  const t = textsOf(REPORT_TEXTS.de);
  assert.equal(labelFor(reportById('absences'), 'de', t, sources)('type', { type: 'vacation' }), 'Ferien');
  assert.equal(labelFor(reportById('workingTimeAct'), 'de', t, sources)('check', { check: 'night' }), REPORT_TEXTS.de['reports.check.night']);
  const label = labelFor(MONEY, 'de', t, sources);
  assert.equal(label('category', { category: 'travel' }), 'Reisen');
  assert.equal(label('category', { category: 'meals' }), 'Meals', 'falls back to the plain value');
  assert.equal(label('category', { category: 'mileage' }), REPORT_TEXTS.de['reports.noProject'], 'the fallback text');
  assert.equal(label('category', { category: 'other' }), 'other');
  assert.equal(label('status', { status: 'lastMonth' }), REPORT_TEXTS.de['reports.period.lastMonth']);
  assert.equal(label('project', { project: '' }), REPORT_TEXTS.de['reports.noProject']);
  assert.equal(label('person', { person: 'u1', personName: 'Anna' }), 'Anna');
  assert.equal(labelFor({}, 'de', t, sources)('category', { category: 'travel' }), 'travel', 'no labels: the value');
});

test('buildReportTable: header, Swiss numbers, totals; detail columns per person', () => {
  const def = reportById('people');
  const t = textsOf(REPORT_TEXTS.de);
  const label = labelFor(def, 'de', t, sources);
  const rows = [{ department: 'IT', person: 'u1', personName: 'Anna', startDate: '2024-03-01', headcount: 1, fte: 0.8 }];
  const table = buildReportTable(def, { groupBy: ['department', 'person'], rows, totals: { headcount: 1, fte: 0.8 } }, 'de', t, label);
  assert.deepEqual(table.columns.map((c) => c.header), ['Abteilung', 'Person', 'Eintrittsdatum', 'Personen', 'VZÄ']);
  assert.deepEqual(table.text, [['IT', 'Anna', '1.3.2024', '1', '0.80']]);
  assert.deepEqual(table.totalText, ['Total', '', '', '1', '0.80']);
  assert.deepEqual(table.cells, [['IT', 'Anna', '1.3.2024', 1, 0.8]]);
});

test('money without a total shows a dash; rows sort by label, months in order', () => {
  const def = MONEY;
  const t = textsOf(REPORT_TEXTS.en);
  const label = labelFor(def, 'en', t, sources);
  const rows = sortRows([{ category: 'travel', currency: 'CHF', amount: 1, count: 1 }, { category: 'meals', currency: 'EUR', amount: 2, count: 1 }], ['category', 'currency'], label, 'en');
  assert.deepEqual(rows.map((r) => r.category), ['meals', 'travel']);
  const table = buildReportTable(def, { groupBy: ['category', 'currency'], rows, totals: { count: 2 } }, 'en', t, label);
  assert.deepEqual(table.totalText, ['Total', '', '–', '2']);
  assert.deepEqual(table.totalCells, ['Total', null, null, 2]);
});

test('periodText: months, or "as at" for the people snapshot', () => {
  const t = textsOf(REPORT_TEXTS.de);
  assert.match(periodText(reportById('projectHours'), '2026-01', '2026-03', 'de', t, '2026-11-17'), /2026 – .*2026/);
  assert.equal(periodText(reportById('people'), '2026-10', '2026-10', 'de', t, '2026-11-17'), 'Stand 31.10.2026');
  assert.equal(periodText(reportById('people'), '2026-11', '2026-11', 'de', t, '2026-11-17'), 'Stand 17.11.2026');
});
