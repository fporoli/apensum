import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { staticValueLabel } from '@worktime3/shared/staticData';
import { addMonthsIso, categoryKeys, categoryRules, personnelDocError } from '@worktime3/shared/personnelDocs';
import { useI18n } from './i18n';
import { ConfirmDialog, EmptyState } from './components';
import { DeleteIcon, DescriptionIcon, DownloadIcon, EditIcon, VisibilityIcon } from './icons';
import { DropZone, useAttachmentDraft } from './attachments';
import { formatFileSize, formatLocaleDate } from './localeFormat';
import { DateInput } from './ConfigField';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface PersonnelDocument {
  id: string;
  title: string;
  category: string;
  document_date: string | null;
  effective_date: string | null;
  follow_up_date: string | null;
  visible_to_employee: boolean;
  visible_to_manager: boolean;
  require_ack: boolean;
  acknowledged_at: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  added_at: string;
  uploaded_by: string | null;
}

type CategoryRow = { values: Record<string, unknown>; translation: Record<string, Record<string, string>> };

/** The fields HR sets on a document (the upload form and the edit dialog). */
interface Draft {
  title: string;
  category: string;
  documentDate: string;
  effectiveDate: string;
  followUpDate: string;
  visibleToEmployee: boolean;
  visibleToManager: boolean;
  requireAck: boolean;
}

const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });

/** A new draft in `category`, with what the category asks for by default. */
function draftFor(category: string, categories: CategoryRow, base?: Partial<Draft>): Draft {
  const rules = categoryRules(categories.values[category]);
  const from = base?.effectiveDate || base?.documentDate || today();
  return {
    title: base?.title ?? '',
    category,
    documentDate: base?.documentDate ?? '',
    effectiveDate: base?.effectiveDate ?? '',
    followUpDate: rules.followUpMonths ? addMonthsIso(from, rules.followUpMonths) : '',
    visibleToEmployee: rules.acknowledge,
    visibleToManager: rules.manager,
    requireAck: rules.acknowledge,
  };
}

/**
 * Personnel file (HR dossier) of one person (API personnel-documents.controller.ts). HR adds documents with a
 * title, category, document date, key date (Stichtag) and follow-up date; per document it decides whether the
 * person sees it (Documents page, notified), whether they confirm it, and whether the person's manager sees it.
 * The categories and what each asks for are static data (personnel/document_category). The manager sees what was
 * shared with them, read only.
 */
