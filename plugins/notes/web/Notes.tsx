import { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material';
import { ConfirmDialog, EmptyState, EditIcon, formatLocaleDateTime, PageHeader, useI18n } from '@worktime3/web/plugin';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Note { id: string; text: string; created_at: string }

/**
 * The caller's notes in this organization: write one, read them newest first, delete one. Like every page,
 * it calls the API with the caller's token and shows the API's errors (CLAUDE.md, "Web conventions").
 */
export default function Notes({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Note | null>(null);

  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/notes${path}`, {
        ...init,
        headers: { ...(await authHeaders()), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      });
      const data = await res.json();
      if (!data?.ok) setError(t(`notes.error.${data?.error}`) === `notes.error.${data?.error}` ? t('notes.error.failed') : t(`notes.error.${data.error}`));
      return data;
    } catch {
      setError(t('common.cannotReachApi'));
      return null;
    }
  }, [orgId, authHeaders, t]);

  const load = useCallback(async () => {
    const data = await call('');
    setNotes(data?.ok ? data.notes : []);
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = await call('', { method: 'POST', body: JSON.stringify({ text }) });
    setBusy(false);
    if (data?.ok) {
      setText('');
      await load();
    }
  }

  return (
    <Stack spacing={2}>
      <PageHeader title={t('notes.title')} subtitle={t('notes.subtitle')} />
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Paper variant="outlined" component="form" onSubmit={add} sx={{ p: 2 }}>
        <TextField
          fullWidth
          multiline
          minRows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('notes.placeholder')}
          inputProps={{ maxLength: 2000 }}
        />
        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="submit" variant="contained" disabled={busy || !text.trim()}>{t('notes.add')}</Button>
        </Box>
      </Paper>
      {notes && notes.length === 0 && (
        <Paper variant="outlined"><EmptyState icon={<EditIcon fontSize="inherit" />} title={t('notes.empty')} /></Paper>
      )}
      {notes?.map((n) => (
        <Paper key={n.id} variant="outlined" sx={{ p: 2 }}>
          <Typography variant="body1" sx={{ whiteSpace: 'pre-wrap' }}>{n.text}</Typography>
          <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary">{formatLocaleDateTime(n.created_at, locale)}</Typography>
            <Button size="small" color="error" onClick={() => setDeleting(n)}>{t('notes.delete')}</Button>
          </Box>
        </Paper>
      ))}
      <ConfirmDialog
        open={!!deleting}
        title={t('notes.delete')}
        message={t('notes.deleteConfirm')}
        confirmLabel={t('notes.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const data = await call(`/${deleting.id}`, { method: 'DELETE' });
          if (data?.ok) await load();
        }}
      />
    </Stack>
  );
}
