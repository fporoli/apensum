import { sql } from 'drizzle-orm';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import { isPrivileged, membershipRequires, parseTwoFactorPolicy } from '@worktime3/shared/twoFactor';
import { permissionIdsOf, type Executor } from './access';
import { purposeKey } from './jwt';
import { isRecoveryCodeShape, openSecret, recoveryHash, verifyTotp } from './totp';

/**
 * Two-step login, the database side (pure parts in totp.ts, the rule in packages/shared/src/twoFactor.ts).
 * Password logins only: an SSO login keeps its identity provider's own second step.
 */

/** The key the authenticator secrets are encrypted with (derived from API_JWT_SECRET). */
export const twoFactorKey = () => purposeKey('two-factor-secret');
/** Signs the short-lived "password was right, now the code" token of a login. */
export const twoFactorChallengeKey = () => purposeKey('two-factor-challenge');
export const TWO_FACTOR_CHALLENGE_SEC = 5 * 60;

export interface TwoFactorRow {
  secret_enc: string;
  enabled: boolean;
  recovery_hashes: string[];
  last_step: number;
}

export async function twoFactorRow(db: Executor, userId: string): Promise<TwoFactorRow | null> {
  const rows = await db.execute(
    sql`SELECT secret_enc, enabled, recovery_hashes, last_step::float AS last_step FROM user_two_factor WHERE user_id = ${userId}`,
  );
  return (rows.rows[0] as unknown as TwoFactorRow) ?? null;
}

/**
 * `TWO_FACTOR=off` turns the second step off on this instance (demo and test instances, set per GitHub
 * Environment; never on production): nobody is asked for it or required to set it up. Unset = on.
 */
export const twoFactorOff = (): boolean => (process.env.TWO_FACTOR ?? '').trim().toLowerCase() === 'off';

/**
 * Whether any organization the person is an active member of requires a second step of them: the
 * Admin organization always, others by their rule (everyone, or admins and HR).
 */
export async function twoFactorRequired(db: Executor, userId: string): Promise<boolean> {
  if (twoFactorOff()) return false;
  const rows = (
    await db.execute(
      sql`SELECT o.id, o.settings->>'twoFactor' AS policy FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
          WHERE m.user_id = ${userId} AND m.status = 'active' AND o.is_active`,
    )
  ).rows as { id: string; policy: string | null }[];
  for (const r of rows) {
    if (r.id === OPERATOR_ORG_ID) return true;
    const policy = parseTwoFactorPolicy(r.policy);
    if (policy === 'off') continue;
    const privileged = policy === 'privileged' ? isPrivileged(await permissionIdsOf(db, r.id, userId)) : false;
    if (membershipRequires(policy, privileged)) return true;
  }
  return false;
}

/**
 * Checks a code of an enabled second step and uses it up: an app code only once (its time step must be
 * newer than the last one used), a recovery code is removed. Returns how it was passed, or null.
 */
export async function useSecondFactor(db: Executor, userId: string, code: unknown, nowMs = Date.now()): Promise<'app' | 'recovery' | null> { // real time: TOTP codes
  if (typeof code !== 'string' || code.length > 40) return null;
  const row = await twoFactorRow(db, userId);
  if (!row?.enabled) return null;
  if (isRecoveryCodeShape(code)) {
    const hash = recoveryHash(userId, code);
    const used = await db.execute(
      sql`UPDATE user_two_factor SET recovery_hashes = array_remove(recovery_hashes, ${hash})
          WHERE user_id = ${userId} AND ${hash} = ANY(recovery_hashes) RETURNING user_id`,
    );
    return used.rows.length ? 'recovery' : null;
  }
  let secret: string;
  try {
    secret = openSecret(row.secret_enc, twoFactorKey());
  } catch {
    return null;
  }
  const step = verifyTotp(secret, code, nowMs, row.last_step);
  if (step === null) return null;
  // Two requests with the same code at once: only one moves the step on.
  const moved = await db.execute(
    sql`UPDATE user_two_factor SET last_step = ${step} WHERE user_id = ${userId} AND last_step < ${step} RETURNING user_id`,
  );
  return moved.rows.length ? 'app' : null;
}
