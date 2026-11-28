import { useState } from 'react';
import { Alert, Box, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Typography } from '@mui/material';
import { Button } from './Button';
import { KeyIcon, LockIcon, MailIcon } from './icons';
import { useI18n } from './i18n';
import { apiRequest } from './apiRequest';
import { TwoFactorPanel } from './TwoFactor';
import { VaultDialog, type VaultDialogMode } from './VaultControl';
import { lockKeyring, minutesUntilAutoLock, useKeyringState } from './vaultKeyring';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
type Headers = () => Promise<Record<string, string>>;

/**
 * User menu -> Security: the two secrets side by side, each said what it is for. The password signs in (changed through
 * a link by e-mail, as "forgot password"; two-step login with it). The encryption passphrase (docs/VAULT.md) opens
 * encrypted data such as confidential cases, lives only in the browser and is never sent; here it is set up, unlocked
 * for the organization's minutes, locked or changed. Modules still ask for it where it is needed (e.g. Cases).
 */
export function SecurityDialog({ open, onClose, email, orgId, authHeaders }: { open: boolean; onClose: () => void; email: string; orgId: string | null; authHeaders: Headers }) {
  const { t } = useI18n();
  const keyring = useKeyringState();
  const [vaultMode, setVaultMode] = useState<VaultDialogMode | null>(null);
  const [mailSent, setMailSent] = useState<boolean | null>(null);
  const [sending, setSending] = useState(false);
  const minutes = keyring === 'unlocked' ? minutesUntilAutoLock() : null;

  const sendLink = async () => {
    setSending(true);
    const r = await apiRequest<{ ok?: boolean }>(`${API}/auth/reset`, { method: 'POST', body: { email } });
    setSending(false);
    setMailSent(r.ok);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
        <DialogTitle>{t('security.title')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('security.password.title')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t('security.password.what')}</Typography>
              {mailSent === true && <Alert severity="success" sx={{ mb: 1.5 }}>{t('security.password.sent', { email })}</Alert>}
              {mailSent === false && <Alert severity="error" sx={{ mb: 1.5 }}>{t('common.cannotReachApi')}</Alert>}
              <Button variant="outlined" size="small" startIcon={<MailIcon fontSize="small" />} disabled={sending} onClick={() => void sendLink()}>
                {t('security.password.sendLink')}
              </Button>
              <Box sx={{ mt: 2 }}><TwoFactorPanel authHeaders={authHeaders} /></Box>
            </Box>
            <Divider />
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('security.vault.title')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>{t('security.vault.what')}</Typography>
              {orgId && keyring !== 'unknown' && (
                <>
                  <Alert severity={keyring === 'unlocked' ? 'success' : 'info'} icon={keyring === 'unlocked' ? <KeyIcon /> : <LockIcon />} sx={{ mb: 1.5 }}>
                    {keyring === 'none' ? t('security.vault.none') : keyring === 'locked' ? t('security.vault.locked') : t('vault.header', { min: String(minutes ?? '') })}
                  </Alert>
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {keyring === 'none' && <Button variant="contained" size="small" onClick={() => setVaultMode('setUp')}>{t('vault.setUp')}</Button>}
                    {keyring === 'locked' && <Button variant="contained" size="small" startIcon={<LockIcon fontSize="small" />} onClick={() => setVaultMode('unlock')}>{t('vault.unlock')}</Button>}
                    {keyring === 'unlocked' && <Button variant="outlined" size="small" startIcon={<LockIcon fontSize="small" />} onClick={lockKeyring}>{t('vault.lockNow')}</Button>}
                    {keyring !== 'none' && <Button variant="outlined" size="small" startIcon={<KeyIcon fontSize="small" />} onClick={() => setVaultMode('change')}>{t('vault.changePassphrase')}</Button>}
                  </Stack>
                </>
              )}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
      {orgId && <VaultDialog orgId={orgId} authHeaders={authHeaders} mode={vaultMode} onClose={() => setVaultMode(null)} />}
    </>
  );
}
