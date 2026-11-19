import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { DocumentsService, type PersonalDocument } from './documents.service';
import { TimesheetDocumentsService } from './timesheet-documents.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';

export type { PersonalDocument } from './documents.service';

const iso = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

/**
 * Documents (nav.documents): every document that concerns the caller, in one list. The PDFs of
 * their approved timesheets and monthly project reports (timesheet-documents.service.ts), the
 * evidence of their absences, the attachments of the requests they sent, the personnel-file
 * documents HR shared with them, the scheduled reports sent to them, and what plugins add
 * (DocumentsService.registerPersonalDocuments, e.g. expense receipts). Strictly
 * the caller's own: no person picker, and a download is checked against the same list. Opening the
 * list first issues the current year's missing PDFs (months approved before PDFs existed).
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
    await this.timesheetDocs.issueMissing(db, orgId, callerId, new Date().getFullYear());
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
    await this.documents.send(res, doc);
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
        -- Timesheet PDFs and monthly project reports (current and superseded).
        SELECT d.id AS document_id, td.kind AS category,
               coalesce(td.timesheet_period_id::text, to_char(td.period_start, 'YYYY-MM-DD')) AS source_id,
               d.file_name, d.mime_type, d.size_bytes, to_char(td.period_start, 'YYYY-MM-DD') AS date,
               ${iso('td.issued_at')} AS added_at, td.superseded_at IS NOT NULL AS superseded, '{}'::jsonb AS context
        FROM timesheet_documents td
        JOIN documents d ON d.id = td.document_id
        WHERE td.organization_id = ${orgId} AND td.user_id = ${userId}
        UNION ALL
        -- The personnel file's documents HR shared with the person (personnel-documents.controller.ts).
        SELECT d.id, 'personnel', p.id::text, d.file_name, d.mime_type, d.size_bytes,
               to_char(coalesce(p.document_date, d.created_at::date), 'YYYY-MM-DD'),
               ${iso('d.created_at')}, false, jsonb_build_object('title', p.title, 'category', p.category)
        FROM personnel_documents p JOIN documents d ON d.id = p.document_id
        WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} AND p.visible_to_employee
        UNION ALL
        -- Scheduled reports delivered to the person (report-schedules.service.ts), made with their own rights.
        SELECT d.id, 'report', rr.id::text, d.file_name, d.mime_type, d.size_bytes, to_char(rr.ran_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
               ${iso('rr.ran_at')}, false, jsonb_build_object('title', rr.title, 'from', rr.period_from, 'to', rr.period_to)
        FROM report_runs rr JOIN documents d ON d.id = rr.document_id
        WHERE rr.organization_id = ${orgId} AND rr.user_id = ${userId}
        UNION ALL
        -- Absence evidence (doctor's notes, ...).
        SELECT d.id, 'absence', a.id::text, d.file_name, d.mime_type, d.size_bytes, to_char(a.date_start, 'YYYY-MM-DD'),
               ${iso('d.created_at')}, false,
               jsonb_build_object('absenceType', a.absence_type, 'dateEnd', to_char(a.date_end, 'YYYY-MM-DD'), 'status', a.status)
        FROM absences a JOIN documents d ON d.id = a.document_id
        WHERE a.organization_id = ${orgId} AND a.user_id = ${userId}
        UNION ALL
        -- Attachments of the requests the person sent (theirs and the handlers' answers).
        SELECT d.id, 'request', r.id::text, d.file_name, d.mime_type, d.size_bytes, to_char(m.posted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
               ${iso('d.created_at')}, false, jsonb_build_object('subject', r.subject)
        FROM requests r
        JOIN request_messages m ON m.request_id = r.id
        JOIN request_message_documents md ON md.message_id = m.id
        JOIN documents d ON d.id = md.document_id
        WHERE r.organization_id = ${orgId} AND r.requester_user_id = ${userId}
      ) docs
      ORDER BY date DESC, added_at DESC, file_name`);
    const core: PersonalDocument[] = (result.rows as Record<string, unknown>[]).map((r) => ({
      documentId: r.document_id as string,
      category: r.category as string,
      sourceId: r.source_id as string,
      fileName: r.file_name as string,
      mimeType: r.mime_type as string,
      sizeBytes: Number(r.size_bytes),
      date: r.date as string,
      addedAt: r.added_at as string,
      superseded: r.superseded === true,
      context: (r.context as Record<string, string | number | null>) ?? {},
    }));
    const sources = [...this.documents.personalDocumentSources()];
    if (sources.length === 0) return core;
    const added = (await Promise.all(sources.map(([category, list]) => list(db, orgId, userId).then((rows) => rows.map((d) => ({ ...d, category }))))))
      .flat();
    return mergeDocuments(core, added);
  }
}

/** The core's list (sorted by the database) with the plugins' documents put in, in the same order. */
export function mergeDocuments(core: readonly PersonalDocument[], added: readonly PersonalDocument[]): PersonalDocument[] {
  const before = (a: PersonalDocument, b: PersonalDocument) =>
    a.date !== b.date ? a.date > b.date : a.addedAt !== b.addedAt ? a.addedAt > b.addedAt : a.fileName < b.fileName;
  const out = [...core];
  for (const d of [...added].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0))) {
    let at = out.findIndex((x) => before(d, x));
    if (at < 0) at = out.length;
    out.splice(at, 0, d);
  }
  return out;
}
