/**
 * The API's plugin contract (`@worktime3/api/plugin`): what a plugin under plugins/<id>/api may use
 * from the core, and the shape it exports. A plugin imports the core only from here and from
 * `@worktime3/api/schema` (the tables), never from other core files, so the core can change
 * everything else freely. plugins.ts loads the plugins; docs/PLUGINS.md describes the layout.
 *
 * Plugins are compiled against this file's declarations (dist/plugin.d.ts) and load its built
 * code at runtime through the workspace link, so they share the core's class instances (Nest
 * injects the same DbService, exception classes match).
 */
import type { Provider, Type } from '@nestjs/common';
import type { ApiReport } from './report-sources';
import type { ApiTeamView } from './team-overview.controller';
import type { ApiPayrollItem } from './import-export.service';
import type { FormDef } from '@worktime3/shared/fields';
import type { Db } from './db.service';
import type { AuditService } from './audit.service';
import type { VersionsService } from './versions.service';
import type { NotificationsService } from './notifications.service';
import type { PersonalDocumentSource } from './documents.service';
import type { SourceOrgResolver, SourceRecordLoader, WorkflowActionContext, WorkflowKind } from './workflows.service';
import type { AssistantTool } from './assistant-tools';
import type { PlannedMinutesSource } from './work-time-model.service';
import type { TriggerSource } from './triggers';
import type { BillableSource } from './billables.service';

/** Core services a plugin's declared functions get as their last argument. */
export interface PluginCore {
  versions: VersionsService;
  audit: AuditService;
  /** The bell (and its live push): e.g. telling people what a workflow step did to their records. */
  notifications: NotificationsService;
}

/**
 * A plugin's approvals (workflows run by WorkflowsService, shown on the Workflow page with the web
 * part's `workflowKinds`).
 */
export interface ApiPluginWorkflows {
  /** What a step's `onApprove`/`onReject` action does to the record, by action name (e.g. 'expense.approve'). */
  actions?: Record<string, (db: Db, ctx: WorkflowActionContext, core: PluginCore) => Promise<void>>;
  /**
   * Per source table of the plugin's workflows: what the Workflow page shows of a record under `field`.
   * `organization` is no longer read (each workflow row holds its organization, core changeset 107).
   */
  sources?: Record<string, { /** @deprecated not read since core changeset 107 */ organization?: SourceOrgResolver; records?: { field: string; load: SourceRecordLoader } }>;
  /** Workflow definition names that go to the person's manager and follow them when the manager changes. */
  managerRouted?: string[];
  /**
   * Configurable kinds (shared/workflowConfig.ts): the building blocks and facts an organization's owner arranges
   * into its own steps (Admin settings -> Workflows); started with `WorkflowsService.start`.
   */
  kinds?: WorkflowKind[];
}

export interface ApiPlugin {
  /** The plugin's id, as in its package.json `apensum.id`. */
  id: string;
  /** Nest controllers, registered in the app module beside the core's (global prefix api/v1). */
  controllers?: Type<unknown>[];
  /** Nest providers; they may inject any core service exported below. */
  providers?: Provider[];
  /**
   * Reports on the Reports page (and in saved and scheduled reports): definition and texts, shared
   * with the plugin's web part, and the rows. The core checks who may see whom first.
   */
  reports?: ApiReport[];
  /**
   * Team tables (the Team tab of the plugin's pages, TeamView): whose records the permission object
   * decides, the core checks it; the rows come from here.
   */
  teamViews?: ApiTeamView[];
  /** Amounts on the payroll export (Import/Export), per person and month: e.g. approved expenses. */
  payroll?: ApiPayrollItem[];
  /**
   * A shift plan's minutes per day for a person (e.g. the roster's published months): such a day's target is the
   * plan's instead of the work schedule's (a day off = 0); days with an approved absence keep the schedule's.
   * Only for days the plan decides: a day left out keeps the schedule. WorkTimeModelService.model reads it.
   */
  plannedMinutes?: PlannedMinutesSource;
  /** Approvals: workflow actions, source tables and manager routing. */
  workflows?: ApiPluginWorkflows;
  /**
   * Configurable forms (docs/FIELD_CONFIG.md): their templates (field_config, by form id) then work as
   * the core's do. The web part renders them with useFormTemplate and the same definition.
   */
  forms?: FormDef[];
  /** A person's own documents on the Documents page, by category (e.g. `expense` receipts). */
  documents?: Record<string, PersonalDocumentSource>;
  /**
   * Tools for the AI assistant (names start with the plugin's id). Each calls the plugin's own
   * controller method as the caller (`ctx.get(Controller)`, `ctx.req`), so it runs the endpoint's checks.
   */
  assistantTools?: AssistantTool[];
  /**
   * Whether the plugin reminds of residence permits ending in this organization: the core's own reminder
   * (workflow-dues.service.ts, from My Data's `residencePermitValidUntil`) then stays silent there.
   * @deprecated the core's trigger event `permitExpires` (Auslöser) does it: an enabled trigger silences the reminder.
   */
  permitReminders?: (db: Db, orgId: string) => Promise<boolean>;
  /**
   * Events for Auslöser (triggers, Admin settings -> Workflows): an organization's trigger opens a flow for each
   * occurrence (an anniversary, an exit step), through a flow type's steps or as a Free Flow. Event ids start with the
   * plugin's id (`hr.anniversary`); they run only while the plugin's module (`module`, else the plugin's id) is on.
   */
  triggers?: TriggerSource;
  /**
   * What it offers to bill a customer for (e.g. the expenses to bill on): another module (billing) reads them through
   * BillablesService, never this plugin's tables (docs/PLUGINS.md "Billables").
   */
  billables?: BillableSource[];
}

