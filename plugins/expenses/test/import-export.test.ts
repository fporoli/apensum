import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTableName } from 'drizzle-orm';
import { EXPENSES_BACKUP, EXPENSES_PAYROLL } from '../api/import-export';

test('expenses on the payroll export: Abacus wage type 3000 and the columns the formats had before', () => {
  assert.equal(EXPENSES_PAYROLL.key, 'expenses');
  assert.deepEqual(EXPENSES_PAYROLL.abacus, { wageType: '3000', label: 'Spesenverguetung', unit: 'Pauschal' });
  assert.deepEqual(EXPENSES_PAYROLL.columns, { bexio: 'Spesen_Betrag', csv: 'Spesen_CHF', xlsx: 'Spesen (CHF)' });
});

test('restore maps users and projects to their new ids, skips unknown people and keeps the booked rates', async () => {
  const inserted: Array<{ table: string; values: Record<string, unknown> }> = [];
  const db = {
    insert: (table: never) => ({
      values: (values: Record<string, unknown>) => {
        inserted.push({ table: getTableName(table), values });
        const done = Promise.resolve();
        return { onConflictDoUpdate: () => done, onConflictDoNothing: () => done };
      },
    }),
  };
  const files: Record<string, unknown[]> = {
    'expenses.json': [
      { id: 'e1', user_id: 'old-u', project_id: 'old-p', expense_date: '2026-11-03', category: 'travel', value: '12.5', currency: 'CHF', exchange_rate: '0.95', unit_rate: null },
      { id: 'e2', user_id: 'gone', expense_date: '2026-11-04', category: 'meals', value: '3', currency: 'CHF' },
    ],
    'expense_reports.json': [{ id: 'r1', user_id: 'old-u', status: 'approved', reviewed_by_user_id: 'old-u' }],
    'expense_report_items.json': [{ id: 'i1', expense_report_id: 'r1', expense_id: 'e1' }],
    'exchange_rates.json': [{ id: 'x', currency: 'EUR', target_currency: 'CHF', valid_from: '2026-01-01', rate: '0.95' }],
  };
  const restored = await EXPENSES_BACKUP.restore(db as never, {
    targetOrgId: 'org',
    read: (file) => (files[file] ?? []) as never[],
    userIds: new Map([['old-u', 'new-u']]),
    projectIds: new Map([['old-p', 'new-p']]),
    subprojectIds: new Map(),
  });
  assert.deepEqual(restored, { expenses: 1 });
  assert.deepEqual(inserted.map((i) => i.table), ['expenses', 'expense_reports', 'expense_report_items', 'exchange_rates']);
  const exp = inserted[0].values;
  assert.equal(exp.user_id, 'new-u');
  assert.equal(exp.project_id, 'new-p');
  assert.equal(exp.organization_id, 'org');
  assert.equal(exp.exchange_rate, '0.95');
  assert.equal(inserted[1].values.reviewed_by_user_id, 'new-u');
  assert.deepEqual(inserted[3].values, { organization_id: 'org', currency: 'EUR', target_currency: 'CHF', valid_from: '2026-01-01', rate: '0.95' });
});
