import PLUGINS from 'virtual:apensum-plugins';
import { DICTIONARIES, type Locale } from './dictionaries';
import type { PluginNavGroup, PluginPage, PluginPublicRoute, PluginSettingsSection, PluginWorkflowKind, WebPlugin } from './plugin';

/**
 * The web parts of the installed plugins (plugins/<id>, found by vite.config.ts at build time) and
 * what they add, collected once. Their texts join the dictionaries here, before anything renders.
 */
export const WEB_PLUGINS: readonly WebPlugin[] = PLUGINS;

export function mergePluginTexts(plugins: readonly WebPlugin[], dictionaries: Record<Locale, Record<string, string>>): void {
  for (const plugin of plugins) {
    for (const [locale, texts] of Object.entries(plugin.texts ?? {}) as [Locale, Record<string, string>][]) {
      if (dictionaries[locale]) Object.assign(dictionaries[locale], texts);
    }
  }
}

mergePluginTexts(WEB_PLUGINS, DICTIONARIES);

export const PLUGIN_PAGES: readonly PluginPage[] = WEB_PLUGINS.flatMap((p) => p.pages ?? []);
export const PLUGIN_NAV_GROUPS: readonly PluginNavGroup[] = WEB_PLUGINS.flatMap((p) => p.navGroups ?? []);
export const PLUGIN_ORG_SETTINGS: readonly PluginSettingsSection[] = WEB_PLUGINS.flatMap((p) => p.orgSettings ?? []);
export const PLUGIN_PUBLIC_ROUTES: readonly PluginPublicRoute[] = WEB_PLUGINS.flatMap((p) => p.publicRoutes ?? []);
export const PLUGIN_WORKFLOW_KINDS: readonly PluginWorkflowKind[] = WEB_PLUGINS.flatMap((p) => p.workflowKinds ?? []);
export const PLUGIN_NOTIFICATION_SECTIONS: Readonly<Record<string, string>> = Object.assign({}, ...WEB_PLUGINS.map((p) => p.notificationSections ?? {}));
