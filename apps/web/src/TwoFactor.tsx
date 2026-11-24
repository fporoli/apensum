import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Divider, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import QRCode from 'qrcode';
import { TWO_FACTOR_POLICIES, type TwoFactorPolicy } from '@worktime3/shared/twoFactor';
import { ApensumMark } from './ApensumMark';
import { useT } from './i18n';
import type { Session } from './Login';

/**
 * Two-step login in the browser: one's own setup (Settings, or a full page when an organization requires
 * it), and an organization's rule (Organization settings). API: two-factor.controller.ts.
 */

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type AuthHeaders = () => Promise<Record<string, string>>;

async function call(path: string, authHeaders: AuthHeaders, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { ...(await authHeaders()), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}

function useErrorText() {
  const t = useT();
  return useCallback(
    (code: unknown) => {
      if (code === 'unreachable') return t('common.cannotReachApi');
      const key = `twoFactor.error.${String(code)}`;
      const text = t(key);
      return text === key ? t('twoFactor.error.generic', { error: String(code) }) : text;
    },
    [t],
  );
}

/** The recovery codes, shown once: copy or save them. */
function RecoveryCodes({ codes }: { codes: string[] }) {
  const t = useT();
  const text = codes.join('\n');
  return (
    <Stack spacing={1}>
      <Alert severity="warning">{t('twoFactor.recoveryHint')}</Alert>
      <Paper variant="outlined" sx={{ p: 1.5, fontFamily: 'monospace', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
        {codes.map((c) => <span key={c}>{c}</span>)}
      </Paper>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button size="small" onClick={() => void navigator.clipboard?.writeText(text)}>{t('twoFactor.copy')}</Button>
        <Button
          size="small"
          onClick={() => {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([`Apensum recovery codes\n\n${text}\n`], { type: 'text/plain' }));
            a.download = 'apensum-recovery-codes.txt';
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          {t('twoFactor.download')}
        </Button>
      </Box>
    </Stack>
  );
}

/** Scan, confirm with a code, keep the recovery codes. `onDone` gets the new session (a full one). */
export function TwoFactorSetup({ authHeaders, onDone, onCancel }: {
  authHeaders: AuthHeaders;
  onDone: (session: Session | null) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ codes: string[]; session: Session | null } | null>(null);
  // One secret per setup: a re-render must not replace the one being scanned.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const r = await call('/users/me/two-factor/setup', authHeaders, {});
      if (!r.ok) {
        setError(errorText(r.error));
        return;
      }
      setSecret(String(r.secret));
      setQr(await QRCode.toDataURL(String(r.uri), { margin: 1, width: 200 }));
    })();
  }, [authHeaders, errorText]);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call('/users/me/two-factor/enable', authHeaders, { code });
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    setResult({ codes: r.recoveryCodes as string[], session: (r.session as Session) ?? null });
  }

  if (result) {
    return (
      <Stack spacing={2}>
        <Alert severity="success">{t('twoFactor.enabled')}</Alert>
        <RecoveryCodes codes={result.codes} />
        <Box>
          <Button variant="contained" onClick={() => onDone(result.session)}>{t('twoFactor.done')}</Button>
        </Box>
      </Stack>
    );
  }
  return (
    <Stack spacing={2} component="form" onSubmit={confirm}>
      <Typography variant="body2">{t('twoFactor.scan')}</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {!qr ? (
        !error && <CircularProgress size={24} />
      ) : (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <Box component="img" src={qr} alt={t('twoFactor.qrAlt')} sx={{ width: 160, height: 160, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: '#fff' }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="caption" color="text.secondary">{t('twoFactor.manual')}</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{secret?.replace(/(.{4})/g, '$1 ').trim()}</Typography>
          </Box>
        </Box>
      )}
      <TextField
        label={t('twoFactor.code')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        size="small"
        autoComplete="one-time-code"
        inputProps={{ inputMode: 'numeric', maxLength: 7 }}
        helperText={t('twoFactor.codeHint')}
      />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button type="submit" variant="contained" disabled={busy || !qr || code.replace(/\s/g, '').length !== 6}>{t('twoFactor.confirm')}</Button>
        {onCancel && <Button onClick={onCancel}>{t('common.cancel')}</Button>}
      </Box>
    </Stack>
  );
}

/** Settings: one's own two-step login. */
export function TwoFactorPanel({ authHeaders }: { authHeaders: AuthHeaders }) {
  const t = useT();
  const errorText = useErrorText();
  const [status, setStatus] = useState<{ available: boolean; instanceOff?: boolean; enabled: boolean; required: boolean; recoveryCodesLeft: number } | null>(null);
  const [mode, setMode] = useState<'idle' | 'setup' | 'disable' | 'codes'>('idle');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const r = await call('/users/me/two-factor', authHeaders);
    if (r.ok) setStatus(r as unknown as NonNullable<typeof status>);
  }, [authHeaders]);

  useEffect(() => {
    void load();
  }, [load]);

  async function withCode(path: string) {
    setError(null);
    const r = await call(path, authHeaders, { code });
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    setCode('');
    setMode('idle');
    if (Array.isArray(r.recoveryCodes)) setNewCodes(r.recoveryCodes as string[]);
    await load();
  }

  if (!status) return null;
  return (
    <Stack spacing={1.5}>
      <Divider />
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>{t('twoFactor.title')}</Typography>
        {status.available && <Chip size="small" color={status.enabled ? 'success' : 'default'} label={t(status.enabled ? 'twoFactor.on' : 'twoFactor.off')} />}
      </Box>
      {!status.available ? (
        <Typography variant="body2" color="text.secondary">{t(status.instanceOff ? 'twoFactor.instanceOff' : 'twoFactor.sso')}</Typography>
      ) : mode === 'setup' ? (
        <TwoFactorSetup authHeaders={authHeaders} onCancel={() => setMode('idle')} onDone={() => { setMode('idle'); void load(); }} />
      ) : (
        <>
          <Typography variant="body2" color="text.secondary">
            {status.enabled ? t('twoFactor.onText', { count: String(status.recoveryCodesLeft) }) : t('twoFactor.offText')}
          </Typography>
          {status.required && <Alert severity="info">{t('twoFactor.requiredByOrg')}</Alert>}
          {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
          {newCodes && <RecoveryCodes codes={newCodes} />}
          {mode === 'disable' || mode === 'codes' ? (
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <TextField
                size="small"
                label={t('twoFactor.codeOrRecovery')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                sx={{ flex: '1 1 160px' }}
              />
              <Button
                variant="contained"
                color={mode === 'disable' ? 'error' : 'primary'}
                disabled={!code.trim()}
                onClick={() => void withCode(mode === 'disable' ? '/users/me/two-factor/disable' : '/users/me/two-factor/recovery-codes')}
              >
                {t(mode === 'disable' ? 'twoFactor.turnOff' : 'twoFactor.newCodes')}
              </Button>
              <Button onClick={() => { setMode('idle'); setCode(''); }}>{t('common.cancel')}</Button>
            </Box>
          ) : status.enabled ? (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button size="small" onClick={() => { setNewCodes(null); setMode('codes'); }}>{t('twoFactor.newCodes')}</Button>
              {!status.required && <Button size="small" color="error" onClick={() => { setNewCodes(null); setMode('disable'); }}>{t('twoFactor.turnOff')}</Button>}
            </Box>
          ) : (
            <Box>
              <Button size="small" variant="outlined" onClick={() => setMode('setup')}>{t('twoFactor.turnOn')}</Button>
            </Box>
          )}
        </>
      )}
    </Stack>
  );
}

/** A full page before the app: an organization requires a second step the person has not set up. */
export function TwoFactorRequired({ session, onDone, onSignOut }: { session: Session; onDone: (session: Session) => void; onSignOut: () => void }) {
  const t = useT();
  const authHeaders = useCallback(async () => ({ Authorization: `Bearer ${session.token ?? ''}` }), [session.token]);
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default', py: 4, px: 2 }}>
      <Paper elevation={2} sx={{ p: 4, borderRadius: 3, maxWidth: 480, width: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
          <ApensumMark size={32} />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('twoFactor.requiredTitle')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('twoFactor.requiredText')}</Typography>
        <TwoFactorSetup authHeaders={authHeaders} onDone={(s) => (s ? onDone(s) : onSignOut())} onCancel={onSignOut} />
      </Paper>
    </Box>
  );
}

/** Organization settings: who must use a second step here. */
export function TwoFactorPolicyPanel({ orgId, authHeaders }: { orgId: string; authHeaders: AuthHeaders }) {
  const t = useT();
  const errorText = useErrorText();
  const [policy, setPolicy] = useState<TwoFactorPolicy | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await call(`/organizations/${orgId}/two-factor-policy`, authHeaders);
      if (r.ok) {
        setPolicy(r.policy as TwoFactorPolicy);
        setCanEdit(r.canEdit === true);
      }
    })();
  }, [orgId, authHeaders]);

  async function save(next: TwoFactorPolicy) {
    setMessage(null);
    const r = await call(`/organizations/${orgId}/two-factor-policy`, authHeaders, { policy: next }, 'PUT');
    if (!r.ok) {
      setMessage({ severity: 'error', text: errorText(r.error) });
      return;
    }
    setPolicy(next);
    setMessage({ severity: 'success', text: t('twoFactor.policy.saved') });
  }

  if (!policy) return null;
  return (
    <Stack spacing={1.5} sx={{ pt: 1 }}>
      <TextField select size="small" label={t('twoFactor.policy.label')} value={policy} disabled={!canEdit} onChange={(e) => void save(e.target.value as TwoFactorPolicy)} sx={{ maxWidth: 360 }}>
        {TWO_FACTOR_POLICIES.map((p) => <MenuItem key={p} value={p}>{t(`twoFactor.policy.${p}`)}</MenuItem>)}
      </TextField>
      <Typography variant="body2" color="text.secondary">{t('twoFactor.policy.hint')}</Typography>
      {message && <Alert severity={message.severity} onClose={() => setMessage(null)}>{message.text}</Alert>}
    </Stack>
  );
}
