/**
 * The expense form (the Expenses page's log/edit form) as a configurable form (docs/FIELD_CONFIG.md):
 * registered with the core by api/index.ts (`forms`), rendered by web/Expenses.tsx, validated by
 * api/expenses.controller.ts. Org templates (field_config, form id `expense`) override it.
 */
import type { FieldDef, FieldExtras, FormDef } from '@worktime3/shared/fields';

/** A field stored in a real column of `expenses`. Field keys match the API's request body. */
function expensesColumn(key: string, column: string, caption: string, group: string, order: number, extras: FieldExtras = {}): FieldDef {
  return {
    key,
    storage: { kind: 'column', table: 'expenses', column },
    type: 'text',
    caption,
    group,
    order,
    width: 'm',
    optional: true,
    editableBy: 'self',
    ...extras,
  };
}

export const EXPENSE_FORM: FormDef = {
  id: 'expense',
  customStorage: { table: 'expenses', column: 'data' },
  reservedKeys: ['orgs'],
  groups: [
    { key: 'expense', caption: 'expenses.section.expense', order: 10 },
    // Shown collapsed under "Additional data" until opened.
    { key: 'additional', caption: 'expenses.additionalData', order: 20 },
  ],
  fields: [
    // NOT NULL columns: always required, never hidden.
    expensesColumn('expenseDate', 'expense_date', 'time.date', 'expense', 10, { type: 'date', optional: false, required: true, locked: ['type', 'required'] }),
    expensesColumn('category', 'category', 'expenses.category', 'expense', 20, { type: 'select', options: 'categories', optional: false, required: true, locked: ['required'] }),
    expensesColumn('subCategory', 'sub_category', 'expenses.subCategory', 'expense', 30, { type: 'select', options: 'subCategories' }),
    expensesColumn('projectId', 'project_id', 'time.project', 'expense', 40, { type: 'select', options: 'projects' }),
    expensesColumn('subprojectId', 'subproject_id', 'time.subproject', 'expense', 50, { type: 'select', options: 'subprojects' }),
    // The receipt's amount and currency (booking.ts bookExpense): the booked `value` in the org's
    // reporting `currency` is worked out from them with the exchange rate in force on the date.
    // Without a receipt amount (an org template may hide it) `value` is entered directly.
    expensesColumn('originalValue', 'original_value', 'expenses.originalValue', 'expense', 60, { type: 'number', width: 's', newRow: true, min: 0.01, locked: ['type', 'min'] }),
    // Currencies are a dropdown of the org's list (static_data expenses/currency).
    expensesColumn('originalCurrency', 'original_currency', 'expenses.originalCurrency', 'expense', 64, { type: 'select', options: 'currencies', width: 'm', validator: 'currency', locked: ['type', 'validator'] }),
    // Booked amount in the reporting currency: computed by the API (the form shows the preview).
    expensesColumn('value', 'value', 'expenses.value', 'expense', 66, { type: 'number', width: 's', optional: false, min: 0, locked: ['type', 'required', 'min'] }),
    expensesColumn('currency', 'currency', 'expenses.currency', 'expense', 68, { type: 'select', options: 'currencies', width: 'm', optional: false, required: true, validator: 'currency', locked: ['type', 'required', 'validator'] }),
    expensesColumn('comment', 'comment', 'time.comment', 'expense', 80, { width: 'full', height: 2, newRow: true }),

    // km of a mileage expense; otherwise an optional quantity.
    expensesColumn('quantity', 'quantity', 'expenses.quantity', 'additional', 30, { type: 'number', width: 's', min: 0, locked: ['type', 'min'] }),
  ],
};
