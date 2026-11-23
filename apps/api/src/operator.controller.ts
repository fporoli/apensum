import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { parseAiSettings, validateAiSettings } from '@worktime3/shared/ai';
import { MODULES } from '@worktime3/shared/modules';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { isIsoDate } from '@worktime3/shared/worktime';
import { callerUserId, isOperator, type Executor } from './access';
import { azureAllowed, instanceBudgetChf, MONTH_START } from './ai-budget.service';
import { AuditService } from './audit.service';
import { currentMasterKey } from './document-crypto';
import { demoResetEveryHours, STARTED_AT } from './health.controller';
import { diskFacts } from './monitor.service';
import { lastSmtpStatus } from './mailer';
import { VersionsService } from './versions.service';
import { DbService } from './db.service';
import type { AuthenticatedRequest } from './jwt.guard';

/**
 * The Super Admin pages' API (`operator/*`; the pages show in the Admin organization,
 * OPERATOR_ORG_ID): what the instance's operators do across organizations. Licenses, AI limits, the
 * instance overview and superusers here; product news is NewsController at `operator/news`.
 *
 * Only operators (active members of the Admin organization, 098) get anything. It never reads
 * people's data inside an organization: names, counts, owners and licenses only. A license change is
 * in that organization's audit log, a superuser change in the Admin organization's, with the
 * operator as actor.
 */

/** The licensed modules of this instance (core and installed plugins). */
export function licensableModules(): { id: string; caption: string }[] {
  return MODULES.filter((m) => m.licensed).map((m) => ({ id: m.id, caption: m.caption }));
}

