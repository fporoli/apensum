// A grouped report as a labelled table: what the Reports page shows and downloads, and what a
// scheduled report (apps/api/src/report-schedules.service.ts) writes into its PDF or Excel file.
// Both build the table here, so a scheduled file reads exactly like a download from the page.
//
// Keep this file erasable TypeScript (no enums) so Node tests can load it directly.

import type { ReportDefinition, ReportMeasure, ReportRow } from './reports';
import type { Cell } from './xlsx';

/** The formatting locale for a language: its Swiss variant (`de` -> `de-CH`); a full tag stays as is. */
export function swissLocale(locale: string): string {
  return /^[a-z]{2}$/.test(locale) ? `${locale}-CH` : locale;
}

export type Preset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisYear' | 'lastYear' | 'custom';
export const PRESETS: readonly Preset[] = ['thisMonth', 'lastMonth', 'thisQuarter', 'lastQuarter', 'thisYear', 'lastYear', 'custom'];

const ym = (y: number, m: number) => {
  const d = new Date(Date.UTC(y, m, 1)); // normalizes m < 0 and m > 11
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

/** First and last month (yyyy-mm) of a preset, relative to `today` (a yyyy-mm-dd date or a Date in local time). */
export function presetRange(preset: Exclude<Preset, 'custom'>, today: Date | string = new Date()): [string, string] {
  const [y, m] = typeof today === 'string'
    ? [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1]
    : [today.getFullYear(), today.getMonth()];
  const q = Math.floor(m / 3) * 3;
  switch (preset) {
    case 'thisMonth': return [ym(y, m), ym(y, m)];
    case 'lastMonth': return [ym(y, m - 1), ym(y, m - 1)];
    case 'thisQuarter': return [ym(y, q), ym(y, q + 2)];
    case 'lastQuarter': return [ym(y, q - 3), ym(y, q - 1)];
    case 'thisYear': return [ym(y, 0), ym(y, m)];
    case 'lastYear': return [ym(y - 1, 0), ym(y - 1, 11)];
  }
}

/** Translations from static data: `{ <language>: { <key>: <label> } }`, plus plain values as a fallback. */
export interface StaticLabels {
  translation: Record<string, Record<string, string>>;
  /** Labels, or properties (a list whose labels are in the translations only). */
  values?: Record<string, unknown>;
}

export interface LabelSources {
  /**
   * Static data labels per dimension: for each `staticData` entry of the report's `labels`
   * (staticDataLabelsOf), the organization's row, else the global one.
   */
  static: Record<string, StaticLabels>;
  /** Last resort for a value without a label (the web app's built-in absence type names). */
  fallback?: (dim: string, value: string) => string | undefined;
}

/** The static data a report's labels need: dimension -> static data entity and enum. */
export function staticDataLabelsOf(def: { labels?: ReportDefinition['labels'] }): { dim: string; entity: string; enum: string }[] {
  const out: { dim: string; entity: string; enum: string }[] = [];
  for (const [dim, l] of Object.entries(def.labels ?? {})) if ('staticData' in l) out.push({ dim, ...l.staticData });
  return out;
}

/** A text lookup: the key itself when missing; `{{name}}` placeholders filled from `vars`. */
export type Texts = (key: string, vars?: Record<string, string | number>) => string;

/** Builds a lookup over one language's texts (REPORT_TEXTS[lang], or the web app's whole dictionary). */
export function textsOf(dict: Record<string, string>): Texts {
  return (key, vars) => {
    const s = dict[key] ?? key;
    return vars ? s.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m)) : s;
  };
}

