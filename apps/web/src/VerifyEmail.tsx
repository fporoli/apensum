import { useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { Button } from './Button';
import { LOCALES, useI18n } from './i18n';
import { saveSession, type Session } from './Login';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/**
 * The link in a registration e-mail (API auth.controller `verify`): proves the address and signs in, then opens the
 * app. A link that is too old or was already used says so and leads to the login (which can send a new one).
 */
export default function VerifyEmail({ token, lang }: { token: string; lang: string | null }) {
  const { t, locale, setLocale } = useI18n();
  const [state, setState] = useState<'working' | 'invalid' | 'signIn' | 'failed'>('working');
  const started = useRef(false);

  const wanted = LOCALES.find((l) => l.code === lang)?.code;
  useEffect(() => {
    if (wanted && wanted !== locale) setLocale(wanted);
  }, [wanted]);

  const toApp = () => window.location.assign(`${window.location.origin}${window.location.pathname}`);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const res = await fetch(`${API}/auth/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        const data = await res.json();
        if (data.ok && data.token) {
          saveSession(data as Session);
          toApp();
        } else if (data.ok) setState('signIn');
        else setState(data.error === 'verify-link-invalid' ? 'invalid' : 'failed');
      } catch {
        setState('failed');
      }
    })();
  }, [token]);

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex', justifyContent: 'center', p: 2 }}>
      <Paper sx={{ p: 3, width: '100%', maxWidth: 420, alignSelf: 'flex-start', mt: { xs: 1, sm: 8 } }}>
        <Typography variant="overline" color="text.secondary">Apensum</Typography>
        <Typography variant="h6" sx={{ mb: 2 }}>{t('verify.title')}</Typography>
        {state === 'working' ? (
          <Stack direction="row" spacing={1.5} alignItems="center"><CircularProgress size={20} /><Typography>{t('verify.working')}</Typography></Stack>
        ) : (
          <Stack spacing={2}>
            <Alert severity={state === 'signIn' ? 'success' : 'warning'}>
              {state === 'signIn' ? t('verify.signIn') : state === 'invalid' ? t('verify.invalid') : t('verify.failed')}
            </Alert>
            <Button variant="contained" onClick={toApp}>{t('verify.toLogin')}</Button>
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