/** `{ validUntil: 'YYYY-MM-DD' | null }`: null = open-ended. */
export function parseLicenseBody(body: unknown): { ok: true; validUntil: string | null } | { ok: false; error: string } {
  const v = (body as { validUntil?: unknown } | null)?.validUntil;
  if (v === null || v === undefined || v === '') return { ok: true, validUntil: null };
  if (typeof v === 'string' && isIsoDate(v)) return { ok: true, validUntil: v };
  return { ok: false, error: 'invalid-date' };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller('operator')
export class OperatorController {
  constructor(
    private readonly dbService: DbService,
    private readonly audit: AuditService,
    private readonly versions: VersionsService,
  ) {}

  /** The caller's id when they are an operator, else null. */
  private async operator(db: Executor, req: AuthenticatedRequest): Promise<string | null> {
    const id = req.user ? await callerUserId(db, req.user) : null;
    return id && (await isOperator(db, id)) ? id : null;
  }

  @Get('me')
  async me(@Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const id = await this.operator(db, req);
    return id ? { ok: true, operator: true } : { ok: false, error: 'forbidden' };
  }

  /** Every organization with its member count, owners and licenses; the licensable modules. */
  @Get('organizations')
  async organizations(@Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true, organizations: [], modules: [] };
    if (!(await this.operator(db, req))) return { ok: false, error: 'forbidden', organizations: [], modules: [] };
    const rows = await db.execute(sql`
      SELECT o.id, o.name, o.slug::text AS slug, o.type,
        (SELECT count(*)::int FROM organization_memberships m WHERE m.organization_id = o.id AND m.status = 'active') AS members,
        coalesce((SELECT array_agg(DISTINCT u.email::text ORDER BY u.email::text)
           FROM organization_memberships m JOIN users u ON u.id = m.user_id
           JOIN membership_roles mr ON mr.membership_id = m.id JOIN roles r ON r.id = mr.role_id
           WHERE m.organization_id = o.id AND m.status = 'active' AND r.name = 'owner'), '{}') AS owners,
        coalesce((SELECT jsonb_agg(jsonb_build_object('moduleId', l.module_id, 'validUntil', l.valid_until::text,
             'expired', l.valid_until IS NOT NULL AND l.valid_until < (now() AT TIME ZONE 'Europe/Zurich')::date) ORDER BY l.module_id)
           FROM organization_licenses l WHERE l.organization_id = o.id), '[]'::jsonb) AS licenses
      FROM organizations o WHERE o.id <> ${OPERATOR_ORG_ID} ORDER BY lower(o.name), o.id`);
    return { ok: true, organizations: rows.rows, modules: licensableModules() };
  }

  /** Grants or changes a license (through the day given, or open-ended). */
  @Put('organizations/:orgId/licenses/:moduleId')
  async grant(@Param('orgId') orgId: string, @Param('moduleId') moduleId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const operatorId = await this.operator(db, req);
    if (!operatorId) return { ok: false, error: 'forbidden' };
    if (!licensableModules().some((m) => m.id === moduleId)) return { ok: false, error: 'unknown-module' };
    const input = parseLicenseBody(body);
    if (!input.ok) return input;
    if (!UUID.test(orgId) || orgId === OPERATOR_ORG_ID) return { ok: false, error: 'unknown-organization' };
    const org = await db.execute(sql`SELECT 1 FROM organizations WHERE id = ${orgId}`);
    if (!org.rows.length) return { ok: false, error: 'unknown-organization' };
    // One statement, so there is no license change without its audit entry.
    await db.execute(sql`
      WITH changed AS (
        INSERT INTO organization_licenses (organization_id, module_id, valid_until) VALUES (${orgId}::uuid, ${moduleId}::text, ${input.validUntil}::date)
        ON CONFLICT (organization_id, module_id) DO UPDATE SET valid_until = EXCLUDED.valid_until
        WHERE organization_licenses.valid_until IS DISTINCT FROM EXCLUDED.valid_until
        RETURNING organization_id, module_id, valid_until
      )
      INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
      SELECT organization_id, ${operatorId}::uuid, 'license.grant', 'module', module_id, jsonb_build_object('until', valid_until, 'by', 'super admin')
      FROM changed`);
    return { ok: true };
  }

  @Delete('organizations/:orgId/licenses/:moduleId')
  async revoke(@Param('orgId') orgId: string, @Param('moduleId') moduleId: string, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const operatorId = await this.operator(db, req);
    if (!operatorId) return { ok: false, error: 'forbidden' };
    if (!UUID.test(orgId)) return { ok: false, error: 'unknown-organization' };
    const removed = await db.execute(sql`
      WITH removed AS (
        DELETE FROM organization_licenses WHERE organization_id = ${orgId}::uuid AND module_id = ${moduleId}
        RETURNING organization_id, module_id
      )
      INSERT INTO audit_logs (organization_id, actor_user_id, action, target_type, target_id, metadata)
      SELECT organization_id, ${operatorId}::uuid, 'license.revoke', 'module', module_id, jsonb_build_object('by', 'super admin')
      FROM removed RETURNING id`);
    return removed.rows.length ? { ok: true } : { ok: false, error: 'no-license' };
  }

  /** The operators (superusers): the Admin organization's active members. */
  @Get('operators')
  async operators(@Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true, operators: [] };
    const me = await this.operator(db, req);
    if (!me) return { ok: false, error: 'forbidden', operators: [] };
    const rows = await db.execute(sql`
      SELECT u.id AS "userId", coalesce(nullif(u.display_name, ''), u.email::text) AS name, u.email::text AS email, (u.id = ${me}) AS me
      FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${OPERATOR_ORG_ID} AND m.status = 'active'
      ORDER BY lower(coalesce(nullif(u.display_name, ''), u.email::text))`);
    return { ok: true, operators: rows.rows };
  }

  /** Makes an existing account an operator (`{ email }`); never creates or invites one. */
  @Post('operators')
  async addOperator(@Body() body: { email?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const me = await this.operator(db, req);
    if (!me) return { ok: false, error: 'forbidden' };
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) return { ok: false, error: 'invalid-email' };
    const [user] = (await db.execute(sql`SELECT id FROM users WHERE email = ${email} AND status = 'active'`)).rows as { id: string }[];
    if (!user) return { ok: false, error: 'unknown-account' };
    const [granted] = (await db.execute(sql`SELECT operator_grant(${user.id}::uuid) AS added`)).rows as { added: boolean }[];
    if (!granted?.added) return { ok: false, error: 'already-operator' };
    void this.audit.record(OPERATOR_ORG_ID, me, 'operator.grant', 'user', user.id).catch(() => {});
    return { ok: true, userId: user.id };
  }

  /** Takes an operator's rights; the last operator stays (the CLI can still change that). */
  @Delete('operators/:userId')
  async removeOperator(@Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const me = await this.operator(db, req);
    if (!me) return { ok: false, error: 'forbidden' };
    if (!UUID.test(userId)) return { ok: false, error: 'not-operator' };
    const [count] = (
      await db.execute(sql`SELECT count(*)::int AS n FROM organization_memberships WHERE organization_id = ${OPERATOR_ORG_ID} AND status = 'active'`)
    ).rows as { n: number }[];
    if ((count?.n ?? 0) <= 1) return { ok: false, error: 'last-operator' };
    const [revoked] = (await db.execute(sql`SELECT operator_revoke(${userId}::uuid) AS removed`)).rows as { removed: boolean }[];
    if (!revoked?.removed) return { ok: false, error: 'not-operator' };
    void this.audit.record(OPERATOR_ORG_ID, me, 'operator.revoke', 'user', userId).catch(() => {});
    return { ok: true };
  }

  /** Every organization's AI limit and this month's spend, and the instance's budget (AI limits page). */
  @Get('ai')
  async ai(@Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true, organizations: [] };
    if (!(await this.operator(db, req))) return { ok: false, error: 'forbidden', organizations: [] };
    const rows = (
      await db.execute(sql`
        SELECT o.id, o.name, o.slug::text AS slug, o.settings->'ai' AS ai,
          coalesce(u.spent, 0)::float AS "spentChf", coalesce(u.calls, 0)::int AS calls
        FROM organizations o
        LEFT JOIN (SELECT organization_id, sum(coalesce(actual_chf, estimated_chf)) AS spent, count(*) AS calls
                   FROM ai_usage WHERE created_at >= ${MONTH_START} GROUP BY organization_id) u ON u.organization_id = o.id
        WHERE o.id <> ${OPERATOR_ORG_ID}
        ORDER BY coalesce(u.spent, 0) DESC, lower(o.name)`)
    ).rows as { id: string; name: string; slug: string; ai: unknown; spentChf: number; calls: number }[];
    const instanceSpentChf = rows.reduce((sum, r) => sum + r.spentChf, 0);
    return {
      ok: true,
      azure: azureAllowed(),
      instanceBudgetChf: instanceBudgetChf(),
      instanceSpentChf,
      organizations: rows.map(({ ai, ...r }) => ({ ...r, limitChf: parseAiSettings(ai).monthlyLimitChf })),
    };
  }

  /** Sets an organization's monthly AI limit (`{ monthlyLimitChf }`), as Organization settings -> AI did. */
  @Put('organizations/:orgId/ai-limit')
  async setAiLimit(@Param('orgId') orgId: string, @Body() body: unknown, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const operatorId = await this.operator(db, req);
    if (!operatorId) return { ok: false, error: 'forbidden' };
    if (!UUID.test(orgId) || orgId === OPERATOR_ORG_ID) return { ok: false, error: 'unknown-organization' };
    const checked = validateAiSettings(body);
    if (!checked.ok) return { ok: false, error: checked.error };
    const updated = await db.execute(sql`
      UPDATE organizations
      SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{ai}', COALESCE(settings->'ai', '{}'::jsonb) || ${JSON.stringify(checked.value)}::jsonb)
      WHERE id = ${orgId}::uuid RETURNING id`);
    if (!updated.rows.length) return { ok: false, error: 'unknown-organization' };
    void this.versions.record('organizations', orgId, 'update_delta', operatorId, { settings: { ai: checked.value } }).catch(() => {});
    void this.audit.record(orgId, operatorId, 'ai.limit', 'organization', orgId, { monthlyLimitChf: checked.value.monthlyLimitChf }).catch(() => {});
    return { ok: true, settings: checked.value };
  }

  /** The instance at a glance: what runs, what is configured, how much there is. No people's data. */
  @Get('instance')
  async instance(@Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    if (!(await this.operator(db, req))) return { ok: false, error: 'forbidden' };
    const [counts] = (
      await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM organizations WHERE id <> ${OPERATOR_ORG_ID}) AS organizations,
          (SELECT count(*)::int FROM organizations o WHERE o.id <> ${OPERATOR_ORG_ID} AND NOT EXISTS (
             SELECT 1 FROM organization_memberships m JOIN membership_roles mr ON mr.membership_id = m.id JOIN roles r ON r.id = mr.role_id
             WHERE m.organization_id = o.id AND m.status = 'active' AND r.name = 'owner')) AS "withoutOwner",
          (SELECT count(*)::int FROM users WHERE status = 'active') AS "activeUsers",
          (SELECT count(*)::int FROM organization_memberships WHERE status = 'active' AND organization_id <> ${OPERATOR_ORG_ID}) AS memberships,
          (SELECT count(*)::int FROM organization_licenses
             WHERE valid_until IS NULL OR valid_until >= (now() AT TIME ZONE 'Europe/Zurich')::date) AS licenses,
          (SELECT count(*)::int FROM newsletter_subscribers WHERE status = 'confirmed') AS subscribers,
          (SELECT count(*)::int FROM documents) AS documents,
          pg_database_size(current_database())::bigint AS "databaseBytes"`)
    ).rows as Record<string, number>[];
    return {
      ok: true,
      startedAt: STARTED_AT,
      smtp: lastSmtpStatus(),
      azure: azureAllowed(),
      documentsEncrypted: currentMasterKey() !== null,
      demoResetEveryHours: demoResetEveryHours(),
      disk: await diskFacts(),
      counts: { ...counts, databaseBytes: Number(counts.databaseBytes) },
    };
  }
}
