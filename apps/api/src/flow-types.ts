import { and, eq, isNull } from 'drizzle-orm';
import { withFlowType } from '@worktime3/shared/flows';
import type { Db } from './db.service';
import type { VersionsService } from './versions.service';
import { static_data } from './db/schema';

/**
 * Adds or renames one of the organization's flow types (static_data flows/flow_type): in the organization's copy, made
 * from the list for all organizations when it has none, with its history. The caller checked who may (the Flow-Designer,
 * or a trigger's Vorlage for whoever sets up its event).
 */
export async function saveFlowType(
  db: Db, versions: VersionsService, orgId: string, callerId: string, key: string, names: unknown, confidential: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const where = (org: boolean) => and(eq(static_data.entity, 'flows'), eq(static_data.enum_name, 'flow_type'), org ? eq(static_data.organization_id, orgId) : isNull(static_data.organization_id));
  const [own] = await db.select().from(static_data).where(where(true));
  const [global] = own ? [] : await db.select().from(static_data).where(where(false));
  const base = own ?? global;
  const next = withFlowType(base ? { values: base.values, translation: base.translation as Record<string, Record<string, string>> | null } : null, key, names, confidential);
  if ('error' in next) return { ok: false, error: next.error };
  if (own) {
    await db.update(static_data).set(next).where(eq(static_data.id, own.id));
    void versions.record('static_data', own.id, 'update_delta', callerId, next).catch(() => {});
  } else {
    const row = { organization_id: orgId, entity: 'flows', enum_name: 'flow_type', ...next };
    const [created] = await db.insert(static_data).values(row).returning({ id: static_data.id });
    void versions.record('static_data', created.id, 'insert', callerId, { id: created.id, ...row }).catch(() => {});
  }
  return { ok: true };
}
