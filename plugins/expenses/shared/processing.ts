/**
 * Expense processing (HR): the approved reports a person selects, summed per cost centre and currency,
 * and the text for accounting shown in the popup before they are marked "processing finished".
 * Pure, used by the API (grouping) and the web part (text). Keep it erasable TypeScript.
 */

/** Statuses "Process" takes: approved, and the older intermediate step. */
export const PROCESSABLE_STATUSES = ['approved', 'submitted_processing'] as const;
/** The status processed reports get. */
export const PROCESSED_STATUS = 'processing_finished';
/** At most this many reports per call. */
export const MAX_PROCESS_REPORTS = 200;

export interface ProcessingItem {
  /** The project's cost item, else the person's department; null when neither. */
  costCenter: string | null;
  currency: string;
  value: number;
}

export interface ProcessingLine {
  costCenter: string | null;
  currency: string;
  amount: number;
  entries: number;
}

export interface ProcessingReport {
  id: string;
  status: string;
  dateSubmitted: string | null;
  userId: string;
  name: string;
  personnelNumber: string;
  workflowId: string | null;
  lines: ProcessingLine[];
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** A report's expenses summed per cost centre and currency (amounts in different currencies never add up). */
export function processingLines(items: readonly ProcessingItem[]): ProcessingLine[] {
  const byKey = new Map<string, ProcessingLine>();
  for (const i of items) {
    const key = `${i.costCenter ?? ''}\u0000${i.currency}`;
    const line = byKey.get(key) ?? { costCenter: i.costCenter, currency: i.currency, amount: 0, entries: 0 };
    line.amount = cents(line.amount + (Number(i.value) || 0));
    line.entries += 1;
    byKey.set(key, line);
  }
  return [...byKey.values()].sort((a, b) => (a.costCenter ?? '').localeCompare(b.costCenter ?? '') || a.currency.localeCompare(b.currency));
}

/** Totals per currency over reports. */
export function processingTotals(reports: readonly ProcessingReport[]): { currency: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const r of reports) for (const l of r.lines) totals.set(l.currency, cents((totals.get(l.currency) ?? 0) + l.amount));
  return [...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => ({ currency, amount }));
}

export interface ProcessingTextLabels {
  title: string;
  name: string;
  personnelNumber: string;
  costCenter: string;
  amount: string;
  submitted: string;
  workflowId: string;
  total: string;
}

/**
 * The text for accounting: a title, a tab-separated header and one row per report and cost centre
 * (pastes into a spreadsheet or a mail), and the totals per currency.
 */
export function processingText(
  reports: readonly ProcessingReport[],
  labels: ProcessingTextLabels,
  format: { money: (amount: number) => string; date: (iso: string) => string },
): string {
  const rows = [[labels.name, labels.personnelNumber, labels.costCenter, labels.amount, labels.submitted, labels.workflowId]];
  for (const r of reports) {
    for (const l of r.lines) {
      rows.push([
        r.name,
        r.personnelNumber || '—',
        l.costCenter ?? '—',
        `${l.currency} ${format.money(l.amount)}`,
        r.dateSubmitted ? format.date(r.dateSubmitted.slice(0, 10)) : '—',
        r.workflowId ?? '—',
      ]);
    }
  }
  const totals = processingTotals(reports).map((t) => `${labels.total} ${t.currency} ${format.money(t.amount)}`);
  return [labels.title, '', ...rows.map((r) => r.join('\t')), '', ...totals].join('\n');
}

/** The same rows for a CSV file: amounts as numbers, the currency in its own column, dates as YYYY-MM-DD. */
export function processingCsvRows(reports: readonly ProcessingReport[]): (string | number)[][] {
  return reports.flatMap((r) =>
    r.lines.map((l) => [r.name, r.personnelNumber, l.costCenter ?? '', l.currency, l.amount, r.dateSubmitted?.slice(0, 10) ?? '', r.workflowId ?? '']),
  );
}
