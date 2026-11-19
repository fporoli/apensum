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
