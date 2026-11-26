// The Flows page: everything someone starts and others work on, in one list (the glossary in CLAUDE.md, "Flow").
// Its tabs are what waits for the caller, what they started, and what is done. The rows come from two sources: free
// flows and flows of the organization's own types (`requests`, opened on the right by Requests.tsx), and the built-in
// types such as absences, expense reports and timesheets (`workflows/assigned-to-me`, opened by Approvals.tsx). A flow
// of an own type is a request with a workflow: it is listed once, as the request.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Chip, Divider, InputAdornment, LinearProgress, List, ListItemButton, ListItemText, MenuItem, Paper, Tab, Tabs,
  TextField,
} from '@mui/material';
import { requestTypeLabel } from '@worktime3/shared/requests';
import Approvals, { actionItemLabel, correspondingObject, itemPerson, type ActionItem, type Scope, type StatusFilter } from './Approvals';
import Requests, { type Box_, type RequestItem } from './Requests';
import { EmptyState, PageHeader } from './components';
import { useI18n } from './i18n';
import { AccountTreeIcon, AddIcon, LockIcon, SearchIcon } from './icons';
import { formatRelativeTime } from './localeFormat';
import { flowRows, type FlowRow, type FlowsTab } from './flowRows';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';


interface FlowsProps {
  orgId: string;
  userId: string | null;
  role: 'admin' | 'manager' | 'user';
  /** Decides on others' items (managers, HR). */
  canDecide: boolean;
  /** The requests module is on and the caller may use it (`nav.requests`): free flows and own types. */
  hasFreeFlows: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  /** The tab to open on (an old link to the Workflow or Requests page, a notification). */
  initialTab?: FlowsTab;
  /** A free flow to open (a notification, `#/requests?id=`). */
  focusId?: string | null;
  refreshKey?: unknown;
  onChanged?: () => void;
  navigate?: (section: string) => void;
}

/** What each tab asks the two sources. */
const TABS: Record<FlowsTab, { scope: Scope; status: StatusFilter; boxes: Box_[] }> = {
  todo: { scope: 'assigned', status: 'pending', boxes: ['inbox'] },
  mine: { scope: 'mine', status: 'all', boxes: ['mine'] },
  done: { scope: 'assigned', status: 'all', boxes: ['inbox', 'archived'] },
};

const REQUEST_COLOR = { open: 'warning', in_progress: 'info', resolved: 'success' } as const;
const WORKFLOW_COLOR = { pending: 'warning', approved: 'success', rejected: 'error' } as const;