export default function PersonnelDocumentsPanel({ orgId, userId, authHeaders, onChanged, hideTitle = false }: {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
  /** After a document was added, changed or deleted (e.g. the HR dashboard's timeline). */
  onChanged?: () => void;
  /** Without its own heading, where the surrounding card shows it (the subtitle stays). */
  hideTitle?: boolean;
}) {
  const { t, locale } = useI18n();
  const base = `${API}/organizations/${orgId}/people/${userId}/personnel-documents`;
  const [docs, setDocs] = useState<PersonnelDocument[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [asManager, setAsManager] = useState(false);
  const [categories, setCategories] = useState<CategoryRow>({ values: {}, translation: {} });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<{ doc: PersonnelDocument; draft: Draft } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<PersonnelDocument | null>(null);
  const onDraftError = useCallback((m: string) => setError(m), []);
  const files = useAttachmentDraft(onDraftError, { max: 1 });

  const keys = useMemo(() => categoryKeys(categories.values), [categories]);
  const label = (key: string) => staticValueLabel(categories, locale, key);
  const d = (iso: string | null) => (iso ? formatLocaleDate(iso.slice(0, 10), locale) : '');

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
      setAsManager(!!data.manager);
      if (data.categories) setCategories(data.categories);
    } catch {
      setDocs([]);
      setError(t('common.cannotReachApi'));
    }
  }, [base, authHeaders, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // The upload form starts in the first category, with its defaults.
  useEffect(() => {
    if (!draft && keys.length) setDraft(draftFor(keys[0], categories));
  }, [draft, keys, categories]);

  const problem = (x: Draft) =>
    personnelDocError({ category: x.category, effectiveDate: x.effectiveDate || null, visibleToEmployee: x.visibleToEmployee, requireAck: x.requireAck }, categoryRules(categories.values[x.category]));

  async function upload() {
    const file = files.files[0];
    if (!file || !draft) return;
    const p = problem(draft);
    if (p) return fail(p);
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file, file.name);
    form.append('title', draft.title.trim() || file.name.replace(/\.[^.]+$/, ''));
    form.append('category', draft.category);
    if (draft.documentDate) form.append('documentDate', draft.documentDate);
    if (draft.effectiveDate) form.append('effectiveDate', draft.effectiveDate);
    if (draft.followUpDate) form.append('followUpDate', draft.followUpDate);
    form.append('visibleToEmployee', String(draft.visibleToEmployee));
    form.append('visibleToManager', String(draft.visibleToManager));
    form.append('requireAck', String(draft.visibleToEmployee && draft.requireAck));
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
      files.clear();
      setDraft(draftFor(draft.category, categories));
      await load();
      onChanged?.();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  async function patch(doc: PersonnelDocument, body: Record<string, unknown>): Promise<boolean> {
    setError(null);
    try {
      const res = await fetch(`${base}/${doc.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!data?.ok) fail(data?.error);
      await load();
      onChanged?.();
      return !!data?.ok;
    } catch {
      setError(t('common.cannotReachApi'));
      return false;
    }
  }

  async function saveEdit() {
    if (!editing) return;
    const x = editing.draft;
    const p = problem(x);
    if (p) return fail(p);
    setBusy(true);
    const ok = await patch(editing.doc, {
      title: x.title,
      category: x.category,
      documentDate: x.documentDate || null,
      effectiveDate: x.effectiveDate || null,
      followUpDate: x.followUpDate || null,
      visibleToEmployee: x.visibleToEmployee,
      visibleToManager: x.visibleToManager,
      requireAck: x.visibleToEmployee && x.requireAck,
    });
    setBusy(false);
    if (ok) setEditing(null);
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

  /** The fields of a draft; changing the category applies its defaults but keeps title and dates. */
  function fields(x: Draft, set: (next: Draft) => void, keepSharing: boolean) {
    const rules = categoryRules(categories.values[x.category]);
    const choices = keys.includes(x.category) ? keys : [x.category, ...keys];
    return (
      <Box sx={{ display: 'grid', gap: 1.5 }}>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' } }}>
          <TextField size="small" label={t('personnelDocs.docTitle')} value={x.title} onChange={(e) => set({ ...x, title: e.target.value })} slotProps={{ htmlInput: { maxLength: 200 } }} />
          <TextField
            select
            size="small"
            label={t('personnelDocs.category')}
            value={x.category}
            onChange={(e) => {
              const next = draftFor(e.target.value, categories, x);
              set(keepSharing ? { ...next, visibleToEmployee: x.visibleToEmployee, visibleToManager: x.visibleToManager, requireAck: x.requireAck, followUpDate: x.followUpDate || next.followUpDate } : next);
            }}
          >
            {choices.map((c) => (
              <MenuItem key={c} value={c}>{label(c)}</MenuItem>
            ))}
          </TextField>
        </Box>
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' } }}>
          <DateInput fullWidth label={t('personnelDocs.date')} value={x.documentDate} onChange={(documentDate) => set({ ...x, documentDate })} />
          <DateInput
            fullWidth
            required={rules.keyDate}
            label={t('personnelDocs.keyDate')}
            helperText={t('personnelDocs.keyDateHint')}
            value={x.effectiveDate}
            onChange={(effectiveDate) => {
              // A suggested follow-up moves with the key date.
              const suggested = rules.followUpMonths ? addMonthsIso(x.effectiveDate || x.documentDate || today(), rules.followUpMonths) : '';
              const followUpDate = rules.followUpMonths && (!x.followUpDate || x.followUpDate === suggested) ? addMonthsIso(effectiveDate || today(), rules.followUpMonths) : x.followUpDate;
              set({ ...x, effectiveDate, followUpDate });
            }}
          />
          <DateInput
            fullWidth
            label={t('personnelDocs.followUp')}
            helperText={t('personnelDocs.followUpHint')}
            value={x.followUpDate}
            onChange={(followUpDate) => set({ ...x, followUpDate })}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <FormControlLabel
            control={<Switch checked={x.visibleToEmployee} onChange={(e) => set({ ...x, visibleToEmployee: e.target.checked, requireAck: e.target.checked ? x.requireAck : false })} />}
            label={t('personnelDocs.share')}
          />
          <FormControlLabel
            control={<Switch checked={x.visibleToEmployee && x.requireAck} disabled={!x.visibleToEmployee} onChange={(e) => set({ ...x, requireAck: e.target.checked })} />}
            label={t('personnelDocs.askConfirm')}
          />
          <FormControlLabel control={<Switch checked={x.visibleToManager} onChange={(e) => set({ ...x, visibleToManager: e.target.checked })} />} label={t('personnelDocs.shareManager')} />
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box>
        {!hideTitle && <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('personnelDocs.title')}</Typography>}
        <Typography variant="body2" color="text.secondary">{asManager ? t('personnelDocs.managerSubtitle') : t('personnelDocs.subtitle')}</Typography>
      </Box>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {canEdit && draft && (
        <Paper variant="outlined" sx={{ p: 1.5 }} onPaste={(e) => files.onPaste(e)}>
          <DropZone dragging={files.dragging} dropProps={files.dropProps}>
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {files.button}
                {files.chips ?? <Typography variant="body2" color="text.secondary">{t('personnelDocs.dropHint')}</Typography>}
              </Box>
              {fields(draft, setDraft, false)}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="contained" disabled={busy || files.files.length === 0} onClick={() => void upload()}>
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
        <EmptyState icon={<DescriptionIcon fontSize="inherit" />} title={asManager ? t('personnelDocs.managerEmpty') : t('personnelDocs.empty')} />
      ) : (
        <List disablePadding>
          {docs.map((doc, i) => (
            <ListItem
              key={doc.id}
              divider={i < docs.length - 1}
              sx={{ pr: 1, gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}
              secondaryAction={
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  {canEdit && (
                    <Tooltip title={t('common.edit')}>
                      <IconButton aria-label={t('common.edit')} onClick={() => setEditing({ doc, draft: {
                        title: doc.title,
                        category: doc.category,
                        documentDate: doc.document_date ?? '',
                        effectiveDate: doc.effective_date ?? '',
                        followUpDate: doc.follow_up_date ?? '',
                        visibleToEmployee: doc.visible_to_employee,
                        visibleToManager: doc.visible_to_manager,
                        requireAck: doc.require_ack,
                      } })}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  <Tooltip title={t('documents.download')}>
                    <IconButton aria-label={t('documents.download')} onClick={() => void download(doc)}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  {canEdit && (
                    <Tooltip title={t('common.delete')}>
                      <IconButton aria-label={t('common.delete')} color="error" onClick={() => setConfirmDelete(doc)}>
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
                    <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{doc.title}</Typography>
                    <Chip size="small" variant="outlined" label={label(doc.category)} />
                    {doc.effective_date && <Chip size="small" variant="outlined" label={t('personnelDocs.keyDateOn', { date: d(doc.effective_date) })} />}
                    {!asManager &&
                      (doc.visible_to_employee ? (
                        <Chip size="small" color="success" icon={<VisibilityIcon fontSize="small" />} label={t('personnelDocs.shared')} />
                      ) : (
                        <Chip size="small" label={t('personnelDocs.hrOnly')} />
                      ))}
                    {!asManager && doc.visible_to_manager && <Chip size="small" color="info" variant="outlined" label={t('personnelDocs.managerSees')} />}
                    {doc.require_ack &&
                      (doc.acknowledged_at ? (
                        <Chip size="small" color="success" variant="outlined" label={t('personnelDocs.confirmedOn', { date: d(doc.acknowledged_at) })} />
                      ) : (
                        <Chip size="small" color="warning" variant="outlined" label={t('personnelDocs.confirmOpen')} />
                      ))}
                    {doc.follow_up_date && <Chip size="small" variant="outlined" label={t('personnelDocs.followUpOn', { date: d(doc.follow_up_date) })} />}
                  </Box>
                }
                secondary={
                  <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {[doc.document_date ? d(doc.document_date) : null, doc.file_name, formatFileSize(doc.size_bytes, locale), t('personnelDocs.addedBy', { date: d(doc.added_at), name: doc.uploaded_by ?? '—' })]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                }
              />
            </ListItem>
          ))}
        </List>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} fullWidth maxWidth="md">
        <DialogTitle>{t('personnelDocs.editTitle')}</DialogTitle>
        <DialogContent dividers>{editing && fields(editing.draft, (next) => setEditing({ ...editing, draft: next }), true)}</DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={busy} onClick={() => void saveEdit()}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

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
