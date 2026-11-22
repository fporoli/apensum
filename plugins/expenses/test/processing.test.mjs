import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processingCsvRows, processingLines, processingText, processingTotals } from '../shared/processing.ts';

const items = [
  { costCenter: 'KST-200', currency: 'CHF', value: 12.5 },
  { costCenter: 'KST-100', currency: 'CHF', value: 40.1 },
  { costCenter: 'KST-200', currency: 'CHF', value: 7.45 },
  { costCenter: 'KST-200', currency: 'EUR', value: 30 },
  { costCenter: null, currency: 'CHF', value: 5 },
];

test('a report is summed per cost centre and currency, never across currencies', () => {
  assert.deepEqual(processingLines(items), [
    { costCenter: null, currency: 'CHF', amount: 5, entries: 1 },
    { costCenter: 'KST-100', currency: 'CHF', amount: 40.1, entries: 1 },
    { costCenter: 'KST-200', currency: 'CHF', amount: 19.95, entries: 2 },
    { costCenter: 'KST-200', currency: 'EUR', amount: 30, entries: 1 },
  ]);
});

const reports = [
  { id: 'r1', status: 'approved', dateSubmitted: '2026-11-17 09:00:00+00', userId: 'u1', name: 'Marta', personnelNumber: '1002', workflowId: 'wf-1', lines: processingLines(items.slice(0, 3)) },
  { id: 'r2', status: 'approved', dateSubmitted: null, userId: 'u2', name: 'Ueli', personnelNumber: '', workflowId: null, lines: processingLines(items.slice(3)) },
];

test('totals per currency over the selection', () => {
  assert.deepEqual(processingTotals(reports), [{ currency: 'CHF', amount: 65.05 }, { currency: 'EUR', amount: 30 }]);
});

test('the text for accounting: title, header, a row per report and cost centre, totals', () => {
  const labels = { title: 'T', name: 'N', personnelNumber: 'P', costCenter: 'K', amount: 'B', submitted: 'E', workflowId: 'W', total: 'Total' };
  const text = processingText(reports, labels, { money: (n) => n.toFixed(2), date: (d) => d.split('-').reverse().join('.') });
  assert.equal(text, [
    'T', '',
    'N\tP\tK\tB\tE\tW',
    'Marta\t1002\tKST-100\tCHF 40.10\t17.11.2026\twf-1',
    'Marta\t1002\tKST-200\tCHF 19.95\t17.11.2026\twf-1',
    'Ueli\t—\t—\tCHF 5.00\t—\t—',
    'Ueli\t—\tKST-200\tEUR 30.00\t—\t—',
    '',
    'Total CHF 65.05',
    'Total EUR 30.00',
  ].join('\n'));
  assert.deepEqual(processingCsvRows(reports)[0], ['Marta', '1002', 'KST-100', 'CHF', 40.1, '2026-11-17', 'wf-1']);
});
