import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { buildCsv } from '@worktime3/shared/xlsx';
import {
  useI18n, type TFunction, formatLocaleDate, formatMoney, PageHeader, TableEmptyRow, PaymentsIcon, ContentCopyIcon, DownloadIcon,
} from '@worktime3/web/plugin';
import {
  PROCESSABLE_STATUSES, processingCsvRows, processingText, processingTotals, type ProcessingReport,
} from '../shared/processing';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

const PIPELINE = ['approved', 'submitted_processing', 'processing_finished', 'request_payment', 'finished'] as const;
type PipelineStatus = (typeof PIPELINE)[number];
/** The status filter: `open` = not processed yet (the default), or one stage. */
type Filter = 'open' | PipelineStatus;
const FILTERS: Filter[] = ['open', ...PIPELINE];

function stageLabel(status: string, t: TFunction): string {
  return (PIPELINE as readonly string[]).includes(status) ? t(`expenseProcessing.stage.${status}`) : status;
}

/** After processing, the later stages still move on one at a time. */
function nextStage(status: string): PipelineStatus | null {
  if ((PROCESSABLE_STATUSES as readonly string[]).includes(status)) return null;
  const idx = PIPELINE.indexOf(status as PipelineStatus);
  if (idx === -1 || idx === PIPELINE.length - 1) return null;
  return PIPELINE[idx + 1];
}

const KNOWN_ERRORS = ['forbidden', 'not-processable', 'too-many-reports', 'invalid-reports'];

/** Today in the browser's zone, YYYY-MM-DD. */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const isProcessable = (status: string) => (PROCESSABLE_STATUSES as readonly string[]).includes(status);

