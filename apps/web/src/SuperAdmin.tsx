import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import dayjs, { type Dayjs } from 'dayjs';
import { ConfirmDialog, PageHeader } from './components';
import { useI18n, useT } from './i18n';
import { formatFileSize, formatLocaleDate, formatLocaleDateTime, formatLocaleNumber, formatMoney, parseLocaleNumber } from './localeFormat';
import News from './News';
import { SortHeader, TableSearch, useTableView, type TableColumn } from './TableView';

/**
 * The Super Admin pages, shown in the Admin organization (OPERATOR_ORG_ID) to its members, the
 * instance's operators: licenses and AI limits of every organization, the instance overview, product
 * news and the superusers.
 * API: `operator/*` (operator.controller.ts; product news is NewsController at `operator/news`).
 */

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type AuthHeaders = () => Promise<Record<string, string>>;

interface License { moduleId: string; validUntil: string | null; expired: boolean }
interface Organization { id: string; name: string; slug: string; type: string; members: number; owners: string[]; licenses: License[] }
interface Module { id: string; caption: string }
interface Operator { userId: string; name: string; email: string; me: boolean }

async function call(path: string, authHeaders: AuthHeaders, init: RequestInit = {}): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(await authHeaders()) } });
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'unreachable' };
  }
}

/** An API error code as text: `operator.error.<code>` when there is one, else the code. */
function useErrorText() {
  const t = useT();
  return useCallback(
    (code: unknown) => {
      if (code === 'unreachable') return t('common.cannotReachApi');
      const key = `operator.error.${String(code)}`;
      const text = t(key);
      return text === key ? String(code) : text;
    },
    [t],
  );
}

