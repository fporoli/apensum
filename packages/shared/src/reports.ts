// The reports of the Reports page (nav.reports): what each report shows, how it can be grouped
// and how its numbers add up. Used by the API (reports.controller.ts builds the raw rows and
// groups them here) and by the web app (labels, columns, chart).
//
// A report has dimensions (what a row is about: person, project, month, ...) and measures (the
// numbers). The API produces one raw row per finest combination; `groupReport` then sums them for
// the dimensions the person chose. A `balance` measure is a running balance: within a group it is
// the value at the end of each person's last month, summed over the people.
//
// Plugins add reports of their own (registerReport; their rows come from the plugin's API part,
// apps/api/src/report-sources.ts).
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

/** A core report ('projectHours', 'attendance', 'absences', 'people', 'workingTimeAct') or a plugin's. */
export type ReportId = string;
/** `money` is in the row's `currency`: amounts in different currencies are never added up. */
export type MeasureKind = 'hours' | 'days' | 'money' | 'count' | 'fte';

export interface ReportMeasure {
  key: string;
  kind: MeasureKind;
  /** `sum` adds up; `balance` takes each person's last month, then adds up people. */
  aggregate: 'sum' | 'balance';
}

/**
 * How the values of a dimension read, for dimensions without a built-in label (person, month,
 * project, date, department, function, manager are built in; reportTable.ts labelFor):
 * - `staticData`: the label of the organization's static data row `entity`/`enum` (else the global
 *   one), in the language; `fallback` maps a value without one to a text key.
 * - `textPrefix`: the text `<prefix><value>`, e.g. 'reports.check.' + 'dailyRest'.
 */
export type DimensionLabels =
  | { staticData: { entity: string; enum: string }; fallback?: Record<string, string> }
  | { textPrefix: string };

export interface ReportDefinition {
  id: ReportId;
  /** The page whose rule decides whose data the report shows (listableUserIds). */
  object: string;
  dimensions: readonly string[];
  defaultGroupBy: readonly string[];
  measures: readonly ReportMeasure[];
  /** The measure the chart shows, over the first grouping dimension. */
  chart: readonly string[];
  /** Dimensions every grouping keeps (expenses: the currency, so amounts are never mixed). */
  alwaysGroupBy?: readonly string[];
  /** Text facts about a person (people: start date), shown when the rows are per person. */
  details?: readonly string[];
  /** The report is a snapshot on the last day of the period instead of a sum over its months. */
  snapshot?: boolean;
  /** Offers the project filter (`projectId`): the rows have a project. */
  projectFilter?: boolean;
  /** Labels of the report's own dimensions (DimensionLabels). */
  labels?: Readonly<Record<string, DimensionLabels>>;
}

/** Texts of a report: `reports.report.<id>`, `.description`, `reports.note.<id>`, its dims and measures. */
export const REPORTS: ReportDefinition[] = [
  {
    id: 'projectHours',
    object: 'nav.time',
    dimensions: ['person', 'project', 'month'],
    defaultGroupBy: ['project', 'person'],
    measures: [{ key: 'hours', kind: 'hours', aggregate: 'sum' }],
    chart: ['hours'],
    projectFilter: true,
  },
  {
    id: 'attendance',
    object: 'nav.workTime',
    dimensions: ['person', 'month'],
    defaultGroupBy: ['person'],
    measures: [
      { key: 'target', kind: 'hours', aggregate: 'sum' },
      { key: 'worked', kind: 'hours', aggregate: 'sum' },
      { key: 'difference', kind: 'hours', aggregate: 'sum' },
      { key: 'overtimeBalance', kind: 'hours', aggregate: 'balance' },
      { key: 'legalOvertime', kind: 'hours', aggregate: 'sum' },
      { key: 'vacationDays', kind: 'days', aggregate: 'sum' },
    ],
    chart: ['target', 'worked'],
  },
  {
    id: 'absences',
    object: 'nav.absences',
    dimensions: ['person', 'type', 'month'],
    defaultGroupBy: ['type'],
    labels: { type: { staticData: { entity: 'absences', enum: 'absence_type' } } },
    measures: [
      { key: 'days', kind: 'days', aggregate: 'sum' },
      { key: 'hours', kind: 'hours', aggregate: 'sum' },
    ],
    chart: ['days'],
  },
  {
    id: 'people',
    object: 'section.people.employment',
    dimensions: ['department', 'function', 'manager', 'person'],
    defaultGroupBy: ['department', 'person'],
    details: ['startDate'],
    snapshot: true,
    measures: [
      { key: 'headcount', kind: 'count', aggregate: 'sum' },
      { key: 'fte', kind: 'fte', aggregate: 'sum' },
    ],
    chart: ['headcount', 'fte'],
  },
  {
    // Recorded attendance checked against the Working Hours Act (apps/api/src/working-time-act.ts):
    // one raw row per finding, `check` naming the rule, `date` the day concerned.
    id: 'workingTimeAct',
    object: 'nav.workTime',
    dimensions: ['person', 'check', 'month', 'date'],
    defaultGroupBy: ['person', 'check'],
    labels: { check: { textPrefix: 'reports.check.' } },
    measures: [
      { key: 'occurrences', kind: 'count', aggregate: 'sum' },
      { key: 'hours', kind: 'hours', aggregate: 'sum' },
    ],
    chart: ['occurrences'],
  },
];

