import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Chip, IconButton, MenuItem, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material';
import { Button } from './Button';
import dayjs from 'dayjs';
import { useI18n } from './i18n';
import { formatLocaleDate, formatLocaleNumber, parseLocaleNumber } from './localeFormat';
import { currencyOptions } from './currencyOptions';
import { TableEmptyRow } from './components';
import { DeleteIcon } from './icons';
import { SectionPaper } from './SettingsSection';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface RateRow { id: string; currency: string; targetCurrency: string; validFrom: string; rate: number; standard?: boolean }

/**
 * Organization settings -> Exchange rates (the core's, exchange-rates.controller.ts): rates kept by hand, with
 * history, over the defaults for every organization. An amount in another currency (e.g. an expense) is converted
 * with the rate in force on its date and keeps it, so changing or deleting a rate here changes nothing converted.
 */
export default function ExchangeRateSettings({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [rates, setRates] = useState<RateRow[]>([]);
  const [reporting, setReporting] = useState('');
  const [editable, setEditable] = useState(false);
  const [currencies, setCurrencies] = useState<{ values: Record<string, string>; translation: Record<string, Record<string, string>> }>({ values: {}, translation: {} });
  const [currency, setCurrency] = useState('');
  const [validFrom, setValidFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [rateText, setRateText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const errorText = (code: unknown) => {
    const key = `exchangeRates.error.${typeof code === 'string' ? code : ''}`;
    return t(key) === key ? t('exchangeRates.saveFailed', { error: String(code ?? '') }) : t(key);
  };

  const load = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const [res, staticRes] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/exchange-rates`, { headers }),
        fetch(`${API}/organizations/${orgId}/static-data/expenses`, { headers }),
      ]);
      const data = await res.json();
      setRates(Array.isArray(data?.rates) ? data.rates : []);
      setReporting(typeof data?.reportingCurrency === 'string' ? data.reportingCurrency : '');
      setEditable(data?.editable === true);
      const rows = await staticRes.json();
      const row = Array.isArray(rows) ? rows.find((r: { enum_name: string }) => r.enum_name === 'currency') : null;
      setCurrencies({ values: row?.values ?? {}, translation: row?.translation ?? {} });
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }, [orgId, authHeaders, t]);

  useEffect(() => { void load(); }, [load]);

  const foreign = useMemo(
    () => currencyOptions(currencies.values, currencies.translation, locale, '').filter((o) => o.value !== reporting),
    [currencies, locale, reporting],
  );
  const rate = parseLocaleNumber(rateText, locale);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/organizations/${orgId}/exchange-rates`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ currency, validFrom, rate }),
      });
      const data = await res.json();
      if (!data?.ok) { setError(errorText(data?.error)); return; }
      setRateText('');
      await load();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setError('');
    try {
      const res = await fetch(`${API}/organizations/${orgId}/exchange-rates/${id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data?.ok) { setError(errorText(data?.error)); return; }
      await load();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  };

  return (
    <SectionPaper title={t('exchangeRates.title')} subtitle={t('exchangeRates.subtitle', { currency: reporting || '—' })}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      {editable && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField id="exchange-rate-currency" select size="small" label={t('expenses.currency')} value={currency} onChange={(e) => setCurrency(e.target.value)} sx={{ minWidth: 180 }}>
            {foreign.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          <TextField id="exchange-rate-valid-from" size="small" type="date" label={t('exchangeRates.validFrom')} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField id="exchange-rate-rate" size="small" label={t('exchangeRates.rate', { currency: currency || '…', target: reporting || '…' })} value={rateText}
            onChange={(e) => setRateText(e.target.value)} inputProps={{ inputMode: 'decimal' }} sx={{ width: 220 }} />
          <Button variant="contained" disabled={busy || !currency || !validFrom || !rate || rate <= 0} onClick={() => void add()}>{t('common.save')}</Button>
        </Box>
      )}
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('expenses.currency')}</TableCell>
              <TableCell>{t('exchangeRates.validFrom')}</TableCell>
              <TableCell align="right">{t('exchangeRates.rateColumn')}</TableCell>
              {editable && <TableCell align="right">{t('common.actions')}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {rates.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  {r.currency}
                  {r.standard && (
                    <Tooltip title={t('exchangeRates.standardHint')}>
                      <Chip size="small" variant="outlined" label={t('exchangeRates.standard')} sx={{ ml: 1 }} />
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell>{formatLocaleDate(r.validFrom, locale)}</TableCell>
                <TableCell align="right">1 {r.currency} = {formatLocaleNumber(r.rate, locale)} {r.targetCurrency}</TableCell>
                {editable && r.standard && <TableCell />}
                {editable && !r.standard && (
                  <TableCell align="right">
                    <Tooltip title={t('common.remove')}>
                      <IconButton size="small" color="error" aria-label={t('common.remove')} onClick={() => void remove(r.id)}><DeleteIcon fontSize="small" /></IconButton>
                    </Tooltip>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {rates.length === 0 && <TableEmptyRow colSpan={editable ? 4 : 3} title={t('exchangeRates.none')} />}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">{t('exchangeRates.hint')}</Typography>
    </SectionPaper>
  );
}
