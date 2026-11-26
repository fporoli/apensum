import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  LinearProgress,
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
import { BasicDataPanel } from './BasicDataPanel';
import WorkSchedulePanel from './WorkSchedulePanel';
import EmploymentPanel from './EmploymentPanel';
import PersonnelDocumentsPanel from './PersonnelDocumentsPanel';
import { BalancesPanel } from './BalancesPanel';
import DepartmentSettings from './DepartmentSettings';
import VacationSettings from './VacationSettings';
import { SettingsSection } from './SettingsSection';
import { useI18n } from './i18n';
import { assignableRoles, roleLabel, type OrgRole } from './roleLabel';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import { AccountBalanceWalletIcon, BusinessIcon, CloseIcon, DescriptionIcon, MailIcon, PeopleIcon, PersonIcon, ScheduleIcon, VisibilityIcon } from './icons';
import { SortHeader, TableSearch, useTableView, type TableColumn } from './TableView';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type RoleOption = OrgRole;

interface Member {
  id: string;
  user_id: string;
  status: string;
  email: string;
  display_name: string;
  manager_user_id: string | null;
  manager_display_name: string | null;
  department_name: string | null;
  job_function: string | null;
  role_ids: string[];
  role_names: string[];
}

interface UsersProps {
  orgId: string;
  isAdmin: boolean;
  isHr: boolean;
  /** May open other members' personal details (section permissions beyond `own`). */
  canAccessBasicData: boolean;
  /** The caller may see other people's work schedules (section.workTime.schedule beyond own). */
  canSeeWorkSchedules?: boolean;
  /** The caller may see other people's employment (section.people.employment beyond own). */
  canSeeEmployment?: boolean;
  /** May open other members' personnel file (section.people.documents, HR by default). */
  canSeePersonnelDocs?: boolean;
  /** Others' balances (nav.balances beyond own). */
  canViewBalances: boolean;
  canInvite: boolean;
  /** Departments and reporting lines are HR's (section.people.employment edit on everyone). */
  canEditDepartments: boolean;
  authHeaders: () => Promise<Record<string, string>>;
}

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  active: 'success',
  invited: 'warning',
  suspended: 'error',
};

