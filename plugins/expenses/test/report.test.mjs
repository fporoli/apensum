import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPORTS, groupReport, parseGroupBy, registerReport, reportById } from '../../../packages/shared/src/reports.ts';
import { REPORT_TEXTS, registerAvailablePluginTexts } from '../../../packages/shared/src/reportTexts.ts';
import { labelFor, textsOf } from '../../../packages/shared/src/reportTable.ts';
import { EXPENSES_REPORT } from '../shared/report.ts';

const { definition: def, texts } = EXPENSES_REPORT;

test('the report registers beside the core reports, with texts in every language', () => {
  registerReport(def);
  registerAvailablePluginTexts(texts);
  assert.equal(reportById('expenses'), def);
  assert.equal(REPORTS.filter((r) => r.id === 'expenses').length, 1);
  const keys = Object.keys(texts.en).sort();
  for (const lang of ['de', 'fr', 'it']) assert.deepEqual(Object.keys(texts[lang]).sort(), keys, lang);
  for (const lang of ['en', 'de', 'fr', 'it']) {
    const all = REPORT_TEXTS[lang];
    for (const k of [`reports.report.${def.id}`, `reports.report.${def.id}.description`, `reports.note.${def.id}`]) assert.ok(all[k], `${lang}: ${k}`);
    for (const d of def.dimensions.filter((d) => d !== 'person' && d !== 'month' && d !== 'project')) assert.ok(all[`reports.dim.${d}`], `${lang}: dim ${d}`);
    for (const m of def.measures) assert.ok(all[`reports.measure.${m.key}`], `${lang}: measure ${m.key}`);
  }
});

test('status and mileage read as texts; categories as static data', () => {
  const t = textsOf(REPORT_TEXTS.de);
  const label = labelFor(def, 'de', t, { static: { category: { translation: { de: { travel: 'Reisen' } } } } });
  assert.equal(label('status', { status: 'approved' }), 'Genehmigt');
  assert.equal(label('status', { status: 'none' }), texts.de['reports.expenseStatus.none']);
  assert.equal(label('category', { category: 'travel' }), 'Reisen');
  assert.equal(label('category', { category: 'mileage' }), 'Kilometer');
  for (const s of ['in_preparation', 'submitted', 'approved', 'rejected', 'submitted_processing', 'processing_finished', 'request_payment', 'finished', 'none']) {
    assert.ok(texts.en[`reports.expenseStatus.${s}`], s);
  }
});

test('expenses always keep the currency and never add up amounts in different currencies', () => {
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
});
