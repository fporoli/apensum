import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleTo } from '../../apps/api/src/saved-reports.controller';
import { layoutColumns, renderReportPdf, sanitizeReportPdf } from '../../apps/api/src/report-pdf';

test('a saved report is visible to its owner and to holders of a role it is shared with', () => {
  const row = { owner_user_id: 'u1', shared_roles: ['hr', 'manager'] };
  assert.equal(visibleTo(row, 'u1', []), true);
  assert.equal(visibleTo(row, 'u2', ['member', 'manager']), true);
  assert.equal(visibleTo(row, 'u2', ['member']), false);
  assert.equal(visibleTo({ owner_user_id: 'u1', shared_roles: [] }, 'u2', ['admin']), false, 'admin sees no private report');
});

const table = {
  title: 'Projektstunden',
  subtitle: 'Jan. 2026 – Nov. 2026',
  footer: 'Apensum · erstellt am 17.11.2026, 10:00',
  columns: [{ header: 'Projekt', align: 'left' }, { header: 'Stunden', align: 'right' }],
  rows: [['Web', "1'234.50"], ['App', '2.00']],
  totals: ['Total', "1'236.50"],
};

test('sanitizeReportPdf accepts a table and refuses wrong shapes', () => {
  const ok = sanitizeReportPdf(table);
  assert.ok(ok);
  assert.equal(ok.columns[1].align, 'right');
  assert.deepEqual(ok.totals, ['Total', "1'236.50"]);
  assert.equal(sanitizeReportPdf({ ...table, title: '' }), null);
  assert.equal(sanitizeReportPdf({ ...table, columns: [] }), null);
  assert.equal(sanitizeReportPdf({ ...table, rows: [['a', 'b', 'c']] }), null, 'more cells than columns');
  assert.equal(sanitizeReportPdf({ ...table, rows: [[{}, 'x']] }), null);
  assert.equal(sanitizeReportPdf({ ...table, rows: Array.from({ length: 5001 }, () => ['a', '1']) }), null);
  assert.equal(sanitizeReportPdf('nope'), null);
});

test('layoutColumns gives text twice the room of numbers and fills the width', () => {
  const cols = layoutColumns([{ header: 'A', align: 'left' }, { header: 'B', align: 'right' }, { header: 'C', align: 'right' }], 400);
  assert.deepEqual(cols.map((c) => c.width), [200, 100, 100]);
});

test('renderReportPdf writes a PDF, landscape for wide tables', async () => {
  const pdf = await renderReportPdf(sanitizeReportPdf(table)!);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const wide = sanitizeReportPdf({ ...table, columns: Array.from({ length: 6 }, (_, i) => ({ header: `C${i}`, align: 'left' })), rows: [], totals: null })!;
  const text = (await renderReportPdf(wide)).toString('latin1');
  assert.match(text, /\/MediaBox \[0 0 841\.89 595\.28\]/);
});