/** A month (yyyy-mm) as "Nov. 2026" in the language. */
export function monthLabel(month: string, locale: string): string {
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)).toLocaleDateString(swissLocale(locale), { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** A yyyy-mm-dd date as the language writes it in Switzerland (17.11.2026). */
export function dateLabel(date: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString(swissLocale(locale), { timeZone: 'UTC' });
}

/** How a dimension value of `def` reads in the language: built in, else as the report's `labels` say. */
export function labelFor(def: { labels?: ReportDefinition['labels'] }, locale: string, t: Texts, sources: LabelSources): (dim: string, row: ReportRow) => string {
  // Lists of properties (e.g. expense categories with their VAT type) have their labels in the translations only.
  const fromStatic = (s: StaticLabels | undefined, v: string) => {
    const value = s?.values?.[v];
    return s?.translation[locale]?.[v] ?? (typeof value === 'string' && value ? value : undefined) ?? s?.translation.en?.[v];
  };
  return (dim, row) => {
    const v = String(row[dim] ?? '');
    switch (dim) {
      case 'person': return String(row.personName ?? v);
      case 'month': return monthLabel(v, locale);
      case 'project': return v || t('reports.noProject');
      case 'date': return dateLabel(v, locale);
      case 'department':
      case 'function':
      case 'manager': return v || t('reports.none');
    }
    const l = def.labels?.[dim];
    if (!l) return v;
    if ('textPrefix' in l) return t(`${l.textPrefix}${v}`);
    const key = l.fallback?.[v];
    return fromStatic(sources.static[dim], v) ?? (key ? t(key) : undefined) ?? sources.fallback?.(dim, v) ?? v;
  };
}

/** A measure's value: counts without decimals, everything else with two. */
export function formatMeasure(n: number, measure: Pick<ReportMeasure, 'kind'> | undefined, locale: string): string {
  const digits = measure?.kind === 'count' ? 0 : 2;
  return new Intl.NumberFormat(swissLocale(locale), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

/** Rows sorted by what people read (category and type labels, names), months in calendar order. */
export function sortRows(rows: readonly ReportRow[], groupBy: readonly string[], label: (dim: string, row: ReportRow) => string, locale: string): ReportRow[] {
  const key = (d: string, r: ReportRow) => (d === 'month' || d === 'date' ? String(r[d] ?? '') : label(d, r));
  return [...rows].sort((a, b) => {
    for (const d of groupBy) {
      const c = key(d, a).localeCompare(key(d, b), locale);
      if (c !== 0) return c;
    }
    return 0;
  });
}

export interface ReportTable {
  columns: { header: string; align: 'left' | 'right'; kind: 'text' | 'number' }[];
  /** Cells for Excel/CSV: numbers stay numbers. */
  cells: Cell[][];
  totalCells: Cell[];
  /** Cells for the screen and the PDF: everything formatted. */
  text: string[][];
  totalText: string[];
}

/** The detail columns (people: start date) the rows carry when they are per person. */
export function detailsShown(def: ReportDefinition, groupBy: readonly string[]): readonly string[] {
  return groupBy.includes('person') ? def.details ?? [] : [];
}

/** The table of a grouped report (rows already sorted), labelled and formatted in the language. */
export function buildReportTable(
  def: ReportDefinition,
  result: { groupBy: readonly string[]; rows: readonly ReportRow[]; totals: Record<string, number> },
  locale: string,
  t: Texts,
  label: (dim: string, row: ReportRow) => string,
): ReportTable {
  const dims = result.groupBy;
  const details = detailsShown(def, dims);
  const detail = (k: string, r: ReportRow) => {
    const v = String(r[k] ?? '');
    return k === 'startDate' && v ? dateLabel(v, locale) : v;
  };
  const columns: ReportTable['columns'] = [
    ...dims.map((d) => ({ header: t(`reports.dim.${d}`), align: 'left' as const, kind: 'text' as const })),
    ...details.map((k) => ({ header: t(`reports.detail.${k}`), align: 'left' as const, kind: 'text' as const })),
    ...def.measures.map((m) => ({ header: t(`reports.measure.${m.key}`), align: 'right' as const, kind: 'number' as const })),
  ];
  const lead = (r: ReportRow) => [...dims.map((d) => label(d, r)), ...details.map((k) => detail(k, r))];
  const blanks = [...dims.slice(1), ...details];
  return {
    columns,
    cells: result.rows.map((r) => [...lead(r), ...def.measures.map((m) => (typeof r[m.key] === 'number' ? (r[m.key] as number) : null))]),
    totalCells: [t('reports.total'), ...blanks.map(() => null), ...def.measures.map((m) => result.totals[m.key] ?? null)],
    text: result.rows.map((r) => [...lead(r), ...def.measures.map((m) => (typeof r[m.key] === 'number' ? formatMeasure(r[m.key] as number, m, locale) : '–'))]),
    totalText: [t('reports.total'), ...blanks.map(() => ''), ...def.measures.map((m) => (result.totals[m.key] === undefined ? '–' : formatMeasure(result.totals[m.key], m, locale)))],
  };
}

/** The period line under the title: "Jan. 2026 – Nov. 2026", or "As at 30.11.2026" for a snapshot. */
export function periodText(def: ReportDefinition, from: string, to: string, locale: string, t: Texts, today: string): string {
  if (def.snapshot) {
    const [y, m] = to.split('-').map(Number);
    const end = `${to}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
    return t('reports.asAt', { date: dateLabel(end < today ? end : today, locale) });
  }
  return from === to ? monthLabel(from, locale) : `${monthLabel(from, locale)} – ${monthLabel(to, locale)}`;
}