/** Every organization (but the Admin one) with its members, owners and licenses. */
export function SuperAdminLicenses({ authHeaders }: { authHeaders: AuthHeaders }) {
  const t = useT();
  const { locale } = useI18n();
  const errorText = useErrorText();
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [modules, setModules] = useState<Module[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [granting, setGranting] = useState<Organization | null>(null);
  const [revoking, setRevoking] = useState<{ org: Organization; moduleId: string } | null>(null);

  const load = useCallback(async () => {
    const r = await call('/operator/organizations', authHeaders);
    if (!r.ok) {
      setError(errorText(r.error));
      setOrgs([]);
      return;
    }
    setOrgs(r.organizations as Organization[]);
    setModules(r.modules as Module[]);
  }, [authHeaders, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const moduleName = useCallback(
    (id: string) => {
      const m = modules.find((x) => x.id === id);
      return m ? t(m.caption) : id;
    },
    [modules, t],
  );

  const columns: TableColumn<Organization>[] = [
    { key: 'organization', value: (o) => `${o.name} ${o.slug}` },
    { key: 'members', value: (o) => o.members, search: false },
    { key: 'owners', value: (o) => o.owners.join(', ') || null },
    { key: 'licenses', value: (o) => o.licenses.map((l) => moduleName(l.moduleId)).join(', ') || null },
  ];
  const view = useTableView('operator.licenses', orgs, columns);
  const shown = view.rows;

  return (
    <Stack spacing={2}>
      <PageHeader
        title={`${t('superAdmin.licenses.title')}${orgs ? ` (${orgs.length})` : ''}`}
        subtitle={t('superAdmin.licenses.subtitle')}
        end={<TableSearch view={view} placeholder={t('superAdmin.filter')} />}
      />
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {!orgs ? (
        <CircularProgress />
      ) : (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <SortHeader view={view} column="organization">{t('superAdmin.organization')}</SortHeader>
                <SortHeader view={view} column="members" align="right">{t('superAdmin.members')}</SortHeader>
                <SortHeader view={view} column="owners">{t('superAdmin.owners')}</SortHeader>
                <SortHeader view={view} column="licenses">{t('superAdmin.licenses.title')}</SortHeader>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{o.name}</Typography>
                    <Typography variant="caption" color="text.secondary">{o.slug}</Typography>
                  </TableCell>
                  <TableCell align="right">{o.members}</TableCell>
                  <TableCell>
                    {o.owners.length ? o.owners.join(', ') : <Chip size="small" color="warning" label={t('superAdmin.noOwner')} />}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
                      {o.licenses.map((l) => (
                        <Chip
                          key={l.moduleId}
                          size="small"
                          color={l.expired ? 'default' : 'success'}
                          variant={l.expired ? 'outlined' : 'filled'}
                          label={`${moduleName(l.moduleId)} · ${l.validUntil
                            ? t(l.expired ? 'superAdmin.expired' : 'superAdmin.until', { date: formatLocaleDate(l.validUntil, locale) })
                            : t('superAdmin.openEnded')}`}
                          onDelete={() => setRevoking({ org: o, moduleId: l.moduleId })}
                        />
                      ))}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setGranting(o)} disabled={!modules.length}>{t('superAdmin.grant')}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      {granting && (
        <GrantDialog
          org={granting}
          modules={modules}
          authHeaders={authHeaders}
          moduleName={moduleName}
          onClose={(changed) => {
            setGranting(null);
            if (changed) void load();
          }}
        />
      )}
      <ConfirmDialog
        open={!!revoking}
        title={t('superAdmin.revoke')}
        message={revoking ? t('superAdmin.revokeConfirm', { module: moduleName(revoking.moduleId), organization: revoking.org.name }) : ''}
        confirmLabel={t('superAdmin.revoke')}
        cancelLabel={t('common.cancel')}
        onClose={() => setRevoking(null)}
        onConfirm={async () => {
          if (!revoking) return;
          const r = await call(`/operator/organizations/${revoking.org.id}/licenses/${encodeURIComponent(revoking.moduleId)}`, authHeaders, { method: 'DELETE' });
          if (!r.ok) setError(errorText(r.error));
          await load();
        }}
      />
    </Stack>
  );
}

function GrantDialog({ org, modules, authHeaders, moduleName, onClose }: {
  org: Organization;
  modules: Module[];
  authHeaders: AuthHeaders;
  moduleName: (id: string) => string;
  onClose: (changed: boolean) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [moduleId, setModuleId] = useState(modules[0]?.id ?? '');
  const existing = org.licenses.find((l) => l.moduleId === moduleId);
  const [until, setUntil] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setUntil(existing?.validUntil ?? '');
  }, [existing?.validUntil]);

  async function save() {
    setBusy(true);
    setError(null);
    const r = await call(`/operator/organizations/${org.id}/licenses/${encodeURIComponent(moduleId)}`, authHeaders, {
      method: 'PUT',
      body: JSON.stringify({ validUntil: until || null }),
    });
    setBusy(false);
    if (r.ok) onClose(true);
    else setError(errorText(r.error));
  }

  return (
    <Dialog open onClose={() => onClose(false)} fullWidth maxWidth="xs">
      <DialogTitle>{t('superAdmin.grantTitle', { organization: org.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField select label={t('superAdmin.module')} value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
            {modules.map((m) => <MenuItem key={m.id} value={m.id}>{moduleName(m.id)}</MenuItem>)}
          </TextField>
          <DatePicker
            label={t('superAdmin.validUntil')}
            value={until ? dayjs(until) : null}
            onChange={(d: Dayjs | null) => setUntil(d && d.isValid() ? d.format('YYYY-MM-DD') : '')}
            slotProps={{ field: { clearable: true }, textField: { helperText: t('superAdmin.validUntilHint') } }}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(false)}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || !moduleId}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Product news: the News page's editor on `operator/news`. */
export function SuperAdminNews({ authHeaders }: { authHeaders: AuthHeaders }) {
  return <News base={`${API}/operator/news`} userId={null} authHeaders={authHeaders} />;
}

/** The superusers (operators): the Admin organization's members, added by e-mail, removed but the last. */
export function SuperAdminUsers({ authHeaders }: { authHeaders: AuthHeaders }) {
  const t = useT();
  const errorText = useErrorText();
  const [operators, setOperators] = useState<Operator[] | null>(null);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Operator | null>(null);

  const load = useCallback(async () => {
    const r = await call('/operator/operators', authHeaders);
    if (!r.ok) setError(errorText(r.error));
    setOperators((r.operators as Operator[]) ?? []);
  }, [authHeaders, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await call('/operator/operators', authHeaders, { method: 'POST', body: JSON.stringify({ email }) });
    setBusy(false);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    setEmail('');
    await load();
  }

  return (
    <Stack spacing={2}>
      <PageHeader title={t('superAdmin.users.title')} subtitle={t('superAdmin.users.subtitle')} />
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Paper variant="outlined" component="form" onSubmit={add} sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <TextField
            size="small"
            type="email"
            label={t('superAdmin.users.email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            helperText={t('superAdmin.users.addHint')}
            sx={{ flex: '1 1 280px' }}
            required
          />
          <Button type="submit" variant="contained" disabled={busy || !email.trim()}>{t('superAdmin.users.add')}</Button>
        </Box>
      </Paper>
      {!operators ? (
        <CircularProgress />
      ) : (
        <Paper variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('superAdmin.users.name')}</TableCell>
                <TableCell>{t('superAdmin.users.email')}</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {operators.map((o) => (
                <TableRow key={o.userId} hover>
                  <TableCell>
                    {o.name}
                    {o.me && <Chip size="small" variant="outlined" label={t('superAdmin.users.me')} sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{o.email}</TableCell>
                  <TableCell align="right">
                    <Button size="small" color="error" disabled={operators.length <= 1} onClick={() => setRemoving(o)}>
                      {t('superAdmin.users.remove')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
      <ConfirmDialog
        open={!!removing}
        title={t('superAdmin.users.remove')}
        message={removing ? t(removing.me ? 'superAdmin.users.removeSelfConfirm' : 'superAdmin.users.removeConfirm', { name: removing.name }) : ''}
        confirmLabel={t('superAdmin.users.remove')}
        cancelLabel={t('common.cancel')}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          const r = await call(`/operator/operators/${removing.userId}`, authHeaders, { method: 'DELETE' });
          if (!r.ok) setError(errorText(r.error));
          if (r.ok && removing.me) window.location.reload();
          else await load();
        }}
      />
    </Stack>
  );
}

interface AiRow { id: string; name: string; slug: string; spentChf: number; calls: number; limitChf: number }

/** Every organization's monthly AI limit and this month's spend; the instance's budget. */
export function SuperAdminAi({ authHeaders }: { authHeaders: AuthHeaders }) {
  const t = useT();
  const { locale } = useI18n();
  const errorText = useErrorText();
  const [data, setData] = useState<{ azure: boolean; instanceBudgetChf: number | null; instanceSpentChf: number; organizations: AiRow[] } | null>(null);
  const aiColumns: TableColumn<AiRow>[] = [
    { key: 'organization', value: (o) => `${o.name} ${o.slug}` },
    { key: 'calls', value: (o) => o.calls, search: false },
    { key: 'spent', value: (o) => o.spentChf, search: false },
    { key: 'limit', value: (o) => o.limitChf, search: false },
  ];
  const aiView = useTableView('operator.ai', data?.organizations, aiColumns);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AiRow | null>(null);
  const [limit, setLimit] = useState('');

  const load = useCallback(async () => {
    const r = await call('/operator/ai', authHeaders);
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    setData(r as unknown as NonNullable<typeof data>);
  }, [authHeaders, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!editing) return;
    const value = parseLocaleNumber(limit, locale);
    if (value === null || value === undefined) {
      setError(errorText('ai-settings-limit'));
      return;
    }
    const r = await call(`/operator/organizations/${editing.id}/ai-limit`, authHeaders, { method: 'PUT', body: JSON.stringify({ monthlyLimitChf: value }) });
    if (!r.ok) {
      setError(errorText(r.error));
      return;
    }
    setEditing(null);
    await load();
  }

  return (
    <Stack spacing={2}>
      <PageHeader title={t('superAdmin.ai.title')} subtitle={t('superAdmin.ai.subtitle')} />
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {!data ? (
        <CircularProgress />
      ) : (
        <>
          <Alert severity={data.azure ? 'info' : 'warning'}>
            {data.azure
              ? t('superAdmin.ai.instance', { spent: formatMoney(data.instanceSpentChf, locale), budget: formatMoney(data.instanceBudgetChf ?? 0, locale) })
              : t('superAdmin.ai.off')}
          </Alert>
          <TableSearch view={aiView} />
          <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <SortHeader view={aiView} column="organization">{t('superAdmin.organization')}</SortHeader>
                  <SortHeader view={aiView} column="calls" align="right">{t('superAdmin.ai.calls')}</SortHeader>
                  <SortHeader view={aiView} column="spent" align="right">{t('superAdmin.ai.spent')}</SortHeader>
                  <SortHeader view={aiView} column="limit" align="right">{t('superAdmin.ai.limit')}</SortHeader>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {aiView.rows.map((o) => (
                  <TableRow key={o.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{o.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{o.slug}</Typography>
                    </TableCell>
                    <TableCell align="right">{o.calls}</TableCell>
                    <TableCell align="right" sx={{ color: o.limitChf > 0 && o.spentChf >= o.limitChf * 0.8 ? 'error.main' : undefined }}>
                      {formatMoney(o.spentChf, locale)}
                    </TableCell>
                    <TableCell align="right">{formatMoney(o.limitChf, locale)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => { setEditing(o); setLimit(formatLocaleNumber(o.limitChf, locale)); }}>{t('superAdmin.ai.change')}</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
      <Dialog open={!!editing} onClose={() => setEditing(null)} fullWidth maxWidth="xs">
        <DialogTitle>{editing ? t('superAdmin.ai.changeTitle', { organization: editing.name }) : ''}</DialogTitle>
        <DialogContent>
          <TextField
            sx={{ mt: 1 }}
            fullWidth
            label={t('superAdmin.ai.limitChf')}
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            helperText={t('superAdmin.ai.limitHint')}
            inputProps={{ inputMode: 'decimal' }}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void save()}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

interface InstanceInfo {
  startedAt: string;
  smtp: 'unknown' | 'ok' | 'failed';
  azure: boolean;
  documentsEncrypted: boolean;
  demoResetEveryHours: number | null;
  disk?: { diskFreeBytes: number | null; diskTotalBytes: number | null };
  counts: Record<'organizations' | 'withoutOwner' | 'activeUsers' | 'memberships' | 'licenses' | 'subscribers' | 'documents' | 'databaseBytes', number>;
}

/** The instance at a glance: what runs and is configured, and how much there is. */
export function SuperAdminInstance({ authHeaders }: { authHeaders: AuthHeaders }) {
  const t = useT();
  const { locale } = useI18n();
  const errorText = useErrorText();
  const [info, setInfo] = useState<InstanceInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await call('/operator/instance', authHeaders);
      if (r.ok) setInfo(r as unknown as InstanceInfo);
      else setError(errorText(r.error));
    })();
  }, [authHeaders, errorText]);

  const status = (good: boolean, label: string, hint?: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75 }}>
      <Chip size="small" color={good ? 'success' : 'warning'} label={good ? t('superAdmin.instance.ok') : t('superAdmin.instance.check')} />
      <Typography variant="body2">{label}</Typography>
      {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
    </Box>
  );
  const number = (key: keyof InstanceInfo['counts'], label: string) => (
    <Paper key={key} variant="outlined" sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {key === 'databaseBytes' ? formatFileSize(info!.counts[key], locale) : formatLocaleNumber(info!.counts[key], locale)}
      </Typography>
    </Paper>
  );

  return (
    <Stack spacing={2}>
      <PageHeader title={t('superAdmin.instance.title')} subtitle={t('superAdmin.instance.subtitle')} />
      {error && <Alert severity="error">{error}</Alert>}
      {!info ? (
        !error && <CircularProgress />
      ) : (
        <>
          <Paper variant="outlined" sx={{ p: 2 }}>
            {status(true, t('superAdmin.instance.started', { date: formatLocaleDateTime(info.startedAt, locale) }))}
            {status(info.smtp === 'ok', t('superAdmin.instance.smtp'), t(`superAdmin.instance.smtp.${info.smtp}`))}
            {status(info.azure, t('superAdmin.instance.azure'), info.azure ? undefined : t('superAdmin.ai.off'))}
            {status(info.documentsEncrypted, t('superAdmin.instance.documents'), info.documentsEncrypted ? undefined : t('superAdmin.instance.documentsPlain'))}
            {info.disk?.diskFreeBytes != null && info.disk.diskTotalBytes ? status(
              info.disk.diskFreeBytes / info.disk.diskTotalBytes >= 0.1 && info.disk.diskFreeBytes >= 2 * 1024 ** 3,
              t('superAdmin.instance.disk'),
              t('superAdmin.instance.diskFree', { free: formatFileSize(info.disk.diskFreeBytes, locale), total: formatFileSize(info.disk.diskTotalBytes, locale) }),
            ) : null}
            {info.demoResetEveryHours && status(true, t('superAdmin.instance.demo', { hours: String(info.demoResetEveryHours) }))}
          </Paper>
          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
            {number('organizations', t('superAdmin.instance.organizations'))}
            {number('withoutOwner', t('superAdmin.instance.withoutOwner'))}
            {number('activeUsers', t('superAdmin.instance.activeUsers'))}
            {number('memberships', t('superAdmin.instance.memberships'))}
            {number('licenses', t('superAdmin.instance.licenses'))}
            {number('subscribers', t('superAdmin.instance.subscribers'))}
            {number('documents', t('superAdmin.instance.documentsCount'))}
            {number('databaseBytes', t('superAdmin.instance.database'))}
          </Box>
        </>
      )}
    </Stack>
  );
}

/** Home in the Admin organization: what is here, instead of the work-time dashboard. */
export function SuperAdminHome({ onNavigate }: { onNavigate: (section: string) => void }) {
  const t = useT();
  const items = [
    { section: 'superAdminInstance', title: 'superAdmin.instance.title', text: 'superAdmin.instance.subtitle' },
    { section: 'superAdminLicenses', title: 'superAdmin.licenses.title', text: 'superAdmin.licenses.subtitle' },
    { section: 'superAdminAi', title: 'superAdmin.ai.title', text: 'superAdmin.ai.subtitle' },
    { section: 'superAdminNews', title: 'operator.news.title', text: 'operator.news.subtitle' },
    { section: 'superAdminStaticData', title: 'staticdata.defaultsTitle', text: 'staticdata.defaultsHome' },
    { section: 'superAdminUsers', title: 'superAdmin.users.title', text: 'superAdmin.users.subtitle' },
  ];
  return (
    <Stack spacing={2}>
      <PageHeader title={t('superAdmin.home.title')} subtitle={t('superAdmin.home.subtitle')} />
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(3, 1fr)' } }}>
        {items.map((i) => (
          <Paper key={i.section} variant="outlined" sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{t(i.title)}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{t(i.text)}</Typography>
            <Box>
              <Button size="small" onClick={() => onNavigate(i.section)}>{t('superAdmin.home.open')}</Button>
            </Box>
          </Paper>
        ))}
      </Box>
    </Stack>
  );
}
