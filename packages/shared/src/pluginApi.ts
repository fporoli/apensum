// The version of the plugin contract (docs/PLUGINS.md): `@worktime3/api/plugin`,
// `@worktime3/web/plugin`, the manifest and the tables of `@worktime3/api/schema` that plugins use.
// A plugin states the version it was built for in its package.json (`apensum.apensumApi`); the API's
// loader, the web build (vite.config.ts) and scripts/plugins.mjs refuse a plugin that states none or
// another one, so a private plugin fails loudly at start instead of breaking at some later call.
//
// Bump it when a change can break a plugin that compiled against the previous one: something removed
// or renamed, or a type or behavior a plugin relies on changed. Additions (a new optional field, a
// new export) do not bump it.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node scripts and tests can load it.

export const PLUGIN_API_VERSION = 1;

/** Why a plugin's manifest does not fit this core, or null when it does. */
export function pluginApiMismatch(id: string, declared: unknown): string | null {
  if (declared === undefined || declared === null) {
    return `Plugin ${id}: package.json apensum.apensumApi is missing (this core provides plugin API ${PLUGIN_API_VERSION})`;
  }
  if (declared !== PLUGIN_API_VERSION) {
    return `Plugin ${id} was built for plugin API ${String(declared)}, this core provides ${PLUGIN_API_VERSION}: update the plugin (or the core)`;
  }
  return null;
}

/**
 * A name a plugin adds (a table, a permission object, a report, a page, ...) and what kind of name
 * it is, for `namespaceViolations`.
 */
export interface PluginName {
  kind: string;
  name: string;
}

/**
 * The names that do not start with the plugin's id, so two plugins (or a plugin and the core)
 * cannot collide: `cases`, `cases_documents`, `casesArchive`, `cases.approve`, and for permission
 * objects the part after `nav.` / `section.` (`nav.cases`, `section.cases.notes`). A plugin carved
 * out of the core keeps its old names with `apensum.legacyNames: true` (the bundled expenses plugin);
 * a new plugin never sets it.
 */
export function namespaceViolations(id: string, names: readonly PluginName[]): PluginName[] {
  const owned = (name: string) => {
    const bare = /^(nav|section)\./.test(name) ? name.replace(/^(nav|section)\./, '') : name;
    return bare === id || (bare.startsWith(id) && /^[._A-Z-]/.test(bare.slice(id.length)));
  };
  return names.filter((n) => !owned(n.name));
}

/** The error for a plugin whose names are not its own, or null. */
export function namespaceMismatch(id: string, names: readonly PluginName[], legacyNames: unknown): string | null {
  if (legacyNames === true) return null;
  const bad = namespaceViolations(id, names);
  if (bad.length === 0) return null;
  return `Plugin ${id}: these names must start with "${id}" (docs/PLUGINS.md, "Names"): ${bad.map((n) => `${n.kind} ${n.name}`).join(', ')}`;
}
