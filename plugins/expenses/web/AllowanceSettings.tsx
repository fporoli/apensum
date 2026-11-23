import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, IconButton, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import dayjs from 'dayjs';
import { useI18n, formatLocaleDate, formatMoney, parseLocaleNumber, TableEmptyRow, DeleteIcon } from '@worktime3/web/plugin';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/**
 * Organization settings -> Flat-rate expenses: the organization's amount per allowance type from a
 * date (from its expense regulations). A type without an amount is not offered on the expense form;
 * expenses keep the amount they were booked with.
 */
export default function AllowanceSettings({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [rates, setRates] = useState<Record<string, Record<string, string>>>({});
  const [labels, setLabels] = useState<Record<string, Record<string, string>>>({});
  const [currency, setCurrency] = useState('');
  const [editable, setEditable] = useState(false);
  const [type, setType] = useState('');
  const [validFrom, setValidFrom] = useState(dayjs().startOf('year').format('YYYY-MM-DD'));
  const [amountText, setAmountText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const label = (key: string) => labels[locale]?.[key] ?? labels.en?.[key] ?? key;
  const errorText = (code: unknown) => {
    const key = `expenses.error.${typeof code === 'string' ? code : ''}`;
    return t(key) === key ? t('expenses.saveFailed', { error: String(code ?? '') }) : t(key);
  };

  const load = useCallback(async () => {
    try {
      const data = await (await fetch(`${API}/organizations/${orgId}/exchange-rates`, { headers: await authHeaders() })).json();
      setRates(data?.allowanceRates && typeof data.allowanceRates === 'object' ? data.allowanceRates : {});
      setLabels(data?.allowanceLabels && typeof data.allowanceLabels === 'object' ? data.allowanceLabels : {});
      setCurrency(typeof data?.reportingCurrency === 'string' ? data.reportingCurrency : '');
      setEditable(data?.editable === true);
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }, [orgId, authHeaders, t]);
  useEffect(() => { void load(); }, [load]);

  async function save(body: { type: string; validFrom: string; amount: number | null }) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/organizations/${orgId}/expense-allowances`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data?.ok) { setError(errorText(data?.error)); return; }
      setRates(data.allowanceRates ?? {});
      if (body.amount !== null) setAmountText('');
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  const types = Object.keys(rates);
  const rows = types.flatMap((key) =>
    Object.entries(rates[key] ?? {}).map(([from, amount]) => ({ key, from, amount: Number(amount) })),
  ).sort((a, b) => label(a.key).localeCompare(label(b.key)) || b.from.localeCompare(a.from));
  const amount = parseLocaleNumber(amountText, locale);

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      <Typography variant="body2" color="text.secondary">{t('expenses.allowances.hint')}</Typography>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('expenses.allowances.type')}</TableCell>
              <TableCell>{t('expenses.allowances.validFrom')}</TableCell>
              <TableCell align="right">{t('expenses.allowances.amount')}</TableCell>
              {editable && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.key}-${r.from}`}>
                <TableCell>{label(r.key)}</TableCell>
                <TableCell>{formatLocaleDate(r.from, locale)}</TableCell>
                <TableCell align="right">{`${formatMoney(r.amount, locale)} ${currency}`}</TableCell>
                {editable && (
                  <TableCell align="right">
                    <IconButton size="small" aria-label={t('common.delete')} disabled={busy} onClick={() => void save({ type: r.key, validFrom: r.from, amount: null })}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {rows.length === 0 && <TableEmptyRow colSpan={editable ? 4 : 3} title={t('expenses.allowances.none')} />}
          </TableBody>
        </Table>
      </TableContainer>
      {editable && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField select size="small" label={t('expenses.allowances.type')} value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 220 }}>
            {types.map((key) => <MenuItem key={key} value={key}>{label(key)}</MenuItem>)}
          </TextField>
          <TextField size="small" type="date" label={t('expenses.allowances.validFrom')} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField size="small" label={`${t('expenses.allowances.amount')}${currency ? ` (${currency})` : ''}`} value={amountText} onChange={(e) => setAmountText(e.target.value)} inputProps={{ inputMode: 'decimal' }} sx={{ width: 150 }} />
          <Button
            variant="contained"
            size="small"
            disabled={busy || !type || !validFrom || typeof amount !== 'number' || !(amount > 0)}
            onClick={() => void save({ type, validFrom, amount: amount as number })}
          >
            {t('expenses.allowances.add')}
          </Button>
        </Box>
      )}
    </Box>
  );
}
