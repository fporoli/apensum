import { Sheet, type Column } from './timesheet-documents.service';

/**
 * A report table as the Reports page shows it, for the PDF download: every cell already labelled
 * and formatted in the person's language by the browser (Reports.tsx), so the PDF is what is on
 * screen. The API only checks the shape and lays it out.
 */
export interface ReportPdfTable {
  title: string;
  subtitle: string;
  footer: string;
  columns: { header: string; align: 'left' | 'right' }[];
  rows: string[][];
  totals?: string[];
}

const MAX_COLUMNS = 16;
const MAX_ROWS = 5000;
const MAX_TEXT = 200;

const text = (v: unknown, max = MAX_TEXT): string | null => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);

/** The table from a request body, or null when it is not one (too large, wrong shapes). */
export function sanitizeReportPdf(input: unknown): ReportPdfTable | null {
  if (!input || typeof input !== 'object') return null;
  const b = input as Record<string, unknown>;
  const title = text(b.title);
  const subtitle = text(b.subtitle) ?? '';
  const footer = text(b.footer) ?? '';
  if (!title || !Array.isArray(b.columns) || !b.columns.length || b.columns.length > MAX_COLUMNS) return null;
  const columns: ReportPdfTable['columns'] = [];
  for (const c of b.columns) {
    const header = c && typeof c === 'object' ? text((c as Record<string, unknown>).header) : null;
    if (header === null) return null;
    columns.push({ header, align: (c as Record<string, unknown>).align === 'right' ? 'right' : 'left' });
  }
  const line = (r: unknown): string[] | null => {
    if (!Array.isArray(r) || r.length > columns.length) return null;
    const out = r.map((v) => (v === null || v === undefined ? '' : text(v)));
    return out.some((v) => v === null) ? null : (out as string[]);
  };
  if (!Array.isArray(b.rows) || b.rows.length > MAX_ROWS) return null;
  const rows: string[][] = [];
  for (const r of b.rows) {
    const l = line(r);
    if (!l) return null;
    rows.push(l);
  }
  let totals: string[] | undefined;
  if (b.totals !== undefined && b.totals !== null) {
    const l = line(b.totals);
    if (!l) return null;
    totals = l;
  }
  return { title, subtitle, footer, columns, rows, totals };
}

/** Column widths: text columns get twice the room of number columns; landscape from six columns on. */
export function layoutColumns(columns: ReportPdfTable['columns'], width: number): Column[] {
  const weight = (c: ReportPdfTable['columns'][number]) => (c.align === 'right' ? 1 : 2);
  const sum = columns.reduce((s, c) => s + weight(c), 0);
  return columns.map((c) => ({ label: c.header, align: c.align, width: (width * weight(c)) / sum }));
}

export async function renderReportPdf(t: ReportPdfTable): Promise<Buffer> {
  const sheet = new Sheet(t.title, t.subtitle, t.columns.length > 5 ? 'landscape' : 'portrait');
  const columns = layoutColumns(t.columns, sheet.width);
  const rows = t.rows.map((cells, i) => ({ cells, shade: i % 2 === 1 }));
  if (t.totals) rows.push({ cells: t.totals, shade: false, bold: true } as (typeof rows)[number]);
  sheet.table(columns, rows);
  return sheet.finish(t.footer);
}
