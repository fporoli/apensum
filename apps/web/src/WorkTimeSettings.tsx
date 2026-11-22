import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { CANTONS, holidayName, type Holiday, type OrgHolidayRow } from '@worktime3/shared/worktime';
import { useI18n } from './i18n';
import { formatLocaleDate, swissLocale } from './localeFormat';
import { formatHm } from './WorkSchedulePanel';
import { AddIcon, ChevronLeftIcon, ChevronRightIcon, DeleteIcon, EditIcon } from './icons';
import { TableEmptyRow } from './components';
import { SectionPaper } from './SettingsSection';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Settings {
  fullTimeWeeklyMinutes: number;
  holidayRegion: string | null;
  projectTimeToleranceMinutes: number;
  overtimeAlertMinutes: number;
  undertimeAlertMinutes: number;
  balancesStartDate: string | null;
  legalMaxWeeklyMinutes: number;
  legalOvertimeYearLimitMinutes: number;
  homeOffice: boolean;
}

/** The Swiss legal yearly Überzeit limit for a weekly maximum (mirrors the shared worktime rule). */
const legalDefaultLimitHours = (maxMinutes: number) => (maxMinutes <= 45 * 60 ? 170 : 140);

/** Whole hours ("50") as minutes; null when not a whole number. */
function parseHours(text: string): number | null {
  return /^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) * 60 : null;
}

interface OrgRow extends OrgHolidayRow {
  id: string;
  /** The location the row applies to; null = everyone. */
  locationId: string | null;
}

/** A work place (087): its people get its canton's holidays. */
interface Location {
  id: string;
  name: string;
  canton: string;
  municipality: string | null;
  members?: number;
}

interface WorkTimeSettingsProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

/**
 * Organization settings' Working time card: the full-time week, the holiday canton, the
 * project-time tolerance, and the year's holiday calendar (canton days plus the
 * organization's own days off and days it works despite a canton holiday).
 */
