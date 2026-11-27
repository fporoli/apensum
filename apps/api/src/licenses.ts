import { sql } from 'drizzle-orm';
import type { Executor } from './access';

// Licenses of paid modules (093, organization_licenses): written by the operator's CLI only
// (cli/operator.ts), read here and, for permissions, inside permissionIdsOf's own query.

/** The organization's licenses valid today in Zurich: module id -> last day (inclusive), null = open-ended. */
export async function validLicenses(db: Executor, organizationId: string): Promise<Record<string, string | null>> {
  const rows = await db.execute(
    sql`SELECT module_id, valid_until::text AS valid_until FROM organization_licenses
        WHERE organization_id = ${organizationId}
          AND (valid_until IS NULL OR valid_until >= (now() AT TIME ZONE 'Europe/Zurich')::date)`, // real time: licenses are contracts in real time
  );
  const out: Record<string, string | null> = {};
  for (const r of rows.rows as { module_id?: string; valid_until?: string | null }[]) {
    if (typeof r.module_id === 'string') out[r.module_id] = r.valid_until ?? null;
  }
  return out;
}
