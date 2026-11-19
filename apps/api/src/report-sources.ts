import { registerReport, type ReportDefinition, type ReportRow } from '@worktime3/shared/reports';
import { registerAvailablePluginTexts } from '@worktime3/shared/reportTexts';
import type { DbService } from './db.service';

type Db = NonNullable<ReturnType<DbService['getDb']>>;

/** What a plugin report's rows are built from: the people already checked by ReportsService. */
export interface ReportRowsContext {
  db: Db;
  orgId: string;
  /** Whose rights the report runs with (the Reports page's caller, or a scheduled report's recipient). */
  callerId: string;
  /** The people the caller may see on the report's page, narrowed by the filters; never empty. */
  people: ReadonlyArray<{ id: string; name: string }>;
  /** First and last month of the period (yyyy-mm). */
  first: string;
  last: string;
  /** The project filter (a checked uuid), when the report has `projectFilter`. */
  projectId?: string;
}

/**
 * A plugin's report (ApiPlugin.reports): its definition and texts (shared with the plugin's web part)
 * and its raw rows, one per finest combination of its dimensions (`person` = the person's id,
 * `personName` = the name from `people`). Only rows of `ctx.people` may be returned.
 */
export interface ApiReport {
  definition: ReportDefinition;
  texts?: Partial<Record<string, Record<string, string>>>;
  rows: (ctx: ReportRowsContext) => Promise<ReportRow[]>;
}

const SOURCES = new Map<string, ApiReport['rows']>();

/** Adds a plugin's report: its definition and texts to the shared catalogue, its rows here. */
export function registerApiReport(report: ApiReport): void {
  registerReport(report.definition);
  if (report.texts) registerAvailablePluginTexts(report.texts);
  SOURCES.set(report.definition.id, report.rows);
}

/** The rows of a plugin's report; undefined for the core's reports. */
export function reportSource(id: string): ApiReport['rows'] | undefined {
  return SOURCES.get(id);
}
