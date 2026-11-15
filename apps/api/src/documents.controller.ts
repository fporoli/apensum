import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { DocumentsService } from './documents.service';
import { TimesheetDocumentsService, type PeriodKind } from './timesheet-documents.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';

export type DocumentCategory = 'timesheet' | 'project_timesheet' | 'absence' | 'expense' | 'request';

export interface PersonalDocument {
  /** The `documents` row; null for an approved month whose PDF is issued on first download. */
  documentId: string | null;
  category: DocumentCategory;
  /** The record it belongs to (period, absence, expense, request). */
  sourceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  /** The date the document is about (month, absence start, expense date, message day). */
  date: string;
  addedAt: string | null;
  superseded: boolean;
  /** Context for the list: project, absence type and end, expense category/amount, request subject. */
  context: Record<string, string | number | null>;
}

const iso = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

/**
 * Documents (nav.documents): every document that concerns the caller, in one list. The PDFs of
 * their approved timesheets (timesheet-documents.service.ts), the evidence of their absences and
 * expenses, and the attachments of the requests they sent. Strictly the caller's own: no person
 * picker, and a download is checked against the same list.
 */
@Controller('organizations/:orgId/documents')
export class DocumentsController {
  constructor(
    private readonly db: DbService,
    private readonly documents: DocumentsService,
    private readonly timesheetDocs: TimesheetDocumentsService,
  ) {}

