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

// 2: instanceCaseClient, aiClient, aiModel and aiProvider removed (AI is Azure OpenAI in Switzerland only).
// 3: requests are flows: RequestsService is FlowsService (its error 'requests-off' is 'flows-off'), the tables
//    requests/request_messages are flows/flow_messages (@worktime3/api/schema), the module and permission object are
//    flows/nav.flows; the deprecated ApiPlugin.backup is gone.
export const PLUGIN_API_VERSION = 3;

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

/** A plugin's id and the plugins it needs (`apensum.requires`), for `pluginOrder`. */
export interface PluginRequires {
  id: string;
  requires?: unknown;
}

/**
 * The order the plugins load, migrate and seed in: a plugin after the plugins it requires (package.json
 * `apensum.requires`: their ids), otherwise by id (as before `requires` existed). The error when one is not
 * installed (`billing` requires `expenses`: without it, Billing's queries of the expense tables would fail at
 * some later call), when `requires` is not a list of ids, or when plugins require each other in a circle.
 */
export function pluginOrder(plugins: readonly PluginRequires[]): { order: string[] } | { error: string } {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const needs = new Map<string, string[]>();
  for (const p of plugins) {
    const r = p.requires;
    if (r !== undefined && (!Array.isArray(r) || r.some((x) => typeof x !== 'string' || !x))) {
      return { error: `Plugin ${p.id}: apensum.requires must be a list of plugin ids` };
    }
    const list = [...new Set((r as string[] | undefined) ?? [])];
    if (list.includes(p.id)) return { error: `Plugin ${p.id}: apensum.requires names the plugin itself` };
    const missing = list.filter((id) => !byId.has(id));
    if (missing.length) return { error: `Plugin ${p.id} requires ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not installed (plugins/<id>, docs/PLUGINS.md)` };
    needs.set(p.id, list);
  }
  // Each step: the first plugin by id whose required plugins are all placed (so without `requires`, plain id order).
  const order: string[] = [];
  const left = new Set([...byId.keys()].sort());
  while (left.size) {
    const next = [...left].find((id) => needs.get(id)!.every((dep) => !left.has(dep)));
    if (!next) return { error: `Plugins require each other in a circle: ${circle(needs, left)}` };
    order.push(next);
    left.delete(next);
  }
  return { order };
}

/** A circle among the plugins `left` (each requires one of the others), as "a -> b -> a". */
function circle(needs: Map<string, string[]>, left: Set<string>): string {
  const path: string[] = [];
  let id = [...left][0];
  while (!path.includes(id)) {
    path.push(id);
    id = needs.get(id)!.find((dep) => left.has(dep))!;
  }
  return [...path.slice(path.indexOf(id)), id].join(' -> ');
}

/** `list` sorted by `pluginOrder` of its manifests; throws its error. */
export function inPluginOrder<T extends { manifest: PluginRequires }>(list: readonly T[]): T[] {
  const result = pluginOrder(list.map((p) => p.manifest));
  if ('error' in result) throw new Error(result.error);
  const index = new Map(result.order.map((id, i) => [id, i]));
  return [...list].sort((a, b) => index.get(a.manifest.id)! - index.get(b.manifest.id)!);
}
