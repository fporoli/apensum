import { useEffect, useState } from 'react';
import { Alert, Box, FormControlLabel, Switch, Typography } from '@mui/material';
import { useT } from './i18n';
import { SectionPaper } from './SettingsSection';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface ModuleEntry {
  id: string;
  caption: string;
  defaultEnabled: boolean;
}

/**
 * Organization settings -> Modules: optional feature areas (packages/shared/src/modules.ts).
 * Switching one off hides its pages and takes its permissions away for everyone in the organization.
 */
export default function ModuleSettings({
  orgId,
  authHeaders,
  onChanged,
}: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  onChanged?: () => void;
}) {
  const t = useT();
  const [catalogue, setCatalogue] = useState<ModuleEntry[]>([]);
  const [modules, setModules] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/modules`, { headers: await authHeaders() });
        const data = await res.json();
        setCatalogue(Array.isArray(data?.catalogue) ? data.catalogue : []);
        setModules(data?.modules ?? {});
      } catch {
        setError(t('common.cannotReachApi'));
      }
    })();
  }, [orgId, authHeaders, t]);

  async function toggle(id: string, enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/modules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ [id]: enabled }),
      });
      const data = await res.json();
      if (!data?.ok) {
        setError(t('modules.error', { error: data?.error ?? t('common.unknownError') }));
        return;
      }
      setModules(data.modules ?? {});
      onChanged?.();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionPaper title={t('modules.title')} subtitle={t('modules.subtitle')}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {catalogue.map((m) => (
        <FormControlLabel
          key={m.id}
          sx={{ alignItems: 'flex-start', ml: 0, gap: 1 }}
          control={<Switch checked={modules[m.id] ?? m.defaultEnabled} disabled={busy} onChange={(e) => void toggle(m.id, e.target.checked)} />}
          label={
            <Box sx={{ pt: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t(m.caption)}</Typography>
              <Typography variant="caption" color="text.secondary">{t(`${m.caption}.description`)}</Typography>
            </Box>
          }
        />
      ))}
    </SectionPaper>
  );
}
