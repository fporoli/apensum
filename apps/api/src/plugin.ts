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
}

export function defineApiPlugin(plugin: ApiPlugin): ApiPlugin {
  return plugin;
}

// Team tables
export type { ApiTeamView } from './team-overview.controller';

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
  callerUserId, can, canSeeUserData, canEditUserData, canEditBeyondOwn, isOrgMember, isManagerOf, listableUserIds,
  membershipManagerId, reachesAll,
} from './access';

// Documents, form templates, approval workflows
export { DocumentsService, MAX_DOCUMENT_BYTES, type PersonalDocument, type PersonalDocumentSource } from './documents.service';
export { FieldsService } from './fields.service';
export { WorkflowsService, type SourceRecordLoader, type WorkflowActionHandler, type SourceOrgResolver } from './workflows.service';

// Paid AI calls (Azure, Switzerland): always through AiBudgetService
export { azureOpenAiClient, azureOpenAiConfig, chatErrorCode, retryStaleConnection } from './ai-client';
export { AiBudgetService, azureOpenAiAvailable, azurePrices, chatChf, estimateChatChf } from './ai-budget.service';
export { extractPdfText, isPdf } from './case-document-text';
