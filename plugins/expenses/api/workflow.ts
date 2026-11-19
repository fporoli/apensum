import { eq, inArray } from 'drizzle-orm';
import type { ApiPluginWorkflows } from '@worktime3/api/plugin';
import { users } from '@worktime3/api/schema';
import { expense_reports } from './db/schema';

/** A submitted expense report awaiting its owner's manager to approve or reject it (workflow definition name). */
export const APPROVE_EXPENSE_REPORT_WORKFLOW_NAME = 'approve expense report';

/**
 * The expense report approval (api/expense-reports.controller.ts starts it on submit): what the
 * "expense.*" actions do, how an expense_reports row's organization is resolved, what the Workflow
 * page shows of a report (`expense_report`, read by web/ExpenseReportReview.tsx), and that it
 * follows the person's manager.
 */
export const EXPENSE_WORKFLOWS: ApiPluginWorkflows = {
  actions: {
    'expense.approve': async (db, ctx, core) => {
      const patch = { status: 'approved' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: null };
      await db.update(expense_reports).set(patch).where(eq(expense_reports.id, ctx.sourceTableUuid));
      void core.versions.record('expense_reports', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    },
    'expense.reject': async (db, ctx, core) => {
      const patch = { status: 'rejected' as const, reviewed_by_user_id: ctx.actorUserId, reviewed_at: new Date().toISOString(), review_note: ctx.decisionNote };
      await db.update(expense_reports).set(patch).where(eq(expense_reports.id, ctx.sourceTableUuid));
      void core.versions.record('expense_reports', ctx.sourceTableUuid, 'update_delta', ctx.actorUserId, patch).catch(() => {});
    },
  },
  sources: {
    expense_reports: {
      organization: async (db, id) => {
        const [report] = await db.select({ organization_id: expense_reports.organization_id }).from(expense_reports).where(eq(expense_reports.id, id));
        return report?.organization_id ?? null;
      },
      records: {
        field: 'expense_report',
        load: (db, ids) =>
          db
            .select({
              id: expense_reports.id,
              status: expense_reports.status,
              date_submitted: expense_reports.date_submitted,
              user_id: expense_reports.user_id,
              user_display_name: users.display_name,
              user_email: users.email,
            })
            .from(expense_reports)
            .innerJoin(users, eq(users.id, expense_reports.user_id))
            .where(inArray(expense_reports.id, ids)),
      },
    },
  },
  managerRouted: [APPROVE_EXPENSE_REPORT_WORKFLOW_NAME],
};
