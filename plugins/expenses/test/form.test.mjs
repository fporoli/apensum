import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORMS, formDefinitionProblems, registerForm } from '../../../packages/shared/src/fields.ts';
import { EXPENSE_FORM } from '../shared/form.ts';

test('the expense form is consistent and registers as a configurable form', () => {
  assert.deepEqual(formDefinitionProblems(EXPENSE_FORM), []);
  registerForm(EXPENSE_FORM);
  registerForm(EXPENSE_FORM); // the same again: no-op
  assert.equal(FORMS.expense, EXPENSE_FORM);
  assert.throws(() => registerForm({ ...EXPENSE_FORM }), /already defined/);
});

test('every column field writes the expenses table; custom fields go to its data column', () => {
  assert.equal(EXPENSE_FORM.customStorage.table, 'expenses');
  for (const f of EXPENSE_FORM.fields) assert.equal(f.storage.table, 'expenses', f.key);
});
