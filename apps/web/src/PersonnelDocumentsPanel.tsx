import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Paper,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';
import { ConfirmDialog, EmptyState } from './components';
import { DeleteIcon, DescriptionIcon, DownloadIcon, VisibilityIcon } from './icons';
import { DropZone, useAttachmentDraft } from './attachments';
import { formatFileSize, formatLocaleDate } from './localeFormat';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
export const PERSONNEL_CATEGORIES = ['evaluation', 'bonus', 'contract', 'certificate', 'salary', 'other'] as const;

interface PersonnelDocument {
  id: string;
  title: string;
  category: (typeof PERSONNEL_CATEGORIES)[number];
  document_date: string | null;
  visible_to_employee: boolean;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  added_at: string;
  uploaded_by: string | null;
}

/**
 * Personnel file (HR dossier) of one person (API personnel-documents.controller.ts): HR adds
 * documents with a title, category and date, and decides per document whether the person sees it
 * (it then appears on their Documents page and they are notified).
 */
export default function PersonnelDocumentsPanel({ orgId, userId, authHeaders, onChanged }: {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
  /** After a document was added, shared, hidden or deleted (e.g. the HR dashboard's timeline). */
  onChanged?: () => void;
}) {
  const { t, locale } = useI18n();
  const base = `${API}/organizations/${orgId}/people/${userId}/personnel-documents`;
  const [docs, setDocs] = useState<PersonnelDocument[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<PersonnelDocument['category']>('evaluation');
  const [date, setDate] = useState('');
  const [share, setShare] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PersonnelDocument | null>(null);
  const onDraftError = useCallback((m: string) => setError(m), []);
  const draft = useAttachmentDraft(onDraftError, { max: 1 });

  const fail = (code?: string) => {
    const key = `personnelDocs.error.${code}`;
    const text = t(key);
    setError(text === key ? t('personnelDocs.error.generic', { error: code ?? t('common.unknownError') }) : text);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, { headers: await authHeaders() });
      const data = await res.json();
      if (!data?.ok) {
        setDocs([]);
        setError(t('personnelDocs.error.generic', { error: data?.error ?? t('common.unknownError') }));
        return;
      }
      setDocs(data.documents ?? []);
      setCanEdit(!!data.canEdit);
    } catch {
      setDocs([]);
      setError(t('common.cannotReachApi'));
    }
  }, [base, authHeaders, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload() {
    const file = draft.files[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('title', title.trim() || file.name.replace(/\.[^.]+$/, ''));
    form.append('category', category);
    if (date) form.append('documentDate', date);
    form.append('visibleToEmployee', String(share));
    try {
      const res = await fetch(base, { method: 'POST', headers: await authHeaders(), body: form });
      if (res.status === 413) {
        setError(t('attachments.rejected'));
        return;
      }
      const data = await res.json();
      if (!data?.ok) {
        fail(data?.error);
        return;
      }
      draft.clear();
      setTitle('');
      setDate('');
      setShare(false);
      await load();
      onChanged?.();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  async function patch(doc: PersonnelDocument, body: Record<string, unknown>) {
    setError(null);
    try {
      const res = await fetch(`${base}/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data?.ok) fail(data?.error);
      await load();
      onChanged?.();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  async function remove(doc: PersonnelDocument) {
    setError(null);
    try {
      const res = await fetch(`${base}/${doc.id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data?.ok) fail(data?.error);
      await load();
      onChanged?.();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  async function download(doc: PersonnelDocument) {
    try {
      const res = await fetch(`${base}/${doc.id}/download`, { headers: await authHeaders() });
      if (!res.ok) {
        setError(t('documents.openFailed'));
        return;
      }
      const href = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = href;
      a.download = doc.file_name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('personnelDocs.title')}</Typography>
        <Typography variant="body2" color="text.secondary">{t('personnelDocs.subtitle')}</Typography>
      </Box>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {canEdit && (
        <Paper variant="outlined" sx={{ p: 1.5 }} onPaste={(e) => draft.onPaste(e)}>
          <DropZone dragging={draft.dragging} dropProps={draft.dropProps}>
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {draft.button}
                {draft.chips ?? <Typography variant="body2" color="text.secondary">{t('personnelDocs.dropHint')}</Typography>}
              </Box>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr 1fr' } }}>
                <TextField size="small" label={t('personnelDocs.docTitle')} value={title} onChange={(e) => setTitle(e.target.value)} slotProps={{ htmlInput: { maxLength: 200 } }} />
                <TextField select size="small" label={t('personnelDocs.category')} value={category} onChange={(e) => setCategory(e.target.value as PersonnelDocument['category'])}>
                  {PERSONNEL_CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>{t(`personnelDocs.category.${c}`)}</MenuItem>
                  ))}
                </TextField>
                <TextField size="small" type="date" label={t('personnelDocs.date')} value={date} onChange={(e) => setDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
                <FormControlLabel control={<Switch checked={share} onChange={(e) => setShare(e.target.checked)} />} label={t('personnelDocs.share')} />
                <Button variant="contained" disabled={busy || draft.files.length === 0} onClick={() => void upload()}>
                  {t('personnelDocs.upload')}
                </Button>
              </Box>
            </Box>
          </DropZone>
        </Paper>
      )}

      {docs === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : docs.length === 0 ? (
        <EmptyState icon={<DescriptionIcon fontSize="inherit" />} title={t('personnelDocs.empty')} />
      ) : (
        <List disablePadding>
          {docs.map((d, i) => (
            <ListItem
              key={d.id}
              divider={i < docs.length - 1}
              sx={{ pr: 1, gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}
              secondaryAction={
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {canEdit && (
                    <Tooltip title={d.visible_to_employee ? t('personnelDocs.unshare') : t('personnelDocs.shareNow')}>
                      <Switch size="small" checked={d.visible_to_employee} onChange={(e) => void patch(d, { visibleToEmployee: e.target.checked })} />
                    </Tooltip>
                  )}
                  <Tooltip title={t('documents.download')}>
                    <IconButton aria-label={t('documents.download')} onClick={() => void download(d)}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {canEdit && (
                    <Tooltip title={t('common.delete')}>
                      <IconButton aria-label={t('common.delete')} color="error" onClick={() => setConfirmDelete(d)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              }
            >
              <ListItemText
                sx={{ pr: canEdit ? 17 : 6, minWidth: 0 }}
                primary={
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{d.title}</Typography>
                    <Chip size="small" variant="outlined" label={t(`personnelDocs.category.${d.category}`)} />
                    {d.visible_to_employee ? (
                      <Chip size="small" color="success" icon={<VisibilityIcon fontSize="small" />} label={t('personnelDocs.shared')} />
                    ) : (
                      <Chip size="small" label={t('personnelDocs.hrOnly')} />
                    )}
                  </Box>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {[d.document_date ? formatLocaleDate(d.document_date, locale) : null, d.file_name, formatFileSize(d.size_bytes, locale), d.uploaded_by]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                }
              />
            </ListItem>
          ))}
        </List>
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('personnelDocs.deleteTitle')}
        message={t('personnelDocs.deleteMessage', { title: confirmDelete?.title ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void remove(confirmDelete);
          setConfirmDelete(null);
        }}
      />
    </Box>
  );
}
