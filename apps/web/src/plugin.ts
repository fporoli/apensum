/**
 * The web app's plugin contract (`@worktime3/web/plugin`): what a plugin's web part
 * (plugins/<id>/web, entry = package.json `apensum.web`) may use from the core, and the shape its
 * default export has. A plugin imports the core only from here; plugins.ts registers what the
 * plugins declare, App.tsx, main.tsx and OrganizationSettings.tsx show it. docs/PLUGINS.md.
 */
import type { ComponentType, ReactNode } from 'react';
import type { ReportDefinition } from '@worktime3/shared/reports';
import type { Locale, TFunction } from './i18n';

export interface PluginRoles {
  isAdmin: boolean;
  isManager: boolean;
  isHr: boolean;
  isBillingAdmin: boolean;
}

export interface PluginPageContext {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
  /** Permission ids the caller holds in this organization; null until loaded (or offline). */
  permissions: Set<string> | null;
  roles: PluginRoles;
  /** Opens another page by its section id (core or plugin). */
  navigate: (section: string) => void;
}

/** What a navbar count (`PageNav.badge`) is loaded with. */
export interface PluginBadgeContext<R extends PluginRoles = PluginRoles> {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  permissions: Set<string> | null;
  roles: R;
}

/** A page's navbar entry. */
export interface PageNav<R extends PluginRoles = PluginRoles> {
  /** A core group ('myWork', 'projectTracking', 'cases', 'organization', 'administration', 'personal') or one of navGroups. */
  group: string;
  /** i18n key of the label. */
  label: string;
  icon?: ReactNode;
  /** The entry (section) it follows in its group, or among its parent's sub-entries; at the end when unknown. */
  after?: string;
  /** Shows it as a sub-entry of another page's entry (that page's section), e.g. Users -> Invitations. */
  parent?: string;
  /** Shown while the caller may open one of its sub-entries, even when not the page itself. */
  showForChildren?: boolean;
  /** A count next to the entry (e.g. items waiting); loaded while the page is allowed, again on every notification. */
  badge?: (ctx: PluginBadgeContext<R>) => Promise<number>;
}

/**
 * A page of the app. The core's pages (corePages.tsx) and the plugins' use the same shape; the core's
 * get a richer context (C).
 */
export interface PluginPage<C extends PluginPageContext = PluginPageContext> {
  /** Section id, unique across the app (e.g. 'expenses'). */
  section: string;
  /** Location hash, e.g. '#/expenses'. */
  hash: string;
  /** Permission object behind the page (packages/shared/src/permissions.ts), e.g. 'nav.expenses'; none = everyone. */
  object?: string;
  /** Who may open it before permissions have loaded or when the API is offline; default everyone. */
  allowedByRole?: (roles: C['roles']) => boolean;
  nav?: PageNav<C['roles']>;
  render: (ctx: C) => ReactNode;
}

export interface PluginNavGroup {
  id: string;
  /** i18n key of the heading. */
  header: string;
  /** The group it follows (a core group id); at the end of the navbar when unknown. */
  after: string;
}

export interface PluginSettingsSection {
  /** SettingsSection id (remembers whether it is open), e.g. 'org.exchangeRates'. */
  id: string;
  title: (t: TFunction) => string;
  subtitle?: (t: TFunction, org: { defaultCurrency: string }) => string;
  render: (ctx: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) => ReactNode;
}

/** A page opened without signing in (e.g. a phone opening a QR code): `match` reads the location hash. */
export interface PluginPublicRoute {
  match: (hash: string) => unknown;
  render: (match: unknown) => ReactNode;
}

/** The record a workflow action item is about, as GET workflows/assigned-to-me returns it. */
export interface PluginWorkflowRecord {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  [field: string]: unknown;
}

export interface PluginWorkflowInspectProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  record: PluginWorkflowRecord;
  /** The open action item (approve/reject offered), or null when only looking. */
  actionItemId: string | null;
  onClose: () => void;
  /** Closes the dialog and approves / asks for the rejection note, as the Workflow page does. */
  onApprove: (actionItemId: string) => void;
  onReject: (actionItemId: string) => void;
}

/** An approval kind on the Workflow page (Approvals.tsx) that a plugin owns. */
export interface PluginWorkflowKind {
  /** The workflow definition's name, e.g. 'approve expense report'. */
  definitionName: string;
  /** The action item's field that holds the record, e.g. 'expense_report'. */
  recordField: string;
  /** The kind's chip. */
  label: (t: TFunction) => string;
  /** The API's (English) source label it replaces, e.g. 'Expense Report', and its translation. */
  source?: { name: string; label: (t: TFunction) => string };
  /** The record's title in the "related object" column (the API's source_name, e.g. 'getExpenseReportTitle'). */
  title?: { sourceName: string; get: (record: PluginWorkflowRecord) => string | null };
  /** The "Inspect" dialog; without it the item has no Inspect button. */
  Inspect?: ComponentType<PluginWorkflowInspectProps & { open: boolean }>;
}

/**
 * A report on the Reports page: the same definition and texts as the plugin's API part registers
 * with its rows (share them in one file, e.g. plugins/<id>/shared). Texts: `reports.report.<id>`,
 * `reports.report.<id>.description`, `reports.note.<id>`, `reports.dim.<dim>`, `reports.measure.<key>`.
 */
export interface PluginReport {
  definition: ReportDefinition;
  texts?: Partial<Record<Locale, Record<string, string>>>;
}

export interface WebPlugin {
  id: string;
  /** The plugin's UI texts per language; every language the same keys (the plugin's tests check it). */
  texts?: Record<Locale, Record<string, string>>;
  pages?: PluginPage[];
  navGroups?: PluginNavGroup[];
  /** Sections on Organization settings (shown after the core's work-time section). */
  orgSettings?: PluginSettingsSection[];
  publicRoutes?: PluginPublicRoute[];
  /** Approval kinds the plugin owns on the Workflow page. */
  workflowKinds?: PluginWorkflowKind[];
  /** Reports on the Reports page. */
  reports?: PluginReport[];
  /** A notification's source_table -> the section its click opens. */
  notificationSections?: Record<string, string>;
}

export function defineWebPlugin(plugin: WebPlugin): WebPlugin {
  return plugin;
}

// The core's building blocks a plugin may use.
export { useI18n, useT, LOCALES, type Locale, type TFunction } from './i18n';
export {
  formatFileSize, formatLocaleDate, formatLocaleDateTime, formatLocaleNumber, formatMoney, parseLocaleNumber, swissLocale,
} from './localeFormat';
export { ConfigFieldGroup, useGroupTitle, type FieldOption } from './ConfigField';
export { FieldDesignScope, useFormTemplate } from './designMode';
export { DESIGN_PANEL_WIDTH, FormDesignPanel } from './FormDesigner';
export { ConfirmDialog, EmptyState, PageHeader, PersonPicker, TableEmptyRow } from './components';
export * from './icons';
export { AttachmentView, DropZone, MAX_ATTACHMENT_BYTES, useAttachmentDraft, type Attachment } from './attachments';
export { currencyOptions, type CurrencyOption } from './currencyOptions';
export { SectionPaper } from './SettingsSection';
export { default as TeamView } from './TeamView';
