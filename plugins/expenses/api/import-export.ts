import { and, eq, inArray, sql } from 'drizzle-orm';
import { exchange_rates, expense_report_items, expense_reports, expenses } from '@worktime3/api/schema';
import type { ApiBackup, ApiPayrollItem } from '@worktime3/api/plugin';

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

/** Expenses, expense reports and their items, and the exchange rates, in an organization's backup. */
export const EXPENSES_BACKUP: ApiBackup = {
  export: async (db, orgId) => {
    const expensesData = await db.select().from(expenses).where(eq(expenses.organization_id, orgId));
    const reportsData = await db.select().from(expense_reports).where(eq(expense_reports.organization_id, orgId));
    const reportIds = reportsData.map((r) => r.id);
    const itemsData = reportIds.length > 0 ? await db.select().from(expense_report_items).where(inArray(expense_report_items.expense_report_id, reportIds)) : [];
    const ratesData = await db.select().from(exchange_rates).where(eq(exchange_rates.organization_id, orgId));
    return {
      files: {
        'expenses.json': expensesData,
        'expense_reports.json': reportsData,
        'expense_report_items.json': itemsData,
        'exchange_rates.json': ratesData,
      },
      counts: { expenses: expensesData.length, expenseReports: reportsData.length },
    };
  },

  restore: async (db, { targetOrgId, read, userIds, projectIds, subprojectIds }) => {
    let restoredExpenses = 0;
    for (const exp of read('expenses.json')) {
      const uId = userIds.get(exp.user_id);
      if (!uId) continue;
      await db
        .insert(expenses)
        .values({
          id: exp.id,
          organization_id: targetOrgId,
          user_id: uId,
          project_id: exp.project_id ? projectIds.get(exp.project_id) ?? null : null,
          subproject_id: exp.subproject_id ? subprojectIds.get(exp.subproject_id) ?? null : null,
          expense_date: exp.expense_date,
          category: exp.category || 'other',
          sub_category: exp.sub_category || null,
          value: String(exp.value ?? '0'),
          original_value: exp.original_value ? String(exp.original_value) : null,
          currency: exp.currency || 'CHF',
          original_currency: exp.original_currency || null,
          quantity: exp.quantity ? String(exp.quantity) : null,
          // The rates the expense was booked with (077); older backups have none.
          exchange_rate: exp.exchange_rate ? String(exp.exchange_rate) : null,
          unit_rate: exp.unit_rate ? String(exp.unit_rate) : null,
          comment: exp.comment || null,
          document_id: exp.document_id || null,
          data: exp.data || {},
        })
        .onConflictDoUpdate({
          target: expenses.id,
          set: {
            value: String(exp.value ?? '0'),
            category: exp.category || 'other',
            comment: exp.comment || null,
          },
        });
      restoredExpenses += 1;
    }

    for (const er of read('expense_reports.json')) {
      const uId = userIds.get(er.user_id);
      if (!uId) continue;
      await db
        .insert(expense_reports)
        .values({
          id: er.id,
          organization_id: targetOrgId,
          user_id: uId,
          status: er.status || 'in_preparation',
          date_submitted: er.date_submitted || null,
          reviewed_by_user_id: er.reviewed_by_user_id ? userIds.get(er.reviewed_by_user_id) ?? null : null,
          reviewed_at: er.reviewed_at || null,
          review_note: er.review_note || null,
          data: er.data || {},
        })
        .onConflictDoUpdate({
          target: expense_reports.id,
          set: {
            status: er.status || 'in_preparation',
            review_note: er.review_note || null,
          },
        });
    }

    for (const eri of read('expense_report_items.json')) {
      await db
        .insert(expense_report_items)
        .values({
          id: eri.id,
          expense_report_id: eri.expense_report_id,
          expense_id: eri.expense_id,
          organization_id: targetOrgId,
        })
        .onConflictDoNothing();
    }

    // Exchange rates (Organization settings): one per currency pair and day; a restored one wins.
    for (const r of read('exchange_rates.json')) {
      if (!r.currency || !r.target_currency || !r.valid_from || !r.rate) continue;
      await db
        .insert(exchange_rates)
        .values({ organization_id: targetOrgId, currency: r.currency, target_currency: r.target_currency, valid_from: r.valid_from, rate: String(r.rate) })
        .onConflictDoUpdate({
          target: [exchange_rates.organization_id, exchange_rates.currency, exchange_rates.target_currency, exchange_rates.valid_from],
          set: { rate: String(r.rate) },
        });
    }

    return { expenses: restoredExpenses };
  },
};
