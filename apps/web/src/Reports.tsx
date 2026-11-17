import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  Typography,
  useTheme,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { REPORTS, reportById, type ReportDefinition, type ReportId, type ReportRow } from '@worktime3/shared/reports';
import { buildCsv, buildXlsx, type Cell } from '@worktime3/shared/xlsx';
import { useI18n } from './i18n';
import { PageHeader, TableEmptyRow } from './components';
import { DownloadIcon } from './icons';
import { swissLocale } from './localeFormat';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Preset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisYear' | 'lastYear' | 'custom';
const PRESETS: Preset[] = ['thisMonth', 'lastMonth', 'thisQuarter', 'lastQuarter', 'thisYear', 'lastYear', 'custom'];

const ym = (y: number, m: number) => {
  const d = new Date(y, m, 1); // normalizes m < 0 and m > 11
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** First and last month (yyyy-mm) of a preset, relative to today. */
export function presetRange(preset: Exclude<Preset, 'custom'>, today = new Date()): [string, string] {
  const y = today.getFullYear();
  const m = today.getMonth();
  const q = Math.floor(m / 3) * 3;
  switch (preset) {
    case 'thisMonth': return [ym(y, m), ym(y, m)];
    case 'lastMonth': return [ym(y, m - 1), ym(y, m - 1)];
    case 'thisQuarter': return [ym(y, q), ym(y, q + 2)];
    case 'lastQuarter': return [ym(y, q - 3), ym(y, q - 1)];
    case 'thisYear': return [ym(y, 0), ym(y, m)];
    case 'lastYear': return [ym(y - 1, 0), ym(y - 1, 11)];
  }
}

interface Option { id: string; name: string }
interface Result { ok: boolean; error?: string; groupBy: string[]; rows: ReportRow[]; totals: Record<string, number> }

/**
 * Reports (nav.reports, module `reports`; packages/shared/src/reports.ts, reports.controller.ts):
 * project hours, attendance and overtime, absences. Each shows the people the caller may see on
 * the matching page; filters narrow that down. The table, chart and the Excel/CSV files are built
 * from the same grouped rows, so a download is exactly what is on screen.
 */
export default function Reports({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const theme = useTheme();
  const [reportId, setReportId] = useState<ReportId>('projectHours');
  const def = reportById(reportId) as ReportDefinition;
  const [preset, setPreset] = useState<Preset>('thisYear');
  const [custom, setCustom] = useState<[string, string]>(() => presetRange('thisYear'));
  const [groupBy, setGroupBy] = useState<Record<string, string[]>>(() => Object.fromEntries(REPORTS.map((r) => [r.id, [...r.defaultGroupBy]])));
  const [userId, setUserId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [options, setOptions] = useState<{ people: Option[]; departments: Option[]; projects: Option[] }>({ people: [], departments: [], projects: [] });
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeLabels, setTypeLabels] = useState<Record<string, Record<string, string>>>({});

  const [from, to] = preset === 'custom' ? custom : presetRange(preset);
  const dims = groupBy[reportId];

  // Absence type labels, as the Absences page shows them (static data, else built-in, else the key).
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/static-data/absences`, { headers: await authHeaders() });
        const data = await res.json();
        const row = Array.isArray(data) ? data.find((r) => r.enum_name === 'absence_type') : null;
        setTypeLabels(row?.translation && typeof row.translation === 'object' ? row.translation : {});
      } catch { /* labels fall back to the keys */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  useEffect(() => {
    setUserId('');
    setProjectId('');
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
      if (projectId && reportId === 'projectHours') q.set('projectId', projectId);
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

  const monthLabel = useCallback(
    (m: string) => new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleDateString(swissLocale(locale), { month: 'short', year: 'numeric' }),
    [locale],
  );
  /** A dimension value as people read it. */
  const label = useCallback(
    (dim: string, row: ReportRow): string => {
      const v = String(row[dim] ?? '');
      if (dim === 'person') return String(row.personName ?? v);
      if (dim === 'month') return monthLabel(v);
      if (dim === 'project') return v || t('reports.noProject');
      if (dim === 'type') {
        const fromData = typeLabels[locale]?.[v] ?? typeLabels.en?.[v];
        if (fromData) return fromData;
        const key = `absences.type.${v}`;
        const builtIn = t(key);
        return builtIn !== key ? builtIn : v;
      }
      return v;
    },
    [locale, monthLabel, t, typeLabels],
  );
  const number = useCallback((n: number) => new Intl.NumberFormat(swissLocale(locale), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n), [locale]);

  const shownDims = result?.groupBy ?? dims;
  const rows = result?.rows ?? [];

  const chart = useMemo(() => {
    if (!rows.length) return null;
    const first = shownDims[0];
    const byKey = new Map<string, Record<string, number | string>>();
    for (const r of rows) {
      const key = String(r[first] ?? '');
      const entry = byKey.get(key) ?? { label: label(first, r), ...Object.fromEntries(def.chart.map((c) => [c, 0])) };
      for (const c of def.chart) entry[c] = Math.round(((entry[c] as number) + (Number(r[c]) || 0)) * 100) / 100;
      byKey.set(key, entry);
    }
    return [...byKey.values()].slice(0, 30);
  }, [rows, shownDims, def, label]);

  function toggleDim(d: string) {
    setGroupBy((g) => {
      const current = g[reportId];
      const next = current.includes(d) ? current.filter((x) => x !== d) : [...current, d];
      return { ...g, [reportId]: next.length ? next : current };
    });
  }

  function download(kind: 'xlsx' | 'csv') {
    if (!result) return;
    const header = [...shownDims.map((d) => t(`reports.dim.${d}`)), ...def.measures.map((m) => t(`reports.measure.${m.key}`))];
    const body: Cell[][] = rows.map((r) => [...shownDims.map((d) => label(d, r)), ...def.measures.map((m) => (typeof r[m.key] === 'number' ? (r[m.key] as number) : null))]);
    const totals: Cell[] = [t('reports.total'), ...shownDims.slice(1).map(() => null), ...def.measures.map((m) => result.totals[m.key] ?? null)];
    const name = `apensum-${t(`reports.report.${reportId}`)}-${from}${from === to ? '' : `-${to}`}`.replace(/[^\p{L}\p{N}-]+/gu, '-');
    const blob =
      kind === 'xlsx'
        ? new Blob([buildXlsx(t(`reports.report.${reportId}`), [...shownDims.map((d) => ({ header: t(`reports.dim.${d}`), kind: 'text' as const })), ...def.measures.map((m) => ({ header: t(`reports.measure.${m.key}`), kind: 'number' as const }))], body, totals)], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          })
        : new Blob([buildCsv(header, [...body, totals])], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const palette = [theme.palette.primary.main, theme.palette.success.main, theme.palette.warning.main];

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
          </>
        }
      />

      <Tabs value={reportId} onChange={(_, v) => setReportId(v)}>
        {REPORTS.map((r) => <Tab key={r.id} value={r.id} label={t(`reports.report.${r.id}`)} />)}
      </Tabs>
      <Typography variant="body2" color="text.secondary" sx={{ mt: -1 }}>{t(`reports.report.${reportId}.description`)}</Typography>

      <Paper sx={{ p: 2, display: 'grid', gap: 2 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
          <TextField select size="small" label={t('reports.period')} value={preset} onChange={(e) => setPreset(e.target.value as Preset)} sx={{ minWidth: 170 }}>
            {PRESETS.map((p) => <MenuItem key={p} value={p}>{t(`reports.period.${p}`)}</MenuItem>)}
          </TextField>
          {preset === 'custom' && (
            <>
              <TextField size="small" type="month" label={t('reports.from')} value={custom[0]} onChange={(e) => setCustom([e.target.value, custom[1]])} slotProps={{ inputLabel: { shrink: true } }} />
              <TextField size="small" type="month" label={t('reports.to')} value={custom[1]} onChange={(e) => setCustom([custom[0], e.target.value])} slotProps={{ inputLabel: { shrink: true } }} />
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
          {reportId === 'projectHours' && options.projects.length > 0 && (
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
            return (
              <Chip
                key={d}
                size="small"
                label={at >= 0 && dims.length > 1 ? `${at + 1}. ${t(`reports.dim.${d}`)}` : t(`reports.dim.${d}`)}
                color={at >= 0 ? 'primary' : 'default'}
                variant={at >= 0 ? 'filled' : 'outlined'}
                onClick={() => toggleDim(d)}
              />
            );
          })}
        </Box>
      </Paper>

      {loading && <LinearProgress />}
      {error && <Alert severity="error">{t(`reports.error.${error}`) !== `reports.error.${error}` ? t(`reports.error.${error}`) : t('reports.error.failed')}</Alert>}

      {chart && chart.length > 1 && (
        <Paper sx={{ p: 2 }}>
          <BarChart
            height={260}
            dataset={chart}
            xAxis={[{ scaleType: 'band', dataKey: 'label', tickLabelStyle: { fontSize: 11 } }]}
            yAxis={[{ valueFormatter: (v: number) => new Intl.NumberFormat(swissLocale(locale), { maximumFractionDigits: 0 }).format(v) }]}
            series={def.chart.map((c, i) => ({ dataKey: c, label: t(`reports.measure.${c}`), color: palette[i % palette.length], valueFormatter: (v: number | null) => (v == null ? '' : number(v)) }))}
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
                {def.measures.map((m) => <TableCell key={m.key} align="right">{t(`reports.measure.${m.key}`)}</TableCell>)}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={i} hover>
                  {shownDims.map((d) => <TableCell key={d}>{label(d, r)}</TableCell>)}
                  {def.measures.map((m) => (
                    <TableCell key={m.key} align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: m.key === 'difference' && Number(r[m.key]) < 0 ? 'error.main' : undefined }}>
                      {typeof r[m.key] === 'number' ? number(r[m.key] as number) : '–'}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
              {!loading && result && rows.length === 0 && <TableEmptyRow colSpan={shownDims.length + def.measures.length} title={t('reports.empty')} />}
              {rows.length > 0 && result && (
                <TableRow sx={{ '& td': { fontWeight: 700, borderTop: 2, borderColor: 'divider' } }}>
                  <TableCell colSpan={shownDims.length}>{t('reports.total')}</TableCell>
                  {def.measures.map((m) => <TableCell key={m.key} align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>{number(result.totals[m.key] ?? 0)}</TableCell>)}
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
      <Typography variant="caption" color="text.secondary">{t(`reports.note.${reportId}`)}</Typography>
    </Box>
  );
}
