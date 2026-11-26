import { useEffect, useState } from 'react';
import { Alert, Autocomplete, Avatar, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useT } from './i18n';
import { MailIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const MAX_RECIPIENTS = 20;

export interface Recipient {
  id: string;
  name: string;
  email: string;
}

/**
 * "Send by e-mail" (requests, Approvals): the server mails the chosen colleagues
 * (forward-mail.service.ts), with a link back to the item and Reply-To the sender. Recipients are
 * members of the organization (from the directory); the people responsible are suggested.
 */
export default function ForwardMailDialog({
  open,
  onClose,
  onSent,
  orgId,
  endpoint,
  suggested,
  defaultSubject,
  defaultMessage,
  authHeaders,
}: {
  open: boolean;
  onClose: () => void;
  onSent?: (count: number) => void;
  orgId: string;
  /** e.g. `/organizations/:orgId/flows/:id/forward` or `/workflows/:id/forward`. */
  endpoint: string;
  suggested: Recipient[];
  defaultSubject: string;
  defaultMessage: string;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const t = useT();
  const [people, setPeople] = useState<Recipient[]>([]);
  const [to, setTo] = useState<Recipient[]>([]);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTo(suggested);
    setSubject(defaultSubject);
    setMessage(defaultMessage);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/directory`, { headers: await authHeaders() });
        const data = await res.json();
        if (Array.isArray(data?.people)) setPeople(data.people.map((p: { userId: string; name: string; email: string }) => ({ id: p.userId, name: p.name, email: p.email })));
      } catch {
        /* the suggested people can still be mailed */
      }
    })();
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const options = [...new Map([...suggested, ...people].map((p) => [p.id, p])).values()];

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ userIds: to.map((r) => r.id), subject, message }),
      });
      const data = await res.json();
      if (!data?.ok) {
        const key = `mail.error.${data?.error}`;
        const text = t(key);
        setError(text === key ? t('mail.error.generic', { error: data?.error ?? t('common.unknownError') }) : text);
        return;
      }
      onSent?.(data.sent ?? to.length);
      onClose();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('mail.title')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <Autocomplete
          multiple
          options={options}
          value={to}
          onChange={(_, v) => setTo(v.slice(0, MAX_RECIPIENTS))}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterOptions={(opts, state) => {
            const q = state.inputValue.trim().toLowerCase();
            return q ? opts.filter((o) => `${o.name} ${o.email}`.toLowerCase().includes(q)) : opts;
          }}
          renderOption={(props, o) => {
            const { key, ...rest } = props as typeof props & { key: string };
            return (
              <Box component="li" key={key} {...rest} sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
                <Avatar sx={{ width: 28, height: 28, fontSize: '0.8rem' }}>{o.name.charAt(0).toUpperCase()}</Avatar>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">{o.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{o.email}</Typography>
                </Box>
              </Box>
            );
          }}
          renderTags={(value, getTagProps) =>
            value.map((o, i) => {
              const { key, ...rest } = getTagProps({ index: i });
              return <Chip key={key} size="small" label={o.name} {...rest} />;
            })
          }
          renderInput={(params) => <TextField {...params} label={t('mail.to')} placeholder={to.length ? '' : t('mail.toPlaceholder')} />}
        />
        <TextField label={t('mail.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
        <TextField label={t('mail.message')} value={message} onChange={(e) => setMessage(e.target.value)} multiline minRows={6} slotProps={{ htmlInput: { maxLength: 5000 } }} />
        <Typography variant="caption" color="text.secondary">{t('mail.hint')}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>{t('common.cancel')}</Button>
        <Button variant="contained" startIcon={<MailIcon />} disabled={busy || to.length === 0 || !subject.trim() || !message.trim()} onClick={() => void send()}>
          {t('mail.send')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