  @Get()
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, documents: [] };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden', documents: [] };
    return { ok: true, documents: await this.own(db, orgId, callerId) };
  }

  /** One of the caller's documents (any category). */
  @Get(':documentId/download')
  async download(@Param('orgId') orgId: string, @Param('documentId') documentId: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const callerId = db ? await this.caller(db, orgId, req) : null;
    if (!db || !callerId || !/^[0-9a-f-]{36}$/i.test(documentId)) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    const mine = (await this.own(db, orgId, callerId)).some((d) => d.documentId === documentId);
    const doc = mine ? await this.documents.get(db, documentId) : undefined;
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    this.documents.send(res, doc);
  }

  /** The current PDF of one of the caller's approved months, issued now if it has none yet. */
  @Get('periods/:kind/:periodId')
  async period(
    @Param('orgId') orgId: string,
    @Param('kind') kind: string,
    @Param('periodId') periodId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const db = this.db.getDb();
    const callerId = db ? await this.caller(db, orgId, req) : null;
    const k = kind as PeriodKind;
    if (!db || !callerId || (k !== 'timesheet' && k !== 'project_timesheet') || !/^[0-9a-f-]{36}$/i.test(periodId)) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    const table = k === 'timesheet' ? 'timesheet_periods' : 'project_time_periods';
    const owned = await db.execute(
      sql`SELECT 1 FROM ${sql.raw(table)} WHERE id = ${periodId} AND organization_id = ${orgId} AND user_id = ${callerId} AND status = 'approved'`,
    );
    const documentId = owned.rows.length > 0 ? await this.timesheetDocs.current(db, k, periodId) : null;
    const doc = documentId ? await this.documents.get(db, documentId) : undefined;
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    this.documents.send(res, doc);
  }

  private async caller(db: Db, orgId: string, req: AuthenticatedRequest): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return null;
    return (await can(db, orgId, callerId, 'nav.documents', 'see', callerId)) ? callerId : null;
  }

  /** Everything that concerns `userId`, newest first. */
  async own(db: Db, orgId: string, userId: string): Promise<PersonalDocument[]> {
    const result = await db.execute(sql`
      SELECT * FROM (
        -- Issued timesheet PDFs (current and superseded).
        SELECT d.id AS document_id, CASE WHEN td.timesheet_period_id IS NULL THEN 'project_timesheet' ELSE 'timesheet' END AS category,
               coalesce(td.timesheet_period_id, td.project_time_period_id) AS source_id,
               d.file_name, d.mime_type, d.size_bytes, to_char(td.period_start, 'YYYY-MM-DD') AS date,
               ${iso('td.issued_at')} AS added_at, td.superseded_at IS NOT NULL AS superseded,
               jsonb_build_object('project', pr.name) AS context
        FROM timesheet_documents td
        JOIN documents d ON d.id = td.document_id
        LEFT JOIN project_time_periods pp ON pp.id = td.project_time_period_id
        LEFT JOIN projects pr ON pr.id = pp.project_id
        WHERE td.organization_id = ${orgId} AND td.user_id = ${userId}
        UNION ALL
        -- Approved working-time months without a PDF yet (approved before PDFs existed).
        SELECT NULL, 'timesheet', p.id, 'timesheet-' || to_char(p.period_start, 'YYYY-MM') || '.pdf', 'application/pdf', NULL,
               to_char(p.period_start, 'YYYY-MM-DD'), NULL, false, '{}'::jsonb
        FROM timesheet_periods p
        WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} AND p.status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM timesheet_documents td WHERE td.timesheet_period_id = p.id AND td.superseded_at IS NULL)
        UNION ALL
        SELECT NULL, 'project_timesheet', p.id, 'project-timesheet-' || to_char(p.period_start, 'YYYY-MM') || '.pdf', 'application/pdf', NULL,
               to_char(p.period_start, 'YYYY-MM-DD'), NULL, false, jsonb_build_object('project', pr.name)
        FROM project_time_periods p JOIN projects pr ON pr.id = p.project_id
        WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} AND p.status = 'approved'
          AND NOT EXISTS (SELECT 1 FROM timesheet_documents td WHERE td.project_time_period_id = p.id AND td.superseded_at IS NULL)
        UNION ALL
        -- Absence evidence (doctor's notes, ...).
        SELECT d.id, 'absence', a.id, d.file_name, d.mime_type, d.size_bytes, to_char(a.date_start, 'YYYY-MM-DD'),
               ${iso('d.created_at')}, false,
               jsonb_build_object('absenceType', a.absence_type, 'dateEnd', to_char(a.date_end, 'YYYY-MM-DD'), 'status', a.status)
        FROM absences a JOIN documents d ON d.id = a.document_id
        WHERE a.organization_id = ${orgId} AND a.user_id = ${userId}
        UNION ALL
        -- Expense receipts.
        SELECT d.id, 'expense', e.id, d.file_name, d.mime_type, d.size_bytes, to_char(e.expense_date, 'YYYY-MM-DD'),
               ${iso('d.created_at')}, false,
               jsonb_build_object('category', e.category, 'value', e.value, 'currency', e.currency, 'comment', e.comment)
        FROM expenses e JOIN documents d ON d.id = e.document_id
        WHERE e.organization_id = ${orgId} AND e.user_id = ${userId}
        UNION ALL
        -- Attachments of the requests the person sent (theirs and the handlers' answers).
        SELECT d.id, 'request', r.id, d.file_name, d.mime_type, d.size_bytes, to_char(m.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
               ${iso('d.created_at')}, false, jsonb_build_object('subject', r.subject)
        FROM requests r
        JOIN request_messages m ON m.request_id = r.id
        JOIN request_message_documents md ON md.message_id = m.id
        JOIN documents d ON d.id = md.document_id
        WHERE r.organization_id = ${orgId} AND r.requester_user_id = ${userId}
      ) docs
      ORDER BY date DESC, added_at DESC NULLS LAST, file_name`);
    return (result.rows as Record<string, unknown>[]).map((r) => ({
      documentId: (r.document_id as string | null) ?? null,
      category: r.category as DocumentCategory,
      sourceId: r.source_id as string,
      fileName: r.file_name as string,
      mimeType: r.mime_type as string,
      sizeBytes: r.size_bytes == null ? null : Number(r.size_bytes),
      date: r.date as string,
      addedAt: (r.added_at as string | null) ?? null,
      superseded: r.superseded === true,
      context: (r.context as Record<string, string | number | null>) ?? {},
    }));
  }
}
