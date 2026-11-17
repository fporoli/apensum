import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { REPORTS, reportById, type ReportDefinition, type ReportId, type ReportMeasure, type ReportRow, type SavedReportSettings } from '@worktime3/shared/reports';
import { buildCsv, buildXlsx } from '@worktime3/shared/xlsx';
import { PRESETS, buildReportTable, detailsShown, formatMeasure, labelFor, periodText, presetRange, sortRows, type Preset } from '@worktime3/shared/reportTable';
import { useI18n } from './i18n';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import { DeleteIcon, DownloadIcon, SaveIcon, ScheduleIcon } from './icons';
import { formatLocaleDate, formatLocaleDateTime, swissLocale } from './localeFormat';
import { roleLabel, type OrgRole } from './roleLabel';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** The grouping a report starts with: its default plus the dimensions it always keeps. */
const initialGroupBy = (r: ReportDefinition) => [...r.defaultGroupBy, ...(r.alwaysGroupBy ?? []).filter((d) => !r.defaultGroupBy.includes(d))];

interface Option { id: string; name: string }
interface Result { ok: boolean; error?: string; groupBy: string[]; rows: ReportRow[]; totals: Record<string, number> }
interface SavedReport { id: string; name: string; reportId: ReportId; settings: SavedReportSettings; sharedRoles: string[]; mine: boolean; schedule: { nextRunAt: string; active: boolean } | null }
interface ScheduleForm {
  exists: boolean;
  frequency: 'weekly' | 'monthly';
  weekday: number;
  monthDay: number;
  hour: number;
  format: 'pdf' | 'xlsx';
  recipientUserIds: string[];
  active: boolean;
  nextRunAt?: string;
  runs: { ranAt: string; person: string; error: string | null; periodFrom: string; periodTo: string }[];
}
type Translations = Record<string, Record<string, string>>;

/**
 * Reports (nav.reports, module `reports`; packages/shared/src/reports.ts, reports.controller.ts):
 * project hours, attendance and overtime, absences, expenses and people. Each shows the people the
 * caller may see on the matching page; filters narrow that down. The table, chart and the
 * Excel/CSV/PDF files are built from the same grouped rows, so a download is what is on screen.
 * Saved reports (saved-reports.controller.ts) keep the report, period and choices under a name and
 * can be shared with roles; everyone runs them with their own rights.
 */
