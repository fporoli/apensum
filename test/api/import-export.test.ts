import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportExportService, registerPayrollItem, type PayrollRow, type RawEmployeeImportRow } from '../../apps/api/src/import-export.service';

// A plugin's payroll item, as the expenses plugin registers it (plugins/expenses/api/import-export.ts).
registerPayrollItem({
  key: 'expenses',
  caption: 'importExport.payroll.colExpenses',
  abacus: { wageType: '3000', label: 'Spesenverguetung', unit: 'Pauschal' },
  columns: { bexio: 'Spesen_Betrag', csv: 'Spesen_CHF', xlsx: 'Spesen (CHF)' },
  amounts: async () => new Map(),
});

const dummyBalances = {} as any;
const dummyAudit = {} as any;
const svc = new ImportExportService(dummyBalances, dummyAudit);

const sampleRows: PayrollRow[] = [
  {
    userId: 'u1',
    email: 'marta@acme.com',
    displayName: 'Marta Muster',
    name: 'Marta Muster',
    firstName: 'Marta',
    lastName: 'Muster',
    personnelNumber: '101',
    socialSecurityNumber: '756.1234.5678.90',
    department: 'Engineering',
    departmentName: 'Engineering',
    jobFunction: 'Developer',
    month: '2026-11',
    workloadPercent: 100,
    targetMinutes: 10080,
    actualMinutes: 10530,
    deltaMinutes: 450,
    overtimeBalanceMinutes: 1440,
    adjustmentMinutes: -300,
    legalOvertimeMinutes: 150,
    targetHours: 168.0,
    actualHours: 175.5,
    deltaHours: 7.5,
    overtimeBalanceHours: 24.0,
    overtimePayoutHours: 5.0,
    legalOvertimeHours: 2.5,
    vacationDaysTaken: 1.0,
    unpaidLeaveHours: 0,
    sickLeaveHours: 0,
    items: { expenses: { amount: 42.5, currency: 'CHF' } },
  },
];

test('formatAbacusCsv generates semicolon CSV with wage types', () => {
  const csv = svc.formatAbacusCsv('2026-11', sampleRows);
  assert.ok(csv.includes('Personalnummer;Name;Periode;Lohnart'));
  assert.ok(csv.includes('101;Marta Muster;202611;1000;Normalarbeitszeit;175.5;Std;;;Engineering'));
  assert.ok(csv.includes('101;Marta Muster;202611;1200;Ueberstunden Auszahlung;5;Std;;;Engineering'));
  assert.ok(csv.includes('101;Marta Muster;202611;1250;Ueberzeit (Art. 13 ArG);2.5;Std;;;Engineering'));
  assert.ok(csv.includes('101;Marta Muster;202611;3000;Spesenverguetung;1;Pauschal;;42.5;Engineering'));
});

test('formatBexioCsv generates Bexio summary format', () => {
  const csv = svc.formatBexioCsv('2026-11', sampleRows);
  assert.ok(csv.includes('Mitarbeiter_Email;Name;Periode;Sollstunden;Iststunden;Gleitzeit_Saldo;Ueberstunden_Auszahlung;Ferientage_Bezogen;Spesen_Betrag;Abteilung'));
  assert.ok(csv.includes('marta@acme.com;Marta Muster;2026-11;168;175.5;24;5;1;42.5;Engineering'));
});

test('formatGenericCsv generates comprehensive payroll summary', () => {
  const csv = svc.formatGenericCsv('2026-11', sampleRows);
  assert.ok(csv.includes('Personalnummer;Name;Email;Abteilung'));
  assert.ok(csv.includes('101;Marta Muster;marta@acme.com;Engineering;Developer;2026-11'));
  assert.ok(csv.split('\n')[0].trim().endsWith('Krankheit_Std;Spesen_CHF'));
  assert.ok(csv.split('\n')[1].trim().endsWith(';0;0;42.5'));
});

