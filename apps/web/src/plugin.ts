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

/** A quick action on the Home page that opens the page (e.g. "Add expense"). */
export interface PageHomeAction {
  /** i18n key of the button text. */
  label: string;
  icon: ReactNode;
  /** The quick action it follows ('time', 'absences', 'timesheet' or another page's section); at the end when unset. */
  after?: string;
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
  /** A core group ('myWork', 'projectTracking', 'organization', 'administration', 'personal') or one of navGroups. */
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
  /** A quick action on the Home page, shown to whoever may open the page. */
  homeAction?: PageHomeAction;
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
  /**
   * Shown inside a core section instead of as a section of its own: 'org.ai' (AI and costs, after the
   * organization's limit; e.g. the Cases providers).
   */
  within?: 'org.ai';
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
  /** The step the action item waits at: its button text (a text key), whether it can be rejected. */
  step?: { key: string; actionKey: string | null; rejectable: boolean } | null;
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

/** A line of the Documents page, as GET organizations/:orgId/documents returns it. */
export interface PluginPersonalDocument {
  documentId: string;
  category: string;
  sourceId: string;
  fileName: string;
  date: string;
  context: Record<string, string | number | null>;
}

/**
 * A document category on the Documents page, for the documents the plugin's API part registers
 * (DocumentsService.registerPersonalDocuments). Its name is the text `documents.category.<category>`.
 */
export interface PluginDocumentCategory {
  category: string;
  color: 'primary' | 'secondary' | 'info' | 'success' | 'warning';
  /** The category it follows in the filter chips; at the end when unset or unknown. */
  after?: string;
  /** Static data the description needs (its labels come as `staticLabel`). */
  staticData?: { entity: string; enum: string };
  /** What the document is about, in one line. */
  describe: (doc: PluginPersonalDocument, ctx: { t: TFunction; locale: Locale; staticLabel: (key: string) => string }) => string;
}

/** What a plugin's team table is built from (TeamView's Team tab). */
export interface PluginTeamTableContext {
  /** The month's rows from the API part's team view (each with `user_id`). */
  rows: unknown[];
  /** yyyy-mm */
  month: string;
  t: TFunction;
  locale: Locale;
  /** The rows of one person. */
  byUser: <T>(rows: T[], userId: string) => T[];
  /** Amounts per currency, as "CHF 12.50 · EUR 3.00" ('—' when none). */
  money: (pairs: [string, number][]) => string;
  /** A date (or timestamp) as the language writes it; '—' when null. */
  date: (iso: string | null) => string;
}

/**
 * The Team tab of a plugin page wrapped in TeamView (`kind` = the API part's ApiTeamView kind): one
 * row per person, the columns from `cells`, and an expandable `details` table (or, with
 * `opensPerson`, a click opens that person on the page itself).
 */
export interface PluginTeamView {
  kind: string;
  opensPerson?: boolean;
  table: (ctx: PluginTeamTableContext) => {
    headers: string[];
    cells: (userId: string) => ReactNode[];
    details?: (userId: string) => ReactNode;
  };
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
  /** Team tables (TeamView) of the plugin's pages. */
  teamViews?: PluginTeamView[];
  /** Document categories on the Documents page. */
  documentCategories?: PluginDocumentCategory[];
  /** @deprecated Not shown since the ZIP export is gone; goes with the next PLUGIN_API_VERSION. */
  backupCounts?: Record<string, string>;
  /** Reports on the Reports page. */
  reports?: PluginReport[];
  /** A notification's source_table -> the section its click opens. */
  notificationSections?: Record<string, string>;
}

export function defineWebPlugin(plugin: WebPlugin): WebPlugin {
  return plugin;
}

// The core's building blocks a plugin may use.
/** Not a production instance: the login shows the demo accounts (VITE_SHOW_DEMO_ACCOUNTS), and plugins may show demo hints. */
export const SHOW_DEMO_HINTS = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS !== 'false';
export { useI18n, useT, LOCALES, type Locale, type TFunction } from './i18n';
export {
  formatDurationMinutes, formatFileSize, formatLocaleDate, formatLocaleDateTime, formatLocaleNumber, formatMoney, formatSignedMinutes, parseLocaleNumber,
  swissLocale,
} from './localeFormat';
export { ConfigFieldGroup, DateInput, useGroupTitle, type FieldOption } from './ConfigField';
export { FieldDesignScope, useFormTemplate, type FormTemplate } from './designMode';
export { DESIGN_PANEL_WIDTH, FormDesignPanel } from './FormDesigner';
export { CollapsibleCard, ConfirmDialog, EmptyState, PageHeader, PersonPicker, TableEmptyRow } from './components';
export { SortHeader, TableSearch, useTableView, type TableColumn, type TableSort, type TableViewState } from './TableView';
export * from './icons';
export { AttachmentView, DropZone, MAX_ATTACHMENT_BYTES, useAttachmentDraft, type Attachment } from './attachments';
export { currencyOptions, type CurrencyOption } from './currencyOptions';
export { SectionPaper } from './SettingsSection';
export { default as TeamView, DetailTable as TeamDetailTable, StatusChip } from './TeamView';
export { totalsByCurrency } from './teamOverview';
// A person's week (project time against attendance and target) and balances, as on the core's pages.
export { default as WeekReport } from './WeekReport';
export { default as BalanceOverview } from './BalanceOverview';
export { default as PersonnelDocumentsPanel } from './PersonnelDocumentsPanel';
