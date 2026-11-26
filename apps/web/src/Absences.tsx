import { useEffect, useRef, useState } from 'react';
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
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { useI18n } from './i18n';
import { formatFileSize, formatLocaleDate, formatRelativeTime, swissLocale } from './localeFormat';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import {
  BeachAccessIcon,
  CalendarMonthIcon,
  CloseIcon,
  ContentCopyIcon,
  DeleteIcon,
  DownloadIcon,
  UploadIcon,
  VisibilityIcon,
} from './icons';
import { SortHeader, TableSearch, useTableView, type TableColumn } from './TableView';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Status = 'pending' | 'approved' | 'rejected';


interface AbsenceRow {
  id: string;
  date_start: string;
  date_end: string;
  status: Status;
  absence_type: string;
  half_day: boolean;
  document_id: string | null;
  note: string | null;
  review_note: string | null;
}

interface DocumentMeta {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

const STATUS_COLOR: Record<Status, 'default' | 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'error',
};

function toDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

export function getAbsenceTitle(row: { date_start: string; date_end: string }): string {
  return row.date_start === row.date_end ? toDisplayDate(row.date_start) : `${toDisplayDate(row.date_start)}–${toDisplayDate(row.date_end)}`;
}

interface AbsencesProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

export default function Absences({ orgId, userId, authHeaders }: AbsencesProps) {
  const { t, locale } = useI18n();
  const [requests, setRequests] = useState<AbsenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [note, setNote] = useState('');
  const [absenceType, setAbsenceType] = useState('');
  const [halfDay, setHalfDay] = useState(false);
  // All from the absences/absence_type static data row: keys, per-type attributes, labels per locale.
  const [absenceTypes, setAbsenceTypes] = useState<string[]>([]);
  const [noApprovalTypes, setNoApprovalTypes] = useState<string[]>([]);
  const [typeLabels, setTypeLabels] = useState<Record<string, Record<string, string>>>({});
  const [file, setFile] = useState<File | null>(null);
  // Vacation in probation: a warning, the request goes on.
  const [probationUntil, setProbationUntil] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setProbationUntil(null);
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/vacation-settings`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled && data?.ok) setProbationUntil(data.probationUntil ?? null);
      } catch { /* only a hint: the manager is warned by the server anyway */ }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [viewingRow, setViewingRow] = useState<AbsenceRow | null>(null);
  const [viewingDocument, setViewingDocument] = useState<DocumentMeta | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState<string | null>(null);

  interface CalendarFeedData {
    token: string;
    enabled: boolean;
    scope: 'personal' | 'team' | 'all';
    includeHolidays: boolean;
    createdAt: string;
    lastAccessedAt: string | null;
    feedUrl: string;
    webcalUrl: string;
  }

  const [calendarDialogOpen, setCalendarDialogOpen] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedData, setFeedData] = useState<CalendarFeedData | null>(null);
  const [feedAllowedScopes, setFeedAllowedScopes] = useState<Array<'personal' | 'team' | 'all'>>(['personal']);
  const [feedCopied, setFeedCopied] = useState(false);
  const [feedConfirmRegenerate, setFeedConfirmRegenerate] = useState(false);
  const [feedConfirmDisable, setFeedConfirmDisable] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [feedSuccess, setFeedSuccess] = useState<string | null>(null);

  async function openCalendarDialog() {
    setCalendarDialogOpen(true);
    setFeedLoading(true);
    setFeedError(null);
    setFeedSuccess(null);
    setFeedCopied(false);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/calendar-feed`, {
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data.ok) {
        setFeedData(data.feed);
        if (Array.isArray(data.allowedScopes)) {
          setFeedAllowedScopes(data.allowedScopes);
        }
      } else {
        setFeedError(data.error ?? t('common.unknownError'));
      }
    } catch {
      setFeedError(t('common.cannotReachApi'));
    } finally {
      setFeedLoading(false);
    }
  }

  async function handleUpdateFeed(options: {
    enabled?: boolean;
    scope?: 'personal' | 'team' | 'all';
    includeHolidays?: boolean;
    regenerate?: boolean;
  }) {
    setFeedLoading(true);
    setFeedError(null);
    setFeedSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/calendar-feed`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
      });
      const data = await res.json();
      if (data.ok) {
        setFeedData(data.feed);
        if (options.regenerate) {
          setFeedSuccess(t('absences.calendarFeed.copied'));
        }
      } else {
        setFeedError(data.error ?? t('common.unknownError'));
      }
    } catch {
      setFeedError(t('common.cannotReachApi'));
    } finally {
      setFeedLoading(false);
      setFeedConfirmRegenerate(false);
    }
  }

  async function handleDisableFeed() {
    setFeedLoading(true);
    setFeedError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/calendar-feed`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (data.ok) {
        setFeedData(null);
      }
    } catch {
      setFeedError(t('common.cannotReachApi'));
    } finally {
      setFeedLoading(false);
      setFeedConfirmDisable(false);
    }
  }

  async function copyFeedUrl() {
    if (!feedData?.feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedData.feedUrl);
      setFeedCopied(true);
      setTimeout(() => setFeedCopied(false), 3000);
    } catch {
      /* clipboard fallback */
    }
  }

  const isSingleDay = !!dateStart && dateStart === dateEnd;

  async function reload() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/absences?userId=${userId}`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setRequests(data);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  async function loadAbsenceTypes() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/static-data/absences`, { headers: await authHeaders() });
      const data = await res.json();
      const row = Array.isArray(data) ? data.find((r) => r.enum_name === 'absence_type') : null;
      const values = row?.values && typeof row.values === 'object' ? (row.values as Record<string, unknown>) : {};
      const keys = Object.keys(values);
      setAbsenceTypes(keys);
      setNoApprovalTypes(keys.filter((k) => (values[k] as { approval?: unknown } | null)?.approval === false));
      setTypeLabels(row?.translation && typeof row.translation === 'object' ? row.translation : {});
      setAbsenceType((current) => (keys.includes(current) ? current : (keys[0] ?? '')));
    } catch { /* offline: no types */ }
  }

  useEffect(() => {
    void reload();
    void loadAbsenceTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  useEffect(() => {
    if (!isSingleDay) setHalfDay(false);
  }, [isSingleDay]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function closeDocumentDialog() {
    setViewingRow(null);
    setViewingDocument(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }

  /** The static data label in the current language (else English), else a built-in translation, else the key. */
  function typeLabel(type: string): string {
    const fromData = typeLabels[locale]?.[type] ?? typeLabels.en?.[type];
    if (fromData) return fromData;
    const key = `absences.type.${type}`;
    const builtIn = t(key);
    return builtIn !== key ? builtIn : type;
  }

  async function submit() {
    setError(null);
    setSuccess(null);
    if (!dateStart || !dateEnd) {
      setError(t('absences.datesRequired'));
      return;
    }
    try {
      const res = await fetch(`${API}/organizations/${orgId}/absences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ dateStart, dateEnd, note, absenceType, halfDay: isSingleDay && halfDay }),
      });
      const data = await res.json();
      if (!data.ok) {
        const messages: Record<string, string> = {
          'overlapping-request': t('absences.overlapping'),
          'half-day-requires-single-day': t('absences.halfDayRequiresSingleDay'),
          'invalid-absence-type': t('absences.invalidAbsenceType'),
          'period-locked': t('absences.periodLocked'),
        };
        setError(messages[data.error] ?? t('absences.submitFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      if (file) {
        const form = new FormData();
        form.append('file', file);
        try {
          const uploadRes = await fetch(`${API}/organizations/${orgId}/absences/${data.id}/document`, {
            method: 'POST',
            headers: await authHeaders(),
            body: form,
          });
          const uploadData = await uploadRes.json();
          if (!uploadData.ok) setError(t('absences.uploadFailed', { error: uploadData.error ?? 'unknown error' }));
        } catch {
          setError(t('absences.uploadFailed', { error: 'offline' }));
        }
      }
      setSuccess(data.managerNotified ? t('absences.recorded') : data.autoApproved ? t('absences.autoApproved') : t('absences.submitted'));
      setDateStart('');
      setDateEnd('');
      setNote('');
      setAbsenceType(absenceTypes[0] ?? '');
      setHalfDay(false);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      await reload();
    } catch {
      setError(t('absences.submitFailed', { error: 'offline' }));
    }
  }

  async function cancel(id: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/absences/${id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(t('absences.cancelFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      await reload();
    } catch {
      setError(t('absences.cancelFailed', { error: 'offline' }));
    }
  }

  async function viewDocument(row: AbsenceRow) {
    setViewingRow(row);
    setViewingDocument(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/organizations/${orgId}/absences/${row.id}/document`, { headers });
      const data: DocumentMeta | null = await res.json();
      if (data) {
        setViewingDocument(data);
        if (data.mime_type.startsWith('image/') || data.mime_type === 'application/pdf') {
          const fileRes = await fetch(`${API}/absences/${row.id}/document`, { headers });
          const blob = await fileRes.blob();
          setPreviewUrl(URL.createObjectURL(blob));
        }
      }
    } catch { /* offline fallback */ }
  }

  async function downloadDocument(absenceId: string, doc: DocumentMeta) {
    try {
      const res = await fetch(`${API}/absences/${absenceId}/document`, { headers: await authHeaders() });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* offline fallback */ }
  }

  async function deleteDocument(absenceId: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/absences/${absenceId}/document`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(t('absences.deleteDocumentFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      closeDocumentDialog();
      setSuccess(t('absences.documentDeleted'));
      await reload();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  const requestColumns: TableColumn<AbsenceRow>[] = [
    { key: 'from', value: (r) => r.date_start, search: false },
    { key: 'to', value: (r) => r.date_end, search: false },
    { key: 'type', value: (r) => typeLabel(r.absence_type) },
    { key: 'status', value: (r) => t(`absences.status.${r.status}`) },
    { key: 'comment', value: (r) => (r.status === 'rejected' && r.review_note ? r.review_note : r.note) ?? null },
  ];
  const requestView = useTableView('core.absences.mine', requests, requestColumns);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('absences.title')}
        end={
          <Button
            variant="outlined"
            size="small"
            startIcon={<CalendarMonthIcon fontSize="small" />}
            onClick={() => void openCalendarDialog()}
          >
            {t('absences.calendarFeed.button')}
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <Paper
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        sx={{ p: 2 }}
      >
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <DatePicker
            label={t('absences.dateFrom')}
            value={dateStart ? dayjs(dateStart) : null}
            onChange={(d: Dayjs | null) => {
              const next = d && d.isValid() ? d.format('YYYY-MM-DD') : '';
              setDateStart(next);
              // Typing a date passes through valid-looking partial years (2, 20, 202): only a full
              // year moves the end date along, when it is empty or would lie before the start.
              if (next && d && d.year() >= 1900 && (!dateEnd || dateEnd < next)) setDateEnd(next);
            }}
            slotProps={{ textField: { size: 'small', sx: { minWidth: 160 } } }}
          />
          <DatePicker
            label={t('absences.dateTo')}
            value={dateEnd ? dayjs(dateEnd) : null}
            minDate={dateStart ? dayjs(dateStart) : undefined}
            onChange={(d: Dayjs | null) => setDateEnd(d && d.isValid() ? d.format('YYYY-MM-DD') : '')}
            slotProps={{ textField: { size: 'small', sx: { minWidth: 160 } } }}
          />
          <TextField
            select
            size="small"
            label={t('absences.type')}
            value={absenceType}
            onChange={(e) => setAbsenceType(e.target.value)}
            helperText={noApprovalTypes.includes(absenceType) ? t('absences.noApprovalHint') : undefined}
            slotProps={{ select: { renderValue: (value) => typeLabel(value as string) } }}
            sx={{ minWidth: 170 }}
          >
            {absenceTypes.map((type) => (
              <MenuItem key={type} value={type} sx={{ display: 'flex', justifyContent: 'space-between', gap: 3 }}>
                <span>{typeLabel(type)}</span>
                <Typography variant="caption" color={noApprovalTypes.includes(type) ? 'info.main' : 'text.secondary'}>
                  {noApprovalTypes.includes(type) ? t('absences.path.notify') : t('absences.path.approval')}
                </Typography>
              </MenuItem>
            ))}
          </TextField>
          {isSingleDay && (
            <ToggleButtonGroup value={halfDay ? 'half' : 'full'} exclusive onChange={(_, v) => v && setHalfDay(v === 'half')} size="small">
              <ToggleButton value="full">{t('absences.dayType.full')}</ToggleButton>
              <ToggleButton value="half">{t('absences.dayType.half')}</ToggleButton>
            </ToggleButtonGroup>
          )}
          <TextField label={t('time.comment')} size="small" value={note} onChange={(e) => setNote(e.target.value)} sx={{ minWidth: 220, flex: 1 }} />
          <Button variant="outlined" size="small" component="label" startIcon={<UploadIcon fontSize="small" />} sx={{ height: 40 }}>
            {file ? file.name : t('absences.attachDocument')}
            <input ref={fileInputRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </Button>
          <Button type="submit" variant="contained" sx={{ height: 40 }}>{noApprovalTypes.includes(absenceType) ? t('absences.record') : t('absences.request')}</Button>
        </Box>
        {absenceType === 'vacation' && dateStart && probationUntil && dateStart <= probationUntil && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>{t('absences.probationWarning', { date: toDisplayDate(probationUntil) })}</Alert>
        )}
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5, mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('absences.myRequests')}</Typography>
          <TableSearch view={requestView} />
        </Box>
        {loading && <LinearProgress sx={{ mb: 1 }} />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <SortHeader view={requestView} column="from">{t('absences.dateFrom')}</SortHeader>
                <SortHeader view={requestView} column="to">{t('absences.dateTo')}</SortHeader>
                <SortHeader view={requestView} column="type">{t('absences.type')}</SortHeader>
                <SortHeader view={requestView} column="status">{t('timesheet.status')}</SortHeader>
                <SortHeader view={requestView} column="comment">{t('time.comment')}</SortHeader>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {requests.length > 0 && requestView.rows.length === 0 && <TableEmptyRow colSpan={6} title={t('table.noMatch')} />}
              {requestView.rows.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell>{formatLocaleDate(r.date_start, locale)}</TableCell>
                  <TableCell>{formatLocaleDate(r.date_end, locale)}</TableCell>
                  <TableCell>
                    <Chip label={typeLabel(r.absence_type)} size="small" variant="outlined" />
                    {r.half_day && <Chip label={t('absences.dayType.half')} size="small" sx={{ ml: 0.5 }} />}
                  </TableCell>
                  <TableCell><Chip label={t(`absences.status.${r.status}`)} size="small" color={STATUS_COLOR[r.status]} /></TableCell>
                  <TableCell>{r.status === 'rejected' && r.review_note ? r.review_note : (r.note || '—')}</TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {r.document_id && (
                      <Tooltip title={t('absences.documents')}>
                        <IconButton size="small" aria-label={t('absences.documents')} onClick={() => void viewDocument(r)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                    {r.status === 'pending' && (
                      <Tooltip title={t('absences.cancel')}>
                        <IconButton size="small" color="error" aria-label={t('absences.cancel')} onClick={() => setConfirmCancelId(r.id)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {requests.length === 0 && (
                <TableEmptyRow colSpan={6} icon={<BeachAccessIcon fontSize="inherit" />} title={t('time.noEntries')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!viewingRow} onClose={closeDocumentDialog} fullWidth maxWidth="sm">
        <DialogTitle>{t('absences.documents')}</DialogTitle>
        <DialogContent dividers>
          {viewingDocument ? (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{viewingDocument.file_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('absences.fileSize', { size: formatFileSize(viewingDocument.size_bytes, locale) })} · {new Date(viewingDocument.created_at).toLocaleString(swissLocale(locale))}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon fontSize="small" />}
                  onClick={() => viewingRow && void downloadDocument(viewingRow.id, viewingDocument)}
                >
                  {t('absences.download')}
                </Button>
              </Box>
              {previewUrl && viewingDocument.mime_type.startsWith('image/') && (
                <Box component="img" src={previewUrl} alt={viewingDocument.file_name} sx={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 1 }} />
              )}
              {previewUrl && viewingDocument.mime_type === 'application/pdf' && (
                <Box component="iframe" src={previewUrl} title={viewingDocument.file_name} sx={{ width: '100%', height: 380, border: 1, borderColor: 'divider', borderRadius: 1 }} />
              )}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">{t('absences.noDocuments')}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          {viewingRow?.status === 'pending' && viewingDocument && (
            <Button color="error" onClick={() => setConfirmDeleteDocId(viewingRow.id)}>
              {t('absences.deleteDocument')}
            </Button>
          )}
          <Button onClick={closeDocumentDialog}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmCancelId}
        title={t('absences.cancelTitle')}
        message={t('absences.cancelConfirm')}
        confirmLabel={t('absences.cancel')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmCancelId(null)}
        onConfirm={() => {
          if (confirmCancelId) return cancel(confirmCancelId);
        }}
      />

      <ConfirmDialog
        open={!!confirmDeleteDocId}
        title={t('absences.deleteDocument')}
        message={t('absences.deleteDocumentConfirm')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDeleteDocId(null)}
        onConfirm={() => {
          if (confirmDeleteDocId) return deleteDocument(confirmDeleteDocId);
        }}
      />

      {/* Calendar Feed Subscription Dialog */}
      <Dialog
        open={calendarDialogOpen}
        onClose={() => setCalendarDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CalendarMonthIcon color="primary" />
            <Typography variant="h6" component="span" sx={{ fontSize: '1.15rem', fontWeight: 600 }}>
              {t('absences.calendarFeed.dialogTitle')}
            </Typography>
          </Box>
          <IconButton size="small" onClick={() => setCalendarDialogOpen(false)} aria-label="close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {feedError && <Alert severity="error" onClose={() => setFeedError(null)}>{feedError}</Alert>}
          {feedSuccess && <Alert severity="success" onClose={() => setFeedSuccess(null)}>{feedSuccess}</Alert>}

          {feedLoading && !feedData ? (
            <Box sx={{ py: 6, display: 'flex', justifyContent: 'center' }}>
              <CircularProgress size={36} />
            </Box>
          ) : !feedData ? (
            <Paper variant="outlined" sx={{ p: 3, textAlign: 'center', bgcolor: 'background.default', borderRadius: 2 }}>
              <CalendarMonthIcon sx={{ fontSize: 44, color: 'primary.main', mb: 1 }} />
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 0.5 }}>
                {t('absences.calendarFeed.dialogTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460, mx: 'auto', mb: 2.5 }}>
                {t('absences.calendarFeed.intro')}
              </Typography>
              <Button
                variant="contained"
                onClick={() => void handleUpdateFeed({ enabled: true, scope: 'personal', includeHolidays: true })}
                disabled={feedLoading}
                startIcon={<CalendarMonthIcon fontSize="small" />}
              >
                {t('absences.calendarFeed.enable')}
              </Button>
            </Paper>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Chip
                    label={feedData.enabled ? t('absences.calendarFeed.active') : t('absences.calendarFeed.disabled')}
                    color={feedData.enabled ? 'success' : 'default'}
                    size="small"
                  />
                  <Typography variant="caption" color="text.secondary">
                    {feedData.lastAccessedAt
                      ? t('absences.calendarFeed.lastSynced', { time: formatRelativeTime(feedData.lastAccessedAt, locale) })
                      : t('absences.calendarFeed.neverSynced')}
                  </Typography>
                </Box>
              </Box>

              <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                <FormControl component="fieldset" fullWidth>
                  <FormLabel component="legend" sx={{ fontSize: '0.8rem', fontWeight: 600, mb: 0.5 }}>
                    {t('absences.calendarFeed.scope')}
                  </FormLabel>
                  <RadioGroup
                    value={feedData.scope}
                    onChange={(e) => void handleUpdateFeed({ scope: e.target.value as 'personal' | 'team' | 'all' })}
                  >
                    <FormControlLabel
                      value="personal"
                      control={<Radio size="small" />}
                      label={<Typography variant="body2">{t('absences.calendarFeed.scopePersonal')}</Typography>}
                    />
                    {feedAllowedScopes.includes('team') && (
                      <FormControlLabel
                        value="team"
                        control={<Radio size="small" />}
                        label={<Typography variant="body2">{t('absences.calendarFeed.scopeTeam')}</Typography>}
                      />
                    )}
                    {feedAllowedScopes.includes('all') && (
                      <FormControlLabel
                        value="all"
                        control={<Radio size="small" />}
                        label={<Typography variant="body2">{t('absences.calendarFeed.scopeAll')}</Typography>}
                      />
                    )}
                  </RadioGroup>
                </FormControl>

                <Divider sx={{ my: 1.5 }} />

                <FormControlLabel
                  control={
                    <Switch
                      size="small"
                      checked={feedData.includeHolidays}
                      onChange={(e) => void handleUpdateFeed({ includeHolidays: e.target.checked })}
                    />
                  }
                  label={<Typography variant="body2">{t('absences.calendarFeed.includeHolidays')}</Typography>}
                />
              </Paper>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                <Button
                  variant="contained"
                  component="a"
                  href={feedData.webcalUrl}
                  startIcon={<CalendarMonthIcon fontSize="small" />}
                  fullWidth
                  sx={{ py: 1 }}
                >
                  {t('absences.calendarFeed.subscribeOneClick')}
                </Button>

                <TextField
                  size="small"
                  label={t('absences.calendarFeed.feedUrlLabel')}
                  value={feedData.feedUrl}
                  fullWidth
                  slotProps={{
                    input: {
                      readOnly: true,
                      sx: { fontFamily: 'monospace', fontSize: '0.82rem' },
                      endAdornment: (
                        <InputAdornment position="end">
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => void copyFeedUrl()}
                            startIcon={<ContentCopyIcon fontSize="small" />}
                          >
                            {feedCopied ? t('absences.calendarFeed.copied') : t('absences.calendarFeed.copy')}
                          </Button>
                        </InputAdornment>
                      ),
                    },
                  }}
                />

                {feedData.feedUrl.startsWith('http://') && (
                  <Alert severity="info" sx={{ fontSize: '0.8rem', py: 0.5 }}>
                    {t('absences.calendarFeed.localhostHint')}
                  </Alert>
                )}
              </Box>

              <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default', borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.82rem' }}>
                  {t('absences.calendarFeed.howToSubscribe')}
                </Typography>
                <Box
                  component="ul"
                  sx={{
                    pl: 2.5,
                    m: 0,
                    fontSize: '0.8rem',
                    color: 'text.secondary',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.75,
                  }}
                >
                  <li>{t('absences.calendarFeed.guideOutlook')}</li>
                  <li>{t('absences.calendarFeed.guideGoogle')}</li>
                  <li>{t('absences.calendarFeed.guideApple')}</li>
                </Box>
              </Paper>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pt: 1 }}>
                <Button
                  size="small"
                  color="warning"
                  onClick={() => setFeedConfirmRegenerate(true)}
                  disabled={feedLoading}
                >
                  {t('absences.calendarFeed.regenerate')}
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() => setFeedConfirmDisable(true)}
                  disabled={feedLoading}
                >
                  {t('absences.calendarFeed.disable')}
                </Button>
              </Box>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 2.5, py: 1.5 }}>
          <Button onClick={() => setCalendarDialogOpen(false)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={feedConfirmRegenerate}
        title={t('absences.calendarFeed.regenerate')}
        message={t('absences.calendarFeed.regenerateConfirm')}
        confirmLabel={t('absences.calendarFeed.regenerate')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void handleUpdateFeed({ regenerate: true })}
        onClose={() => setFeedConfirmRegenerate(false)}
      />

      <ConfirmDialog
        open={feedConfirmDisable}
        title={t('absences.calendarFeed.disable')}
        message={t('absences.calendarFeed.disableConfirm')}
        confirmLabel={t('absences.calendarFeed.disable')}
        cancelLabel={t('common.cancel')}
        onConfirm={() => void handleDisableFeed()}
        onClose={() => setFeedConfirmDisable(false)}
      />
    </Box>
  );
}
