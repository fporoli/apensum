import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import {
  CASE_AI_DRAFT,
  CASE_AI_SUMMARY,
  CASE_AI_TRANSCRIPTION,
  type CaseAiSettings,
} from '../shared/cases';
import { useI18n } from '@worktime3/web/plugin';
import { caseErrorText } from './CaseInterviewEditor';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface AiSettingsResponse {
  settings: CaseAiSettings;
  available: { azureTranscription: boolean; azureOpenai: boolean };
  canConfigure: boolean;
}

/**
 * Organization settings -> AI and costs, the Cases part: which providers transcribe, summarize and
 * draft for this organization (only Azure in Switzerland receives Cases data). Everyone with Cases or
 * Organization settings sees it; a superdeveloper or whoever edits Organization settings changes it.
 * The monthly limit that caps Azure, and the spend, are the core's (AiSettingsPanel, superdeveloper).
 */
export function CaseAiSettingsPanel({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t } = useI18n();
  const [data, setData] = useState<AiSettingsResponse | null>(null);
  const [form, setForm] = useState<CaseAiSettings | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const url = `${API}/organizations/${orgId}/case-ai-settings`;
  const errorText = (code: unknown) => caseErrorText(typeof code === 'string' ? code : '', t, 'cases.ai.error.') ?? t('cases.interviews.operationFailed');

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { headers: await authHeaders(), cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) throw new Error(body?.message ?? body?.error);
      setData(body);
      setForm(body.settings);
    } catch (e) {
      setError(errorText(e instanceof Error ? e.message : ''));
    }
    // errorText only depends on t
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, authHeaders, t]);

  useEffect(() => { void load(); }, [load]);

  if (!data || !form) return error ? <Alert severity="error">{error}</Alert> : null;

  const { available, canConfigure } = data;
  const optionLabel = (field: 'transcription' | 'summary' | 'draft', value: string, usable: boolean) => {
    const name = field === 'draft' && value === 'off' ? t('cases.ai.settings.draftOff') : t(`cases.ai.provider.${value}`);
    return usable ? name : `${name} (${t('cases.ai.settings.notAvailable')})`;
  };
  const usableTranscription = (v: string) => (v === 'azure' ? available.azureTranscription : true);
  const usableText = (v: string) => (v === 'azure' ? available.azureOpenai : true);

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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
    <TextField id={`case-ai-${field}`} select size="small" label={label} value={form[field]} disabled={!canConfigure || saving} sx={{ minWidth: 260 }}
      onChange={(e) => setForm({ ...form, [field]: e.target.value } as CaseAiSettings)}>
      {values.map((v) => (
        <MenuItem key={v} value={v} disabled={!usable(v) && form[field] !== v}>{optionLabel(field, v, usable(v))}</MenuItem>
      ))}
    </TextField>
  );

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2" sx={{ pt: 1 }}>{t('cases.ai.settings.casesGroup')}</Typography>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
        {select('transcription', t('cases.ai.settings.transcription'), CASE_AI_TRANSCRIPTION, usableTranscription)}
        {select('summary', t('cases.ai.settings.summary'), CASE_AI_SUMMARY, usableText)}
        {select('draft', t('cases.ai.settings.draft'), CASE_AI_DRAFT, usableText)}
      </Stack>
      {!canConfigure && <Typography variant="caption" color="text.secondary">{t('cases.ai.settings.readOnly')}</Typography>}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {canConfigure && (
        <Box>
          <Button variant="contained" disabled={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </Box>
      )}
    </Stack>
  );
}
