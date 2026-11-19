import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import {
  CASE_AI_DRAFT,
  CASE_AI_SUMMARY,
  CASE_AI_TRANSCRIPTION,
  type CaseAiSettings,
} from '@worktime3/shared/cases';
import { useI18n } from './i18n';
import { swissLocale } from './localeFormat';
import { caseErrorText } from './CaseInterviewEditor';
import { SectionPaper } from './SettingsSection';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface AiSettingsResponse {
  settings: CaseAiSettings;
  available: { whisper: boolean; azureTranscription: boolean; azureOpenai: boolean; instance: 'gemini' | 'openai' | null };
  canConfigure: boolean;
  usage: { orgSpentChf: number; orgCalls: number; instanceSpentChf?: number; instanceBudgetChf?: number | null };
}

/**
 * Cases -> Assessment templates: which providers transcribe, summarize and draft for this
 * organization, and this month's Azure spend against its limit. Everyone with Cases sees it;
 * only a superdeveloper changes it (the instance owner pays Azure), and only they see the
 * whole server's spend.
 */
export function CaseAiSettingsPanel({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<AiSettingsResponse | null>(null);
  const [form, setForm] = useState<CaseAiSettings | null>(null);
  const [limitText, setLimitText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const url = `${API}/organizations/${orgId}/case-ai-settings`;
  const chf = (n: number) => new Intl.NumberFormat(swissLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  const errorText = (code: unknown) => caseErrorText(typeof code === 'string' ? code : '', t, 'cases.ai.error.') ?? t('cases.interviews.operationFailed');

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { headers: await authHeaders(), cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message ?? body?.error);
      setData(body);
      setForm(body.settings);
      setLimitText(String(body.settings.monthlyLimitChf));
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : ''));
    }
    // errorText only depends on t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, authHeaders, t]);

  useEffect(() => { void load(); }, [load]);

  if (!data || !form) return error ? <Alert severity="error">{error}</Alert> : null;

  const { available, canConfigure, usage } = data;
  const instanceLabel = available.instance
    ? t('cases.ai.settings.instance', { provider: t(`cases.ai.provider.${available.instance}`) })
    : t('cases.ai.settings.instanceNone');
  const optionLabel = (value: string, usable: boolean) => {
    const name = value === 'instance' ? instanceLabel : t(`cases.ai.provider.${value}`);
    return usable ? name : `${name} (${t('cases.ai.settings.notAvailable')})`;
  };
  const usableTranscription = (v: string) => (v === 'azure' ? available.azureTranscription : available.whisper);
  const usableText = (v: string) => (v === 'azure' ? available.azureOpenai : v === 'instance' ? available.instance !== null : true);
  const limit = Number(limitText.replace(',', '.'));

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, monthlyLimitChf: limit }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message ?? body?.error);
      setNotice(t('cases.ai.settings.saved'));
      await load();
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : ''));
    } finally {
      setSaving(false);
    }
  };

  const select = (field: 'transcription' | 'summary' | 'draft', label: string, values: readonly string[], usable: (v: string) => boolean) => (
    <TextField select size="small" label={label} value={form[field]} disabled={!canConfigure || saving} sx={{ minWidth: 260 }}
      onChange={(e) => setForm({ ...form, [field]: e.target.value } as CaseAiSettings)}>
      {values.map((v) => (
        <MenuItem key={v} value={v} disabled={!usable(v) && form[field] !== v}>{optionLabel(v, usable(v))}</MenuItem>
      ))}
    </TextField>
  );

  return (
    <SectionPaper title={t('cases.ai.settings.title')} subtitle={t('cases.ai.settings.intro')}>
      <Typography variant="subtitle2" sx={{ pt: 1 }}>{t('cases.ai.settings.casesGroup')}</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
        {select('transcription', t('cases.ai.settings.transcription'), CASE_AI_TRANSCRIPTION, usableTranscription)}
        {select('summary', t('cases.ai.settings.summary'), CASE_AI_SUMMARY, usableText)}
        {select('draft', t('cases.ai.settings.draft'), CASE_AI_DRAFT, usableText)}
      </Stack>
      <Typography variant="subtitle2" sx={{ pt: 1 }}>{t('cases.ai.settings.costGroup')}</Typography>
      <TextField size="small" label={t('cases.ai.settings.limit')} value={limitText} disabled={!canConfigure || saving}
        onChange={(e) => setLimitText(e.target.value)} inputProps={{ inputMode: 'decimal' }} sx={{ width: 220 }}
        helperText={t('cases.ai.settings.limitHelp')} />
      <Stack spacing={0.5}>
        <Typography variant="body2">
          {t('cases.ai.settings.orgUsage', { spent: chf(usage.orgSpentChf), limit: chf(form.monthlyLimitChf), calls: String(usage.orgCalls) })}
        </Typography>
        {usage.instanceSpentChf !== undefined && usage.instanceBudgetChf && (
          <Typography variant="body2" color="text.secondary">
            {t('cases.ai.settings.instanceUsage', { spent: chf(usage.instanceSpentChf), budget: chf(usage.instanceBudgetChf) })}
          </Typography>
        )}
        {!canConfigure && <Typography variant="caption" color="text.secondary">{t('cases.ai.settings.readOnly')}</Typography>}
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
    </SectionPaper>
  );
}
