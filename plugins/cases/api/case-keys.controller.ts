import { Body, Controller, Delete, Get, Param, Post, Put, Req, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbService, type Db } from '@worktime3/api/plugin';
import { callerUserId, can, isOrgMember, permissionIdsOf } from '@worktime3/api/plugin';
import { grantedScopes } from '@worktime3/shared/permissions';
import type { AuthenticatedRequest } from '@worktime3/api/plugin';
import { isWrappedKey, validateUserKeyRecord, type UserKeyRecord } from '../shared/caseCrypto';

/**
 * Key storage for Cases' end-to-end encryption (shared/caseCrypto.ts). Everything here is ciphertext or a
 * public key: the server cannot read a case, and cannot check that a wrapped key is the right one.
 * What it does enforce is who may hold a key for a case: only people who may see the case, handed over by
 * someone who already holds it (the first key is made by whoever may edit the case).
 */

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const nobody = { ok: false as const };

/** Whether `userId` may see the case row at all: scope `all`, or `own` and the case's lead. */
export async function mayReachCase(db: Db, orgId: string, userId: string, leadUserId: string | null, action: 'see' | 'edit'): Promise<boolean> {
  if (!(await can(db, orgId, userId, 'nav.cases', action))) return false;
  const scopes = grantedScopes(await permissionIdsOf(db, orgId, userId), 'nav.cases', action);
  return scopes.has('all') || leadUserId === userId;
}

@Controller('organizations/:orgId')
export class CaseKeysController {
  constructor(private readonly dbService: DbService) {}

  private async caller(req: AuthenticatedRequest): Promise<{ db: Db; userId: string }> {
    const db = this.dbService.getDb();
    if (!db) throw new ServiceUnavailableException('db-unavailable');
    const userId = req.user ? await callerUserId(db, req.user) : null;
    if (!userId) throw new UnauthorizedException('unauthenticated');
    return { db, userId };
  }

  private async keyRecord(db: Db, userId: string): Promise<UserKeyRecord | null> {
    const res = await db.execute(sql`
      SELECT public_key, wrapped_private_key, salt, iterations FROM cases.user_keys WHERE user_id = ${userId}::uuid`);
    const r = res.rows[0] as { public_key: string; wrapped_private_key: string; salt: string; iterations: number } | undefined;
    return r ? { publicKey: r.public_key, wrappedPrivateKey: r.wrapped_private_key, salt: r.salt, iterations: r.iterations } : null;
  }

  private async caseLead(db: Db, orgId: string, caseId: string): Promise<{ lead: string | null } | null> {
    if (!UUID.test(caseId)) return null;
    const res = await db.execute(sql`
      SELECT lead_user_id FROM cases.cases WHERE id = ${caseId}::uuid AND organization_id = ${orgId}::uuid`);
    const r = res.rows[0] as { lead_user_id: string | null } | undefined;
    return r ? { lead: r.lead_user_id } : null;
  }

  // ---- the caller's own key pair ----------------------------------------------------------------

  @Get('case-keys/me')
  async myKeys(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    const { db, userId } = await this.caller(req);
    if (!(await isOrgMember(db, orgId, userId)) || !(await can(db, orgId, userId, 'nav.cases', 'see'))) return { ok: true, keys: null };
    return { ok: true, keys: await this.keyRecord(db, userId) };
  }

  /** First setup: the browser made a key pair and sealed the private half under the passphrase. */
  @Put('case-keys/me')
  async createMyKeys(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const { db, userId } = await this.caller(req);
    if (!(await can(db, orgId, userId, 'nav.cases', 'see'))) return { ok: false, error: 'forbidden' };
    const rec = validateUserKeyRecord(body);
    if (!rec) return { ok: false, error: 'invalid-keys' };
    const res = await db.execute(sql`
      INSERT INTO cases.user_keys (user_id, public_key, wrapped_private_key, salt, iterations)
      VALUES (${userId}::uuid, ${rec.publicKey}, ${rec.wrappedPrivateKey}, ${rec.salt}, ${rec.iterations})
      ON CONFLICT (user_id) DO NOTHING RETURNING user_id`);
    return res.rows.length ? { ok: true } : { ok: false, error: 'keys-exist' };
  }

  /** New passphrase: the same key pair, sealed again. The public key must not change, or every case key would break. */
  @Post('case-keys/me/passphrase')
  async changeMyPassphrase(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const { db, userId } = await this.caller(req);
    if (!(await can(db, orgId, userId, 'nav.cases', 'see'))) return { ok: false, error: 'forbidden' };
    const rec = validateUserKeyRecord(body);
    if (!rec) return { ok: false, error: 'invalid-keys' };
    const res = await db.execute(sql`
      UPDATE cases.user_keys SET wrapped_private_key = ${rec.wrappedPrivateKey}, salt = ${rec.salt}, iterations = ${rec.iterations}
      WHERE user_id = ${userId}::uuid AND public_key = ${rec.publicKey} RETURNING user_id`);
    return res.rows.length ? { ok: true } : { ok: false, error: 'public-key-mismatch' };
  }

