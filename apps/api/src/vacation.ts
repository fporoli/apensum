import { sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { parseVacationSettings, probationEnd, type VacationPerson, type VacationRule } from '@worktime3/shared/vacation';

export interface VacationProfile extends VacationPerson {
  rules: VacationRule[];
}

/**
 * What a person's entitlement depends on in this organization. The birth date is the organization's own
 * (`basicdata.orgs.<orgId>.birthDate`), else the one entered before it was kept per organization.
 */
export async function vacationProfile(db: Db, orgId: string, userId: string): Promise<VacationProfile> {
  const [facts, assignments] = await Promise.all([
    db.execute(sql`
      SELECT o.settings,
             CASE WHEN COALESCE(u.basicdata -> 'orgs' -> ${orgId}::text, '{}'::jsonb) ? 'birthDate'
                  THEN u.basicdata -> 'orgs' -> ${orgId}::text ->> 'birthDate'
                  ELSE u.basicdata ->> 'birthDate' END AS birth_date
      FROM organizations o, users u
      WHERE o.id = ${orgId} AND u.id = ${userId}`),
    db.execute(sql`
      SELECT to_char(valid_from, 'YYYY-MM-DD') AS valid_from, is_management
      FROM employee_assignments WHERE organization_id = ${orgId} AND user_id = ${userId}`),
  ]);
  const row = facts.rows[0] as { settings?: unknown; birth_date?: string | null } | undefined;
  return {
    rules: parseVacationSettings(row?.settings).rules,
    birthDate: row?.birth_date || null,
    management: (assignments.rows as { valid_from: string; is_management: boolean }[]).map((r) => ({ validFrom: r.valid_from, management: r.is_management === true })),
  };
}

/** A person's last day of probation, or null without one. */
export async function probationUntilOf(db: Db, orgId: string, userId: string): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT to_char(COALESCE(m.start_date, (m.joined_at AT TIME ZONE 'Europe/Zurich')::date), 'YYYY-MM-DD') AS employed_from,
           to_char(m.probation_until, 'YYYY-MM-DD') AS probation_until, o.settings
    FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
    WHERE m.organization_id = ${orgId} AND m.user_id = ${userId}`);
  const row = result.rows[0] as { employed_from?: string | null; probation_until?: string | null; settings?: unknown } | undefined;
  if (!row?.employed_from) return null;
  return probationEnd(row.employed_from, parseVacationSettings(row.settings).probationMonths, row.probation_until);
}
