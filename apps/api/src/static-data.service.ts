import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';

/** A static data entry as plugins read it: the organization's own copy, else the global one. */
export interface StaticDataEntry { id: string; own: boolean; values: Record<string, unknown>; translation: Record<string, Record<string, string>> }

/**
 * Static data for plugins (the plugin contract), instead of its table: an entry as it applies to the organization
 * (its own copy, else the global row), and changing the organization's own copy (made from the global one first).
 */
@Injectable()
export class StaticDataService {
  async entry(db: Db, orgId: string, entity: string, enumName: string): Promise<StaticDataEntry | null> {
    const [row] = (await db.execute(sql`
      SELECT id, organization_id IS NOT NULL AS own, "values", translation FROM static_data
      WHERE entity = ${entity} AND enum_name = ${enumName} AND (organization_id = ${orgId}::uuid OR organization_id IS NULL)
      ORDER BY organization_id NULLS LAST LIMIT 1`)).rows as { id: string; own: boolean; values: Record<string, unknown> | null; translation: Record<string, Record<string, string>> | null }[];
    return row ? { id: row.id, own: row.own, values: row.values ?? {}, translation: row.translation ?? {} } : null;
  }

  /**
   * Sets the values of the organization's own copy (made from the global row when it has none); returns its id and
   * values, null when there is no such entry. The caller authorized it and records the change.
   */
  async setOwnValues(db: Db, orgId: string, entity: string, enumName: string, change: (values: Record<string, unknown>) => Record<string, unknown>):
    Promise<{ id: string; values: Record<string, unknown> } | null> {
    await db.execute(sql`
      INSERT INTO static_data (organization_id, entity, enum_name, "values", translation)
      SELECT ${orgId}::uuid, entity, enum_name, "values", translation FROM static_data
      WHERE organization_id IS NULL AND entity = ${entity} AND enum_name = ${enumName}
      ON CONFLICT DO NOTHING`);
    const own = await this.entry(db, orgId, entity, enumName);
    if (!own || !own.own) return null;
    const values = change(own.values);
    await db.execute(sql`UPDATE static_data SET "values" = ${JSON.stringify(values)}::jsonb WHERE id = ${own.id}::uuid`);
    return { id: own.id, values };
  }
}
