import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, LinearProgress, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { MILEAGE_CATEGORY } from '../shared/booking';
import { formatLocaleDate, formatMoney, useI18n, type PluginWorkflowInspectProps } from '@worktime3/web/plugin';
import { processingText, type ProcessingReport } from '../shared/processing';
import type { ExpenseRow } from './expenseRows';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface StaticDataRow {
  enum_name: string;
  values: Record<string, string>;
  translation?: Record<string, Record<string, string>> | null;
}

/** The Workflow page's "Inspect" dialog for an expense report: its expenses, total and receipts. */
export default function ExpenseReportReview({ open, orgId, authHeaders, record, actionItemId, step, onClose, onApprove, onReject }: PluginWorkflowInspectProps & { open: boolean }) {
  const { t, locale } = useI18n();
  // The processing step: the same text for accounting as on the Expense processing page.
  const processing = !!actionItemId && step?.key === 'processing';
  const [accounting, setAccounting] = useState<ProcessingReport | null>(null);
  useEffect(() => {
    if (!open || !processing) return;
    let cancelled = false;
    setAccounting(null);
    void (async () => {
      try {
        const rows = await (await fetch(`${API}/organizations/${orgId}/expense-processing`, { headers: await authHeaders() })).json();
        if (!cancelled && Array.isArray(rows)) setAccounting((rows as ProcessingReport[]).find((r) => r.id === record.id) ?? null);
      } catch { /* shown without it */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, processing, record.id]);
  const accountingText = processing && accounting
    ? processingText(
        [accounting],
        {
          title: t('expenseProcessing.text.title', { date: formatLocaleDate(new Date().toLocaleDateString('sv'), locale), count: '1' }),
          name: t('expenseProcessing.col.name'),
          personnelNumber: t('expenseProcessing.col.personnelNumber'),
          costCenter: t('expenseProcessing.col.costCenter'),
          amount: t('expenseProcessing.col.amount'),
          submitted: t('expenseProcessing.submitted'),
          workflowId: t('expenseProcessing.col.workflowId'),
          total: t('expenseProcessing.total'),
        },
        { money: (n) => formatMoney(n, locale), date: (d) => formatLocaleDate(d, locale) },
      )
    : '';
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<StaticDataRow | null>(null);
  const [subCategory, setSubCategory] = useState<StaticDataRow | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setExpenses([]);
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const headers = await authHeaders();
        const [itemsRes, staticRes] = await Promise.all([
          fetch(`${API}/expense-reports/${record.id}/items`, { headers }),
          fetch(`${API}/organizations/${orgId}/static-data/expenses`, { headers }),
        ]);
        const [items, rows] = await Promise.all([itemsRes.json(), staticRes.json()]);
        if (cancelled) return;
        setExpenses(Array.isArray(items) ? items : []);
        if (Array.isArray(rows)) {
          setCategory((rows as StaticDataRow[]).find((r) => r.enum_name === 'expense_category') ?? null);
          setSubCategory((rows as StaticDataRow[]).find((r) => r.enum_name === 'expense_subcategory') ?? null);
        }
      } catch {
        if (!cancelled) setError(t('approvals.loadReportFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, record.id, orgId]);

  function categoryLabel(row: ExpenseRow): string {
    const cat = category?.translation?.[locale]?.[row.category] ?? category?.values[row.category]
      ?? (row.category === MILEAGE_CATEGORY ? t('expenses.mileage') : row.category);
    if (!row.sub_category) return cat;
    const subKey = `${row.category}$${row.sub_category}`;
    const sub = subCategory?.translation?.[locale]?.[subKey] ?? subCategory?.values[subKey] ?? row.sub_category;
    return `${cat} / ${sub}`;
  }

  const totalLabel = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of expenses) {
      const v = Number(e.value);
      if (Number.isFinite(v)) totals.set(e.currency, (totals.get(e.currency) ?? 0) + v);
    }
    return [...totals.entries()].map(([currency, sum]) => `${formatMoney(sum, locale)} ${currency}`).join(' + ');
  }, [expenses, locale]);

  async function downloadReceipt(expenseId: string) {
    try {
      const res = await fetch(`${API}/expenses/${expenseId}/document`, { headers: await authHeaders() });
      const disposition = res.headers.get('content-disposition') ?? '';
      const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'receipt';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* offline */
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('approvals.reviewReportFor', { name: record.user_display_name })}</DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">{record.user_email}</Typography>
          {totalLabel && <Chip label={`${t('approvals.total')}: ${totalLabel}`} color="primary" variant="outlined" />}
        </Box>
        {expenses.length === 0 && !loading ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('approvals.noExpenses')}</Typography>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common.date')}</TableCell>
                  <TableCell>{t('approvals.category')}</TableCell>
                  <TableCell align="right">{t('approvals.value')}</TableCell>
                  <TableCell>{t('common.project')}</TableCell>
                  <TableCell>{t('common.subproject')}</TableCell>
                  <TableCell>{t('common.comment')}</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {expenses.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>{formatLocaleDate(e.expense_date, locale)}</TableCell>
                    <TableCell>{categoryLabel(e)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatMoney(Number(e.value), locale)} {e.currency}</TableCell>
                    <TableCell>{e.project_name ?? '—'}</TableCell>
                    <TableCell>{e.subproject_name ?? '—'}</TableCell>
                    <TableCell>{e.comment ?? '—'}</TableCell>
                    <TableCell align="right">
                      {e.document_id && <Button size="small" onClick={() => void downloadReceipt(e.id)}>{t('approvals.receipt')}</Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
        {processing && accounting && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('expenseProcessing.dialog.title')}</Typography>
            <Box component="pre" sx={{ m: 0, p: 1.5, borderRadius: 1, bgcolor: 'action.hover', fontSize: '0.8rem', whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
              {accountingText}
            </Box>
            <Button size="small" sx={{ mt: 1 }} onClick={() => void navigator.clipboard.writeText(accountingText).catch(() => {})}>
              {t('expenseProcessing.copy')}
            </Button>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        {actionItemId && (
          <>
            {step?.rejectable !== false && <Button color="error" onClick={() => onReject(actionItemId)}>{t('approvals.reject')}…</Button>}
            <Button variant="contained" onClick={() => onApprove(actionItemId)}>{t(step?.actionKey ?? 'approvals.approve')}</Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
