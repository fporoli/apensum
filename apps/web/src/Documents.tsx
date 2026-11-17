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
  IconButton,
  InputAdornment,
  List,
  MenuItem,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';
import { EmptyState, PageHeader } from './components';
import { DescriptionIcon, DownloadIcon, SearchIcon, VisibilityIcon } from './icons';
import { formatFileSize, formatLocaleDate, swissLocale } from './localeFormat';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Category = 'timesheet' | 'project_timesheet' | 'absence' | 'expense' | 'request' | 'personnel';
const CATEGORIES: Category[] = ['personnel', 'timesheet', 'project_timesheet', 'absence', 'expense', 'request'];

interface PersonalDocument {
  documentId: string;
  category: Category;
  sourceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  date: string;
  addedAt: string;
  superseded: boolean;
  context: Record<string, string | number | null>;
}

const CATEGORY_COLOR: Record<Category, 'primary' | 'secondary' | 'info' | 'success' | 'warning'> = {
  timesheet: 'primary',
  project_timesheet: 'secondary',
  absence: 'info',
  expense: 'success',
  request: 'warning',
  personnel: 'secondary',
};

/**
 * Documents: everything that concerns the signed-in person, in one list (API documents.controller.ts):
 * the PDFs of their approved timesheets and monthly project reports, their absences' and expenses'
 * evidence and their requests' attachments. Only their own; there is no person picker.
 */
