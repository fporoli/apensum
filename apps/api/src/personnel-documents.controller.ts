import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import type { Response } from 'express';
import { categoryKeys, categoryRules, personnelDocError, PERSONNEL_CATEGORY_LIST } from '@worktime3/shared/personnelDocs';
import { DbService, type Db } from './db.service';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';
import { callerUserId, can, isManagerOf, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { NotificationsService } from './notifications.service';
import { VersionsService } from './versions.service';
import { AuditService } from './audit.service';

export const PERSONNEL_OBJECT = 'section.people.documents';

const UUID = /^[0-9a-f-]{36}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface PersonnelValues {
  title?: string;
  category?: string;
  document_date?: string | null;
  effective_date?: string | null;
  follow_up_date?: string | null;
  visible_to_employee?: boolean;
  visible_to_manager?: boolean;
  require_ack?: boolean;
}

/** Multipart sends strings. */
const flag = (v: unknown) => v === true || v === 'true';

/**
 * Validates the fields of a personnel document (create and update; `partial` = only what is given). The category
 * is one of the organization's (`categories`, static data personnel/document_category).
 */
export function parsePersonnelFields(
  body: Record<string, unknown>,
  partial: boolean,
  categories: readonly string[],
): { ok: true; values: PersonnelValues } | { ok: false; error: string } {
  const values: PersonnelValues = {};
  if (body.title !== undefined || !partial) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : '';
    if (!title) return { ok: false, error: 'title-required' };
    values.title = title;
  }
  if (body.category !== undefined || !partial) {
    if (typeof body.category !== 'string' || !categories.includes(body.category)) return { ok: false, error: 'invalid-category' };
    values.category = body.category;
  }
  const dates = [['documentDate', 'document_date'], ['effectiveDate', 'effective_date'], ['followUpDate', 'follow_up_date']] as const;
  for (const [field, column] of dates) {
    const v = body[field];
    if (v === undefined) continue;
    if (v === null || v === '') values[column] = null;
    else if (typeof v === 'string' && ISO.test(v)) values[column] = v;
    else return { ok: false, error: 'invalid-date' };
  }
  if (body.visibleToEmployee !== undefined) values.visible_to_employee = flag(body.visibleToEmployee);
  if (body.visibleToManager !== undefined) values.visible_to_manager = flag(body.visibleToManager);
  if (body.requireAck !== undefined) values.require_ack = flag(body.requireAck);
  return { ok: true, values };
}

interface Row {
  id: string;
  user_id: string;
  document_id: string;
  title: string;
  category: string;
  document_date: string | null;
  effective_date: string | null;
  follow_up_date: string | null;
  visible_to_employee: boolean;
  visible_to_manager: boolean;
  require_ack: boolean;
  acknowledged_at: string | null;
  uploaded_by_user_id: string | null;
}

type Access = { callerId: string; self: boolean; manager: boolean; edit: boolean };

