import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Button } from './Button';
import { AI_LEVELS, AI_REASONING, type AiLevel, type AiOwnAzure, type AiSettings } from '@worktime3/shared/ai';
import { swissLocale } from './localeFormat';
import { useI18n } from './i18n';
import { formatMoney } from './localeFormat';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface AiSettingsResponse {
  settings: AiSettings;
  azure: boolean;
  canConfigure: boolean;
  /** The levels the organization can use now; the instance's (for the operator's maximum). */
  levels: AiLevel[];
  instanceLevels: AiLevel[];
  /** May enter the organization's own Azure resource; a key is stored; the server can store one (DOCUMENTS_KEY). */
  canOwn: boolean;
  ownKeyStored: boolean;
  /** The stored key's last four characters. */
  ownKeyHint: string | null;
  ownPossible: boolean;
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
  const [maxLevel, setMaxLevel] = useState<AiLevel>('standard');
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
      setMaxLevel(body.settings.maxLevel ?? 'standard');
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
        body: JSON.stringify({ monthlyLimitChf: limit, maxLevel }),
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
      <Typography variant="subtitle2" sx={{ pt: 1 }}>{t('ai.levels.title')}</Typography>
      <Typography variant="body2" color="text.secondary">
        {data.settings.own ? t('ai.levels.own') : t('ai.levels.instance')}{' '}
        {t('ai.levels.available', { levels: data.levels.map((l) => t(`ai.level.${l}`)).join(', ') || '–' })}
      </Typography>
      {!data.settings.own && (
        <TextField select size="small" label={t('ai.levels.max')} value={maxLevel} disabled={!canConfigure || saving} sx={{ width: 260 }}
          onChange={(e) => setMaxLevel(e.target.value as AiLevel)} helperText={t('ai.levels.maxHelp')}>
          {AI_LEVELS.map((l) => (
            <MenuItem key={l} value={l} disabled={!data.instanceLevels.includes(l)}>{t(`ai.level.${l}`)}{data.instanceLevels.includes(l) ? '' : ` (${t('ai.levels.notSetUp')})`}</MenuItem>
          ))}
        </TextField>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert severity="success">{notice}</Alert>}
      {canConfigure && (
        <Box>
          <Button variant="contained" disabled={saving || !Number.isFinite(limit) || limitText.trim() === ''} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </Box>
      )}
      {(data.canOwn || data.settings.own) && (
        <OwnAzure url={url} own={data.settings.own ?? null} keyStored={data.ownKeyStored} keyHint={data.ownKeyHint} canEdit={data.canOwn} possible={data.ownPossible}
          authHeaders={authHeaders} onSaved={() => void load()} errorText={errorText} />
      )}
    </Stack>
  );
}

/**
 * The organization's own Azure OpenAI resource: endpoint, key and a deployment per level (standard required),
 * with a reasoning effort for a reasoning model. Saving tries every deployment (a tiny call billed to the
 * organization) and keeps it only when Azure answers from Switzerland. The key is never shown again.
 */
