import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, List, ListItem, ListItemText, Stack } from '@mui/material';
import { useI18n } from '@worktime3/web/plugin';
import { shareCaseKey } from './caseKeyring';
import { removeCaseMember } from './caseVaultClient';
import type { Case } from '../shared/cases';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Candidate { userId: string; name: string; holder: boolean; hasKeys: boolean; canAccess: boolean; me: boolean }

/**
 * Who holds the key to an encrypted case, and adding or removing people. Adding wraps the case key for them in this
 * browser. Removing replaces the key for everyone else and re-seals the case (the server cannot do either).
 */
export function CaseMembersDialog({ orgId, caseItem, authHeaders, canEdit, onClose, onChanged }: {
  orgId: string;
  caseItem: Case;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [people, setPeople] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const errorText = (e: unknown) => {
    const code = e instanceof Error ? e.message : '';
    for (const k of [`cases.ai.error.${code}`, `cases.members.error.${code}`]) if (code && t(k) !== k) return t(k);
    return t('cases.keys.failed');
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/cases/${caseItem.id}/key-candidates`, { headers: await authHeaders(), cache: 'no-store' });
      const data = await res.json();
      setPeople(data?.ok ? data.candidates : []);
    } catch {
      setPeople([]);
      setError(t('common.cannotReachApi'));
    }
  }, [orgId, caseItem.id, authHeaders, t]);

  useEffect(() => { void load(); }, [load]);

  const run = async (id: string, job: () => Promise<void>, done = '') => {
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await job();
      setNotice(done);
      await load();
      await onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('cases.members.title')}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 1 }}>{t('cases.members.help')}</DialogContentText>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {notice && <Alert severity="success" sx={{ mb: 1 }}>{notice}</Alert>}
        {people === null ? <CircularProgress size={24} /> : (
          <List dense>
            {people.map((p) => (
              <ListItem key={p.userId} divider secondaryAction={
                <Stack direction="row" spacing={1} alignItems="center">
                  {p.holder && <Chip size="small" color="success" label={t('cases.members.holder')} />}
                  {canEdit && p.holder && !p.me && (
                    <Button size="small" color="error" disabled={!!busy}
                      onClick={() => { if (confirm(t('cases.members.confirmRemove', { name: p.name }))) void run(p.userId, () => removeCaseMember(orgId, authHeaders, caseItem, p.userId), t('cases.members.removed', { name: p.name })); }}>
                      {busy === p.userId ? t('cases.keys.working') : t('cases.members.remove')}
                    </Button>
                  )}
                  {canEdit && !p.holder && p.hasKeys && p.canAccess && (
                    <Button size="small" variant="outlined" disabled={!!busy} onClick={() => void run(p.userId, () => shareCaseKey(orgId, authHeaders, caseItem.id, p.userId), t('cases.members.added', { name: p.name }))}>
                      {busy === p.userId ? t('cases.keys.working') : t('cases.members.add')}
                    </Button>
                  )}
                </Stack>
              }>
                <ListItemText
                  primary={p.name}
                  secondary={p.holder ? null : !p.hasKeys ? t('cases.members.noKeys') : !p.canAccess ? t('cases.members.noAccess') : null}
                />
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions><Button onClick={onClose} disabled={!!busy}>{t('common.close')}</Button></DialogActions>
    </Dialog>
  );
}
