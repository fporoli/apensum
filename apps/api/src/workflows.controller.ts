import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { probationUntilOf } from './vacation';
import { VACATION_ABSENCE_TYPE } from '@worktime3/shared/worktime';
import { workflows, workflow_definitions, timesheet_periods, absences, users } from './db/schema';
import { WorkflowsService, takenOf, workflowHistory, type WorkflowStepDefinition } from './workflows.service';
import { ForwardMailService, type ForwardInput } from './forward-mail.service';
import { cursorOf, isUuid, parseCursor, parseLimit, parseListFilters, wordsMatch } from './list-filters';
import { sqlNow } from './clock';

/**
 * Generic surface over any workflow_definitions-driven approval: a manager's
 * (or whoever's) action-item queue, and approve/reject for whichever
 * workflow it is — see WorkflowsService for the actual engine. The frontend
 * "Approvals" screen is entirely driven by `assigned-to-me`, regardless of
 * workflow type.
 */
/** How many days a step one did stays under "Done" after the flow moved on (WORKFLOW_RECALL_DAYS, default 5). */
export function workflowRecallDays(env: NodeJS.ProcessEnv = process.env): number {
  const days = Number(env.WORKFLOW_RECALL_DAYS);
  return env.WORKFLOW_RECALL_DAYS?.trim() && Number.isInteger(days) && days >= 0 && days <= 365 ? days : 5;
}

/** A cursor of the workflow list (`<step started ISO>|<workflow id>`), or null when malformed. */
export function parseWorkflowCursor(value: string | undefined): { started: string; id: string } | null {
  const c = parseCursor(value);
  return c ? { started: c.at, id: c.id } : null;
}

/** The cursor of a row of the list, for the next page (`before`). */
export function workflowCursor(row: { id: string; started: string | Date | null }): string {
  return cursorOf({ id: row.id, at: row.started });
}

const STEP_STATES = ['pending', 'approved', 'rejected'] as const;

@Controller('workflows')
export class WorkflowsController {
  constructor(
    private readonly db: DbService,
    private readonly workflowsSvc: WorkflowsService,
    private readonly forwardMail: ForwardMailService,
  ) {}

