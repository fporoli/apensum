import { useEffect, useState } from 'react';
import { Alert, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField, Tooltip } from '@mui/material';
import { Button } from './Button';
import { KeyIcon, LockIcon, LockOpenIcon } from './icons';
import { useI18n } from './i18n';
import {
  KeyringError,
  WrongPassphraseError,
  changeKeyringPassphrase,
  loadKeyring,
  lockKeyring,
  idleMinutes,
  minutesUntilAutoLock,
  setUpKeyring,
  unlockKeyring,
  useKeyringState,
} from './vaultKeyring';

const MIN_PASSPHRASE = 12;
// The demo passphrases are shown where the demo accounts are (as plugin.ts SHOW_DEMO_HINTS, not imported: it imports this).
const SHOW_DEMO_HINTS = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS !== 'false';

/**
 * The vault's keys (docs/VAULT.md) where a module shows encrypted data (e.g. the Cases list, a case's header and its
 * "locked" note): set up the passphrase (first time), unlock, lock, change. Unlocking anywhere unlocks everything (the
 * keyring is shared). The passphrase never leaves the browser and cannot be recovered: the dialog says so before it
 * is chosen.
 */
export function VaultControl({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t } = useI18n();
  const state = useKeyringState();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read when the lock button's tooltip opens: the idle timer restarts with every use.
  const [lockMinutes, setLockMinutes] = useState<number | null>(null);

  useEffect(() => {
    loadKeyring(orgId, authHeaders).catch((e) => setError(e instanceof Error ? e.message : 'error'));
  }, [orgId, authHeaders]);

  const close = () => {
    setOpen(false);
    setChanging(false);
    setPass('');
    setPass2('');
    setOldPass('');
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (state === 'none' || changing) {
      if (pass.length < MIN_PASSPHRASE) return setError(t('vault.tooShort', { min: String(MIN_PASSPHRASE) }));
      if (pass !== pass2) return setError(t('vault.mismatch'));
    }
    setBusy(true);
    try {
      if (state === 'none') await setUpKeyring(orgId, authHeaders, pass);
      else if (changing) await changeKeyringPassphrase(orgId, authHeaders, oldPass, pass);
      else await unlockKeyring(pass);
      close();
    } catch (e) {
      setError(e instanceof WrongPassphraseError ? t('vault.wrong') : e instanceof KeyringError ? e.message : t('vault.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'unknown') return null;
  const settingUp = state === 'none';
  const creating = settingUp || changing;

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        {state === 'unlocked' ? (
          <>
            {/* The state, not an action: nothing happens on a click. */}
            <Button size="small" variant="outlined" color="success" disabled startIcon={<LockOpenIcon fontSize="small" />}
              sx={{ '&.Mui-disabled': { color: 'success.main', borderColor: 'success.main' } }}>
              {t('vault.unlocked')}
            </Button>
            <Tooltip title={lockMinutes ? t('vault.autoLock', { min: String(lockMinutes) }) : ''} onOpen={() => setLockMinutes(minutesUntilAutoLock())}>
              <span>
                <Button size="small" variant="outlined" startIcon={<LockIcon fontSize="small" />} onClick={lockKeyring}>{t('vault.lock')}</Button>
              </span>
            </Tooltip>
            <Button size="small" variant="outlined" startIcon={<KeyIcon fontSize="small" />} onClick={() => { setChanging(true); setOpen(true); }}>
              {t('vault.changePassphrase')}
            </Button>
          </>
        ) : (
          // What to do, not the state: "Entsperren" (or set up the passphrase the first time).
          <Button size="small" variant="contained" color="warning" startIcon={settingUp ? undefined : <LockIcon fontSize="small" />} onClick={() => setOpen(true)}>
            {settingUp ? t('vault.setUp') : t('vault.unlock')}
          </Button>
        )}
      </Stack>
      <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="xs" component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); void submit(); }}>
        <DialogTitle>{changing ? t('vault.changeTitle') : settingUp ? t('vault.setUpTitle') : t('vault.unlockTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText>{creating ? t('vault.setUpHelp') : t('vault.unlockHelp', { min: String(idleMinutes()) })}</DialogContentText>
            {creating && <Alert severity="warning">{t('vault.noRecovery')}</Alert>}
            {/* Demo instances only: the seeded passphrases (the cases plugin's scripts/generate-demo-seed.mts). */}
            {SHOW_DEMO_HINTS && !creating && <Alert severity="info">{t('vault.demoHint')}</Alert>}
            {error && <Alert severity="error">{error}</Alert>}
            {changing && <TextField type="password" label={t('vault.current')} value={oldPass} onChange={(e) => setOldPass(e.target.value)} autoComplete="current-password" />}
            <TextField autoFocus type="password" label={changing ? t('vault.new') : t('vault.passphrase')} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={creating ? 'new-password' : 'current-password'} />
            {creating && <TextField type="password" label={t('vault.repeat')} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={busy || !pass}>{busy ? t('vault.working') : changing ? t('vault.change') : settingUp ? t('vault.create') : t('vault.unlock')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