test('previewEmployeeImport identifies invalid emails and dates', async () => {
  const chain: any = Promise.resolve([]);
  chain.where = () => Promise.resolve([]);
  chain.innerJoin = () => chain;

  const fakeDb: any = {
    select: () => ({
      from: () => chain,
    }),
  };

  const raw: RawEmployeeImportRow[] = [
    { email: 'bad-email', displayName: 'Invalid' },
    { email: 'good@test.com', displayName: 'Valid Person', startDate: 'not-a-date' },
  ];

  const preview = await svc.previewEmployeeImport(fakeDb, 'org-1', raw);
  assert.equal(preview.summary.total, 2);
  assert.equal(preview.summary.errorCount, 2);
  assert.ok(preview.results[0].errors.includes('invalid-email'));
  assert.ok(preview.results[1].errors.includes('invalid-start-date'));
});

test('readZipArchive and zipStored roundtrip preserves files', () => {
  const { zipStored } = require('../../packages/shared/dist/xlsx.js');
  const filesIn = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ version: 1, name: 'test' })) },
    { name: 'documents/doc1_sample.pdf', data: Buffer.from('%PDF-1.4 test document content') },
  ];
  const zipBytes = zipStored(filesIn);
  const extracted = svc.readZipArchive(Buffer.from(zipBytes));

  assert.equal(extracted.length, 2);
  assert.equal(extracted[0].name, 'manifest.json');
  assert.ok(extracted[0].data.toString('utf8').includes('"version":1'));
  assert.equal(extracted[1].name, 'documents/doc1_sample.pdf');
  assert.ok(extracted[1].data.toString('utf8').includes('%PDF-1.4'));
});

test('previewOrganizationBackup validates archive and manifest', async () => {
  const { zipStored } = require('../../packages/shared/dist/xlsx.js');

  const fakeDb: any = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([{ id: 'org-1', name: 'Acme Corp', slug: 'acme' }]),
      }),
    }),
  };

  // 1. Invalid buffer
  const invalidRes = await svc.previewOrganizationBackup(fakeDb, 'org-1', Buffer.from('not a zip'));
  assert.equal(invalidRes.ok, false);
  assert.equal(invalidRes.error, 'invalid-zip-archive');

  // 2. Missing manifest
  const emptyZip = zipStored([{ name: 'empty.txt', data: Buffer.from('hello') }]);
  const noManifestRes = await svc.previewOrganizationBackup(fakeDb, 'org-1', Buffer.from(emptyZip));
  assert.equal(noManifestRes.ok, false);
  assert.equal(noManifestRes.error, 'manifest-not-found');

  // 3. Valid archive
  const validZip = zipStored([
    {
      name: 'manifest.json',
      data: Buffer.from(
        JSON.stringify({
          version: 1,
          createdAt: '2026-11-18T00:00:00Z',
          organization: { id: 'org-1', name: 'Acme Corp', slug: 'acme' },
          counts: { users: 3, workTimes: 120, absences: 4 },
        }),
      ),
    },
    { name: 'documents/doc1_contract.pdf', data: Buffer.from('contract bytes') },
  ]);

  const validRes = await svc.previewOrganizationBackup(fakeDb, 'org-1', Buffer.from(validZip));
  assert.equal(validRes.ok, true);
  assert.equal(validRes.manifest?.counts?.users, 3);
  assert.equal(validRes.manifest?.documentCount, 1);
  assert.equal(validRes.compatibility?.isSameOrg, true);
});

