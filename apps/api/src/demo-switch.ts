// The demo instance's quick switch between people (`DEMO_AUTO_LOGIN`, set on the demo instance only).
//
// A visitor without a session is signed in as the account `DEMO_AUTO_LOGIN` names, and the user menu lists the other
// people of its organization with their roles and department, to sign in as them. Each is an ordinary sign-in with
// that account's password: only accounts whose password is the demo seed's convention (`<name>@...` / `<name>`,
// checked against the stored hash) are listed, so no account with a password of its own is ever offered, and
// nothing here issues a token for another account.
import * as bcrypt from 'bcryptjs';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';

export interface DemoPerson {
  name: string;
  user: string;
  password: string;
  /** Role names of the membership (`admin`, `hr`, `manager`, an organization's own, ...). */
  roles: string[];
  department: string | null;
}

/** The password the demo seed gives an account: the address's local part. */
export function demoPassword(email: string): string {
  return email.split('@')[0] ?? '';
}

const CACHE_MS = 10 * 60 * 1000;
let cache: { key: string; at: number; people: DemoPerson[] } | null = null;

/**
 * The people of the organization of `autoLogin`'s account whose password is the demo one, the auto-login account
 * among them (first), or [] when it is unset, unknown or not a demo account. Cached for ten minutes (bcrypt is slow
 * on purpose); a demo reset keeps the same accounts.
 */
export async function demoPeople(db: Db, autoLogin: string | undefined, now = Date.now()): Promise<DemoPerson[]> {
  const email = (autoLogin ?? '').trim().toLowerCase();
  if (!email) return [];
  if (cache && cache.key === email && now - cache.at < CACHE_MS) return cache.people;
  const result = await db.execute(sql`
    WITH org AS (
      SELECT m.organization_id FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE lower(u.email) = ${email} AND m.status = 'active'
      ORDER BY m.organization_id LIMIT 1
    )
    SELECT u.email, coalesce(nullif(u.display_name, ''), u.email) AS name, i.password_hash, d.name AS department,
           coalesce((SELECT array_agg(r.name ORDER BY r.name) FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
                     WHERE mr.membership_id = m.id), '{}') AS roles
    FROM org
    JOIN organization_memberships m ON m.organization_id = org.organization_id
    JOIN users u ON u.id = m.user_id
    JOIN user_identities i ON i.user_id = u.id AND i.provider = 'password'
    LEFT JOIN (
      SELECT DISTINCT ON (a.user_id) a.user_id, a.department_id FROM employee_assignments a, org
      WHERE a.organization_id = org.organization_id AND a.valid_from <= CURRENT_DATE
      ORDER BY a.user_id, a.valid_from DESC
    ) a ON a.user_id = u.id
    LEFT JOIN departments d ON d.id = a.department_id
    WHERE m.status = 'active' AND u.is_active AND u.status = 'active' AND (m.exit_at IS NULL OR m.exit_at > now())
    ORDER BY lower(coalesce(nullif(u.display_name, ''), u.email))`);
  const people: DemoPerson[] = [];
  for (const r of result.rows as Record<string, unknown>[]) {
    const user = String(r.email);
    const password = demoPassword(user);
    const hash = r.password_hash as string | null;
    if (!password || !hash || !(await bcrypt.compare(password, hash))) continue;
    people.push({ name: String(r.name), user, password, roles: (r.roles as string[]) ?? [], department: (r.department as string | null) ?? null });
  }
  const sorted = people.some((p) => p.user.toLowerCase() === email)
    ? [...people.filter((p) => p.user.toLowerCase() === email), ...people.filter((p) => p.user.toLowerCase() !== email)]
    : [];
  // An empty answer (a demo reset in progress, the database still empty) is not kept: the next call asks again.
  cache = sorted.length ? { key: email, at: now, people: sorted } : null;
  return sorted;
}
