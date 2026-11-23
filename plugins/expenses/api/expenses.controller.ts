import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, asc, desc, eq, getTableColumns, gte, isNull, lt, sql, type SQL } from 'drizzle-orm';
import { listPage, pageRows } from './list-page';
import { join } from 'node:path';
import type { Response } from 'express';
import { DbService, type Db, VersionsService, callerUserId, can, canSeeUserData, isOrgMember, reachesAll, type AuthenticatedRequest, DocumentsService, MAX_DOCUMENT_BYTES, FieldsService } from '@worktime3/api/plugin';
import { projects, subprojects } from '@worktime3/api/schema';
import { expenses, expense_report_items, expense_reports } from './db/schema';
import { mergeForm, validateFields, type ResolvedForm } from '@worktime3/shared/fields';
import { EXPENSE_FORM } from '../shared/form';
import { BOOKING_COLUMNS, bookColumns, bookingContext } from './expense-booking';
import { isRateCategory } from '../shared/booking';
import { ExpenseReceiptService } from './expense-receipt.service';

type ExpenseColumns = Partial<typeof expenses.$inferInsert>;

/**
 * Maps validated form values (keyed like the registry, which matches the request body) to
 * `expenses` columns. Only keys present in `values` are mapped; empty values become NULL.
 */
export function expenseColumns(values: Record<string, unknown>): ExpenseColumns {
  const out: Record<string, unknown> = {};
  for (const field of EXPENSE_FORM.fields) {
    if (field.storage.kind !== 'column' || !(field.key in values)) continue;
    const v = values[field.key];
    const empty = v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
    out[field.storage.column] = empty ? null : field.type === 'number' ? String(v) : v;
  }
  return out as ExpenseColumns;
}

/** Values of the template's custom fields, for `expenses.data`; empty values become null. */
export function expenseCustomData(form: ResolvedForm, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (!field.custom || field.retired || !(field.key in values)) continue;
    const v = values[field.key];
    out[field.key] = v === undefined || (typeof v === 'string' && v.trim() === '') ? null : v;
  }
  return out;
}

/**
 * The form's fields present in the body (all of them when `all`, so a create checks required
 * ones). Retired custom fields are left out, so they are never written.
 */
function pickFields(form: ResolvedForm, body: Record<string, unknown>, all: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of form.fields) {
    if (field.retired) continue;
    if (all || field.key in body) out[field.key] = body[field.key];
  }
  return out;
}

/** An expense not worked out from a rate, without receipt amount while the form shows that field: the field error, else null. */
export function missingReceiptAmount(row: Record<string, unknown>, receiptShown: boolean) {
  if (!receiptShown || isRateCategory(typeof row.category === 'string' ? row.category : null)) return null;
  if (row.original_value !== null && row.original_value !== undefined && row.original_value !== '') return null;
  return { ok: false as const, error: 'invalid-field', fields: [{ field: 'originalValue', rule: 'required' }] };
}

