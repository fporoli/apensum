/**
 * Expense rows as the API returns them. Kept in the core because the Workflow page (Approvals.tsx)
 * shows the expenses of a report under approval; the expenses plugin (plugins/expenses) imports it
 * from the plugin contract.
 */
export interface ExpenseRow {
  id: string;
  expense_date: string;
  category: string;
  sub_category: string | null;
  original_value: string | null;
  original_currency: string | null;
  currency: string;
  value: string;
  quantity: string | null;
  comment: string | null;
  project_id: string | null;
  subproject_id: string | null;
  project_name: string | null;
  subproject_name: string | null;
  expense_report_id: string | null;
  expense_report_status: string | null;
  document_id: string | null;
  exchange_rate?: string | null;
  unit_rate?: string | null;
  data?: Record<string, unknown> | null;
}

/** An expense report's title: the date it was submitted (dd.mm.yyyy), '—' before. */
export function getExpenseReportTitle(report: { date_submitted: string | null }): string {
  if (!report.date_submitted) return '—';
  const [y, m, d] = report.date_submitted.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}
