import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { BalancesService, type MonthBalance } from './balances.service';
import { WorkTimeModelService } from './work-time-model.service';
import { callerUserId, can, isOrgMember, listableUserIds } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { departments, employee_assignments, organization_memberships, project_times, projects, users } from './db/schema';
import { groupReport, monthsBetween, parseGroupBy, reportById, type ReportDefinition, type ReportRow } from '@worktime3/shared/reports';

type Db = NonNullable<ReturnType<DbService['getDb']>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** Months that count in a report: from the person's start, up to and including the current one. */
function counts(m: MonthBalance): boolean {
  return m.status !== 'before-start' && m.status !== 'future';
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

/**
 * The Reports page (nav.reports, module `reports`; packages/shared/src/reports.ts). Each report
 * shows the people the caller may see on its page (`listableUserIds` with the report's object),
 * narrowed by the filters; a filter naming someone outside that set is refused, not ignored.
 */
@Controller('organizations/:orgId/reports')
export class ReportsController {
  constructor(
    private readonly db: DbService,
    private readonly balances: BalancesService,
    private readonly workTime: WorkTimeModelService,
  ) {}

  /** Caller, report and the people it may cover, or the error to return. */
  private async scope(db: Db, orgId: string, req: AuthenticatedRequest, reportId: string): Promise<{ error: string } | { callerId: string; def: ReportDefinition; people: Array<{ id: string; name: string }> }> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
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

  /** What the filters offer: the people the report may cover, the departments and (project hours) the projects. */
  @Get(':reportId/options')
  async options(@Param('orgId') orgId: string, @Param('reportId') reportId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, people: [], departments: [], projects: [] };
    const scope = await this.scope(db, orgId, req, reportId);
    if ('error' in scope) return { ok: false, error: scope.error, people: [], departments: [], projects: [] };
    const depts = await db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.organization_id, orgId), eq(departments.is_active, true)))
      .orderBy(asc(departments.sort_order), asc(departments.name));
    const projs = scope.def.id === 'projectHours'
      ? await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.organization_id, orgId)).orderBy(asc(projects.name))
      : [];
    return { ok: true, people: scope.people, departments: depts, projects: projs };
  }

  /** The report for whole months `from`..`to` (yyyy-mm), grouped as asked; raw rows never leave. */
  @Get(':reportId')
  async run(
    @Param('orgId') orgId: string,
    @Param('reportId') reportId: string,
    @Req() req: AuthenticatedRequest,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupByParam?: string,
    @Query('userId') userId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('projectId') projectId?: string,
  ) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, groupBy: [], rows: [], totals: {} };
    const scope = await this.scope(db, orgId, req, reportId);
    if ('error' in scope) return { ok: false, error: scope.error, groupBy: [], rows: [], totals: {} };
    const { def, callerId } = scope;
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
        .where(and(eq(employee_assignments.organization_id, orgId), sql`${employee_assignments.valid_from} <= CURRENT_DATE`))
        .orderBy(employee_assignments.user_id, sql`${employee_assignments.valid_from} DESC`);
      const members = new Set(inDept.filter((a) => a.departmentId === departmentId).map((a) => a.userId));
      people = people.filter((p) => members.has(p.id));
    }
    if (!people.length) return { ok: true, groupBy, rows: [], totals: groupReport(def, [], groupBy).totals };

    const raw: ReportRow[] = [];
    const first = months[0];
    const last = months[months.length - 1];
    if (def.id === 'projectHours') {
      if (projectId && !UUID.test(projectId)) return { ok: false, error: 'unknown-project', groupBy, rows: [], totals: {} };
      const timeZone = await this.workTime.timeZone(db, callerId);
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
    } else {
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
    }

    const grouped = groupReport(def, raw, groupBy, (d, r) => (d === 'person' ? String(r.personName ?? '') : String(r[d] ?? '')));
    return { ok: true, ...grouped };
  }
}
