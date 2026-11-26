import { useMemo, useState } from 'react';
import { Alert, Avatar, Badge, Box, Card, CardContent, Chip, CircularProgress, InputAdornment, Link, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useI18n } from './i18n';
import { EmptyState, PageHeader } from './components';
import { ContactsIcon, MailIcon, PhoneIcon, PlaceIcon, SearchIcon } from './icons';
import { formatLocaleDate, swissLocale } from './localeFormat';
import { useApi } from './useApi';
import { CANNOT_REACH_API } from './apiRequest';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Person {
  userId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  avatarUrl: string | null;
  phone: string | null;
  position: string | null;
  department: string | null;
  departmentId: string | null;
  location?: string | null;
  checkedInSince: string | null;
  status: 'checkedIn' | 'absent' | 'notCheckedIn' | 'notRecorded';
  absentUntil: string | null;
  managerId: string | null;
  managerName: string | null;
}

/** Presence as a small mark on the picture, like a chat app: green check, purple away arrow, grey ring. */
function StatusMark({ status }: { status: Person['status'] }) {
  // Who records no working time has no presence to show.
  if (status === 'notRecorded') return null;
  const ring = { width: 18, height: 18, borderRadius: '50%', border: 2, borderColor: 'background.paper', display: 'grid', placeItems: 'center' } as const;
  if (status === 'checkedIn') {
    return (
      <Box sx={{ ...ring, bgcolor: 'success.main' }}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 5.2 4.2 7.4 8.2 3" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Box>
    );
  }
  if (status === 'absent') {
    return (
      <Box sx={{ ...ring, bgcolor: '#a855f7' }}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M6.5 2.5 4 5l2.5 2.5M4 5h4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </Box>
    );
  }
  return <Box sx={{ ...ring, bgcolor: 'background.paper', boxShadow: (th) => `inset 0 0 0 2px ${th.palette.grey[500]}` }} />;
}

function initials(p: Person): string {
  const parts = [p.firstName, p.lastName].filter(Boolean) as string[];
  const source = parts.length ? parts : p.name.split(/\s+/);
  return source
    .slice(0, 2)
    .map((s) => s.charAt(0).toUpperCase())
    .join('');
}

