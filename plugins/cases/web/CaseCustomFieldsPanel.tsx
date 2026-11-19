import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, IconButton, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useI18n, AddIcon, DeleteIcon } from '@worktime3/web/plugin';
import { CUSTOM_FIELD_TARGETS, CUSTOM_FIELD_TYPES, validateCustomFieldDefs, type CaseCustomField } from '../shared/cases';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/**
 * Organization settings -> Cases fields: the organization's own fields on cases and assessments. The values are stored
 * with the case (sealed inside it when the case is encrypted); only the definitions are plain settings.
 */
export function CaseCustomFieldsPanel({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t } = useI18n();
  const [fields, setFields] = useState<(CaseCustomField & { optionsText?: string })[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const url = `${API}/organizations/${orgId}/case-custom-fields`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(url, { headers: await authHeaders(), cache: 'no-store' });
      const data = await res.json();
      if (!data?.ok) throw new Error();
      setFields((data.fields as CaseCustomField[]).map((f) => ({ ...f, optionsText: f.options?.join(', ') })));
      setCanEdit(data.canEdit === true);
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }, [url, authHeaders, t]);

  useEffect(() => { void load(); }, [load]);

  const patch = (i: number, p: Partial<CaseCustomField & { optionsText: string }>) => setFields((cur) => cur.map((f, j) => (j === i ? { ...f, ...p } : f)));

  const save = async () => {
    setError('');
    setNotice('');
    const defs = fields.map(({ optionsText, ...f }) => ({ ...f, ...(f.type === 'select' ? { options: (optionsText ?? '').split(',').map((o) => o.trim()).filter(Boolean) } : { options: undefined }) }));
    const checked = validateCustomFieldDefs(defs);
    if (!checked.ok) return setError(t(`cases.custom.error.${checked.error}`));
    setSaving(true);
    try {
      const res = await fetch(url, { method: 'PUT', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: checked.value }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? data?.error);
      setNotice(t('cases.custom.saved'));
      await load();
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(code && t(`cases.custom.error.${code}`) !== `cases.custom.error.${code}` ? t(`cases.custom.error.${code}`) : t('cases.keys.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('cases.custom.help')}</Typography>
      {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 1 }}>{notice}</Alert>}
      <Stack spacing={1.5}>
        {fields.map((f, i) => (
          <Stack key={i} direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
            <TextField size="small" select label={t('cases.custom.target')} value={f.target} disabled={!canEdit} onChange={(e) => patch(i, { target: e.target.value as CaseCustomField['target'] })} sx={{ minWidth: 140 }}>
              {CUSTOM_FIELD_TARGETS.map((x) => <MenuItem key={x} value={x}>{t(`cases.custom.target.${x}`)}</MenuItem>)}
            </TextField>
            <TextField size="small" label={t('cases.custom.key')} value={f.key} disabled={!canEdit} onChange={(e) => patch(i, { key: e.target.value })} sx={{ minWidth: 130 }} />
            <TextField size="small" label={t('cases.custom.label')} value={f.label} disabled={!canEdit} onChange={(e) => patch(i, { label: e.target.value })} sx={{ flex: 1 }} />
            <TextField size="small" select label={t('cases.custom.type')} value={f.type} disabled={!canEdit} onChange={(e) => patch(i, { type: e.target.value as CaseCustomField['type'] })} sx={{ minWidth: 130 }}>
              {CUSTOM_FIELD_TYPES.map((x) => <MenuItem key={x} value={x}>{t(`cases.custom.type.${x}`)}</MenuItem>)}
            </TextField>
            {f.type === 'select' && <TextField size="small" label={t('cases.custom.options')} value={f.optionsText ?? ''} disabled={!canEdit} onChange={(e) => patch(i, { optionsText: e.target.value })} sx={{ flex: 1 }} />}
            {canEdit && <IconButton size="small" color="error" onClick={() => setFields((cur) => cur.filter((_, j) => j !== i))}><DeleteIcon fontSize="small" /></IconButton>}
          </Stack>
        ))}
      </Stack>
      {canEdit && (
        <Stack direction="row" spacing={1} sx={{ mt: 2 }}>
          <Button startIcon={<AddIcon fontSize="small" />} onClick={() => setFields((cur) => [...cur, { key: '', target: 'case', label: '', type: 'text' }])}>{t('cases.custom.add')}</Button>
          <Button variant="contained" disabled={saving} onClick={() => void save()}>{t('common.save')}</Button>
        </Stack>
      )}
    </Box>
  );
}