export default function WorkTimeSettings({ orgId, authHeaders }: WorkTimeSettingsProps) {
  const { t, locale } = useI18n();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [rows, setRows] = useState<OrgRow[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  // Whose holidays the calendar shows and new days go to: the organization's ('') or one location's.
  const [viewLocation, setViewLocation] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Settings form.
  const [fullTime, setFullTime] = useState('40:00');
  const [region, setRegion] = useState('');
  const [tolerance, setTolerance] = useState('15');
  const [homeOffice, setHomeOffice] = useState(false);
  const [overtimeAlert, setOvertimeAlert] = useState('50');
  const [undertimeAlert, setUndertimeAlert] = useState('20');
  const [balancesStart, setBalancesStart] = useState('');
  const [legalMax, setLegalMax] = useState(45 * 60);
  const [legalLimit, setLegalLimit] = useState('170');

  // New day off.
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [newHalf, setNewHalf] = useState(false);

  async function reload(y = year) {
    try {
      const q = new URLSearchParams({ year: String(y) });
      if (viewLocation) q.set('locationId', viewLocation);
      const res = await fetch(`${API}/organizations/${orgId}/work-time-settings?${q}`, { headers: await authHeaders() });
      const data = await res.json();
      if (!data?.ok) return;
      if (data.settings) {
        const s = data.settings as Settings;
        setFullTime(formatHm(s.fullTimeWeeklyMinutes));
        setRegion(s.holidayRegion ?? '');
        setTolerance(String(s.projectTimeToleranceMinutes));
        setHomeOffice(!!s.homeOffice);
        setOvertimeAlert(String(Math.round(s.overtimeAlertMinutes / 60)));
        setUndertimeAlert(String(Math.round(s.undertimeAlertMinutes / 60)));
        setBalancesStart(s.balancesStartDate ?? '');
        setLegalMax(s.legalMaxWeeklyMinutes);
        setLegalLimit(String(Math.round(s.legalOvertimeYearLimitMinutes / 60)));
      }
      setHolidays(data.holidays ?? []);
      setRows(data.rows ?? []);
      setLocations(data.locations ?? []);
      if (viewLocation && !(data.locations ?? []).some((l: Location) => l.id === viewLocation)) setViewLocation('');
      setCanEdit(!!data.canEdit);
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  useEffect(() => {
    void reload(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, year, viewLocation]);

  function errorMessage(code: string | undefined): string {
    const known = [
      'forbidden',
      'invalid-full-time',
      'invalid-tolerance',
      'invalid-region',
      'invalid-date',
      'invalid-fraction',
      'not-found',
      'invalid-alert',
      'invalid-start-date',
      'invalid-legal-max',
      'invalid-legal-limit',
    ];
    return code && known.includes(code) ? t(`workTimeSettings.error.${code}`) : t('workTimeSettings.saveFailed');
  }

  async function send(path: string, method: string, body?: unknown, successKey = 'workTimeSettings.saved'): Promise<boolean> {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      if (!data?.ok) {
        setError(errorMessage(data?.error));
        return false;
      }
      setSuccess(t(successKey));
      await reload();
      return true;
    } catch {
      setError(t('common.cannotReachApi'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const fullTimeMinutes = parseHmWeek(fullTime);
  const toleranceMinutes = /^\d{1,4}$/.test(tolerance.trim()) ? Number(tolerance) : null;
  const overtimeAlertMinutes = parseHours(overtimeAlert);
  const undertimeAlertMinutes = parseHours(undertimeAlert);
  const startValid = balancesStart === '' || /^\d{4}-\d{2}-\d{2}$/.test(balancesStart);
  const legalLimitMinutes = parseHours(legalLimit);
  const settingsValid =
    fullTimeMinutes !== null &&
    fullTimeMinutes > 0 &&
    toleranceMinutes !== null &&
    overtimeAlertMinutes !== null &&
    undertimeAlertMinutes !== null &&
    legalLimitMinutes !== null &&
    startValid;

  // The rows of the scope shown: the organization's for everyone, or one location's own.
  const scopeRows = rows.filter((r) => (r.locationId ?? '') === viewLocation);
  const rowByDate = new Map(scopeRows.map((r) => [r.date, r]));
  const notObserved = scopeRows.filter((r) => !r.observed);
  const shownLocation = locations.find((l) => l.id === viewLocation) ?? null;
  const locationId = viewLocation || null;

  return (
    <SectionPaper title={t('workTimeSettings.title')} subtitle={t('workTimeSettings.subtitle')}>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (settingsValid) {
            void send(`/organizations/${orgId}/work-time-settings`, 'PUT', {
              fullTimeWeeklyMinutes: fullTimeMinutes,
              holidayRegion: region || null,
              projectTimeToleranceMinutes: toleranceMinutes,
              overtimeAlertMinutes,
              undertimeAlertMinutes,
              balancesStartDate: balancesStart || null,
              homeOffice,
              legalMaxWeeklyMinutes: legalMax,
              // The law's value is stored as "default", so it follows a change of the weekly maximum.
              legalOvertimeYearLimitMinutes: legalLimitMinutes === legalDefaultLimitHours(legalMax) * 60 ? null : legalLimitMinutes,
            });
          }
        }}
        sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'flex-start' }}
      >
        <TextField
          size="small"
          label={t('workTimeSettings.fullTime')}
          value={fullTime}
          onChange={(e) => setFullTime(e.target.value)}
          error={fullTimeMinutes === null}
          helperText={t('workTimeSettings.fullTimeHelper')}
          disabled={!canEdit}
          sx={{ width: 190 }}
        />
        <TextField
          select
          size="small"
          label={t('workTimeSettings.region')}
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          helperText={t('workTimeSettings.regionHelper')}
          disabled={!canEdit}
          sx={{ width: 220 }}
        >
          <MenuItem value="">{t('workSchedule.regionNone')}</MenuItem>
          {CANTONS.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
        </TextField>
        <TextField
          size="small"
          label={t('workTimeSettings.tolerance')}
          value={tolerance}
          onChange={(e) => setTolerance(e.target.value)}
          error={toleranceMinutes === null}
          helperText={t('workTimeSettings.toleranceHelper')}
          disabled={!canEdit}
          sx={{ width: 260 }}
        />
        <TextField
          size="small"
          label={t('workTimeSettings.overtimeAlert')}
          value={overtimeAlert}
          onChange={(e) => setOvertimeAlert(e.target.value)}
          error={overtimeAlertMinutes === null}
          helperText={t('workTimeSettings.overtimeAlertHelper')}
          disabled={!canEdit}
          sx={{ width: 220 }}
        />
        <TextField
          size="small"
          label={t('workTimeSettings.undertimeAlert')}
          value={undertimeAlert}
          onChange={(e) => setUndertimeAlert(e.target.value)}
          error={undertimeAlertMinutes === null}
          helperText={t('workTimeSettings.undertimeAlertHelper')}
          disabled={!canEdit}
          sx={{ width: 220 }}
        />
        <TextField
          select
          size="small"
          label={t('workTimeSettings.legalMax')}
          value={legalMax}
          onChange={(e) => {
            const next = Number(e.target.value);
            // Follow the law's limit when it was still the default for the old maximum.
            if (legalLimitMinutes === legalDefaultLimitHours(legalMax) * 60) setLegalLimit(String(legalDefaultLimitHours(next)));
            setLegalMax(next);
          }}
          helperText={t('workTimeSettings.legalMaxHelper')}
          disabled={!canEdit}
          sx={{ width: 300 }}
        >
          <MenuItem value={45 * 60}>{t('workTimeSettings.legalMax45')}</MenuItem>
          <MenuItem value={50 * 60}>{t('workTimeSettings.legalMax50')}</MenuItem>
        </TextField>
        <TextField
          size="small"
          label={t('workTimeSettings.legalLimit')}
          value={legalLimit}
          onChange={(e) => setLegalLimit(e.target.value)}
          error={legalLimitMinutes === null}
          helperText={t('workTimeSettings.legalLimitHelper')}
          disabled={!canEdit}
          sx={{ width: 260 }}
        />
        <TextField
          size="small"
          type="date"
          label={t('workTimeSettings.balancesStart')}
          value={balancesStart}
          onChange={(e) => setBalancesStart(e.target.value)}
          error={!startValid}
          helperText={t('workTimeSettings.balancesStartHelper')}
          disabled={!canEdit}
          InputLabelProps={{ shrink: true }}
          sx={{ width: 260 }}
        />
        <Box sx={{ width: 300 }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={homeOffice} onChange={(e) => setHomeOffice(e.target.checked)} disabled={!canEdit} />}
            label={t('workTimeSettings.homeOffice')}
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>{t('workTimeSettings.homeOfficeHelper')}</Typography>
        </Box>
        {canEdit && (
          <Button type="submit" variant="contained" sx={{ height: 40 }} disabled={!settingsValid || busy}>{t('common.save')}</Button>
        )}
      </Box>

      <LocationsEditor orgId={orgId} authHeaders={authHeaders} canEdit={canEdit} onChanged={() => void reload()} />

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{t('workTimeSettings.holidays', { year: String(year) })}</Typography>
        {locations.length > 0 && (
          <TextField select size="small" label={t('locations.holidaysFor')} value={viewLocation} onChange={(e) => setViewLocation(e.target.value)} sx={{ minWidth: 220 }}>
            <MenuItem value="">{t('locations.organization', { canton: region || '—' })}</MenuItem>
            {locations.map((l) => <MenuItem key={l.id} value={l.id}>{`${l.name} (${l.canton})`}</MenuItem>)}
          </TextField>
        )}
        <IconButton size="small" aria-label={t('workTimeSettings.prevYear')} onClick={() => setYear((y) => y - 1)}><ChevronLeftIcon fontSize="small" /></IconButton>
        <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{year}</Typography>
        <IconButton size="small" aria-label={t('workTimeSettings.nextYear')} onClick={() => setYear((y) => y + 1)}><ChevronRightIcon fontSize="small" /></IconButton>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('time.date')}</TableCell>
              <TableCell>{t('workTimeSettings.holidayName')}</TableCell>
              <TableCell>{t('workTimeSettings.share')}</TableCell>
              <TableCell>{t('workTimeSettings.source')}</TableCell>
              {canEdit && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {holidays.map((h) => {
              const own = rowByDate.get(h.date);
              return (
                <TableRow key={h.date}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {new Date(`${h.date}T00:00:00Z`).toLocaleDateString(swissLocale(locale), { weekday: 'short', timeZone: 'UTC' })} {formatLocaleDate(h.date, locale)}
                  </TableCell>
                  <TableCell>{holidayName(h, locale)}</TableCell>
                  <TableCell>{h.fraction < 1 ? t('workTimeSettings.halfDay') : t('workTimeSettings.fullDay')}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={h.source === 'canton' ? (shownLocation?.canton ?? region) || '—' : own && shownLocation ? shownLocation.name : t('workTimeSettings.sourceOrg')}
                    />
                  </TableCell>
                  {canEdit && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {own ? (
                        <Tooltip title={t('workTimeSettings.removeOwn')}>
                          <IconButton size="small" aria-label={t('workTimeSettings.removeOwn')} disabled={busy} onClick={() => void send(`/organizations/${orgId}/holidays/${own.id}`, 'DELETE')}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : (
                        <Button size="small" color="inherit" disabled={busy} onClick={() => void send(`/organizations/${orgId}/holidays`, 'POST', { date: h.date, observed: false, locationId })}>
                          {t('workTimeSettings.notObserved')}
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {holidays.length === 0 && <TableEmptyRow colSpan={canEdit ? 5 : 4} title={t('workTimeSettings.noHolidays')} />}
          </TableBody>
        </Table>
      </TableContainer>

      {notObserved.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">{t('workTimeSettings.workedOn')}</Typography>
          {notObserved.map((r) => (
            <Chip
              key={r.id}
              size="small"
              label={formatLocaleDate(r.date, locale)}
              onDelete={canEdit ? () => void send(`/organizations/${orgId}/holidays/${r.id}`, 'DELETE') : undefined}
            />
          ))}
        </Box>
      )}

      {canEdit && (
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newDate) return;
            void send(`/organizations/${orgId}/holidays`, 'POST', { date: newDate, name: newName.trim() || null, fraction: newHalf ? 0.5 : 1, locationId }).then((ok) => {
              if (ok) {
                setNewDate('');
                setNewName('');
                setNewHalf(false);
              }
            });
          }}
          sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <TextField type="date" size="small" label={t('time.date')} value={newDate} onChange={(e) => setNewDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField size="small" label={t('workTimeSettings.holidayName')} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('workTimeSettings.namePlaceholder')} />
          <FormControlLabel control={<Checkbox size="small" checked={newHalf} onChange={(e) => setNewHalf(e.target.checked)} />} label={t('workTimeSettings.halfDay')} />
          <Button type="submit" variant="outlined" size="small" disabled={!newDate || busy}>
            {shownLocation ? t('locations.addDayFor', { name: shownLocation.name }) : t('workTimeSettings.addDay')}
          </Button>
        </Box>
      )}
      <Typography variant="caption" color="text.secondary">{t('workTimeSettings.disclaimer')}</Typography>
    </SectionPaper>
  );
}

/** A weekly duration "42:00", "42" or "42.5" as minutes (up to a full week); null otherwise. */
function parseHmWeek(text: string): number | null {
  const s = text.trim();
  const hm = /^(\d{1,3}):([0-5]\d)$/.exec(s);
  const minutes = hm ? Number(hm[1]) * 60 + Number(hm[2]) : /^\d{1,3}([.,]\d+)?$/.test(s) ? Math.round(Number(s.replace(',', '.')) * 60) : NaN;
  return Number.isFinite(minutes) && minutes > 0 && minutes <= 7 * 24 * 60 ? minutes : null;
}


/**
 * The organization's locations (work places): name, canton and municipality. Their people get the
 * canton's holidays, plus the days added for the location (e.g. Knabenschiessen in Zurich); a person's
 * location is set in their assignment (Users -> Employment). A location in use can't be deleted.
 */
function LocationsEditor({ orgId, authHeaders, canEdit, onChanged }: {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<Location[]>([]);
  const [draft, setDraft] = useState<{ id: string | null; name: string; canton: string; municipality: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/locations`, { headers: await authHeaders() });
      const data = await res.json();
      if (data?.ok) setList(data.locations ?? []);
    } catch { /* shown empty */ }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function call(path: string, method: string, body?: unknown): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json();
      if (!data?.ok) {
        const key = `locations.error.${data?.error}`;
        const text = t(key);
        setError(text === key ? t('workTimeSettings.saveFailed') : text);
        return false;
      }
      await load();
      onChanged();
      return true;
    } catch {
      setError(t('common.cannotReachApi'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit && list.length === 0) return null;
  return (
    <Box sx={{ display: 'grid', gap: 1, mt: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{t('locations.title')}</Typography>
        {canEdit && !draft && (
          <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={() => setDraft({ id: null, name: '', canton: '', municipality: '' })}>
            {t('locations.add')}
          </Button>
        )}
      </Box>
      <Typography variant="caption" color="text.secondary">{t('locations.help')}</Typography>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {list.length > 0 && (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('locations.name')}</TableCell>
                <TableCell>{t('locations.canton')}</TableCell>
                <TableCell>{t('locations.municipality')}</TableCell>
                <TableCell align="right">{t('locations.people')}</TableCell>
                {canEdit && <TableCell />}
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((l) => (
                <TableRow key={l.id}>
                  <TableCell>{l.name}</TableCell>
                  <TableCell>{l.canton}</TableCell>
                  <TableCell>{l.municipality ?? '—'}</TableCell>
                  <TableCell align="right">{l.members ?? 0}</TableCell>
                  {canEdit && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      <Tooltip title={t('common.edit')}>
                        <IconButton size="small" aria-label={t('common.edit')} onClick={() => setDraft({ id: l.id, name: l.name, canton: l.canton, municipality: l.municipality ?? '' })}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={l.members ? t('locations.inUse') : t('common.delete')}>
                        <span>
                          <IconButton size="small" color="error" aria-label={t('common.delete')} disabled={busy || !!l.members} onClick={() => void call(`locations/${l.id}`, 'DELETE')}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      {draft && (
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault();
            const body = { name: draft.name, canton: draft.canton, municipality: draft.municipality.trim() || null };
            void (draft.id ? call(`locations/${draft.id}`, 'PATCH', body) : call('locations', 'POST', body)).then((ok) => ok && setDraft(null));
          }}
          sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', alignItems: 'center' }}
        >
          <TextField size="small" required label={t('locations.name')} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('locations.namePlaceholder')} />
          <TextField select size="small" required label={t('locations.canton')} value={draft.canton} onChange={(e) => setDraft({ ...draft, canton: e.target.value })} sx={{ width: 120 }}>
            {CANTONS.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
          <TextField size="small" label={t('locations.municipality')} value={draft.municipality} onChange={(e) => setDraft({ ...draft, municipality: e.target.value })} />
          <Button type="submit" variant="contained" size="small" disabled={busy || !draft.name.trim() || !draft.canton}>{t('common.save')}</Button>
          <Button size="small" onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
        </Box>
      )}
    </Box>
  );
}
