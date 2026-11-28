import PLUGINS, { manifests as PLUGIN_MANIFESTS, permissions as PLUGIN_PERMISSIONS } from 'virtual:apensum-plugins';
import { namespaceMismatch, type PluginName } from '@worktime3/shared/pluginApi';
import { registerPermissionObjects } from '@worktime3/shared/permissions';
import { registerReport } from '@worktime3/shared/reports';
import { DICTIONARIES, type Locale } from './dictionaries';
import { CORE_WORKFLOW_KINDS } from './coreWorkflowKinds';
import type { PluginDocumentCategory, PluginTeamView, PluginNavGroup, PluginPage, PluginProjectDialog, PluginPublicRoute, PluginSettingsSection, PluginWorkflowKind, WebPlugin } from './plugin';

/**
 * The web parts of the installed plugins (plugins/<id>, found by vite.config.ts at build time) and
 * what they add, collected once. Their texts join the dictionaries here, before anything renders.
 */
export const WEB_PLUGINS: readonly WebPlugin[] = PLUGINS;

/** Every name a plugin's web part adds, for the namespace rule (the API part checks its own). */
export function webPluginNames(plugin: WebPlugin): PluginName[] {
  return [
    ...(plugin.pages ?? []).map((p) => ({ kind: 'page', name: p.section })),
    ...(plugin.navGroups ?? []).map((g) => ({ kind: 'nav group', name: g.id })),
    ...(plugin.documentCategories ?? []).map((c) => ({ kind: 'document category', name: c.category })),
    ...(plugin.teamViews ?? []).map((v) => ({ kind: 'team view', name: v.kind })),
    ...(plugin.reports ?? []).map((r) => ({ kind: 'report', name: r.definition.id })),
    ...(plugin.workflowKinds ?? []).map((k) => ({ kind: 'workflow record field', name: k.recordField })),
  ];
}

for (const plugin of WEB_PLUGINS) {
  const legacy = PLUGIN_MANIFESTS.find((m) => m.id === plugin.id)?.legacyNames;
  const mismatch = namespaceMismatch(plugin.id, webPluginNames(plugin), legacy);
  if (mismatch) throw new Error(mismatch);
}

export function mergePluginTexts(plugins: readonly WebPlugin[], dictionaries: Record<Locale, Record<string, string>>): void {
  for (const plugin of plugins) {
    for (const [locale, texts] of Object.entries(plugin.texts ?? {}) as [Locale, Record<string, string>][]) {
      if (dictionaries[locale]) Object.assign(dictionaries[locale], texts);
    }
    for (const report of plugin.reports ?? []) {
      for (const [locale, texts] of Object.entries(report.texts ?? {}) as [Locale, Record<string, string>][]) {
        if (dictionaries[locale]) Object.assign(dictionaries[locale], texts);
      }
    }
  }
}

mergePluginTexts(WEB_PLUGINS, DICTIONARIES);
// The plugins' permission objects join the catalogue (roles editor, what owners hand out) as the API's do.
registerPermissionObjects(PLUGIN_PERMISSIONS);
// Their reports join the Reports page's tabs (the API registers the same definitions with their rows).
for (const report of WEB_PLUGINS.flatMap((p) => p.reports ?? [])) registerReport(report.definition);

export const PLUGIN_PAGES: readonly PluginPage[] = WEB_PLUGINS.flatMap((p) => p.pages ?? []);
export const PLUGIN_NAV_GROUPS: readonly PluginNavGroup[] = WEB_PLUGINS.flatMap((p) => p.navGroups ?? []);
export const PLUGIN_ORG_SETTINGS: readonly PluginSettingsSection[] = WEB_PLUGINS.flatMap((p) => p.orgSettings ?? []);
export const PLUGIN_PROJECT_DIALOGS: readonly PluginProjectDialog[] = WEB_PLUGINS.flatMap((p) => p.projectDialog ?? []);
export const PLUGIN_PUBLIC_ROUTES: readonly PluginPublicRoute[] = WEB_PLUGINS.flatMap((p) => p.publicRoutes ?? []);
/**
 * The flow kinds the Flows page shows with their own record, label and review dialog: the core's that work like a
 * plugin's (a change of personal data, coreWorkflowKinds.tsx) and the plugins'.
 */
export const PLUGIN_WORKFLOW_KINDS: readonly PluginWorkflowKind[] = [...CORE_WORKFLOW_KINDS, ...WEB_PLUGINS.flatMap((p) => p.workflowKinds ?? [])];
export const PLUGIN_TEAM_VIEWS: readonly PluginTeamView[] = WEB_PLUGINS.flatMap((p) => p.teamViews ?? []);
export const PLUGIN_DOCUMENT_CATEGORIES: readonly PluginDocumentCategory[] = WEB_PLUGINS.flatMap((p) => p.documentCategories ?? []);
export const PLUGIN_NOTIFICATION_SECTIONS: Readonly<Record<string, string>> = Object.assign({}, ...WEB_PLUGINS.map((p) => p.notificationSections ?? {}));
