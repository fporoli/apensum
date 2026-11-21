import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbService, type Db } from './db.service';
import { callerUserId, isOrgMember, listableUserIds } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { WorkTimeModelService, localDate } from './work-time-model.service';
import { organization_memberships, timesheet_periods, users } from './db/schema';
import { addDays, type Holiday } from '@worktime3/shared/worktime';

/** Which permission object decides whose records each of the core's team tables lists. */
export const TEAM_OBJECTS: Record<string, string> = {
  workTime: 'nav.workTime',
  absences: 'nav.absences',
  timesheet: 'nav.timesheet',
  time: 'nav.time',
  projectTimesheet: 'nav.projectTimesheet',
};

/**
 * A plugin's team table (ApiPlugin.teamViews): the permission object that decides whose records it
 * lists, and the month's rows of those people (`userIds`, never empty, never the caller), each with
 * the person's `user_id`. The web part's `teamViews` entry of the same kind shows them.
 */
export interface ApiTeamView {
  kind: string;
  object: string;
  rows: (db: Db, ctx: { orgId: string; userIds: string[]; from: string; toExclusive: string }) => Promise<unknown[]>;
}

const PLUGIN_TEAM_VIEWS = new Map<string, ApiTeamView>();

/** Adds a plugin's team table (plugins.ts). */
export function registerTeamView(view: ApiTeamView): void {
  if (TEAM_OBJECTS[view.kind]) throw new Error(`Team view ${view.kind} is the core's`);
  PLUGIN_TEAM_VIEWS.set(view.kind, view);
}

