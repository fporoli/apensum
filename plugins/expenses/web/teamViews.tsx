import { Box, Chip } from '@mui/material';
import { formatLocaleDateTime, StatusChip, TeamDetailTable, totalsByCurrency, type PluginTeamView } from '@worktime3/web/plugin';

interface ExpenseRow {
  id: string;
  user_id: string;
  expense_date: string;
  category: string;
  sub_category: string | null;
  value: number;
  currency: string;
  comment: string | null;
  project_name: string | null;
  report_status: string | null;
}

interface ReportRow {
  id: string;
  user_id: string;
  status: string;
  date_submitted: string | null;
  items: number;
  total: number;
  currency: string | null;
  currencies: number;
}

/** The Team tab of Expenses and Expense reports (rows: api/team-views.ts). */
export const EXPENSE_TEAM_VIEWS: PluginTeamView[] = [
  {
    kind: 'expenses',
    table: ({ rows, t, byUser, money, date }) => {
      const list = rows as ExpenseRow[];
      return {
        headers: [t('team.col.entries'), t('team.col.total'), t('team.col.notInReport')],
        cells: (id) => {
          const mine = byUser(list, id);
          const loose = mine.filter((e) => !e.report_status).length;
          return [mine.length, money(totalsByCurrency(mine)), loose ? <Chip size="small" color="warning" variant="outlined" label={loose} /> : '—'];
        },
        details: (id) => (
          <TeamDetailTable
            headers={[t('team.col.date'), t('team.col.category'), t('team.col.project'), t('team.col.total'), t('team.col.report'), t('team.col.note')]}
            rows={byUser(list, id).map((e) => [
              date(e.expense_date),
              [e.category, e.sub_category].filter(Boolean).join(' / '),
              e.project_name ?? '—',
              money([[e.currency, Number(e.value)]]),
              e.report_status ? <StatusChip status={e.report_status} prefix="expenseReports.status" /> : '—',
              e.comment ?? '',
            ])}
          />
        ),
      };
    },
  },
  {
    kind: 'expenseReports',
    table: ({ rows, t, locale, byUser, money }) => {
      const list = rows as ReportRow[];
      return {
        headers: [t('team.col.reports'), t('team.col.total'), t('timesheet.status')],
        cells: (id) => {
          const mine = byUser(list, id);
          const statuses = [...new Set(mine.map((r) => r.status))];
          return [
            mine.length,
            money(totalsByCurrency(mine.filter((r) => r.currencies <= 1).map((r) => ({ value: r.total, currency: r.currency })))),
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>{statuses.map((s) => <StatusChip key={s} status={s} prefix="expenseReports.status" />)}</Box>,
          ];
        },
        details: (id) => (
          <TeamDetailTable
            headers={[t('team.col.submittedAt'), t('timesheet.status'), t('team.col.entries'), t('team.col.total')]}
            rows={byUser(list, id).map((r) => [
              r.date_submitted ? formatLocaleDateTime(r.date_submitted, locale) : '—',
              <StatusChip status={r.status} prefix="expenseReports.status" />,
              r.items,
              r.currencies > 1 ? t('team.mixedCurrencies') : money(r.currency ? [[r.currency, Number(r.total)]] : []),
            ])}
          />
        ),
      };
    },
  },
];