/** Employee directory (API directory.controller.ts): everyone in the organization, with how to reach them. */
export default function Directory({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  // Check-ins change during the day: loaded again every minute while the page is open.
  const directory = useApi<{ people?: Person[] }>(`${API}/organizations/${orgId}/directory`, authHeaders, { refreshMs: 60_000 });
  const people = directory.data ? (Array.isArray(directory.data.people) ? directory.data.people : []) : directory.error ? [] : null;
  const error = directory.error
    ? directory.error === CANNOT_REACH_API ? t('common.cannotReachApi') : t('directory.loadFailed', { error: directory.error })
    : null;
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('all');
  const [onlyPresent, setOnlyPresent] = useState(false);

  const departments = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? []) if (p.departmentId && p.department) map.set(p.departmentId, p.department);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [people, locale]);

  const byId = useMemo(() => new Map((people ?? []).map((p) => [p.userId, p])), [people]);
  /** The presence line: only checked in or absent; "not checked in" is just the grey ring (its tooltip). */
  const presenceLine = (p: Person) => (p.status === 'notCheckedIn' || p.status === 'notRecorded' ? null : statusText(p));
  const statusText = (p: Person) =>
    p.status === 'checkedIn' && p.checkedInSince ? t('directory.checkedInSince', { time: time(p.checkedInSince) })
      : p.status === 'absent' ? (p.absentUntil ? t('directory.absentUntil', { date: formatLocaleDate(p.absentUntil, locale) }) : t('directory.absent'))
        : p.status === 'notRecorded' ? ''
        : t('directory.notCheckedIn');
  const statusColor = (p: Person) => (p.status === 'checkedIn' ? 'success.main' : p.status === 'absent' ? '#a855f7' : 'text.secondary');

  /** The manager's card, shown when hovering "Reports to". */
  const managerPanel = (p: Person) => {
    const m = p.managerId ? byId.get(p.managerId) : undefined;
    if (!m) return <Typography variant="body2">{p.managerName}</Typography>;
    return (
      <Box sx={{ display: 'flex', gap: 1.5, p: 0.5, minWidth: 220 }}>
        <Badge overlap="circular" anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} badgeContent={<StatusMark status={m.status} />}>
          <Avatar src={m.avatarUrl ?? undefined} alt={m.name} sx={{ width: 44, height: 44 }}>{initials(m)}</Avatar>
        </Badge>
        <Box sx={{ minWidth: 0, display: 'grid', gap: 0.25 }}>
          <Typography variant="caption" color="text.secondary">{t('directory.reportsTo')}</Typography>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{m.name}</Typography>
          {(m.position || m.department) && <Typography variant="caption" color="text.secondary">{[m.position, m.department].filter(Boolean).join(' · ')}</Typography>}
          {presenceLine(m) && <Typography variant="caption" sx={{ color: statusColor(m) }}>{presenceLine(m)}</Typography>}
          {m.location && <LocationLine name={m.location} />}
          {m.phone && <Link href={`tel:${m.phone.replace(/[^\d+]/g, '')}`} variant="caption" underline="hover">{m.phone}</Link>}
          <Link href={`mailto:${m.email}`} variant="caption" underline="hover" sx={{ overflowWrap: 'anywhere' }}>{m.email}</Link>
        </Box>
      </Box>
    );
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people ?? []).filter(
      (p) =>
        (department === 'all' || p.departmentId === department) &&
        (!onlyPresent || p.checkedInSince) &&
        (!q || [p.name, p.email, p.phone, p.position, p.department, p.location, p.managerName].filter(Boolean).join(' ').toLowerCase().includes(q)),
    );
  }, [people, query, department, onlyPresent]);

  const present = (people ?? []).filter((p) => p.checkedInSince).length;
  const time = (iso: string) => new Intl.DateTimeFormat(swissLocale(locale), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('directory.title')} subtitle={t('directory.subtitle')} />
      {error && (
        <Alert severity="error" onClose={directory.clearError}>
          {error}
        </Alert>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
        <TextField
          size="small"
          placeholder={t('directory.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          sx={{ flex: 1, maxWidth: { sm: 360 } }}
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
        {departments.length > 0 && (
          <TextField select size="small" label={t('directory.department')} value={department} onChange={(e) => setDepartment(e.target.value)} sx={{ minWidth: 200 }}>
            <MenuItem value="all">{t('directory.allDepartments')}</MenuItem>
            {departments.map(([id, name]) => (
              <MenuItem key={id} value={id}>
                {name}
              </MenuItem>
            ))}
          </TextField>
        )}
        <Chip
          label={t('directory.present', { count: present })}
          color={onlyPresent ? 'success' : 'default'}
          variant={onlyPresent ? 'filled' : 'outlined'}
          onClick={() => setOnlyPresent((v) => !v)}
        />
      </Stack>

      {people === null ? (
        <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress size={28} />
        </Box>
      ) : visible.length === 0 ? (
        <EmptyState icon={<ContactsIcon fontSize="inherit" />} title={people.length === 0 ? t('directory.empty') : t('directory.noResults')} />
      ) : (
        <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
          {visible.map((p) => (
            <Card key={p.userId} variant="outlined">
              <CardContent sx={{ display: 'flex', gap: 1.75, alignItems: 'flex-start', '&:last-child': { pb: 2 } }}>
                <Tooltip title={statusText(p)}>
                  <Badge overlap="circular" anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} badgeContent={<StatusMark status={p.status} />}>
                    <Avatar src={p.avatarUrl ?? undefined} alt={p.name} sx={{ width: 56, height: 56, fontSize: '1.1rem' }}>
                      {initials(p)}
                    </Avatar>
                  </Badge>
                </Tooltip>
                <Box sx={{ minWidth: 0, display: 'grid', gap: 0.25 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                    {p.name}
                  </Typography>
                  {(p.position || p.department) && (
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {[p.position, p.department].filter(Boolean).join(' · ')}
                    </Typography>
                  )}
                  {presenceLine(p) && (
                    <Typography variant="caption" sx={{ color: statusColor(p) }}>
                      {presenceLine(p)}
                    </Typography>
                  )}
                  {p.location && <LocationLine name={p.location} />}
                  {p.managerName && (
                    <Tooltip
                      title={managerPanel(p)}
                      placement="bottom-start"
                      enterDelay={250}
                      slotProps={{ tooltip: { sx: { bgcolor: 'background.paper', color: 'text.primary', border: 1, borderColor: 'divider', boxShadow: 3, maxWidth: 340, p: 1.25 } } }}
                    >
                      <Typography variant="caption" color="text.secondary" sx={{ cursor: 'default', width: 'fit-content' }}>
                        {t('directory.reportsTo')}{' '}
                        <Box component="span" sx={{ color: 'text.primary', fontWeight: 600, borderBottom: 1, borderStyle: 'dotted', borderColor: 'text.secondary' }}>{p.managerName}</Box>
                      </Typography>
                    </Tooltip>
                  )}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.5, minWidth: 0 }}>
                    <MailIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                    <Link href={`mailto:${p.email}`} variant="body2" underline="hover" sx={{ overflowWrap: 'anywhere' }}>
                      {p.email}
                    </Link>
                  </Box>
                  {p.phone && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <PhoneIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      <Link href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} variant="body2" underline="hover">
                        {p.phone}
                      </Link>
                    </Box>
                  )}
                </Box>
              </CardContent>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** Where the person works (their location), with a pin. */
function LocationLine({ name }: { name: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <PlaceIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
      <Typography variant="caption" color="text.secondary" noWrap>{name}</Typography>
    </Box>
  );
}
