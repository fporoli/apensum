import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Avatar, Badge, Box, Card, CardContent, Chip, CircularProgress, InputAdornment, Link, MenuItem, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useI18n } from './i18n';
import { EmptyState, PageHeader } from './components';
import { ContactsIcon, MailIcon, PhoneIcon, SearchIcon } from './icons';

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
  checkedInSince: string | null;
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
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [department, setDepartment] = useState('all');
  const [onlyPresent, setOnlyPresent] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/directory`, { headers: await authHeaders() });
      const data = await res.json();
      if (!data?.ok) {
        setError(t('directory.loadFailed', { error: data?.error ?? t('common.unknownError') }));
        setPeople([]);
        return;
      }
      setError(null);
      setPeople(Array.isArray(data.people) ? data.people : []);
    } catch {
      setError(t('common.cannotReachApi'));
      setPeople([]);
    }
  }, [orgId, authHeaders, t]);

  useEffect(() => {
    void load();
    // Check-ins change during the day: refresh every minute while the page is open.
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const departments = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people ?? []) if (p.departmentId && p.department) map.set(p.departmentId, p.department);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [people, locale]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (people ?? []).filter(
      (p) =>
        (department === 'all' || p.departmentId === department) &&
        (!onlyPresent || p.checkedInSince) &&
        (!q || [p.name, p.email, p.phone, p.position, p.department].filter(Boolean).join(' ').toLowerCase().includes(q)),
    );
  }, [people, query, department, onlyPresent]);

  const present = (people ?? []).filter((p) => p.checkedInSince).length;
  const time = (iso: string) => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader title={t('directory.title')} subtitle={t('directory.subtitle')} />
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
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
                <Tooltip title={p.checkedInSince ? t('directory.checkedInSince', { time: time(p.checkedInSince) }) : t('directory.notCheckedIn')}>
                  <Badge
                    overlap="circular"
                    anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                    variant="dot"
                    sx={{
                      '& .MuiBadge-dot': {
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        border: 2,
                        borderColor: 'background.paper',
                        bgcolor: p.checkedInSince ? 'success.main' : 'grey.400',
                      },
                    }}
                  >
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
                  <Typography variant="caption" sx={{ color: p.checkedInSince ? 'success.main' : 'text.secondary' }}>
                    {p.checkedInSince ? t('directory.checkedInSince', { time: time(p.checkedInSince) }) : t('directory.notCheckedIn')}
                  </Typography>
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
