import { lazy, Suspense } from 'react';
import { defineWebPlugin, FolderCopyIcon, formatLocaleDate, formatMoney, PaymentsIcon, ReceiptLongIcon, TeamView } from '@worktime3/web/plugin';
import { getExpenseReportTitle } from './expenseRows';
import { parseReceiptHash } from './receiptHash';
import { EXPENSE_TEXTS } from './texts';
import { EXPENSES_REPORT } from '../shared/report';
import { EXPENSE_TEAM_VIEWS } from './teamViews';

const Expenses = lazy(() => import('./Expenses'));
const ExpenseReports = lazy(() => import('./ExpenseReports'));
const ExpenseProcessing = lazy(() => import('./ExpenseProcessing'));
const ExchangeRateSettings = lazy(() => import('./ExchangeRateSettings'));
const AllowanceSettings = lazy(() => import('./AllowanceSettings'));
const PhoneUpload = lazy(() => import('./PhoneUpload'));
const ExpenseReportReview = lazy(() => import('./ExpenseReportReview'));

export default defineWebPlugin({
  id: 'expenses',
  texts: EXPENSE_TEXTS,
  navGroups: [{ id: 'expenses', header: 'nav.expensesGroup', after: 'projectTracking' }],
  pages: [
    {
      section: 'expenses',
      hash: '#/expenses',
      object: 'nav.expenses',
      nav: { group: 'expenses', label: 'nav.expenses', icon: <ReceiptLongIcon fontSize="small" /> },
      homeAction: { label: 'dashboard.addExpense', icon: <ReceiptLongIcon fontSize="small" />, after: 'absences' },
      render: ({ orgId, userId, authHeaders }) => (
        <TeamView orgId={orgId} kind="expenses" authHeaders={authHeaders} renderOwn={() => <Expenses orgId={orgId} userId={userId} authHeaders={authHeaders} />} />
      ),
    },
    {
      section: 'expenseReports',
      hash: '#/expense-reports',
      object: 'nav.expenseReports',
      nav: { group: 'expenses', label: 'nav.expenseReports', icon: <FolderCopyIcon fontSize="small" /> },
      render: ({ orgId, userId, authHeaders }) => (
        <TeamView orgId={orgId} kind="expenseReports" authHeaders={authHeaders} renderOwn={() => <ExpenseReports orgId={orgId} userId={userId} authHeaders={authHeaders} />} />
      ),
    },
    {
      section: 'expenseProcessing',
      hash: '#/expense-processing',
      object: 'nav.expenseProcessing',
      allowedByRole: (r) => r.isHr,
      nav: { group: 'expenses', after: 'expenseReports', label: 'nav.expenseProcessing', icon: <PaymentsIcon fontSize="small" /> },
      render: ({ orgId, userId, authHeaders }) => <ExpenseProcessing orgId={orgId} userId={userId} authHeaders={authHeaders} />,
    },
  ],
  orgSettings: [
    {
      id: 'org.exchangeRates',
      title: (t) => t('exchangeRates.title'),
      subtitle: (t, org) => t('exchangeRates.subtitle', { currency: org.defaultCurrency || '—' }),
      render: ({ orgId, authHeaders }) => <ExchangeRateSettings orgId={orgId} authHeaders={authHeaders} />,
    },
    {
      // Flat-rate expenses (Pauschalspesen): the organization's amounts per type, from its expense regulations.
      id: 'org.expenseAllowances',
      title: (t) => t('expenses.allowances.title'),
      subtitle: (t) => t('expenses.allowances.subtitle'),
      render: ({ orgId, authHeaders }) => <AllowanceSettings orgId={orgId} authHeaders={authHeaders} />,
    },
  ],
  // A phone that scanned the expense form's QR code gets the receipt page alone, without signing in.
  publicRoutes: [
    {
      match: (hash) => parseReceiptHash(hash),
      render: (m) => {
        const handoff = m as { token: string; lang: string | null };
        return (
          <Suspense fallback={null}>
            <PhoneUpload token={handoff.token} lang={handoff.lang} />
          </Suspense>
        );
      },
    },
  ],
  workflowKinds: [
    {
      definitionName: 'approve expense report',
      recordField: 'expense_report',
      label: (t) => t('approvals.kind.expenseReport'),
      source: { name: 'Expense Report', label: (t) => t('approvals.source.expenseReport') },
      title: { sourceName: 'getExpenseReportTitle', get: (r) => getExpenseReportTitle({ date_submitted: typeof r.date_submitted === 'string' ? r.date_submitted : null }) },
      Inspect: (props) => (
        <Suspense fallback={null}>
          <ExpenseReportReview {...props} />
        </Suspense>
      ),
    },
  ],
  // Receipts on the Documents page (the API part registers them: api/expenses.controller.ts).
  documentCategories: [
    {
      category: 'expense',
      color: 'success',
      after: 'absence',
      staticData: { entity: 'expenses', enum: 'expense_category' },
      describe: (d, { locale, staticLabel }) => {
        const c = d.context;
        const amount = c.value != null && c.value !== '' ? `${formatMoney(Number(c.value), locale)} ${c.currency ?? ''}`.trim() : '';
        const key = String(c.category ?? '');
        return [key ? staticLabel(key) : '', amount, c.comment, formatLocaleDate(d.date, locale)].filter(Boolean).join(' · ');
      },
    },
  ],
  teamViews: EXPENSE_TEAM_VIEWS,
  reports: [EXPENSES_REPORT],
  notificationSections: { expense_reports: 'expenseReports' },
});