export function defineApiPlugin(plugin: ApiPlugin): ApiPlugin {
  return plugin;
}

// Assistant tools
export type { AssistantTool, AssistantToolContext, AssistantToolResult } from './assistant-tools';

// Team tables
export type { ApiTeamView } from './team-overview.controller';

// Import/Export
export type { ApiPayrollItem } from './import-export.service';
export type { PlannedMinutesSource } from './work-time-model.service';

// Reports
export type { ApiReport, ReportRowsContext } from './report-sources';
export type { ReportDefinition, ReportRow } from '@worktime3/shared/reports';

// The business clock (clock.ts): "now" and "today" for what a company does, instead of new Date(), SQL now() and
// CURRENT_DATE; technical time (rate limits, expiring links) stays real and says so (`// real time: <why>`).
export { clock, sqlNow, sqlToday, todayIn } from './clock';
// Database and history
export { DbService, type Db } from './db.service';
export { VersionsService } from './versions.service';
// Exchange rates (the core's, Organization settings): the rates in force for an organization and its reporting currency.
export { effectiveRates, exchangeRatesOf, FALLBACK_REPORTING_CURRENCY, reportingCurrencyOf } from './exchange-rates';
export { AuditService } from './audit.service';

// Authentication and authorization (CLAUDE.md: every org-scoped handler authorizes itself)
export { Public, type AuthenticatedRequest } from './jwt.guard';
export {
  callerUserId, can, canSeeUserData, canEditUserData, canEditBeyondOwn, isOrgMember, isManagerOf, isOperator,
  listableUserIds, membershipManagerId, actingManagerId, permissionIdsOf, reachesAll,
} from './access';

// Documents, form templates, approval workflows
export { DocumentsService, MAX_DOCUMENT_BYTES, type DocumentRow, type PersonalDocument, type PersonalDocumentSource } from './documents.service';
export { FieldsService } from './fields.service';
// Personal data (users.basicdata): a direct edit with its history entry, as HR's on the Employees page.
export { BasicDataService } from './basicdata.service';
// Auslöser (triggers): the events a plugin offers (ApiPlugin.triggers).
export type { TriggerEventDef, TriggerLang, TriggerOccurrence, TriggerSource } from './triggers';
export { WorkflowsService, type WorkflowEvent, type SourceRecordLoader, type WorkflowActionContext, type WorkflowActionHandler, type SourceOrgResolver, type WorkflowKind } from './workflows.service';

// Notifications (the bell; a click opens the section the web part's `notificationSections` names
// for the source table) and mail (best effort: catch and log, never fail a request on it).
export { NotificationsService } from './notifications.service';
export type { NoticeText, NoticeValue } from './notification-text';
export { sendMail, type MailOptions } from './mailer';
export { appBaseUrl } from './app-url';
/** The client's address behind the edge proxy (for limits; never store it with a record). */
export { clientIp } from './client-ip';

// Who records no working time in a period (no working-time timesheet to wait for).
export { notRecordingUserIds } from './time-recording';

// Flows as tasks: a plugin opens a Free Flow a task to a department (`openTask`, one per key; e.g. a deadline)
// and resolves the ones that no longer apply (`closeTasks`); past its due date an open task alerts its
// handlers by e-mail. 'flows-off' when the organization has the flows module off.
export { FlowsService, type SystemTaskInput, type SystemTaskResult } from './flows.service';
// Projects for plugins: customers with their projects, a new customer project or subproject (e.g. one case), a subproject's summary.
export { ProjectsService, type CustomerProjects, type ProjectRecord, type SubprojectSummary } from './projects.service';
// The core's data for plugins, instead of its tables (docs/PLUGINS.md): people, customers.
export { PeopleService } from './people.service';
export { OrganizationsService } from './organizations.service';
export { StructureService, type StaffMember } from './structure.service';
export { AbsencesReadService, type ApprovedAbsence, type AbsenceRecord } from './absences-read.service';
export { EmploymentService, type Employment, type AssignmentRecord, type PermitRecord } from './employment.service';
export { PersonnelFilesService, type PersonnelEntry, type PersonnelFiling } from './personnel-files.service';
export { TimesheetsReadService, type ProjectMonth } from './timesheets-read.service';
export { StaticDataService, type StaticDataEntry } from './static-data.service';
export { CustomersService, type CustomerRecord } from './customers.service';
// Billables: what modules offer to bill (expenses), read by another module (billing) through the core only.
export { BillablesService, type BillableItem, type BillableSource } from './billables.service';

// Time balances (Time balances page): a person's year and their year-end closings (`balance_years`).
export { BalancesService, type YearBalances, type YearClosing } from './balances.service';
// The work-time model: a person's schedules, holidays (their location's canton) and approved absences per day
// (`model`, `targets`; with packages/shared/src/worktime.ts `dayTargets`). Callers authorize first.
export { WorkTimeModelService } from './work-time-model.service';

// A person's Personalien as the payroll export reads them (the organization's section over the shared one).
export { payrollPersonalien } from './payroll-personalien';

// AI: Azure OpenAI (Switzerland) only, every call through AiBudgetService
export { azureOpenAiClient, azureOpenAiConfig, chatErrorCode, retryStaleConnection } from './ai-client';
export {
  AiBudgetService, azureAllowed, azureOpenAiAvailable, azurePrices, chatChf, chatParams, estimateChatChf, estimateTranscribeChf, instanceBudgetChf,
  targetChf, targetClient, targetEstimateChf, transcribeChf, type AiUsageKind, type AzurePrices, type ChatTarget,
} from './ai-budget.service';
export { extractPdfText, isPdf, tidyExtractedText } from './case-document-text';
