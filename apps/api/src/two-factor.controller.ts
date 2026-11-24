import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { parseTwoFactorPolicy, TWO_FACTOR_POLICIES, type TwoFactorPolicy } from '@worktime3/shared/twoFactor';
import { callerUserId, can } from './access';
import { AuditService } from './audit.service';
import { issueSession, TWO_FACTOR_ATTEMPTS_PER_HOUR } from './auth.controller';
import { DbService, type Db } from './db.service';
import { TwoFactorSetup, type AuthenticatedRequest } from './jwt.guard';
import { HourlyLimiter } from './password-reset';
import { newRecoveryCodes, newTotpSecret, openSecret, otpauthUri, recoveryHash, sealSecret, verifyTotp } from './totp';
import { twoFactorKey, twoFactorOff, twoFactorRequired, twoFactorRow, useSecondFactor } from './two-factor';
import { VersionsService } from './versions.service';

/**
 * Two-step login: one's own (Settings: set up, confirm, recovery codes, turn off) and an organization's
 * rule (Organization settings -> Security). An account's second step is its own: no organization's
 * rights turn it on, off or reset it; a lost phone takes a recovery code, else the operator CLI
 * (`twofactor reset`). Password accounts only; SSO keeps its identity provider's second step.
 * The setup endpoints also take a setup-only token (`TwoFactorSetup`), for someone an organization
 * requires it of who has not set it up yet.
 */
@Controller()
export class TwoFactorController {
  constructor(
    private readonly dbService: DbService,
    private readonly versions: VersionsService,
    private readonly audit: AuditService,
  ) {}

  private readonly attempts = new HourlyLimiter(TWO_FACTOR_ATTEMPTS_PER_HOUR);

  /** The caller when they sign in with a password of their own (local token), else null. */
  private async me(db: Db, req: AuthenticatedRequest): Promise<{ id: string; email: string; display_name: string } | null> {
    if (req.user?.kind !== 'local') return null;
    const id = await callerUserId(db, req.user);
    if (!id) return null;
    const rows = await db.execute(
      sql`SELECT u.id, u.email::text AS email, u.display_name FROM users u
          WHERE u.id = ${id} AND u.status = 'active'
            AND EXISTS (SELECT 1 FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'password')`,
    );
    return (rows.rows[0] as { id: string; email: string; display_name: string } | undefined) ?? null;
  }

  @TwoFactorSetup()
  @Get('users/me/two-factor')
  async status(@Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    if (twoFactorOff()) return { ok: true, available: false, instanceOff: true };
    const me = await this.me(db, req);
    if (!me) return { ok: true, available: false };
    const row = await twoFactorRow(db, me.id);
    return {
      ok: true,
      available: true,
      enabled: row?.enabled === true,
      required: await twoFactorRequired(db, me.id),
      recoveryCodesLeft: row?.enabled ? row.recovery_hashes.length : 0,
    };
  }

  /** A new secret for the authenticator app (QR code); it counts once a code confirms it (`enable`). */
  @TwoFactorSetup()
  @Post('users/me/two-factor/setup')
  async setup(@Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    if (twoFactorOff()) return { ok: false, error: 'two-factor-off' };
    const me = await this.me(db, req);
    if (!me) return { ok: false, error: 'two-factor-unavailable' };
    if ((await twoFactorRow(db, me.id))?.enabled) return { ok: false, error: 'two-factor-enabled' };
    const secret = newTotpSecret();
    await db.execute(
      sql`INSERT INTO user_two_factor (user_id, secret_enc, enabled, recovery_hashes, last_step)
          VALUES (${me.id}, ${sealSecret(secret, twoFactorKey())}, false, '{}', 0)
          ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, enabled = false, recovery_hashes = '{}', last_step = 0`,
    );
    return { ok: true, secret, uri: otpauthUri('Apensum', me.email, secret) };
  }

