import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { and, count, eq, sql } from 'drizzle-orm';
import { isCanton } from '@worktime3/shared/worktime';
import { DbService, type Db } from './db.service';
import { callerUserId, can, isOrgMember } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { VersionsService } from './versions.service';
import { AuditService } from './audit.service';
import { employee_assignments, locations } from './db/schema';
import { sqlToday } from './clock';

interface LocationBody {
  name?: string;
  canton?: string;
  municipality?: string | null;
}

/**
 * An organization's locations (work places, 087), kept under Organization settings -> Working time and
 * holidays: each in a canton, optionally a municipality. A person's location is part of their dated
 * assignment (Employment); their public holidays follow its canton, and holiday rows can apply to one
 * location only. Every member reads them; editing needs Organization settings edit, like the holidays.
 */
@Controller()
export class LocationsController {
  constructor(
    private readonly db: DbService,
    private readonly versions: VersionsService,
    private readonly audit: AuditService,
  ) {}

  /** The locations, by name, with how many people work there now (their assignment in force). */
  @Get('organizations/:orgId/locations')
  async list(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, locations: [] };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden', locations: [] };
    const rows = await db
      .select({ id: locations.id, name: locations.name, canton: locations.canton, municipality: locations.municipality })
      .from(locations)
      .where(eq(locations.organization_id, orgId))
      .orderBy(locations.name);
    const counts = await db.execute(sql`
      SELECT location_id, COUNT(*)::int AS members FROM (
        SELECT DISTINCT ON (user_id) user_id, location_id FROM employee_assignments
        WHERE organization_id = ${orgId} AND valid_from <= ${sqlToday()}
        ORDER BY user_id, valid_from DESC
      ) current_assignment WHERE location_id IS NOT NULL GROUP BY location_id`);
    const membersOf = new Map((counts.rows as { location_id: string; members: number }[]).map((r) => [r.location_id, r.members]));
    return {
      ok: true,
      locations: rows.map((r) => ({ ...r, members: membersOf.get(r.id) ?? 0 })),
      canEdit: await can(db, orgId, callerId, 'nav.orgSettings', 'edit'),
    };
  }

  @Post('organizations/:orgId/locations')
  async create(@Param('orgId') orgId: string, @Body() body: LocationBody, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.editor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const checked = checkLocation(body);
    if ('error' in checked) return { ok: false, error: checked.error };
    if (await this.nameTaken(db, orgId, checked.name)) return { ok: false, error: 'duplicate-name' };
    const values = { organization_id: orgId, ...checked };
    const [row] = await db.insert(locations).values(values).returning({ id: locations.id });
    void this.versions.record('locations', row.id, 'insert', callerId, { id: row.id, ...values }).catch(() => {});
    void this.audit.record(orgId, callerId, 'location.create', 'location', row.id, values).catch(() => {});
    return { ok: true, id: row.id };
  }

  @Patch('organizations/:orgId/locations/:id')
  async update(@Param('orgId') orgId: string, @Param('id') id: string, @Body() body: LocationBody, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.editor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const [row] = await db.select().from(locations).where(and(eq(locations.id, id), eq(locations.organization_id, orgId)));
    if (!row) return { ok: false, error: 'not-found' };
    const checked = checkLocation({
      name: body.name ?? row.name,
      canton: body.canton ?? row.canton,
      municipality: body.municipality !== undefined ? body.municipality : row.municipality,
    });
    if ('error' in checked) return { ok: false, error: checked.error };
    if (await this.nameTaken(db, orgId, checked.name, id)) return { ok: false, error: 'duplicate-name' };
    await db.update(locations).set(checked).where(eq(locations.id, id));
    void this.versions.record('locations', id, 'update_delta', callerId, checked).catch(() => {});
    void this.audit.record(orgId, callerId, 'location.update', 'location', id, checked).catch(() => {});
    return { ok: true };
  }

  /** Deletes a location no assignment names (its own holiday rows go with it). */
  @Delete('organizations/:orgId/locations/:id')
  async remove(@Param('orgId') orgId: string, @Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = await this.editor(db, orgId, req);
    if (!callerId) return { ok: false, error: 'forbidden' };
    const [row] = await db.select({ id: locations.id }).from(locations).where(and(eq(locations.id, id), eq(locations.organization_id, orgId)));
    if (!row) return { ok: false, error: 'not-found' };
    const [used] = await db.select({ n: count() }).from(employee_assignments).where(eq(employee_assignments.location_id, id));
    if ((used?.n ?? 0) > 0) return { ok: false, error: 'location-in-use' };
    await db.delete(locations).where(eq(locations.id, id));
    void this.versions.record('locations', id, 'delete', callerId, { id }).catch(() => {});
    void this.audit.record(orgId, callerId, 'location.delete', 'location', id, {}).catch(() => {});
    return { ok: true };
  }

  private async editor(db: Db, orgId: string, req: AuthenticatedRequest): Promise<string | null> {
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return null;
    return callerId;
  }

  private async nameTaken(db: Db, orgId: string, name: string, exceptId?: string): Promise<boolean> {
    const rows = await db
      .select({ id: locations.id })
      .from(locations)
      .where(and(eq(locations.organization_id, orgId), sql`lower(${locations.name}) = lower(${name})`));
    return rows.some((r) => r.id !== exceptId);
  }
}

/** A location's values to store, or the error: a name (1-100), a canton, an optional municipality (up to 100). */
export function checkLocation(body: LocationBody): { name: string; canton: string; municipality: string | null } | { error: string } {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 100) return { error: 'invalid-name' };
  if (!isCanton(body.canton)) return { error: 'invalid-canton' };
  const municipality = typeof body.municipality === 'string' && body.municipality.trim() ? body.municipality.trim() : null;
  if (municipality && municipality.length > 100) return { error: 'invalid-municipality' };
  return { name, canton: body.canton, municipality };
}
