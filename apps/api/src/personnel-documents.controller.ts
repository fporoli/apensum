import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { NotificationsService } from './notifications.service';
import { VersionsService } from './versions.service';
import { AuditService } from './audit.service';

export const PERSONNEL_OBJECT = 'section.people.documents';
export const PERSONNEL_CATEGORIES = ['evaluation', 'bonus', 'contract', 'certificate', 'salary', 'other'] as const;
export type PersonnelCategory = (typeof PERSONNEL_CATEGORIES)[number];

const UUID = /^[0-9a-f-]{36}$/i;

/** Validates title, category and date of a personnel document (create and update). */
export function parsePersonnelFields(
  body: { title?: unknown; category?: unknown; documentDate?: unknown; visibleToEmployee?: unknown },
  partial: boolean,
): { ok: true; values: { title?: string; category?: PersonnelCategory; document_date?: string | null; visible_to_employee?: boolean } } | { ok: false; error: string } {
  const values: { title?: string; category?: PersonnelCategory; document_date?: string | null; visible_to_employee?: boolean } = {};
  if (body.title !== undefined || !partial) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    if (!title) return { ok: false, error: 'title-required' };
    values.title = title;
  }
  if (body.category !== undefined || !partial) {
    if (!PERSONNEL_CATEGORIES.includes(body.category as PersonnelCategory)) return { ok: false, error: 'invalid-category' };
    values.category = body.category as PersonnelCategory;
  }
  if (body.documentDate !== undefined) {
    if (body.documentDate === null || body.documentDate === '') values.document_date = null;
    else if (typeof body.documentDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.documentDate)) values.document_date = body.documentDate;
    else return { ok: false, error: 'invalid-date' };
  }
  if (body.visibleToEmployee !== undefined) {
    // Multipart sends strings.
    values.visible_to_employee = body.visibleToEmployee === true || body.visibleToEmployee === 'true';
  }
  return { ok: true, values };
}

interface Row {
  id: string;
  user_id: string;
  document_id: string;
  title: string;
  category: PersonnelCategory;
  document_date: string | null;
  visible_to_employee: boolean;
}

/**
 * Personnel file (HR dossier): documents HR keeps for a person (reviews, bonus letters, contracts,
 * references), each shared with the person or HR only. Access is the `section.people.documents`
 * grant alone (HR by default), not the reporting line: a manager does not see their reports' file
 * unless their role is granted it. A person never edits their own file and sees only what was shared
 * with them (also on their Documents page). Files are encrypted at rest (DocumentsService).
 */
