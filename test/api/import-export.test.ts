import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ImportExportService, payrollPersonalien, registerPayrollItem, type PayrollRow, type RawEmployeeImportRow } from '../../apps/api/src/import-export.service';

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

test("payroll details: this organization's import over the account's older one, never another organization's", () => {
  const data = { personalien: { personnelNumber: 'OLD', socialSecurityNumber: 'AHV' }, orgs: { a: { personalien: { personnelNumber: 'A' } }, b: { personalien: { personnelNumber: 'B', firstName: 'Bea' } } } };
  assert.deepEqual(payrollPersonalien(data, 'a'), { personnelNumber: 'A', socialSecurityNumber: 'AHV' });
  assert.deepEqual(payrollPersonalien(data, 'c'), { personnelNumber: 'OLD', socialSecurityNumber: 'AHV' });
  assert.deepEqual(payrollPersonalien(null, 'a'), {});
});

/** Imports one row for a member `u1` who belongs to `otherOrgs` too; returns the result and what was written. */
async function importMember(otherOrgs: string[]) {
  const { getTableName } = require('drizzle-orm');
  const writes: Record<string, any>[] = [];
  const tx: any = {
    select: (columns: Record<string, unknown>) => ({
      from: (table: any) => {
        const name = getTableName(table);
        let rows: unknown[] = [];
        if (name === 'users') rows = [{ id: 'u1', display_name: 'Own Name', basicdata: {} }];
        else if (name === 'organization_memberships') rows = 'organization_id' in columns ? otherOrgs.map((organization_id) => ({ organization_id })) : [{ id: 'm1' }];
        else if (name === 'work_schedules') rows = [{ id: 's1' }];
        return { where: async () => rows };
      },
    }),
    update: () => ({ set: (patch: Record<string, any>) => (writes.push(patch), { where: async () => [] }) }),
  };
  const service = new ImportExportService(dummyBalances, { record: async () => {} } as any);
  (service as any).previewEmployeeImport = async () => ({ results: [{ status: 'update', row: { email: 'u1@example.ch', displayName: 'New Name' } }] });
  return { result: await service.commitEmployeeImport({ transaction: (run: any) => run(tx) } as any, 'org', 'hr', [] as any), writes };
}

test('employee import: renames only who belongs to this organization alone', async () => {
  const alone = await importMember([]);
  assert.deepEqual(alone.writes, [{ display_name: 'New Name' }]);
  assert.equal(alone.result.namesKept, 0);
  const shared = await importMember(['other']);
  assert.deepEqual(shared.writes, [], 'and without columns nothing else is written either');
  assert.equal(shared.result.namesKept, 1);
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

test('payroll counts sickness and accident as sick leave and the types marked unpaid as unpaid', async () => {
  const { payrollMinutes, SICK_LEAVE_TYPES } = await import('../../apps/api/src/import-export.service');
  const { unpaidAbsenceTypes } = await import('../../apps/api/src/absence-types');
  const month = { vacation: 480, sickness: 240, accident: 120, unpaid_leave: 960, own_unpaid: 60, school: 30 };
  assert.equal(payrollMinutes(month, SICK_LEAVE_TYPES), 360);
  const unpaid = unpaidAbsenceTypes({ vacation: {}, sickness: { approval: false }, unpaid_leave: { unpaid: true }, own_unpaid: { unpaid: true }, school: {} });
  assert.deepEqual([...unpaid].sort(), ['own_unpaid', 'unpaid_leave']);
  assert.equal(payrollMinutes(month, unpaid), 1020);
});
