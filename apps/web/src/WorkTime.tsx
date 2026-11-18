import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
} from '@mui/material';
import BalanceOverview from './BalanceOverview';
import { useI18n } from './i18n';
import { formatDurationMinutes, formatLocaleDateTime, formatSignedMinutes, swissLocale } from './localeFormat';
import { ConfirmDialog, PageHeader, PersonPicker, TableEmptyRow } from './components';
import { BalancesPanel, formatDays } from './BalancesPanel';
import { AddIcon, DeleteIcon, EditIcon, PlayArrowIcon, StopIcon, TimerIcon } from './icons';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { ClockTimeField, DurationField } from './TimeFields';
import { sessionFromParts } from './timeInput';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Session {
  id: string;
  check_in: string;
  check_out: string | null;
  comment: string | null;
}

interface Balance {
  /** Booked at timesheet approval. */
  overtimeMinutes: number;
  /** Running actual − target of the days no approved timesheet covers yet. */
  pendingOvertimeMinutes: number;
  /** Vacation days left this year, after approved future vacation. */
  vacationDays: number;
}

type RangeKey = '14d' | 'thisMonth' | 'lastMonth' | '90d';

function rangeBounds(range: RangeKey): { from: string; to: string } {
  const now = new Date();
  if (range === 'thisMonth') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (range === 'lastMonth') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  const days = range === '90d' ? 90 : 13;
  return {
    from: new Date(Date.now() - days * 86400000).toISOString(),
    to: new Date(Date.now() + 86400000).toISOString(),
  };
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return '—';
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  return formatDurationMinutes(mins);
}

function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(swissLocale(locale), { dateStyle: 'short', timeStyle: 'short' });
}

/** A session as the dialog edits it: a day, a start, and an end time and duration kept in step. */
interface SessionDraft {
  id: string;
  date: string;
  start: string | null;
  end: string | null;
  duration: number | null;
  /** Which of end and duration the user set last; it stays fixed when the start or day changes. */
  source: 'end' | 'duration';
  /** The stored session is still running (no check-out yet). */
  open: boolean;
  comment: string;
}

function draftFromSession(s: Pick<Session, 'id' | 'check_in' | 'check_out' | 'comment'>): SessionDraft {
  const start = dayjs(s.check_in);
  const end = s.check_out ? dayjs(s.check_out) : null;
  const duration = end ? Math.round(end.diff(start, 'minute')) : null;
  return {
    id: s.id,
    date: start.format('YYYY-MM-DD'),
    start: start.format('HH:mm'),
    end: end ? end.format('HH:mm') : null,
    duration,
    // A session longer than a day can only be expressed as a duration.
    source: duration !== null && duration >= 24 * 60 ? 'duration' : 'end',
    open: !s.check_out,
    comment: s.comment ?? '',
  };
}

/** The draft as check-in/check-out, computed from its start and the value the user set last. */
function draftSessionOf(d: SessionDraft) {
  if (!d.start) return null;
  return sessionFromParts(d.date, d.start, d.source === 'end' ? { kind: 'end', time: d.end } : { kind: 'duration', minutes: d.duration });
}

/** Applies a change and recomputes the value the user did not set (end from duration or the other way). */
function updateDraft(d: SessionDraft, patch: Partial<SessionDraft>): SessionDraft {
  const next = { ...d, ...patch };
  const session = draftSessionOf(next);
  if (!session) return next;
  if (next.source === 'end') {
    next.duration = session.checkOut ? Math.round((Date.parse(session.checkOut) - Date.parse(session.checkIn)) / 60000) : null;
  } else {
    next.end = session.checkOut ? dayjs(session.checkOut).format('HH:mm') : null;
  }
  return next;
}

interface WorkTimeProps {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
  onWorkTimeChanged?: () => void;
  /** Opens the page on this person (from the team overview). */
  initialPersonId?: string;
}