test('exportOrganizationBackup packages tables, documents and manifest', async () => {
  const dummyDocService: any = {
    read: async () => Buffer.from('decrypted file content'),
  };
  const auditRecorded: any[] = [];
  const mockAudit: any = {
    record: async (...args: any[]) => {
      auditRecorded.push(args);
    },
  };

  const svcWithDocs = new ImportExportService(dummyBalances, mockAudit, dummyDocService);

  const { getTableName } = require('drizzle-orm');
  const mockDb: any = {
    select: () => ({
      from: (tbl: any) => ({
        where: () => {
          const tName = getTableName(tbl);
          if (tName === 'organizations') {
            return Promise.resolve([{ id: 'org-1', name: 'Acme Corp', slug: 'acme' }]);
          }
          if (tName === 'documents') {
            return Promise.resolve([
              { id: 'doc-1', file_name: 'receipt.pdf', mime_type: 'application/pdf', size_bytes: 22 },
            ]);
          }
          return Promise.resolve([]);
        },
      }),
    }),
  };

  const result = await svcWithDocs.exportOrganizationBackup(mockDb, 'org-1', 'caller-1');
  assert.ok(result.filename.startsWith('backup_acme_'));
  assert.ok(result.filename.endsWith('.zip'));
  assert.ok(result.buffer.length > 0);

  const entries = svcWithDocs.readZipArchive(result.buffer);
  assert.ok(entries.some((e) => e.name === 'manifest.json'));
  assert.ok(entries.some((e) => e.name === 'database/organization.json'));
  assert.ok(entries.some((e) => e.name.startsWith('documents/doc-1_receipt.pdf')));
  assert.equal(auditRecorded.length, 1);
});

test('restoreOrganizationBackup processes zip entries and restores database records', async () => {
  const { zipStored } = require('../../packages/shared/dist/xlsx.js');
  const { getTableName } = require('drizzle-orm');

  const zipBuffer = Buffer.from(
    zipStored([
      {
        name: 'manifest.json',
        data: Buffer.from(
          JSON.stringify({
            version: 1,
            organization: { id: 'org-source', name: 'Source Org' },
            counts: { users: 1, departments: 1 },
          }),
        ),
      },
      {
        name: 'database/users.json',
        data: Buffer.from(JSON.stringify([{ id: 'u-1', email: 'restored@example.ch', display_name: 'Restored User' }])),
      },
      {
        name: 'database/departments.json',
        data: Buffer.from(JSON.stringify([{ id: 'd-1', name: 'Product Management' }])),
      },
    ]),
  );

  const mockDb: any = {
    select: () => ({
      from: (tbl: any) => ({
        where: () => {
          const tName = getTableName(tbl);
          if (tName === 'organizations') {
            return Promise.resolve([{ id: 'org-target', name: 'Target Org', slug: 'target' }]);
          }
          return Promise.resolve([]);
        },
      }),
    }),
    insert: (tbl: any) => ({
      values: (val: any) => ({
        returning: () => {
          const id = val.id || 'gen-id-1';
          return Promise.resolve([{ id, ...val }]);
        },
        onConflictDoUpdate: () => ({
          returning: () => Promise.resolve([{ id: val.id || 'gen-id-1', ...val }]),
        }),
        onConflictDoNothing: () => Promise.resolve([]),
      }),
    }),
  };

  const auditLogs: any[] = [];
  const mockAudit: any = {
    record: async (...args: any[]) => auditLogs.push(args),
  };

  const restoreSvc = new ImportExportService(dummyBalances, mockAudit);
  const result = await restoreSvc.restoreOrganizationBackup(mockDb, 'org-target', 'caller-1', zipBuffer);

  assert.equal(result.ok, true);
  assert.equal(result.restored?.users, 1);
  assert.equal(result.restored?.departments, 1);
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0][2], 'organization.backup_restored');
});

test('payroll: the latest assignment per person wins, whatever order the rows come in', async () => {
  const { latestAssignmentPerUser } = await import('../../apps/api/src/import-export.service');
  const rows = [
    { userId: 'u1', validFrom: '2026-01-01', departmentId: 'old' },
    { userId: 'u2', validFrom: '2025-05-01', departmentId: 'only' },
    { userId: 'u1', validFrom: '2026-09-01', departmentId: 'new' },
    { userId: 'u1', validFrom: '2025-03-01', departmentId: 'older' },
  ];
  const latest = latestAssignmentPerUser(rows);
  assert.equal(latest.get('u1')?.departmentId, 'new');
  assert.equal(latest.get('u2')?.departmentId, 'only');
  assert.equal(latestAssignmentPerUser([...rows].reverse()).get('u1')?.departmentId, 'new');
});
