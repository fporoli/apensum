import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXPENSES_PAYROLL } from '../api/import-export';

test('expenses on the payroll export: Abacus wage type 3000 and the columns the formats had before', () => {
  assert.equal(EXPENSES_PAYROLL.key, 'expenses');
  assert.deepEqual(EXPENSES_PAYROLL.abacus, { wageType: '3000', label: 'Spesenverguetung', unit: 'Pauschal' });
  assert.deepEqual(EXPENSES_PAYROLL.columns, { bexio: 'Spesen_Betrag', csv: 'Spesen_CHF', xlsx: 'Spesen (CHF)' });
});