export default function Flows(props: FlowsProps) {
  const { t, locale } = useI18n();
  const { orgId, userId, authHeaders, hasFreeFlows } = props;
  const [tab, setTab] = useState<FlowsTab>(props.focusId ? 'mine' : props.initialTab ?? (props.canDecide ? 'todo' : 'mine'));
  const [requests, setRequests] = useState<(RequestItem & { box: Box_ })[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [types, setTypes] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ source: FlowRow['source']; id: string } | null>(props.focusId ? { source: 'request', id: props.focusId } : null);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [composeSignal, setComposeSignal] = useState(0);
  const shown = TABS[tab];

  useEffect(() => {
    if (props.focusId) setSelected({ source: 'request', id: props.focusId });
  }, [props.focusId]);

  // The request types' labels (static data `requests`/`request_type`).
  useEffect(() => {
    if (!hasFreeFlows) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await (await fetch(`${API}/organizations/${orgId}/static-data/requests`, { headers: await authHeaders() })).json();
        const row = Array.isArray(rows) ? rows.find((x: { enum_name?: string }) => x.enum_name === 'request_type') : null;
        if (!cancelled) setTypes(row?.translation ?? {});
      } catch {
        /* the type's key is shown instead */
      }
    })();
    return () => { cancelled = true; };
  }, [orgId, authHeaders, hasFreeFlows]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const [wf, ...boxes] = await Promise.all([
        fetch(`${API}/workflows/assigned-to-me?scope=${shown.scope}&status=${shown.status}&orgId=${orgId}`, { headers }).then((r) => r.json()),
        ...(hasFreeFlows ? shown.boxes.map((box) => fetch(`${API}/organizations/${orgId}/requests?box=${box}`, { headers }).then((r) => r.json())) : []),
      ]);
      setItems(Array.isArray(wf) ? wf : []);
      setRequests(boxes.flatMap((b, k) => (Array.isArray(b?.requests) ? (b.requests as RequestItem[]).map((r) => ({ ...r, box: shown.boxes[k] })) : [])));
      setError(null);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  }, [authHeaders, orgId, hasFreeFlows, shown, t]);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  const changed = () => {
    void load();
    props.onChanged?.();
  };

  const rows = useMemo(() => {
    const target = (r: RequestItem) =>
      r.target_kind === 'manager' ? t('requests.toManager')
        : r.target_kind === 'department' ? t('requests.toDepartment', { department: r.department_name ?? '' }) : '';
    const from = (r: RequestItem) => {
      if (r.requester_name || r.requester_email) return r.requester_name ?? r.requester_email ?? '';
      const label = r.source ? t(`modules.${r.source}`) : t('requests.system');
      return label === `modules.${r.source}` ? r.source ?? '' : label;
    };
    return flowRows(tab, requests, items, {
      request: (r) => ({
        title: r.subject,
        type: r.request_type ? requestTypeLabel(types, locale, r.request_type) : t('flows.kind.free'),
        line: [r.box === 'mine' ? '' : from(r), target(r)].filter(Boolean).join(' · '),
        status: { label: t(`requests.status.${r.status}`), color: REQUEST_COLOR[r.status] },
      }),
      item: (i) => ({
        title: correspondingObject(i, t),
        type: actionItemLabel(i.definition_name, t),
        line: shown.scope === 'mine'
          ? (i.assignee_name && i.step_status === 'pending' ? t('flows.waitingFor', { name: i.assignee_name }) : '')
          : itemPerson(i)?.name ?? '',
        status: { label: t(`approvals.status.${i.step_status}`), color: WORKFLOW_COLOR[i.step_status] },
      }),
    }, hasFreeFlows);
  }, [tab, requests, items, types, locale, t, hasFreeFlows, shown.scope]);

  const typeOptions = useMemo(() => [...new Set(rows.map((r) => r.type))].sort((a, b) => a.localeCompare(b, locale)), [rows, locale]);
  const shownType = typeOptions.includes(typeFilter) ? typeFilter : '';
  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => (!shownType || r.type === shownType) && (!q || `${r.title} ${r.type} ${r.line}`.toLowerCase().includes(q)));

  const list = (
    <Paper variant="outlined" sx={{ minWidth: 0 }}>
      {loading && <LinearProgress />}
      {filtered.length === 0 && !loading ? (
        <EmptyState icon={<AccountTreeIcon fontSize="inherit" />} title={t(rows.length ? 'flows.noMatch' : `flows.empty.${tab}`)} />
      ) : (
        <List disablePadding>
          {filtered.map((row, k) => (
            <Box key={`${row.source}:${row.id}`}>
              {k > 0 && <Divider component="li" />}
              <ListItemButton
                selected={selected?.source === row.source && selected.id === row.id}
                onClick={() => setSelected({ source: row.source, id: row.id })}
                sx={{ alignItems: 'flex-start', gap: 1 }}
              >
                <ListItemText
                  primary={row.title}
                  primaryTypographyProps={{ noWrap: true, fontWeight: 600 }}
                  secondary={
                    <>
                      {[row.type, row.line].filter(Boolean).join(' · ')}
                      <br />
                      {row.at ? formatRelativeTime(row.at, locale) : ''}
                    </>
                  }
                />
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
                  <Chip size="small" color={row.status.color} label={row.status.label} />
                  {row.urgent && <Chip size="small" color="error" variant="outlined" label={t('requests.urgent')} />}
                  {row.confidential && <LockIcon fontSize="small" color="action" titleAccess={t('requests.confidential')} />}
                </Box>
              </ListItemButton>
            </Box>
          ))}
        </List>
      )}
    </Paper>
  );

  const detail = !selected ? (
    <Paper variant="outlined"><EmptyState title={t('flows.pick')} /></Paper>
  ) : selected.source === 'request' ? (
    <Requests
      key={`request:${selected.id}`}
      orgId={orgId}
      userId={userId}
      authHeaders={authHeaders}
      focusId={selected.id}
      refreshKey={props.refreshKey}
      onChanged={changed}
      navigate={props.navigate}
      embedded={{ box: tab === 'mine' ? 'mine' : 'inbox', detailOnly: true, onBack: () => setSelected(null) }}
    />
  ) : (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Button size="small" onClick={() => setSelected(null)} sx={{ display: { md: 'none' }, justifySelf: 'start' }}>{t('requests.back')}</Button>
      <Approvals
        key={`workflow:${selected.id}`}
        orgId={orgId}
        role={props.role}
        canDecide={props.canDecide}
        authHeaders={authHeaders}
        onChanged={changed}
        embedded={{ scope: shown.scope, status: shown.status, onlyId: selected.id }}
      />
    </Box>
  );

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('flows.title')}
        subtitle={t('flows.subtitle')}
        end={hasFreeFlows ? (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setComposeSignal((n) => n + 1)}>
            {t('flows.new')}
          </Button>
        ) : undefined}
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* The request forms' design mode, and the new-flow dialog. */}
      {hasFreeFlows && (
        <Requests
          orgId={orgId}
          userId={userId}
          authHeaders={authHeaders}
          onChanged={props.onChanged}
          embedded={{
            box: 'mine',
            designOnly: true,
            composeSignal,
            onCreated: (id) => {
              setTab('mine');
              setSelected({ source: 'request', id });
            },
          }}
        />
      )}

      <Tabs value={tab} onChange={(_, v: FlowsTab) => { setTab(v); setSelected(null); }} variant="scrollable" allowScrollButtonsMobile>
        <Tab value="todo" label={t('flows.tab.todo')} />
        <Tab value="mine" label={t('flows.tab.mine')} />
        <Tab value="done" label={t('flows.tab.done')} />
      </Tabs>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label={t('flows.type')}
          value={shownType}
          onChange={(e) => setTypeFilter(e.target.value)}
          sx={{ minWidth: { xs: '100%', sm: 240 } }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">{t('flows.allTypes')}</MenuItem>
          {typeOptions.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
        </TextField>
        <TextField
          size="small"
          placeholder={t('flows.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: { xs: '100%', sm: 300 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment> } }}
        />
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 2fr) 3fr' }, alignItems: 'start' }}>
        <Box sx={{ display: { xs: selected ? 'none' : 'block', md: 'block' }, minWidth: 0 }}>{list}</Box>
        <Box sx={{ display: { xs: selected ? 'block' : 'none', md: 'block' }, minWidth: 0 }}>{detail}</Box>
      </Box>
    </Box>
  );
}