  /** Confirms the setup with a code from the app: on, ten recovery codes (shown once) and a full session. */
  @TwoFactorSetup()
  @Post('users/me/two-factor/enable')
  async enable(@Body() body: { code?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const me = await this.me(db, req);
    if (!me) return { ok: false, error: 'two-factor-unavailable' };
    if (!this.attempts.allow(me.id, Date.now())) return { ok: false, error: 'too-many-attempts' };
    const row = await twoFactorRow(db, me.id);
    if (!row) return { ok: false, error: 'two-factor-not-set-up' };
    if (row.enabled) return { ok: false, error: 'two-factor-enabled' };
    const step = typeof body?.code === 'string' ? verifyTotp(openSecret(row.secret_enc, twoFactorKey()), body.code, Date.now(), 0) : null;
    if (step === null) return { ok: false, error: 'two-factor-invalid' };
    const codes = newRecoveryCodes();
    await db.execute(
      sql`UPDATE user_two_factor SET enabled = true, last_step = ${step},
            recovery_hashes = ARRAY[${sql.join(codes.map((c) => sql`${recoveryHash(me.id, c)}`), sql`, `)}]::text[]
          WHERE user_id = ${me.id} AND NOT enabled`,
    );
    void this.versions.record('users', me.id, 'update_delta', me.id, { twoFactor: 'enabled' }).catch(() => {});
    return { ok: true, recoveryCodes: codes, session: await issueSession(db, me) };
  }

  /** Turns it off (with a code), unless an organization requires it. */
  @Post('users/me/two-factor/disable')
  async disable(@Body() body: { code?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const me = await this.me(db, req);
    if (!me) return { ok: false, error: 'two-factor-unavailable' };
    if (await twoFactorRequired(db, me.id)) return { ok: false, error: 'two-factor-required' };
    if (!this.attempts.allow(me.id, Date.now())) return { ok: false, error: 'too-many-attempts' };
    if (!(await useSecondFactor(db, me.id, body?.code))) return { ok: false, error: 'two-factor-invalid' };
    await db.execute(sql`DELETE FROM user_two_factor WHERE user_id = ${me.id}`);
    void this.versions.record('users', me.id, 'update_delta', me.id, { twoFactor: 'disabled' }).catch(() => {});
    return { ok: true };
  }

  /** Ten new recovery codes (with a code); the old ones stop working. */
  @Post('users/me/two-factor/recovery-codes')
  async recoveryCodes(@Body() body: { code?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const me = await this.me(db, req);
    if (!me) return { ok: false, error: 'two-factor-unavailable' };
    if (!this.attempts.allow(me.id, Date.now())) return { ok: false, error: 'too-many-attempts' };
    if (!(await useSecondFactor(db, me.id, body?.code))) return { ok: false, error: 'two-factor-invalid' };
    const codes = newRecoveryCodes();
    await db.execute(
      sql`UPDATE user_two_factor SET recovery_hashes = ARRAY[${sql.join(codes.map((c) => sql`${recoveryHash(me.id, c)}`), sql`, `)}]::text[]
          WHERE user_id = ${me.id} AND enabled`,
    );
    return { ok: true, recoveryCodes: codes };
  }

  /** The organization's rule: whoever sees Organization settings reads it, whoever edits them sets it. */
  @Get('organizations/:orgId/two-factor-policy')
  async policy(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true, policy: 'off' };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || !(await can(db, orgId, callerId, 'nav.orgSettings', 'see'))) return { ok: false, error: 'forbidden', policy: 'off' };
    const rows = await db.execute(sql`SELECT settings->>'twoFactor' AS policy FROM organizations WHERE id = ${orgId}`);
    return {
      ok: true,
      policy: parseTwoFactorPolicy((rows.rows[0] as { policy?: unknown } | undefined)?.policy),
      canEdit: await can(db, orgId, callerId, 'nav.orgSettings', 'edit'),
    };
  }

  @Put('organizations/:orgId/two-factor-policy')
  async setPolicy(@Param('orgId') orgId: string, @Body() body: { policy?: unknown }, @Req() req: AuthenticatedRequest) {
    const db = this.dbService.getDb();
    if (!db) return { ok: true, offline: true };
    const callerId = req.user ? await callerUserId(db, req.user) : null;
    if (!callerId || orgId === OPERATOR_ORG_ID || !(await can(db, orgId, callerId, 'nav.orgSettings', 'edit'))) return { ok: false, error: 'forbidden' };
    if (!(TWO_FACTOR_POLICIES as readonly unknown[]).includes(body?.policy)) return { ok: false, error: 'invalid-policy' };
    const policy = body.policy as TwoFactorPolicy;
    await db.execute(
      sql`UPDATE organizations SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{twoFactor}', to_jsonb(${policy}::text)) WHERE id = ${orgId}`,
    );
    void this.versions.record('organizations', orgId, 'update_delta', callerId, { settings: { twoFactor: policy } }).catch(() => {});
    void this.audit.record(orgId, callerId, 'two-factor.policy', 'organization', orgId, { policy }).catch(() => {});
    return { ok: true, policy };
  }
}