/**
 * Personnel file (HR dossier): documents HR keeps for a person (reviews, salary letters, contracts, references).
 * Access is the `section.people.documents` grant (HR by default), not the reporting line. HR shares a document
 * with the person (their Documents page) and, separately, with the person's manager in force; nobody else in the
 * line sees it. A person never edits their own file; they see what was shared with them and confirm what HR asks
 * them to. Categories are static data (personnel/document_category) whose properties say what each needs.
 * Files are encrypted at rest (DocumentsService). The audit log names no titles, categories or files.
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
      SELECT p.id, p.title, p.category, to_char(p.document_date, 'YYYY-MM-DD') AS document_date,
             to_char(p.effective_date, 'YYYY-MM-DD') AS effective_date,
             ${access.self || access.manager ? sql`NULL` : sql`to_char(p.follow_up_date, 'YYYY-MM-DD')`} AS follow_up_date,
             p.visible_to_employee, p.visible_to_manager, p.require_ack,
             to_char(p.acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS acknowledged_at,
             d.id AS document_id, d.file_name, d.mime_type, d.size_bytes,
             to_char(d.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS added_at,
             coalesce(u.display_name, u.email) AS uploaded_by
      FROM personnel_documents p
      JOIN documents d ON d.id = p.document_id
      LEFT JOIN users u ON u.id = p.uploaded_by_user_id
      WHERE p.organization_id = ${orgId} AND p.user_id = ${userId} ${this.visibleTo(access)}
      ORDER BY coalesce(p.effective_date, p.document_date, d.created_at::date) DESC, d.created_at DESC`);
    return {
      ok: true,
      documents: rows.rows,
      canEdit: access.edit,
      self: access.self,
      manager: access.manager,
      categories: await this.categoryRow(db, orgId),
    };
  }

  /**
   * Adds a document: multipart `file`, `title`, `category`, optional `documentDate`, `effectiveDate`,
   * `followUpDate`, `visibleToEmployee`, `visibleToManager`, `requireAck`.
   */
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
    const categories = await this.categoryRow(db, orgId);
    const parsed = parsePersonnelFields(body ?? {}, false, categoryKeys(categories.values));
    if (!parsed.ok) return parsed;
    const v = parsed.values;
    const stateError = personnelDocError(
      { category: v.category as string, effectiveDate: v.effective_date ?? null, visibleToEmployee: !!v.visible_to_employee, requireAck: !!v.require_ack },
      categoryRules(categories.values[v.category as string]),
    );
    if (stateError) return { ok: false, error: stateError };
    const id = (await db.execute(sql`SELECT uuid_generate_v4() AS id`)).rows[0].id as string;
    const documentId = await this.documents.upload(db, orgId, access.callerId, file, { table: 'personnel_documents', id });
    await db.execute(sql`
      INSERT INTO personnel_documents (id, organization_id, user_id, document_id, title, category, document_date, effective_date, follow_up_date,
                                       visible_to_employee, visible_to_manager, require_ack, uploaded_by_user_id)
      VALUES (${id}, ${orgId}, ${userId}, ${documentId}, ${v.title}, ${v.category}, ${v.document_date ?? null}, ${v.effective_date ?? null}, ${v.follow_up_date ?? null},
              ${v.visible_to_employee ?? false}, ${v.visible_to_manager ?? false}, ${v.require_ack ?? false}, ${access.callerId})`);
    void this.versions.record('personnel_documents', id, 'insert', access.callerId, { userId, documentId, ...v, fileName: file.originalname }).catch(() => {});
    void this.audit.record(orgId, access.callerId, 'personnel-document.upload', 'personnel_document', id, { userId }).catch(() => {});
    if (v.visible_to_employee) await this.notifyPerson(orgId, userId, id, v.title as string, !!v.require_ack).catch(() => {});
    if (v.visible_to_manager) await this.notifyManager(db, orgId, userId, id).catch(() => {});
    return { ok: true, id };
  }

  /** Changes the fields, who sees it and whether the person confirms it. */
  @Patch(':id')
  async update(@Param('orgId') orgId: string, @Param('userId') userId: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const access = await this.access(db, orgId, userId, req, 'edit');
    if (!access?.edit) return { ok: false, error: 'forbidden' };
    const row = await this.load(db, orgId, userId, id);
    if (!row) return { ok: false, error: 'not-found' };
    const categories = await this.categoryRow(db, orgId);
    // A category no longer in the list may stay on its document; a new one must be in the list.
    const keys = [...new Set([...categoryKeys(categories.values), row.category])];
    const parsed = parsePersonnelFields(body ?? {}, true, keys);
    if (!parsed.ok) return parsed;
    const v = parsed.values;
    const next = {
      category: v.category ?? row.category,
      effectiveDate: v.effective_date === undefined ? row.effective_date : v.effective_date,
      visibleToEmployee: v.visible_to_employee ?? row.visible_to_employee,
      requireAck: v.require_ack ?? row.require_ack,
    };
    const stateError = personnelDocError(next, categoryRules(categories.values[next.category]));
    if (stateError) return { ok: false, error: stateError };
    const keep = (column: string, value: unknown) => (value === undefined ? sql.identifier(column) : sql`${value}`);
    await db.execute(sql`
      UPDATE personnel_documents SET
        title = ${keep('title', v.title)},
        category = ${keep('category', v.category)},
        document_date = ${v.document_date === undefined ? sql`document_date` : sql`${v.document_date}::date`},
        effective_date = ${v.effective_date === undefined ? sql`effective_date` : sql`${v.effective_date}::date`},
        follow_up_date = ${v.follow_up_date === undefined ? sql`follow_up_date` : sql`${v.follow_up_date}::date`},
        visible_to_employee = ${keep('visible_to_employee', v.visible_to_employee)},
        visible_to_manager = ${keep('visible_to_manager', v.visible_to_manager)},
        require_ack = ${keep('require_ack', v.require_ack)}
      WHERE id = ${id}`);
    void this.versions.record('personnel_documents', id, 'update_delta', access.callerId, v).catch(() => {});
    const title = v.title ?? row.title;
    if (v.visible_to_employee !== undefined && v.visible_to_employee !== row.visible_to_employee) {
      void this.audit.record(orgId, access.callerId, v.visible_to_employee ? 'personnel-document.share' : 'personnel-document.unshare', 'personnel_document', id, { userId }).catch(() => {});
    }
    if (v.visible_to_manager !== undefined && v.visible_to_manager !== row.visible_to_manager) {
      void this.audit.record(orgId, access.callerId, v.visible_to_manager ? 'personnel-document.share-manager' : 'personnel-document.unshare-manager', 'personnel_document', id, { userId }).catch(() => {});
      if (v.visible_to_manager) await this.notifyManager(db, orgId, userId, id).catch(() => {});
    }
    // Newly shared, or newly asked to confirm (and not confirmed yet): the person hears of it.
    const newlyShared = next.visibleToEmployee && !row.visible_to_employee;
    const newlyAsked = next.visibleToEmployee && next.requireAck && !row.require_ack && !row.acknowledged_at;
    if (newlyShared || newlyAsked) await this.notifyPerson(orgId, userId, id, title, next.requireAck && !row.acknowledged_at).catch(() => {});
    return { ok: true };
  }

  /** The person confirms a document HR asked them to ("taken note"); once. */
  @Post(':id/acknowledge')
  async acknowledge(@Param('orgId') orgId: string, @Param('userId') userId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const access = await this.access(db, orgId, userId, req, 'see');
    if (!access?.self) return { ok: false, error: 'forbidden' };
    const row = await this.load(db, orgId, userId, id);
    if (!row || !row.visible_to_employee) return { ok: false, error: 'not-found' };
    if (!row.require_ack) return { ok: false, error: 'no-confirmation-asked' };
    if (row.acknowledged_at) return { ok: true, acknowledgedAt: row.acknowledged_at };
    const at = new Date().toISOString();
    await db.execute(sql`UPDATE personnel_documents SET acknowledged_at = ${at} WHERE id = ${id} AND acknowledged_at IS NULL`);
    void this.versions.record('personnel_documents', id, 'update_delta', access.callerId, { acknowledged_at: at }).catch(() => {});
    void this.audit.record(orgId, access.callerId, 'personnel-document.acknowledge', 'personnel_document', id, { userId }).catch(() => {});
    if (row.uploaded_by_user_id && row.uploaded_by_user_id !== userId) {
      await this.notifications
        .notifyMany({
          organizationId: orgId,
          recipientUserIds: [row.uploaded_by_user_id],
          type: 'personnel-document.acknowledged',
          title: `A document in a personnel file was confirmed: ${row.title}`,
          text: { key: 'notice.personnelDoc.confirmed', vars: { title: row.title } },
          sourceTable: 'personnel_documents',
          sourceTableUuid: id,
          data: { personnelDocumentId: id, userId },
        })
        .catch(() => {});
    }
    return { ok: true, acknowledgedAt: at };
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
    const allowed = !!row && !!access && (access.self ? row.visible_to_employee : access.manager ? row.visible_to_manager : true);
    const doc = db && row && allowed ? await this.documents.get(db, row.document_id) : undefined;
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    await this.documents.send(res, doc);
  }

  /**
   * The caller's access to `userId`'s file: through the grant; their own (shared documents, read only); or as the
   * person's manager in force (documents HR shared with the manager, read only).
   */
  private async access(db: Db, orgId: string, userId: string, req: AuthenticatedRequest, action: 'see' | 'edit'): Promise<Access | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !UUID.test(userId) || !(await isOrgMember(db, orgId, callerId)) || !(await isOrgMember(db, orgId, userId))) return null;
    if (userId === callerId) return action === 'see' ? { callerId, self: true, manager: false, edit: false } : null;
    if (await can(db, orgId, callerId, PERSONNEL_OBJECT, 'see', userId)) {
      return { callerId, self: false, manager: false, edit: await can(db, orgId, callerId, PERSONNEL_OBJECT, 'edit', userId) };
    }
    if (action === 'see' && (await isManagerOf(db, orgId, callerId, userId))) return { callerId, self: false, manager: true, edit: false };
    return null;
  }

  private visibleTo(access: Access) {
    if (access.self) return sql`AND p.visible_to_employee`;
    if (access.manager) return sql`AND p.visible_to_manager`;
    return sql``;
  }

  /** The organization's categories: its own copy of personnel/document_category, else the global one. */
  private async categoryRow(db: Db, orgId: string): Promise<{ values: Record<string, unknown>; translation: Record<string, Record<string, string>> }> {
    const rows = await db.execute(sql`
      SELECT "values", translation FROM static_data
      WHERE entity = ${PERSONNEL_CATEGORY_LIST.entity} AND enum_name = ${PERSONNEL_CATEGORY_LIST.enumName}
        AND (organization_id = ${orgId} OR organization_id IS NULL)
      ORDER BY organization_id NULLS LAST LIMIT 1`);
    const r = rows.rows[0] as { values?: Record<string, unknown>; translation?: Record<string, Record<string, string>> } | undefined;
    return { values: r?.values ?? {}, translation: r?.translation ?? {} };
  }

  private async load(db: Db, orgId: string, userId: string, id: string): Promise<Row | null> {
    if (!UUID.test(id)) return null;
    const rows = await db.execute(sql`
      SELECT id, user_id, document_id, title, category, to_char(document_date, 'YYYY-MM-DD') AS document_date,
             to_char(effective_date, 'YYYY-MM-DD') AS effective_date, to_char(follow_up_date, 'YYYY-MM-DD') AS follow_up_date,
             visible_to_employee, visible_to_manager, require_ack,
             to_char(acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS acknowledged_at, uploaded_by_user_id
      FROM personnel_documents WHERE id = ${id} AND organization_id = ${orgId} AND user_id = ${userId}`);
    return (rows.rows[0] as unknown as Row) ?? null;
  }

  private async notifyPerson(orgId: string, userId: string, id: string, title: string, confirm: boolean) {
    await this.notifications.notifyMany({
      organizationId: orgId,
      recipientUserIds: [userId],
      type: confirm ? 'personnel-document.confirm' : 'personnel-document.shared',
      title: confirm ? `Please confirm a document in your file: ${title}` : `New document in your file: ${title}`,
      sourceTable: 'personnel_documents',
      sourceTableUuid: id,
      data: { personnelDocumentId: id },
    });
  }

  /** The person's manager in force hears that HR shared a document of the person with them (no title: it may say more than the manager should read in a list). */
  private async notifyManager(db: Db, orgId: string, userId: string, id: string) {
    const rows = await db.execute(sql`
      SELECT a.manager_user_id, coalesce(u.display_name, u.email) AS name
      FROM employee_assignments a JOIN users u ON u.id = a.user_id
      WHERE a.organization_id = ${orgId} AND a.user_id = ${userId} AND a.valid_from <= CURRENT_DATE
      ORDER BY a.valid_from DESC LIMIT 1`);
    const r = rows.rows[0] as { manager_user_id: string | null; name: string } | undefined;
    if (!r?.manager_user_id || r.manager_user_id === userId) return;
    await this.notifications.notifyMany({
      organizationId: orgId,
      recipientUserIds: [r.manager_user_id],
      type: 'personnel-document.manager',
      title: `HR shared a document of ${r.name} with you`,
      text: { key: 'notice.personnelDoc.manager', vars: { name: r.name } },
      sourceTable: 'personnel_documents',
      sourceTableUuid: id,
      data: { personnelDocumentId: id, userId },
    });
  }
}