export default function Reports({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const [reportId, setReportId] = useState<ReportId>('projectHours');
  const def = reportById(reportId) as ReportDefinition;
  const [preset, setPreset] = useState<Preset>('thisYear');
  const [custom, setCustom] = useState<[string, string]>(() => presetRange('thisYear'));
  const [groupBy, setGroupBy] = useState<Record<string, string[]>>(() => Object.fromEntries(REPORTS.map((r) => [r.id, initialGroupBy(r)])));
  const [userId, setUserId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [options, setOptions] = useState<{ people: Option[]; departments: Option[]; projects: Option[] }>({ people: [], departments: [], projects: [] });
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [absenceLabels, setAbsenceLabels] = useState<Translations>({});
  const [categoryLabels, setCategoryLabels] = useState<{ values: Record<string, string>; translation: Translations }>({ values: {}, translation: {} });

  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [canShare, setCanShare] = useState(false);
  const [savedId, setSavedId] = useState('');
  const [saveDialog, setSaveDialog] = useState<null | { mode: 'new' | 'update'; name: string; sharedRoles: string[] }>(null);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [schedule, setSchedule] = useState<ScheduleForm | null>(null);
  const [recipients, setRecipients] = useState<Option[]>([]);
  const [scheduleBusy, setScheduleBusy] = useState(false);
  /** Filters of a saved report being opened, applied once the new report's options are loaded. */
  const pendingFilters = useRef<{ userId?: string; projectId?: string } | null>(null);

  const [from, to] = preset === 'custom' ? custom : presetRange(preset);
  const dims = groupBy[reportId];

  const errorText = useCallback((code: string) => (t(`reports.error.${code}`) !== `reports.error.${code}` ? t(`reports.error.${code}`) : t('reports.error.failed')), [t]);

  // Absence types and expense categories as their pages show them (static data, else the key).
  useEffect(() => {
    (async () => {
      const headers = await authHeaders();
      const load = async (kind: string) => {
        try {
          const data = await (await fetch(`${API}/organizations/${orgId}/static-data/${kind}`, { headers })).json();
          return Array.isArray(data) ? data : [];
        } catch {
          return [];
        }
      };
      const [absences, expenses] = await Promise.all([load('absences'), load('expenses')]);
      const types = absences.find((r) => r.enum_name === 'absence_type');
      setAbsenceLabels(types?.translation && typeof types.translation === 'object' ? types.translation : {});
      const categories = expenses.find((r) => r.enum_name === 'expense_category');
      setCategoryLabels({ values: categories?.values ?? {}, translation: categories?.translation ?? {} });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  const loadSaved = useCallback(async () => {
    try {
      const data = await (await fetch(`${API}/organizations/${orgId}/saved-reports`, { headers: await authHeaders() })).json();
      if (data?.ok) {
        setSaved(data.reports ?? []);
        setCanShare(!!data.canShare);
      }
    } catch { /* the list stays empty */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    void loadSaved();
    setSavedId('');
  }, [loadSaved]);

  useEffect(() => {
    if (!canShare) return;
    (async () => {
      try {
        const data = await (await fetch(`${API}/organizations/${orgId}/roles`, { headers: await authHeaders() })).json();
        setRoles(Array.isArray(data?.roles) ? data.roles.filter((r: OrgRole) => r.name !== 'owner') : []);
      } catch { /* no roles to share with */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, canShare]);

  useEffect(() => {
    const pending = pendingFilters.current;
    pendingFilters.current = null;
    setUserId(pending?.userId ?? '');
    setProjectId(pending?.projectId ?? '');
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/reports/${reportId}/options`, { headers: await authHeaders() });
        const data = await res.json();
        if (data?.ok) setOptions({ people: data.people ?? [], departments: data.departments ?? [], projects: data.projects ?? [] });
      } catch { /* the run below shows the error */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, reportId]);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams({ from, to, groupBy: dims.join(',') });
      if (userId) q.set('userId', userId);
      if (departmentId) q.set('departmentId', departmentId);
      if (projectId && (reportId === 'projectHours' || reportId === 'expenses')) q.set('projectId', projectId);
      const res = await fetch(`${API}/organizations/${orgId}/reports/${reportId}?${q}`, { headers: await authHeaders() });
      const data = (await res.json()) as Result;
      if (!data?.ok) {
        setError(data?.error ?? 'failed');
        setResult(null);
      } else setResult(data);
    } catch {
      setError('failed');
      setResult(null);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, reportId, from, to, dims.join(','), userId, departmentId, projectId]);

  useEffect(() => {
    void run();
  }, [run]);

  /** A dimension value as people read it (shared with scheduled reports: packages/shared/src/reportTable.ts). */
  const label = useMemo(
    () =>
      labelFor(locale, t, {
        absenceTypes: { translation: absenceLabels },
        categories: categoryLabels,
        fallback: (dim, v) => {
          const key = `absences.type.${v}`;
          return dim === 'type' && t(key) !== key ? t(key) : undefined;
        },
      }),
    [locale, t, absenceLabels, categoryLabels],
  );
  const number = useCallback((n: number, m?: Pick<ReportMeasure, 'kind'>) => formatMeasure(n, m, locale), [locale]);

  const shownDims = result?.groupBy ?? dims;
  // The API sorts by stored values (category and type keys); sort by what people read, months in order.
  const rows = useMemo(() => sortRows(result?.rows ?? [], result?.groupBy ?? [], label, locale), [result, label, locale]);
  const details = detailsShown(def, shownDims);
  const detail = (key: string, r: ReportRow) => {
    const v = String(r[key] ?? '');
    return key === 'startDate' && v ? formatLocaleDate(v, locale) : v;
  };
  const mixedCurrencies = new Set(rows.map((r) => r.currency).filter((c) => c !== undefined)).size > 1;

  const chart = useMemo(() => {
    if (!rows.length) return null;
    if (mixedCurrencies && def.measures.some((m) => m.kind === 'money' && def.chart.includes(m.key))) return null;
    const first = shownDims[0];
    const byKey = new Map<string, Record<string, number | string>>();
    for (const r of rows) {
      const key = String(r[first] ?? '');
      const entry = byKey.get(key) ?? { label: label(first, r), ...Object.fromEntries(def.chart.map((c) => [c, 0])) };
      for (const c of def.chart) entry[c] = Math.round(((entry[c] as number) + (Number(r[c]) || 0)) * 100) / 100;
      byKey.set(key, entry);
    }
    return [...byKey.values()].slice(0, 30);
  }, [rows, shownDims, def, label, mixedCurrencies]);

  function toggleDim(d: string) {
    if (def.alwaysGroupBy?.includes(d)) return;
    setGroupBy((g) => {
      const current = g[reportId];
      const next = current.includes(d) ? current.filter((x) => x !== d) : [...current, d];
      return { ...g, [reportId]: next.some((x) => !def.alwaysGroupBy?.includes(x)) ? next : current };
    });
  }

  // ---- Saved reports -------------------------------------------------------------------------

  function currentSettings(): SavedReportSettings {
    const s: SavedReportSettings = { preset, groupBy: dims };
    if (preset === 'custom') {
      s.from = custom[0];
      s.to = custom[1];
    }
    if (userId) s.userId = userId;
    if (departmentId) s.departmentId = departmentId;
    if (projectId) s.projectId = projectId;
    return s;
  }

  function openSaved(id: string) {
    setSavedId(id);
    const r = saved.find((s) => s.id === id);
    if (!r || !reportById(r.reportId)) return;
    const s = r.settings;
    setPreset((PRESETS as string[]).includes(s.preset) ? (s.preset as Preset) : 'thisYear');
    if (s.preset === 'custom' && s.from && s.to) setCustom([s.from, s.to]);
    setGroupBy((g) => ({ ...g, [r.reportId]: s.groupBy?.length ? s.groupBy : initialGroupBy(reportById(r.reportId) as ReportDefinition) }));
    setDepartmentId(s.departmentId ?? '');
    if (r.reportId !== reportId) {
      pendingFilters.current = { userId: s.userId, projectId: s.projectId };
      setReportId(r.reportId);
    } else {
      setUserId(s.userId ?? '');
      setProjectId(s.projectId ?? '');
    }
  }

  const current = saved.find((s) => s.id === savedId);

  async function submitSave() {
    if (!saveDialog) return;
    const body = JSON.stringify({ name: saveDialog.name, reportId, settings: currentSettings(), sharedRoles: saveDialog.sharedRoles });
    const update = saveDialog.mode === 'update' && current?.mine;
    try {
      const res = await fetch(`${API}/organizations/${orgId}/saved-reports${update ? `/${current.id}` : ''}`, {
        method: update ? 'PUT' : 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body,
      });
      const data = await res.json();
      if (!data?.ok) {
        setNotice({ severity: 'error', text: errorText(data?.error ?? 'failed') });
        return;
      }
      setSaveDialog(null);
      await loadSaved();
      setSavedId(data.id);
      setNotice({ severity: 'success', text: t('reports.saved.done') });
    } catch {
      setNotice({ severity: 'error', text: errorText('failed') });
    }
  }

  async function deleteSaved() {
    if (!current?.mine) return;
    try {
      const res = await fetch(`${API}/organizations/${orgId}/saved-reports/${current.id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data?.ok) {
        setNotice({ severity: 'error', text: errorText(data?.error ?? 'failed') });
        return;
      }
      setSavedId('');
      await loadSaved();
    } catch {
      setNotice({ severity: 'error', text: errorText('failed') });
    }
  }

  // ---- Schedules (report-schedules.service.ts) ---------------------------------------------

  async function openSchedule() {
    if (!current?.mine) return;
    try {
      const headers = await authHeaders();
      const [data, people] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/saved-reports/${current.id}/schedule`, { headers }).then((r) => r.json()),
        fetch(`${API}/organizations/${orgId}/saved-reports/recipients`, { headers }).then((r) => r.json()),
      ]);
      if (!data?.ok) {
        setNotice({ severity: 'error', text: errorText(data?.error ?? 'failed') });
        return;
      }
      const list: Option[] = people?.people ?? [];
      setRecipients(list);
      const s = data.schedule;
      const me = list.length === 1 ? [list[0].id] : [];
      setSchedule({
        exists: !!s,
        frequency: s?.frequency ?? 'monthly',
        weekday: s?.weekday ?? 1,
        monthDay: s?.monthDay ?? 1,
        hour: s?.hour ?? 6,
        format: s?.format ?? 'pdf',
        recipientUserIds: s?.recipientUserIds ?? me,
        active: s?.active ?? true,
        nextRunAt: s?.nextRunAt,
        runs: data.runs ?? [],
      });
    } catch {
      setNotice({ severity: 'error', text: errorText('failed') });
    }
  }

  async function scheduleCall(method: 'PUT' | 'DELETE' | 'POST'): Promise<Record<string, unknown> | null> {
    if (!current?.mine || !schedule) return null;
    setScheduleBusy(true);
    try {
      const path = `${API}/organizations/${orgId}/saved-reports/${current.id}/schedule${method === 'POST' ? '/run' : ''}`;
      const body = method === 'PUT'
        ? JSON.stringify({ frequency: schedule.frequency, weekday: schedule.weekday, monthDay: schedule.monthDay, hour: schedule.hour, format: schedule.format, recipientUserIds: schedule.recipientUserIds, active: schedule.active })
        : undefined;
      const res = await fetch(path, { method, headers: { ...(await authHeaders()), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body });
      const data = await res.json();
      if (!data?.ok) {
        setNotice({ severity: 'error', text: errorText(data?.error ?? 'failed') });
        return null;
      }
      return data;
    } catch {
      setNotice({ severity: 'error', text: errorText('failed') });
      return null;
    } finally {
      setScheduleBusy(false);
    }
  }

  async function saveSchedule() {
    if (await scheduleCall('PUT')) {
      setSchedule(null);
      await loadSaved();
      setNotice({ severity: 'success', text: t('reports.schedule.saved') });
    }
  }

  async function removeSchedule() {
    if (await scheduleCall('DELETE')) {
      setSchedule(null);
      await loadSaved();
    }
  }

  async function runScheduleNow() {
    // Save first, so "Send now" sends what the dialog shows.
    if (!(await scheduleCall('PUT'))) return;
    const data = await scheduleCall('POST');
    if (data) {
      setNotice({ severity: 'success', text: t('reports.schedule.ranNow', { delivered: Number(data.delivered ?? 0), failed: Number(data.failed ?? 0) }) });
      setSchedule(null);
      await loadSaved();
    }
  }

  const weekdays = useMemo(
    () => [1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: new Date(Date.UTC(2024, 0, d)).toLocaleDateString(swissLocale(locale), { weekday: 'long', timeZone: 'UTC' }) })),
    [locale],
  );

  // ---- Downloads -----------------------------------------------------------------------------

  const subtitle = () => {
    const parts = [periodText(def, from, to, locale, t, new Date().toLocaleDateString('sv'))];
    const person = options.people.find((p) => p.id === userId);
    if (person) parts.push(person.name);
    const dept = options.departments.find((d) => d.id === departmentId);
    if (dept) parts.push(dept.name);
    const project = options.projects.find((p) => p.id === projectId);
    if (project && (reportId === 'projectHours' || reportId === 'expenses')) parts.push(project.name);
    return parts.join(' · ');
  };
  const table = () => buildReportTable(def, { groupBy: shownDims, rows, totals: result?.totals ?? {} }, locale, t, label);
  const fileName = (ext: string) => `${`apensum-${current?.name ?? t(`reports.report.${reportId}`)}-${from}${from === to ? '' : `-${to}`}`.replace(/[^\p{L}\p{N}-]+/gu, '-')}.${ext}`;

  function save(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function download(kind: 'xlsx' | 'csv') {
    if (!result) return;
    const tbl = table();
    const blob =
      kind === 'xlsx'
        ? new Blob([buildXlsx(current?.name ?? t(`reports.report.${reportId}`), tbl.columns, tbl.cells, tbl.totalCells)], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          })
        : new Blob([buildCsv(tbl.columns.map((c) => c.header), [...tbl.cells, tbl.totalCells])], { type: 'text/csv;charset=utf-8' });
    save(blob, fileName(kind));
  }

  async function downloadPdf() {
    if (!result) return;
    setPdfBusy(true);
    try {
      const tbl = table();
      const body = {
        title: current?.name ?? t(`reports.report.${reportId}`),
        subtitle: subtitle(),
        footer: t('reports.pdf.footer', { date: formatLocaleDateTime(new Date().toISOString(), locale) }),
        columns: tbl.columns.map((c) => ({ header: c.header, align: c.align })),
        rows: tbl.text,
        totals: tbl.totalText,
      };
      const res = await fetch(`${API}/organizations/${orgId}/reports/pdf`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok || !(res.headers.get('Content-Type') ?? '').includes('application/pdf')) {
        const data = await res.json().catch(() => null);
        setNotice({ severity: 'error', text: errorText(data?.error ?? 'failed') });
        return;
      }
      save(await res.blob(), fileName('pdf'));
    } catch {
      setNotice({ severity: 'error', text: errorText('failed') });
    } finally {
      setPdfBusy(false);
    }
  }

  const palette = [theme.palette.primary.main, theme.palette.success.main, theme.palette.warning.main];
  const filterProjects = (reportId === 'projectHours' || reportId === 'expenses') && options.projects.length > 0;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.lead')}
        end={
          <>
            <Button size="small" variant="outlined" startIcon={<DownloadIcon fontSize="small" />} disabled={!rows.length} onClick={() => download('xlsx')}>
              {t('reports.exportExcel')}
            </Button>
            <Button size="small" variant="outlined" startIcon={<DownloadIcon fontSize="small" />} disabled={!rows.length} onClick={() => download('csv')}>
              {t('reports.exportCsv')}
            </Button>
            <Button size="small" variant="outlined" startIcon={<DownloadIcon fontSize="small" />} disabled={!rows.length || pdfBusy} onClick={() => void downloadPdf()}>
              {t('reports.exportPdf')}
            </Button>
          </>
        }
      />

      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
        <TextField select size="small" label={t('reports.saved')} value={savedId} onChange={(e) => openSaved(e.target.value)} sx={{ minWidth: 240, flex: { xs: '1 1 100%', sm: '0 1 auto' } }}>
          <MenuItem value="">{saved.length ? t('reports.saved.choose') : t('reports.saved.empty')}</MenuItem>
          {saved.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              {s.name}
              {!s.mine && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{t('reports.saved.sharedWithYou')}</Typography>}
              {s.mine && s.sharedRoles.length > 0 && <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>{t('reports.saved.shared')}</Typography>}
              {s.mine && s.schedule?.active && <Typography component="span" variant="caption" color="primary" sx={{ ml: 1 }}>{t('reports.saved.scheduled')}</Typography>}
            </MenuItem>
          ))}
        </TextField>
        <Button size="small" startIcon={<SaveIcon fontSize="small" />} onClick={() => setSaveDialog({ mode: current?.mine ? 'update' : 'new', name: current?.mine ? current.name : '', sharedRoles: current?.mine ? current.sharedRoles : [] })}>
          {current?.mine ? t('reports.saved.update') : t('reports.saved.save')}
        </Button>
        {current?.mine && (
          <>
            <Button size="small" onClick={() => setSaveDialog({ mode: 'new', name: '', sharedRoles: [] })}>{t('reports.saved.saveAs')}</Button>
            <Button size="small" startIcon={<ScheduleIcon fontSize="small" />} onClick={() => void openSchedule()}>{t('reports.schedule.button')}</Button>
            <Tooltip title={t('common.delete')}>
              <IconButton size="small" onClick={() => setConfirmDelete(true)} aria-label={t('common.delete')}><DeleteIcon fontSize="small" /></IconButton>
            </Tooltip>
          </>
        )}
      </Box>
      {notice && <Alert severity={notice.severity} onClose={() => setNotice(null)}>{notice.text}</Alert>}

      <Tabs value={reportId} onChange={(_, v) => { setSavedId(''); setReportId(v); }}>
        {REPORTS.map((r) => <Tab key={r.id} value={r.id} label={t(`reports.report.${r.id}`)} />)}
      </Tabs>
      <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>{t(`reports.report.${reportId}.description`)}</Typography>

      <Paper sx={{ p: 2, display: 'grid', gap: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          <TextField select size="small" label={def.snapshot ? t('reports.asAtPeriod') : t('reports.period')} value={preset} onChange={(e) => setPreset(e.target.value as Preset)} sx={{ minWidth: 170 }}>
            {PRESETS.map((p) => <MenuItem key={p} value={p}>{t(`reports.period.${p}`)}</MenuItem>)}
          </TextField>
          {preset === 'custom' && (
            <>
              {!def.snapshot && <TextField size="small" type="month" label={t('reports.from')} value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} slotProps={{ inputLabel: { shrink: true } }} />}
              <TextField size="small" type="month" label={def.snapshot ? t('reports.month') : t('reports.to')} value={custom[1]} onChange={(e) => setCustom([def.snapshot ? e.target.value : custom[0], e.target.value])} slotProps={{ inputLabel: { shrink: true } }} />
            </>
          )}
          {options.people.length > 1 && (
            <TextField select size="small" label={t('reports.person')} value={userId} onChange={(e) => setUserId(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">{t('reports.allPeople')}</MenuItem>
              {options.people.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </TextField>
          )}
          {options.people.length > 1 && options.departments.length > 0 && (
            <TextField select size="small" label={t('reports.department')} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} sx={{ minWidth: 180 }}>
              <MenuItem value="">{t('reports.allDepartments')}</MenuItem>
              {options.departments.map((d) => <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>)}
            </TextField>
          )}
          {filterProjects && (
            <TextField select size="small" label={t('reports.project')} value={projectId} onChange={(e) => setProjectId(e.target.value)} sx={{ minWidth: 200 }}>
              <MenuItem value="">{t('reports.allProjects')}</MenuItem>
              {options.projects.map((p) => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </TextField>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2" color="text.secondary">{t('reports.groupBy')}</Typography>
          {def.dimensions.map((d) => {
            const at = dims.indexOf(d);
            const fixed = !!def.alwaysGroupBy?.includes(d);
            return (
              <Chip
                key={d}
                size="small"
                label={at >= 0 && dims.length > 1 ? `${at + 1}. ${t(`reports.dim.${d}`)}` : t(`reports.dim.${d}`)}
                color={at >= 0 ? 'primary' : 'default'}
                variant={at >= 0 ? 'filled' : 'outlined'}
                onClick={fixed ? undefined : () => toggleDim(d)}
              />
            );
          })}
        </Box>
      </Paper>

      {loading && <LinearProgress />}
      {error && <Alert severity="error">{errorText(error)}</Alert>}

      {chart && chart.length > 1 && (
        <Paper sx={{ p: 2 }}>
          <BarChart
            height={260}
            dataset={chart}
            xAxis={[{ scaleType: 'band', dataKey: 'label', tickLabelStyle: { fontSize: 11 } }]}
            yAxis={[{ valueFormatter: (v: number) => new Intl.NumberFormat(swissLocale(locale), { maximumFractionDigits: 0 }).format(v) }]}
            series={def.chart.map((c, i) => ({ dataKey: c, label: t(`reports.measure.${c}`), color: palette[i % palette.length], valueFormatter: (v: number | null) => (v == null ? '' : number(v, def.measures.find((m) => m.key === c))) }))}
            margin={{ top: 40, right: 16, bottom: 40, left: 56 }}
          />
        </Paper>
      )}

      <Paper>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {shownDims.map((d) => <TableCell key={d}>{t(`reports.dim.${d}`)}</TableCell>)}
                {details.map((k) => <TableCell key={k}>{t(`reports.detail.${k}`)}</TableCell>)}
                {def.measures.map((m) => <TableCell key={m.key} align="right">{t(`reports.measure.${m.key}`)}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} hover>
                  {shownDims.map((d) => <TableCell key={d}>{label(d, r)}</TableCell>)}
                  {details.map((k) => <TableCell key={k}>{detail(k, r)}</TableCell>)}
                  {def.measures.map((m) => (
                    <TableCell key={m.key} align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: m.key === 'difference' && Number(r[m.key]) < 0 ? 'error.main' : undefined }}>
                      {typeof r[m.key] === 'number' ? number(r[m.key] as number, m) : '–'}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {!loading && result && rows.length === 0 && <TableEmptyRow colSpan={shownDims.length + details.length + def.measures.length} title={t('reports.empty')} />}
              {rows.length > 0 && result && (
                <TableRow sx={{ '& td': { fontWeight: 700, borderTop: 2, borderColor: 'divider' } }}>
                  <TableCell colSpan={shownDims.length + details.length}>{t('reports.total')}</TableCell>
                  {def.measures.map((m) => (
                    <TableCell key={m.key} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {result.totals[m.key] === undefined ? '–' : number(result.totals[m.key], m)}
                    </TableCell>
                  ))}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Typography variant="caption" color="text.secondary">
        {t(`reports.note.${reportId}`)}
        {mixedCurrencies && ` ${t('reports.note.currencies')}`}
      </Typography>

      <Dialog open={!!saveDialog} onClose={() => setSaveDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{saveDialog?.mode === 'update' ? t('reports.saved.update') : t('reports.saved.save')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          <TextField
            autoFocus
            size="small"
            label={t('reports.saved.name')}
            value={saveDialog?.name ?? ''}
            onChange={(e) => setSaveDialog((d) => (d ? { ...d, name: e.target.value } : d))}
            slotProps={{ htmlInput: { maxLength: 120 } }}
          />
          <Typography variant="body2" color="text.secondary">{t('reports.saved.keeps')}</Typography>
          {canShare && roles.length > 0 && (
            <Box>
              <Typography variant="subtitle2">{t('reports.saved.shareWith')}</Typography>
              <FormGroup>
                {roles.map((r) => (
                  <FormControlLabel
                    key={r.id}
                    control={
                      <Checkbox
                        size="small"
                        checked={!!saveDialog?.sharedRoles.includes(r.name)}
                        onChange={(e) => setSaveDialog((d) => (d ? { ...d, sharedRoles: e.target.checked ? [...d.sharedRoles, r.name] : d.sharedRoles.filter((x) => x !== r.name) } : d))}
                      />
                    }
                    label={roleLabel(r, locale)}
                  />
                ))}
              </FormGroup>
              <Typography variant="caption" color="text.secondary">{t('reports.saved.shareHint')}</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialog(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={!saveDialog?.name.trim()} onClick={() => void submitSave()}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!schedule} onClose={() => setSchedule(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('reports.schedule.title', { name: current?.name ?? '' })}</DialogTitle>
        {schedule && (
          <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
              <TextField select size="small" label={t('reports.schedule.frequency')} value={schedule.frequency} onChange={(e) => setSchedule({ ...schedule, frequency: e.target.value as ScheduleForm['frequency'] })} sx={{ minWidth: 160 }}>
                <MenuItem value="weekly">{t('reports.schedule.weekly')}</MenuItem>
                <MenuItem value="monthly">{t('reports.schedule.monthly')}</MenuItem>
              </TextField>
              {schedule.frequency === 'weekly' ? (
                <TextField select size="small" label={t('reports.schedule.weekday')} value={schedule.weekday} onChange={(e) => setSchedule({ ...schedule, weekday: Number(e.target.value) })} sx={{ minWidth: 150 }}>
                  {weekdays.map((d) => <MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}
                </TextField>
              ) : (
                <TextField select size="small" label={t('reports.schedule.monthDay')} value={schedule.monthDay} onChange={(e) => setSchedule({ ...schedule, monthDay: Number(e.target.value) })} sx={{ minWidth: 130 }}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <MenuItem key={d} value={d}>{d}.</MenuItem>)}
                </TextField>
              )}
              <TextField select size="small" label={t('reports.schedule.hour')} value={schedule.hour} onChange={(e) => setSchedule({ ...schedule, hour: Number(e.target.value) })} sx={{ minWidth: 100 }}>
                {Array.from({ length: 24 }, (_, h) => h).map((h) => <MenuItem key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</MenuItem>)}
              </TextField>
              <TextField select size="small" label={t('reports.schedule.format')} value={schedule.format} onChange={(e) => setSchedule({ ...schedule, format: e.target.value as ScheduleForm['format'] })} sx={{ minWidth: 100 }}>
                <MenuItem value="pdf">{t('reports.exportPdf')}</MenuItem>
                <MenuItem value="xlsx">{t('reports.exportExcel')}</MenuItem>
              </TextField>
            </Box>
            <Typography variant="body2" color="text.secondary">{t('reports.schedule.periodHint')}</Typography>
            <TextField
              select
              size="small"
              label={t('reports.schedule.recipients')}
              value={schedule.recipientUserIds}
              onChange={(e) => setSchedule({ ...schedule, recipientUserIds: typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as string[]) })}
              slotProps={{ select: { multiple: true, renderValue: (v) => (v as string[]).map((id) => recipients.find((p) => p.id === id)?.name ?? id).join(', ') } }}
              helperText={t('reports.schedule.recipientsHint')}
            >
              {recipients.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  <Checkbox size="small" checked={schedule.recipientUserIds.includes(p.id)} sx={{ p: 0, mr: 1 }} />
                  {p.name}
                </MenuItem>
              ))}
            </TextField>
            <FormControlLabel control={<Checkbox size="small" checked={schedule.active} onChange={(e) => setSchedule({ ...schedule, active: e.target.checked })} />} label={t('reports.schedule.active')} />
            {schedule.exists && schedule.nextRunAt && (
              <Typography variant="body2">{schedule.active ? t('reports.schedule.next', { date: formatLocaleDateTime(schedule.nextRunAt, locale) }) : t('reports.schedule.paused')}</Typography>
            )}
            {schedule.exists && (
              <Box>
                <Typography variant="subtitle2">{t('reports.schedule.lastRuns')}</Typography>
                {schedule.runs.length === 0 && <Typography variant="body2" color="text.secondary">{t('reports.schedule.noRuns')}</Typography>}
                {schedule.runs.map((r, i) => (
                  <Typography key={i} variant="body2" color={r.error ? 'error' : 'text.secondary'}>
                    {formatLocaleDateTime(r.ranAt, locale)} · {r.person} · {r.error ? errorText(r.error) : t('reports.schedule.delivered')}
                  </Typography>
                ))}
              </Box>
            )}
          </DialogContent>
        )}
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
          {schedule?.exists && <Button color="error" disabled={scheduleBusy} onClick={() => void removeSchedule()} sx={{ mr: 'auto' }}>{t('reports.schedule.remove')}</Button>}
          <Button onClick={() => setSchedule(null)}>{t('common.cancel')}</Button>
          <Button disabled={scheduleBusy || !schedule?.recipientUserIds.length} onClick={() => void runScheduleNow()}>{t('reports.schedule.runNow')}</Button>
          <Button variant="contained" disabled={scheduleBusy || !schedule?.recipientUserIds.length} onClick={() => void saveSchedule()}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        title={t('reports.saved.deleteTitle')}
        message={t('reports.saved.deleteConfirm', { name: current?.name ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={deleteSaved}
      />
    </Box>
  );
}