@Controller()
export class ExpensesController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
    private readonly documents: DocumentsService,
    private readonly fields: FieldsService,
    private readonly receipts: ExpenseReceiptService,
  ) {}

  /** Whether receipt recognition is offered (the instance has Azure OpenAI); the form shows the button then. */
  @Get('organizations/:orgId/expenses/scan-receipt')
  async scanAvailable(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    const callerId = db && req.user ? await callerUserId(db, req.user) : null;
    if (!db || !callerId || !(await can(db, orgId, callerId, 'nav.expenses', 'see'))) return { ok: true, available: false };
    return { ok: true, available: this.receipts.available() };
  }

  /**
   * Reads a receipt (photo or PDF) and returns a suggestion for the form: date, amount, currency,
   * merchant, category. Nothing is stored; the person checks and saves the form as usual.
   * Errors are returned like every other expense error ({ ok: false, error }).
   */
  @Post('organizations/:orgId/expenses/scan-receipt')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 } }))
  async scanReceipt(@Param('orgId') orgId: string, @UploadedFile() file: Express.Multer.File, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unknown-user' };
    if (!(await can(db, orgId, callerId, 'nav.expenses', 'see'))) return { ok: false, error: 'forbidden' };
    if (!file?.buffer?.length) return { ok: false, error: 'file-required' };
    const rows = await db.execute(sql`
      SELECT "values" FROM static_data
      WHERE entity = 'expenses' AND enum_name = 'expense_category' AND (organization_id = ${orgId}::uuid OR organization_id IS NULL)
      ORDER BY organization_id NULLS LAST LIMIT 1
    `);
    const categories = ((rows.rows[0] as { values?: Record<string, string> } | undefined)?.values) ?? {};
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
    try {
      return { ok: true, suggestion: await this.receipts.scan(orgId, callerId, file.buffer, categories, today) };
    } catch (error) {
      if (error instanceof HttpException) return { ok: false, error: String(error.message) };
      throw error;
    }
  }

  /**
   * Checks the body against the org's merged expense template (code fields and custom fields);
   * returns the columns to write and the custom values for `expenses.data`.
   */
  private async validate(orgId: string, body: Record<string, unknown>, all: boolean) {
    const form = (await this.fields.resolved(orgId, EXPENSE_FORM.id)) ?? mergeForm(EXPENSE_FORM);
    const { errors, values } = validateFields(form, pickFields(form, body, all));
    if (errors.length > 0) return { ok: false as const, error: 'invalid-field', fields: errors };
    // The receipt amount is what the booked amount is worked out from: required while the form shows it
    // (a template that hides it lets people enter the booked amount directly), never for mileage.
    const receiptShown = form.fields.some((f) => f.key === 'originalValue' && !f.hidden && !f.retired);
    return { ok: true as const, columns: expenseColumns(values), data: expenseCustomData(form, values), receiptShown };
  }

  @Post('organizations/:orgId/expenses')
  async create(
    @Param('orgId') orgId: string,
    @Body()
    body: {
      expenseDate: string;
      category: string;
      subCategory?: string;
      originalValue?: number;
      originalCurrency?: string;
      currency: string;
      value?: number;
      /** The booked amount of a foreign receipt was entered by hand (expenses.ts bookExpense). */
      valueOverride?: boolean;
      quantity?: number;
      comment?: string;
      projectId?: string;
      subprojectId?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    // The expense always belongs to the caller — never trust a client-supplied user id.
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'forbidden' };
    const checked = await this.validate(orgId, body ?? {}, true);
    if (!checked.ok) return checked;
    const missing = missingReceiptAmount(checked.columns as Record<string, unknown>, checked.receiptShown);
    if (missing) return missing;
    // The booked amount in the reporting currency (receipt x exchange rate, or km x rate), never the client's.
    const booked = bookColumns(checked.columns as Record<string, unknown>, await bookingContext(db, orgId), body?.valueOverride === true);
    if (!booked.ok) return booked;
    const values = {
      ...checked.columns,
      ...booked.columns,
      data: checked.data,
      user_id: userId,
      organization_id: orgId,
    } as typeof expenses.$inferInsert;
    const [row] = await db.insert(expenses).values(values).returning({ id: expenses.id });
    void this.versions.record('expenses', row.id, 'insert', userId, { id: row.id, ...values }).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Get('organizations/:orgId/expenses')
  async list(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('unmapped') unmapped?: string,
    @Query('category') category?: string,
    @Query('subCategory') subCategory?: string,
  ) {
    const paging = listPage(page, pageSize);
    const empty = paging ? pageRows([], paging.size) : { entries: [] };
    const db = this.db.getDb();
    if (!db) return empty;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return empty;

    let targetUserId = userId;
    if (targetUserId && targetUserId !== callerId) {
      if (!(await canSeeUserData(db, orgId, callerId, 'nav.expenses', targetUserId))) {
        return empty;
      }
    } else if (!targetUserId && !(await reachesAll(db, orgId, callerId, 'nav.expenses'))) {
      // No person asked for: everyone's entries only for grants reaching all; otherwise one's own.
      targetUserId = callerId;
    }

    const conditions: SQL[] = [eq(expenses.organization_id, orgId)];
    if (targetUserId) conditions.push(eq(expenses.user_id, targetUserId));
    if (from) conditions.push(gte(expenses.expense_date, from));
    if (to) conditions.push(lt(expenses.expense_date, to));
    if (unmapped === 'true') conditions.push(isNull(expense_report_items.expense_id));
    if (category) conditions.push(eq(expenses.category, category));
    if (subCategory) conditions.push(eq(expenses.sub_category, subCategory));

    // Names + report mapping come along so the UI can list expenses (and whether/where
    // each is attached) without a lookup per row.
    const query = db
      .select({
        ...getTableColumns(expenses),
        project_name: projects.name,
        subproject_name: subprojects.name,
        expense_report_id: expense_report_items.expense_report_id,
        expense_report_status: expense_reports.status,
      })
      .from(expenses)
      .leftJoin(projects, eq(projects.id, expenses.project_id))
      .leftJoin(subprojects, eq(subprojects.id, expenses.subproject_id))
      .leftJoin(expense_report_items, eq(expense_report_items.expense_id, expenses.id))
      .leftJoin(expense_reports, eq(expense_reports.id, expense_report_items.expense_report_id))
      .where(and(...conditions));

    if (!paging) return { entries: await query.orderBy(asc(expenses.expense_date)) };
    const rows = await query.orderBy(desc(expenses.expense_date), desc(expenses.id)).limit(paging.size + 1).offset(paging.offset);
    return pageRows(rows, paging.size);
  }

  @Patch('expenses/:id')
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      projectId?: string | null;
      subprojectId?: string | null;
      expenseDate?: string;
      category?: string;
      subCategory?: string | null;
      originalValue?: number | null;
      originalCurrency?: string | null;
      currency?: string;
      value?: number;
      valueOverride?: boolean;
      quantity?: number | null;
      comment?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableExpense(db, id, req);
    if ('error' in owned) return owned;

    const checked = await this.validate(owned.entry.organization_id as string, body ?? {}, false);
    if (!checked.ok) return checked;
    const delta: Record<string, unknown> = { ...checked.columns };
    // Rebooked when anything that decides the amount changes (an older, unconverted expense in another
    // currency stays as it is until then); otherwise left exactly as booked.
    if (BOOKING_COLUMNS.some((c) => c in delta)) {
      const missing = missingReceiptAmount({ ...owned.entry, ...delta }, checked.receiptShown);
      if (missing) return missing;
      const booked = bookColumns({ ...owned.entry, ...delta }, await bookingContext(db, owned.entry.organization_id as string), body?.valueOverride === true);
      if (!booked.ok) return booked;
      Object.assign(delta, booked.columns);
    }
    const hasData = Object.keys(checked.data).length > 0;
    if (Object.keys(delta).length === 0 && !hasData) return { ok: true };
    // Custom values merge into `data` key by key; the history records only what changed.
    const set = hasData ? { ...delta, data: sql`${expenses.data} || ${JSON.stringify(checked.data)}::jsonb` } : delta;
    await db.update(expenses).set(set).where(eq(expenses.id, id));
    void this.versions.record('expenses', id, 'update_delta', owned.userId, hasData ? { ...delta, data: checked.data } : delta).catch(() => {});
    return { ok: true };
  }

  @Delete('expenses/:id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableExpense(db, id, req);
    if ('error' in owned) return owned;
    // An expense attached to a report isn't silently unmapped by ON DELETE CASCADE —
    // the caller must detach it first (see ExpenseReportsController's item endpoints).
    const [mapped] = await db
      .select({ id: expense_report_items.id })
      .from(expense_report_items)
      .where(eq(expense_report_items.expense_id, id));
    if (mapped) return { ok: false, error: 'expense-mapped' };
    await db.delete(expenses).where(eq(expenses.id, id));
    void this.versions.record('expenses', id, 'delete', owned.userId, owned.entry).catch(() => {});
    return { ok: true };
  }

  /** Evidence upload for an expense (e.g. a pay slip) — the expense's own owner. Replaces any existing one. */
  @Post('expenses/:id/document')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }))
  async uploadDocument(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableExpense(db, id, req);
    if ('error' in owned) return owned;
    if (!file) return { ok: false, error: 'file-required' };

    const organizationId = owned.entry.organization_id as string;
    const previousDocId = owned.entry.document_id as string | null;
    const newDocId = await this.documents.upload(db, organizationId, owned.userId, file, { table: 'expenses', id });
    await db.update(expenses).set({ document_id: newDocId }).where(eq(expenses.id, id));
    if (previousDocId) await this.documents.remove(db, previousDocId);
    void this.versions.record('expenses', id, 'update_delta', owned.userId, { document_id: newDocId }).catch(() => {});
    return { ok: true, id: newDocId };
  }

  @Get('expenses/:id/document/meta')
  async getDocumentMeta(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return null;
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return null;
    const [row] = await db.select({ user_id: expenses.user_id, organization_id: expenses.organization_id, document_id: expenses.document_id }).from(expenses).where(eq(expenses.id, id));
    if (!row?.document_id) return null;
    if (!(await canSeeUserData(db, row.organization_id, callerId, 'nav.expenses', row.user_id))) return null;

    const doc = await this.documents.get(db, row.document_id);
    if (!doc) return null;
    return { id: doc.id, file_name: doc.file_name, mime_type: doc.mime_type, size_bytes: doc.size_bytes, created_at: doc.created_at };
  }

  @Get('expenses/:id/document')
  async downloadDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest, @Res() res: Response): Promise<void> {
    const db = this.db.getDb();
    const callerId = db && req.user ? await callerUserId(db, req.user) : null;
    if (!db || !callerId) {
      res.status(401).json({ ok: false, error: 'unauthenticated' });
      return;
    }
    const [row] = await db.select({ user_id: expenses.user_id, organization_id: expenses.organization_id, document_id: expenses.document_id }).from(expenses).where(eq(expenses.id, id));
    if (!row?.document_id) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    if (!(await canSeeUserData(db, row.organization_id, callerId, 'nav.expenses', row.user_id))) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    const doc = await this.documents.get(db, row.document_id);
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    await this.documents.send(res, doc);
  }

  @Delete('expenses/:id/document')
  async deleteDocument(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const owned = await this.assertEditableExpense(db, id, req);
    if ('error' in owned) return owned;
    const documentId = owned.entry.document_id as string | null;
    if (!documentId) return { ok: false, error: 'not-found' };

    await db.update(expenses).set({ document_id: null }).where(eq(expenses.id, id));
    await this.documents.remove(db, documentId);
    void this.versions.record('expenses', id, 'update_delta', owned.userId, { document_id: null }).catch(() => {});
    return { ok: true };
  }

  /**
   * Expenses are only editable by the user they belong to. Returns `{error}`
   * when disallowed, or the entry (plus caller id) when the edit may proceed.
   */
  private async assertEditableExpense(
    db: Db,
    id: string,
    req: AuthenticatedRequest,
  ): Promise<
    | { ok: false; error: string }
    | { userId: string; entry: Record<string, unknown> }
  > {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) return { ok: false, error: 'unknown-user' };
    const [row] = await db.select().from(expenses).where(eq(expenses.id, id));
    if (!row) return { ok: false, error: 'not-found' };
    if (row.user_id !== userId) return { ok: false, error: 'forbidden' };
    return { userId, entry: row };
  }
}
