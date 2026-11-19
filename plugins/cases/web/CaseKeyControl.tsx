import { useEffect, useState } from 'react';
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField } from '@mui/material';
import { useI18n } from '@worktime3/web/plugin';
import {
  KeyringError,
  WrongPassphraseError,
  changeKeyringPassphrase,
  loadKeyring,
  lockKeyring,
  setUpKeyring,
  unlockKeyring,
  useKeyringState,
} from './caseKeyring';

const MIN_PASSPHRASE = 12;

/**
 * The encryption status of Cases in the page header: set up the passphrase (first time), unlock, lock, change.
 * The passphrase never leaves the browser and cannot be recovered: the dialog says so before it is chosen.
 */
export function CaseKeyControl({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t } = useI18n();
  const state = useKeyringState();
  const [open, setOpen] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      if (pass.length < MIN_PASSPHRASE) return setError(t('cases.keys.tooShort', { min: String(MIN_PASSPHRASE) }));
      if (pass !== pass2) return setError(t('cases.keys.mismatch'));
    }
    setBusy(true);
    try {
      if (state === 'none') await setUpKeyring(orgId, authHeaders, pass);
      else if (changing) await changeKeyringPassphrase(orgId, authHeaders, oldPass, pass);
      else await unlockKeyring(pass);
      close();
    } catch (e) {
      setError(e instanceof WrongPassphraseError ? t('cases.keys.wrong') : e instanceof KeyringError ? e.message : t('cases.keys.failed'));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'unknown') return null;
  const settingUp = state === 'none';
  const creating = settingUp || changing;

  return (
    <>
      <Stack direction="row" spacing={1}>
        {state === 'unlocked' ? (
          <>
            <Chip color="success" size="small" label={t('cases.keys.unlocked')} onClick={() => { setChanging(true); setOpen(true); }} />
            <Button size="small" onClick={lockKeyring}>{t('cases.keys.lock')}</Button>
          </>
        ) : (
          <Chip color="warning" size="small" label={settingUp ? t('cases.keys.setUp') : t('cases.keys.locked')} onClick={() => setOpen(true)} />
        )}
      </Stack>
      <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="xs" component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); void submit(); }}>
        <DialogTitle>{changing ? t('cases.keys.changeTitle') : settingUp ? t('cases.keys.setUpTitle') : t('cases.keys.unlockTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <DialogContentText>{creating ? t('cases.keys.setUpHelp') : t('cases.keys.unlockHelp')}</DialogContentText>
            {creating && <Alert severity="warning">{t('cases.keys.noRecovery')}</Alert>}
            {error && <Alert severity="error">{error}</Alert>}
            {changing && <TextField type="password" label={t('cases.keys.current')} value={oldPass} onChange={(e) => setOldPass(e.target.value)} autoComplete="current-password" />}
            <TextField autoFocus type="password" label={changing ? t('cases.keys.new') : t('cases.keys.passphrase')} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={creating ? 'new-password' : 'current-password'} />
            {creating && <TextField type="password" label={t('cases.keys.repeat')} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={busy || !pass}>{busy ? t('cases.keys.working') : changing ? t('cases.keys.change') : settingUp ? t('cases.keys.create') : t('cases.keys.unlock')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
