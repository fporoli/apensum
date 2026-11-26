import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
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
  Typography,
} from '@mui/material';
import { Button } from './Button';
import { useI18n } from './i18n';
import { assignableRoles, roleLabel, type OrgRole } from './roleLabel';
import { ConfirmDialog, PageHeader, TableEmptyRow } from './components';
import { MailIcon, PeopleIcon } from './icons';
import { swissLocale } from './localeFormat';
import { SortHeader, TableSearch, useTableView, type TableColumn } from './TableView';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type RoleOption = OrgRole;

interface InvitationItem {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  role_name: string;
  invited_by: string;
}

interface InvitationsProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
}

const STATUS_COLOR: Record<InvitationItem['status'], 'default' | 'success' | 'error' | 'warning'> = {
  pending: 'warning',
  accepted: 'success',
  revoked: 'default',
  expired: 'error',
};

export default function Invitations({ orgId, authHeaders }: InvitationsProps) {
  const { t, locale } = useI18n();
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [callerIsOwner, setCallerIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokeTargetId, setRevokeTargetId] = useState<string | null>(null);

  async function reloadRoles() {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/roles`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data?.roles)) {
        const assignable = assignableRoles(data.roles as OrgRole[]);
        setRoles(assignable);
        setCallerIsOwner(data.callerIsOwner === true);
        const open = assignable.filter((r) => !r.ownerOnly || data.callerIsOwner === true);
        if (!roleId && open.length > 0) {
          const defaultRole = open.find((r) => r.name === 'member') ?? open[0];
          setRoleId(defaultRole.id);
        }
      }
    } catch { /* offline fallback */ }
  }

  async function reloadInvitations() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/invitations`, { headers: await authHeaders() });
      const data = await res.json();
      if (Array.isArray(data)) setInvitations(data);
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadRoles();
    void reloadInvitations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function handleSendInvite() {
    const trimmed = email.trim();
    if (!trimmed || !roleId) return;
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ email: trimmed, roleId }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(
          data.error === 'forbidden'
            ? t('invitations.forbidden')
            : data.error === 'owner-required'
              ? t('users.ownerRequired')
              : data.error === 'invitation-mail-failed'
                ? t('invitations.mailFailed')
                : t('invitations.sendFailed', { error: data.error ?? t('common.unknownError') }),
        );
        return;
      }
      setEmail('');
      setSuccess(t('invitations.sent', { email: trimmed }));
      await reloadInvitations();
    } catch {
      setError(t('invitations.unreachable'));
    }
  }

  async function handleRevoke(invitationId: string) {
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/invitations/${invitationId}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (data.ok === false) {
        setError(data.error === 'forbidden' ? t('invitations.forbidden') : t('invitations.revokeFailed'));
        return;
      }
      setSuccess(t('invitations.revoked'));
      await reloadInvitations();
    } catch {
      setError(t('invitations.revokeFailed'));
    }
  }

  const columns: TableColumn<InvitationItem>[] = [
    { key: 'email', value: (i) => i.email },
    { key: 'role', value: (i) => i.role_name },
    { key: 'status', value: (i) => t(`invitations.status.${i.status}`) },
    { key: 'invitedBy', value: (i) => i.invited_by },
    { key: 'expires', value: (i) => i.expires_at, search: false },
  ];
  const view = useTableView('core.invitations', invitations, columns);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('invitations.title')}
        subtitle={t('invitations.subtitle')}
        end={
          <Button
            variant="outlined"
            size="small"
            startIcon={<PeopleIcon fontSize="small" />}
            onClick={() => {
              window.location.hash = '#/users';
            }}
          >
            {t('nav.users')}
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}

      <Paper
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSendInvite();
        }}
        sx={{ p: 2 }}
      >
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <TextField
            label={t('common.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            size="small"
            sx={{ minWidth: 240 }}
            placeholder={t('invitations.emailPlaceholder')}
          />
          <TextField
            select
            label={t('common.role')}
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            size="small"
            sx={{ minWidth: 160 }}
          >
            {roles.map((r) => (
              <MenuItem key={r.id} value={r.id} disabled={r.ownerOnly === true && !callerIsOwner}>
                {r.ownerOnly && !callerIsOwner ? t('roles.byOwners', { role: roleLabel(r, locale) }) : roleLabel(r, locale)}
              </MenuItem>
            ))}
          </TextField>
          <Button type="submit" variant="contained" disabled={!email.trim() || !roleId}>
            {t('invitations.send')}
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap', mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t('invitations.sentList', { count: invitations.length })}</Typography>
          {invitations.length > 0 && <TableSearch view={view} />}
        </Box>
        {loading && <LinearProgress sx={{ mb: 1 }} />}
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <SortHeader view={view} column="email">{t('common.email')}</SortHeader>
                <SortHeader view={view} column="role">{t('common.role')}</SortHeader>
                <SortHeader view={view} column="status">{t('common.status')}</SortHeader>
                <SortHeader view={view} column="invitedBy">{t('invitations.invitedBy')}</SortHeader>
                <SortHeader view={view} column="expires">{t('invitations.expires')}</SortHeader>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {view.rows.map((inv) => (
                <TableRow key={inv.id} hover>
                  <TableCell>{inv.email}</TableCell>
                  <TableCell>{inv.role_name}</TableCell>
                  <TableCell>
                    <Chip label={t(`invitations.status.${inv.status}`)} size="small" color={STATUS_COLOR[inv.status]} />
                  </TableCell>
                  <TableCell>{inv.invited_by}</TableCell>
                  <TableCell>{new Date(inv.expires_at).toLocaleDateString(swissLocale(locale))}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="error"
                      disabled={inv.status !== 'pending'}
                      onClick={() => setRevokeTargetId(inv.id)}
                    >
                      {t('invitations.revoke')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {view.rows.length === 0 && (
                <TableEmptyRow colSpan={6} icon={<MailIcon fontSize="inherit" />} title={t(invitations.length ? 'table.noMatch' : 'invitations.empty')} />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <ConfirmDialog
        open={!!revokeTargetId}
        title={t('invitations.revokeTitle')}
        message={t('invitations.revokeConfirm')}
        confirmLabel={t('invitations.revoke')}
        cancelLabel={t('common.cancel')}
        onClose={() => setRevokeTargetId(null)}
        onConfirm={() => {
          if (revokeTargetId) return handleRevoke(revokeTargetId);
        }}
      />
    </Box>
  );
}
