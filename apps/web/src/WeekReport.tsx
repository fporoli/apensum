import { Fragment, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  IconButton,
  LinearProgress,
  Link,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { Button } from './Button';
import { useI18n } from './i18n';
import { formatDurationMinutes, formatLocaleDate, formatSignedMinutes, swissLocale } from './localeFormat';
import { ClockTimeField } from './TimeFields';
import BalanceOverview from './BalanceOverview';
import { ExpandLessIcon, ExpandMoreIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Line {
  id: string | null;
  name: string | null;
  minutes: number[];
  total: number;
}

interface Project extends Line {
  subprojects: Line[];
}

interface Day {
  date: string;
  target: number;
  attended: number;
  project: number;
  holiday: string | null;
  absenceType: string | null;
  notRecorded?: boolean;
}

interface Report {
  weekStart: string;
  week: number;
  today: string;
  days: Day[];
  grid: { dates: string[]; projects: Project[] };
}

interface Session {
  id: string;
  check_in: string;
  check_out: string | null;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A local date and "HH:mm" as an instant (the browser's zone, as the other time pages). */
function instant(date: string, time: string): string {
  return new Date(`${date}T${time}`).toISOString();
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/**
 * The weekly report (Wochenrapport), the week view of the project time page: attendance (In & Out),
 * the target and the project time per project and subproject for each day, with the differences;
 * beside it the selected day's attendance (and adding a session) and the person's balances. A view:
 * time is still submitted per month. Clicking a cell hands its day and project to the entry form.
 */
export default function WeekReport({
  orgId,
  personId,
  isSelf,
  canEdit,
  anchor,
  refreshKey,
  authHeaders,
  onPick,
  compact = false,
  hideTitle = false,
}: {
  orgId: string;
  personId: string;
  isSelf: boolean;
  canEdit: boolean;
  /** Any day of the week shown. */
  anchor: string;
  refreshKey: unknown;
  authHeaders: () => Promise<Record<string, string>>;
  onPick?: (date: string, projectId: string | null, subprojectId: string | null) => void;
  /** Without the side panel (the day's sessions and the balances), e.g. where the balances show anyway. */
  compact?: boolean;
  /** Without its own heading, where the surrounding card shows it. */
  hideTitle?: boolean;
}) {
  const { t, locale } = useI18n();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmLong, setConfirmLong] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`${API}/organizations/${orgId}/users/${personId}/week-report?week=${anchor}&lang=${locale}`, { headers: await authHeaders() });
        const data = await res.json();
        if (cancelled) return;
        if (data.ok === false) {
          setReport(null);
          setError(t('weekReport.loadFailed', { error: data.error ?? t('common.unknownError') }));
        } else if (data.days) {
          setReport(data);
          // Keep the chosen day when it is in this week; else today when it is, else Monday.
          setDay((current) => (current && data.grid.dates.includes(current) ? current : data.grid.dates.includes(data.today) ? data.today : data.weekStart));
        }
      } catch {
        if (!cancelled) setError(t('common.cannotReachApi'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, personId, anchor, refreshKey, saved, locale]);

  // The selected day's sessions.
  useEffect(() => {
    if (!day) return;
    let cancelled = false;
    (async () => {
      try {
        const from = instant(day, '00:00');
        const to = instant(addDays(day, 1), '00:00');
        const res = await fetch(`${API}/organizations/${orgId}/work-time?userId=${personId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { headers: await authHeaders() });
        const data = await res.json();
        if (!cancelled) setSessions(Array.isArray(data.entries) ? data.entries : []);
      } catch {
        if (!cancelled) setSessions([]);
      }
    })();
    setSaveError(null);
    setConfirmLong(null);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, personId, day, saved, refreshKey]);

  async function addSession(acknowledgeLongSession = false) {
    if (!day || !checkIn || !checkOut) return;
    setSaveError(null);
    // "Gehen" before "Kommen" is the next morning (a night shift).
    const end = instant(checkOut <= checkIn ? addDays(day, 1) : day, checkOut);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/users/${personId}/work-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ checkIn: instant(day, checkIn), checkOut: end, acknowledgeLongSession: acknowledgeLongSession || undefined }),
      });
      const data = await res.json();
      if (data.ok === false) {
        if (data.error === 'long-session-confirm') {
          const minutes = Math.round((Date.parse(end) - Date.parse(instant(day, checkIn))) / 60000);
          setConfirmLong(t('workTime.longSession', { duration: formatDurationMinutes(minutes) }));
          return;
        }
        setConfirmLong(null);
        setSaveError(sessionError(data.error));
        return;
      }
      setConfirmLong(null);
      setCheckIn(null);
      setCheckOut(null);
      setSaved((n) => n + 1);
    } catch {
      setSaveError(t('common.cannotReachApi'));
    }
  }

  function sessionError(code: string | undefined): string {
    if (code === 'period-locked') return t('workTime.periodLocked');
    if (code === 'invalid-range') return t('workTime.invalidRange');
    if (code === 'overlap') return t('workTime.overlapRefused');
    if (code === 'crosses-month') return t('workTime.crossesMonth');
    return t('weekReport.saveFailed', { error: code ?? t('common.unknownError') });
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString(swissLocale(locale), { hour: '2-digit', minute: '2-digit' });
  const weekday = (date: string) =>
    new Date(`${date}T00:00:00Z`).toLocaleDateString(swissLocale(locale), { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
  const weekend = (i: number) => i >= 5;
  const cell = (m: number) => (m ? formatDurationMinutes(m) : '');
  const signed = (a: number, b: number) => (a || b ? formatSignedMinutes(a - b) : '');
  const diffColor = (a: number, b: number) => (a - b > 0 ? 'success.main' : a - b < 0 ? 'error.main' : 'text.secondary');

  if (!report) {
    return (
      <Box sx={{ mt: 2 }}>
        {loading && <LinearProgress />}
        {error && <Alert severity="error">{error}</Alert>}
      </Box>
    );
  }

  const dates = report.grid.dates;
  const attended = report.days.map((d) => d.attended);
  const targets = report.days.map((d) => d.target);
  const projectMinutes = report.days.map((d) => d.project);
  const selected = report.days.find((d) => d.date === day) ?? null;
  const dayCellSx = (i: number) => ({
    whiteSpace: 'nowrap' as const,
    ...(weekend(i) ? { bgcolor: 'action.hover' } : {}),
    ...(dates[i] === day ? { bgcolor: 'action.selected' } : {}),
  });
  const pickable = canEdit && !!onPick;
  const lineRow = (key: string, label: React.ReactNode, l: Line, projectId: string | null, subprojectId: string | null, opts: { bold?: boolean; indent?: boolean } = {}) => (
    <TableRow key={key} hover>
      <TableCell sx={{ pl: opts.indent ? 6 : 1, fontWeight: opts.bold ? 600 : undefined }}>{label}</TableCell>
      {l.minutes.map((m, i) => (
        <TableCell
          key={i}
          align="right"
          sx={{ ...dayCellSx(i), fontWeight: opts.bold ? 600 : undefined, cursor: pickable ? 'pointer' : undefined }}
          onClick={pickable ? () => onPick?.(dates[i], projectId, subprojectId) : undefined}
          title={pickable ? t('weekReport.pickHint') : undefined}
        >
          {cell(m)}
        </TableCell>
      ))}
      <TableCell align="right" sx={{ fontWeight: 600 }}>{cell(l.total)}</TableCell>
    </TableRow>
  );

  return (
    <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: compact ? '1fr' : { xs: '1fr', lg: 'minmax(0, 1fr) 300px' }, alignItems: 'start', mt: compact ? 0 : 2 }}>
      <Box sx={{ minWidth: 0 }}>
        {loading && <LinearProgress />}
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {!hideTitle && (
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
            {t('weekReport.title')} · {t('weekReport.week', { week: String(report.week) })}
          </Typography>
        )}
        <TableContainer>
          {/* Figures stay on one line; the first column (names) wraps. */}
          <Table size="small" sx={{ '& td, & th': { whiteSpace: 'nowrap' }, '& td:first-of-type': { whiteSpace: 'normal', minWidth: 160 } }}>
            <TableHead>
              <TableRow>
                <TableCell />
                {report.days.map((d, i) => (
                  <TableCell key={d.date} align="right" sx={{ ...dayCellSx(i), cursor: 'pointer', verticalAlign: 'bottom' }} onClick={() => setDay(d.date)}>
                    <Box sx={{ fontWeight: 600 }}>{weekday(d.date)}</Box>
                    {(d.holiday || d.absenceType) && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', whiteSpace: 'normal', lineHeight: 1.2 }}>
                        {d.holiday ?? t(`absences.type.${d.absenceType}`)}
                      </Typography>
                    )}
                  </TableCell>
                ))}
                <TableCell align="right" sx={{ fontWeight: 600 }}>{t('weekReport.total')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{t('weekReport.inOut')}</TableCell>
                {attended.map((m, i) => (<TableCell key={i} align="right" sx={{ ...dayCellSx(i), fontWeight: 600 }}>{cell(m)}</TableCell>))}
                <TableCell align="right" sx={{ fontWeight: 600 }}>{cell(sum(attended))}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{t('weekReport.target')}</TableCell>
                {targets.map((m, i) => (<TableCell key={i} align="right" sx={dayCellSx(i)}>{cell(m)}</TableCell>))}
                <TableCell align="right">{cell(sum(targets))}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell colSpan={9} sx={{ bgcolor: 'action.selected', fontWeight: 600 }}>{t('weekReport.projectTime')}</TableCell>
              </TableRow>
              {report.grid.projects.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9}>
                    <Typography variant="body2" color="text.secondary">{t('time.noEntries')}</Typography>
                  </TableCell>
                </TableRow>
              )}
              {report.grid.projects.map((p) => {
                const key = p.id ?? '';
                const open = !collapsed.has(key);
                const label = (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {p.subprojects.length > 0 ? (
                      <IconButton
                        size="small"
                        aria-label={open ? t('weekReport.collapse') : t('weekReport.expand')}
                        onClick={() => setCollapsed((s) => {
                          const next = new Set(s);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        })}
                      >
                        {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                      </IconButton>
                    ) : (
                      <Box sx={{ width: 30 }} />
                    )}
                    {p.name ?? t('weekReport.noProject')}
                  </Box>
                );
                return (
                  <Fragment key={key}>
                    {lineRow(`p-${key}`, label, p, p.id, null, { bold: true })}
                    {open && p.subprojects.map((s) => lineRow(`s-${key}-${s.id ?? ''}`, s.name ?? t('weekReport.noSubproject'), s, p.id, s.id, { indent: true }))}
                  </Fragment>
                );
              })}
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>{t('weekReport.total')}</TableCell>
                {projectMinutes.map((m, i) => (<TableCell key={i} align="right" sx={{ ...dayCellSx(i), fontWeight: 600 }}>{cell(m)}</TableCell>))}
                <TableCell align="right" sx={{ fontWeight: 600 }}>{cell(sum(projectMinutes))}</TableCell>
              </TableRow>
              {!report.days.every((d) => d.notRecorded) && ([
                ['weekReport.diffAttendance', attended],
                ['weekReport.diffTarget', targets],
              ] as const).map(([label, other]) => (
                <TableRow key={label}>
                  <TableCell sx={{ color: 'text.secondary' }}>{t(label)}</TableCell>
                  {projectMinutes.map((m, i) => (
                    <TableCell key={i} align="right" sx={{ ...dayCellSx(i), color: diffColor(m, other[i]) }}>{report.days[i].notRecorded ? '' : signed(m, other[i])}</TableCell>
                  ))}
                  <TableCell align="right" sx={{ color: diffColor(sum(projectMinutes), sum(other)) }}>{signed(sum(projectMinutes), sum(other))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {pickable && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{t('weekReport.pickHint')}</Typography>
        )}
      </Box>

      {!compact && <Box sx={{ display: 'grid', gap: 2 }}>
        {selected && (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              {t('weekReport.dayTitle', { date: formatLocaleDate(selected.date, locale) })}
            </Typography>
            {sessions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">{t('weekReport.noSessions')}</Typography>
            ) : (
              sessions.map((s) => (
                <Typography key={s.id} variant="body2">
                  {time(s.check_in)} – {s.check_out ? time(s.check_out) : t('weekReport.open')}
                </Typography>
              ))
            )}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('weekReport.totalHours')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{formatDurationMinutes(selected.attended)}</Typography>
            </Box>
            {canEdit && (
              <Box
                component="form"
                sx={{ mt: 1.5 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void addSession();
                }}
              >
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <ClockTimeField label={t('weekReport.checkIn')} value={checkIn} onChange={setCheckIn} sx={{ flex: 1 }} />
                  <ClockTimeField label={t('weekReport.checkOut')} value={checkOut} onChange={setCheckOut} sx={{ flex: 1 }} />
                </Box>
                {saveError && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setSaveError(null)}>{saveError}</Alert>}
                {confirmLong && (
                  <Alert
                    severity="warning"
                    sx={{ mt: 1 }}
                    action={<Button color="inherit" size="small" onClick={() => void addSession(true)}>{t('weekReport.saveAnyway')}</Button>}
                  >
                    {confirmLong}
                  </Alert>
                )}
                <Button type="submit" variant="contained" size="small" sx={{ mt: 1 }} disabled={!checkIn || !checkOut}>
                  {t('weekReport.addSession')}
                </Button>
              </Box>
            )}
          </Paper>
        )}
        <BalanceOverview orgId={orgId} authHeaders={authHeaders} userId={isSelf ? undefined : personId} showToday={false} layout="column" refreshKey={`${String(refreshKey)}-${saved}`} />
        {isSelf && (
          <Link href="#/absences" underline="hover" sx={{ textAlign: 'center' }}>{t('weekReport.addAbsence')}</Link>
        )}
      </Box>}
    </Box>
  );
}
