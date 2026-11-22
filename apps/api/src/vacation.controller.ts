import { Body, Controller, Get, Param, Put, Req } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DbService } from './db.service';
import { callerUserId, isOrgMember, reachesAll } from './access';
import type { AuthenticatedRequest } from './jwt.guard';
import { AuditService } from './audit.service';
import { VersionsService } from './versions.service';
import { organizations } from './db/schema';
import { probationUntilOf } from './vacation';
import { parseVacationSettings, validateVacationSettings } from '@worktime3/shared/vacation';

/** The vacation rules are the people side: whoever edits everyone's employment (HR) sets them. */
const EDIT_OBJECT = 'section.people.employment';

@Controller()
export class VacationController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  /** The rules, which any member may read, and the caller's own probation (the absence form warns). */
  @Get('organizations/:orgId/vacation-settings')
  async get(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true, settings: parseVacationSettings(null), probationUntil: null, canEdit: false };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await isOrgMember(db, orgId, callerId))) return { ok: false, error: 'forbidden' };
    const [row] = await db.select({ settings: organizations.settings }).from(organizations).where(eq(organizations.id, orgId));
    return {
      ok: true,
      settings: parseVacationSettings(row?.settings),
      probationUntil: await probationUntilOf(db, orgId, callerId),
      canEdit: await reachesAll(db, orgId, callerId, EDIT_OBJECT, 'edit'),
    };
  }

  @Put('organizations/:orgId/vacation-settings')
  async put(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.db.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await reachesAll(db, orgId, callerId, EDIT_OBJECT, 'edit'))) return { ok: false, error: 'forbidden' };
    const checked = validateVacationSettings(body);
    if (!checked.ok) return checked;
    await db
      .update(organizations)
      .set({ settings: sql`${organizations.settings} || ${JSON.stringify({ vacation: checked.value })}::jsonb` })
      .where(eq(organizations.id, orgId));
    void this.audit.record(orgId, callerId, 'organization.vacation', 'organization', orgId, checked.value).catch(() => {});
    void this.versions.record('organizations', orgId, 'update_delta', callerId, { settings: { vacation: checked.value } }).catch(() => {});
    return { ok: true, settings: checked.value };
  }
}