export function reportById(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

/**
 * Adds a plugin's report (after the core's, in the order registered). Registering the same id again
 * replaces it; the definition must be consistent (dimensions it groups and charts by exist).
 */
export function registerReport(def: ReportDefinition): void {
  if (!def || typeof def.id !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(def.id)) throw new Error(`Invalid report id: ${JSON.stringify(def?.id)}`);
  if (typeof def.object !== 'string' || !def.object) throw new Error(`Report ${def.id}: object (a permission object) is required`);
  for (const d of [...def.defaultGroupBy, ...(def.alwaysGroupBy ?? [])]) {
    if (!def.dimensions.includes(d)) throw new Error(`Report ${def.id}: ${d} is not one of its dimensions`);
  }
  for (const c of def.chart) if (!def.measures.some((m) => m.key === c)) throw new Error(`Report ${def.id}: chart measure ${c} is unknown`);
  const at = REPORTS.findIndex((r) => r.id === def.id);
  if (at >= 0) REPORTS[at] = def;
  else REPORTS.push(def);
}

/** One raw row: its dimension values (person id under `person`, its name under `personName`) and measures. */
export type ReportRow = Record<string, string | number>;

/** The chosen grouping: known dimensions of the report, each once, in the order given; none = the default. */
export function parseGroupBy(def: ReportDefinition, input: unknown): string[] {
  const asked = typeof input === 'string' ? input.split(',') : Array.isArray(input) ? input.map(String) : [];
  const out: string[] = [];
  for (const d of asked.map((s) => s.trim())) if (def.dimensions.includes(d) && !out.includes(d)) out.push(d);
  const chosen = out.length ? out : [...def.defaultGroupBy];
  for (const d of def.alwaysGroupBy ?? []) if (!chosen.includes(d)) chosen.push(d);
  return chosen;
}

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** The months from `from` to `to` (yyyy-mm, both included), at most `max`; null when invalid. */
export function monthsBetween(from: string, to: string, max = 36): string[] | null {
  const a = MONTH.exec(from);
  const b = MONTH.exec(to);
  if (!a || !b || from > to) return null;
  const out: string[] = [];
  let y = Number(a[1]);
  let m = Number(a[2]);
  while (`${y}-${String(m).padStart(2, '0')}` <= to) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (out.length > max) return null;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Adds up rows: plain sums, and balances as each person's value in their last month, summed.
 * Money in more than one currency has no total (the key is left out).
 */
function aggregate(def: ReportDefinition, rows: readonly ReportRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  const currencies = new Set(rows.map((r) => r.currency));
  for (const m of def.measures) {
    if (m.kind === 'money' && currencies.size > 1) continue;
    if (m.aggregate === 'sum') {
      out[m.key] = round(rows.reduce((s, r) => s + (Number(r[m.key]) || 0), 0));
    } else {
      const last = new Map<string, ReportRow>();
      for (const r of rows) {
        const p = String(r.person);
        const seen = last.get(p);
        if (!seen || String(r.month) > String(seen.month)) last.set(p, r);
      }
      out[m.key] = round([...last.values()].reduce((s, r) => s + (Number(r[m.key]) || 0), 0));
    }
  }
  return out;
}

export interface GroupedReport {
  groupBy: string[];
  rows: ReportRow[];
  totals: Record<string, number>;
}

/**
 * Groups raw rows by the chosen dimensions: one row per combination, measures added up, sorted
 * by the dimensions (months in order, names alphabetically; `labelOf` gives the sort text).
 */
export function groupReport(def: ReportDefinition, raw: readonly ReportRow[], groupBy: readonly string[], labelOf: (dim: string, row: ReportRow) => string = (d, r) => String(r[d] ?? '')): GroupedReport {
  const groups = new Map<string, ReportRow[]>();
  for (const r of raw) {
    const key = groupBy.map((d) => String(r[d] ?? '')).join('\u0000');
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const rows: ReportRow[] = [];
  for (const list of groups.values()) {
    const first = list[0];
    const row: ReportRow = {};
    for (const d of groupBy) {
      row[d] = first[d];
      if (d === 'person' && first.personName !== undefined) row.personName = first.personName;
      if (d === 'person') for (const k of def.details ?? []) if (first[k] !== undefined) row[k] = first[k];
    }
    Object.assign(row, aggregate(def, list));
    rows.push(row);
  }
  rows.sort((a, b) => {
    for (const d of groupBy) {
      const c = labelOf(d, a).localeCompare(labelOf(d, b), 'de');
      if (c !== 0) return c;
    }
    return 0;
  });
  return { groupBy: [...groupBy], rows, totals: aggregate(def, raw) };
}

/** The last day (yyyy-mm-dd) of a month (yyyy-mm). */
export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** What a saved report remembers: the report, its period (a preset moves with time) and its choices. */
export interface SavedReportSettings {
  preset: string;
  from?: string;
  to?: string;
  groupBy: string[];
  userId?: string;
  departmentId?: string;
  projectId?: string;
}

const PRESET_IDS = ['thisMonth', 'lastMonth', 'thisQuarter', 'lastQuarter', 'thisYear', 'lastYear', 'custom'];
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validated settings for a saved report of `def`, or null. Unknown keys are dropped. */
export function sanitizeSavedSettings(def: ReportDefinition, input: unknown): SavedReportSettings | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as Record<string, unknown>;
  const preset = typeof i.preset === 'string' && PRESET_IDS.includes(i.preset) ? i.preset : null;
  if (!preset) return null;
  const out: SavedReportSettings = { preset, groupBy: parseGroupBy(def, i.groupBy) };
  if (preset === 'custom') {
    if (typeof i.from !== 'string' || typeof i.to !== 'string' || !monthsBetween(i.from, i.to)) return null;
    out.from = i.from;
    out.to = i.to;
  }
  for (const k of ['userId', 'departmentId', 'projectId'] as const) {
    const v = i[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v !== 'string' || !ID.test(v)) return null;
    out[k] = v;
  }
  return out;
}