export default function Users({ orgId, isAdmin, canAccessBasicData, canSeeWorkSchedules = false, canSeeEmployment = false, canSeePersonnelDocs = false, canViewBalances, canInvite, canEditDepartments, authHeaders }: UsersProps) {
  const { t, locale } = useI18n();
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [addRoleFor, setAddRoleFor] = useState<Record<string, string>>({});
  const [ownerRoleId, setOwnerRoleId] = useState<string | null>(null);
  const [callerIsOwner, setCallerIsOwner] = useState(false);
  const [makeOwnerFor, setMakeOwnerFor] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basicDataFor, setBasicDataFor] = useState<Member | null>(null);
  const [balancesFor, setBalancesFor] = useState<Member | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Member | null>(null);
  const [employmentFor, setEmploymentFor] = useState<Member | null>(null);
  const [personnelFor, setPersonnelFor] = useState<Member | null>(null);

  const canAskScreen = canInvite || canEditDepartments;
  const [notice, setNotice] = useState<string | null>(null);

  async function reloadMembers() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/members`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setMembers(data);
    } catch { /* offline demo */ } finally {
      setLoading(false);
    }
  }

  async function reloadRoles() {
    if (!isAdmin) {
      setRoles([]);
      setCallerIsOwner(false);
      return;
    }
    try {
      const res = await fetch(`${API}/organizations/${orgId}/roles`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data?.roles)) {
        setRoles(assignableRoles(data.roles as OrgRole[]));
        setOwnerRoleId((data.roles as OrgRole[]).find((r) => r.name === 'owner')?.id ?? null);
        setCallerIsOwner(data.callerIsOwner === true);
      }
    } catch { /* offline demo */ }
  }

  useEffect(() => {
    void reloadMembers();
    void reloadRoles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, isAdmin]);

  async function grantRole(membershipId: string, roleId = addRoleFor[membershipId]) {
    if (!roleId) return;
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/members/${membershipId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ roleId }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error === 'owner-required' ? t('users.ownerRequired') : t('users.addRoleFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setAddRoleFor((p) => ({ ...p, [membershipId]: '' }));
      await reloadMembers();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  async function askScreen(m: Member) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/screen-share-asks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ userId: m.user_id }),
      });
      const data = await res.json();
      if (data.ok) setNotice(t('screenShare.asked', { name: m.display_name }));
      else setError(data.error === 'asked-already' ? t('screenShare.askedAlready') : t('screenShare.failed', { error: data.error ?? t('common.unknownError') }));
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  /** Closing the employment dialog refreshes the table: department and manager may have changed. */
  function closeEmployment() {
    setEmploymentFor(null);
    void reloadMembers();
  }

  async function revokeRole(membershipId: string, roleId: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/members/${membershipId}/roles/${roleId}`, {
        method: 'DELETE',
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (!data.ok) {
        const known: Record<string, string> = { 'last-role': 'users.lastRole', 'last-owner': 'users.lastOwner', 'owner-required': 'users.ownerRequired' };
        setError(known[data.error] ? t(known[data.error]) : t('users.removeRoleFailed', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      await reloadMembers();
      // Someone may have handed ownership over and left it.
      if (roleId === ownerRoleId) await reloadRoles();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  function statusLabel(status: string): string {
    const key = `users.status.${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  }
  const columns: TableColumn<Member>[] = [
    { key: 'name', value: (m) => m.display_name },
    { key: 'email', value: (m) => m.email },
    { key: 'status', value: (m) => statusLabel(m.status) },
    { key: 'department', value: (m) => m.department_name },
    { key: 'manager', value: (m) => m.manager_display_name },
    { key: 'roles', value: (m) => m.role_names.join(', ') },
  ];
  const view = useTableView('core.users', members, columns);
  const filteredMembers = view.rows;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        end={
          canInvite ? (
            <Button
              variant="outlined"
              size="small"
              startIcon={<MailIcon fontSize="small" />}
              onClick={() => {
                window.location.hash = '#/invitations';
              }}
            >
              {t('nav.invitations')}
            </Button>
          ) : undefined
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      {canEditDepartments && (
        <SettingsSection id="users.departments" title={t('departments.title')} subtitle={t('departments.subtitle')}>
          <DepartmentSettings orgId={orgId} authHeaders={authHeaders} />
        </SettingsSection>
      )}
      {canEditDepartments && (
        <SettingsSection id="users.vacation" title={t('vacation.title')} subtitle={t('vacation.subtitle')}>
          <VacationSettings orgId={orgId} authHeaders={authHeaders} />
        </SettingsSection>
      )}

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          <TableSearch view={view} placeholder={t('users.searchPlaceholder')} sx={{ minWidth: { xs: '100%', sm: 300 } }} />
        </Box>

        {loading && <LinearProgress sx={{ mb: 2 }} />}

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <SortHeader view={view} column="name">{t('common.name')}</SortHeader>
                <SortHeader view={view} column="email">{t('common.email')}</SortHeader>
                <SortHeader view={view} column="status">{t('common.status')}</SortHeader>
                <SortHeader view={view} column="department">{t('users.col.department')}</SortHeader>
                <SortHeader view={view} column="manager">{t('users.col.manager')}</SortHeader>
                <SortHeader view={view} column="roles">{t('users.col.roles')}</SortHeader>
                {isAdmin && <TableCell>{t('users.col.addRole')}</TableCell>}
                {(canAskScreen || canAccessBasicData || canViewBalances || canSeeWorkSchedules || canSeeEmployment || canSeePersonnelDocs) && <TableCell align="right">{t('common.actions')}</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredMembers.map((m) => {
                const availableRoles = roles.filter((r) => !m.role_ids.includes(r.id));
                return (
                  <TableRow key={m.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{m.display_name}</TableCell>
                    <TableCell>{m.email}</TableCell>
                    <TableCell>
                      <Chip label={statusLabel(m.status)} size="small" color={STATUS_COLOR[m.status] ?? 'default'} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{m.department_name ?? '—'}</Typography>
                      {m.job_function && <Typography variant="caption" color="text.secondary">{m.job_function}</Typography>}
                    </TableCell>
                    <TableCell>{m.manager_display_name ?? '—'}</TableCell>
                    <TableCell>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        {m.role_ids.map((rid, i) => (
                          <Chip
                            key={rid}
                            label={m.role_names[i] ?? rid}
                            size="small"
                            onDelete={isAdmin && m.role_ids.length > 1 && (callerIsOwner || roles.some((r) => r.id === rid && !r.ownerOnly)) ? () => void revokeRole(m.id, rid) : undefined}
                          />
                        ))}
                      </Box>
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <TextField
                            select
                            size="small"
                            value={addRoleFor[m.id] ?? ''}
                            onChange={(e) => setAddRoleFor((p) => ({ ...p, [m.id]: e.target.value }))}
                            sx={{ minWidth: 140 }}
                            disabled={availableRoles.length === 0}
                          >
                            <MenuItem value=""><em>{t('common.select')}</em></MenuItem>
                            {availableRoles.map((r) => {
                              const blocked = r.ownerOnly === true && !callerIsOwner;
                              return (
                                <MenuItem key={r.id} value={r.id} disabled={blocked}>
                                  {blocked ? t('roles.byOwners', { role: roleLabel(r, locale) }) : roleLabel(r, locale)}
                                </MenuItem>
                              );
                            })}
                          </TextField>
                          <Button size="small" onClick={() => void grantRole(m.id)} disabled={!addRoleFor[m.id]}>{t('common.add')}</Button>
                          {callerIsOwner && ownerRoleId && m.status === 'active' && !m.role_ids.includes(ownerRoleId) && (
                            <Button size="small" sx={{ whiteSpace: 'nowrap' }} onClick={() => setMakeOwnerFor(m)}>{t('users.makeOwner')}</Button>
                          )}
                        </Box>
                      </TableCell>
                    )}
                    {(canAskScreen || canAccessBasicData || canViewBalances || canSeeWorkSchedules || canSeeEmployment || canSeePersonnelDocs) && (
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        {canAskScreen && m.status === 'active' && (
                          <Tooltip title={t('screenShare.ask')}>
                            <IconButton size="small" aria-label={t('screenShare.ask')} onClick={() => void askScreen(m)}>
                              <VisibilityIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {canSeeEmployment && (
                          <Tooltip title={t('employment.title')}>
                            <IconButton size="small" aria-label={t('employment.title')} onClick={() => setEmploymentFor(m)}>
                              <BusinessIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {canSeePersonnelDocs && (
                          <Tooltip title={t('personnelDocs.title')}>
                            <IconButton size="small" aria-label={t('personnelDocs.title')} onClick={() => setPersonnelFor(m)}>
                              <DescriptionIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {canSeeWorkSchedules && (
                          <Tooltip title={t('workSchedule.title')}>
                            <IconButton size="small" aria-label={t('workSchedule.title')} onClick={() => setScheduleFor(m)}>
                              <ScheduleIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {canViewBalances && (
                          <Tooltip title={t('users.balances')}>
                            <IconButton size="small" aria-label={t('users.balances')} onClick={() => setBalancesFor(m)}>
                              <AccountBalanceWalletIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        {canAccessBasicData && (
                          <Button size="small" startIcon={<PersonIcon fontSize="small" />} onClick={() => setBasicDataFor(m)}>
                            {t('users.basicData')}
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
              {filteredMembers.length === 0 && !loading && (
                <TableEmptyRow colSpan={isAdmin ? 8 : 7} icon={<PeopleIcon fontSize="inherit" />} title={t(members.length ? 'table.noMatch' : 'users.empty')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={!!basicDataFor} onClose={() => setBasicDataFor(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">{basicDataFor?.display_name}</Typography>
          <IconButton size="small" aria-label={t('common.close')} onClick={() => setBasicDataFor(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers sx={{ pb: 3 }}>
          {basicDataFor && (
            <BasicDataPanel orgId={orgId} userId={basicDataFor.user_id} isSelf={false} embedded authHeaders={authHeaders} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!employmentFor} onClose={closeEmployment} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">{employmentFor?.display_name}</Typography>
          <IconButton size="small" aria-label={t('common.close')} onClick={closeEmployment}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {employmentFor && (
<EmploymentPanel orgId={orgId} userId={employmentFor.user_id} authHeaders={authHeaders} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!personnelFor} onClose={() => setPersonnelFor(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">{personnelFor?.display_name}</Typography>
          <IconButton size="small" aria-label={t('common.close')} onClick={() => setPersonnelFor(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {personnelFor && <PersonnelDocumentsPanel orgId={orgId} userId={personnelFor.user_id} authHeaders={authHeaders} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!scheduleFor} onClose={() => setScheduleFor(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">{scheduleFor?.display_name}</Typography>
          <IconButton size="small" aria-label={t('common.close')} onClick={() => setScheduleFor(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {scheduleFor && <WorkSchedulePanel orgId={orgId} userId={scheduleFor.user_id} authHeaders={authHeaders} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!balancesFor} onClose={() => setBalancesFor(null)} fullWidth maxWidth="lg">
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">
            {balancesFor ? t('balances.forUser', { name: balancesFor.display_name }) : t('balances.title')}
          </Typography>
          <IconButton size="small" aria-label={t('common.close')} onClick={() => setBalancesFor(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {balancesFor && (
            <BalancesPanel orgId={orgId} userId={balancesFor.user_id} authHeaders={authHeaders} />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setBalancesFor(null)}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={!!makeOwnerFor}
        title={t('users.makeOwner')}
        message={t('users.makeOwnerConfirm', { name: makeOwnerFor?.display_name ?? '' })}
        confirmLabel={t('users.makeOwner')}
        cancelLabel={t('common.cancel')}
        confirmColor="primary"
        onClose={() => setMakeOwnerFor(null)}
        onConfirm={async () => {
          const member = makeOwnerFor;
          setMakeOwnerFor(null);
          if (member && ownerRoleId) await grantRole(member.id, ownerRoleId);
        }}
      />
    </Box>
  );
}
