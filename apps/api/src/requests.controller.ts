import { Body, Controller, Get, Param, Post, Query, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { sql, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';
import { callerUserId, can, isOrgMember, membershipManagerId, reachesAll, type Executor } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { NotificationsService } from './notifications.service';
import { VersionsService } from './versions.service';
import { ForwardMailService, type ForwardInput } from './forward-mail.service';
import { cleanDueDate, cleanRequestLink, requestTypeConfidential, requestTypeKeys } from '@worktime3/shared/requests';
import { REQUEST_FORM, customValuesErrors, customValuesToSave, mergeForm } from '@worktime3/shared/fields';
import { FieldsService } from './fields.service';
import { RequestsService, currentAssignments } from './requests.service';

/**
 * Requests (module "requests", packages/shared/src/modules.ts; tables in 052-requests.sql):
 * a ticket a person sends to their line manager or to a department, with a message thread.
 *
 * Who handles a request is never stored; it is worked out when asked:
 * - to the manager: the requester's manager in force (employee_assignments), so it moves with
 *   a manager change, like the approvals;
 * - to a department: everyone whose assignment in force is in it, and its leader;
 * - plus anyone with `nav.requests:edit:all` (admin), for the whole organization.
 * Everyone involved needs `nav.requests` (which a switched-off module takes away); sending
 * needs `nav.requests:edit`. Every change notifies the other side (NotificationsService).
 *
 * A request may have a due date (RequestsService mails the handlers once it has passed while the
 * request is open), and modules or plugins open requests themselves (`RequestsService.openTask`):
 * those have no requester but a `source` (shown as the sender) and the page they are about.
 *
 * A request of a confidential type (static_data attribute `confidential`, copied onto the request) is
 * seen only by the requester and its handlers: `nav.requests:edit:all` does not reach it, notifications
 * carry no text, and "Send by e-mail" and the AI assistant leave it alone. The organization's own
 * fields (configurable form `request`, design mode on the Requests page) are in `custom`.
 */

export type RequestStatus = 'open' | 'in_progress' | 'resolved';
export const REQUEST_STATUSES: readonly RequestStatus[] = ['open', 'in_progress', 'resolved'];
const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;
/** Attachments per message (each at most MAX_DOCUMENT_BYTES). */
export const MAX_ATTACHMENTS = 10;
/** Multipart uploads: the `files` field, limited like other documents. JSON bodies pass through untouched. */
const Attachments = () => FilesInterceptor('files', MAX_ATTACHMENTS, { limits: { fileSize: MAX_DOCUMENT_BYTES, files: MAX_ATTACHMENTS } });

/** A message preview for notifications: its text, else the attached file names. */
export function messagePreview(text: string | null, fileNames: string[]): string {
  if (text) return text.slice(0, 200);
  return `📎 ${fileNames.join(', ')}`.slice(0, 200);
}

/** Trimmed text within `max` characters, or null when empty or too long. */
export function cleanRequestText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

/**
 * Whether a status change is allowed. Handlers move a request freely between the statuses; the
 * requester can only mark their own request resolved (done, or withdrawn) or reopen it.
 * Archived requests are read-only until a handler unarchives them.
 */
export function canChangeStatus(from: RequestStatus, to: RequestStatus, who: { handler: boolean; requester: boolean }, archived: boolean): boolean {
  if (archived || from === to || !REQUEST_STATUSES.includes(to)) return false;
  if (who.handler) return true;
  if (who.requester) return to === 'resolved' || (from === 'resolved' && to === 'open');
  return false;
}

/** The fields a request's type, urgency and link are stored in. */
export interface RequestDetails {
  request_type?: string | null;
  urgent?: boolean;
  link_url?: string | null;
  due_date?: string | null;
}

/** A flag from JSON (`true`) or a multipart form (`'true'`). */
function flag(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return value === true || value === 'true' || value === '1';
}

/**
 * Validates a request's type, urgency and link. `typeKeys` are the org's request types (its
 * static_data row). On create (`current` absent) every field is set: the type is required when the
 * org has types. On an update only the fields present change; a request keeps an older type the
 * org no longer lists, but can't be moved to one.
 */
export function validateRequestDetails(
  input: { type?: unknown; urgent?: unknown; link?: unknown; dueDate?: unknown },
  typeKeys: string[],
  current?: { request_type: string | null },
): { ok: true; value: RequestDetails } | { ok: false; error: string } {
  const value: RequestDetails = {};
  if (!current || input.type !== undefined) {
    const type = typeof input.type === 'string' && input.type.trim() ? input.type.trim() : null;
    if (type === null) {
      if (typeKeys.length > 0) return { ok: false, error: 'request-type-required' };
    } else if (!typeKeys.includes(type) && type !== current?.request_type) {
      return { ok: false, error: 'unknown-request-type' };
    }
    value.request_type = type;
  }
  if (!current || input.urgent !== undefined) value.urgent = flag(input.urgent) ?? false;
  if (!current || input.link !== undefined) {
    const link = cleanRequestLink(input.link);
    if (link === undefined) return { ok: false, error: 'invalid-link' };
    value.link_url = link;
  }
  if (!current || input.dueDate !== undefined) {
    const due = cleanDueDate(input.dueDate);
    if (due === undefined) return { ok: false, error: 'invalid-due-date' };
    value.due_date = due;
  }
  return { ok: true, value };
}

/**
 * SQL condition (over `r` = requests, `rc` = the requester's current assignment, `d` = the
 * target department) for "the caller handles this request".
 */
function handlesCondition(orgId: string, callerId: string, handlesAll: boolean): SQL {
  const own = ownHandlesCondition(orgId, callerId);
  // `nav.requests:edit:all` reaches every request but the confidential ones.
  return handlesAll ? sql`(NOT r.confidential OR ${own})` : own;
}

function ownHandlesCondition(orgId: string, callerId: string): SQL {
  return sql`((r.target_kind = 'manager' AND rc.manager_user_id = ${callerId})
          OR (r.target_kind = 'department' AND (d.leader_user_id = ${callerId}
              OR r.target_department_id = (SELECT department_id FROM (${currentAssignments(orgId)}) me WHERE me.user_id = ${callerId}))))`;
}

/** A timestamptz column as an ISO string (raw queries otherwise return Postgres's text format). */
const iso = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

const LIST_COLUMNS = sql`r.id, r.subject, r.status, r.request_type, r.urgent, r.link_url, r.target_kind, r.target_department_id, d.name AS department_name,
  r.due_date::text AS due_date, r.source, r.source_section, r.confidential, r.custom,
  (r.due_date < (now() AT TIME ZONE 'Europe/Zurich')::date AND r.status <> 'resolved' AND r.archived_at IS NULL) AS overdue,
  r.requester_user_id, ru.display_name AS requester_name, ru.email AS requester_email,
  r.assignee_user_id, au.display_name AS assignee_name,
  ${iso('r.opened_at')} AS opened_at, ${iso('r.last_activity_at')} AS last_activity_at,
  ${iso('r.resolved_at')} AS resolved_at, ${iso('r.archived_at')} AS archived_at,
  (SELECT count(*)::int FROM request_messages m WHERE m.request_id = r.id AND m.kind = 'message') AS message_count`;

const LIST_FROM = (orgId: string) => sql`FROM requests r
  LEFT JOIN (${currentAssignments(orgId)}) rc ON rc.user_id = r.requester_user_id
  LEFT JOIN departments d ON d.id = r.target_department_id
  LEFT JOIN users ru ON ru.id = r.requester_user_id
  LEFT JOIN users au ON au.id = r.assignee_user_id`;

interface RequestRow {
  id: string;
  organization_id: string;
  requester_user_id: string | null;
  target_kind: 'manager' | 'department';
  target_department_id: string | null;
  subject: string;
  status: RequestStatus;
  request_type: string | null;
  urgent: boolean;
  link_url: string | null;
  due_date: string | null;
  confidential: boolean;
  assignee_user_id: string | null;
  archived_at: string | null;
}

const ROW_COLUMNS = sql`id, organization_id, requester_user_id, target_kind, target_department_id, subject, status, request_type, urgent, link_url,
  due_date::text AS due_date, confidential, assignee_user_id, archived_at`;

@Controller('organizations/:orgId/requests')
export class RequestsController {
  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly versions: VersionsService,
    private readonly documents: DocumentsService,
    private readonly forwardMail: ForwardMailService,
    private readonly requests: RequestsService,
    private readonly fields: FieldsService,
  ) {}

  /**
   * The custom values as the organization's form saves them, or an error. `given` may be a JSON string
   * (multipart). Without `given` (undefined) nothing is checked.
   */
  private async customValues(orgId: string, given: unknown): Promise<{ ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string }> {
    if (given === undefined || given === null || given === '') return { ok: true, value: undefined };
    let values = given;
    if (typeof given === 'string') {
      try {
        values = JSON.parse(given);
      } catch {
        return { ok: false, error: 'invalid-custom' };
      }
    }
    if (!values || typeof values !== 'object' || Array.isArray(values)) return { ok: false, error: 'invalid-custom' };
    const form = (await this.fields.resolved(orgId, REQUEST_FORM.id)) ?? mergeForm(REQUEST_FORM);
    const value = customValuesToSave(form, values as Record<string, unknown>);
    const unknown = Object.keys(values as Record<string, unknown>).filter((k) => !(k in value));
    if (unknown.length || customValuesErrors(form, value).length) return { ok: false, error: 'invalid-custom' };
    return { ok: true, value };
  }

  /** Whether the organization's form has a required custom field (then a new request must fill it). */
  private async customRequired(orgId: string): Promise<boolean> {
    const form = (await this.fields.resolved(orgId, REQUEST_FORM.id)) ?? mergeForm(REQUEST_FORM);
    return customValuesErrors(form, {}).length > 0;
  }

  /** Inserts a message with its attachments (stored through DocumentsService). */
  private async addMessage(db: Db, r: { id: string; organization_id: string }, authorId: string, text: string | null, files: Express.Multer.File[]) {
    const [message] = (
      await db.execute(
        sql`INSERT INTO request_messages (request_id, author_user_id, kind, body) VALUES (${r.id}, ${authorId}, 'message', ${text}) RETURNING id`,
      )
    ).rows as { id: string }[];
    for (const file of files) {
      const documentId = await this.documents.upload(db, r.organization_id, authorId, file, { table: 'request_messages', id: message.id });
      await db.execute(sql`INSERT INTO request_message_documents (message_id, document_id) VALUES (${message.id}, ${documentId})`);
    }
    return message.id;
  }

  /** The caller, when they are a member with any `nav.requests` grant (the module is on). */
  private async caller(db: Executor, orgId: string, req: AuthenticatedRequest): Promise<string | null> {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId || !(await isOrgMember(db, orgId, userId))) return null;
    return (await can(db, orgId, userId, 'nav.requests', 'see')) ? userId : null;
  }

  /** Who handles `r` today (ids), not counting `nav.requests:edit:all`. */
  private handlerIds(db: Executor, r: RequestRow): Promise<string[]> {
    return this.requests.handlerIds(db, r);
  }

  private async load(db: Executor, orgId: string, id: string): Promise<RequestRow | null> {
    const rows = await db.execute(
      sql`SELECT ${ROW_COLUMNS} FROM requests WHERE id = ${id} AND organization_id = ${orgId}`,
    );
    return (rows.rows[0] as unknown as RequestRow) ?? null;
  }

  /** The request and how the caller relates to it; null when they may not see it. */
  private async access(db: Executor, orgId: string, callerId: string, id: string) {
    const r = await this.load(db, orgId, id);
    if (!r) return null;
    const requester = r.requester_user_id === callerId;
    const handler =
      (!r.confidential && (await reachesAll(db, orgId, callerId, 'nav.requests', 'edit'))) || (await this.handlerIds(db, r)).includes(callerId);
    if (!requester && !handler) return null;
    return { r, requester, handler };
  }

  /** Notifies everyone on the other side of `actorId`: the requester, or the assignee (else every handler). */
  private async notifyOthers(db: Executor, r: RequestRow, actorId: string, type: string, title: string, body?: string) {
    const recipients = new Set<string>();
    if (r.requester_user_id && r.requester_user_id !== actorId) recipients.add(r.requester_user_id);
    if (r.assignee_user_id) recipients.add(r.assignee_user_id);
    else if (r.requester_user_id === actorId) for (const id of await this.handlerIds(db, r)) recipients.add(id);
    recipients.delete(actorId);
    await this.notifications.notifyMany({
      organizationId: r.organization_id,
      recipientUserIds: [...recipients],
      type,
      title,
      // A confidential request's notifications carry no text.
      body: r.confidential ? undefined : body,
      sourceTable: 'requests',
      sourceTableUuid: r.id,
      data: { requestId: r.id },
    });
  }

  private async event(db: Executor, requestId: string, actorId: string, data: Record<string, unknown>) {
    await db.execute(
      sql`INSERT INTO request_messages (request_id, author_user_id, kind, data) VALUES (${requestId}, ${actorId}, 'event', ${JSON.stringify(data)}::jsonb)`,
    );
  }

  /** The org's request types (attributes by key): its own static_data row, else the global one. */
  private async typeValues(db: Executor, orgId: string): Promise<unknown> {
    const rows = await db.execute(
      sql`SELECT "values" FROM static_data
          WHERE entity = 'requests' AND enum_name = 'request_type' AND (organization_id = ${orgId} OR organization_id IS NULL)
          ORDER BY organization_id NULLS LAST LIMIT 1`,
    );
    return rows.rows[0]?.values;
  }

  /** Where the caller can send a request: their manager in force, and the organization's active departments. */
  @Get('targets')
  async targets(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, manager: null, departments: [] };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: true, manager: null, departments: [] };
    const managerId = await membershipManagerId(db, orgId, callerId);
    const manager = managerId
      ? ((await db.execute(sql`SELECT id, display_name AS name, email FROM users WHERE id = ${managerId}`)).rows[0] ?? null)
      : null;
    const departments = (
      await db.execute(
        sql`SELECT id, name FROM departments WHERE organization_id = ${orgId} AND is_active ORDER BY sort_order, name`,
      )
    ).rows;
    return { ok: true, manager, departments };
  }

  /**
   * `box=mine`: the caller's own requests; `inbox`: requests they handle (not their own);
   * `archived`: archived requests of either kind. Newest activity first.
   */
  @Get()
  async list(@Param('orgId') orgId: string, @Query('box') box: string | undefined, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, requests: [] };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: true, requests: [] };
    const all = await reachesAll(db, orgId, callerId, 'nav.requests', 'edit');
    const mine = sql`r.requester_user_id = ${callerId}`;
    const handles = handlesCondition(orgId, callerId, all);
    const where =
      box === 'inbox'
        ? sql`r.archived_at IS NULL AND r.requester_user_id IS DISTINCT FROM ${callerId} AND ${handles}`
        : box === 'archived'
          ? sql`r.archived_at IS NOT NULL AND (${mine} OR ${handles})`
          : sql`r.archived_at IS NULL AND ${mine}`;
    const rows = await db.execute(
      sql`SELECT ${LIST_COLUMNS} ${LIST_FROM(orgId)} WHERE r.organization_id = ${orgId} AND ${where}
          ORDER BY (r.urgent AND r.status <> 'resolved') DESC,
            (r.due_date < (now() AT TIME ZONE 'Europe/Zurich')::date AND r.status <> 'resolved') DESC, r.last_activity_at DESC LIMIT 500`,
    );
    return { ok: true, requests: rows.rows };
  }

  /** Open requests in the caller's inbox nobody took yet, or taken by them: the navbar badge. */
  @Get('summary')
  async summary(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, inbox: 0 };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: true, inbox: 0 };
    const all = await reachesAll(db, orgId, callerId, 'nav.requests', 'edit');
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n ${LIST_FROM(orgId)}
          WHERE r.organization_id = ${orgId} AND r.archived_at IS NULL AND r.status <> 'resolved'
            AND r.requester_user_id IS DISTINCT FROM ${callerId} AND ${handlesCondition(orgId, callerId, all)}
            AND (r.assignee_user_id IS NULL OR r.assignee_user_id = ${callerId})`,
    );
    return { ok: true, inbox: (rows.rows[0]?.n as number) ?? 0 };
  }

  /** One request with its thread, and what the caller may do with it. */
  @Get(':id')
  async get(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const a = await this.access(db, orgId, callerId, id);
    if (!a) return { ok: false, error: 'not-found' };
    const [request] = (await db.execute(sql`SELECT ${LIST_COLUMNS} ${LIST_FROM(orgId)} WHERE r.id = ${id}`)).rows;
    const messages = (
      await db.execute(
        sql`SELECT m.id, m.kind, m.body, m.data, ${iso('m.posted_at')} AS posted_at, m.author_user_id, u.display_name AS author_name
            FROM request_messages m LEFT JOIN users u ON u.id = m.author_user_id
            WHERE m.request_id = ${id} ORDER BY m.posted_at, m.id`,
      )
    ).rows;
    const files = (
      await db.execute(
        sql`SELECT md.message_id, d.id, d.file_name, d.mime_type, d.size_bytes
            FROM request_message_documents md JOIN documents d ON d.id = md.document_id
            JOIN request_messages m ON m.id = md.message_id
            WHERE m.request_id = ${id} ORDER BY d.file_name`,
      )
    ).rows as { message_id: string; id: string; file_name: string; mime_type: string; size_bytes: number }[];
    for (const m of messages as Record<string, unknown>[]) {
      m.attachments = files.filter((f) => f.message_id === m.id).map(({ message_id: _m, ...f }) => f);
    }
    // Who answers it today (the manager follows a manager change; a department's members change too),
    // with e-mail addresses for "Send by e-mail" (both sides already see each other in the thread).
    const handlerIds = await this.handlerIds(db, a.r);
    const handlers = handlerIds.length
      ? (
          await db.execute(
            sql`SELECT id, coalesce(display_name, email) AS name, email FROM users WHERE id IN (${sql.join(handlerIds.map((x) => sql`${x}`), sql`, `)}) ORDER BY 2`,
          )
        ).rows
      : [];
    return { ok: true, request, messages, handlers, isRequester: a.requester, isHandler: a.handler };
  }

  /**
   * Sends a request: `{ target: 'manager' | 'department', departmentId?, subject, message, type, urgent?, link?, dueDate? }`,
   * as JSON or multipart with attachments in `files`. A message needs text or at least one file;
   * `type` is one of the org's request types (`validateRequestDetails`).
   */
  @Post()
  @UseInterceptors(Attachments())
  async create(
    @Param('orgId') orgId: string,
    @Body() body: { target?: string; departmentId?: string; subject?: string; message?: string; type?: string; urgent?: boolean | string; link?: string; dueDate?: string; custom?: unknown },
    @UploadedFiles() uploaded: Express.Multer.File[] | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    body = body ?? {}; // a body the parsers didn't understand arrives as undefined
    const files = uploaded ?? [];
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId || !(await can(db, orgId, callerId, 'nav.requests', 'edit', callerId))) return { ok: false, error: 'forbidden' };
    const subject = cleanRequestText(body.subject, MAX_SUBJECT);
    const message = cleanRequestText(body.message, MAX_BODY);
    if (!subject) return { ok: false, error: 'subject-required' };
    if (!message && files.length === 0) return { ok: false, error: 'message-required' };
    const types = await this.typeValues(db, orgId);
    const details = validateRequestDetails(body, requestTypeKeys(types));
    if (!details.ok) return details;
    const { request_type, urgent, link_url, due_date } = details.value;
    const custom = await this.customValues(orgId, body.custom ?? (await this.customRequired(orgId) ? {} : undefined));
    if (!custom.ok) return custom;
    const confidential = requestTypeConfidential(types, request_type);

    let departmentId: string | null = null;
    if (body.target === 'manager') {
      if (!(await membershipManagerId(db, orgId, callerId))) return { ok: false, error: 'no-manager' };
    } else if (body.target === 'department') {
      const rows = await db.execute(
        sql`SELECT id FROM departments WHERE id = ${body.departmentId ?? null}::uuid AND organization_id = ${orgId} AND is_active`,
      );
      if (rows.rows.length === 0) return { ok: false, error: 'unknown-department' };
      departmentId = body.departmentId as string;
    } else {
      return { ok: false, error: 'invalid-target' };
    }

    const [created] = (
      await db.execute(
        sql`INSERT INTO requests (organization_id, requester_user_id, target_kind, target_department_id, subject, request_type, urgent, link_url, due_date, confidential, custom)
            VALUES (${orgId}, ${callerId}, ${body.target}, ${departmentId}, ${subject}, ${request_type ?? null}, ${urgent ?? false}, ${link_url ?? null}, ${due_date ?? null}::date,
                    ${confidential}, ${JSON.stringify(custom.value ?? {})}::jsonb)
            RETURNING ${ROW_COLUMNS}`,
      )
    ).rows as unknown as RequestRow[];
    await this.addMessage(db, created, callerId, message, files);
    const fileNames = files.map((f) => f.originalname);
    void this.versions.record('requests', created.id, 'insert', callerId, { ...created, custom: custom.value ?? {}, message, attachments: fileNames }).catch(() => {});
    const who = await this.displayName(db, callerId);
    const title = created.urgent ? `Urgent request from ${who}: ${subject}` : `New request from ${who}: ${subject}`;
    await this.notifyOthers(db, created, callerId, 'request.created', title, messagePreview(message, fileNames)).catch(() => {});
    return { ok: true, id: created.id };
  }

  /** Adds a message. A handler's answer moves an open request to in progress; the requester's reopens a resolved one. */
  @Post(':id/messages')
  @UseInterceptors(Attachments())
  async reply(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: { body?: string },
    @UploadedFiles() uploaded: Express.Multer.File[] | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    body = body ?? {};
    const files = uploaded ?? [];
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const a = await this.access(db, orgId, callerId, id);
    if (!a) return { ok: false, error: 'not-found' };
    if (a.r.archived_at) return { ok: false, error: 'request-archived' };
    const text = cleanRequestText(body.body, MAX_BODY);
    if (!text && files.length === 0) return { ok: false, error: 'message-required' };

    let status: RequestStatus = a.r.status;
    if (a.handler && !a.requester && status === 'open') status = 'in_progress';
    if (a.requester && !a.handler && status === 'resolved') status = 'open';
    await this.addMessage(db, a.r, callerId, text, files);
    const fileNames = files.map((f) => f.originalname);
    if (status !== a.r.status) await this.event(db, id, callerId, { status });
    await db.execute(
      sql`UPDATE requests SET last_activity_at = now(), status = ${status},
            resolved_at = CASE WHEN ${status} = 'resolved' THEN resolved_at ELSE NULL END
          WHERE id = ${id}`,
    );
    void this.versions.record('requests', id, 'update_delta', callerId, { status, message: text, attachments: fileNames }).catch(() => {});
    const who = await this.displayName(db, callerId);
    await this.notifyOthers(db, a.r, callerId, 'request.message', `${who} replied: ${a.r.subject}`, messagePreview(text, fileNames)).catch(() => {});
    return { ok: true, status };
  }

  /** `{ status }`, see `canChangeStatus`. */
  @Post(':id/status')
  async setStatus(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: { status?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const a = await this.access(db, orgId, callerId, id);
    if (!a) return { ok: false, error: 'not-found' };
    const to = body.status as RequestStatus;
    if (!REQUEST_STATUSES.includes(to)) return { ok: false, error: 'invalid-status' };
    if (!canChangeStatus(a.r.status, to, { handler: a.handler, requester: a.requester }, !!a.r.archived_at)) {
      return { ok: false, error: a.r.archived_at ? 'request-archived' : 'forbidden' };
    }
    await db.execute(
      sql`UPDATE requests SET status = ${to}, last_activity_at = now(),
            resolved_at = CASE WHEN ${to} = 'resolved' THEN now() ELSE NULL END
          WHERE id = ${id}`,
    );
    await this.event(db, id, callerId, { status: to });
    void this.versions.record('requests', id, 'update_delta', callerId, { status: to }).catch(() => {});
    const who = await this.displayName(db, callerId);
    const label = to === 'resolved' ? 'resolved' : to === 'in_progress' ? 'in progress' : 'reopened';
    await this.notifyOthers(db, a.r, callerId, 'request.status', `${who} set "${a.r.subject}" to ${label}`).catch(() => {});
    return { ok: true, status: to };
  }

  /**
   * Changes the type, urgency, link, due date or custom values (`{ type?, urgent?, link?, dueDate?, custom? }`,
   * only the fields given). The requester and the handlers may, while the request is not archived; a new
   * due date arms the overdue alert again, a new type brings its confidentiality.
   */
  @Post(':id/details')
  async setDetails(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: { type?: string; urgent?: boolean; link?: string | null; dueDate?: string | null; custom?: unknown },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const a = await this.access(db, orgId, callerId, id);
    if (!a) return { ok: false, error: 'not-found' };
    if (a.r.archived_at) return { ok: false, error: 'request-archived' };
    const types = await this.typeValues(db, orgId);
    const details = validateRequestDetails(body ?? {}, requestTypeKeys(types), a.r);
    if (!details.ok) return details;
    const custom = await this.customValues(orgId, body?.custom);
    if (!custom.ok) return custom;
    // Only what actually changes goes into the thread and the history.
    const changed: RequestDetails = {};
    for (const k of ['request_type', 'urgent', 'link_url', 'due_date'] as const) {
      if (details.value[k] !== undefined && details.value[k] !== a.r[k]) (changed as Record<string, unknown>)[k] = details.value[k];
    }
    const current = ((await db.execute(sql`SELECT custom FROM requests WHERE id = ${id}`)).rows[0]?.custom ?? {}) as Record<string, unknown>;
    const customChanged = custom.value !== undefined && JSON.stringify(custom.value) !== JSON.stringify(current);
    if (Object.keys(changed).length === 0 && !customChanged) return { ok: true };
    const next = { ...a.r, ...changed };
    // The type brings its confidentiality (a request moved to a confidential type leaves admins' sight).
    const confidential = changed.request_type !== undefined ? requestTypeConfidential(types, next.request_type) : a.r.confidential;
    await db.execute(
      sql`UPDATE requests SET request_type = ${next.request_type}, urgent = ${next.urgent}, link_url = ${next.link_url}, due_date = ${next.due_date}::date,
            confidential = ${confidential}, custom = ${JSON.stringify(customChanged ? custom.value : current)}::jsonb,
            overdue_alerted_at = CASE WHEN due_date IS DISTINCT FROM ${next.due_date}::date THEN NULL ELSE overdue_alerted_at END, last_activity_at = now()
          WHERE id = ${id}`,
    );
    await this.event(db, id, callerId, { details: { ...changed, ...(customChanged ? { custom: true } : {}) } });
    void this.versions.record('requests', id, 'update_delta', callerId, { ...changed, ...(customChanged ? { custom: custom.value } : {}), confidential }).catch(() => {});
    const who = await this.displayName(db, callerId);
    const title = changed.urgent === true ? `${who} marked "${a.r.subject}" as urgent` : `${who} updated "${a.r.subject}"`;
    await this.notifyOthers(db, a.r, callerId, 'request.status', title).catch(() => {});
    return { ok: true };
  }

  /** A handler takes the request over (or `{ release: true }` gives it back to everyone). */
  @Post(':id/take')
  async take(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: { release?: boolean }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const a = await this.access(db, orgId, callerId, id);
    if (!a) return { ok: false, error: 'not-found' };
    if (!a.handler) return { ok: false, error: 'forbidden' };
    if (a.r.archived_at) return { ok: false, error: 'request-archived' };
    const assignee = body.release ? null : callerId;
    const status: RequestStatus = !body.release && a.r.status === 'open' ? 'in_progress' : a.r.status;
    await db.execute(sql`UPDATE requests SET assignee_user_id = ${assignee}, status = ${status}, last_activity_at = now() WHERE id = ${id}`);
    await this.event(db, id, callerId, { assignee, ...(status !== a.r.status ? { status } : {}) });
    void this.versions.record('requests', id, 'update_delta', callerId, { assignee_user_id: assignee, status }).catch(() => {});
    if (!body.release) {
      const who = await this.displayName(db, callerId);
      await this.notifyOthers(db, { ...a.r, assignee_user_id: null }, callerId, 'request.status', `${who} is handling "${a.r.subject}"`).catch(() => {});
    }
    return { ok: true, assigneeUserId: assignee, status };
  }

  /** A handler archives the request (`{ archived: false }` brings it back). */
  @Post(':id/archive')
  async archive(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: { archived?: boolean }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const a = await this.access(db, orgId, callerId, id);
    if (!a) return { ok: false, error: 'not-found' };
    if (!a.handler) return { ok: false, error: 'forbidden' };
    const archived = body.archived !== false;
    await db.execute(sql`UPDATE requests SET archived_at = ${archived ? sql`now()` : sql`NULL`}, last_activity_at = now() WHERE id = ${id}`);
    await this.event(db, id, callerId, { archived });
    void this.versions.record('requests', id, 'update_delta', callerId, { archived }).catch(() => {});
    return { ok: true, archived };
  }

  /** "Send by e-mail": mails the request to colleagues (`{ userIds, subject, message }`), anyone who may see it. */
  @Post(':id/forward')
  async forward(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: ForwardInput, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    const a = callerId ? await this.access(db, orgId, callerId, id) : null;
    if (!callerId || !a) return { ok: false, error: 'not-found' };
    if (a.r.confidential) return { ok: false, error: 'request-confidential' };
    return this.forwardMail.send(db, orgId, callerId, body ?? {}, { type: 'request', id, path: `#/requests?id=${id}` });
  }

  /** Downloads an attachment of a request the caller may see. */
  @Get(':id/attachments/:documentId')
  async download(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const db = this.db.getDb();
    const callerId = db ? await this.caller(db, orgId, req) : null;
    if (!db || !callerId || !(await this.access(db, orgId, callerId, id))) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    const linked = await db.execute(
      sql`SELECT 1 FROM request_message_documents md JOIN request_messages m ON m.id = md.message_id
          WHERE md.document_id = ${documentId} AND m.request_id = ${id}`,
    );
    const doc = linked.rows.length > 0 ? await this.documents.get(db, documentId) : undefined;
    if (!doc) {
      res.status(404).json({ ok: false, error: 'not-found' });
      return;
    }
    await this.documents.send(res, doc);
  }

  private async displayName(db: Executor, userId: string): Promise<string> {
    const rows = await db.execute(sql`SELECT coalesce(display_name, email) AS name FROM users WHERE id = ${userId}`);
    return (rows.rows[0]?.name as string) ?? 'Someone';
  }
}
