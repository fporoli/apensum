import { useEffect, useState } from 'react';
import { Alert, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField } from '@mui/material';
import { Button } from './Button';
import { LockIcon } from './icons';
import { useI18n } from './i18n';
import {
  KeyringError,
  WrongPassphraseError,
  changeKeyringPassphrase,
  idleMinutes,
  loadKeyring,
  setUpKeyring,
  unlockKeyring,
  useKeyringState,
} from './vaultKeyring';

const MIN_PASSPHRASE = 12;
// The demo passphrases are shown where the demo accounts are (as plugin.ts SHOW_DEMO_HINTS, not imported: it imports this).
const SHOW_DEMO_HINTS = import.meta.env.VITE_SHOW_DEMO_ACCOUNTS !== 'false';

type Headers = () => Promise<Record<string, string>>;
export type VaultDialogMode = 'setUp' | 'unlock' | 'change';

/**
 * The vault's passphrase dialog (docs/VAULT.md): set it up (first time), unlock, or change it. Changing re-seals only
 * the person's private key: every object key stays as it is, nothing is decrypted or encrypted again. The passphrase
 * never leaves the browser and cannot be recovered: the dialog says so before it is chosen.
 */
export function VaultDialog({ orgId, authHeaders, mode, onClose }: { orgId: string; authHeaders: Headers; mode: VaultDialogMode | null; onClose: () => void }) {
  const { t } = useI18n();
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPass('');
    setPass2('');
    setOldPass('');
    setError(null);
  }, [mode]);

  const creating = mode === 'setUp' || mode === 'change';
  const submit = async () => {
    setError(null);
    if (creating) {
      if (pass.length < MIN_PASSPHRASE) return setError(t('vault.tooShort', { min: String(MIN_PASSPHRASE) }));
      if (pass !== pass2) return setError(t('vault.mismatch'));
    }
    setBusy(true);
    try {
      if (mode === 'setUp') await setUpKeyring(orgId, authHeaders, pass);
      else if (mode === 'change') await changeKeyringPassphrase(orgId, authHeaders, oldPass, pass);
      else await unlockKeyring(pass);
      onClose();
    } catch (e) {
      setError(e instanceof WrongPassphraseError ? t('vault.wrong') : e instanceof KeyringError ? e.message : t('vault.failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={mode !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={(e: React.FormEvent) => { e.preventDefault(); void submit(); }}>
      <DialogTitle>{mode === 'change' ? t('vault.changeTitle') : mode === 'setUp' ? t('vault.setUpTitle') : t('vault.unlockTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <DialogContentText>{creating ? t('vault.setUpHelp') : t('vault.unlockHelp', { min: String(idleMinutes()) })}</DialogContentText>
          {creating && <Alert severity="warning">{t('vault.noRecovery')}</Alert>}
          {/* Demo instances only: the seeded passphrases (the cases plugin's scripts/generate-demo-seed.mts). */}
          {SHOW_DEMO_HINTS && mode !== 'setUp' && <Alert severity="info">{t('vault.demoHint')}</Alert>}
          {error && <Alert severity="error">{error}</Alert>}
          {mode === 'change' && <TextField type="password" label={t('vault.current')} value={oldPass} onChange={(e) => setOldPass(e.target.value)} autoComplete="current-password" />}
          <TextField autoFocus type="password" label={mode === 'change' ? t('vault.new') : t('vault.passphrase')} value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={creating ? 'new-password' : 'current-password'} />
          {creating && <TextField type="password" label={t('vault.repeat')} value={pass2} onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button type="submit" variant="contained" disabled={busy || !pass}>{busy ? t('vault.working') : mode === 'change' ? t('vault.change') : mode === 'setUp' ? t('vault.create') : t('vault.unlock')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * Where a module shows encrypted data (e.g. the Cases list, a locked case's note): "Entsperren" while the keys are
 * locked, "Verschlüsselung einrichten" the first time, nothing once unlocked (the header's key shows that, and locks;
 * the user menu changes the passphrase). Unlocking anywhere unlocks everything (the keyring is shared).
 */
export function VaultControl({ orgId, authHeaders }: { orgId: string; authHeaders: Headers }) {
  const { t } = useI18n();
  const state = useKeyringState();
  const [mode, setMode] = useState<VaultDialogMode | null>(null);

  useEffect(() => {
    loadKeyring(orgId, authHeaders).catch(() => {});
  }, [orgId, authHeaders]);

  if (state === 'unknown' || state === 'unlocked') return <VaultDialog orgId={orgId} authHeaders={authHeaders} mode={mode} onClose={() => setMode(null)} />;
  const settingUp = state === 'none';
  return (
    <>
      {/* What to do, not the state: "Entsperren" (or set up the passphrase the first time). */}
      <Button size="small" variant="contained" color="warning" startIcon={settingUp ? undefined : <LockIcon fontSize="small" />} onClick={() => setMode(settingUp ? 'setUp' : 'unlock')}>
        {settingUp ? t('vault.setUp') : t('vault.unlock')}
      </Button>
      <VaultDialog orgId={orgId} authHeaders={authHeaders} mode={mode} onClose={() => setMode(null)} />
    </>
  );
}
