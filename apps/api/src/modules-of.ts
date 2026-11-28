import { sql } from 'drizzle-orm';
import { resolveModules } from '@worktime3/shared/modules';
import type { Db } from './db.service';

/** Which modules are on (and licensed) in the organization. */
export async function modulesOf(db: Db, orgId: string): Promise<Record<string, boolean>> {
  const rows = (await db.execute(sql`
    SELECT o.settings -> 'modules' AS modules,
      (SELECT jsonb_agg(l.module_id) FROM organization_licenses l
        WHERE l.organization_id = o.id AND (l.valid_until IS NULL OR l.valid_until >= (now() AT TIME ZONE 'Europe/Zurich')::date)) AS licenses -- real time: licenses are contracts in real time
    FROM organizations o WHERE o.id = ${orgId}::uuid
  `)).rows as { modules: unknown; licenses: unknown }[];
  return rows.length ? resolveModules(rows[0].modules, rows[0].licenses) : {};
}
