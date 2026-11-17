import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { and, asc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { BalancesService, type MonthBalance } from './balances.service';
import { WorkTimeModelService } from './work-time-model.service';
import { callerUserId, can, isOrgMember, listableUserIds } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { departments, employee_assignments, expenses, organization_memberships, project_times, projects, users } from './db/schema';
import { groupReport, monthEnd, monthsBetween, parseGroupBy, reportById, type ReportDefinition, type ReportRow } from '@worktime3/shared/reports';
import { renderReportPdf, sanitizeReportPdf } from './report-pdf';

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

  /**
   * The table on screen as a PDF (A4, landscape when it is wide). The browser sends the rows it
   * shows, already labelled and formatted in the person's language, so the PDF matches the screen
   * and the Excel file; the API only lays it out. Nothing is stored.
   */
  @Post('pdf')
  async pdf(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest, @Res() res: Response) {
    const db = this.db.getDb();
    if (!db) return res.json({ ok: true, offline: true });
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !UUID.test(orgId) || !(await isOrgMember(db, orgId, callerId)) || !(await can(db, orgId, callerId, 'nav.reports', 'see'))) {
      return res.json({ ok: false, error: 'forbidden' });
    }
    const table = sanitizeReportPdf(body);
    if (!table) return res.json({ ok: false, error: 'invalid-table' });
    const pdf = await renderReportPdf(table);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="report.pdf"');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(pdf);
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
    const projs = scope.def.id === 'projectHours' || scope.def.id === 'expenses'
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
    } else if (def.id === 'expenses') {
      if (projectId && !UUID.test(projectId)) return { ok: false, error: 'unknown-project', groupBy, rows: [], totals: {} };
      raw.push(...(await this.expenseRows(db, orgId, people, first, last, projectId)));
    } else if (def.id === 'people') {
      raw.push(...(await this.peopleRows(db, orgId, people, last)));
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

  /**
   * One row per expense dated in the period: amount in its own currency, and the status of the
   * expense report it is in (`none` when it is in none yet).
   */
  private async expenseRows(db: Db, orgId: string, people: Array<{ id: string; name: string }>, first: string, last: string, projectId?: string): Promise<ReportRow[]> {
    const names = new Map(people.map((p) => [p.id, p.name]));
    const conditions = [
      eq(expenses.organization_id, orgId),
      inArray(expenses.user_id, people.map((p) => p.id)),
      gte(expenses.expense_date, `${first}-01`),
      lte(expenses.expense_date, monthEnd(last)),
    ];
    if (projectId) conditions.push(eq(expenses.project_id, projectId));
    const result = await db
      .select({
        userId: expenses.user_id,
        category: expenses.category,
        project: sql<string>`coalesce(${projects.name}, '')`,
        date: expenses.expense_date,
        currency: expenses.currency,
        value: expenses.value,
        status: sql<string | null>`(SELECT er.status FROM expense_report_items i JOIN expense_reports er ON er.id = i.expense_report_id WHERE i.expense_id = ${expenses.id} LIMIT 1)`,
      })
      .from(expenses)
      .leftJoin(projects, eq(projects.id, expenses.project_id))
      .where(and(...conditions));
    return result.map((r) => ({
      person: r.userId,
      personName: names.get(r.userId) ?? '',
      category: r.category,
      project: r.project,
      month: String(r.date).slice(0, 7),
      status: r.status ?? 'none',
      currency: String(r.currency).trim().toUpperCase(),
      amount: Math.round(Number(r.value) * 100) / 100,
      count: 1,
    }));
  }

  /**
   * One row per person employed on the last day of the period (today, if that is still ahead):
   * the assignment and work schedule in force on that day. FTE = workload / 100.
   */
  private async peopleRows(db: Db, orgId: string, people: Array<{ id: string; name: string }>, last: string): Promise<ReportRow[]> {
    const today = new Date().toISOString().slice(0, 10);
    const at = monthEnd(last) < today ? monthEnd(last) : today;
    const names = new Map(people.map((p) => [p.id, p.name]));
    const ids = sql.join(people.map((p) => sql`${p.id}::uuid`), sql`, `);
    const result = await db.execute(sql`
      SELECT m.user_id, m.start_date::text AS start_date, coalesce(d.name, '') AS department,
             coalesce(a.job_function, '') AS job_function,
             coalesce(nullif(mu.display_name, ''), mu.email::text, '') AS manager,
             coalesce(ws.workload_percent, 100)::float8 AS workload
      FROM organization_memberships m
      LEFT JOIN LATERAL (
        SELECT ea.department_id, ea.job_function, ea.manager_user_id FROM employee_assignments ea
        WHERE ea.organization_id = m.organization_id AND ea.user_id = m.user_id AND ea.valid_from <= ${at}::date
        ORDER BY ea.valid_from DESC LIMIT 1) a ON true
      LEFT JOIN departments d ON d.id = a.department_id
      LEFT JOIN users mu ON mu.id = a.manager_user_id
      LEFT JOIN LATERAL (
        SELECT w.workload_percent FROM work_schedules w
        WHERE w.organization_id = m.organization_id AND w.user_id = m.user_id AND w.valid_from <= ${at}::date
        ORDER BY w.valid_from DESC LIMIT 1) ws ON true
      WHERE m.organization_id = ${orgId} AND m.user_id IN (${ids})
        AND (m.start_date IS NULL OR m.start_date <= ${at}::date)
        AND (m.status = 'active' OR m.exit_at::date > ${at}::date)
        AND (m.exit_at IS NULL OR m.exit_at::date > ${at}::date)`);
    return (result.rows as Array<{ user_id: string; start_date: string | null; department: string; job_function: string; manager: string; workload: number }>).map((r) => ({
      person: r.user_id,
      personName: names.get(r.user_id) ?? '',
      department: r.department,
      function: r.job_function,
      manager: r.manager,
      startDate: r.start_date ?? '',
      headcount: 1,
      fte: Math.round(Number(r.workload) * 10) / 1000,
    }));
  }
}