function OwnAzure({ url, own, keyStored, keyHint, canEdit, possible, authHeaders, onSaved, errorText }: {
  url: string;
  own: AiOwnAzure | null;
  keyStored: boolean;
  keyHint: string | null;
  canEdit: boolean;
  possible: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  onSaved: () => void;
  errorText: (code: string) => string;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(!!own);
  const [endpoint, setEndpoint] = useState(own?.endpoint ?? '');
  const [key, setKey] = useState('');
  const [deployments, setDeployments] = useState<Partial<Record<AiLevel, string>>>(own?.deployments ?? {});
  const [reasoning, setReasoning] = useState<Partial<Record<AiLevel, string>>>(own?.reasoning ?? {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const send = async (method: 'PUT' | 'DELETE') => {
    if (method === 'DELETE' && !confirm(t('ai.own.removeConfirm'))) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await fetch(`${url}/own`, {
        method,
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: method === 'PUT' ? JSON.stringify({ endpoint, deployments, reasoning, ...(key.trim() ? { key: key.trim() } : {}) }) : undefined,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        const code = body?.error ?? body?.message ?? '';
        setError(code === 'ai-own-region'
          ? t('ai.error.ai-own-region', { region: body?.region ?? '?' })
          : `${errorText(code)}${body?.level ? ` (${t(`ai.level.${body.level}`)})` : ''}`);
        return;
      }
      setKey('');
      setNotice(t(method === 'PUT' ? 'ai.own.saved' : 'ai.own.removed'));
      if (method === 'DELETE') { setEndpoint(''); setDeployments({}); setReasoning({}); setOpen(false); }
      onSaved();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={1.5} sx={{ pt: 1 }}>
      <Typography variant="subtitle2">{t('ai.own.title')}</Typography>
      <Typography variant="body2" color="text.secondary">{t('ai.own.intro')}</Typography>
      {own && (
        <Alert severity="success">
          {t('ai.own.active', { region: own.region, date: own.checkedAt ? new Date(own.checkedAt).toLocaleDateString(swissLocale(locale)) : '–' })}
        </Alert>
      )}
      {!possible && <Alert severity="info">{t('ai.own.notPossible')}</Alert>}
      {canEdit && possible && !open && <Box><Button variant="outlined" onClick={() => setOpen(true)}>{t('ai.own.setUp')}</Button></Box>}
      {open && (
        <>
          <TextField size="small" label={t('ai.own.endpoint')} value={endpoint} disabled={!canEdit || busy} placeholder="https://<name>.openai.azure.com"
            onChange={(e) => setEndpoint(e.target.value)} sx={{ maxWidth: 520 }} />
          <TextField size="small" type="password" autoComplete="off" label={t('ai.own.key')} value={key} disabled={!canEdit || busy}
            onChange={(e) => setKey(e.target.value)} sx={{ maxWidth: 520 }}
            helperText={keyStored ? t('ai.own.keyStored', { hint: keyHint ? `…${keyHint}` : '' }) : t('ai.own.keyHelp')} />
          {AI_LEVELS.map((level) => (
            <Stack key={level} direction="row" spacing={1} useFlexGap flexWrap="wrap">
              <TextField size="small" label={`${t('ai.own.deployment')} · ${t(`ai.level.${level}`)}`} value={deployments[level] ?? ''}
                disabled={!canEdit || busy} required={level === 'standard'} sx={{ width: 300 }}
                onChange={(e) => setDeployments((d) => ({ ...d, [level]: e.target.value }))} />
              <TextField select size="small" label={t('ai.own.reasoning')} value={reasoning[level] ?? ''} disabled={!canEdit || busy || !deployments[level]?.trim()}
                sx={{ width: 220 }} onChange={(e) => setReasoning((r) => ({ ...r, [level]: e.target.value || undefined }))}>
                <MenuItem value="">{t('ai.own.reasoningNone')}</MenuItem>
                {AI_REASONING.map((r) => <MenuItem key={r} value={r}>{t(`ai.reasoning.${r}`)}</MenuItem>)}
              </TextField>
            </Stack>
          ))}
          <Typography variant="caption" color="text.secondary">{t('ai.own.checkHelp')}</Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {notice && <Alert severity="success">{notice}</Alert>}
          {canEdit && (
            <Stack direction="row" spacing={1}>
              <Button variant="contained" disabled={busy || !endpoint.trim() || !deployments.standard?.trim() || (!keyStored && !key.trim())} onClick={() => void send('PUT')}>
                {t(busy ? 'ai.own.checking' : 'ai.own.save')}
              </Button>
              {own && <Button color="error" disabled={busy} onClick={() => void send('DELETE')}>{t('ai.own.remove')}</Button>}
            </Stack>
          )}
        </>
      )}
      {!open && (error || notice) && <Alert severity={error ? 'error' : 'success'}>{error || notice}</Alert>}
    </Stack>
  );
}
