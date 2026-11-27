import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { callerUserId, can } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { organizations } from './db/schema';
import { VersionsService } from './versions.service';
import { isCanton } from '@worktime3/shared/worktime';
import { sqlToday } from './clock';

/**
 * The setup checklist on Home (SetupChecklist.tsx): what a new organization still needs before the
 * app works as intended, worked out from the data on every call, never stored. Only the dismissal
 * is stored (`organizations.settings.setupDismissed`). Shown to whoever may edit the organization
 * settings (`nav.orgSettings:edit`).
 */

export type SetupStepId = 'name' | 'holidays' | 'workTime' | 'departments' | 'people' | 'employment' | 'schedules' | 'projects' | 'look';

/** Where a step is done in the app: a section of App.tsx. */
export type SetupSection = 'orgSettings' | 'invitations' | 'users' | 'managementProjects';

export interface SetupStep {
  id: SetupStepId;
  done: boolean;
  /** Optional steps are shown but don't keep the checklist open. */
  optional: boolean;
  section: SetupSection;
  /** Names to show with the step (people without an assignment or a manager). */
  people?: string[];
  count?: number;
}

export interface SetupFacts {
  orgName: string;
  settings: Record<string, unknown>;
  members: { id: string; name: string; hasAssignment: boolean; managerId: string | null }[];
  pendingInvitations: number;
  departments: number;
  departmentsWithoutLeader: number;
  schedules: number;
  projects: number;
}

const WORK_TIME_KEYS = ['fullTimeWeeklyMinutes', 'vacationDaysPerYear', 'legalMaxWeeklyMinutes', 'balancesStartDate', 'projectTimeToleranceMinutes'];

/**
 * The checklist for an organization's facts. "Employment" is done when everyone has an assignment
 * in force and at most one person has no manager (the top of the chain): anyone else without one
 * has their timesheets, absences and expense reports approved automatically on submit.
 */
export function setupSteps(f: SetupFacts): SetupStep[] {
  const withoutAssignment = f.members.filter((m) => !m.hasAssignment);
  const withoutManager = f.members.filter((m) => m.hasAssignment && !m.managerId);
  return [
    { id: 'name', done: !/['’]s workspace$/i.test(f.orgName.trim()), optional: false, section: 'orgSettings' },
    { id: 'holidays', done: isCanton(f.settings.holidayRegion), optional: false, section: 'orgSettings' },
    { id: 'workTime', done: WORK_TIME_KEYS.some((k) => f.settings[k] !== undefined), optional: false, section: 'orgSettings' },
    {
      id: 'departments',
      done: f.departments > 0 && f.departmentsWithoutLeader === 0,
      optional: false,
      section: 'users',
      count: f.departmentsWithoutLeader,
    },
    { id: 'people', done: f.members.length > 1 || f.pendingInvitations > 0, optional: false, section: 'invitations', count: f.members.length },
    {
      id: 'employment',
      done: withoutAssignment.length === 0 && withoutManager.length <= 1,
      optional: false,
      section: 'users',
      people: [...withoutAssignment, ...(withoutManager.length > 1 ? withoutManager : [])].map((m) => m.name),
    },
    { id: 'schedules', done: f.schedules > 0, optional: true, section: 'users' },
    { id: 'projects', done: f.projects > 0, optional: true, section: 'managementProjects' },
    { id: 'look', done: f.settings.branding !== undefined || f.settings.modules !== undefined, optional: true, section: 'orgSettings' },
  ];
}

@Controller('organizations/:orgId/setup')
export class SetupController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
  ) {}

  private async editor(db: Db, orgId: string, req: AuthenticatedRequest): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId) return null;
    return (await can(db, orgId, callerId, 'nav.orgSettings', 'edit')) ? callerId : null;
  }

  /** `{ steps, dismissed, complete }`; complete = every required step done. */
  @Get()
  async status(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, steps: [], dismissed: true, complete: true };
    if (!(await this.editor(db, orgId, req))) return { ok: false, error: 'forbidden', steps: [], dismissed: true, complete: true };
    const [org] = await db.select({ name: organizations.name, settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId));
    if (!org) return { ok: false, error: 'not-found', steps: [], dismissed: true, complete: true };
    const settings = (org.settings && typeof org.settings === 'object' ? org.settings : {}) as Record<string, unknown>;

    const members = (
      await db.execute(sql`
        SELECT m.user_id AS id, coalesce(nullif(u.display_name, ''), u.email) AS name,
               a.user_id IS NOT NULL AS has_assignment, a.manager_user_id AS manager_id
        FROM organization_memberships m
        JOIN users u ON u.id = m.user_id
        LEFT JOIN (
          SELECT DISTINCT ON (user_id) user_id, manager_user_id FROM employee_assignments
          WHERE organization_id = ${orgId} AND valid_from <= ${sqlToday()}
          ORDER BY user_id, valid_from DESC
        ) a ON a.user_id = m.user_id
        WHERE m.organization_id = ${orgId} AND m.status = 'active'
        ORDER BY 2`)
    ).rows as { id: string; name: string; has_assignment: boolean; manager_id: string | null }[];
    const [counts] = (
      await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM organization_invitations WHERE organization_id = ${orgId} AND status = 'pending' AND expires_at > now()) AS invitations, -- real time: invitations expire in real time
          (SELECT count(*)::int FROM departments WHERE organization_id = ${orgId} AND is_active) AS departments,
          (SELECT count(*)::int FROM departments WHERE organization_id = ${orgId} AND is_active AND leader_user_id IS NULL) AS without_leader,
          (SELECT count(*)::int FROM work_schedules WHERE organization_id = ${orgId}) AS schedules,
          (SELECT count(*)::int FROM projects WHERE organization_id = ${orgId}) AS projects`)
    ).rows as { invitations: number; departments: number; without_leader: number; schedules: number; projects: number }[];

    const steps = setupSteps({
      orgName: org.name,
      settings,
      members: members.map((m) => ({ id: m.id, name: m.name, hasAssignment: m.has_assignment, managerId: m.manager_id })),
      pendingInvitations: counts.invitations,
      departments: counts.departments,
      departmentsWithoutLeader: counts.without_leader,
      schedules: counts.schedules,
      projects: counts.projects,
    });
    return { ok: true, steps, dismissed: settings.setupDismissed === true, complete: steps.every((s) => s.optional || s.done) };
  }

  /** Hides the checklist (`{ dismissed: true }`) or shows it again (`false`). */
  @Post('dismiss')
  async dismiss(@Param('orgId') orgId: string, @Body() body: { dismissed?: boolean }, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.editor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const dismissed = body?.dismissed !== false;
    await db
      .update(organizations)
      .set({ settings: sql`${organizations.settings} || ${JSON.stringify({ setupDismissed: dismissed })}::jsonb` })
      .where(eq(organizations.id, orgId));
    void this.versions.record('organizations', orgId, 'update_delta', callerId, { settings: { setupDismissed: dismissed } }).catch(() => {});
    return { ok: true, dismissed };
  }
}