  /** A colleague's public key, to hand them a case key. Public keys are not secret; members only. */
  @Get('case-keys/users/:userId')
  async publicKeyOf(@Param('orgId') orgId: string, @Param('userId') userId: string, @Req() req: AuthenticatedRequest) {
    const { db, userId: me } = await this.caller(req);
    if (!UUID.test(userId) || !(await can(db, orgId, me, 'nav.cases', 'see')) || !(await isOrgMember(db, orgId, userId))) return nobody;
    const rec = await this.keyRecord(db, userId);
    return rec ? { ok: true, publicKey: rec.publicKey } : { ok: false, error: 'no-keys' };
  }

  // ---- a case's keys ----------------------------------------------------------------------------

  /** Who holds a key for the case, and the caller's own wrapped key. Empty for people who may not see the case. */
  @Get('cases/:caseId/keys')
  async caseKeys(@Param('orgId') orgId: string, @Param('caseId') caseId: string, @Req() req: AuthenticatedRequest) {
    const { db, userId } = await this.caller(req);
    const c = await this.caseLead(db, orgId, caseId);
    if (!c || !(await mayReachCase(db, orgId, userId, c.lead, 'see'))) return { ok: true, encrypted: false, mine: null, members: [] };
    const res = await db.execute(sql`
      SELECT k.user_id, k.wrapped_key, u.display_name
      FROM cases.case_keys k JOIN public.users u ON u.id = k.user_id
      WHERE k.case_id = ${caseId}::uuid ORDER BY u.display_name`);
    const rows = res.rows as { user_id: string; wrapped_key: string; display_name: string }[];
    return {
      ok: true,
      encrypted: rows.length > 0,
      mine: rows.find((r) => r.user_id === userId)?.wrapped_key ?? null,
      members: rows.map((r) => ({ userId: r.user_id, name: r.display_name })),
    };
  }

  @Put('cases/:caseId/keys/:userId')
  async grantKey(
    @Param('orgId') orgId: string,
    @Param('caseId') caseId: string,
    @Param('userId') target: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: { wrappedKey?: unknown },
  ) {
    const { db, userId } = await this.caller(req);
    const c = await this.caseLead(db, orgId, caseId);
    if (!c || !UUID.test(target)) return { ok: false, error: 'not-found' };
    if (!isWrappedKey(body?.wrappedKey)) return { ok: false, error: 'invalid-key' };

    const held = await db.execute(sql`SELECT user_id FROM cases.case_keys WHERE case_id = ${caseId}::uuid`);
    const holders = new Set((held.rows as { user_id: string }[]).map((r) => r.user_id));

    if (holders.size === 0) {
      // Encrypting a case for the first time: whoever may edit it makes the first key, for themselves.
      if (target !== userId || !(await mayReachCase(db, orgId, userId, c.lead, 'edit'))) return { ok: false, error: 'forbidden' };
    } else {
      if (!holders.has(userId)) return { ok: false, error: 'no-case-key' };
      if (!(await isOrgMember(db, orgId, target)) || !(await mayReachCase(db, orgId, target, c.lead, 'see'))) return { ok: false, error: 'forbidden' };
      if (!(await this.keyRecord(db, target))) return { ok: false, error: 'no-keys' };
    }

    await db.execute(sql`
      INSERT INTO cases.case_keys (case_id, user_id, wrapped_key, granted_by)
      VALUES (${caseId}::uuid, ${target}::uuid, ${body.wrappedKey as string}, ${userId}::uuid)
      ON CONFLICT (case_id, user_id) DO UPDATE SET wrapped_key = EXCLUDED.wrapped_key, granted_by = EXCLUDED.granted_by`);
    return { ok: true };
  }

  /** Takes a member's key away. Anyone who already opened the case keeps what they saw: rotate the key for that (later phase). */
  @Delete('cases/:caseId/keys/:userId')
  async revokeKey(@Param('orgId') orgId: string, @Param('caseId') caseId: string, @Param('userId') target: string, @Req() req: AuthenticatedRequest) {
    const { db, userId } = await this.caller(req);
    const c = await this.caseLead(db, orgId, caseId);
    if (!c || !UUID.test(target)) return { ok: false, error: 'not-found' };
    const held = await db.execute(sql`SELECT user_id FROM cases.case_keys WHERE case_id = ${caseId}::uuid`);
    const holders = (held.rows as { user_id: string }[]).map((r) => r.user_id);
    if (!holders.includes(userId) || !(await mayReachCase(db, orgId, userId, c.lead, 'edit'))) return { ok: false, error: 'forbidden' };
    if (holders.length === 1 && holders[0] === target) return { ok: false, error: 'last-key' };
    await db.execute(sql`DELETE FROM cases.case_keys WHERE case_id = ${caseId}::uuid AND user_id = ${target}::uuid`);
    return { ok: true };
  }
}
