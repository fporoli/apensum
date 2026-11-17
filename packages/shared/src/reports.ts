// The reports of the Reports page (nav.reports): what each report shows, how it can be grouped
// and how its numbers add up. Used by the API (reports.controller.ts builds the raw rows and
// groups them here) and by the web app (labels, columns, chart).
//
// A report has dimensions (what a row is about: person, project, month, ...) and measures (the
// numbers). The API produces one raw row per finest combination; `groupReport` then sums them for
// the dimensions the person chose. A `balance` measure is a running balance: within a group it is
// the value at the end of each person's last month, summed over the people.
//
// Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.

export type ReportId = 'projectHours' | 'attendance' | 'absences' | 'expenses' | 'people';
/** `money` is in the row's `currency`: amounts in different currencies are never added up. */
export type MeasureKind = 'hours' | 'days' | 'money' | 'count' | 'fte';

export interface ReportMeasure {
  key: string;
  kind: MeasureKind;
  /** `sum` adds up; `balance` takes each person's last month, then adds up people. */
  aggregate: 'sum' | 'balance';
}

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
}

export const REPORTS: readonly ReportDefinition[] = [
  {
    id: 'projectHours',
    object: 'nav.time',
    dimensions: ['person', 'project', 'month'],
    defaultGroupBy: ['project', 'person'],
    measures: [{ key: 'hours', kind: 'hours', aggregate: 'sum' }],
    chart: ['hours'],
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
    measures: [
      { key: 'days', kind: 'days', aggregate: 'sum' },
      { key: 'hours', kind: 'hours', aggregate: 'sum' },
    ],
    chart: ['days'],
  },
  {
    id: 'expenses',
    object: 'nav.expenses',
    dimensions: ['person', 'category', 'project', 'month', 'status', 'currency'],
    defaultGroupBy: ['category'],
    alwaysGroupBy: ['currency'],
    measures: [
      { key: 'amount', kind: 'money', aggregate: 'sum' },
      { key: 'count', kind: 'count', aggregate: 'sum' },
    ],
    chart: ['amount'],
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
];

export function reportById(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
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
