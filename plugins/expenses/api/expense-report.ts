import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { projects } from '@worktime3/api/schema';
import { expenses } from './db/schema';
import type { ApiReport, ReportRow, ReportRowsContext } from '@worktime3/api/plugin';
import { monthEnd } from '@worktime3/shared/reports';
import { EXPENSES_REPORT } from '../shared/report';

/**
 * The expenses report's rows: one per expense dated in the period, of the people the core has
 * checked: amount in its own currency, and the status of the expense report it is in (`none`
 * when it is in none yet).
 */
export async function expenseReportRows({ db, orgId, people, first, last, projectId }: ReportRowsContext): Promise<ReportRow[]> {
  const names = new Map(people.map((p) => [p.id, p.name]));
  const conditions = [
    eq(expenses.organization_id, orgId),
    inArray(expenses.user_id, people.map((p) => p.id)),
    gte(expenses.expense_date, `${first}-01`),
    lte(expenses.expense_date, monthEnd(last)),
  ];
  if (projectId) conditions.push(eq(expenses.project_id, projectId));
  const result = await db
    .select({
      userId: expenses.user_id,
      category: expenses.category,
      project: sql<string>`coalesce(${projects.name}, '')`,
      date: expenses.expense_date,
      currency: expenses.currency,
      value: expenses.value,
      status: sql<string | null>`(SELECT er.status FROM expense_report_items i JOIN expense_reports er ON er.id = i.expense_report_id WHERE i.expense_id = ${expenses.id} LIMIT 1)`,
    })
    .from(expenses)
    .leftJoin(projects, eq(projects.id, expenses.project_id))
    .where(and(...conditions));
  return result.map((r) => ({
    person: r.userId,
    personName: names.get(r.userId) ?? '',
    category: r.category,
    project: r.project,
    month: String(r.date).slice(0, 7),
    status: r.status ?? 'none',
    currency: String(r.currency).trim().toUpperCase(),
    amount: Math.round(Number(r.value) * 100) / 100,
    count: 1,
  }));
}

export const EXPENSES_API_REPORT: ApiReport = { ...EXPENSES_REPORT, rows: expenseReportRows };
