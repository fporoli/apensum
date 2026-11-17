import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { VersionsService } from './versions.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { roles, saved_reports } from './db/schema';
import { reportById, sanitizeSavedSettings } from '@worktime3/shared/reports';

type Db = NonNullable<ReturnType<DbService['getDb']>>;

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
    const reports = rows
      .filter((r) => visibleTo(r, callerId, roleNames))
      .map((r) => ({ id: r.id, name: r.name, reportId: r.report_id, settings: r.settings, sharedRoles: r.shared_roles, mine: r.owner_user_id === callerId }));
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

  /** The caller's own saved report; someone else's (even one shared with them) is `forbidden`. */
  private async own(db: Db, orgId: string, id: string, callerId: string) {
    if (!UUID.test(id)) return { error: 'not-found' as const };
    const [row] = await db.select().from(saved_reports).where(and(eq(saved_reports.id, id), eq(saved_reports.organization_id, orgId)));
    if (!row) return { error: 'not-found' as const };
    if (row.owner_user_id !== callerId) return { error: 'forbidden' as const };
    return { row };
  }
}
