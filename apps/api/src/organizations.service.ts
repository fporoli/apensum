import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Db } from './db.service';
import { resolveModules } from '@worktime3/shared/modules';
import { modulesOf } from './modules-of';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/**
 * Organizations for plugins (the plugin contract), instead of their tables: one by id or by its public slug, which
 * modules are on (switched on and licensed), and a plugin's own part of the settings (`settings.<key>`).
 */
@Injectable()
export class OrganizationsService {
  async get(db: Db, orgId: string): Promise<{ id: string; name: string; slug: string } | null> {
    if (!UUID.test(orgId)) return null;
    const [row] = (await db.execute(sql`SELECT id, name, slug FROM organizations WHERE id = ${orgId}::uuid`)).rows as { id: string; name: string; slug: string }[];
    return row ?? null;
  }

  async bySlug(db: Db, slug: string): Promise<{ id: string; name: string; slug: string } | null> {
    if (!SLUG.test(slug)) return null;
    const [row] = (await db.execute(sql`SELECT id, name, slug FROM organizations WHERE slug = ${slug}`)).rows as { id: string; name: string; slug: string }[];
    return row ?? null;
  }

  /** Which modules are on in the organization: switched on, and licensed where they need a license. */
  modules(db: Db, orgId: string): Promise<Record<string, boolean>> {
    return modulesOf(db, orgId);
  }

  async moduleOn(db: Db, orgId: string, module: string): Promise<boolean> {
    return (await modulesOf(db, orgId))[module] === true;
  }

  /** A plugin's part of the organization's settings (`settings -> key`), as stored; undefined when none. */
  async settingsOf(db: Db, orgId: string, key: string): Promise<unknown> {
    const [row] = (await db.execute(sql`SELECT settings -> ${key} AS value FROM organizations WHERE id = ${orgId}::uuid`)).rows as { value: unknown }[];
    return row?.value ?? undefined;
  }

  /** Sets a plugin's part of the settings (`settings.<key>`, the whole of it; null removes it). The caller authorized it. */
  async setSettingsOf(db: Db, orgId: string, key: string, value: unknown): Promise<void> {
    if (!UUID.test(orgId) || !/^[a-zA-Z][\w-]{0,40}$/.test(key)) throw new Error(`invalid settings key ${key}`);
    if (value === null) {
      await db.execute(sql`UPDATE organizations SET settings = COALESCE(settings, '{}'::jsonb) - ${key} WHERE id = ${orgId}::uuid`);
      return;
    }
    await db.execute(sql`UPDATE organizations SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), ARRAY[${key}]::text[], ${JSON.stringify(value)}::jsonb)
      WHERE id = ${orgId}::uuid`);
  }

  /** The organizations where a module is on (switched on and, where it needs one, licensed): e.g. for a nightly job. */
  async withModuleOn(db: Db, module: string): Promise<string[]> {
    const rows = (await db.execute(sql`
      SELECT o.id, o.settings -> 'modules' AS modules,
        (SELECT jsonb_agg(l.module_id) FROM organization_licenses l
          WHERE l.organization_id = o.id AND (l.valid_until IS NULL OR l.valid_until >= (now() AT TIME ZONE 'Europe/Zurich')::date)) AS licenses -- real time: licenses are contracts in real time
      FROM organizations o`)).rows as { id: string; modules: unknown; licenses: unknown }[];
    return rows.filter((r) => resolveModules(r.modules, r.licenses)[module] === true).map((r) => r.id);
  }
}