export default function WorkTime({ orgId, userId, authHeaders, onWorkTimeChanged, initialPersonId }: WorkTimeProps) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<'sessions' | 'balances'>('sessions');
  const [range, setRange] = useState<RangeKey>('14d');
  const [status, setStatus] = useState<Session | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [entries, setEntries] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A session over 16 hours (usually a forgotten check-out): confirmed before it is saved.
  const [longConfirm, setLongConfirm] = useState<{ kind: 'checkout' | 'save'; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<SessionDraft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  // Whose sessions are shown: one's own, or (manager/HR) someone whose work time one may correct.
  const [personId, setPersonId] = useState(initialPersonId ?? userId);
  const isSelf = personId === userId;
  // Back to the opened person (or oneself) when the org or user changes; also runs on mount.
  useEffect(() => setPersonId(initialPersonId ?? userId), [orgId, userId, initialPersonId]);

  /** API error code -> message; a locked month has to be reopened by the manager or HR. */
  function failure(key: string, code: string | undefined): string {
    if (code === 'period-locked') return t('workTime.periodLocked');
    if (code === 'invalid-range') return t('workTime.invalidRange');
    return t(key, { error: code ?? 'unknown error' });
  }

  function changed() {
    if (isSelf) onWorkTimeChanged?.();
  }

  async function reloadStatus() {
    try {
      const res = await fetch(`${API}/work-time/status`, { headers: await authHeaders() });
      setStatus(await res.json());
    } catch { /* offline fallback */ }
  }

  async function reloadBalance() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/balances`, { headers: await authHeaders() });
      const data = await res.json();
      setBalance(data ? { overtimeMinutes: data.overtimeMinutes, pendingOvertimeMinutes: data.pendingOvertimeMinutes ?? 0, vacationDays: data.vacationDays ?? 0 } : null);
    } catch { /* offline fallback */ }
  }

  async function reloadEntries(selectedRange = range) {
    const { from, to } = rangeBounds(selectedRange);
    try {
      const res = await fetch(
        `${API}/organizations/${orgId}/work-time?userId=${personId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { headers: await authHeaders() },
      );
      const data = await res.json();
      if (Array.isArray(data.entries)) setEntries([...data.entries].reverse());
    } catch { /* offline fallback */ }
  }

  async function reloadAll() {
    setLoading(true);
    await Promise.all(isSelf ? [reloadStatus(), reloadBalance(), reloadEntries()] : [reloadEntries()]);
    setBalanceRefreshKey((k) => k + 1);
    setLoading(false);
  }

  useEffect(() => {
    void reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId, personId]);

  useEffect(() => {
    void reloadEntries(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    if (!status?.check_in || status.check_out) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  async function checkIn() {
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/work-time/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(failure('workTime.checkInFailed', data.error));
        return;
      }
      await reloadAll();
      changed();
    } catch {
      setError(t('workTime.checkInFailed', { error: 'offline' }));
    }
  }

  async function checkOut(acknowledgeLongSession = false) {
    setError(null);
    try {
      const res = await fetch(`${API}/work-time/check-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ acknowledgeLongSession }),
      });
      const data = await res.json();
      if (data.error === 'long-session-confirm') {
        const minutes = Math.round((Date.now() - new Date(data.checkIn).getTime()) / 60000);
        setLongConfirm({
          kind: 'checkout',
          message: t('workTime.longCheckOut', { since: formatLocaleDateTime(data.checkIn, locale), duration: formatDurationMinutes(minutes) }),
        });
        return;
      }
      if (!data.ok) {
        setError(t('workTime.checkOutFailed', { error: data.error ?? 'unknown error' }));
        return;
      }
      await reloadAll();
      changed();
    } catch {
      setError(t('workTime.checkOutFailed', { error: 'offline' }));
    }
  }

  async function removeEntry(id: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/work-time/${id}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data.ok) {
        setError(failure('workTime.deleteFailed', data.error));
        return;
      }
      await reloadAll();
      changed();
    } catch {
      setError(t('workTime.deleteFailed', { error: 'offline' }));
    }
  }

  async function saveDraft(acknowledgeLongSession = false) {
    if (!draft || !draftSession) return;
    setError(null);
    const body = JSON.stringify({ checkIn: draftSession.checkIn, checkOut: draftSession.checkOut, comment: draft.comment, acknowledgeLongSession });
    try {
      // A new entry (no id) is added by hand for the person shown; an existing one is patched.
      const res = draft.id
        ? await fetch(`${API}/work-time/${draft.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body,
          })
        : await fetch(`${API}/organizations/${orgId}/users/${personId}/work-time`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body,
          });
      const data = await res.json();
      if (data.error === 'long-session-confirm' && draftSession.checkOut) {
        const minutes = Math.round((new Date(draftSession.checkOut).getTime() - new Date(draftSession.checkIn).getTime()) / 60000);
        setLongConfirm({ kind: 'save', message: t('workTime.longSession', { duration: formatDurationMinutes(minutes) }) });
        return;
      }
      if (!data.ok) {
        setError(failure('workTime.saveFailed', data.error));
        return;
      }
      setDraft(null);
      await reloadAll();
      changed();
    } catch {
      setError(t('workTime.saveFailed', { error: 'offline' }));
    }
  }

  // The draft as check-in/check-out; a running session may keep its end empty, a new one may not.
  const draftSession = draft ? draftSessionOf(draft) : null;
  const draftValid = !!draftSession && (!!draftSession.checkOut || draft!.open);

  const checkedIn = !!status && !status.check_out;
  const elapsed = checkedIn ? Math.max(0, Math.round((now - new Date(status!.check_in).getTime()) / 60000)) : 0;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('workTime.title')}
        end={
          <>
            <PersonPicker orgId={orgId} kind="workTime" selfId={userId} value={personId} onChange={setPersonId} authHeaders={authHeaders} highlight={!!initialPersonId} />
            {isSelf && balance && (
            <>
              <Tooltip
                title={t('workTime.overtimeBreakdown', {
                  booked: formatSignedMinutes(balance.overtimeMinutes),
                  pending: formatSignedMinutes(balance.pendingOvertimeMinutes),
                })}
              >
                <Chip
                  label={t('workTime.overtimeBalance', { value: formatSignedMinutes(balance.overtimeMinutes + balance.pendingOvertimeMinutes) })}
                  color={balance.overtimeMinutes + balance.pendingOvertimeMinutes < 0 ? 'error' : 'success'}
                  variant="outlined"
                  size="small"
                />
              </Tooltip>
              <Chip
                label={t('workTime.vacationBalance', { value: formatDays(balance.vacationDays, locale) })}
                color="default"
                variant="outlined"
                size="small"
              />
            </>
            )}
          </>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {loading && <LinearProgress />}

      {isSelf && (
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              color={checkedIn ? 'warning' : 'success'}
              startIcon={checkedIn ? <StopIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
              onClick={() => void (checkedIn ? checkOut() : checkIn())}
            >
              {checkedIn ? t('workTime.checkOut') : t('workTime.checkIn')}
            </Button>
            {checkedIn && (
              <Typography variant="body2" color="text.secondary">
                {t('workTime.checkedInSince', { time: formatDateTime(status!.check_in, locale), elapsed: formatDurationMinutes(elapsed) })}
              </Typography>
            )}
          </Box>
        </Box>
      </Paper>
      )}

      {isSelf && <BalanceOverview orgId={orgId} authHeaders={authHeaders} refreshKey={balanceRefreshKey} />}

      <Paper sx={{ p: 2 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
          <Tab value="sessions" label={t('workTime.tab.sessions')} />
          {isSelf && <Tab value="balances" label={t('workTime.tab.balances')} />}
        </Tabs>

        {tab === 'sessions' || !isSelf ? (
          <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('workTime.recentSessions')}</Typography>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                size="small"
                startIcon={<AddIcon fontSize="small" />}
                onClick={() => {
                  const start = dayjs().hour(8).minute(0).second(0).millisecond(0);
                  setDraft(draftFromSession({ id: '', check_in: start.toISOString(), check_out: start.add(8, 'hour').toISOString(), comment: null }));
                }}
              >
                {t('workTime.addEntry')}
              </Button>
              <TextField
                select
                size="small"
                label={t('workTime.rangeLabel')}
                value={range}
                onChange={(e) => setRange(e.target.value as RangeKey)}
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="14d">{t('workTime.range.14d')}</MenuItem>
                <MenuItem value="thisMonth">{t('workTime.range.thisMonth')}</MenuItem>
                <MenuItem value="lastMonth">{t('workTime.range.lastMonth')}</MenuItem>
                <MenuItem value="90d">{t('workTime.range.90d')}</MenuItem>
              </TextField>
              </Box>
            </Box>

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('workTime.checkIn')}</TableCell>
                    <TableCell>{t('workTime.checkOut')}</TableCell>
                    <TableCell>{t('workTime.duration')}</TableCell>
                    <TableCell>{t('time.comment')}</TableCell>
                    <TableCell align="right">{t('common.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((e) => (
                    <TableRow key={e.id} hover>
                      <TableCell>{formatDateTime(e.check_in, locale)}</TableCell>
                      <TableCell>{formatDateTime(e.check_out, locale)}</TableCell>
                      <TableCell>{formatDuration(e.check_in, e.check_out)}</TableCell>
                      <TableCell>{e.comment || '—'}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title={t('time.edit')}>
                          <IconButton size="small" aria-label={t('time.edit')} onClick={() => setDraft(draftFromSession(e))}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('time.remove')}>
                          <IconButton size="small" color="error" aria-label={t('time.remove')} onClick={() => setConfirmDeleteId(e.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                  {entries.length === 0 && (
                    <TableEmptyRow colSpan={5} icon={<TimerIcon fontSize="inherit" />} title={t('time.noEntries')} />
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        ) : (
          <BalancesPanel
            orgId={orgId}
            userId={userId}
            authHeaders={authHeaders}
            refreshKey={balanceRefreshKey}
            onChanged={() => {
              void reloadBalance();
            }}
          />
        )}
      </Paper>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            void saveDraft();
          }}
        >
          <DialogTitle>{draft?.id ? t('workTime.editSession') : t('workTime.addEntry')}</DialogTitle>
          {draft && (
            <DialogContent sx={{ display: 'grid', gap: 1.5, pt: 1 }}>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 1 }}>
                <DatePicker
                  label={t('time.date')}
                  value={dayjs(draft.date)}
                  onChange={(d: Dayjs | null) => d && d.isValid() && setDraft(updateDraft(draft, { date: d.format('YYYY-MM-DD') }))}
                  slotProps={{ textField: { size: 'small', required: true, helperText: ' ', sx: { flex: '1 1 100%' } } }}
                />
                <ClockTimeField
                  label={t('time.start')}
                  value={draft.start}
                  onChange={(v) => setDraft(updateDraft(draft, { start: v }))}
                  required
                  sx={{ flex: '1 1 110px' }}
                />
                <ClockTimeField
                  label={t('workTime.endTime')}
                  value={draft.end}
                  onChange={(v) => setDraft(updateDraft(draft, { end: v, source: 'end' }))}
                  required={!draft.open}
                  helperText={draftSession?.nextDay ? t('workTime.nextDay') : draft.open && !draft.end ? t('workTime.leaveOpen') : undefined}
                  sx={{ flex: '1 1 110px' }}
                />
                <DurationField
                  label={t('workTime.duration')}
                  value={draft.duration}
                  onChange={(v) => setDraft(updateDraft(draft, { duration: v, source: 'duration' }))}
                  required={!draft.open}
                  sx={{ flex: '1 1 110px' }}
                />
              </Box>
              <TextField
                label={t('time.comment')}
                size="small"
                value={draft.comment}
                onChange={(e) => setDraft({ ...draft, comment: e.target.value })}
              />
            </DialogContent>
          )}
          <DialogActions>
            <Button onClick={() => setDraft(null)}>{t('usermenu.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={!draftValid}>{t('usermenu.save')}</Button>
          </DialogActions>
        </Box>
      </Dialog>

      <ConfirmDialog
        open={!!longConfirm}
        title={t('workTime.longTitle')}
        message={longConfirm?.message ?? ''}
        confirmLabel={longConfirm?.kind === 'checkout' ? t('workTime.checkOutAnyway') : t('workTime.saveAnyway')}
        cancelLabel={t('common.cancel')}
        confirmColor="warning"
        onClose={() => setLongConfirm(null)}
        onConfirm={() => (longConfirm?.kind === 'checkout' ? checkOut(true) : saveDraft(true))}
      />

      <ConfirmDialog
        open={!!confirmDeleteId}
        title={t('time.removeEntry')}
        message={t('workTime.deleteConfirm')}
        confirmLabel={t('time.remove')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => {
          if (confirmDeleteId) return removeEntry(confirmDeleteId);
        }}
      />
    </Box>
  );
}
