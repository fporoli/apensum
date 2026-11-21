import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';
import { formatLocaleDate, formatSignedMinutes } from './localeFormat';
import { ConfirmDialog, TableEmptyRow } from './components';
import { AccountBalanceWalletIcon, ChevronLeftIcon, ChevronRightIcon } from './icons';
import { formatDays, monthName } from './BalancesPanel';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** One person's year as `GET balance-years` returns it (BalancesService.yearStatus). */
interface YearRow {
  userId: string;
  displayName: string;
  email: string;
  ended: boolean;
  closing: { closedAt: string; incompleteMonths: number; reopenable: boolean } | null;
  values: { overtime: number; legalOvertime: number; vacation: number };
  openMonths: string[];
  previousOpen: boolean;
  canEdit: boolean;
}

type RowState = 'closed' | 'ready' | 'months-open' | 'previous-open' | 'running';

function rowState(r: YearRow): RowState {
  if (r.closing) return 'closed';
  if (!r.ended) return 'running';
  if (r.previousOpen) return 'previous-open';
  return r.openMonths.length > 0 ? 'months-open' : 'ready';
}

const STATE_COLOR: Record<RowState, 'success' | 'info' | 'warning' | 'default'> = {
  closed: 'success',
  ready: 'info',
  'months-open': 'warning',
  'previous-open': 'warning',
  running: 'default',
};

type Pending = { kind: 'close-ready' } | { kind: 'force'; row: YearRow } | { kind: 'close'; row: YearRow } | { kind: 'reopen'; row: YearRow };

/**
 * Year-end closing (Time balances): per person, the overtime, Überzeit and vacation a year ends with, frozen
 * so later years start from there instead of from the first day. Shows who is ready (every month's
 * timesheet approved), who has open months (closed anyway only on purpose) and who is closed; HR closes
 * everyone ready at once, one person anyway, or reopens a person's newest closed year.
 */
