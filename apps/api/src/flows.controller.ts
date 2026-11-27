import { Body, Controller, Get, Param, Post, Query, Req, Res, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { sql, type SQL } from 'drizzle-orm';
import type { Response } from 'express';
import { DbService, type Db } from './db.service';
import { subjectValue, type NoticeText } from './notification-text';
import { DocumentsService, MAX_DOCUMENT_BYTES } from './documents.service';
import { callerUserId, can, isOrgMember, membershipManagerId, reachesAll, type Executor } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { NotificationsService } from './notifications.service';
import { VersionsService } from './versions.service';
import { ForwardMailService, type ForwardInput } from './forward-mail.service';
import { cleanDueDate, cleanFlowLink, flowTypeConfidential, flowTypeKeys } from '@worktime3/shared/flows';
import { FLOW_FORM, customValuesErrors, customValuesToSave, mergeForm, flowTypeForm, type ResolvedForm } from '@worktime3/shared/fields';
import { FieldsService } from './fields.service';
import { FlowsService, currentAssignments, noticeSubject } from './flows.service';
import { WorkflowsService, type WorkflowStepDefinition } from './workflows.service';
import { FLOW_STEPS_KIND, visibleThread } from './flow-steps';
import { cursorOf, parseCursor, parseLimit, parseListFilters, wordsMatch } from './list-filters';
import { sqlNow, sqlToday } from './clock';

/**
 * Requests (module "requests", packages/shared/src/modules.ts; tables in 052-requests.sql):
 * a ticket a person sends to their line manager or to a department, with a message thread.
 *
 * Who handles a request is never stored; it is worked out when asked:
 * - to the manager: the requester's manager in force (employee_assignments), so it moves with
 *   a manager change, like the approvals;
 * - to a department: everyone whose assignment in force is in it, and its leader;
 * - plus anyone with `nav.flows:edit:all` (admin), for the whole organization.
 * Everyone involved needs `nav.flows` (which a switched-off module takes away); sending
 * needs `nav.flows:edit`. Every change notifies the other side (NotificationsService).
 *
 * A request may have a due date (FlowsService mails the handlers once it has passed while the
 * request is open), and modules or plugins open requests themselves (`FlowsService.openTask`):
 * those have no requester but a `source` (shown as the sender) and the page they are about.
 *
 * A request of a confidential type (static_data attribute `confidential`, copied onto the request) is
 * seen only by the requester and its handlers: `nav.flows:edit:all` does not reach it, notifications
 * carry no text, and "Send by e-mail" and the AI assistant leave it alone. The organization's own
 * fields (configurable form `request`, design mode on the Requests page) are in `custom`.
 */

export type FlowStatus = 'open' | 'in_progress' | 'resolved';
export const REQUEST_STATUSES: readonly FlowStatus[] = ['open', 'in_progress', 'resolved'];
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
export function cleanFlowText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text && text.length <= max ? text : null;
}

/**
 * Whether a status change is allowed. Handlers move a request freely between the statuses; the
 * requester can only mark their own request resolved (done, or withdrawn) or reopen it.
 * Archived requests are read-only until a handler unarchives them.
 */
export function canChangeStatus(from: FlowStatus, to: FlowStatus, who: { handler: boolean; requester: boolean }, archived: boolean): boolean {
  if (archived || from === to || !REQUEST_STATUSES.includes(to)) return false;
  if (who.handler) return true;
  if (who.requester) return to === 'resolved' || (from === 'resolved' && to === 'open');
  return false;
}

