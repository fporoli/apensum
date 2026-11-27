import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req } from '@nestjs/common';
import { cleanUnitCode, codeFromName } from '@worktime3/shared/workflowConfig';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DbService, type Db } from './db.service';
import { callerUserId, can, canSeeUserData, isOrgMember, membershipManagerId, reachesAll } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { WorkflowsService } from './workflows.service';
import { departments, employee_assignments, locations, organization_memberships, users } from './db/schema';
import { probationUntilOf } from './vacation';
import { addDays, isIsoDate } from '@worktime3/shared/worktime';
import { clock, sqlNow, sqlToday } from './clock';

/** Permission object of a person's employment (start date, department, function, manager). */
export const EMPLOYMENT_OBJECT = 'section.people.employment';
const MAX_NAME = 120;

/** The person's time zone, as WorkTimeModelService.timeZone reads it (balances count days in it). */
async function personTimeZone(db: Db, userId: string): Promise<string> {
  const [row] = await db.select({ timezone: users.timezone }).from(users).where(eq(users.id, userId));
  return row?.timezone || 'UTC';
}

function addDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The last day of a person's employment, or null: `exit_at` is the moment it ends (the start of the
 * next day in their time zone), so the last day is the local day before it.
 */
export async function lastWorkingDay(db: Db, orgId: string, userId: string): Promise<string | null> {
  const rows = (await db.execute(sql`
    SELECT to_char(((m.exit_at AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC')) - interval '1 microsecond')::date, 'YYYY-MM-DD') AS last_day
    FROM organization_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ${orgId} AND m.user_id = ${userId} AND m.exit_at IS NOT NULL
  `)).rows as { last_day: string }[];
  return rows[0]?.last_day ?? null;
}

/** Trimmed text, null when empty; undefined when too long. */
export function cleanText(value: unknown, max = MAX_NAME): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  if (!t) return null;
  return t.length > max ? undefined : t;
}

interface AssignmentBody {
  validFrom?: string;
  departmentId?: string | null;
  jobFunction?: string | null;
  managerUserId?: string | null;
  /** The location (work place, 087): its canton's holidays apply from `validFrom` on. */
  locationId?: string | null;
  /** Management from `validFrom` on (vacation rules; no right). */
  isManagement?: boolean;
}

/**
 * Departments (Organization settings) and each person's employment: their start date and dated
 * assignments, each naming a department, a function and a manager from `valid_from` on.
 * A department's leader is only the default manager offered for new assignments; who manages a
 * person is always the manager of their assignment in force (`membershipManagerId`).
 */
