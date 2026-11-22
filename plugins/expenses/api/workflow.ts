import { eq, inArray } from 'drizzle-orm';
import type { ApiPluginWorkflows } from '@worktime3/api/plugin';
import { users } from '@worktime3/api/schema';
import { expense_reports } from './db/schema';

/** A submitted expense report awaiting its owner's manager to approve or reject it (workflow definition name). */
export const APPROVE_EXPENSE_REPORT_WORKFLOW_NAME = 'approve expense report';

const SOURCE = { source: 'Expense Report', source_name: 'getExpenseReportTitle' };

/**
 * The expense report's workflow: the manager approves, then whoever processes expenses (HR) processes
 * it (the text for accounting) and confirms the payment. Finished after the payment.
 */
export const EXPENSE_REPORT_STEPS = [
  { key: 'manager_review', label: 'Manager review', assignTo: 'manager', onApprove: { action: 'expense.approve' }, onReject: { action: 'expense.reject' }, ...SOURCE },
  {
    key: 'processing', label: 'Processing', assignTo: 'permission:nav.expenseProcessing',
    onApprove: { action: 'expense.process' }, onReject: { action: 'none' }, rejectable: false, inDialog: true,
    doneKey: 'expenseProcessing.stage.processing_finished', actionKey: 'expenseProcessing.stepProcess', ...SOURCE,
  },
  {
    key: 'payment', label: 'Payment', assignTo: 'permission:nav.expenseProcessing',
    onApprove: { action: 'expense.paid' }, onReject: { action: 'none' }, rejectable: false,
    doneKey: 'expenseProcessing.event.paid', actionKey: 'expenseProcessing.stepPaid', ...SOURCE,
  },
];

/** Moves a report from one of `from` to `to` (nothing when it is elsewhere), with its history. */
async function moveReport(db: Parameters<NonNullable<ApiPluginWorkflows['actions']>[string]>[0], id: string, from: readonly string[], to: string, actorUserId: string, core: Parameters<NonNullable<ApiPluginWorkflows['actions']>[string]>[2]) {
  const [report] = await db.select({ status: expense_reports.status, data: expense_reports.data }).from(expense_reports).where(eq(expense_reports.id, id));
  if (!report || !from.includes(report.status)) return;
  const data = (report.data ?? {}) as { history?: unknown[] };
  const patch = { status: to, data: { ...data, history: [...(data.history ?? []), { stage: to, note: null, actorUserId, at: new Date().toISOString() }] } };
  await db.update(expense_reports).set(patch).where(eq(expense_reports.id, id));
  void core.versions.record('expense_reports', id, 'update_delta', actorUserId, patch).catch(() => {});
}

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
    'expense.process': (db, ctx, core) => moveReport(db, ctx.sourceTableUuid, ['approved', 'submitted_processing'], 'processing_finished', ctx.actorUserId, core),
    'expense.paid': (db, ctx, core) => moveReport(db, ctx.sourceTableUuid, ['processing_finished', 'request_payment'], 'finished', ctx.actorUserId, core),
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