/** The fields a request's type, urgency and link are stored in. */
export interface FlowDetails {
  flow_type?: string | null;
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
export function validateFlowDetails(
  input: { type?: unknown; urgent?: unknown; link?: unknown; dueDate?: unknown },
  typeKeys: string[],
  current?: { flow_type: string | null },
): { ok: true; value: FlowDetails } | { ok: false; error: string } {
  const value: FlowDetails = {};
  if (!current || input.type !== undefined) {
    const type = typeof input.type === 'string' && input.type.trim() ? input.type.trim() : null;
    if (type === null) {
      if (typeKeys.length > 0) return { ok: false, error: 'flow-type-required' };
    } else if (!typeKeys.includes(type) && type !== current?.flow_type) {
      return { ok: false, error: 'unknown-flow-type' };
    }
    value.flow_type = type;
  }
  if (!current || input.urgent !== undefined) value.urgent = flag(input.urgent) ?? false;
  if (!current || input.link !== undefined) {
    const link = cleanFlowLink(input.link);
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
  // `nav.flows:edit:all` reaches every request but the confidential ones.
  return handlesAll ? sql`(NOT r.confidential OR ${own})` : own;
}

function ownHandlesCondition(orgId: string, callerId: string): SQL {
  return sql`((r.target_kind = 'manager' AND rc.manager_user_id = ${callerId})
          OR (r.target_kind = 'department' AND (d.leader_user_id = ${callerId}
              OR r.target_department_id = (SELECT department_id FROM (${currentAssignments(orgId)}) me WHERE me.user_id = ${callerId})))
          OR (r.target_kind = 'workflow' AND EXISTS (
              SELECT 1 FROM workflows w WHERE w.source_table = 'flows' AND w.source_table_uuid = r.id
                AND ((w.step_status = 'pending' AND w.assigned_to_user_id @> ARRAY[${callerId}]::uuid[])
                  OR COALESCE(w.workflow_data->'history', '[]'::jsonb) @> ${JSON.stringify([{ by: callerId }])}::jsonb))))`;
}

/** A timestamptz column as an ISO string (raw queries otherwise return Postgres's text format). */
const iso = (column: string) => sql.raw(`to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);

const LIST_COLUMNS = sql`r.id, r.subject, r.status, r.flow_type, r.urgent, r.link_url, r.target_kind, r.target_department_id, d.name AS department_name,
  r.due_date::text AS due_date, r.source, r.source_section, r.confidential, r.custom,
  (r.due_date < ${sqlToday()} AND r.status <> 'resolved' AND r.archived_at IS NULL) AS overdue,
  r.requester_user_id, ru.display_name AS requester_name, ru.email AS requester_email,
  r.assignee_user_id, au.display_name AS assignee_name,
  ${iso('r.opened_at')} AS opened_at, ${iso('r.last_activity_at')} AS last_activity_at,
  ${iso('r.resolved_at')} AS resolved_at, ${iso('r.archived_at')} AS archived_at,
  (SELECT count(*)::int FROM flow_messages m WHERE m.flow_id = r.id AND m.kind = 'message') AS message_count`;

const LIST_FROM = (orgId: string) => sql`FROM flows r
  LEFT JOIN (${currentAssignments(orgId)}) rc ON rc.user_id = r.requester_user_id
  LEFT JOIN departments d ON d.id = r.target_department_id
  LEFT JOIN users ru ON ru.id = r.requester_user_id
  LEFT JOIN users au ON au.id = r.assignee_user_id`;

interface FlowRecord {
  id: string;
  organization_id: string;
  requester_user_id: string | null;
  target_kind: 'manager' | 'department' | 'workflow';
  target_department_id: string | null;
  subject: string;
  status: FlowStatus;
  flow_type: string | null;
  urgent: boolean;
  link_url: string | null;
  due_date: string | null;
  confidential: boolean;
  assignee_user_id: string | null;
  archived_at: string | null;
}

const ROW_COLUMNS = sql`id, organization_id, requester_user_id, target_kind, target_department_id, subject, status, flow_type, urgent, link_url,
  due_date::text AS due_date, confidential, assignee_user_id, archived_at`;

@Controller('organizations/:orgId/flows')
export class FlowsController {
  constructor(
    private readonly db: DbService,
    private readonly notifications: NotificationsService,
    private readonly versions: VersionsService,
    private readonly documents: DocumentsService,
    private readonly forwardMail: ForwardMailService,
    private readonly flowsSvc: FlowsService,
    private readonly fields: FieldsService,
    private readonly workflowsSvc: WorkflowsService,
  ) {}

  /** Whether requests of this type follow a workflow (its own configuration on Admin settings -> Workflows). */
  private async typeHasWorkflow(db: Db, orgId: string, type: string | null | undefined): Promise<boolean> {
    return !!type && !!(await this.workflowsSvc.ownConfig(db, orgId, FLOW_STEPS_KIND, type));
  }

  /**
   * A workflow request's workflow as the page shows it: its steps, the one it waits at (and whether the caller decides
   * it), whether it was sent back to the requester. Null for other requests.
   */
  private async workflowOf(db: Db, r: FlowRecord, callerId: string) {
    if (r.target_kind !== 'workflow') return null;
    const [w] = (await db.execute(sql`
      SELECT w.workflow_id AS id, w.step, w.step_status AS status, COALESCE(w.steps, d.steps) AS steps, w.assigned_to_user_id AS assignees
      FROM workflows w JOIN workflow_definitions d ON d.workflow_def_id = w.workflow_def_id
      WHERE w.source_table = 'flows' AND w.source_table_uuid = ${r.id}::uuid
      ORDER BY w.workflow_started DESC NULLS LAST LIMIT 1`)).rows as { id: string; step: string; status: string; steps: WorkflowStepDefinition[]; assignees: string[] | null }[];
    if (!w) return null;
    const steps = (Array.isArray(w.steps) ? w.steps : []).map((s) => ({ key: s.key, label: s.label, labels: s.labels ?? null, blocks: s.blocks ?? null }));
    const current = (Array.isArray(w.steps) ? w.steps : []).find((s) => s.key === w.step);
    const assignees = w.assignees ?? [];
    const names = assignees.length
      ? ((await db.execute(sql`SELECT coalesce(display_name, email) AS name FROM users WHERE id = ANY(${`{${assignees.join(',')}}`}::uuid[]) ORDER BY 1`)).rows as { name: string }[]).map((x) => x.name)
      : [];
    return {
      id: w.id,
      status: w.status,
      step: w.step,
      steps,
      waitingFor: w.status === 'pending' ? names : [],
      canDecide: w.status === 'pending' && assignees.includes(callerId),
      returns: current?.reject === 'back',
      actionKey: current?.actionKey ?? null,
      // What the step asks whoever does it, and whether each assignee does it on their own.
      fields: current?.fields ?? null,
      each: !!current?.each,
      privateAnswers: !!current?.privateAnswers,
      // Sent back: the requester changes it and submits it again.
      returned: w.status === 'rejected' && r.status !== 'resolved',
    };
  }

  /**
   * The custom values as the organization's form saves them, or an error. `given` may be a JSON string
   * (multipart). Without `given` (undefined) nothing is checked.
   */
  /**
   * The form a request of `type` fills: the fields every request has (`request`), then its type's own
   * (`flow.<type>`), stored together in `custom`.
   */
  private async requestForm(orgId: string, type: string | null | undefined): Promise<ResolvedForm> {
    const common = (await this.fields.resolved(orgId, FLOW_FORM.id)) ?? mergeForm(FLOW_FORM);
    const typeDef = type ? flowTypeForm(type) : null;
    if (!typeDef) return common;
    const own = (await this.fields.resolved(orgId, typeDef.id)) ?? mergeForm(typeDef);
    return { ...common, groups: [...common.groups, ...own.groups], fields: [...common.fields, ...own.fields.filter((f) => !common.fields.some((c) => c.key === f.key))] };
  }

  private async customValues(orgId: string, given: unknown, type?: string | null): Promise<{ ok: true; value: Record<string, unknown> | undefined } | { ok: false; error: string }> {
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
    const form = await this.requestForm(orgId, type);
    const value = customValuesToSave(form, values as Record<string, unknown>);
    const unknown = Object.keys(values as Record<string, unknown>).filter((k) => !(k in value));
    if (unknown.length || customValuesErrors(form, value).length) return { ok: false, error: 'invalid-custom' };
    return { ok: true, value };
  }

  /** Whether the organization's form has a required custom field (then a new request must fill it). */
  private async customRequired(orgId: string, type?: string | null): Promise<boolean> {
    const form = await this.requestForm(orgId, type);
    return customValuesErrors(form, {}).length > 0;
  }

  /** Inserts a message with its attachments (stored through DocumentsService). */
  private async addMessage(db: Db, r: { id: string; organization_id: string }, authorId: string, text: string | null, files: Express.Multer.File[]) {
    const [message] = (
      await db.execute(
        sql`INSERT INTO flow_messages (flow_id, author_user_id, kind, body, posted_at) VALUES (${r.id}, ${authorId}, 'message', ${text}, ${sqlNow()}) RETURNING id`,
      )
    ).rows as { id: string }[];
    // The document names its message (source_table/source_table_id): that is the link.
    for (const file of files) await this.documents.upload(db, r.organization_id, authorId, file, { table: 'flow_messages', id: message.id });
    return message.id;
  }

  /** The caller, when they are a member with any `nav.flows` grant (the module is on). */
  private async caller(db: Executor, orgId: string, req: AuthenticatedRequest): Promise<string | null> {
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId || !(await isOrgMember(db, orgId, userId))) return null;
    return (await can(db, orgId, userId, 'nav.flows', 'see')) ? userId : null;
  }

  /** Who handles `r` today (ids), not counting `nav.flows:edit:all`. */
  private handlerIds(db: Executor, r: FlowRecord): Promise<string[]> {
    return this.flowsSvc.handlerIds(db, r);
  }

  private async load(db: Executor, orgId: string, id: string): Promise<FlowRecord | null> {
    const rows = await db.execute(
      sql`SELECT ${ROW_COLUMNS} FROM flows WHERE id = ${id} AND organization_id = ${orgId}`,
    );
    return (rows.rows[0] as unknown as FlowRecord) ?? null;
  }

  /** The request and how the caller relates to it; null when they may not see it. */
  private async access(db: Executor, orgId: string, callerId: string, id: string) {
    const r = await this.load(db, orgId, id);
    if (!r) return null;
    const requester = r.requester_user_id === callerId;
    const handler =
      (!r.confidential && (await reachesAll(db, orgId, callerId, 'nav.flows', 'edit'))) || (await this.handlerIds(db, r)).includes(callerId);
    if (!requester && !handler) return null;
    return { r, requester, handler };
  }

  /** Notifies everyone on the other side of `actorId`: the requester, or the assignee (else every handler). */
  private async notifyOthers(db: Executor, r: FlowRecord, actorId: string, type: string, title: string, body?: string, text?: NoticeText) {
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
      text,
      // A confidential request's notifications carry no text; the callers' titles no subject (noticeSubject).
      body: r.confidential ? undefined : body,
      sourceTable: 'flows',
      sourceTableUuid: r.id,
      data: { requestId: r.id },
    });
  }

  private async event(db: Executor, requestId: string, actorId: string, data: Record<string, unknown>) {
    await db.execute(
      sql`INSERT INTO flow_messages (flow_id, author_user_id, kind, data, posted_at) VALUES (${requestId}, ${actorId}, 'event', ${JSON.stringify(data)}::jsonb, ${sqlNow()})`,
    );
  }

  /** The org's request types (attributes by key): its own static_data row, else the global one. */
  private async typeValues(db: Executor, orgId: string): Promise<unknown> {
    const rows = await db.execute(
      sql`SELECT "values" FROM static_data
          WHERE entity = 'flows' AND enum_name = 'flow_type' AND (organization_id = ${orgId} OR organization_id IS NULL)
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
    // Request types with their own workflow: no target to choose, and the steps they will go through.
    const workflows: Record<string, { key: string; label: string; labels: Record<string, string> | null; blocks: string[]; conditional: boolean }[]> = {};
    for (const type of flowTypeKeys(await this.typeValues(db, orgId))) {
      const config = await this.workflowsSvc.ownConfig(db, orgId, FLOW_STEPS_KIND, type);
      if (config) workflows[type] = config.steps.map((s) => ({ key: s.key, label: s.label?.en ?? Object.values(s.label ?? {}).find(Boolean) ?? s.key, labels: (s.label as Record<string, string> | undefined) ?? null, blocks: s.do, conditional: !!s.when }));
    }
    return { ok: true, manager, departments, workflows };
  }

  /**
   * `box=mine`: the caller's own requests; `inbox`: requests they handle (not their own);
   * `archived`: archived requests of either kind; `done` (Flows -> Done): the inbox's resolved ones and
   * the archived ones. Without `limit` the newest 500, urgent and overdue first (the Flows page sorts
   * by activity itself). With `limit`: newest activity first, `before` the last row's `cursor`.
   * Flows' filters: `type` (a flow type's key, or `free`), `state` (`open`: not resolved, `done`:
   * resolved), `since` (last activity on or after), `person` (the requester), `q` (every word in the
   * subject or the requester's name or e-mail).
   */
  @Get()
  async list(
    @Param('orgId') orgId: string,
    @Query('box') box: string | undefined,
    @Req() req: AuthenticatedRequest,
    @Query() query: { limit?: string; before?: string; type?: string; state?: string; since?: string; person?: string; q?: string } = {},
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, flows: [] };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: true, flows: [] };
    const all = await reachesAll(db, orgId, callerId, 'nav.flows', 'edit');
    const mine = sql`r.requester_user_id = ${callerId}`;
    const handles = handlesCondition(orgId, callerId, all);
    const inbox = sql`r.archived_at IS NULL AND r.requester_user_id IS DISTINCT FROM ${callerId} AND ${handles}`;
    const archived = sql`r.archived_at IS NOT NULL AND (${mine} OR ${handles})`;
    const where =
      box === 'inbox' ? inbox
        : box === 'archived' ? archived
          : box === 'done' ? sql`((${inbox} AND r.status = 'resolved') OR (${archived}))`
            : sql`r.archived_at IS NULL AND ${mine}`;
    const conditions: SQL[] = [sql`r.organization_id = ${orgId}`, where];
    const filters = parseListFilters(query);
    const type = typeof query.type === 'string' ? query.type : '';
    if (type === 'free') conditions.push(sql`r.flow_type IS NULL`);
    else if (type && type.length <= 100) conditions.push(sql`r.flow_type = ${type}`);
    if (query.state === 'open') conditions.push(sql`r.status <> 'resolved'`);
    else if (query.state === 'done') conditions.push(sql`r.status = 'resolved'`);
    if (filters.since) conditions.push(sql`r.last_activity_at >= ${filters.since}::date`);
    if (filters.person) conditions.push(sql`r.requester_user_id = ${filters.person}`);
    const words = wordsMatch([sql`r.subject`, sql`ru.display_name`, sql`ru.email`], filters.words);
    if (words) conditions.push(words);
    const limit = parseLimit(query.limit);
    const cursor = parseCursor(query.before);
    // In milliseconds, as the cursor carries them (Postgres keeps microseconds).
    const activity = sql`date_trunc('milliseconds', r.last_activity_at)`;
    if (limit && cursor) conditions.push(sql`(${activity}, r.id) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`);
    const order = limit
      ? sql`${activity} DESC, r.id DESC LIMIT ${limit}`
      : sql`(r.urgent AND r.status <> 'resolved') DESC,
            (r.due_date < ${sqlToday()} AND r.status <> 'resolved') DESC, r.last_activity_at DESC LIMIT 500`;
    const rows = await db.execute(sql`SELECT ${LIST_COLUMNS} ${LIST_FROM(orgId)} WHERE ${sql.join(conditions, sql` AND `)} ORDER BY ${order}`);
    return { ok: true, flows: (rows.rows as { id: string; last_activity_at: string | null }[]).map((r) => ({ ...r, cursor: cursorOf({ id: r.id, at: r.last_activity_at }) })) };
  }

  /** Open requests in the caller's inbox nobody took yet, or taken by them: the navbar badge. */
  @Get('summary')
  async summary(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, inbox: 0, inboxFree: 0 };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: true, inbox: 0, inboxFree: 0 };
    const all = await reachesAll(db, orgId, callerId, 'nav.flows', 'edit');
    // `free`: those without a workflow of their type (a workflow's steps are counted with the caller's workflow items,
    // so the Flows page's badge counts each once).
    const rows = await db.execute(
      sql`SELECT count(*)::int AS n, (count(*) FILTER (WHERE r.target_kind IS DISTINCT FROM 'workflow'))::int AS free ${LIST_FROM(orgId)}
          WHERE r.organization_id = ${orgId} AND r.archived_at IS NULL AND r.status <> 'resolved'
            AND r.requester_user_id IS DISTINCT FROM ${callerId} AND ${handlesCondition(orgId, callerId, all)}
            AND (r.assignee_user_id IS NULL OR r.assignee_user_id = ${callerId})`,
    );
    return { ok: true, inbox: (rows.rows[0]?.n as number) ?? 0, inboxFree: (rows.rows[0]?.free as number) ?? 0 };
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
    const [flow] = (await db.execute(sql`SELECT ${LIST_COLUMNS} ${LIST_FROM(orgId)} WHERE r.id = ${id}`)).rows;
    const messages = (
      await db.execute(
        sql`SELECT m.id, m.kind, m.body, m.data, ${iso('m.posted_at')} AS posted_at, m.author_user_id, u.display_name AS author_name
            FROM flow_messages m LEFT JOIN users u ON u.id = m.author_user_id
            WHERE m.flow_id = ${id} ORDER BY m.posted_at, m.id`,
      )
    ).rows;
    const files = (
      await db.execute(
        sql`SELECT m.id AS message_id, d.id, d.file_name, d.mime_type, d.size_bytes
            FROM documents d JOIN flow_messages m ON d.source_table = 'flow_messages' AND m.id = d.source_table_id
            WHERE m.flow_id = ${id} ORDER BY d.file_name`,
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
    return { ok: true, flow, messages: visibleThread(messages as Record<string, unknown>[], callerId, a.r.requester_user_id ?? null), handlers, isRequester: a.requester, isHandler: a.handler, workflow: await this.workflowOf(db, a.r, callerId) };
  }

  /**
   * Sends a request: `{ target: 'manager' | 'department', departmentId?, subject, message, type, urgent?, link?, dueDate? }`,
   * as JSON or multipart with attachments in `files`. A message needs text or at least one file;
   * `type` is one of the org's request types (`validateFlowDetails`).
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
    if (!callerId || !(await can(db, orgId, callerId, 'nav.flows', 'edit', callerId))) return { ok: false, error: 'forbidden' };
    const subject = cleanFlowText(body.subject, MAX_SUBJECT);
    const message = cleanFlowText(body.message, MAX_BODY);
    if (!subject) return { ok: false, error: 'subject-required' };
    if (!message && files.length === 0) return { ok: false, error: 'message-required' };
    const types = await this.typeValues(db, orgId);
    const details = validateFlowDetails(body, flowTypeKeys(types));
    if (!details.ok) return details;
    const { flow_type, urgent, link_url, due_date } = details.value;
    const custom = await this.customValues(orgId, body.custom ?? (await this.customRequired(orgId, flow_type) ? {} : undefined), flow_type);
    if (!custom.ok) return custom;
    const confidential = flowTypeConfidential(types, flow_type);

    let departmentId: string | null = null;
    // A type with its own workflow: the workflow decides who handles it, not the requester.
    const viaWorkflow = await this.typeHasWorkflow(db, orgId, flow_type);
    const target = viaWorkflow ? 'workflow' : body.target;
    if (viaWorkflow) {
      // no target to check
    } else if (body.target === 'manager') {
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
        sql`INSERT INTO flows (organization_id, requester_user_id, target_kind, target_department_id, subject, flow_type, urgent, link_url, due_date, confidential, custom, opened_at, last_activity_at)
            VALUES (${orgId}, ${callerId}, ${target}, ${departmentId}, ${subject}, ${flow_type ?? null}, ${urgent ?? false}, ${link_url ?? null}, ${due_date ?? null}::date,
                    ${confidential}, ${JSON.stringify(custom.value ?? {})}::jsonb, ${sqlNow()}, ${sqlNow()})
            RETURNING ${ROW_COLUMNS}`,
      )
    ).rows as unknown as FlowRecord[];
    await this.addMessage(db, created, callerId, message, files);
    const fileNames = files.map((f) => f.originalname);
    void this.versions.record('flows', created.id, 'insert', callerId, { ...created, custom: custom.value ?? {}, message, attachments: fileNames }).catch(() => {});
    const who = await this.displayName(db, callerId);
    const named = noticeSubject({ subject, confidential });
    const title = created.urgent ? `Urgent flow from ${who}: ${named}` : `New flow from ${who}: ${named}`;
    const text = { key: created.urgent ? 'notice.flow.urgent' : 'notice.flow.new', vars: { who, subject: subjectValue({ subject, confidential }) } };
    if (viaWorkflow) {
      // The workflow's first step is assigned and notified by the engine.
      await this.workflowsSvc.start(db, {
        kind: FLOW_STEPS_KIND, variant: flow_type!, organizationId: orgId, sourceTableUuid: created.id, actorUserId: callerId,
        workflowData: {}, notification: { title, text, body: confidential ? undefined : messagePreview(message, fileNames) },
      });
    } else {
      await this.notifyOthers(db, created, callerId, 'flow.created', title, messagePreview(message, fileNames), text).catch(() => {});
    }
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
    if (a.r.archived_at) return { ok: false, error: 'flow-archived' };
    const text = cleanFlowText(body.body, MAX_BODY);
    if (!text && files.length === 0) return { ok: false, error: 'message-required' };

    let status: FlowStatus = a.r.status;
    if (a.handler && !a.requester && status === 'open') status = 'in_progress';
    if (a.requester && !a.handler && status === 'resolved') status = 'open';
    await this.addMessage(db, a.r, callerId, text, files);
    const fileNames = files.map((f) => f.originalname);
    if (status !== a.r.status) await this.event(db, id, callerId, { status });
    await db.execute(
      sql`UPDATE flows SET last_activity_at = ${sqlNow()}, status = ${status},
            resolved_at = CASE WHEN ${status} = 'resolved' THEN resolved_at ELSE NULL END
          WHERE id = ${id}`,
    );
    void this.versions.record('flows', id, 'update_delta', callerId, { status, message: text, attachments: fileNames }).catch(() => {});
    const who = await this.displayName(db, callerId);
    await this.notifyOthers(db, a.r, callerId, 'flow.message', `${who} replied: ${noticeSubject(a.r)}`, messagePreview(text, fileNames),
      { key: 'notice.flow.reply', vars: { who, subject: subjectValue(a.r) } }).catch(() => {});
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
    const to = body.status as FlowStatus;
    if (!REQUEST_STATUSES.includes(to)) return { ok: false, error: 'invalid-status' };
    // A workflow request's status follows its steps; the requester may only withdraw it (or submit it again).
    if (a.r.target_kind === 'workflow') return { ok: false, error: 'flow-has-steps' };
    if (!canChangeStatus(a.r.status, to, { handler: a.handler, requester: a.requester }, !!a.r.archived_at)) {
      return { ok: false, error: a.r.archived_at ? 'flow-archived' : 'forbidden' };
    }
    await db.execute(
      sql`UPDATE flows SET status = ${to}, last_activity_at = ${sqlNow()},
            resolved_at = CASE WHEN ${to} = 'resolved' THEN ${sqlNow()} ELSE NULL END
          WHERE id = ${id}`,
    );
    await this.event(db, id, callerId, { status: to });
    void this.versions.record('flows', id, 'update_delta', callerId, { status: to }).catch(() => {});
    const who = await this.displayName(db, callerId);
    const label = to === 'resolved' ? 'resolved' : to === 'in_progress' ? 'in progress' : 'reopened';
    await this.notifyOthers(db, a.r, callerId, 'flow.status', `${who} set "${noticeSubject(a.r)}" to ${label}`, undefined,
      { key: `notice.flow.status.${to}`, vars: { who, subject: subjectValue(a.r) } }).catch(() => {});
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
    if (a.r.archived_at) return { ok: false, error: 'flow-archived' };
    const types = await this.typeValues(db, orgId);
    const details = validateFlowDetails(body ?? {}, flowTypeKeys(types), a.r);
    if (!details.ok) return details;
    // The fields of the type the request has after this change.
    const custom = await this.customValues(orgId, body?.custom, details.value.flow_type !== undefined ? details.value.flow_type : a.r.flow_type);
    if (!custom.ok) return custom;
    // Only what actually changes goes into the thread and the history.
    const changed: FlowDetails = {};
    for (const k of ['flow_type', 'urgent', 'link_url', 'due_date'] as const) {
      if (details.value[k] !== undefined && details.value[k] !== a.r[k]) (changed as Record<string, unknown>)[k] = details.value[k];
    }
    const current = ((await db.execute(sql`SELECT custom FROM flows WHERE id = ${id}`)).rows[0]?.custom ?? {}) as Record<string, unknown>;
    const customChanged = custom.value !== undefined && JSON.stringify(custom.value) !== JSON.stringify(current);
    if (Object.keys(changed).length === 0 && !customChanged) return { ok: true };
    const next = { ...a.r, ...changed };
    // The type brings its confidentiality (a request moved to a confidential type leaves admins' sight).
    const confidential = changed.flow_type !== undefined ? flowTypeConfidential(types, next.flow_type) : a.r.confidential;
    await db.execute(
      sql`UPDATE flows SET flow_type = ${next.flow_type}, urgent = ${next.urgent}, link_url = ${next.link_url}, due_date = ${next.due_date}::date,
            confidential = ${confidential}, custom = ${JSON.stringify(customChanged ? custom.value : current)}::jsonb,
            overdue_alerted_at = CASE WHEN due_date IS DISTINCT FROM ${next.due_date}::date THEN NULL ELSE overdue_alerted_at END, last_activity_at = ${sqlNow()}
          WHERE id = ${id}`,
    );
    await this.event(db, id, callerId, { details: { ...changed, ...(customChanged ? { custom: true } : {}) } });
    void this.versions.record('flows', id, 'update_delta', callerId, { ...changed, ...(customChanged ? { custom: custom.value } : {}), confidential }).catch(() => {});
    const who = await this.displayName(db, callerId);
    // Confidential before or after the change: either way the subject stays out.
    const notified = { ...a.r, confidential: a.r.confidential || confidential };
    const named = noticeSubject(notified);
    const title = changed.urgent === true ? `${who} marked "${named}" as urgent` : `${who} updated "${named}"`;
    await this.notifyOthers(db, notified, callerId, 'flow.status', title, undefined,
      { key: changed.urgent === true ? 'notice.flow.markedUrgent' : 'notice.flow.updated', vars: { who, subject: subjectValue(notified) } }).catch(() => {});
    return { ok: true };
  }

  /** The requester submits a request that was sent back again: its workflow starts anew from the first step. */
  @Post(':id/resubmit')
  async resubmit(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const a = await this.access(db, orgId, callerId, id);
    if (!a) return { ok: false, error: 'not-found' };
    if (!a.requester || a.r.target_kind !== 'workflow' || a.r.archived_at) return { ok: false, error: 'forbidden' };
    const current = await this.workflowOf(db, a.r, callerId);
    if (!current?.returned) return { ok: false, error: 'not-returned' };
    const note = cleanFlowText(body?.note, MAX_BODY);
    await db.execute(sql`UPDATE flows SET status = 'open', resolved_at = NULL, last_activity_at = ${sqlNow()} WHERE id = ${id}`);
    await this.event(db, id, callerId, { workflow: 'resubmitted', ...(note ? { note } : {}) });
    const who = await this.displayName(db, callerId);
    const started = await this.workflowsSvc.start(db, {
      kind: FLOW_STEPS_KIND, variant: a.r.flow_type ?? '', organizationId: orgId, sourceTableUuid: id, actorUserId: callerId,
      workflowData: {}, notification: { title: `${who} submitted "${noticeSubject(a.r)}" again`, text: { key: 'notice.flow.resubmitted', vars: { who, subject: subjectValue(a.r) } } },
    });
    if (!started) return { ok: false, error: 'no-workflow' };
    void this.versions.record('flows', id, 'update_delta', callerId, { status: 'open', resubmitted: true }).catch(() => {});
    return { ok: true };
  }

  /** The requester withdraws a workflow request: its pending step ends, the request is resolved. */
  @Post(':id/withdraw')
  async withdraw(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const a = await this.access(db, orgId, callerId, id);
    if (!a) return { ok: false, error: 'not-found' };
    if (!a.requester || a.r.target_kind !== 'workflow' || a.r.archived_at || a.r.status === 'resolved') return { ok: false, error: 'forbidden' };
    await this.workflowsSvc.withdraw(db, 'flows', id, callerId);
    await db.execute(sql`UPDATE flows SET status = 'resolved', resolved_at = ${sqlNow()}, last_activity_at = ${sqlNow()} WHERE id = ${id}`);
    await this.event(db, id, callerId, { workflow: 'withdrawn' });
    void this.versions.record('flows', id, 'update_delta', callerId, { status: 'resolved', withdrawn: true }).catch(() => {});
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
    if (a.r.archived_at) return { ok: false, error: 'flow-archived' };
    const assignee = body.release ? null : callerId;
    const status: FlowStatus = !body.release && a.r.status === 'open' ? 'in_progress' : a.r.status;
    await db.execute(sql`UPDATE flows SET assignee_user_id = ${assignee}, status = ${status}, last_activity_at = ${sqlNow()} WHERE id = ${id}`);
    await this.event(db, id, callerId, { assignee, ...(status !== a.r.status ? { status } : {}) });
    void this.versions.record('flows', id, 'update_delta', callerId, { assignee_user_id: assignee, status }).catch(() => {});
    if (!body.release) {
      const who = await this.displayName(db, callerId);
      await this.notifyOthers(db, { ...a.r, assignee_user_id: null }, callerId, 'flow.status', `${who} is handling "${noticeSubject(a.r)}"`, undefined,
        { key: 'notice.flow.taken', vars: { who, subject: subjectValue(a.r) } }).catch(() => {});
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
    await db.execute(sql`UPDATE flows SET archived_at = ${archived ? sqlNow() : sql`NULL`}, last_activity_at = ${sqlNow()} WHERE id = ${id}`);
    await this.event(db, id, callerId, { archived });
    void this.versions.record('flows', id, 'update_delta', callerId, { archived }).catch(() => {});
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
    if (a.r.confidential) return { ok: false, error: 'flow-confidential' };
    return this.forwardMail.send(db, orgId, callerId, body ?? {}, { type: 'flow', id, path: `#/flows?id=${id}` });
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
      sql`SELECT 1 FROM documents d JOIN flow_messages m ON d.source_table = 'flow_messages' AND m.id = d.source_table_id
          WHERE d.id = ${documentId} AND m.flow_id = ${id}`,
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
