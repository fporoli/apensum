import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger, type Provider, type Type } from '@nestjs/common';
import { registerModule, type ModuleDefinition } from '@worktime3/shared/modules';
import { registerForm } from '@worktime3/shared/fields';
import { registerPermissionObjects, type PermissionObject } from '@worktime3/shared/permissions';
import { namespaceMismatch, pluginApiMismatch, type PluginName } from '@worktime3/shared/pluginApi';
import type { ApiPlugin } from './plugin';
import { registerApiReport } from './report-sources';
import { registerTeamView } from './team-overview.controller';
import { registerBackup, registerPayrollItem } from './import-export.service';

/**
 * Finds the plugins under <repo>/plugins/<id> (a folder with a package.json that has an `apensum`
 * manifest) and loads their API part. A plugin is installed by being there: the bundled ones are
 * in git, a private one is cloned or checked out into the folder (docs/PLUGINS.md). Loaded once,
 * when the app module is imported. A plugin that is there but not built stops the start: missing
 * pages would look like a bug, not like a missing plugin.
 */

export interface PluginManifest {
  id: string;
  /** The plugin API version it was built for (packages/shared/src/pluginApi.ts); must equal the core's. */
  apensumApi: number;
  /** Optional feature module the organization switches on or off (packages/shared/src/modules.ts). */
  module?: ModuleDefinition;
  /**
   * Permission objects the plugin adds to the catalogue (packages/shared/src/permissions.ts). Their
   * `permissions` rows and default grants come from the plugin's Liquibase changelog
   * (`changelog/db.changelog-master.xml`, run after the core's; docs/PLUGINS.md).
   */
  permissions?: PermissionObject[];
  /** Tables the plugin owns in public (introspected into its api/db/schema.ts, apps/api/scripts/plugin-schemas.mjs). */
  tables?: string[];
  /**
   * A Postgres schema the plugin owns with all its tables (created by its changelog), instead of
   * `tables` in public. Its name starts with the plugin's id.
   */
  dbSchema?: string;
  /**
   * Keeps names that do not start with the plugin's id (pluginApi.ts, namespaceMismatch). Only for a
   * plugin carved out of the core with its old names (expenses); a new plugin never sets it.
   */
  legacyNames?: boolean;
  /** Built API entry, relative to the plugin folder; its default export is an ApiPlugin. */
  api?: string;
  /** Web entry (TypeScript source, bundled by Vite; see apps/web/vite.config.ts). */
  web?: string;
}

/** apps/api/{src,dist} -> <repo>/plugins; APENSUM_PLUGINS_DIR overrides it. */
export function pluginsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.APENSUM_PLUGINS_DIR?.trim() || resolve(__dirname, '../../../plugins');
}

/** The manifests of the plugin folders in `dir`, sorted by id. Folders without one are skipped. */
export function readPluginManifests(dir: string): { dir: string; manifest: PluginManifest }[] {
  if (!existsSync(dir)) return [];
  const out: { dir: string; manifest: PluginManifest }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const pkgFile = join(dir, entry.name, 'package.json');
    if (!existsSync(pkgFile)) continue;
    const manifest = (JSON.parse(readFileSync(pkgFile, 'utf8')) as { apensum?: PluginManifest }).apensum;
    if (!manifest) continue;
    if (typeof manifest.id !== 'string' || manifest.id !== entry.name) {
      throw new Error(`plugins/${entry.name}: apensum.id must be the folder name ("${entry.name}")`);
    }
    out.push({ dir: join(dir, entry.name), manifest });
  }
  return out.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

export interface LoadedPlugins {
  ids: string[];
  /** The plugins' API parts, as they export them (PluginRegistrar registers what they declare). */
  plugins: ApiPlugin[];
  controllers: Type<unknown>[];
  providers: Provider[];
}

