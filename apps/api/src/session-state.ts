import { sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { mintLocalToken, type AuthenticatedPrincipal } from './jwt';
import { passwordStamp } from './password-reset';

/**
 * Sessions end when the account changes under them: a session token carries the stamp of the password it was issued
 * for (`pv`, like the reset link), and every request (JwtAuthGuard, the notifications' WebSocket) checks that the
 * account is still active and its password the same. Changing or resetting the password, or deactivating the
 * account, ends every other session within CACHE_MS. Tokens from before (no `pv`) keep working until they expire.
 */

/** How long a check is reused per person and stamp, so a page's burst of requests asks the database once. */
export const CACHE_MS = 30_000;

/** The account's state: active or not, and its password's stamp ('' hashed for an account without a password). */
async function accountState(db: Db, userId: string): Promise<{ active: boolean; pv: string } | null> {
  const rows = await db.execute(sql`
    SELECT u.status, (SELECT i.password_hash FROM user_identities i WHERE i.user_id = u.id AND i.provider = 'password' LIMIT 1) AS hash
    FROM users u WHERE u.id = ${userId}::uuid`);
  const row = rows.rows[0] as { status: string; hash: string | null } | undefined;
  return row ? { active: row.status === 'active', pv: passwordStamp(row.hash) } : null;
}

/** A session token for the account as it is now (its password's stamp in it). */
export async function mintSessionToken(db: Db, userId: string, email: string, expiresInSec?: number, scope?: 'two-factor-setup'): Promise<string> {
  const state = await accountState(db, userId);
  return mintLocalToken(userId, email, expiresInSec, scope, state?.pv);
}

const checked = new Map<string, { ok: boolean; at: number }>();

/** Whether a local token's session still holds: the account exists, is active and (with `pv`) has the same password. */
export async function sessionHolds(db: Db | null | undefined, principal: AuthenticatedPrincipal, now = Date.now()): Promise<boolean> { // real time: sessions
  if (principal.kind !== 'local' || !db) return true;
  const key = `${principal.sub}|${principal.pv ?? ''}`;
  const hit = checked.get(key);
  if (hit && now - hit.at < CACHE_MS) return hit.ok;
  const state = /^[0-9a-f-]{36}$/i.test(principal.sub) ? await accountState(db, principal.sub) : null;
  const ok = !!state && state.active && (principal.pv === undefined || principal.pv === state.pv);
  checked.set(key, { ok, at: now });
  if (checked.size > 20_000) for (const [k, v] of checked) if (now - v.at >= CACHE_MS) checked.delete(k);
  return ok;
}

/** Forgets the cached checks of a person (their password just changed in this process): their old sessions end now. */
export function forgetSessions(userId: string): void {
  for (const k of checked.keys()) if (k.startsWith(`${userId}|`)) checked.delete(k);
}
