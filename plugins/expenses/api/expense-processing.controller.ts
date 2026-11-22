import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuditService, DbService, VersionsService, callerUserId, can, payrollPersonalien, type AuthenticatedRequest } from '@worktime3/api/plugin';
import {
  MAX_PROCESS_REPORTS,
  PROCESSABLE_STATUSES,
  PROCESSED_STATUS,
  processingLines,
  type ProcessingReport,
} from '../shared/processing';
import { PIPELINE } from './expense-reports.controller';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidArray = (ids: readonly string[]) => `{${ids.join(',')}}`;

/**
 * Expense processing (`nav.expenseProcessing`, HR): the approved reports by status, each with the
 * person's personnel number, the approval's workflow id and its amounts per cost centre; "process"
 * marks a selection "processing finished" (the popup's text for accounting is built in the browser).
 */
@Controller()
export class ExpenseProcessingController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  /** `status`: one pipeline status, or `open` (default: approved and not processed yet). */
  @Get('organizations/:orgId/expense-processing')
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Query('status') status?: string): Promise<ProcessingReport[]> {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.expenseProcessing', 'see'))) return [];
    const statuses: readonly string[] = status && (PIPELINE as readonly string[]).includes(status) ? [status] : PROCESSABLE_STATUSES;
    return this.reports(db, orgId, statuses);
  }

  @Post('organizations/:orgId/expense-processing/process')
  async process(@Param('orgId') orgId: string, @Body() body: { reportIds?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    if (!(await can(db, orgId, callerId, 'nav.expenseProcessing', 'edit'))) return { ok: false, error: 'forbidden' };
    const ids = Array.isArray(body?.reportIds) ? [...new Set(body.reportIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)))] : [];
    if (ids.length === 0 || ids.length !== (body.reportIds as unknown[]).length) return { ok: false, error: 'invalid-reports' };
    if (ids.length > MAX_PROCESS_REPORTS) return { ok: false, error: 'too-many-reports' };

    const now = new Date().toISOString();
    // Every report must be this organization's and still processable, else nothing changes.
    const result = await db.transaction(async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT id, data FROM expense_reports
        WHERE organization_id = ${orgId}::uuid AND id = ANY(${uuidArray(ids)}::uuid[])
          AND status = ANY(${`{${PROCESSABLE_STATUSES.join(',')}}`}::text[])
        FOR UPDATE`)).rows as { id: string; data: { history?: unknown[] } | null }[];
      if (rows.length !== ids.length) return null;
      for (const r of rows) {
        const data = r.data ?? {};
        const patch = { status: PROCESSED_STATUS, data: { ...data, history: [...(data.history ?? []), { stage: PROCESSED_STATUS, note: null, actorUserId: callerId, at: now }] } };
        await tx.execute(sql`UPDATE expense_reports SET status = ${patch.status}, data = ${JSON.stringify(patch.data)}::jsonb WHERE id = ${r.id}::uuid`);
      }
      return rows.map((r) => r.id);
    });
    if (!result) return { ok: false, error: 'not-processable' };
    for (const id of result) {
      void this.versions.record('expense_reports', id, 'update_delta', callerId, { status: PROCESSED_STATUS }).catch(() => {});
      void this.audit.record(orgId, callerId, 'expense.process', 'expense_report', id, { toStatus: PROCESSED_STATUS }).catch(() => {});
    }
    return { ok: true, processed: result.length, status: PROCESSED_STATUS };
  }

  private async reports(db: NonNullable<ReturnType<DbService['getDb']>>, orgId: string, statuses: readonly string[]): Promise<ProcessingReport[]> {
    const reports = (await db.execute(sql`
      SELECT r.id, r.status, r.date_submitted::text AS date_submitted, r.user_id, COALESCE(u.display_name, u.email) AS name, u.basicdata,
        (SELECT w.workflow_id FROM workflows w
          WHERE w.source_table = 'expense_reports' AND w.source_table_uuid = r.id
          ORDER BY w.workflow_started DESC NULLS LAST LIMIT 1) AS workflow_id,
        (SELECT d.name FROM employee_assignments a JOIN departments d ON d.id = a.department_id
          WHERE a.organization_id = r.organization_id AND a.user_id = r.user_id
            AND a.valid_from <= COALESCE(r.date_submitted::date, CURRENT_DATE)
          ORDER BY a.valid_from DESC LIMIT 1) AS department
      FROM expense_reports r JOIN users u ON u.id = r.user_id
      WHERE r.organization_id = ${orgId}::uuid AND r.status = ANY(${`{${statuses.join(',')}}`}::text[])
      ORDER BY r.date_submitted DESC NULLS LAST`)).rows as {
      id: string; status: string; date_submitted: string | null; user_id: string; name: string; basicdata: unknown; workflow_id: string | null; department: string | null;
    }[];
    if (reports.length === 0) return [];
    const items = (await db.execute(sql`
      SELECT i.expense_report_id, e.value, e.currency, NULLIF(btrim(p.cost_item), '') AS cost_item
      FROM expense_report_items i
      JOIN expenses e ON e.id = i.expense_id
      LEFT JOIN projects p ON p.id = e.project_id
      WHERE i.expense_report_id = ANY(${uuidArray(reports.map((r) => r.id))}::uuid[])`)).rows as {
      expense_report_id: string; value: string; currency: string; cost_item: string | null;
    }[];
    return reports.map((r) => ({
      id: r.id,
      status: r.status,
      dateSubmitted: r.date_submitted,
      userId: r.user_id,
      name: r.name,
      personnelNumber: String(payrollPersonalien(r.basicdata, orgId).personnelNumber ?? ''),
      workflowId: r.workflow_id,
      lines: processingLines(
        items
          .filter((i) => i.expense_report_id === r.id)
          .map((i) => ({ costCenter: i.cost_item ?? r.department, currency: i.currency, value: Number(i.value) })),
      ),
    }));
  }
}