export default function YearClosing({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [year, setYear] = useState(() => new Date().getFullYear() - 1);
  const [rows, setRows] = useState<YearRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API}/organizations/${orgId}/balance-years?year=${year}`, { headers: await authHeaders() });
        const body = await res.json();
        if (cancelled) return;
        if (body.ok === false) setError(t(`balances.error.${body.error}`));
        else {
          setRows(Array.isArray(body.rows) ? body.rows : []);
          setError(null);
        }
      } catch {
        if (!cancelled) setError(t('balances.error.load'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, year, refreshKey]);

  const ready = useMemo(() => rows.filter((r) => r.canEdit && rowState(r) === 'ready'), [rows]);
  const counts = useMemo(() => {
    const c: Record<RowState, number> = { closed: 0, ready: 0, 'months-open': 0, 'previous-open': 0, running: 0 };
    for (const r of rows) c[rowState(r)] += 1;
    return c;
  }, [rows]);
  const nameOf = (userId: string) => rows.find((r) => r.userId === userId)?.displayName ?? userId;

  function errorText(r: { error?: string; year?: number; months?: string[] }): string {
    if (r.error === 'months-open') return t('yearClosing.error.months-open', { year: String(r.year ?? year), months: (r.months ?? []).map((m) => monthName(m, locale, 'short')).join(', ') });
    const key = `yearClosing.error.${r.error}`;
    const text = t(key, { year: String(r.year ?? year) });
    return text === key ? t('balances.error.load') : text;
  }

  async function post(path: string, body: unknown) {
    const res = await fetch(`${API}/organizations/${orgId}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function close(userIds: string[], force: boolean) {
    setError(null);
    setNotice(null);
    try {
      const body = await post('balance-years/close', { year, userIds, force });
      if (body.ok === false) {
        setError(t(`balances.error.${body.error}`));
        return;
      }
      const results = (body.results ?? []) as Array<{ userId: string; ok: boolean; error?: string; year?: number; months?: string[] }>;
      const failed = results.filter((r) => !r.ok);
      const done = results.length - failed.length;
      if (failed.length) setError(failed.map((r) => `${nameOf(r.userId)}: ${errorText(r)}`).join('\n'));
      if (done) setNotice(t('yearClosing.closedCount', { count: String(done), year: String(year) }));
    } catch {
      setError(t('balances.error.load'));
    }
    setRefreshKey((k) => k + 1);
  }

  async function reopen(row: YearRow) {
    setError(null);
    setNotice(null);
    try {
      const body = await post('balance-years/reopen', { year, userId: row.userId });
      if (!body.ok) setError(`${row.displayName}: ${errorText(body)}`);
      else setNotice(t('yearClosing.reopened', { name: row.displayName, year: String(year) }));
    } catch {
      setError(t('balances.error.load'));
    }
    setRefreshKey((k) => k + 1);
  }

  function confirmText(p: Pending): { title: string; message: string; label: string } {
    if (p.kind === 'close-ready') {
      return { title: t('yearClosing.closeTitle', { year: String(year) }), message: t('yearClosing.closeReadyConfirm', { count: String(ready.length), year: String(year) }), label: t('yearClosing.close') };
    }
    if (p.kind === 'force') {
      return {
        title: t('yearClosing.closeTitle', { year: String(year) }),
        message: t('yearClosing.forceConfirm', { name: p.row.displayName, months: p.row.openMonths.map((m) => monthName(m, locale, 'short')).join(', ') }),
        label: t('yearClosing.closeAnyway'),
      };
    }
    if (p.kind === 'close') {
      return { title: t('yearClosing.closeTitle', { year: String(year) }), message: t('yearClosing.closeOneConfirm', { name: p.row.displayName, year: String(year) }), label: t('yearClosing.close') };
    }
    return { title: t('yearClosing.reopenTitle', { year: String(year) }), message: t('yearClosing.reopenConfirm', { name: p.row.displayName, year: String(year) }), label: t('yearClosing.reopen') };
  }

  const dialog = pending ? confirmText(pending) : null;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <IconButton size="small" aria-label={t('balances.previousYear')} onClick={() => setYear((y) => y - 1)}>
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Typography variant="h6" sx={{ minWidth: 64, textAlign: 'center' }}>{year}</Typography>
        <IconButton size="small" aria-label={t('balances.nextYear')} onClick={() => setYear((y) => y + 1)}>
          <ChevronRightIcon fontSize="small" />
        </IconButton>
        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', ml: 1 }}>
          {(['closed', 'ready', 'months-open', 'previous-open', 'running'] as const).filter((s) => counts[s] > 0).map((s) => (
            <Chip key={s} size="small" variant="outlined" color={STATE_COLOR[s]} label={`${t(`yearClosing.state.${s}`)}: ${counts[s]}`} />
          ))}
        </Box>
        <Box sx={{ flex: 1 }} />
        {ready.length > 0 && (
          <Button variant="contained" size="small" onClick={() => setPending({ kind: 'close-ready' })}>
            {t('yearClosing.closeReady', { count: String(ready.length) })}
          </Button>
        )}
      </Box>

      {loading && <LinearProgress />}
      {error && <Alert severity="error" onClose={() => setError(null)} sx={{ whiteSpace: 'pre-line' }}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('balanceReport.person')}</TableCell>
              <TableCell>{t('balances.status')}</TableCell>
              <TableCell align="right">{t('yearClosing.overtime')}</TableCell>
              <TableCell align="right">{t('yearClosing.legalOvertime')}</TableCell>
              <TableCell align="right">{t('yearClosing.vacation')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const state = rowState(r);
              const label = state === 'closed' && r.closing
                ? t('yearClosing.closedOn', { date: formatLocaleDate(r.closing.closedAt.slice(0, 10), locale) })
                : state === 'months-open'
                  ? t('yearClosing.monthsOpen', { count: String(r.openMonths.length) })
                  : t(`yearClosing.state.${state}`);
              const tooltip = state === 'months-open'
                ? r.openMonths.map((m) => monthName(m, locale, 'short')).join(', ')
                : state === 'closed' && r.closing && r.closing.incompleteMonths > 0
                  ? t('yearClosing.closedIncomplete', { count: String(r.closing.incompleteMonths) })
                  : state === 'previous-open' ? t('yearClosing.previousOpenHint', { year: String(year - 1) }) : '';
              return (
                <TableRow key={r.userId} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>{r.displayName}</Typography>
                    <Typography variant="caption" color="text.secondary">{r.email}</Typography>
                  </TableCell>
                  <TableCell>
                    <Tooltip title={tooltip}>
                      <Chip size="small" color={STATE_COLOR[state]} variant={state === 'closed' ? 'filled' : 'outlined'} label={label} />
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: state === 'closed' ? 600 : undefined, color: r.values.overtime < 0 ? 'error.main' : undefined }}>
                    {formatSignedMinutes(r.values.overtime)}
                  </TableCell>
                  <TableCell align="right">{r.values.legalOvertime ? formatSignedMinutes(r.values.legalOvertime) : '—'}</TableCell>
                  <TableCell align="right" sx={{ color: r.values.vacation < 0 ? 'error.main' : undefined }}>
                    {t('balances.daysLeft', { value: formatDays(r.values.vacation, locale) })}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {r.canEdit && state === 'closed' && r.closing?.reopenable && (
                      <Button size="small" onClick={() => setPending({ kind: 'reopen', row: r })}>{t('yearClosing.reopen')}</Button>
                    )}
                    {r.canEdit && (state === 'ready' || state === 'previous-open') && (
                      <Button size="small" onClick={() => setPending({ kind: 'close', row: r })}>{t('yearClosing.close')}</Button>
                    )}
                    {r.canEdit && state === 'months-open' && (
                      <Button size="small" color="warning" onClick={() => setPending({ kind: 'force', row: r })}>{t('yearClosing.closeAnyway')}</Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {!loading && rows.length === 0 && (
              <TableEmptyRow colSpan={6} icon={<AccountBalanceWalletIcon fontSize="inherit" />} title={t('balanceReport.empty')} />
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">{t('yearClosing.help')}</Typography>

      <ConfirmDialog
        open={!!pending}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        confirmLabel={dialog?.label ?? ''}
        cancelLabel={t('common.cancel')}
        confirmColor={pending?.kind === 'force' || pending?.kind === 'reopen' ? 'warning' : 'primary'}
        onClose={() => setPending(null)}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (!p) return;
          if (p.kind === 'close-ready') return close(ready.map((r) => r.userId), false);
          if (p.kind === 'force') return close([p.row.userId], true);
          if (p.kind === 'close') return close([p.row.userId], false);
          return reopen(p.row);
        }}
      />
    </Box>
  );
}
