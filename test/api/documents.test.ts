import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hm, pdfFileName, pdfLang, renderProjectReportPdf, renderTimesheetPdf } from '../../apps/api/src/timesheet-documents.service';
import { DocumentsController, mergeDocuments } from '../../apps/api/src/documents.controller';

test('hm formats signed hours and minutes', () => {
  assert.equal(hm(0), '0:00');
  assert.equal(hm(485), '8:05');
  assert.equal(hm(-42), '-0:42');
  assert.equal(hm(8160), '136:00');
});

test('pdfLang falls back to English', () => {
  assert.equal(pdfLang('de-CH'), 'de');
  assert.equal(pdfLang('it'), 'it');
  assert.equal(pdfLang('es'), 'en');
  assert.equal(pdfLang(null), 'en');
});

test('pdfFileName names the month', () => {
  assert.equal(pdfFileName('timesheet', '2026-10-01'), 'timesheet-2026-10.pdf');
  assert.equal(pdfFileName('project_timesheet', '2026-10-01'), 'project-report-2026-10.pdf');
});

const approval = { approvedBy: 'Adam A', approvedAt: '2026-11-03T08:10:00Z', submittedAt: '2026-11-01T16:30:00Z', autoApproved: false, timeZone: 'Europe/Zurich' };

test('renderTimesheetPdf produces a PDF', async () => {
  const pdf = await renderTimesheetPdf(
    {
      organization: 'Acme',
      person: 'Marta Müller',
      periodStart: '2026-10-01',
      ...approval,
      days: [
        { date: '2026-10-01', target: 480, actual: 438 },
        { date: '2026-10-26', target: 0, actual: 0, absence: 'Vacation' },
      ],
      totals: { scheduled: 960, holiday: 0, absenceByType: { vacation: 480 }, target: 480, actual: 438, delta: -42, vacationDays: 1 },
    },
    'de',
  );
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  // One page: the footer must not push onto extra pages.
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 1);
});

test('renderProjectReportPdf puts every project of the month in one PDF', async () => {
  const entry = (day: string, minutes: number) => ({ start: `2026-10-${day}T08:00:00Z`, end: `2026-10-${day}T10:30:00Z`, minutes, subproject: null, comment: 'Work' });
  const pdf = await renderProjectReportPdf(
    {
      organization: 'Acme',
      person: 'Marta',
      periodStart: '2026-10-01',
      timeZone: 'Europe/Zurich',
      projects: [
        { project: 'Website', owner: 'Alice', status: 'approved', approvedBy: 'Alice', approvedAt: '2026-11-04T10:00:00Z', submittedAt: '2026-11-01T16:35:00Z', autoApproved: false, entries: [entry('06', 150), entry('12', 150)] },
        { project: 'Intranet', owner: 'Adam', status: 'submitted', approvedBy: null, approvedAt: null, submittedAt: '2026-11-01T16:35:00Z', autoApproved: false, entries: [entry('07', 150)] },
        { project: null, owner: null, status: 'open', approvedBy: null, approvedAt: null, submittedAt: null, autoApproved: false, entries: [entry('08', 30)] },
      ],
    },
    'fr',
  );
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length, 1);
});

test('documents list and downloads need nav.documents', async () => {
  // A db whose permission query returns nothing: the caller holds no grants.
  const db = {
    execute: async () => ({ rows: [] }),
    select: () => ({ from: () => ({ where: async () => [{ id: 'u1' }], innerJoin: () => ({ where: async () => [{ id: 'm1' }] }) }) }),
  };
  const ctrl = new DocumentsController({ getDb: () => db } as never, {} as never, {} as never);
  const res = await ctrl.list('org', { user: { sub: 'u1' } } as never);
  assert.equal(res.ok, false);
  assert.deepEqual(res.documents, []);
});

test("mergeDocuments puts a plugin's documents into the core's list by date, then time added, then name", () => {
  const doc = (documentId: string, date: string, addedAt: string, fileName = documentId) =>
    ({ documentId, category: 'x', sourceId: documentId, fileName, mimeType: 'application/pdf', sizeBytes: 1, date, addedAt, superseded: false, context: {} });
  const core = [doc('c1', '2026-11-01', '2026-11-02T10:00:00Z'), doc('c2', '2026-10-01', '2026-10-05T10:00:00Z'), doc('c3', '2026-09-01', '2026-09-02T10:00:00Z')];
  const added = [doc('p3', '2026-08-01', '2026-08-01T00:00:00Z'), doc('p1', '2026-12-01', '2026-12-01T00:00:00Z'), doc('p2', '2026-10-01', '2026-10-06T00:00:00Z'), doc('p4', '2026-10-01', '2026-10-05T10:00:00Z', 'a')];
  assert.deepEqual(mergeDocuments(core, added).map((d) => d.documentId), ['p1', 'c1', 'p2', 'p4', 'c2', 'c3', 'p3']);
  assert.deepEqual(mergeDocuments(core, []).map((d) => d.documentId), ['c1', 'c2', 'c3']);
});
