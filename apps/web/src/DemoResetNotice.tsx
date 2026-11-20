import { useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Paper, Typography } from '@mui/material';
import { useI18n } from './i18n';
import { swissLocale } from './localeFormat';
import { demoResetWarning, inDemoResetWindow } from './demoReset';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

async function apiUp(): Promise<{ up: boolean; everyHours: number | null }> {
  try {
    const res = await fetch(`${API}/health`, { cache: 'no-store' });
    if (!res.ok) return { up: false, everyHours: null };
    const data = await res.json();
    return { up: true, everyHours: Number(data?.demoReset?.everyHours) || null };
  } catch {
    return { up: false, everyHours: null };
  }
}

/**
 * Demo instances only (GET health `demoReset`): a warning in the last minutes before the scheduled reset
 * (demoReset.ts), and while it runs (the API is unreachable around a scheduled time) a waiting page with a
 * timer that reloads the app once the API answers again. Nothing on an instance without a schedule.
 */
export default function DemoResetNotice() {
  const { t, locale } = useI18n();
  const [everyHours, setEveryHours] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [downSince, setDownSince] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiUp().then((r) => { if (!cancelled && r.everyHours) setEveryHours(r.everyHours); });
    return () => { cancelled = true; };
  }, []);

  const warning = everyHours ? demoResetWarning(now, everyHours) : null;
  const watching = everyHours !== null && (inDemoResetWindow(now, everyHours) || downSince !== null);

  // A clock for the countdown: every second while it matters, else every half minute.
  useEffect(() => {
    if (!everyHours) return;
    const timer = window.setInterval(() => setNow(Date.now()), warning || downSince !== null ? 1000 : 30_000);
    return () => window.clearInterval(timer);
  }, [everyHours, warning, downSince]);

  // Around a scheduled time, ask the API every 5 seconds; once it is back after being away, start fresh.
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => {
      void apiUp().then((r) => {
        if (!r.up) setDownSince((since) => since ?? Date.now());
        else if (downSince !== null) window.location.reload();
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [watching, downSince]);

  if (!everyHours) return null;

  if (downSince !== null) {
    const seconds = Math.max(0, Math.floor((now - downSince) / 1000));
    const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    return (
      <Box sx={{ position: 'fixed', inset: 0, zIndex: (th) => th.zIndex.modal + 10, bgcolor: 'rgba(15,23,42,0.55)', display: 'grid', placeItems: 'center', p: 2 }}>
        <Paper sx={{ p: 4, maxWidth: 420, textAlign: 'center', display: 'grid', gap: 1.5, justifyItems: 'center' }} role="status" aria-live="polite">
          <CircularProgress />
          <Typography variant="h6">{t('demoReset.title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('demoReset.body')}</Typography>
          <Typography variant="h5" sx={{ fontVariantNumeric: 'tabular-nums' }}>{elapsed}</Typography>
          <Typography variant="caption" color="text.secondary">{t('demoReset.reload')}</Typography>
        </Paper>
      </Box>
    );
  }

  if (!warning) return null;
  const time = new Intl.DateTimeFormat(swissLocale(locale), { hour: '2-digit', minute: '2-digit' }).format(new Date(warning.at));
  return (
    <Alert severity="warning" sx={{ position: 'fixed', left: '50%', transform: 'translateX(-50%)', bottom: 16, zIndex: (th) => th.zIndex.snackbar, maxWidth: 'calc(100vw - 32px)', boxShadow: 3 }}>
      {t('demoReset.soon', { time, minutes: String(warning.minutes) })}
    </Alert>
  );
}
