import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger, type Provider, type Type } from '@nestjs/common';
import { registerModule, type ModuleDefinition } from '@worktime3/shared/modules';
import type { ApiPlugin } from './plugin';

/**
 * Finds the plugins under <repo>/plugins/<id> (a folder with a package.json that has an `apensum`
 * manifest) and loads their API part. A plugin is installed by being there: the bundled ones are
 * in git, a private one is cloned or checked out into the folder (docs/PLUGINS.md). Loaded once,
 * when the app module is imported. A plugin that is there but not built stops the start: missing
 * pages would look like a bug, not like a missing plugin.
 */

export interface PluginManifest {
  id: string;
  /** Optional feature module the organization switches on or off (packages/shared/src/modules.ts). */
  module?: ModuleDefinition;
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
  controllers: Type<unknown>[];
  providers: Provider[];
}

export function loadApiPlugins(dir = pluginsDir()): LoadedPlugins {
  const logger = new Logger('Plugins');
  const loaded: LoadedPlugins = { ids: [], controllers: [], providers: [] };
  for (const { dir: pluginDir, manifest } of readPluginManifests(dir)) {
    if (manifest.module) registerModule(manifest.module);
    if (manifest.api) {
      const entry = join(pluginDir, manifest.api);
      if (!existsSync(entry)) throw new Error(`Plugin ${manifest.id} is not built (${entry} is missing): run npm run build --workspace=@worktime3/api`);
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require(entry) as { default?: ApiPlugin };
      const plugin = mod.default;
      if (!plugin || plugin.id !== manifest.id) throw new Error(`Plugin ${manifest.id}: ${manifest.api} must export default defineApiPlugin({ id: '${manifest.id}', ... })`);
      loaded.controllers.push(...(plugin.controllers ?? []));
      loaded.providers.push(...(plugin.providers ?? []));
    }
    loaded.ids.push(manifest.id);
  }
  if (loaded.ids.length) logger.log(`Loaded plugins: ${loaded.ids.join(', ')}`);
  return loaded;
}
