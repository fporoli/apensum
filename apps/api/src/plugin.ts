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
import type { ApiBackup, ApiPayrollItem } from './import-export.service';
import type { FormDef } from '@worktime3/shared/fields';
import type { Db } from './db.service';
import type { AuditService } from './audit.service';
import type { VersionsService } from './versions.service';
import type { PersonalDocumentSource } from './documents.service';
import type { SourceOrgResolver, SourceRecordLoader, WorkflowActionContext } from './workflows.service';

/** Core services a plugin's declared functions get as their last argument. */
export interface PluginCore {
  versions: VersionsService;
  audit: AuditService;
}

/**
 * A plugin's approvals (workflows run by WorkflowsService, shown on the Workflow page with the web
 * part's `workflowKinds`).
 */
export interface ApiPluginWorkflows {
  /** What a step's `onApprove`/`onReject` action does to the record, by action name (e.g. 'expense.approve'). */
  actions?: Record<string, (db: Db, ctx: WorkflowActionContext, core: PluginCore) => Promise<void>>;
  /**
   * Per source table of the plugin's workflows: the record's organization (admin override, audit,
   * notifications, rerouting) and, optionally, what the Workflow page shows of it under `field`.
   */
  sources?: Record<string, { organization: SourceOrgResolver; records?: { field: string; load: SourceRecordLoader } }>;
  /** Workflow definition names that go to the person's manager and follow them when the manager changes. */
  managerRouted?: string[];
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
  /** The plugin's tables in an organization's backup and restore (Import/Export). */
  backup?: ApiBackup;
  /** Approvals: workflow actions, source tables and manager routing. */
  workflows?: ApiPluginWorkflows;
  /**
   * Configurable forms (docs/FIELD_CONFIG.md): their templates (field_config, by form id) then work as
   * the core's do. The web part renders them with useFormTemplate and the same definition.
   */
  forms?: FormDef[];
  /** A person's own documents on the Documents page, by category (e.g. `expense` receipts). */
  documents?: Record<string, PersonalDocumentSource>;
}

export function defineApiPlugin(plugin: ApiPlugin): ApiPlugin {
  return plugin;
}

// Team tables
export type { ApiTeamView } from './team-overview.controller';

// Import/Export
export type { ApiBackup, ApiPayrollItem, BackupRestoreContext } from './import-export.service';

// Reports
export type { ApiReport, ReportRowsContext } from './report-sources';
export type { ReportDefinition, ReportRow } from '@worktime3/shared/reports';

// Database and history
export { DbService, type Db } from './db.service';
export { VersionsService } from './versions.service';
export { AuditService } from './audit.service';

// Authentication and authorization (CLAUDE.md: every org-scoped handler authorizes itself)
export { Public, type AuthenticatedRequest } from './jwt.guard';
export {
  callerUserId, can, canSeeUserData, canEditUserData, canEditBeyondOwn, isOrgMember, isManagerOf, isSuperDeveloper,
  listableUserIds, membershipManagerId, permissionIdsOf, reachesAll,
} from './access';

// Documents, form templates, approval workflows
export { DocumentsService, MAX_DOCUMENT_BYTES, type PersonalDocument, type PersonalDocumentSource } from './documents.service';
export { FieldsService } from './fields.service';
export { WorkflowsService, type SourceRecordLoader, type WorkflowActionContext, type WorkflowActionHandler, type SourceOrgResolver } from './workflows.service';

// AI: the instance's provider (Gemini/OpenAI) and paid calls (Azure, Switzerland), always through AiBudgetService
export { aiModel, aiProvider, azureOpenAiClient, azureOpenAiConfig, chatErrorCode, instanceCaseClient, retryStaleConnection } from './ai-client';
export {
  AiBudgetService, azureAllowed, azureOpenAiAvailable, azurePrices, chatChf, estimateChatChf, estimateTranscribeChf, instanceBudgetChf,
  transcribeChf, type AiUsageKind, type AzurePrices,
} from './ai-budget.service';
export { extractPdfText, isPdf, tidyExtractedText } from './case-document-text';