  /**
   * Workflows with a step assigned to the caller, directly or through any team they belong to —
   * their action-item queue — or (`scope=mine`) the ones the caller submitted. `status`: pending
   * (default), approved, rejected or all; `orgId` keeps one organization's; `id` keeps that one item
   * (Flows' card of a workflow item), still only when it is in the list asked for.
   * Flows' filters narrow it further: `definition` (its kind), `state` (pending, approved, rejected; on
   * top of `status`, so "Done" keeps what it recalls), `since` (step started on or after), `person`
   * (who submitted it) and `q` (every word in the submitter's name or e-mail).
   */
  @Get('assigned-to-me')
  async assignedToMe(
    @Req() req: AuthenticatedRequest,
    @Query('status') status?: string,
    @Query('scope') scope?: string,
    @Query('orgId') orgId?: string,
    @Query('limit') limitParam?: string,
    @Query('before') before?: string,
    @Query('id') id?: string,
    @Query('definition') definition?: string,
    @Query('state') state?: string,
    @Query('since') since?: string,
    @Query('person') person?: string,
    @Query('q') q?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return [];
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return [];
    if (id !== undefined && !isUuid(id)) return [];
    // Requests follow a person's manager: bring the inbox up to date with dated manager changes.
    // What concerns the caller only (in the organization asked for): with them now, or of someone they manage today.
    await this.workflowsSvc.rerouteToCurrentManagers(db, { userId: callerId, ...(orgId && /^[0-9a-f-]{36}$/i.test(orgId) ? { organizationId: orgId } : {}) }).catch(() => 0);
    const teamIds = await this.workflowsSvc.callerTeamIds(db, callerId);
    const assignedToCaller = sql`${workflows.assigned_to_user_id} @> ARRAY[${callerId}]::uuid[]`;
    const assignment = teamIds.length > 0 ? or(assignedToCaller, inArray(workflows.assigned_to_team_id, teamIds)) : assignedToCaller;
    // "Done" (all statuses of one's queue) also recalls the flows the caller did a step of in the last
    // WORKFLOW_RECALL_DAYS days (default 5), now with someone else or finished: by the history's entries.
    const recalled = sql`EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${workflows.workflow_data} -> 'history') = 'array' THEN ${workflows.workflow_data} -> 'history' ELSE '[]'::jsonb END) e
      WHERE e ->> 'by' = ${callerId} AND e ->> 'key' <> 'approvals.event.submitted'
        AND CASE WHEN e ->> 'at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN (e ->> 'at')::timestamptz END >= ${sqlNow()} - make_interval(days => ${workflowRecallDays()}))`;
    const who = scope === 'mine'
      ? sql`${workflows.workflow_data} ->> 'submittedByUserId' = ${callerId}`
      : status === 'all' ? or(assignment, recalled)! : assignment;
    const conditions = [who];
    if (status !== 'all') conditions.push(eq(workflows.step_status, status === 'approved' || status === 'rejected' ? status : 'pending'));
    if (orgId && /^[0-9a-f-]{36}$/i.test(orgId)) conditions.push(eq(workflows.organization_id, orgId));
    if (id) conditions.push(eq(workflows.workflow_id, id));
    // Newest first, `limit` at a time (Flows -> Done: 200 and "Load older"); `before` is the last row's cursor.
    const limit = parseLimit(limitParam);
    const cursor = parseWorkflowCursor(before);
    // In milliseconds, as the cursor carries them (Postgres keeps microseconds).
    const startedOrZero = sql`date_trunc('milliseconds', COALESCE(${workflows.workflow_step_started}, 'epoch'::timestamptz))`;
    const filters = parseListFilters({ since, person, q });
    if (typeof definition === 'string' && definition && definition.length <= 200) conditions.push(eq(workflow_definitions.name, definition));
    if ((STEP_STATES as readonly string[]).includes(state ?? '')) conditions.push(eq(workflows.step_status, state as (typeof STEP_STATES)[number]));
    if (filters.since) conditions.push(sql`${startedOrZero} >= ${filters.since}::date`);
    const submitter = sql`${workflows.workflow_data} ->> 'submittedByUserId'`;
    if (filters.person) conditions.push(sql`${submitter} = ${filters.person}`);
    const words = wordsMatch([sql`su.display_name`, sql`su.email`], filters.words);
    if (words) conditions.push(sql`EXISTS (SELECT 1 FROM users su WHERE su.id::text = ${submitter} AND ${words})`);
    if (cursor) conditions.push(sql`(${startedOrZero}, ${workflows.workflow_id}) < (${cursor.started}::timestamptz, ${cursor.id}::uuid)`);
    const rawRows = await db
      .select({
        id: workflows.workflow_id,
        source_table: workflows.source_table,
        source_table_uuid: workflows.source_table_uuid,
        step: workflows.step,
        step_status: workflows.step_status,
        workflow_data: workflows.workflow_data,
        started: workflows.workflow_step_started,
        workflow_started: workflows.workflow_started,
        finished: workflows.workflow_finished,
        // Who decides (the first assignee): shown on one's own requests.
        assignee_name: sql<string | null>`(SELECT COALESCE(u.display_name, u.email) FROM users u WHERE u.id = (${workflows.assigned_to_user_id})[1])`,
        definition_name: workflow_definitions.name,
        // Whether the caller is at it now; false for one recalled from "done" (its step was the caller's).
        assigned_to_me: sql<boolean>`(${assignment})`,
        // How many it waits for (a step several people got is taken over first).
        assignee_count: sql<number>`COALESCE(cardinality(${workflows.assigned_to_user_id}), 0)`,
        // The steps the workflow started with, else (older ones) its definition's.
        steps: sql<unknown>`COALESCE(${workflows.steps}, ${workflow_definitions.steps})`,
      })
      .from(workflows)
      .innerJoin(workflow_definitions, eq(workflow_definitions.workflow_def_id, workflows.workflow_def_id))
      .where(and(...conditions))
      .orderBy(desc(startedOrZero), desc(workflows.workflow_id))
      .limit(limit || 100_000);

    // The "corresponding object" label/formatter for this row's step come from its workflow_definitions'
    // steps config (`source` / `source_name`) rather than being hardcoded per workflow type here.
    const rows = rawRows.map(({ steps, ...r }) => {
      const stepDefs = Array.isArray(steps) ? (steps as Partial<WorkflowStepDefinition>[]) : [];
      const index = stepDefs.findIndex((s) => s.key === r.step);
      const stepDef = index >= 0 ? stepDefs[index] : undefined;
      return {
        ...r,
        source: stepDef?.source ?? null,
        source_name: stepDef?.source_name ?? null,
        // The pending step, for its button: its text, whether it can be rejected, whether it is done in the dialog.
        step_label: stepDef?.label ?? null,
        step_number: index >= 0 ? index + 1 : null,
        step_count: stepDefs.length,
        step_action_key: stepDef?.actionKey ?? null,
        step_rejectable: stepDef?.rejectable !== false && stepDef?.reject !== 'none',
        // `back`: rejecting sends the request back to the person to change (the button says so).
        step_returns: stepDef?.reject === 'back',
        step_labels: stepDef?.labels ?? null,
        step_in_dialog: !!stepDef?.inDialog,
        // What the step asks the caller to fill in (a block with fields).
        step_fields: stepDef?.fields ?? null,
        step_private_answers: !!stepDef?.privateAnswers,
        // Several people got the step: one of them takes it over first (the card offers it, then the step's button).
        step_take_over: !!stepDef?.takeOver && r.step_status === 'pending' && Number(r.assignee_count) > 1,
        step_taken_by_me: !!stepDef?.takeOver && r.step_status === 'pending' && !!takenOf(r.workflow_data, r.step ?? '') && takenOf(r.workflow_data, r.step ?? '')?.by === callerId,
        // The step writes an e-mail first: it is done on the flow's page (its dialog).
        step_compose: !!stepDef?.compose,
      };
    });

    // Enrich each row with its record: the owner's name and what the record is. The core's tables
    // here; the plugins' through their registered loaders (WorkflowsService.registerSourceRecords).
    const periodIds = rows.filter((r) => r.source_table === 'timesheet_periods').map((r) => r.source_table_uuid);
    const absenceIds = rows.filter((r) => r.source_table === 'absences').map((r) => r.source_table_uuid);
    const projectPeriodIds = rows.filter((r) => r.source_table === 'project_time_periods').map((r) => r.source_table_uuid);

    const periodRows = periodIds.length
      ? await db
          .select({
            id: timesheet_periods.id,
            period_start: timesheet_periods.period_start,
            user_id: timesheet_periods.user_id,
            user_display_name: users.display_name,
            user_email: users.email,
          })
          .from(timesheet_periods)
          .innerJoin(users, eq(users.id, timesheet_periods.user_id))
          .where(inArray(timesheet_periods.id, periodIds))
      : [];
    const absenceRows = absenceIds.length
      ? await db
          .select({
            id: absences.id,
            organization_id: absences.organization_id,
            date_start: absences.date_start,
            date_end: absences.date_end,
            absence_type: absences.absence_type,
            half_day: absences.half_day,
            document_id: absences.document_id,
            user_id: absences.user_id,
            user_display_name: users.display_name,
            user_email: users.email,
          })
          .from(absences)
          .innerJoin(users, eq(users.id, absences.user_id))
          .where(inArray(absences.id, absenceIds))
      : [];
    // Project months: who, which project, which month, and how many minutes it holds.
    const projectPeriodRows = projectPeriodIds.length
      ? ((
          await db.execute(sql`
            SELECT ptp.id, to_char(ptp.period_start, 'YYYY-MM-DD') AS period_start, ptp.user_id, u.display_name AS user_display_name, u.email AS user_email,
                   ptp.project_id, p.name AS project_name,
                   COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (pt.end_time - pt.start_time))) / 60 FROM project_times pt
                             WHERE pt.organization_id = ptp.organization_id AND pt.user_id = ptp.user_id AND pt.project_id = ptp.project_id
                               AND pt.start_time::date >= ptp.period_start AND pt.start_time::date < ptp.period_end), 0) AS minutes
            FROM project_time_periods ptp
            JOIN users u ON u.id = ptp.user_id
            JOIN projects p ON p.id = ptp.project_id
            WHERE ptp.id IN (${sql.join(projectPeriodIds.map((id) => sql`${id}`), sql`, `)})`)
        ).rows as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          period_start: String(r.period_start).slice(0, 10),
          user_id: String(r.user_id),
          user_display_name: r.user_display_name as string,
          user_email: r.user_email as string,
          project_id: String(r.project_id),
          project_name: r.project_name as string,
          minutes: Math.round(Number(r.minutes)),
        }))
      : [];
    const projectPeriodById = new Map(projectPeriodRows.map((p) => [p.id, p]));
    const periodById = new Map(periodRows.map((p) => [p.id, p]));
    const pluginRecords: { sourceTable: string; field: string; byId: Map<string, Record<string, unknown>> }[] = [];
    for (const [sourceTable, { field, load }] of this.workflowsSvc.sourceRecords()) {
      const ids = rows.filter((r) => r.source_table === sourceTable).map((r) => r.source_table_uuid);
      const records = ids.length ? await load(db, ids).catch(() => []) : [];
      pluginRecords.push({ sourceTable, field, byId: new Map(records.map((x) => [x.id, x])) });
    }
    const absenceItems = await Promise.all(
      absenceRows.map(async ({ organization_id, ...a }) => {
        const until = a.absence_type === VACATION_ABSENCE_TYPE && organization_id ? await probationUntilOf(db, organization_id, a.user_id) : null;
        return { ...a, probation_until: until && a.date_start <= until ? until : null };
      }),
    );
    const absenceById = new Map(absenceItems.map((a) => [a.id, a]));
    // Each item's history, with the names of who did what.
    const histories = new Map(rows.map((r) => [r.id, workflowHistory(r.workflow_data, { started: r.workflow_started, finished: r.finished, status: r.step_status })]));
    const actorIds = [...new Set([...histories.values()].flat().map((e) => e.by).filter((x): x is string => !!x))];
    const actorNames = new Map(
      actorIds.length
        ? (await db.select({ id: users.id, name: users.display_name, email: users.email }).from(users).where(inArray(users.id, actorIds))).map((u) => [u.id, u.name || u.email])
        : [],
    );
    return rows.map(({ workflow_started: _started, ...r }) => ({
      ...r,
      // Where the next page starts (`before`, Flows -> Done "Load older").
      cursor: workflowCursor(r),
      // A form step's answers (`inputs`) are shown where the item's own page decides who sees them (a request's thread).
      workflow_data: withoutInputs(r.workflow_data),
      history: (histories.get(r.id) ?? []).map((e) => ({ ...e, by_name: e.by ? (actorNames.get(e.by) ?? null) : null })),
      // The caller submitted it: deciding on it oneself is allowed, but shown (four-eyes principle).
      is_own: (r.workflow_data as Record<string, unknown> | null)?.submittedByUserId === callerId,
      timesheet_period: r.source_table === 'timesheet_periods' ? (periodById.get(r.source_table_uuid) ?? null) : null,
      ...Object.fromEntries(pluginRecords.map((p) => [p.field, r.source_table === p.sourceTable ? (p.byId.get(r.source_table_uuid) ?? null) : null])),
      absence: r.source_table === 'absences' ? (absenceById.get(r.source_table_uuid) ?? null) : null,
      project_time_period: r.source_table === 'project_time_periods' ? (projectPeriodById.get(r.source_table_uuid) ?? null) : null,
    }));
  }

  /** "Send by e-mail" on an Approvals item: mails it to colleagues (`{ userIds, subject, message }`). */
  @Post(':id/forward')
  async forward(@Param('id') id: string, @Body() body: ForwardInput, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    const orgId = callerId && /^[0-9a-f-]{36}$/i.test(id) ? await this.workflowsSvc.actorOrganization(db, id, callerId) : null;
    if (!callerId || !orgId) return { ok: false, error: 'not-found' };
    return this.forwardMail.send(db, orgId, callerId, body ?? {}, { type: 'workflow', id, path: '#/approvals' });
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() body: { note?: string; values?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    return this.workflowsSvc.resolve(db, id, callerId, 'approved', body?.note, body?.values);
  }

  /** One of a step's several assignees takes it over (`{ release: true }` gives it back to everyone it had). */
  @Post(':id/take')
  async take(@Param('id') id: string, @Body() body: { release?: boolean }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: 'unauthenticated' };
    const result = await this.workflowsSvc.take(db, id, callerId, body?.release === true);
    return result.ok ? { ok: true } : result;
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { note?: string }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return { ok: false, error: 'unauthenticated' };
    return this.workflowsSvc.resolve(db, id, callerId, 'rejected', body?.note);
  }
}

/** A workflow's data without the answers of its form steps (`workflow_data.inputs`). */
export function withoutInputs(data: unknown): unknown {
  if (!data || typeof data !== 'object' || !('inputs' in data)) return data;
  const { inputs: _inputs, ...rest } = data as Record<string, unknown>;
  return rest;
}
