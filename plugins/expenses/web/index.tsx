import { lazy, Suspense } from 'react';
import { defineWebPlugin, FolderCopyIcon, PaymentsIcon, ReceiptLongIcon, TeamView } from '@worktime3/web/plugin';
import { getExpenseReportTitle } from './expenseRows';
import { parseReceiptHash } from './receiptHash';
import { EXPENSE_TEXTS } from './texts';
import { EXPENSES_REPORT } from '../shared/report';

const Expenses = lazy(() => import('./Expenses'));
const ExpenseReports = lazy(() => import('./ExpenseReports'));
const ExpenseProcessing = lazy(() => import('./ExpenseProcessing'));
const ExchangeRateSettings = lazy(() => import('./ExchangeRateSettings'));
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
      allowedByRole: (r) => r.isAdmin || r.isBillingAdmin,
      nav: { group: 'administration', after: 'audit', label: 'nav.expenseProcessing', icon: <PaymentsIcon fontSize="small" /> },
      render: ({ orgId, authHeaders }) => <ExpenseProcessing orgId={orgId} authHeaders={authHeaders} />,
    },
  ],
  orgSettings: [
    {
      id: 'org.exchangeRates',
      title: (t) => t('exchangeRates.title'),
      subtitle: (t, org) => t('exchangeRates.subtitle', { currency: org.defaultCurrency || '—' }),
      render: ({ orgId, authHeaders }) => <ExchangeRateSettings orgId={orgId} authHeaders={authHeaders} />,
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
  reports: [EXPENSES_REPORT],
  notificationSections: { expense_reports: 'expenseReports' },
});
