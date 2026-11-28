import { useEffect, useState } from 'react';
import { Alert, Box, Stack, TextField } from '@mui/material';
import { Button } from './Button';
import { useI18n } from './i18n';
import { apiRequest } from './apiRequest';
import { useApi } from './useApi';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/**
 * Organization settings -> End-to-end encryption: the minutes without use after which a person's unlocked vault keys
 * lock themselves (docs/VAULT.md), 5 to 480, default 30. Applies from the next time someone opens encrypted data.
 */
export function VaultSettingsPanel({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t } = useI18n();
  const { data, error: loadError } = useApi<{ idleMinutes: number; editable: boolean }>(`${API}/organizations/${orgId}/vault/settings`, authHeaders);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (data) setValue(String(data.idleMinutes)); }, [data]);

  const save = async () => {
    const n = Number(value);
    setSaved(false);
    if (!Number.isInteger(n) || n < 5 || n > 480) { setError(t('vault.settings.invalid')); return; }
    setBusy(true);
    setError(null);
    const r = await apiRequest<{ ok?: boolean; error?: string }>(`${API}/organizations/${orgId}/vault/settings`, {
      method: 'PUT', headers: await authHeaders(), body: { idleMinutes: n },
    });
    setBusy(false);
    if (!r.ok) { setError(t('common.cannotReachApi')); return; }
    if (r.data.ok === false) { setError(r.data.error === 'invalid-minutes' ? t('vault.settings.invalid') : t('vault.settings.forbidden')); return; }
    setSaved(true);
  };

  return (
    <Stack spacing={1.5} sx={{ maxWidth: 520 }}>
      {loadError && <Alert severity="error">{t('vault.settings.loadFailed')}</Alert>}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {saved && <Alert severity="success" onClose={() => setSaved(false)}>{t('vault.settings.saved')}</Alert>}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <TextField size="small" type="number" label={t('vault.settings.idleMinutes')} value={value} disabled={!data?.editable}
          inputProps={{ min: 5, max: 480, step: 5 }} helperText={t('vault.settings.idleHint')} onChange={(e) => { setValue(e.target.value); setSaved(false); }}
          sx={{ flex: 1 }} />
        {data?.editable && <Button variant="contained" disabled={busy} onClick={() => void save()}>{t('common.save')}</Button>}
      </Box>
    </Stack>
  );
}