/** Every name a plugin adds to the core, for the namespace rule (packages/shared/src/pluginApi.ts). */
export function pluginNames(manifest: PluginManifest, plugin: ApiPlugin | undefined): PluginName[] {
  const names: PluginName[] = [];
  if (manifest.module) names.push({ kind: 'module', name: manifest.module.id });
  for (const o of manifest.permissions ?? []) names.push({ kind: 'permission object', name: o.id });
  for (const t of manifest.tables ?? []) names.push({ kind: 'table', name: t });
  // Tables in the plugin's own schema need no prefix: the schema is the namespace.
  if (manifest.dbSchema) names.push({ kind: 'database schema', name: manifest.dbSchema });
  for (const r of plugin?.reports ?? []) names.push({ kind: 'report', name: r.definition.id });
  for (const v of plugin?.teamViews ?? []) names.push({ kind: 'team view', name: v.kind });
  for (const p of plugin?.payroll ?? []) names.push({ kind: 'payroll item', name: p.key });
  for (const c of Object.keys(plugin?.documents ?? {})) names.push({ kind: 'document category', name: c });
  for (const a of Object.keys(plugin?.workflows?.actions ?? {})) names.push({ kind: 'workflow action', name: a });
  for (const t of Object.keys(plugin?.workflows?.sources ?? {})) names.push({ kind: 'workflow source table', name: t });
  for (const f of plugin?.forms ?? []) names.push({ kind: 'form', name: f.id });
  return names;
}

export function loadApiPlugins(dir = pluginsDir()): LoadedPlugins {
  const logger = new Logger('Plugins');
  const loaded: LoadedPlugins = { ids: [], plugins: [], controllers: [], providers: [] };
  for (const { dir: pluginDir, manifest } of readPluginManifests(dir)) {
    const mismatch = pluginApiMismatch(manifest.id, manifest.apensumApi);
    if (mismatch) throw new Error(mismatch);
    if (manifest.dbSchema !== undefined && (manifest.tables?.length ?? 0) > 0) {
      throw new Error(`Plugin ${manifest.id}: use either apensum.tables (in public) or apensum.dbSchema (its own schema), not both`);
    }
    if (manifest.dbSchema !== undefined && (typeof manifest.dbSchema !== 'string' || !/^[a-z][a-z0-9_]*$/.test(manifest.dbSchema) || manifest.dbSchema === 'public')) {
      throw new Error(`Plugin ${manifest.id}: apensum.dbSchema must be a lowercase Postgres schema name other than public`);
    }
    let plugin: ApiPlugin | undefined;
    if (manifest.api) {
      const entry = join(pluginDir, manifest.api);
      if (!existsSync(entry)) throw new Error(`Plugin ${manifest.id} is not built (${entry} is missing): run npm run build --workspace=@worktime3/api`);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      plugin = (require(entry) as { default?: ApiPlugin }).default;
      if (!plugin || plugin.id !== manifest.id) throw new Error(`Plugin ${manifest.id}: ${manifest.api} must export default defineApiPlugin({ id: '${manifest.id}', ... })`);
    }
    // Checked before anything of it is registered: a plugin with foreign names does not start.
    const names = namespaceMismatch(manifest.id, pluginNames(manifest, plugin), manifest.legacyNames);
    if (names) throw new Error(names);
    if (manifest.permissions) registerPermissionObjects(manifest.permissions);
    if (manifest.module) registerModule(manifest.module);
    if (plugin) {
      loaded.plugins.push(plugin);
      loaded.controllers.push(...(plugin.controllers ?? []));
      loaded.providers.push(...(plugin.providers ?? []));
      for (const report of plugin.reports ?? []) registerApiReport(report);
      for (const view of plugin.teamViews ?? []) registerTeamView(view);
      for (const item of plugin.payroll ?? []) registerPayrollItem(item);
      if (plugin.backup) registerBackup(plugin.backup);
      for (const form of plugin.forms ?? []) registerForm(form);
    }
    loaded.ids.push(manifest.id);
  }
  if (loaded.ids.length) logger.log(`Loaded plugins: ${loaded.ids.join(', ')}`);
  return loaded;
}
