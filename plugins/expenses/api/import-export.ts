import { and, eq, sql } from 'drizzle-orm';
import { expense_report_items, expense_reports, expenses } from './db/schema';
import type { ApiPayrollItem } from '@worktime3/api/plugin';

/** Report statuses whose expenses are paid with the salary (approved and everything after). */
const PAID_STATUSES = ['approved', 'submitted_processing', 'processing_finished', 'request_payment', 'finished'];

/**
 * Expenses on the payroll export (Import/Export): per person, the month's expenses that are in an
 * approved report or in none, summed in the booked currency (the organization's reporting currency).
 */
export const EXPENSES_PAYROLL: ApiPayrollItem = {
  key: 'expenses',
  caption: 'importExport.payroll.colExpenses',
  abacus: { wageType: '3000', label: 'Spesenverguetung', unit: 'Pauschal' },
  columns: { bexio: 'Spesen_Betrag', csv: 'Spesen_CHF', xlsx: 'Spesen (CHF)' },
  amounts: async (db, { orgId, from, to }) => {
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
  },
};
