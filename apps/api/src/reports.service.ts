import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import type { DbService } from './db.service';
import { BalancesService, type MonthBalance } from './balances.service';
import { WorkTimeModelService } from './work-time-model.service';
import { checkWorkingTimeAct } from './working-time-act';
import { weekStart } from '@worktime3/shared/worktime';
import { can, isOrgMember, listableUserIds } from './access';
import { employee_assignments, organization_memberships, project_times, projects, users, work_times } from './db/schema';
import { reportSource } from './report-sources';
import { groupReport, monthEnd, monthsBetween, parseGroupBy, reportById, type ReportDefinition, type ReportRow } from '@worktime3/shared/reports';
import { clock, sqlToday } from './clock';

type Db = NonNullable<ReturnType<DbService['getDb']>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** Months that count in a report: from the person's start, up to and including the current one. */
function counts(m: MonthBalance): boolean {
  return m.status !== 'before-start' && m.status !== 'after-end' && m.status !== 'future';
}

/** Attendance and overtime rows of one person: one per month, from the balances (same numbers as the Balances page). */
export function attendanceRows(person: string, personName: string, months: readonly MonthBalance[]): ReportRow[] {
  return months.filter(counts).map((m) => ({
    person,
    personName,
    month: m.month.slice(0, 7),
    target: hours(m.target),
    worked: hours(m.actual),
    difference: hours(m.delta),
    overtimeBalance: hours(m.overtimeBalance),
    legalOvertime: hours(m.legalOvertimeMinutes),
    vacationDays: Math.round(m.vacationDays * 100) / 100,
  }));
}

/**
 * Absence rows of one person: one per month and absence type, from the minutes the work-time
 * model credits (approved absences on working days). Days are full-time days: vacation as the
 * balances count it, other types as credited minutes over a full-time day.
 */
export function absenceRows(person: string, personName: string, months: readonly MonthBalance[], fullTimeDayMinutes: number): ReportRow[] {
  const out: ReportRow[] = [];
  for (const m of months.filter(counts)) {
    for (const [type, minutes] of Object.entries(m.absenceByType)) {
      if (!minutes) continue;
      const days = type === 'vacation' ? m.vacationDays : minutes / fullTimeDayMinutes;
      out.push({ person, personName, month: m.month.slice(0, 7), type, days: Math.round(days * 100) / 100, hours: hours(minutes) });
    }
  }
  return out;
}

export interface RunQuery {
  from?: string;
  to?: string;
  groupBy?: string | string[];
  userId?: string;
  departmentId?: string;
  /** Only the members of this team (Teams & Projects), and its lead. */
  teamId?: string;
  projectId?: string;
}

export interface RunResult {
  ok: boolean;
  error?: string;
  offline?: boolean;
  groupBy: string[];
  rows: ReportRow[];
  totals: Record<string, number>;
}

