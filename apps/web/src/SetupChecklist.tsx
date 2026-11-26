import { useEffect, useState } from 'react';
import { Alert, Box, Chip, LinearProgress, Paper, Typography } from '@mui/material';
import { Button } from './Button';
import { useT } from './i18n';
import { CheckCircleIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type StepId = 'name' | 'holidays' | 'workTime' | 'departments' | 'people' | 'employment' | 'schedules' | 'projects' | 'look';

interface Step {
  id: StepId;
  done: boolean;
  optional: boolean;
  section: 'orgSettings' | 'invitations' | 'users' | 'managementProjects';
  people?: string[];
  count?: number;
}

interface Status {
  ok: boolean;
  steps: Step[];
  dismissed: boolean;
  complete: boolean;
}

/** Where each step is done (App.tsx's routes). */
const SECTION_HASH: Record<Step['section'], string> = {
  orgSettings: '#/org-settings',
  invitations: '#/invitations',
  users: '#/users',
  managementProjects: '#/projects',
};

/** Loads the checklist (GET organizations/:orgId/setup); `null` while loading or when the caller may not see it. */
export function useSetupStatus(orgId: string, authHeaders: () => Promise<Record<string, string>>, refreshKey?: unknown) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/setup`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled) setStatus(data?.ok ? data : null);
      } catch {
        if (!cancelled) setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, authHeaders, refreshKey]);
  return [status, setStatus] as const;
}

/** Hides the checklist (`dismissed`) or shows it on Home again; returns whether it worked. */
export async function setSetupDismissed(orgId: string, authHeaders: () => Promise<Record<string, string>>, dismissed: boolean): Promise<boolean> {
  try {
    const res = await fetch(`${API}/organizations/${orgId}/setup/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({ dismissed }),
    });
    return (await res.json())?.ok === true;
  } catch {
    return false;
  }
}

/**
 * The setup checklist on Home, for whoever may edit the organization settings: each step of setting
 * up a new organization with a tick once the data shows it is done (worked out by the API, never
 * stored). Hidden once every required step is done, or when someone hides it (Organization Settings
 * brings it back).
 */
export default function SetupChecklist({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const t = useT();
  const [status, setStatus] = useSetupStatus(orgId, authHeaders);
  const [error, setError] = useState<string | null>(null);

  if (!status || status.dismissed || status.complete) return null;
  const required = status.steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;

  async function hide() {
    setError(null);
    if (await setSetupDismissed(orgId, authHeaders, true)) setStatus((s) => (s ? { ...s, dismissed: true } : s));
    else setError(t('setup.hideFailed'));
  }

  return (
    <Paper sx={{ p: 2, display: 'grid', gap: 1.5, borderLeft: 4, borderColor: 'primary.main' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('setup.title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('setup.subtitle')}</Typography>
        </Box>
        <Button size="small" onClick={() => void hide()}>{t('setup.hide')}</Button>
      </Box>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <LinearProgress variant="determinate" value={(doneCount / required.length) * 100} sx={{ flex: 1, height: 6, borderRadius: 3 }} />
        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {t('setup.progress', { done: String(doneCount), total: String(required.length) })}
        </Typography>
      </Box>
      <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 1 }}>
        {status.steps.map((s) => (
          <Box component="li" key={s.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', opacity: s.done ? 0.65 : 1 }}>
            {s.done ? (
              <CheckCircleIcon color="success" sx={{ mt: '2px' }} />
            ) : (
              <Box aria-hidden sx={{ width: 20, height: 20, m: '2px', borderRadius: '50%', border: 2, borderColor: s.optional ? 'divider' : 'primary.main', flex: 'none' }} />
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: s.done ? 'line-through' : 'none' }}>
                  {t(`setup.step.${s.id}`)}
                </Typography>
                {s.optional && <Chip size="small" variant="outlined" label={t('setup.optional')} />}
              </Box>
              {!s.done && (
                <Typography variant="body2" color="text.secondary">
                  {t(`setup.step.${s.id}.hint`)}
                  {s.id === 'departments' && !!s.count && ` ${t('setup.withoutLeader', { count: String(s.count) })}`}
                  {s.id === 'employment' && !!s.people?.length && ` ${t('setup.stillOpen', { names: s.people.slice(0, 5).join(', ') + (s.people.length > 5 ? ' …' : '') })}`}
                </Typography>
              )}
            </Box>
            {!s.done && (
              <Button size="small" variant={s.optional ? 'text' : 'outlined'} href={SECTION_HASH[s.section]} sx={{ flex: 'none' }}>
                {t('setup.open')}
              </Button>
            )}
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