export default function Documents({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [docs, setDocs] = useState<PersonalDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const [year, setYear] = useState<string>('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ doc: PersonalDocument; url: string; mimeType: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/documents`, { headers: await authHeaders() });
      const data = await res.json();
      if (!data?.ok) {
        setError(t('documents.loadFailed', { error: data?.error ?? t('common.unknownError') }));
        setDocs([]);
        return;
      }
      setDocs(Array.isArray(data.documents) ? data.documents : []);
    } catch {
      setError(t('common.cannotReachApi'));
      setDocs([]);
    }
  }, [orgId, authHeaders, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Expense category labels (static data, translated per language) for the expense lines.
  const [expenseCategories, setExpenseCategories] = useState<{ values: Record<string, string>; translation: Record<string, Record<string, string>> }>({ values: {}, translation: {} });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/static-data/expenses`, { headers: await authHeaders() });
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows.find((r: { enum_name?: string }) => r.enum_name === 'expense_category') : undefined;
        if (!cancelled && row) setExpenseCategories({ values: row.values ?? {}, translation: row.translation ?? {} });
      } catch {
        /* the raw key is shown instead */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, authHeaders]);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

  const keyOf = (d: PersonalDocument) => d.documentId;

  const monthLabel = useCallback(
    (date: string) => new Intl.DateTimeFormat(swissLocale(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`)),
    [locale],
  );

  const translated = useCallback(
    (key: string, fallback: string) => {
      const text = t(key);
      return text === key ? fallback : text;
    },
    [t],
  );

  /** What the document is about, in one line. */
  const describe = useCallback(
    (d: PersonalDocument): string => {
      const c = d.context;
      switch (d.category) {
        case 'timesheet':
          return monthLabel(d.date);
        case 'project_timesheet':
          return monthLabel(d.date);
        case 'absence': {
          const type = String(c.absenceType ?? '');
          const label = type ? translated(`absences.type.${type}`, type) : '';
          const end = c.dateEnd && c.dateEnd !== d.date ? ` – ${formatLocaleDate(String(c.dateEnd), locale)}` : '';
          return [label, `${formatLocaleDate(d.date, locale)}${end}`].filter(Boolean).join(' · ');
        }
        case 'expense': {
          const amount =
            c.value != null && c.value !== ''
              ? `${new Intl.NumberFormat(swissLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(c.value))} ${c.currency ?? ''}`.trim()
              : '';
          const key = String(c.category ?? '');
          const label = key ? (expenseCategories.translation[locale]?.[key] ?? expenseCategories.values[key] ?? key) : '';
          return [label, amount, c.comment, formatLocaleDate(d.date, locale)].filter(Boolean).join(' · ');
        }
        case 'request':
          return [c.subject, formatLocaleDate(d.date, locale)].filter(Boolean).join(' · ');
        case 'personnel':
          return [c.title, c.category ? t(`personnelDocs.category.${c.category}`) : '', formatLocaleDate(d.date, locale)].filter(Boolean).join(' · ');
      }
    },
    [locale, monthLabel, translated, t, expenseCategories],
  );

  const years = useMemo(() => [...new Set((docs ?? []).map((d) => d.date.slice(0, 4)))].sort().reverse(), [docs]);
  // Start on the most recent year: years of approved months add up quickly.
  const shownYear = year === '' ? (years[0] ?? 'all') : year;
  const inYear = useMemo(() => (docs ?? []).filter((d) => shownYear === 'all' || d.date.startsWith(shownYear)), [docs, shownYear]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inYear.filter((d) => (category === 'all' || d.category === category) && (!q || `${d.fileName} ${describe(d)}`.toLowerCase().includes(q)));
  }, [inYear, category, query, describe]);

  const counts = useMemo(() => {
    const out: Partial<Record<Category, number>> = {};
    for (const d of inYear) out[d.category] = (out[d.category] ?? 0) + 1;
    return out;
  }, [inYear]);

  async function fetchBlob(d: PersonalDocument): Promise<Blob | null> {
    const url = `${API}/organizations/${orgId}/documents/${d.documentId}/download`;
    setBusyKey(keyOf(d));
    setError(null);
    try {
      const res = await fetch(url, { headers: await authHeaders() });
      if (!res.ok) {
        setError(t('documents.openFailed'));
        return null;
      }
      return await res.blob();
    } catch {
      setError(t('common.cannotReachApi'));
      return null;
    } finally {
      setBusyKey(null);
    }
  }

  async function download(d: PersonalDocument) {
    const blob = await fetchBlob(d);
    if (!blob) return;
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = d.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }

  async function open(d: PersonalDocument) {
    const blob = await fetchBlob(d);
    if (!blob) return;
    setPreview({ doc: d, url: URL.createObjectURL(blob), mimeType: d.mimeType });
  }

  const previewable = (d: PersonalDocument) => d.mimeType === 'application/pdf' || d.mimeType.startsWith('image/');

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('documents.title')} subtitle={t('documents.subtitle')} />
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, flex: 1 }}>
          <Chip
            label={`${t('documents.filter.all')} (${inYear.length})`}
            color={category === 'all' ? 'primary' : 'default'}
            variant={category === 'all' ? 'filled' : 'outlined'}
            onClick={() => setCategory('all')}
          />
          {CATEGORIES.filter((c) => counts[c]).map((c) => (
            <Chip
              key={c}
              label={`${t(`documents.category.${c}`)} (${counts[c]})`}
              color={category === c ? CATEGORY_COLOR[c] : 'default'}
              variant={category === c ? 'filled' : 'outlined'}
              onClick={() => setCategory(c)}
            />
          ))}
        </Box>
        {years.length > 1 && (
          <TextField select size="small" label={t('documents.year')} value={shownYear} onChange={(e) => setYear(e.target.value)} sx={{ minWidth: 130 }}>
            {years.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
            <MenuItem value="all">{t('documents.allYears')}</MenuItem>
          </TextField>
        )}
        <TextField
          size="small"
          placeholder={t('documents.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ minWidth: { sm: 240 } }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Stack>

      <Paper variant="outlined">
        {docs === null ? (
          <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<DescriptionIcon fontSize="inherit" />}
            title={docs.length === 0 ? t('documents.empty') : t('documents.noResults')}
            description={docs.length === 0 ? t('documents.emptyHint') : undefined}
          />
        ) : (
          <List disablePadding>
            {visible.map((d, i) => {
              const key = keyOf(d);
              const busy = busyKey === key;
              return (
                <ListItem
                  key={key}
                  divider={i < visible.length - 1}
                  sx={{ gap: 1.5, alignItems: 'flex-start', opacity: d.superseded ? 0.6 : 1, pr: 1 }}
                  secondaryAction={
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      {busy && <CircularProgress size={18} sx={{ mr: 1 }} />}
                      {previewable(d) && (
                        <Tooltip title={t('documents.preview')}>
                          <span>
                            <IconButton aria-label={t('documents.preview')} disabled={busy} onClick={() => void open(d)}>
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      )}
                      <Tooltip title={t('documents.download')}>
                        <span>
                          <IconButton aria-label={t('documents.download')} disabled={busy} onClick={() => void download(d)}>
                            <DownloadIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  }
                >
                  <DescriptionIcon color="action" sx={{ mt: 0.75, display: { xs: 'none', sm: 'block' } }} />
                  <ListItemText
                    sx={{ pr: 10, minWidth: 0 }}
                    primary={
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                          {describe(d)}
                        </Typography>
                        <Chip size="small" label={t(`documents.category.${d.category}`)} color={CATEGORY_COLOR[d.category]} variant="outlined" />
                        {d.superseded && (
                          <Tooltip title={t('documents.superseded.hint')}>
                            <Chip size="small" label={t('documents.superseded')} />
                          </Tooltip>
                        )}
                      </Box>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {d.fileName}
                        {` · ${formatFileSize(d.sizeBytes, locale)}`}
                      </Typography>
                    }
                  />
                </ListItem>
              );
            })}
          </List>
        )}
      </Paper>

      <Dialog open={!!preview} onClose={() => setPreview(null)} maxWidth="lg" fullWidth>
        {preview && (
          <>
            <DialogTitle sx={{ overflowWrap: 'anywhere' }}>{preview.doc.fileName}</DialogTitle>
            <DialogContent dividers sx={{ p: 0, height: '75vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              {preview.mimeType === 'application/pdf' ? (
                <Box component="iframe" src={preview.url} title={preview.doc.fileName} sx={{ border: 0, width: '100%', height: '100%' }} />
              ) : (
                <Box component="img" src={preview.url} alt={preview.doc.fileName} sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
              )}
            </DialogContent>
            <DialogActions>
              <Button startIcon={<DownloadIcon />} onClick={() => void download(preview.doc)}>
                {t('documents.download')}
              </Button>
              <Button onClick={() => setPreview(null)}>{t('common.close')}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
}