/**
 * Runs the reports of packages/shared/src/reports.ts for one person, with their own rights: each
 * report covers the people that person may see on its page (`listableUserIds` with the report's
 * object), narrowed by the filters; a filter naming someone outside that set is refused, not
 * ignored. Used by the Reports page (reports.controller.ts) and by scheduled reports
 * (report-schedules.service.ts), which run once per recipient.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly balances: BalancesService,
    private readonly workTime: WorkTimeModelService,
  ) {}

  /** Report and the people it may cover for `callerId` (their own rights), or the error to return. */
  async scope(db: Db, orgId: string, callerId: string | null, reportId: string): Promise<{ error: string } | { callerId: string; def: ReportDefinition; people: Array<{ id: string; name: string }> }> {
    if (!callerId || !UUID.test(orgId) || !(await isOrgMember(db, orgId, callerId)) || !(await can(db, orgId, callerId, 'nav.reports', 'see'))) {
      return { error: 'forbidden' };
    }
    const def = reportById(reportId);
    if (!def) return { error: 'unknown-report' };
    const ids = await listableUserIds(db, orgId, callerId, def.object);
    const conditions = [eq(organization_memberships.organization_id, orgId)];
    if (ids !== 'all') {
      if (ids.length === 0) return { callerId, def, people: [] };
      conditions.push(inArray(organization_memberships.user_id, ids));
    }
    const people = await db
      .select({ id: users.id, name: sql<string>`coalesce(nullif(${users.display_name}, ''), ${users.email})` })
      .from(organization_memberships)
      .innerJoin(users, eq(users.id, organization_memberships.user_id))
      .where(and(...conditions))
      .orderBy(asc(users.display_name));
    return { callerId, def, people };
  }

  /** The report for whole months `from`..`to` (yyyy-mm), grouped as asked, as `callerId` may see it. */
  async run(db: Db, orgId: string, callerId: string | null, reportId: string, q: RunQuery): Promise<RunResult> {
    const { from, to, groupBy: groupByParam, userId, departmentId, teamId, projectId } = q;
    const scope = await this.scope(db, orgId, callerId, reportId);
    if ('error' in scope) return { ok: false, error: scope.error, groupBy: [], rows: [], totals: {} };
    const { def } = scope;
    const caller = scope.callerId;
    const months = monthsBetween(String(from ?? ''), String(to ?? ''));
    if (!months) return { ok: false, error: 'invalid-period', groupBy: [], rows: [], totals: {} };
    const groupBy = parseGroupBy(def, groupByParam);

    let people = scope.people;
    if (userId) {
      people = people.filter((p) => p.id === userId);
      if (!people.length) return { ok: false, error: 'unknown-user', groupBy, rows: [], totals: {} };
    }
    if (departmentId) {
      if (!UUID.test(departmentId)) return { ok: false, error: 'unknown-department', groupBy, rows: [], totals: {} };
      // The department of each person's assignment in force today.
      const inDept = await db
        .selectDistinctOn([employee_assignments.user_id], { userId: employee_assignments.user_id, departmentId: employee_assignments.department_id })
        .from(employee_assignments)
        .where(and(eq(employee_assignments.organization_id, orgId), sql`${employee_assignments.valid_from} <= ${sqlToday()}`))
        .orderBy(employee_assignments.user_id, sql`${employee_assignments.valid_from} DESC`);
      const members = new Set(inDept.filter((a) => a.departmentId === departmentId).map((a) => a.userId));
      people = people.filter((p) => members.has(p.id));
    }
    if (teamId) {
      if (!UUID.test(teamId)) return { ok: false, error: 'unknown-team', groupBy, rows: [], totals: {} };
      const inTeam = await db.execute(sql`
        SELECT m.user_id FROM team_members tm JOIN organization_memberships m ON m.id = tm.membership_id
        JOIN teams t ON t.id = tm.team_id WHERE tm.team_id = ${teamId} AND t.organization_id = ${orgId}
        UNION SELECT lead_user_id FROM teams WHERE id = ${teamId} AND organization_id = ${orgId} AND lead_user_id IS NOT NULL`);
      const members = new Set((inTeam.rows as { user_id: string }[]).map((r) => r.user_id));
      people = people.filter((p) => members.has(p.id));
    }
    if (!people.length) return { ok: true, groupBy, rows: [], totals: groupReport(def, [], groupBy).totals };

    const raw: ReportRow[] = [];
    const first = months[0];
    const last = months[months.length - 1];
    if (projectId && def.projectFilter && !UUID.test(projectId)) return { ok: false, error: 'unknown-project', groupBy, rows: [], totals: {} };
    const pluginRows = reportSource(def.id);
    if (pluginRows) {
      // A plugin's report: only the people checked above, and only theirs.
      const allowed = new Set(people.map((p) => p.id));
      const rows = await pluginRows({ db, orgId, callerId: caller, people, first, last, projectId: def.projectFilter ? projectId : undefined });
      raw.push(...rows.filter((r) => allowed.has(String(r.person))));
    } else if (def.id === 'projectHours') {
      const timeZone = await this.workTime.timeZone(db, caller);
      const [ly, lm] = last.split('-').map(Number);
      const end = lm === 12 ? `${ly + 1}-01` : `${ly}-${String(lm + 1).padStart(2, '0')}`;
      const local = sql`(${project_times.start_time} AT TIME ZONE ${timeZone})`;
      const month = sql<string>`to_char(${local}, 'YYYY-MM')`;
      const names = new Map(people.map((p) => [p.id, p.name]));
      const conditions = [
        eq(project_times.organization_id, orgId),
        inArray(project_times.user_id, people.map((p) => p.id)),
        gte(local, sql`${`${first}-01`}::timestamp`),
        lt(local, sql`${`${end}-01`}::timestamp`),
      ];
      if (projectId) conditions.push(eq(project_times.project_id, projectId));
      const result = await db
        .select({
          userId: project_times.user_id,
          project: sql<string>`coalesce(${projects.name}, '')`,
          month,
          minutes: sql<string>`sum(extract(epoch from ${project_times.end_time} - ${project_times.start_time}) / 60)`,
        })
        .from(project_times)
        .leftJoin(projects, eq(projects.id, project_times.project_id))
        .where(and(...conditions))
        // By position: the month expression carries the time zone as a parameter, and a second copy in
        // GROUP BY would get its own parameter number, which Postgres treats as a different expression.
        .groupBy(sql`1`, sql`2`, sql`3`);
      for (const r of result) {
        raw.push({ person: r.userId, personName: names.get(r.userId) ?? '', project: r.project, month: r.month, hours: hours(Number(r.minutes)) });
      }
    } else if (def.id === 'people') {
      raw.push(...(await this.peopleRows(db, orgId, people, last)));
    } else if (def.id === 'workingTimeAct') {
      raw.push(...(await this.workingTimeActRows(db, orgId, people, first, last)));
    } else if (def.id === 'attendance' || def.id === 'absences') {
      // Attendance and absences come from the balances, year by year, as the Balances page shows them.
      const settings = await this.workTime.settings(db, orgId);
      const fullTimeDay = settings.fullTimeWeeklyMinutes / 5;
      const years = [...new Set(months.map((m) => Number(m.slice(0, 4))))];
      const wanted = new Set(months);
      for (const p of people) {
        for (const year of years) {
          const balances = await this.balances.year(db, orgId, p.id, year);
          const inRange = balances.months.filter((m) => wanted.has(m.month.slice(0, 7)));
          raw.push(...(def.id === 'attendance' ? attendanceRows(p.id, p.name, inRange) : absenceRows(p.id, p.name, inRange, fullTimeDay)));
        }
      }
    } else {
      return { ok: false, error: 'unknown-report', groupBy, rows: [], totals: {} };
    }

    const grouped = groupReport(def, raw, groupBy, (d, r) => (d === 'person' ? String(r.personName ?? '') : String(r[d] ?? '')));
    return { ok: true, ...grouped };
  }

  /**
   * Working Hours Act findings (working-time-act.ts), one row per finding: each person's closed
   * sessions in their own time zone, read from the Monday of the first year's first week so the
   * yearly Überzeit and the first day's rest have their context.
   */
  private async workingTimeActRows(db: Db, orgId: string, people: Array<{ id: string; name: string }>, first: string, last: string): Promise<ReportRow[]> {
    const settings = await this.workTime.settings(db, orgId);
    const from = `${first}-01`;
    const [ly, lm] = last.split('-').map(Number);
    const toExclusive = lm === 12 ? `${ly + 1}-01-01` : `${ly}-${String(lm + 1).padStart(2, '0')}-01`;
    const contextFrom = weekStart(`${first.slice(0, 4)}-01-01`);
    const out: ReportRow[] = [];
    for (const p of people) {
      const timeZone = await this.workTime.timeZone(db, p.id);
      // A day of margin each side: the period is in the person's zone, the bounds here in UTC.
      const sessions = await db
        .select({ start: work_times.check_in, end: work_times.check_out })
        .from(work_times)
        .where(
          and(
            eq(work_times.organization_id, orgId),
            eq(work_times.user_id, p.id),
            sql`${work_times.check_out} IS NOT NULL`,
            gte(work_times.check_in, sql`${contextFrom}::date - interval '1 day'`),
            lt(work_times.check_in, sql`${toExclusive}::date + interval '1 day'`),
          ),
        );
      const findings = checkWorkingTimeAct(sessions as { start: string; end: string }[], {
        timeZone,
        from,
        toExclusive,
        maxWeeklyMinutes: settings.legalMaxWeeklyMinutes,
        yearLimitMinutes: settings.legalOvertimeYearLimitMinutes,
      });
      for (const f of findings) {
        out.push({ person: p.id, personName: p.name, check: f.check, month: f.date.slice(0, 7), date: f.date, occurrences: 1, hours: hours(f.minutes) });
      }
    }
    return out;
  }

  /**
   * One row per person employed on the last day of the period (today, if that is still ahead):
   * the assignment and work schedule in force on that day. FTE = workload / 100.
   */
  private async peopleRows(db: Db, orgId: string, people: Array<{ id: string; name: string }>, last: string): Promise<ReportRow[]> {
    const today = clock.now().toISOString().slice(0, 10);
    const at = monthEnd(last) < today ? monthEnd(last) : today;
    const names = new Map(people.map((p) => [p.id, p.name]));
    const ids = sql.join(people.map((p) => sql`${p.id}::uuid`), sql`, `);
    const result = await db.execute(sql`
      SELECT m.user_id, m.start_date::text AS start_date, coalesce(d.name, '') AS department,
             coalesce(a.job_function, '') AS job_function,
             coalesce(nullif(mu.display_name, ''), mu.email::text, '') AS manager,
             coalesce(ws.workload_percent, 100)::float8 AS workload,
             coalesce(ws.exemption_reason, 'full') AS recording
      FROM organization_memberships m
      LEFT JOIN LATERAL (
        SELECT ea.department_id, ea.job_function, ea.manager_user_id FROM employee_assignments ea
        WHERE ea.organization_id = m.organization_id AND ea.user_id = m.user_id AND ea.valid_from <= ${at}::date
        ORDER BY ea.valid_from DESC LIMIT 1) a ON true
      LEFT JOIN departments d ON d.id = a.department_id
      LEFT JOIN users mu ON mu.id = a.manager_user_id
      LEFT JOIN LATERAL (
        SELECT w.workload_percent, w.exemption_reason FROM work_schedules w
        WHERE w.organization_id = m.organization_id AND w.user_id = m.user_id AND w.valid_from <= ${at}::date
        ORDER BY w.valid_from DESC LIMIT 1) ws ON true
      WHERE m.organization_id = ${orgId} AND m.user_id IN (${ids})
        AND (m.start_date IS NULL OR m.start_date <= ${at}::date)
        AND (m.status = 'active' OR m.exit_at::date > ${at}::date)
        AND (m.exit_at IS NULL OR m.exit_at::date > ${at}::date)`);
    return (result.rows as Array<{ user_id: string; start_date: string | null; department: string; job_function: string; manager: string; workload: number; recording: string }>).map((r) => ({
      person: r.user_id,
      personName: names.get(r.user_id) ?? '',
      department: r.department,
      function: r.job_function,
      manager: r.manager,
      startDate: r.start_date ?? '',
      timeRecording: r.recording,
      headcount: 1,
      fte: Math.round(Number(r.workload) * 10) / 1000,
    }));
  }
}
