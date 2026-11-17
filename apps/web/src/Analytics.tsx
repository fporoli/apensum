import { useEffect, useRef, useState } from 'react';
import { Alert, Box, LinearProgress, Paper, Typography } from '@mui/material';
import { embedDashboard, type EmbeddedDashboard } from '@superset-ui/embedded-sdk';
import { useT } from './i18n';
import { useThemeMode } from './theme';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface EmbedInfo {
  ok: boolean;
  error?: string;
  supersetUrl?: string;
  dashboardId?: string;
  token?: string;
}

/**
 * Analyses (trial): a Superset dashboard embedded in an iframe (analytics.controller.ts). The API
 * hands out the guest token, limited to this organization and to the people the caller may see;
 * the SDK fetches a new one whenever it runs out. The iframe grows with the dashboard's height.
 */
export default function Analytics({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const t = useT();
  const { mode } = useThemeMode();
  const mount = useRef<HTMLDivElement>(null);
  const dashboard = useRef<EmbeddedDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [height, setHeight] = useState(900);
  // Read through refs: a refreshed login token or language must not reload the dashboard.
  const headers = useRef(authHeaders);
  headers.current = authHeaders;
  const title = useRef(t('analytics.title'));
  title.current = t('analytics.title');

  useEffect(() => {
    let cancelled = false;
    let resize: ReturnType<typeof setInterval> | undefined;
    const fetchEmbed = async (): Promise<EmbedInfo> => {
      const res = await fetch(`${API}/organizations/${orgId}/analytics/embed`, { headers: await headers.current() });
      return res.json();
    };
    (async () => {
      setError(null);
      setLoading(true);
      try {
        const first = await fetchEmbed();
        if (cancelled) return;
        if (!first.ok || !first.supersetUrl || !first.dashboardId || !first.token) {
          setError(first.error ?? 'analytics-unavailable');
          return;
        }
        let pending: string | null = first.token;
        dashboard.current = await embedDashboard({
          id: first.dashboardId,
          supersetDomain: first.supersetUrl,
          mountPoint: mount.current!,
          iframeTitle: title.current,
          dashboardUiConfig: { hideTitle: true, hideChartControls: false, filters: { expanded: false } },
          // The first token comes with the embed info; later ones are fetched when it runs out.
          fetchGuestToken: async () => {
            if (pending) {
              const token = pending;
              pending = null;
              return token;
            }
            const next = await fetchEmbed();
            if (!next.ok || !next.token) throw new Error(next.error ?? 'analytics-unavailable');
            return next.token;
          },
        });
        if (cancelled) {
          dashboard.current.unmount();
          return;
        }
        resize = setInterval(async () => {
          const size = await dashboard.current?.getScrollSize().catch(() => null);
          if (size?.height) setHeight(Math.max(600, Math.ceil(size.height) + 16));
        }, 1500);
      } catch {
        if (!cancelled) setError('analytics-unavailable');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      if (resize) clearInterval(resize);
      dashboard.current?.unmount();
      dashboard.current = null;
    };
  }, [orgId]);

  useEffect(() => {
    dashboard.current?.setThemeMode(mode === 'dark' ? 'dark' : 'default');
  }, [mode, loading]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box>
        <Typography variant="h4">{t('analytics.title')}</Typography>
        <Typography color="text.secondary">{t('analytics.lead')}</Typography>
      </Box>
      {error && <Alert severity={error === 'analytics-not-configured' ? 'info' : 'error'}>{t(`analytics.error.${error}`)}</Alert>}
      {loading && <LinearProgress />}
      <Paper
        ref={mount}
        sx={{ p: 0, overflow: 'hidden', display: error ? 'none' : 'block', height, '& iframe': { width: '100%', height: '100%', border: 0, display: 'block' } }}
      />
    </Box>
  );
}