interface ExpenseProcessingProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function ExpenseProcessing({ orgId, authHeaders }: ExpenseProcessingProps) {
  const { t, locale } = useI18n();
  const [filter, setFilter] = useState<Filter>('open');
  const [rows, setRows] = useState<ProcessingReport[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reload(next: Filter = filter) {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/expense-processing?status=${next}`, { headers: await authHeaders() });
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
      setSelected(new Set());
    } catch {
      setError(t('expenseProcessing.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, filter]);

  const processable = rows.filter((r) => isProcessable(r.status));
  const chosen = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const money = (n: number) => formatMoney(n, locale);
  const text = useMemo(
    () =>
      processingText(
        chosen,
        {
          title: t('expenseProcessing.text.title', { date: formatLocaleDate(localToday(), locale), count: String(chosen.length) }),
          name: t('expenseProcessing.col.name'),
          personnelNumber: t('expenseProcessing.col.personnelNumber'),
          costCenter: t('expenseProcessing.col.costCenter'),
          amount: t('expenseProcessing.col.amount'),
          submitted: t('expenseProcessing.submitted'),
          workflowId: t('expenseProcessing.col.workflowId'),
          total: t('expenseProcessing.total'),
        },
        { money, date: (d) => formatLocaleDate(d, locale) },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosen, locale],
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setSuccess(t('expenseProcessing.copied'));
    } catch {
      setError(t('expenseProcessing.copyFailed'));
    }
  }

  function download() {
    const header = [
      t('expenseProcessing.col.name'), t('expenseProcessing.col.personnelNumber'), t('expenseProcessing.col.costCenter'),
      t('expenseProcessing.col.currency'), t('expenseProcessing.col.amount'), t('expenseProcessing.submitted'), t('expenseProcessing.col.workflowId'),
    ];
    const blob = new Blob([buildCsv(header, processingCsvRows(chosen))], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `expense-processing-${localToday()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function process() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/expense-processing/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ reportIds: chosen.map((r) => r.id) }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(KNOWN_ERRORS.includes(data.error) ? t(`expenseProcessing.error.${data.error}`) : t('expenseProcessing.advanceFailedWith', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setDialogOpen(false);
      setSuccess(t('expenseProcessing.processed', { count: String(data.processed) }));
      await reload();
    } catch {
      setError(t('expenseProcessing.advanceFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function advance(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/expense-reports/${id}/advance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'forbidden' ? t('expenseProcessing.forbidden') : t('expenseProcessing.advanceFailedWith', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setSuccess(t('expenseProcessing.advanced', { stage: stageLabel(data.status, t) }));
      await reload();
    } catch {
      setError(t('expenseProcessing.advanceFailed'));
    }
  }

  const allChosen = processable.length > 0 && processable.every((r) => selected.has(r.id));

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('expenseProcessing.title')} subtitle={t('expenseProcessing.subtitle')} />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', mb: 2 }}>
          <TextField select size="small" label={t('expenseProcessing.stage')} value={filter} onChange={(e) => setFilter(e.target.value as Filter)} sx={{ minWidth: 240 }}>
            {FILTERS.map((f) => (
              <MenuItem key={f} value={f}>{f === 'open' ? t('expenseProcessing.filter.open') : stageLabel(f, t)}</MenuItem>
            ))}
          </TextField>
          <Box sx={{ flex: 1 }} />
          <Button variant="contained" startIcon={<PaymentsIcon />} disabled={chosen.length === 0} onClick={() => { setSuccess(null); setDialogOpen(true); }}>
            {t('expenseProcessing.process', { count: String(chosen.length) })}
          </Button>
        </Box>
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox
                    size="small"
                    disabled={processable.length === 0}
                    checked={allChosen}
                    indeterminate={selected.size > 0 && !allChosen}
                    onChange={() => setSelected(allChosen ? new Set() : new Set(processable.map((r) => r.id)))}
                    inputProps={{ 'aria-label': t('expenseProcessing.selectAll') }}
                  />
                </TableCell>
                <TableCell>{t('expenseProcessing.col.name')}</TableCell>
                <TableCell>{t('expenseProcessing.col.costCenter')}</TableCell>
                <TableCell align="right">{t('expenseProcessing.col.amount')}</TableCell>
                <TableCell>{t('expenseProcessing.submitted')}</TableCell>
                <TableCell>{t('expenseProcessing.col.workflowId')}</TableCell>
                <TableCell>{t('expenseProcessing.stage')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const next = nextStage(row.status);
                return (
                  <TableRow key={row.id} hover selected={selected.has(row.id)}>
                    <TableCell padding="checkbox">
                      {isProcessable(row.status) && (
                        <Checkbox size="small" checked={selected.has(row.id)} onChange={() => toggle(row.id)} inputProps={{ 'aria-label': row.name }} />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{row.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {row.personnelNumber ? t('expenseProcessing.personnelNumberShort', { number: row.personnelNumber }) : t('expenseProcessing.noPersonnelNumber')}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {row.lines.map((l) => <Box key={`${l.costCenter}-${l.currency}`}>{l.costCenter ?? '—'}</Box>)}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {row.lines.map((l) => <Box key={`${l.costCenter}-${l.currency}`}>{`${l.currency} ${money(l.amount)}`}</Box>)}
                    </TableCell>
                    <TableCell>{row.dateSubmitted ? formatLocaleDate(row.dateSubmitted.slice(0, 10), locale) : '—'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{row.workflowId ?? '—'}</TableCell>
                    <TableCell><Chip label={stageLabel(row.status, t)} size="small" color={isProcessable(row.status) ? 'success' : 'info'} /></TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {next && (
                        <Button size="small" onClick={() => void advance(row.id)}>
                          {t('expenseProcessing.advanceTo', { stage: stageLabel(next, t) })}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && !loading && (
                <TableEmptyRow colSpan={8} icon={<PaymentsIcon fontSize="inherit" />} title={t('expenseProcessing.empty')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={dialogOpen} onClose={() => !busy && setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('expenseProcessing.dialog.title')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('expenseProcessing.dialog.hint')}
          </Typography>
          <TextField
            value={text}
            multiline
            fullWidth
            minRows={6}
            maxRows={18}
            InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
          />
          <Box sx={{ mt: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            {processingTotals(chosen).map((tot) => (
              <Typography key={tot.currency} variant="subtitle2">{`${t('expenseProcessing.total')} ${tot.currency} ${money(tot.amount)}`}</Typography>
            ))}
          </Box>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Button startIcon={<ContentCopyIcon />} onClick={() => void copy()}>{t('expenseProcessing.copy')}</Button>
          <Button startIcon={<DownloadIcon />} onClick={download}>{t('expenseProcessing.download')}</Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={() => setDialogOpen(false)} disabled={busy}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void process()} disabled={busy}>
            {t('expenseProcessing.markProcessed', { count: String(chosen.length) })}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
