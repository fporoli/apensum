import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography } from '@mui/material';
import { LOCALES, useI18n } from './i18n';
import { CheckCircleIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/**
 * Sets a new password from the link in a reset e-mail. Not signed in: the link's token is the only
 * credential, good for 30 minutes and one password change (API password-reset.ts).
 */
export default function ResetPassword({ token, lang }: { token: string; lang: string | null }) {
  const { t, locale, setLocale } = useI18n();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The page speaks the language of the account the mail was sent to.
  const wanted = LOCALES.find((l) => l.code === lang)?.code;
  useEffect(() => {
    if (wanted && wanted !== locale) setLocale(wanted);
  }, [wanted]);

  const toLogin = () => window.location.assign(`${window.location.origin}${window.location.pathname}`);

  async function submit() {
    setError(null);
    if (password.length < 8) return setError(t('login.error.password-too-short'));
    if (password !== repeat) return setError(t('reset.mismatch'));
    setBusy(true);
    try {
      const res = await fetch(`${API}/auth/reset/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (data.ok) setDone(true);
      else if (data.error === 'reset-link-invalid') setInvalid(true);
      else if (data.error === 'password-too-short') setError(t('login.error.password-too-short'));
      else setError(t('reset.failed', { error: data.error ?? res.status }));
    } catch {
      setError(t('reset.failed', { error: 'offline' }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex', justifyContent: 'center', p: 2 }}>
      <Paper sx={{ p: 3, width: '100%', maxWidth: 420, alignSelf: 'flex-start', mt: { xs: 1, sm: 8 } }}>
        <Typography variant="overline" color="text.secondary">Apensum</Typography>
        <Typography variant="h6" sx={{ mb: 2 }}>{t('reset.title')}</Typography>

        {done ? (
          <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center', py: 1 }}>
            <CheckCircleIcon color="success" sx={{ fontSize: 56 }} />
            <Typography>{t('reset.done')}</Typography>
            <Button variant="contained" onClick={toLogin}>{t('reset.toLogin')}</Button>
          </Stack>
        ) : invalid ? (
          <Stack spacing={2}>
            <Alert severity="warning">{t('reset.invalid')}</Alert>
            <Button variant="contained" onClick={toLogin}>{t('reset.toLogin')}</Button>
          </Stack>
        ) : (
          <Box component="form" onSubmit={(e) => { e.preventDefault(); void submit(); }} sx={{ display: 'grid', gap: 2 }}>
            {/* Lets password managers store the new password for the right account. */}
            <input type="text" name="username" autoComplete="username" hidden readOnly value="" />
            <TextField label={t('login.resetPasswordMin')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} size="small" autoComplete="new-password" autoFocus />
            <TextField label={t('reset.repeat')} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} size="small" autoComplete="new-password" />
            {error && <Alert severity="error">{error}</Alert>}
            <Button type="submit" variant="contained" disabled={busy} startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}>
              {t('reset.submit')}
            </Button>
            <Button onClick={toLogin} disabled={busy}>{t('reset.toLogin')}</Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
}
