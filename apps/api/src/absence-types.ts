import { and, eq, isNull, or } from 'drizzle-orm';
import type { Db } from './db.service';
import { static_data } from './db/schema';

/**
 * Absence types live only in static_data (entity "absences", enum_name "absence_type"): the org's
 * own row, else the global one (inserted by 047-absence-approval-flag.sql). `values` maps each type
 * key to its attributes, e.g. `{"vacation": {}, "sickness": {"approval": false}}`; labels are in
 * `translation`.
 */
export interface AbsenceTypeAttributes {
  /** false: the absence is approved on submit and the manager is notified instead of asked. */
  approval?: boolean;
  /** true: unpaid leave (payroll's unpaid hours, and it cuts the vacation entitlement). */
  unpaid?: boolean;
}

/**
 * The org's absence types as the static_data `values` object (type key -> attributes such as
 * `{approval: false}`): its own override if set, else the global row (`organization_id IS NULL`).
 * No row means no types.
 */
export async function resolveAbsenceTypes(db: Db, orgId: string): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ organization_id: static_data.organization_id, values: static_data.values })
    .from(static_data)
    .where(
      and(
        or(eq(static_data.organization_id, orgId), isNull(static_data.organization_id)),
        eq(static_data.entity, 'absences'),
        eq(static_data.enum_name, 'absence_type'),
      ),
    );
  const picked = rows.find((r) => r.organization_id === orgId) ?? rows.find((r) => r.organization_id === null);
  if (picked?.values && typeof picked.values === 'object' && !Array.isArray(picked.values)) return picked.values as Record<string, unknown>;
  return {};
}

/** The keys of the types marked unpaid, given the row's `values`. */
export function unpaidAbsenceTypes(values: Record<string, unknown>): Set<string> {
  return new Set(
    Object.entries(values)
      .filter(([, a]) => a !== null && typeof a === 'object' && !Array.isArray(a) && (a as AbsenceTypeAttributes).unpaid === true)
      .map(([key]) => key),
  );
}

/** Whether an absence of this type goes to the manager for approval, given the row's `values`. */
export function absenceNeedsApproval(values: Record<string, unknown>, type: string): boolean {
  const attributes = values[type];
  if (attributes && typeof attributes === 'object' && !Array.isArray(attributes)) {
    return (attributes as AbsenceTypeAttributes).approval !== false;
  }
  return true;
}