@Controller('organizations/:orgId/people/:userId/personnel-documents')
export class PersonnelDocumentsController {
  constructor(
    private readonly db: DbService,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationsService,
    private readonly versions: VersionsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, documents: [] };
    const access = await this.access(db, orgId, userId, req, 'see');
    if (!access) return { ok: false, error: 'forbidden', documents: [] };
    const rows = await db.execute(sql`
      SELECT p.id, p.title, p.category, to_char(p.document_date, 'YYYY-MM-DD') AS document_date, p.visible_to_employee,
             d.id AS document_id, d.file_name, d.mime_type, d.size_bytes,
             to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS added_at,
             coalesce(u.display_name, u.email) AS uploaded_by
      FROM personnel_documents p
      JOIN documents d ON d.id = p.document_id
      LEFT JOIN users u ON u.id = p.uploaded_by_user_id
      WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} ${access.self ? sql`AND p.visible_to_employee` : sql``}
      ORDER BY coalesce(p.document_date, d.created_at::date) DESC, d.created_at DESC`);
    return { ok: true, documents: rows.rows, canEdit: access.edit };
  }

  /** Adds a document: multipart `file`, `title`, `category`, optional `documentDate`, `visibleToEmployee`. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async upload(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const access = await this.access(db, orgId, userId, req, 'edit');
    if (!access?.edit) return { ok: false, error: 'forbidden' };
    if (!file) return { ok: false, error: 'file-required' };
    const parsed = parsePersonnelFields(body ?? {}, false);
    if (!parsed.ok) return parsed;
    const id = (await db.execute(sql`SELECT uuid_generate_v4() AS id`)).rows[0].id as string;
    const documentId = await this.documents.upload(db, orgId, access.callerId, file, { table: 'personnel_documents', id });
    const v = parsed.values;
    await db.execute(sql`
      INSERT INTO personnel_documents (id, organization_id, user_id, document_id, title, category, document_date, visible_to_employee, uploaded_by_user_id)
      VALUES (${id}, ${orgId}, ${userId}, ${documentId}, ${v.title}, ${v.category}, ${v.document_date ?? null}, ${v.visible_to_employee ?? false}, ${access.callerId})`);
    void this.versions.record('personnel_documents', id, 'insert', access.callerId, { userId, documentId, ...v, fileName: file.originalname }).catch(() => {});
    void this.audit.record(orgId, access.callerId, 'personnel-document.upload', 'personnel_document', id, { userId }).catch(() => {});
    if (v.visible_to_employee) await this.notifyShared(orgId, userId, id, v.title as string).catch(() => {});
    return { ok: true, id };
  }

  /** Changes title, category, date or whether the person sees it. */
  @Patch(':id')
  async update(@Param('orgId') orgId: string, @Param('userId') userId: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const access = await this.access(db, orgId, userId, req, 'edit');
    if (!access?.edit) return { ok: false, error: 'forbidden' };
    const row = await this.load(db, orgId, userId, id);
    if (!row) return { ok: false, error: 'not-found' };
    const parsed = parsePersonnelFields(body ?? {}, true);
    if (!parsed.ok) return parsed;
    const v = parsed.values;
    await db.execute(sql`
      UPDATE personnel_documents SET
        title = coalesce(${v.title ?? null}, title),
        category = coalesce(${v.category ?? null}, category),
        document_date = ${v.document_date === undefined ? sql`document_date` : sql`${v.document_date}::date`},
        visible_to_employee = coalesce(${v.visible_to_employee ?? null}::boolean, visible_to_employee)
      WHERE id = ${id}`);
    void this.versions.record('personnel_documents', id, 'update_delta', access.callerId, v).catch(() => {});
    if (v.visible_to_employee !== undefined && v.visible_to_employee !== row.visible_to_employee) {
      void this.audit.record(orgId, access.callerId, v.visible_to_employee ? 'personnel-document.share' : 'personnel-document.unshare', 'personnel_document', id, { userId }).catch(() => {});
      if (v.visible_to_employee) await this.notifyShared(orgId, userId, id, v.title ?? row.title).catch(() => {});
    }
    return { ok: true };
  }

  @Delete(':id')
  async remove(@Param('orgId') orgId: string, @Param('userId') userId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const access = await this.access(db, orgId, userId, req, 'edit');
    if (!access?.edit) return { ok: false, error: 'forbidden' };
    const row = await this.load(db, orgId, userId, id);
    if (!row) return { ok: false, error: 'not-found' };
    await this.documents.remove(db, row.document_id); // cascades to the personnel_documents row
    void this.versions.record('personnel_documents', id, 'delete', access.callerId, { userId, title: row.title }).catch(() => {});
    void this.audit.record(orgId, access.callerId, 'personnel-document.delete', 'personnel_document', id, { userId }).catch(() => {});
    return { ok: true };
  }

  @Get(':id/download')
  async download(@Param('orgId') orgId: string, @Param('userId') userId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const access = db ? await this.access(db, orgId, userId, req, 'see') : null;
    const row = db && access ? await this.load(db, orgId, userId, id) : null;
    const doc = db && row && (!access?.self || row.visible_to_employee) ? await this.documents.get(db, row.document_id) : undefined;
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    await this.documents.send(res, doc);
  }

  /** The caller's access to `userId`'s file: through the grant, or their own (shared documents, read only). */
  private async access(db: Db, orgId: string, userId: string, req: AuthenticatedRequest, action: 'see' | 'edit') {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !UUID.test(userId) || !(await isOrgMember(db, orgId, callerId)) || !(await isOrgMember(db, orgId, userId))) return null;
    if (userId === callerId) return action === 'see' ? { callerId, self: true, edit: false } : null;
    if (!(await can(db, orgId, callerId, PERSONNEL_OBJECT, 'see', userId))) return null;
    return { callerId, self: false, edit: await can(db, orgId, callerId, PERSONNEL_OBJECT, 'edit', userId) };
  }

  private async load(db: Db, orgId: string, userId: string, id: string): Promise<Row | null> {
    if (!UUID.test(id)) return null;
    const rows = await db.execute(sql`
      SELECT id, user_id, document_id, title, category, to_char(document_date, 'YYYY-MM-DD') AS document_date, visible_to_employee
      FROM personnel_documents WHERE id = ${id} AND organization_id = ${orgId} AND user_id = ${userId}`);
    return (rows.rows[0] as unknown as Row) ?? null;
  }

  private async notifyShared(orgId: string, userId: string, id: string, title: string) {
    await this.notifications.notifyMany({
      organizationId: orgId,
      recipientUserIds: [userId],
      type: 'personnel-document.shared',
      title: `New document in your file: ${title}`,
      sourceTable: 'personnel_documents',
      sourceTableUuid: id,
      data: { personnelDocumentId: id },
    });
  }
}
