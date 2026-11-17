import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { report_runs, report_schedules, roles, saved_reports, users } from './db/schema';
import { WorkTimeModelService } from './work-time-model.service';
import { ReportSchedulesService } from './report-schedules.service';
import { nextRunAt, parseScheduleRule } from './report-schedule';
import { reportById, sanitizeSavedSettings } from '@worktime3/shared/reports';

type Db = NonNullable<ReturnType<DbService['getDb']>>;

/** A timestamp column (Postgres text form) as ISO 8601, which every browser parses. */
const isoOf = (v: string | null) => (v ? new Date(v).toISOString() : null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_PERSON = 100;

/** The names of the caller's roles in the organization (active membership). */
export async function callerRoleNames(db: Db, orgId: string, userId: string): Promise<string[]> {
  const result = await db.execute(sql`
    SELECT DISTINCT r.name FROM organization_memberships m
    JOIN membership_roles mr ON mr.membership_id = m.id
    JOIN roles r ON r.id = mr.role_id
    WHERE m.organization_id = ${orgId} AND m.user_id = ${userId} AND m.status = 'active'`);
  return (result.rows as { name: string }[]).map((r) => r.name);
}

/** A saved report is visible to its owner and to members holding one of the roles it is shared with. */
export function visibleTo(row: { owner_user_id: string; shared_roles: string[] }, userId: string, roleNames: readonly string[]): boolean {
  return row.owner_user_id === userId || row.shared_roles.some((r) => roleNames.includes(r));
}

/**
 * Saved reports (064, Reports page): a report with its period, grouping and filters under a name.
 * The owner changes and deletes it; sharing it with roles needs `nav.reports:edit`. Whoever opens
 * one runs it with their own rights (reports.controller.ts), so a shared report shares no data.
 */
@Controller('organizations/:orgId/saved-reports')
export class SavedReportsController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
    private readonly workTime: WorkTimeModelService,
    private readonly schedules: ReportSchedulesService,
  ) {}

  private async caller(db: Db, orgId: string, req: AuthenticatedRequest): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !UUID.test(orgId) || !(await isOrgMember(db, orgId, callerId)) || !(await can(db, orgId, callerId, 'nav.reports', 'see'))) return null;
    return callerId;
  }

  /** Name, report and settings from a body, with the roles checked against the organization's. */
  private async parse(db: Db, orgId: string, callerId: string, body: Record<string, unknown>): Promise<{ error: string } | { name: string; reportId: string; settings: object; sharedRoles: string[] }> {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 120) return { error: 'invalid-name' };
    const def = reportById(String(body.reportId ?? ''));
    if (!def) return { error: 'unknown-report' };
    const settings = sanitizeSavedSettings(def, body.settings);
    if (!settings) return { error: 'invalid-settings' };
    const asked = Array.isArray(body.sharedRoles) ? [...new Set(body.sharedRoles.filter((r): r is string => typeof r === 'string'))] : [];
    if (asked.length) {
      if (!(await can(db, orgId, callerId, 'nav.reports', 'edit'))) return { error: 'forbidden' };
      const known = await db
        .select({ name: roles.name })
        .from(roles)
        .where(or(isNull(roles.organization_id), eq(roles.organization_id, orgId)));
      const names = new Set(known.map((r) => r.name));
      if (asked.some((r) => !names.has(r))) return { error: 'unknown-role' };
    }
    return { name, reportId: def.id, settings, sharedRoles: asked.sort() };
  }

  @Get()
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, reports: [], canShare: false };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden', reports: [], canShare: false };
    const roleNames = await callerRoleNames(db, orgId, callerId);
    const rows = await db
      .select()
      .from(saved_reports)
      .where(eq(saved_reports.organization_id, orgId))
      .orderBy(asc(saved_reports.name));
    const visible = rows.filter((r) => visibleTo(r, callerId, roleNames));
    const mine = visible.filter((r) => r.owner_user_id === callerId).map((r) => r.id);
    const scheduled = mine.length
      ? await db
          .select({ id: report_schedules.saved_report_id, nextRunAt: report_schedules.next_run_at, active: report_schedules.is_active })
          .from(report_schedules)
          .where(inArray(report_schedules.saved_report_id, mine))
      : [];
    const reports = visible.map((r) => {
      const s = scheduled.find((x) => x.id === r.id);
      return {
        id: r.id,
        name: r.name,
        reportId: r.report_id,
        settings: r.settings,
        sharedRoles: r.shared_roles,
        mine: r.owner_user_id === callerId,
        schedule: s ? { nextRunAt: isoOf(s.nextRunAt), active: s.active } : null,
      };
    });
    return { ok: true, reports, canShare: await can(db, orgId, callerId, 'nav.reports', 'edit') };
  }

  @Post()
  async create(@Param('orgId') orgId: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const parsed = await this.parse(db, orgId, callerId, body ?? {});
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(saved_reports)
      .where(and(eq(saved_reports.organization_id, orgId), eq(saved_reports.owner_user_id, callerId)));
    if (n >= MAX_PER_PERSON) return { ok: false, error: 'too-many' };
    const [row] = await db
      .insert(saved_reports)
      .values({ organization_id: orgId, owner_user_id: callerId, name: parsed.name, report_id: parsed.reportId, settings: parsed.settings, shared_roles: parsed.sharedRoles })
      .returning();
    void this.versions.record('saved_reports', row.id, 'insert', callerId, row).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Put(':id')
  async update(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const existing = await this.own(db, orgId, id, callerId);
    if ('error' in existing) return { ok: false, error: existing.error };
    const parsed = await this.parse(db, orgId, callerId, body ?? {});
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const patch = { name: parsed.name, report_id: parsed.reportId, settings: parsed.settings, shared_roles: parsed.sharedRoles };
    await db.update(saved_reports).set(patch).where(eq(saved_reports.id, id));
    void this.versions.record('saved_reports', id, 'update_delta', callerId, patch).catch(() => {});
    return { ok: true, id };
  }

  @Delete(':id')
  async remove(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const existing = await this.own(db, orgId, id, callerId);
    if ('error' in existing) return { ok: false, error: existing.error };
    await db.delete(saved_reports).where(eq(saved_reports.id, id));
    void this.versions.record('saved_reports', id, 'delete', callerId, existing.row).catch(() => {});
    return { ok: true };
  }

  /**
   * Who a schedule may deliver to: the caller alone, or (with `nav.reports:edit`, as for sharing)
   * every active member. Each recipient gets the report with their own rights.
   */
  @Get('recipients')
  async recipients(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, people: [] };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden', people: [] };
    return { ok: true, people: await this.allowedRecipients(db, orgId, callerId) };
  }

  /** The saved report's schedule (owner only) with its last runs. */
  @Get(':id/schedule')
  async getSchedule(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, schedule: null, runs: [] };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden', schedule: null, runs: [] };
    const existing = await this.own(db, orgId, id, callerId);
    if ('error' in existing) return { ok: false, error: existing.error, schedule: null, runs: [] };
    const [s] = await db.select().from(report_schedules).where(eq(report_schedules.saved_report_id, id));
    const runs = s
      ? await db
          .select({ ranAt: report_runs.ran_at, person: sql<string>`coalesce(nullif(${users.display_name}, ''), ${users.email})`, error: report_runs.error, periodFrom: report_runs.period_from, periodTo: report_runs.period_to })
          .from(report_runs)
          .innerJoin(users, eq(users.id, report_runs.user_id))
          .where(eq(report_runs.schedule_id, s.id))
          .orderBy(desc(report_runs.ran_at))
          .limit(20)
      : [];
    return {
      ok: true,
      schedule: s
        ? { frequency: s.frequency, weekday: s.weekday, monthDay: s.month_day, hour: s.hour, timeZone: s.time_zone, format: s.format, recipientUserIds: s.recipient_user_ids, active: s.is_active, nextRunAt: isoOf(s.next_run_at), lastRunAt: isoOf(s.last_run_at) }
        : null,
      runs: runs.map((r) => ({ ...r, ranAt: isoOf(r.ranAt) })),
    };
  }

  /** Sets the schedule: frequency, weekday or day of month, hour, format, recipients, active. */
  @Put(':id/schedule')
  async putSchedule(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: Record<string, unknown>, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const existing = await this.own(db, orgId, id, callerId);
    if ('error' in existing) return { ok: false, error: existing.error };
    const rule = parseScheduleRule(body ?? {}, await this.workTime.timeZone(db, callerId));
    if ('error' in rule) return { ok: false, error: rule.error };
    const format = body.format === 'xlsx' ? 'xlsx' : body.format === 'pdf' || body.format === undefined ? 'pdf' : null;
    if (!format) return { ok: false, error: 'invalid-schedule' };
    const asked = Array.isArray(body.recipientUserIds) ? [...new Set(body.recipientUserIds.filter((x): x is string => typeof x === 'string'))] : [];
    if (!asked.length || asked.length > 50) return { ok: false, error: 'invalid-recipients' };
    const allowed = new Set((await this.allowedRecipients(db, orgId, callerId)).map((p) => p.id));
    if (asked.some((r) => !allowed.has(r))) return { ok: false, error: 'invalid-recipients' };
    const values = {
      frequency: rule.frequency,
      weekday: rule.frequency === 'weekly' ? rule.weekday : null,
      month_day: rule.frequency === 'monthly' ? rule.monthDay : null,
      hour: rule.hour,
      time_zone: rule.timeZone,
      format,
      recipient_user_ids: asked,
      is_active: body.active !== false,
      next_run_at: nextRunAt(rule, new Date()).toISOString(),
    };
    const [row] = await db
      .insert(report_schedules)
      .values({ organization_id: orgId, saved_report_id: id, ...values })
      .onConflictDoUpdate({ target: report_schedules.saved_report_id, set: values })
      .returning();
    void this.versions.record('report_schedules', row.id, 'update_delta', callerId, values).catch(() => {});
    return { ok: true, nextRunAt: isoOf(row.next_run_at) };
  }

  @Delete(':id/schedule')
  async deleteSchedule(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const existing = await this.own(db, orgId, id, callerId);
    if ('error' in existing) return { ok: false, error: existing.error };
    const removed = await db.delete(report_schedules).where(eq(report_schedules.saved_report_id, id)).returning({ id: report_schedules.id });
    if (removed[0]) void this.versions.record('report_schedules', removed[0].id, 'delete', callerId, { saved_report_id: id }).catch(() => {});
    return { ok: true };
  }

  /** Runs the schedule now for all its recipients (to try it out); the next regular run stays as it is. */
  @Post(':id/schedule/run')
  async runNow(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.caller(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const existing = await this.own(db, orgId, id, callerId);
    if ('error' in existing) return { ok: false, error: existing.error };
    const [s] = await db.select().from(report_schedules).where(eq(report_schedules.saved_report_id, id));
    if (!s) return { ok: false, error: 'not-scheduled' };
    return { ok: true, ...(await this.schedules.deliver(db, s)) };
  }

  /** The caller, or every active member when the caller may share reports. */
  private async allowedRecipients(db: Db, orgId: string, callerId: string): Promise<{ id: string; name: string }[]> {
    const all = await can(db, orgId, callerId, 'nav.reports', 'edit');
    const result = await db.execute(sql`
      SELECT u.id, coalesce(nullif(u.display_name, ''), u.email::text) AS name FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${orgId} AND m.status = 'active' AND u.is_active ${all ? sql`` : sql`AND u.id = ${callerId}`}
      ORDER BY 2`);
    return result.rows as { id: string; name: string }[];
  }

  /** The caller's own saved report; someone else's (even one shared with them) is `forbidden`. */
  private async own(db: Db, orgId: string, id: string, callerId: string) {
    if (!UUID.test(id)) return { error: 'not-found' as const };
    const [row] = await db.select().from(saved_reports).where(and(eq(saved_reports.id, id), eq(saved_reports.organization_id, orgId)));
    if (!row) return { error: 'not-found' as const };
    if (row.owner_user_id !== callerId) return { error: 'forbidden' as const };
    return { row };
  }
}
