/**
 * Rules for the default static data (global rows, `organization_id` NULL) that operators edit (Super Admin -> Default
 * lists, operator-static-data.controller.ts). A global row's keys come from migrations (built in: the code relies on
 * them) or from operators (`static_data.operator_keys`, 103). Operators add values, change or remove the ones they
 * added and change any translation; a built-in value stays exactly as the migration left it. Pure.
 */

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** JSON with sorted keys, so two equal values compare equal whatever order jsonb returned them in. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** The keys of a global row that came from migrations. */
export function builtInKeys(row: { values: unknown; operator_keys?: readonly string[] | null }): string[] {
  const own = new Set(row.operator_keys ?? []);
  return Object.keys(isObject(row.values) ? row.values : {}).filter((k) => !own.has(k));
}

/**
 * An operator's new values for a global row (`existing` null = a new list): the operator keys to store, or the
 * built-in key that was changed or removed.
 */
export function checkDefaultValues(
  existing: { values: unknown; operator_keys?: readonly string[] | null } | null,
  next: unknown,
): { ok: true; values: Record<string, unknown>; operatorKeys: string[] } | { ok: false; error: 'invalid-values' } | { ok: false; error: 'built-in-value'; key: string } {
  if (!isObject(next)) return { ok: false, error: 'invalid-values' };
  const builtIn = existing ? builtInKeys(existing) : [];
  const old = existing && isObject(existing.values) ? existing.values : {};
  for (const key of builtIn) {
    if (!(key in next) || canonical(next[key]) !== canonical(old[key])) return { ok: false, error: 'built-in-value', key };
  }
  return { ok: true, values: next, operatorKeys: Object.keys(next).filter((k) => !builtIn.includes(k)).sort() };
}