/** 'YYYY-MM' → first day of that month and of the next one; null for anything else. */
export function monthRange(month: string | undefined): { from: string; toExclusive: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, '0')}`;
  return { from: `${m[1]}-${m[2]}-01`, toExclusive: `${next}-01` };
}

interface Person {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Team tables for managers and HR: one row per person whose records the caller may see
 * (direct reports, plus whoever the caller's grants cover), never the caller themselves.
 * Each page shows its own month summary and opens a person's details from it.
 */
@Controller()
export class TeamOverviewController {
  constructor(
    private readonly db: DbService,
    private readonly workTime: WorkTimeModelService,
  ) {}

  @Get('organizations/:orgId/team-overview')
  async overview(
    @Param('orgId') orgId: string,
    @Req() req: AuthenticatedRequest,
    @Query('kind') kind?: string,
    @Query('month') month?: string,
    @Query('peopleOnly') peopleOnly?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, people: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', people: [] };
    const plugin = PLUGIN_TEAM_VIEWS.get(kind ?? '');
    const object = TEAM_OBJECTS[kind ?? ''] ?? plugin?.object;
    if (!object) return { ok: false, error: 'invalid-kind', people: [] };
    // `peopleOnly` answers "is there a team to show?" without computing the month.
    if (peopleOnly) return { ok: true, people: await this.team(db, orgId, callerId, object) };
    const range = monthRange(month);
    if (!range) return { ok: false, error: 'invalid-month', people: [] };

    const people = await this.team(db, orgId, callerId, object);
    const ids = people.map((p) => p.id);
    const base = { ok: true as const, month, people };
    if (ids.length === 0) return { ...base, rows: [] };

    if (plugin) {
      // Only the people checked above, and only theirs.
      const allowed = new Set(ids);
      const rows = await plugin.rows(db, { orgId, userIds: ids, from: range.from, toExclusive: range.toExclusive });
      return { ...base, rows: rows.filter((r) => allowed.has(String((r as { user_id?: unknown }).user_id))) };
    }
    switch (kind) {
      case 'workTime':
      case 'timesheet':
        return { ...base, rows: await this.attendance(db, orgId, ids, range.from, range.toExclusive) };
      case 'absences':
        return { ...base, ...(await this.absences(db, orgId, ids, range.from, range.toExclusive)) };
      default:
        return { ...base, rows: await this.projectMonths(db, orgId, ids, range.from, range.toExclusive) };
    }
  }

  private async team(db: Db, orgId: string, callerId: string, object: string): Promise<Person[]> {
    const ids = await listableUserIds(db, orgId, callerId, object);
    if (ids !== 'all' && ids.filter((id) => id !== callerId).length === 0) return [];
    const conditions = [eq(organization_memberships.organization_id, orgId), eq(organization_memberships.status, 'active')];
    if (ids !== 'all') conditions.push(inArray(organization_memberships.user_id, ids));
    const rows = await db
      .select({ id: users.id, name: users.display_name, email: users.email })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(...conditions))
      .orderBy(asc(users.display_name));
    return rows.filter((r) => r.id !== callerId);
  }

  /** Target, attendance and the month's working-time timesheet status, per person. */
  private async attendance(db: Db, orgId: string, ids: string[], from: string, toExclusive: string) {
    const periods = await db
      .select({ user_id: timesheet_periods.user_id, id: timesheet_periods.id, status: timesheet_periods.status, submitted_at: timesheet_periods.submitted_at })
      .from(timesheet_periods)
      .where(and(eq(timesheet_periods.organization_id, orgId), inArray(timesheet_periods.user_id, ids), eq(timesheet_periods.period_start, from)));
    const periodOf = new Map(periods.map((p) => [p.user_id, p]));
    const open = await db.execute(sql`
      SELECT DISTINCT user_id FROM work_times
      WHERE organization_id = ${orgId} AND check_out IS NULL AND user_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
    const checkedIn = new Set((open.rows as { user_id: string }[]).map((r) => r.user_id));

    return Promise.all(
      ids.map(async (userId) => {
        const timeZone = await this.workTime.timeZone(db, userId);
        const [targets, attendance] = await Promise.all([
          this.workTime.targets(db, orgId, userId, from, toExclusive),
          this.workTime.attendanceByDay(db, orgId, userId, from, toExclusive, timeZone, true),
        ]);
        const today = localDate(new Date(), timeZone);
        let target = 0;
        let attended = 0;
        let difference = 0;
        let absence = 0;
        for (const d of targets) {
          const minutes = attendance.get(d.date) ?? 0;
          target += d.target;
          attended += minutes;
          absence += d.absence;
          // Only days already over count, so the current month doesn't look short.
          if (d.date < today) difference += minutes - d.target;
        }
        const period = periodOf.get(userId);
        return {
          userId,
          target,
          attended,
          difference,
          absence,
          workDays: [...attendance.values()].filter((m) => m > 0).length,
          checkedIn: checkedIn.has(userId),
          periodId: period?.id ?? null,
          status: period?.status ?? 'open',
          submittedAt: period?.submitted_at ?? null,
        };
      }),
    );
  }

  /** Absences overlapping the month (calendar and table), plus the organization's holidays. */
  private async absences(db: Db, orgId: string, ids: string[], from: string, toExclusive: string) {
    const result = await db.execute(sql`
      SELECT id, user_id, date_start::text AS date_start, date_end::text AS date_end, status, absence_type, half_day, note
      FROM absences
      WHERE organization_id = ${orgId}
        AND user_id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
        AND date_start <= ${addDays(toExclusive, -1)} AND date_end >= ${from}
      ORDER BY date_start`);
    const holidays = await this.workTime.holidays(db, orgId, from, toExclusive);
    // People at a location (087) may have other holidays than the organization's: theirs, where they differ.
    const personHolidays: Record<string, Holiday[]> = {};
    if ((await this.workTime.locations(db, orgId)).length > 0) {
      const sameAsOrg = (m: Map<string, Holiday>) => m.size === holidays.size && [...m].every(([d, h]) => holidays.get(d)?.fraction === h.fraction && holidays.get(d)?.name === h.name && holidays.get(d)?.key === h.key);
      for (const id of ids) {
        const own = await this.workTime.holidays(db, orgId, from, toExclusive, { userId: id });
        if (!sameAsOrg(own)) personHolidays[id] = [...own.values()];
      }
    }
    return { absences: result.rows, holidays: [...holidays.values()], personHolidays };
  }

  /** Project minutes per person and project, with that project month's timesheet status. */
  private async projectMonths(db: Db, orgId: string, ids: string[], from: string, toExclusive: string) {
    const list = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const result = await db.execute(sql`
      WITH booked AS (
        SELECT user_id, project_id,
               ROUND(SUM(EXTRACT(EPOCH FROM (end_time - start_time))) / 60)::int AS minutes,
               COUNT(*)::int AS entries
        FROM project_times
        WHERE organization_id = ${orgId} AND user_id IN (${list})
          AND start_time >= ${from}::date AND start_time < ${toExclusive}::date
        GROUP BY user_id, project_id
      ), periods AS (
        SELECT id, user_id, project_id, status, submitted_at
        FROM project_time_periods
        WHERE organization_id = ${orgId} AND user_id IN (${list}) AND period_start = ${from}::date
      )
      SELECT COALESCE(b.user_id, p.user_id) AS user_id,
             COALESCE(b.project_id, p.project_id) AS project_id,
             pr.name AS project_name,
             COALESCE(b.minutes, 0) AS minutes,
             COALESCE(b.entries, 0) AS entries,
             p.id AS period_id,
             COALESCE(p.status::text, 'open') AS status,
             p.submitted_at
      FROM booked b
      FULL JOIN periods p ON p.user_id = b.user_id AND p.project_id IS NOT DISTINCT FROM b.project_id
      LEFT JOIN projects pr ON pr.id = COALESCE(b.project_id, p.project_id)
      ORDER BY pr.name NULLS LAST`);
    return result.rows;
  }
}