@Controller()
export class EmploymentController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
    private readonly workflows: WorkflowsService,
  ) {}

  // ---------- departments ----------

  @Get('organizations/:orgId/departments')
  async listDepartments(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, departments: [], canEdit: false };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', departments: [], canEdit: false };
    const leader = alias(users, 'leader');
    const rows = await db
      .select({
        id: departments.id,
        name: departments.name,
        leader_user_id: departments.leader_user_id,
        leader_name: leader.display_name,
        is_active: departments.is_active,
        sort_order: departments.sort_order,
        code: departments.code,
      })
      .from(departments)
      .leftJoin(leader, eq(leader.id, departments.leader_user_id))
      .where(eq(departments.organization_id, orgId))
      .orderBy(asc(departments.sort_order), asc(departments.name));
    // People in each department today.
    const counts = await db.execute(sql`
      SELECT department_id, COUNT(*)::int AS members FROM (
        SELECT DISTINCT ON (user_id) user_id, department_id FROM employee_assignments
        WHERE organization_id = ${orgId} AND valid_from <= ${sqlToday()}
        ORDER BY user_id, valid_from DESC
      ) current_assignment WHERE department_id IS NOT NULL GROUP BY department_id`);
    const membersOf = new Map((counts.rows as { department_id: string; members: number }[]).map((r) => [r.department_id, r.members]));
    return {
      ok: true,
      departments: rows.map((r) => ({ ...r, members: membersOf.get(r.id) ?? 0 })),
      canEdit: await reachesAll(db, orgId, callerId, EMPLOYMENT_OBJECT, 'edit'),
    };
  }

  @Post('organizations/:orgId/departments')
  async createDepartment(
    @Param('orgId') orgId: string,
    @Body() body: { name?: string; leaderUserId?: string | null; sortOrder?: number; code?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.departmentEditor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const name = cleanText(body.name);
    if (!name) return { ok: false, error: 'invalid-name' };
    const leader = await this.checkLeader(db, orgId, body.leaderUserId);
    if (leader === false) return { ok: false, error: 'leader-not-a-member' };
    if (await this.nameTaken(db, orgId, name)) return { ok: false, error: 'duplicate-name' };
    // Its code (workflows name it): the one given, else one made from the name.
    const given = cleanUnitCode(body.code);
    if (given === undefined) return { ok: false, error: 'invalid-code' };
    const code = given ?? (await this.freeCode(db, orgId, codeFromName(name)));
    if (given && (await this.codeTaken(db, orgId, given))) return { ok: false, error: 'duplicate-code' };
    const values = {
      organization_id: orgId,
      name,
      code,
      leader_user_id: leader,
      sort_order: Number.isInteger(body.sortOrder) ? (body.sortOrder as number) : 0,
    };
    const [row] = await db.insert(departments).values(values).returning({ id: departments.id });
    void this.versions.record('departments', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
    void this.audit.record(orgId, callerId, 'department.create', 'department', row.id, values).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Patch('organizations/:orgId/departments/:id')
  async updateDepartment(
    @Param('orgId') orgId: string,
    @Param('id') id: string,
    @Body() body: { name?: string; leaderUserId?: string | null; isActive?: boolean; sortOrder?: number; code?: string },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.departmentEditor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const [existing] = await db.select({ id: departments.id, code: departments.code }).from(departments).where(and(eq(departments.id, id), eq(departments.organization_id, orgId)));
    if (!existing) return { ok: false, error: 'not-found' };

    const patch: Partial<typeof departments.$inferInsert> = {};
    if (body.name !== undefined) {
      const name = cleanText(body.name);
      if (!name) return { ok: false, error: 'invalid-name' };
      if (await this.nameTaken(db, orgId, name, id)) return { ok: false, error: 'duplicate-name' };
      patch.name = name;
    }
    if (body.leaderUserId !== undefined) {
      const leader = await this.checkLeader(db, orgId, body.leaderUserId);
      if (leader === false) return { ok: false, error: 'leader-not-a-member' };
      patch.leader_user_id = leader;
    }
    if (typeof body.isActive === 'boolean') patch.is_active = body.isActive;
    if (Number.isInteger(body.sortOrder)) patch.sort_order = body.sortOrder as number;
    if (body.code !== undefined) {
      const code = cleanUnitCode(body.code);
      if (!code) return { ok: false, error: 'invalid-code' };
      if (code !== existing.code && (await this.codeTaken(db, orgId, code, id))) return { ok: false, error: 'duplicate-code' };
      if (code !== existing.code) patch.code = code;
    }
    if (Object.keys(patch).length === 0) return { ok: true, noop: true };
    await db.update(departments).set(patch).where(eq(departments.id, id));
    // Workflows name departments by code: their stored configurations follow the new one.
    if (patch.code && existing.code) await this.workflows.renameUnit(db, orgId, 'department', existing.code, patch.code);
    void this.versions.record('departments', id, 'update_delta', callerId, patch).catch(() => {});
    void this.audit.record(orgId, callerId, 'department.update', 'department', id, patch).catch(() => {});
    return { ok: true };
  }

  /** Deletes an unused department; one that appears in anyone's history is deactivated instead. */
  @Delete('organizations/:orgId/departments/:id')
  async deleteDepartment(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.departmentEditor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const [existing] = await db.select({ id: departments.id, code: departments.code }).from(departments).where(and(eq(departments.id, id), eq(departments.organization_id, orgId)));
    if (!existing) return { ok: false, error: 'not-found' };
    const [used] = await db.select({ n: count() }).from(employee_assignments).where(eq(employee_assignments.department_id, id));
    if (Number(used?.n ?? 0) > 0) return { ok: false, error: 'department-in-use' };
    if (existing.code && (await this.workflows.unitInUse(db, orgId, 'department', existing.code))) return { ok: false, error: 'department-in-workflow' };
    await db.delete(departments).where(eq(departments.id, id));
    // As the link table's cascade did: the department leaves the audiences of news posts.
    await db.execute(sql`UPDATE news_posts SET department_ids = array_remove(department_ids, ${id}::uuid) WHERE organization_id = ${orgId} AND ${id}::uuid = ANY(department_ids)`);
    void this.versions.record('departments', id, 'delete', callerId, { id }).catch(() => {});
    void this.audit.record(orgId, callerId, 'department.delete', 'department', id, {}).catch(() => {});
    return { ok: true };
  }

  // ---------- a person's employment ----------

  @Get('organizations/:orgId/users/:userId/employment')
  async employment(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, assignments: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', assignments: [] };
    if (!(await canSeeUserData(db, orgId, callerId, EMPLOYMENT_OBJECT, userId))) return { ok: false, error: 'forbidden', assignments: [] };

    const [membership] = await db
      .select({ start_date: organization_memberships.start_date, joined_at: organization_memberships.joined_at, probation_until: organization_memberships.probation_until, deputy_user_id: organization_memberships.deputy_user_id })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)));
    if (!membership) return { ok: false, error: 'unknown-user', assignments: [] };
    const [deputy] = membership.deputy_user_id
      ? await db.select({ id: users.id, name: users.display_name, email: users.email }).from(users).where(eq(users.id, membership.deputy_user_id))
      : [];
    const lastDay = await lastWorkingDay(db, orgId, userId);

    const manager = alias(users, 'manager');
    const assignments = await db
      .select({
        id: employee_assignments.id,
        valid_from: employee_assignments.valid_from,
        department_id: employee_assignments.department_id,
        department_name: departments.name,
        job_function: employee_assignments.job_function,
        manager_user_id: employee_assignments.manager_user_id,
        manager_name: manager.display_name,
        location_id: employee_assignments.location_id,
        location_name: locations.name,
        is_management: employee_assignments.is_management,
      })
      .from(employee_assignments)
      .leftJoin(departments, eq(departments.id, employee_assignments.department_id))
      .leftJoin(manager, eq(manager.id, employee_assignments.manager_user_id))
      .leftJoin(locations, eq(locations.id, employee_assignments.location_id))
      .where(and(eq(employee_assignments.organization_id, orgId), eq(employee_assignments.user_id, userId)))
      .orderBy(desc(employee_assignments.valid_from));
    const today = clock.now().toISOString().slice(0, 10);
    return {
      ok: true,
      startDate: membership.start_date ?? membership.joined_at?.slice(0, 10) ?? null,
      exitDate: lastDay,
      probationUntil: await probationUntilOf(db, orgId, userId),
      /** HR set the end, instead of the organization's months. */
      probationSet: !!membership.probation_until,
      currentId: assignments.find((a) => a.valid_from <= today)?.id ?? null,
      assignments,
      canEdit: await can(db, orgId, callerId, EMPLOYMENT_OBJECT, 'edit', userId),
      /** Who takes the person's flow steps while they are away (workflow-dues.service.ts). */
      deputy: deputy ? { userId: deputy.id, name: deputy.name || deputy.email } : null,
      /** The person sets their own deputy; HR (employment edit) anyone's. */
      canSetDeputy: callerId === userId || (await can(db, orgId, callerId, EMPLOYMENT_OBJECT, 'edit', userId)),
    };
  }

  /**
   * The person's deputy (`deputyUserId`, null = none): while they are away, the steps of flows waiting for them go to
   * the deputy as well. The person sets it for themselves, HR (employment edit) for anyone; the deputy is an active
   * member of the organization and not the person.
   */
  @Put('organizations/:orgId/users/:userId/deputy')
  async setDeputy(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { deputyUserId?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    if (callerId !== userId && !(await can(db, orgId, callerId, EMPLOYMENT_OBJECT, 'edit', userId))) return { ok: false, error: 'forbidden' };
    const deputyUserId = body.deputyUserId ?? null;
    if (deputyUserId !== null) {
      if (typeof deputyUserId !== 'string' || !/^[0-9a-f-]{36}$/i.test(deputyUserId)) return { ok: false, error: 'unknown-user' };
      if (deputyUserId === userId) return { ok: false, error: 'deputy-self' };
      const [member] = (await db.execute(sql`
        SELECT 1 FROM organization_memberships WHERE organization_id = ${orgId}::uuid AND user_id = ${deputyUserId}::uuid
          AND status = 'active' AND (exit_at IS NULL OR exit_at > ${sqlNow()})`)).rows;
      if (!member) return { ok: false, error: 'unknown-user' };
    }
    const [membership] = await db
      .select({ id: organization_memberships.id })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)));
    if (!membership) return { ok: false, error: 'unknown-user' };
    await db.update(organization_memberships).set({ deputy_user_id: deputyUserId }).where(eq(organization_memberships.id, membership.id));
    void this.versions.record('organization_memberships', membership.id, 'update_delta', callerId, { deputy_user_id: deputyUserId }).catch(() => {});
    void this.audit.record(orgId, callerId, 'membership.deputy', 'membership', membership.id).catch(() => {});
    return { ok: true };
  }

  @Put('organizations/:orgId/users/:userId/start-date')
  async setStartDate(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { startDate?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.employmentEditor(db, orgId, userId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const startDate = body.startDate ?? null;
    if (startDate !== null && !isIsoDate(startDate)) return { ok: false, error: 'invalid-date' };
    const [membership] = await db
      .select({ id: organization_memberships.id })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)));
    if (!membership) return { ok: false, error: 'unknown-user' };
    await db.update(organization_memberships).set({ start_date: startDate }).where(eq(organization_memberships.id, membership.id));
    void this.versions.record('organization_memberships', membership.id, 'update_delta', callerId, { start_date: startDate }).catch(() => {});
    void this.audit.record(orgId, callerId, 'membership.start-date', 'membership', membership.id).catch(() => {});
    return { ok: true };
  }

  /**
   * The last day of employment (`lastDay`, null = none): stored as `exit_at`, the start of the next day
   * in the person's time zone, so balances (vacation prorated up to it), the directory and reports end
   * there. Set by whoever edits employment (HR, admin; HR-Prozesse starts its exit process from it).
   */
  @Put('organizations/:orgId/users/:userId/exit-date')
  async setExitDate(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { lastDay?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.employmentEditor(db, orgId, userId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const lastDay = body.lastDay ?? null;
    if (lastDay !== null && !isIsoDate(lastDay)) return { ok: false, error: 'invalid-date' };
    const [membership] = await db
      .select({ id: organization_memberships.id, start_date: organization_memberships.start_date, joined_at: organization_memberships.joined_at })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)));
    if (!membership) return { ok: false, error: 'unknown-user' };
    const timeZone = await personTimeZone(db, userId);
    if (lastDay !== null) {
      const start = membership.start_date ?? null;
      if (start && lastDay < start) return { ok: false, error: 'exit-before-start' };
      // exit_at must come after joined_at (the account's start, chk_membership_exit_after_joined).
      const [check] = (await db.execute(sql`
        SELECT (${addDay(lastDay)}::date::timestamp AT TIME ZONE ${timeZone}) > ${membership.joined_at}::timestamptz AS after
      `)).rows as { after: boolean }[];
      if (membership.joined_at && !check?.after) return { ok: false, error: 'exit-before-start' };
    }
    await db.execute(sql`
      UPDATE organization_memberships
      SET exit_at = ${lastDay === null ? null : sql`(${addDay(lastDay)}::date::timestamp AT TIME ZONE ${timeZone})`}
      WHERE id = ${membership.id}
    `);
    void this.versions.record('organization_memberships', membership.id, 'update_delta', callerId, { exit_last_day: lastDay }).catch(() => {});
    void this.audit.record(orgId, callerId, 'membership.exit-date', 'membership', membership.id).catch(() => {});
    return { ok: true };
  }

  /** The last day of probation for this person (`until`; before the start = none, null = the organization's months). */
  @Put('organizations/:orgId/users/:userId/probation')
  async setProbation(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: { until?: string | null },
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.employmentEditor(db, orgId, userId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const until = body.until ?? null;
    if (until !== null && !isIsoDate(until)) return { ok: false, error: 'invalid-date' };
    const [membership] = await db
      .select({ id: organization_memberships.id, start_date: organization_memberships.start_date, joined_at: organization_memberships.joined_at })
      .from(organization_memberships)
      .where(and(eq(organization_memberships.organization_id, orgId), eq(organization_memberships.user_id, userId)));
    if (!membership) return { ok: false, error: 'unknown-user' };
    const start = membership.start_date ?? membership.joined_at?.slice(0, 10);
    // Three months at most, longer only by the days of sickness, accident or service (CO 335b): a year is plenty.
    if (until && start && (until < addDays(start, -1) || until > addDays(start, 366))) return { ok: false, error: 'invalid-probation' };
    await db.update(organization_memberships).set({ probation_until: until }).where(eq(organization_memberships.id, membership.id));
    void this.versions.record('organization_memberships', membership.id, 'update_delta', callerId, { probation_until: until }).catch(() => {});
    void this.audit.record(orgId, callerId, 'membership.probation', 'membership', membership.id).catch(() => {});
    return { ok: true };
  }

  @Post('organizations/:orgId/users/:userId/assignments')
  async addAssignment(
    @Param('orgId') orgId: string,
    @Param('userId') userId: string,
    @Body() body: AssignmentBody,
    @Req() req: AuthenticatedRequest,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.employmentEditor(db, orgId, userId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    if (!(await isOrgMember(db, orgId, userId))) return { ok: false, error: 'unknown-user' };
    const checked = await this.checkAssignment(db, orgId, userId, body);
    if ('error' in checked) return { ok: false, error: checked.error };
    if (await this.dateTaken(db, orgId, userId, checked.valid_from)) return { ok: false, error: 'duplicate-date' };

    const values = { organization_id: orgId, user_id: userId, ...checked };
    const [row] = await db.insert(employee_assignments).values(values).returning({ id: employee_assignments.id });
    void this.versions.record('employee_assignments', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
    void this.audit.record(orgId, callerId, 'employment.assign', 'user', userId, { id: row.id }).catch(() => {});
    await this.workflows.rerouteToCurrentManagers(db, { organizationId: orgId, subjectId: userId }).catch(() => 0);
    return { ok: true, id: row.id };
  }

  @Patch('organizations/:orgId/assignments/:id')
  async updateAssignment(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: AssignmentBody, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const row = await this.assignment(db, orgId, id);
    if (!row) return { ok: false, error: 'not-found' };
    const callerId = await this.employmentEditor(db, orgId, row.user_id, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const merged: AssignmentBody = {
      validFrom: body.validFrom ?? row.valid_from,
      departmentId: body.departmentId !== undefined ? body.departmentId : row.department_id,
      jobFunction: body.jobFunction !== undefined ? body.jobFunction : row.job_function,
      managerUserId: body.managerUserId !== undefined ? body.managerUserId : row.manager_user_id,
      locationId: body.locationId !== undefined ? body.locationId : row.location_id,
      isManagement: body.isManagement !== undefined ? body.isManagement : row.is_management,
    };
    const checked = await this.checkAssignment(db, orgId, row.user_id, merged);
    if ('error' in checked) return { ok: false, error: checked.error };
    if (checked.valid_from !== row.valid_from && (await this.dateTaken(db, orgId, row.user_id, checked.valid_from))) return { ok: false, error: 'duplicate-date' };

    await db.update(employee_assignments).set(checked).where(eq(employee_assignments.id, id));
    void this.versions.record('employee_assignments', id, 'update_delta', callerId, checked).catch(() => {});
    void this.audit.record(orgId, callerId, 'employment.update', 'user', row.user_id, { id }).catch(() => {});
    await this.workflows.rerouteToCurrentManagers(db, { organizationId: orgId, subjectId: row.user_id }).catch(() => 0);
    return { ok: true };
  }

  @Delete('organizations/:orgId/assignments/:id')
  async deleteAssignment(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const row = await this.assignment(db, orgId, id);
    if (!row) return { ok: false, error: 'not-found' };
    const callerId = await this.employmentEditor(db, orgId, row.user_id, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    await db.delete(employee_assignments).where(eq(employee_assignments.id, id));
    void this.versions.record('employee_assignments', id, 'delete', callerId, row).catch(() => {});
    void this.audit.record(orgId, callerId, 'employment.delete', 'user', row.user_id, { id }).catch(() => {});
    await this.workflows.rerouteToCurrentManagers(db, { organizationId: orgId, subjectId: row.user_id }).catch(() => 0);
    return { ok: true };
  }

  // ---------- helpers ----------

  /** Whether another department of the organization has `code`. */
  private async codeTaken(db: Db, orgId: string, code: string, exceptId?: string): Promise<boolean> {
    const rows = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.organization_id, orgId), eq(departments.code, code)));
    return rows.some((r) => r.id !== exceptId);
  }

  /** `base`, or `base-2`, `base-3`, ... whichever the organization doesn't use yet. */
  private async freeCode(db: Db, orgId: string, base: string): Promise<string> {
    for (let n = 1; ; n++) {
      const code = n === 1 ? base : `${base.slice(0, 36)}-${n}`;
      if (!(await this.codeTaken(db, orgId, code))) return code;
    }
  }

  private async departmentEditor(db: Db, orgId: string, req: AuthenticatedRequest): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    // HR's: a department's leader and members handle its requests, the confidential ones included.
    if (!callerId || !(await reachesAll(db, orgId, callerId, EMPLOYMENT_OBJECT, 'edit'))) return null;
    return callerId;
  }

  private async employmentEditor(db: Db, orgId: string, userId: string, req: AuthenticatedRequest): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return null;
    return (await can(db, orgId, callerId, EMPLOYMENT_OBJECT, 'edit', userId)) ? callerId : null;
  }

  /** The leader id to store: null for none, false when not a member of the org. */
  private async checkLeader(db: Db, orgId: string, leaderUserId: string | null | undefined): Promise<string | null | false> {
    if (!leaderUserId) return null;
    return (await isOrgMember(db, orgId, leaderUserId)) ? leaderUserId : false;
  }

  private async nameTaken(db: Db, orgId: string, name: string, exceptId?: string): Promise<boolean> {
    const rows = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.organization_id, orgId), sql`lower(${departments.name}) = lower(${name})`));
    return rows.some((r) => r.id !== exceptId);
  }

  private async dateTaken(db: Db, orgId: string, userId: string, validFrom: string): Promise<boolean> {
    const rows = await db
      .select({ id: employee_assignments.id })
      .from(employee_assignments)
      .where(and(eq(employee_assignments.organization_id, orgId), eq(employee_assignments.user_id, userId), eq(employee_assignments.valid_from, validFrom)));
    return rows.length > 0;
  }

  private async assignment(db: Db, orgId: string, id: string) {
    const [row] = await db
      .select({
        user_id: employee_assignments.user_id,
        valid_from: employee_assignments.valid_from,
        department_id: employee_assignments.department_id,
        job_function: employee_assignments.job_function,
        manager_user_id: employee_assignments.manager_user_id,
        location_id: employee_assignments.location_id, is_management: employee_assignments.is_management,
      })
      .from(employee_assignments)
      .where(and(eq(employee_assignments.id, id), eq(employee_assignments.organization_id, orgId)));
    return row ?? null;
  }

  /** Validates an assignment: a date, the org's department, a function, and a manager who is a member and not in a loop. */
  private async checkAssignment(
    db: Db,
    orgId: string,
    userId: string,
    body: AssignmentBody,
  ): Promise<{ valid_from: string; department_id: string | null; job_function: string | null; manager_user_id: string | null; location_id: string | null; is_management: boolean } | { error: string }> {
    if (!isIsoDate(body.validFrom)) return { error: 'invalid-date' };
    const jobFunction = cleanText(body.jobFunction);
    if (jobFunction === undefined) return { error: 'invalid-function' };
    const departmentId = body.departmentId || null;
    if (departmentId) {
      const [dep] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, departmentId), eq(departments.organization_id, orgId)));
      if (!dep) return { error: 'unknown-department' };
    }
    const locationId = body.locationId || null;
    if (locationId) {
      const [loc] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.id, locationId), eq(locations.organization_id, orgId)));
      if (!loc) return { error: 'unknown-location' };
    }
    const managerUserId = body.managerUserId || null;
    if (managerUserId) {
      if (managerUserId === userId) return { error: 'cannot-be-own-manager' };
      if (!(await isOrgMember(db, orgId, managerUserId))) return { error: 'manager-not-a-member' };
      // Walk the manager's chain on that date: reaching the person again would be a loop.
      let current: string | null = managerUserId;
      for (let i = 0; current && i < 50; i++) {
        current = await membershipManagerId(db, orgId, current, body.validFrom);
        if (current === userId) return { error: 'manager-cycle' };
      }
    }
    return { valid_from: body.validFrom, department_id: departmentId, job_function: jobFunction, manager_user_id: managerUserId, location_id: locationId, is_management: body.isManagement === true };
  }
}
