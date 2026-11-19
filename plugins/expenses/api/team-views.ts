import { sql } from 'drizzle-orm';
import type { ApiTeamView } from '@worktime3/api/plugin';

const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/**
 * The Team tab of Expenses and Expense reports (web/index.tsx `teamViews` shows them): the core has
 * already worked out whose records the caller may see (`userIds`).
 */
export const EXPENSE_TEAM_VIEWS: ApiTeamView[] = [
  {
    // The month's expenses, with the status of the report each is in.
    kind: 'expenses',
    object: 'nav.expenses',
    rows: async (db, { orgId, userIds, from, toExclusive }) => {
      const result = await db.execute(sql`
        SELECT e.id, e.user_id, e.expense_date::text AS expense_date, e.category, e.sub_category,
               e.value::float AS value, e.currency, e.comment, pr.name AS project_name,
               er.status AS report_status
        FROM expenses e
        LEFT JOIN projects pr ON pr.id = e.project_id
        LEFT JOIN expense_report_items eri ON eri.expense_id = e.id
        LEFT JOIN expense_reports er ON er.id = eri.expense_report_id
        WHERE e.organization_id = ${orgId}
          AND e.user_id IN (${idList(userIds)})
          AND e.expense_date >= ${from}::date AND e.expense_date < ${toExclusive}::date
        ORDER BY e.expense_date`);
      return result.rows;
    },
  },
  {
    // Reports submitted in the month, plus every report still in preparation.
    kind: 'expenseReports',
    object: 'nav.expenseReports',
    rows: async (db, { orgId, userIds, from, toExclusive }) => {
      const result = await db.execute(sql`
        SELECT er.id, er.user_id, er.status, er.date_submitted,
               COUNT(e.id)::int AS items,
               COALESCE(SUM(e.value), 0)::float AS total,
               MIN(e.currency) AS currency,
               COUNT(DISTINCT e.currency)::int AS currencies
        FROM expense_reports er
        LEFT JOIN expense_report_items eri ON eri.expense_report_id = er.id
        LEFT JOIN expenses e ON e.id = eri.expense_id
        WHERE er.organization_id = ${orgId}
          AND er.user_id IN (${idList(userIds)})
          AND (er.date_submitted IS NULL
               OR (er.date_submitted >= ${from}::date AND er.date_submitted < ${toExclusive}::date))
        GROUP BY er.id
        ORDER BY er.date_submitted DESC NULLS FIRST`);
      return result.rows;
    },
  },
];
