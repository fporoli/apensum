// Optional modules an organization can switch on or off (Organization settings -> Modules).
//
// A module is a feature area with its own navbar entries. Switching it off hides those entries
// and removes their permissions for everyone in the organization (the API's `permissionIdsOf`
// drops them), so every endpoint gated by those permissions refuses too. The setting lives in
// `organizations.settings.modules` as `{ "<id>": true|false }`; a module missing there takes
// its default, so new modules reach existing organizations without a migration.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

export interface ModuleDefinition {
  id: string;
  /** i18n key of the module's name; the description is `<caption>.description`. */
  caption: string;
  /** Enabled when the organization has not chosen. */
  defaultEnabled: boolean;
  /** Permission objects (packages/shared/src/permissions.ts) that belong to the module. */
  objects: readonly string[];
}

export const MODULES: readonly ModuleDefinition[] = [
  // Requests: tickets to one's line manager or a department (HR, ...), with a message thread.
  { id: 'requests', caption: 'modules.requests', defaultEnabled: true, objects: ['nav.requests'] },
  // Reports: project hours, attendance and overtime, absences, with filters, chart and export.
  { id: 'reports', caption: 'modules.reports', defaultEnabled: true, objects: ['nav.reports'] },
  // Cases & Assessments: Dossier management, interviews/transcripts and standardized assessments for KESB, forensic experts and police.
  { id: 'cases', caption: 'modules.cases', defaultEnabled: false, objects: ['nav.cases'] },
];

export type ModuleSettings = Record<string, boolean>;

/** Every module's state for an organization's `settings.modules` value (anything else = defaults). */
export function resolveModules(stored: unknown): ModuleSettings {
  const chosen = stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Record<string, unknown>) : {};
  const out: ModuleSettings = {};
  for (const m of MODULES) out[m.id] = typeof chosen[m.id] === 'boolean' ? (chosen[m.id] as boolean) : m.defaultEnabled;
  return out;
}

/** Validates a modules patch: known ids with boolean values. */
export function validateModules(body: unknown): { ok: true; modules: ModuleSettings } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'invalid-modules' };
  const out: ModuleSettings = {};
  for (const [id, value] of Object.entries(body as Record<string, unknown>)) {
    if (!MODULES.some((m) => m.id === id)) return { ok: false, error: 'unknown-module' };
    if (typeof value !== 'boolean') return { ok: false, error: 'invalid-modules' };
    out[id] = value;
  }
  return { ok: true, modules: out };
}

/** Permission objects of the modules switched off. */
export function disabledObjects(modules: ModuleSettings): Set<string> {
  const out = new Set<string>();
  for (const m of MODULES) if (modules[m.id] === false) for (const o of m.objects) out.add(o);
  return out;
}

/** `ids` without the permissions of switched-off modules. */
export function withoutDisabledModules(ids: Set<string>, modules: ModuleSettings): Set<string> {
  const off = disabledObjects(modules);
  if (off.size === 0) return ids;
  return new Set([...ids].filter((id) => !off.has(id.split(':')[0])));
}
