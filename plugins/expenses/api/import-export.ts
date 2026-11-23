import { and, eq, sql } from 'drizzle-orm';
import { expense_report_items, expense_reports, expenses } from './db/schema';
import type { ApiPayrollItem } from '@worktime3/api/plugin';
import { ALLOWANCE_CATEGORY } from '../shared/booking';

/** Report statuses whose expenses are paid with the salary (approved and everything after). */
const PAID_STATUSES = ['approved', 'submitted_processing', 'processing_finished', 'request_payment', 'finished'];

/**
 * The month's expenses per person that are in an approved report or in none, summed in the booked
 * currency (the organization's reporting currency): the flat-rate allowances, or everything else.
 */
function payrollAmounts(allowances: boolean): ApiPayrollItem['amounts'] {
  return async (db, { orgId, from, to }) => {
    const rows = await db
      .select({ userId: expenses.user_id, value: expenses.value, currency: expenses.currency })
      .from(expenses)
      .leftJoin(expense_report_items, eq(expense_report_items.expense_id, expenses.id))
      .leftJoin(expense_reports, eq(expense_reports.id, expense_report_items.expense_report_id))
      .where(
        and(
          eq(expenses.organization_id, orgId),
          sql`${expenses.expense_date} >= ${from} AND ${expenses.expense_date} <= ${to}`,
          sql`(${expense_reports.status} IS NULL OR ${expense_reports.status} IN (${sql.join(PAID_STATUSES.map((s) => sql`${s}`), sql`, `)}))`,
          allowances ? sql`${expenses.category} = ${ALLOWANCE_CATEGORY}` : sql`${expenses.category} IS DISTINCT FROM ${ALLOWANCE_CATEGORY}`,
        ),
      );
    const totals = new Map<string, { amount: number; currency: string }>();
    for (const r of rows) {
      const current = totals.get(r.userId) ?? { amount: 0, currency: r.currency || 'CHF' };
      const value = Number(r.value);
      if (Number.isFinite(value)) current.amount += value;
      totals.set(r.userId, current);
    }
    return totals;
  };
}

/**
 * Expenses on the payroll export (Import/Export), effective ones (Lohnausweis 13.1) and flat-rate
 * allowances (13.2) apart, each on its own wage type.
 */
export const EXPENSES_PAYROLL: ApiPayrollItem = {
  key: 'expenses',
  caption: 'importExport.payroll.colExpenses',
  abacus: { wageType: '3000', label: 'Spesenverguetung', unit: 'Pauschal' },
  columns: { bexio: 'Spesen_Betrag', csv: 'Spesen_CHF', xlsx: 'Spesen (CHF)' },
  amounts: payrollAmounts(false),
};

export const EXPENSES_ALLOWANCES_PAYROLL: ApiPayrollItem = {
  key: 'expensesAllowances',
  caption: 'importExport.payroll.colAllowances',
  abacus: { wageType: '3010', label: 'Pauschalspesen', unit: 'Pauschal' },
  columns: { bexio: 'Pauschalspesen_Betrag', csv: 'Pauschalspesen_CHF', xlsx: 'Pauschalspesen (CHF)' },
  amounts: payrollAmounts(true),
};
