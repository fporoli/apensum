/**
 * The expenses report: its definition and texts, shared by the plugin's API part (which adds the rows,
 * api/expense-report.ts) and its web part (the Reports page's tab). docs/PLUGINS.md, "Reports".
 */
import type { ReportDefinition } from '@worktime3/shared/reports';

export const EXPENSES_REPORT_DEFINITION: ReportDefinition = {
  id: 'expenses',
  object: 'nav.expenses',
  dimensions: ['person', 'category', 'project', 'month', 'status', 'currency'],
  defaultGroupBy: ['category'],
  // Amounts in different currencies are never added up.
  alwaysGroupBy: ['currency'],
  measures: [
    { key: 'amount', kind: 'money', aggregate: 'sum' },
    { key: 'count', kind: 'count', aggregate: 'sum' },
  ],
  chart: ['amount'],
  projectFilter: true,
  labels: {
    category: { staticData: { entity: 'expenses', enum: 'expense_category' }, fallback: { mileage: 'reports.expenses.mileage' } },
    // The status of the expense report the expense is in; `none` when it is in none yet.
    status: { textPrefix: 'reports.expenseStatus.' },
  },
};

export const EXPENSES_REPORT_TEXTS: Record<'en' | 'de' | 'fr' | 'it', Record<string, string>> = {
  en: {
    'reports.expenseStatus.in_preparation': 'In preparation',
    'reports.expenseStatus.submitted': 'Submitted',
    'reports.expenseStatus.approved': 'Approved',
    'reports.expenseStatus.rejected': 'Rejected',
    'reports.expenseStatus.submitted_processing': 'Processing',
    'reports.expenseStatus.processing_finished': 'Processing finished',
    'reports.expenseStatus.request_payment': 'Payment requested',
    'reports.expenseStatus.finished': 'Finished',
    'reports.report.expenses': "Expenses",
    'reports.report.expenses.description': "Expenses by category, person, project, month and expense report status, in their currency.",
    'reports.note.expenses': "Expenses by their date; amounts in the currency entered. Status: the expense report they are in.",
    'reports.expenseStatus.none': "Not in an expense report",
    'reports.expenses.mileage': "Mileage",
  },
  de: {
    'reports.expenseStatus.in_preparation': 'In Vorbereitung',
    'reports.expenseStatus.submitted': 'Eingereicht',
    'reports.expenseStatus.approved': 'Genehmigt',
    'reports.expenseStatus.rejected': 'Abgelehnt',
    'reports.expenseStatus.submitted_processing': 'In Bearbeitung',
    'reports.expenseStatus.processing_finished': 'Bearbeitung abgeschlossen',
    'reports.expenseStatus.request_payment': 'Zahlung angefordert',
    'reports.expenseStatus.finished': 'Abgeschlossen',
    'reports.report.expenses': "Spesen",
    'reports.report.expenses.description': "Spesen nach Kategorie, Person, Projekt, Monat und Status der Spesenabrechnung, in ihrer Währung.",
    'reports.note.expenses': "Spesen nach ihrem Datum; Beträge in der erfassten Währung. Status: die Spesenabrechnung, in der sie sind.",
    'reports.expenseStatus.none': "In keiner Spesenabrechnung",
    'reports.expenses.mileage': "Kilometer",
  },
  fr: {
    'reports.expenseStatus.in_preparation': 'En préparation',
    'reports.expenseStatus.submitted': 'Soumis',
    'reports.expenseStatus.approved': 'Approuvé',
    'reports.expenseStatus.rejected': 'Refusé',
    'reports.expenseStatus.submitted_processing': 'En traitement',
    'reports.expenseStatus.processing_finished': 'Traitement terminé',
    'reports.expenseStatus.request_payment': 'Paiement demandé',
    'reports.expenseStatus.finished': 'Terminé',
    'reports.report.expenses': "Frais",
    'reports.report.expenses.description': "Frais par catégorie, personne, projet, mois et statut de la note de frais, dans leur monnaie.",
    'reports.note.expenses': "Frais selon leur date ; montants dans la monnaie saisie. Statut : la note de frais qui les contient.",
    'reports.expenseStatus.none': "Dans aucune note de frais",
    'reports.expenses.mileage': "Kilomètres",
  },
  it: {
    'reports.expenseStatus.in_preparation': 'In preparazione',
    'reports.expenseStatus.submitted': 'Inviata',
    'reports.expenseStatus.approved': 'Approvata',
    'reports.expenseStatus.rejected': 'Respinta',
    'reports.expenseStatus.submitted_processing': 'In elaborazione',
    'reports.expenseStatus.processing_finished': 'Elaborazione completata',
    'reports.expenseStatus.request_payment': 'Pagamento richiesto',
    'reports.expenseStatus.finished': 'Completata',
    'reports.report.expenses': "Spese",
    'reports.report.expenses.description': "Spese per categoria, persona, progetto, mese e stato della nota spese, nella loro valuta.",
    'reports.note.expenses': "Spese secondo la loro data; importi nella valuta registrata. Stato: la nota spese che le contiene.",
    'reports.expenseStatus.none': "In nessuna nota spese",
    'reports.expenses.mileage': "Chilometri",
  },
};

export const EXPENSES_REPORT = { definition: EXPENSES_REPORT_DEFINITION, texts: EXPENSES_REPORT_TEXTS };
