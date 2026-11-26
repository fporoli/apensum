import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Stack, TextField, Typography } from '@mui/material';
import { Button } from './Button';
import type { AiSettings } from '@worktime3/shared/ai';
import { useI18n } from './i18n';
import { formatMoney } from './localeFormat';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface AiSettingsResponse {
  settings: AiSettings;
  azure: boolean;
  canConfigure: boolean;
  usage: { orgSpentChf: number; orgCalls: number; instanceSpentChf?: number; instanceBudgetChf?: number | null };
}

/**
 * Organization settings -> AI and costs: the organization's monthly limit for paid cloud AI calls
 * (every AI function: Cases, receipt reading, ...) and this month's spend (API ai-settings.controller.ts).
 * Whoever sees Organization settings sees it; only an operator changes it and sees the whole
 * server's spend.
 */
export function AiSettingsPanel({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<AiSettingsResponse | null>(null);
  const [limitText, setLimitText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const url = `${API}/organizations/${orgId}/ai-settings`;
  const errorText = (code: string) => {
    const key = `ai.error.${code}`;
    return t(key) === key ? t('common.unknownError') : t(key);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { headers: await authHeaders(), cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message ?? body?.error ?? '');
      setData(body);
      setLimitText(String(body.settings.monthlyLimitChf));
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : ''));
    }
    // errorText only depends on t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, authHeaders, t]);

  useEffect(() => { void load(); }, [load]);

  if (!data) return error ? <Alert severity="error">{error}</Alert> : null;
  const limit = Number(limitText.replace(',', '.'));

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthlyLimitChf: limit }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message ?? body?.error ?? '');
      setNotice(t('ai.settings.saved'));
      await load();
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : ''));
    } finally {
      setSaving(false);
    }
  };

  const { usage, canConfigure } = data;
  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">{t('ai.settings.costGroup')}</Typography>
      <TextField id="ai-limit" size="small" label={t('ai.settings.limit')} value={limitText} disabled={!canConfigure || saving}
        onChange={(e) => setLimitText(e.target.value)} inputProps={{ inputMode: 'decimal' }} sx={{ width: 220 }}
        helperText={t('ai.settings.limitHelp')} />
      <Stack spacing={0.5}>
        <Typography variant="body2">
          {t('ai.settings.orgUsage', { spent: formatMoney(usage.orgSpentChf, locale), limit: formatMoney(data.settings.monthlyLimitChf, locale), calls: String(usage.orgCalls) })}
        </Typography>
        {usage.instanceSpentChf !== undefined && usage.instanceBudgetChf && (
          <Typography variant="body2" color="text.secondary">
            {t('ai.settings.instanceUsage', { spent: formatMoney(usage.instanceSpentChf, locale), budget: formatMoney(usage.instanceBudgetChf, locale) })}
          </Typography>
        )}
        {!canConfigure && <Typography variant="caption" color="text.secondary">{t('ai.settings.readOnly')}</Typography>}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {canConfigure && (
        <Box>
          <Button variant="contained" disabled={saving || !Number.isFinite(limit) || limitText.trim() === ''} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </Box>
      )}
    </Stack>
  );
}
