import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
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
import { Button } from './Button';
import { useI18n } from './i18n';
import { formatLocaleDate } from './localeFormat';
import { ConfirmDialog } from './components';
import { AddIcon, DeleteIcon, EditIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Assignment {
  id: string;
  valid_from: string;
  department_id: string | null;
  department_name: string | null;
  job_function: string | null;
  manager_user_id: string | null;
  manager_name: string | null;
  location_id?: string | null;
  location_name?: string | null;
  is_management?: boolean;
}

/** A work place (Organization settings): its canton's holidays apply to the people there. */
interface Location {
  id: string;
  name: string;
  canton: string;
}

interface Employment {
  startDate: string | null;
  exitDate: string | null;
  /** The last day of probation; `probationSet`: HR set it instead of the organization's months. */
  probationUntil: string | null;
  probationSet: boolean;
  currentId: string | null;
  assignments: Assignment[];
  canEdit: boolean;
  /** Who takes the person's flow steps while they are away; the person sets it, HR for anyone. */
  deputy: { userId: string; name: string } | null;
  canSetDeputy: boolean;
}

interface Department {
  id: string;
  name: string;
  leader_user_id: string | null;
  is_active: boolean;
}

interface Member {
  user_id: string;
  display_name: string;
  status?: string;
}

interface Draft {
  id: string | null;
  validFrom: string;
  departmentId: string;
  jobFunction: string;
  managerUserId: string;
  locationId: string;
  isManagement: boolean;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * A person's employment in the organization: start date and the dated assignments (department,
 * function, manager). The assignment in force today decides who their manager is; a change gets a
 * new row from its date on, so earlier months keep their manager. HR and admin edit it.
 */
export default function EmploymentPanel({
  orgId,
  userId,
  authHeaders,
}: {
  orgId: string;
  userId: string;
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const { t, locale } = useI18n();
  const [data, setData] = useState<Employment | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [startDraft, setStartDraft] = useState<string | null>(null);
  // The last day of employment being edited ('' = none yet).
  const [exitDraft, setExitDraft] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Assignment | null>(null);
  const [probationDraft, setProbationDraft] = useState<string | null>(null);
  // The deputy being chosen ('' = none).
  const [deputyDraft, setDeputyDraft] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/users/${userId}/employment`, { headers: await authHeaders() });
      const body = await res.json();
      if (body.ok === false) {
        setForbidden(true);
        return;
      }
      setForbidden(false);
      setData({ startDate: body.startDate ?? null, exitDate: body.exitDate ?? null, probationUntil: body.probationUntil ?? null, probationSet: !!body.probationSet, currentId: body.currentId ?? null, assignments: body.assignments ?? [], canEdit: !!body.canEdit, deputy: body.deputy ?? null, canSetDeputy: !!body.canSetDeputy });
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  useEffect(() => {
    setData(null);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, userId]);

  // Choices for editing: only loaded for people who may edit (the deputy: the person too).
  useEffect(() => {
    if (!data?.canEdit && !data?.canSetDeputy) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [deps, mems, locs] = await Promise.all([
          fetch(`${API}/organizations/${orgId}/departments`, { headers }).then((r) => r.json()),
          fetch(`${API}/organizations/${orgId}/members`, { headers }).then((r) => r.json()),
          fetch(`${API}/organizations/${orgId}/locations`, { headers }).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setLocations(Array.isArray(locs?.locations) ? locs.locations : []);
        setDepartments(Array.isArray(deps?.departments) ? deps.departments : []);
        setMembers(Array.isArray(mems) ? mems : []);
      } catch { /* the dialog then offers no choices */ }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, data?.canEdit, data?.canSetDeputy]);

  // The location column and field only once the organization has locations (or an assignment names one).
  const hasLocations = locations.length > 0 || !!data?.assignments.some((a) => a.location_id);

  function errorMessage(code: string | undefined): string {
    const key = `employment.error.${code}`;
    const text = t(key);
    return text === key ? t('employment.error.failed', { error: code ?? t('common.unknownError') }) : text;
  }

  async function send(path: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const result = await res.json();
      if (!result?.ok) {
        setError(errorMessage(result?.error));
        return false;
      }
      await reload();
      return true;
    } catch {
      setError(t('common.cannotReachApi'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openNew() {
    const current = data?.assignments.find((a) => a.id === data.currentId);
    setDraft({
      id: null,
      validFrom: today(),
      departmentId: current?.department_id ?? '',
      jobFunction: current?.job_function ?? '',
      managerUserId: current?.manager_user_id ?? '',
      locationId: current?.location_id ?? '',
      isManagement: !!current?.is_management,
    });
  }

  /** Picking a department offers its leader as the manager (never the person themselves). */
  function pickDepartment(departmentId: string) {
    setDraft((d) => {
      if (!d) return d;
      const leader = departments.find((dep) => dep.id === departmentId)?.leader_user_id ?? '';
      return { ...d, departmentId, managerUserId: leader && leader !== userId ? leader : d.managerUserId };
    });
  }

  async function saveDraft() {
    if (!draft) return;
    const body = {
      validFrom: draft.validFrom,
      departmentId: draft.departmentId || null,
      jobFunction: draft.jobFunction,
      managerUserId: draft.managerUserId || null,
      locationId: draft.locationId || null,
      isManagement: draft.isManagement,
    };
    const ok = draft.id
      ? await send(`/organizations/${orgId}/assignments/${draft.id}`, 'PATCH', body)
      : await send(`/organizations/${orgId}/users/${userId}/assignments`, 'POST', body);
    if (ok) setDraft(null);
  }

  if (forbidden || !data) return null;
  const current = data.assignments.find((a) => a.id === data.currentId) ?? null;
  const date = (iso: string | null) => (iso ? formatLocaleDate(iso, locale) : '—');

  return (
    <Paper sx={{ p: 2, display: 'grid', gap: 1.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('employment.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {current
              ? t('employment.current', {
                  department: current.department_name ?? t('employment.noDepartment'),
                  function: current.job_function ?? '—',
                  manager: current.manager_name ?? t('employment.noManager'),
                })
              : t('employment.none')}
          </Typography>
        </Box>
        {data.canEdit && (
          <Button size="small" startIcon={<AddIcon fontSize="small" />} onClick={openNew} disabled={busy}>
            {t('employment.add')}
          </Button>
        )}
      </Box>

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center' }}>
        <Box>
          <Typography variant="caption" color="text.secondary">{t('employment.startDate')}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>{date(data.startDate)}</Typography>
            {data.canEdit && (
              <Tooltip title={t('employment.editStartDate')}>
                <IconButton size="small" aria-label={t('employment.editStartDate')} onClick={() => setStartDraft(data.startDate ?? today())}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
        {(data.exitDate || data.canEdit) && (
          <Box>
            <Typography variant="caption" color="text.secondary">{t('employment.exitDate')}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{data.exitDate ? date(data.exitDate) : '—'}</Typography>
              {data.canEdit && (
                <Tooltip title={t('employment.editExitDate')}>
                  <IconButton size="small" aria-label={t('employment.editExitDate')} onClick={() => setExitDraft(data.exitDate ?? '')}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        )}
        {(data.deputy || data.canSetDeputy) && (
          <Box>
            <Tooltip title={t('employment.deputyHint')}>
              <Typography variant="caption" color="text.secondary">{t('employment.deputy')}</Typography>
            </Tooltip>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{data.deputy?.name ?? t('employment.noDeputy')}</Typography>
              {data.canSetDeputy && (
                <Tooltip title={t('employment.editDeputy')}>
                  <IconButton size="small" aria-label={t('employment.editDeputy')} onClick={() => setDeputyDraft(data.deputy?.userId ?? '')}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        )}
        {((data.probationUntil && data.probationUntil >= today()) || data.canEdit) && (
          <Box>
            <Typography variant="caption" color="text.secondary">{t('employment.probation')}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>{data.probationUntil ? date(data.probationUntil) : t('employment.noProbation')}</Typography>
              {data.canEdit && (
                <Tooltip title={t('employment.editProbation')}>
                  <IconButton size="small" aria-label={t('employment.editProbation')} onClick={() => setProbationDraft(data.probationUntil ?? '')}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          </Box>
        )}
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{t('employment.validFrom')}</TableCell>
              <TableCell>{t('employment.department')}</TableCell>
              <TableCell>{t('employment.function')}</TableCell>
              <TableCell>{t('employment.manager')}</TableCell>
              {hasLocations && <TableCell>{t('locations.location')}</TableCell>}
              {data.canEdit && <TableCell />}
            </TableRow>
          </TableHead>
          <TableBody>
            {data.assignments.length === 0 && (
              <TableRow>
                <TableCell colSpan={(data.canEdit ? 5 : 4) + (hasLocations ? 1 : 0)}>
                  <Typography variant="body2" color="text.secondary">{t('employment.none')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {data.assignments.map((a) => {
              const future = a.valid_from > today();
              return (
                <TableRow key={a.id} selected={a.id === data.currentId}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {date(a.valid_from)}
                    {a.id === data.currentId && <Chip size="small" color="primary" label={t('employment.inForce')} sx={{ ml: 1 }} />}
                    {future && <Chip size="small" variant="outlined" label={t('employment.planned')} sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{a.department_name ?? '—'}</TableCell>
                  <TableCell>
                    {a.job_function ?? '—'}
                    {a.is_management && <Chip size="small" variant="outlined" label={t('employment.management')} sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{a.manager_name ?? t('employment.noManager')}</TableCell>
                  {hasLocations && <TableCell>{a.location_name ?? t('locations.none')}</TableCell>}
                  {data.canEdit && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap', width: 90 }}>
                      <Tooltip title={t('common.edit')}>
                        <IconButton
                          size="small"
                          aria-label={t('common.edit')}
                          disabled={busy}
                          onClick={() =>
                            setDraft({
                              id: a.id,
                              validFrom: a.valid_from,
                              departmentId: a.department_id ?? '',
                              jobFunction: a.job_function ?? '',
                              managerUserId: a.manager_user_id ?? '',
                              locationId: a.location_id ?? '',
                              isManagement: !!a.is_management,
                            })
                          }
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.delete')}>
                        <IconButton size="small" aria-label={t('common.delete')} disabled={busy} onClick={() => setConfirmDelete(a)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Typography variant="caption" color="text.secondary">{t('employment.hint')}</Typography>

      <Dialog open={!!draft} onClose={() => setDraft(null)} fullWidth maxWidth="sm">
        <DialogTitle>{draft?.id ? t('employment.editTitle') : t('employment.addTitle')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
          {draft && (
            <>
              <TextField
                type="date"
                size="small"
                label={t('employment.validFrom')}
                value={draft.validFrom}
                onChange={(e) => setDraft({ ...draft, validFrom: e.target.value })}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField select size="small" label={t('employment.department')} value={draft.departmentId} onChange={(e) => pickDepartment(e.target.value)}>
                <MenuItem value=""><em>{t('employment.noDepartment')}</em></MenuItem>
                {departments
                  .filter((d) => d.is_active || d.id === draft.departmentId)
                  .map((d) => (
                    <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
                  ))}
              </TextField>
              {hasLocations && (
                <TextField
                  select
                  size="small"
                  label={t('locations.location')}
                  value={draft.locationId}
                  onChange={(e) => setDraft({ ...draft, locationId: e.target.value })}
                  helperText={t('locations.assignmentHint')}
                >
                  <MenuItem value=""><em>{t('locations.none')}</em></MenuItem>
                  {locations.map((l) => <MenuItem key={l.id} value={l.id}>{`${l.name} (${l.canton})`}</MenuItem>)}
                </TextField>
              )}
              <TextField
                size="small"
                label={t('employment.function')}
                value={draft.jobFunction}
                onChange={(e) => setDraft({ ...draft, jobFunction: e.target.value })}
                slotProps={{ htmlInput: { maxLength: 120 } }}
              />
              <Box>
                <FormControlLabel
                  control={<Checkbox size="small" checked={draft.isManagement} onChange={(e) => setDraft({ ...draft, isManagement: e.target.checked })} />}
                  label={t('employment.management')}
                />
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>{t('employment.managementHint')}</Typography>
              </Box>
              <TextField
                select
                size="small"
                label={t('employment.manager')}
                value={draft.managerUserId}
                onChange={(e) => setDraft({ ...draft, managerUserId: e.target.value })}
                helperText={t('employment.managerHint')}
              >
                <MenuItem value=""><em>{t('employment.noManager')}</em></MenuItem>
                {members
                  .filter((m) => m.user_id !== userId)
                  .map((m) => (
                    <MenuItem key={m.user_id} value={m.user_id}>{m.display_name}</MenuItem>
                  ))}
              </TextField>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void saveDraft()} disabled={busy || !draft?.validFrom}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={startDraft !== null} onClose={() => setStartDraft(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('employment.startDate')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <TextField
            type="date"
            size="small"
            fullWidth
            value={startDraft ?? ''}
            onChange={(e) => setStartDraft(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStartDraft(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy || !startDraft}
            onClick={async () => {
              if (await send(`/organizations/${orgId}/users/${userId}/start-date`, 'PUT', { startDate: startDraft })) setStartDraft(null);
            }}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={exitDraft !== null} onClose={() => setExitDraft(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('employment.exitDate')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'grid', gap: 1 }}>
          <TextField
            type="date"
            size="small"
            fullWidth
            label={t('employment.lastDay')}
            value={exitDraft ?? ''}
            onChange={(e) => setExitDraft(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Typography variant="caption" color="text.secondary">{t('employment.exitHint')}</Typography>
        </DialogContent>
        <DialogActions>
          {data.exitDate && (
            <Button
              color="error"
              disabled={busy}
              sx={{ mr: 'auto' }}
              onClick={async () => {
                if (await send(`/organizations/${orgId}/users/${userId}/exit-date`, 'PUT', { lastDay: null })) setExitDraft(null);
              }}
            >
              {t('employment.removeExitDate')}
            </Button>
          )}
          <Button onClick={() => setExitDraft(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy || !exitDraft}
            onClick={async () => {
              if (await send(`/organizations/${orgId}/users/${userId}/exit-date`, 'PUT', { lastDay: exitDraft })) setExitDraft(null);
            }}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={probationDraft !== null} onClose={() => setProbationDraft(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('employment.probation')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'grid', gap: 1 }}>
          <TextField
            type="date"
            size="small"
            fullWidth
            label={t('employment.probationLastDay')}
            value={probationDraft ?? ''}
            onChange={(e) => setProbationDraft(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Typography variant="caption" color="text.secondary">{t('employment.probationHint')}</Typography>
        </DialogContent>
        <DialogActions>
          {data.probationSet && (
            <Button
              disabled={busy}
              sx={{ mr: 'auto' }}
              onClick={async () => {
                if (await send(`/organizations/${orgId}/users/${userId}/probation`, 'PUT', { until: null })) setProbationDraft(null);
              }}
            >
              {t('employment.probationDefault')}
            </Button>
          )}
          <Button onClick={() => setProbationDraft(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy || !probationDraft}
            onClick={async () => {
              if (await send(`/organizations/${orgId}/users/${userId}/probation`, 'PUT', { until: probationDraft })) setProbationDraft(null);
            }}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deputyDraft !== null} onClose={() => setDeputyDraft(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('employment.deputy')}</DialogTitle>
        <DialogContent sx={{ pt: '8px !important', display: 'grid', gap: 1 }}>
          <TextField select size="small" fullWidth label={t('employment.deputy')} value={deputyDraft ?? ''} onChange={(e) => setDeputyDraft(e.target.value)}>
            <MenuItem value=""><em>{t('employment.noDeputy')}</em></MenuItem>
            {/* Active members, each once (the list has a row per role). */}
            {[...new Map(members.filter((m) => m.user_id !== userId && (m.status ?? 'active') === 'active').map((m) => [m.user_id, m])).values()]
              .sort((a, b) => (a.display_name ?? '').localeCompare(b.display_name ?? ''))
              .map((m) => <MenuItem key={m.user_id} value={m.user_id}>{m.display_name}</MenuItem>)}
          </TextField>
          <Typography variant="caption" color="text.secondary">{t('employment.deputyHint')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeputyDraft(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={async () => {
              if (await send(`/organizations/${orgId}/users/${userId}/deputy`, 'PUT', { deputyUserId: deputyDraft || null })) setDeputyDraft(null);
            }}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        title={t('employment.deleteTitle')}
        message={confirmDelete ? t('employment.deleteMessage', { date: date(confirmDelete.valid_from) }) : ''}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const row = confirmDelete;
          setConfirmDelete(null);
          if (row) await send(`/organizations/${orgId}/assignments/${row.id}`, 'DELETE');
        }}
      />
    </Paper>
  );
}
