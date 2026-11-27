// The Flows page: everything someone starts and others work on, in one list (the glossary in CLAUDE.md, "Flow").
// Its tabs are what waits for the caller, what they started, and what is done. The rows come from two sources: free
// flows and flows of the organization's own types (`requests`, opened on the right by Requests.tsx), and the built-in
// types such as absences, expense reports and timesheets (`workflows/assigned-to-me`, opened by Approvals.tsx). A flow
// of an own type is a request with a workflow: it is listed once, as the request.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Box, Chip, Divider, InputAdornment, LinearProgress, List, ListItemButton, ListItemText, ListSubheader, Menu, MenuItem, Paper,
  Tab, Tabs, TextField,
} from '@mui/material';
import { Button } from './Button';
import { flowTypeLabel } from '@worktime3/shared/flows';
import Approvals, { actionItemLabel, correspondingObject, itemPerson, type ActionItem, type Scope, type StatusFilter } from './Approvals';
import FlowDetail, { type Box_, type ComposePreset, type FlowItem } from './FlowDetail';
import { EmptyState, PageHeader } from './components';
import { useI18n } from './i18n';
import { AccountTreeIcon, AddIcon, ArrowDropDownIcon, LockIcon, SearchIcon } from './icons';
import { formatRelativeTime } from './localeFormat';
import { flowRows, type FlowFocus, type FlowRow, type FlowsTab } from './flowRows';
export type { FlowFocus, FlowsTab } from './flowRows';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';


interface FlowsProps {
  orgId: string;
  userId: string | null;
  role: 'admin' | 'manager' | 'user';
  /** Decides on others' items (managers, HR). */
  canDecide: boolean;
  /** The requests module is on and the caller may use it (`nav.flows`): free flows and own types. */
  hasFreeFlows: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  /** The tab to open on (an old link to the Workflow or Requests page, a notification). */
  initialTab?: FlowsTab;
  /** A flow to open (a notification, `#/flows?id=`), on its tab when it names one. */
  focus?: FlowFocus | null;
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
/** Done and Mine show the newest so many of the other flows; "Load older" brings the next ones. */
const PAGE = 200;
const WORKFLOW_COLOR = { pending: 'warning', approved: 'success', rejected: 'error' } as const;

export default function Flows(props: FlowsProps) {
  const { t, locale } = useI18n();
  const { orgId, userId, authHeaders, hasFreeFlows } = props;
  // A focus opens its tab; otherwise "To do", which gives way to "Mine" when nothing waits (see the first load below).
  const [tab, setTab] = useState<FlowsTab>(props.focus ? props.focus.tab ?? 'mine' : props.initialTab ?? 'todo');
  const chooseTab = useRef(!props.focus && !props.initialTab);
  const [requests, setRequests] = useState<(FlowItem & { box: Box_ })[]>([]);
  const [items, setItems] = useState<ActionItem[]>([]);
  const [types, setTypes] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  // Where older flows start (the API's cursor), when there are more than the page shows.
  const [older, setOlder] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ source: FlowRow['source']; id: string } | null>(props.focus ? { source: props.focus.source, id: props.focus.id } : null);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [composeSignal, setComposeSignal] = useState(0);
  const [composePreset, setComposePreset] = useState<ComposePreset | undefined>(undefined);
  // "New flow": the types with their own steps, then a free flow to the manager or a department.
  const [newMenu, setNewMenu] = useState<HTMLElement | null>(null);
  const [flowTypes, setFlowTypes] = useState<{ withSteps: string[]; manager: boolean; departments: boolean } | null>(null);
  const openNewMenu = async (anchor: HTMLElement) => {
    setNewMenu(anchor);
    try {
      const data = await (await fetch(`${API}/organizations/${orgId}/flows/targets`, { headers: await authHeaders() })).json();
      setFlowTypes({
        withSteps: Object.keys(data?.workflows ?? {}),
        manager: !!data?.manager,
        departments: Array.isArray(data?.departments) && data.departments.length > 0,
      });
    } catch {
      setFlowTypes({ withSteps: [], manager: true, departments: true });
    }
  };
  const compose = (preset: ComposePreset) => {
    setNewMenu(null);
    setComposePreset(preset);
    setComposeSignal((n) => n + 1);
  };
  const shown = TABS[tab];

  useEffect(() => {
    if (!props.focus) return;
    chooseTab.current = false;
    if (props.focus.tab) setTab(props.focus.tab);
    setSelected({ source: props.focus.source, id: props.focus.id });
  }, [props.focus]);

  // The request types' labels (static data `requests`/`flow_type`).
  useEffect(() => {
    if (!hasFreeFlows) return;
    let cancelled = false;
    (async () => {
      try {
        const rows = await (await fetch(`${API}/organizations/${orgId}/static-data/flows`, { headers: await authHeaders() })).json();
        const row = Array.isArray(rows) ? rows.find((x: { enum_name?: string }) => x.enum_name === 'flow_type') : null;
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
        fetch(`${API}/workflows/assigned-to-me?scope=${shown.scope}&status=${shown.status}&orgId=${orgId}${shown.status === 'all' ? `&limit=${PAGE + 1}` : ''}`, { headers }).then((r) => r.json()),
        ...(hasFreeFlows ? shown.boxes.map((box) => fetch(`${API}/organizations/${orgId}/flows?box=${box}`, { headers }).then((r) => r.json())) : []),
      ]);
      const list: ActionItem[] = Array.isArray(wf) ? wf : [];
      setItems(shown.status === 'all' ? list.slice(0, PAGE) : list);
      setOlder(shown.status === 'all' && list.length > PAGE ? (list[PAGE - 1].cursor ?? null) : null);
      // Opened without a focus: "To do" stays when something waits there, else "Mine".
      if (chooseTab.current && tab === 'todo') {
        chooseTab.current = false;
        const waiting = (Array.isArray(wf) ? wf.length : 0) + boxes.reduce((n, b) => n + (Array.isArray(b?.flows) ? b.flows.filter((f: FlowItem) => f.status !== 'resolved').length : 0), 0);
        if (waiting === 0) setTab('mine');
      }
      setRequests(boxes.flatMap((b, k) => (Array.isArray(b?.flows) ? (b.flows as FlowItem[]).map((r) => ({ ...r, box: shown.boxes[k] })) : [])));
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

  /** The next older flows (Done, Mine), added below. */
  const loadOlder = async () => {
    if (!older) return;
    setLoading(true);
    try {
      const wf = await (await fetch(`${API}/workflows/assigned-to-me?scope=${shown.scope}&status=${shown.status}&orgId=${orgId}&limit=${PAGE + 1}&before=${encodeURIComponent(older)}`, { headers: await authHeaders() })).json();
      const list: ActionItem[] = Array.isArray(wf) ? wf : [];
      setItems((prev) => [...prev, ...list.slice(0, PAGE)]);
      setOlder(list.length > PAGE ? (list[PAGE - 1].cursor ?? null) : null);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  };

  const changed = () => {
    void load();
    props.onChanged?.();
  };

  const rows = useMemo(() => {
    const target = (r: FlowItem) =>
      r.target_kind === 'manager' ? t('flow.toManager')
        : r.target_kind === 'department' ? t('flow.toDepartment', { department: r.department_name ?? '' }) : '';
    const from = (r: FlowItem) => {
      if (r.requester_name || r.requester_email) return r.requester_name ?? r.requester_email ?? '';
      const label = r.source ? t(`modules.${r.source}`) : t('flow.system');
      return label === `modules.${r.source}` ? r.source ?? '' : label;
    };
    return flowRows(tab, requests, items, {
      flow: (r) => ({
        title: r.subject,
        type: r.flow_type ? flowTypeLabel(types, locale, r.flow_type) : t('flows.kind.free'),
        line: [r.box === 'mine' ? '' : from(r), target(r)].filter(Boolean).join(' · '),
        status: { label: t(`flow.status.${r.status}`), color: REQUEST_COLOR[r.status] },
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
                  {row.urgent && <Chip size="small" color="error" variant="outlined" label={t('flow.urgent')} />}
                  {row.confidential && <LockIcon fontSize="small" color="action" titleAccess={t('flow.confidential')} />}
                </Box>
              </ListItemButton>
            </Box>
          ))}
        </List>
      )}
      {older && (
        <Box sx={{ p: 1, display: 'flex', justifyContent: 'center' }}>
          <Button size="small" disabled={loading} onClick={() => void loadOlder()}>{t('flows.showOlder')}</Button>
        </Box>
      )}
    </Paper>
  );

  const detail = !selected ? (
    <Paper variant="outlined"><EmptyState title={t('flows.pick')} /></Paper>
  ) : selected.source === 'flow' ? (
    <FlowDetail
      key={`flow:${selected.id}`}
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
      <Button size="small" onClick={() => setSelected(null)} sx={{ display: { md: 'none' }, justifySelf: 'start' }}>{t('flow.back')}</Button>
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
          <>
            <Button variant="contained" startIcon={<AddIcon />} endIcon={<ArrowDropDownIcon />} onClick={(e) => void openNewMenu(e.currentTarget)}>
              {t('flows.new')}
            </Button>
            <Menu anchorEl={newMenu} open={!!newMenu} onClose={() => setNewMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}>
              {/* A Free Flow first: whom it goes to (the manager or a department) is chosen in the dialog. */}
              <MenuItem disabled={flowTypes ? !flowTypes.manager && !flowTypes.departments : false} onClick={() => compose({ free: true })}>
                <ListItemText primary={t('flows.new.free')} secondary={t('flows.new.freeHint')} />
              </MenuItem>
              {flowTypes && flowTypes.withSteps.length > 0 && <Divider />}
              {flowTypes && flowTypes.withSteps.length > 0 && <ListSubheader>{t('flows.new.withSteps')}</ListSubheader>}
              {flowTypes?.withSteps
                .map((key) => ({ key, label: flowTypeLabel(types, locale, key) }))
                .sort((a, b) => a.label.localeCompare(b.label, locale))
                .map((x) => <MenuItem key={x.key} onClick={() => compose({ type: x.key })}>{x.label}</MenuItem>)}
            </Menu>
          </>
        ) : undefined}
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {/* The request forms' design mode, and the new-flow dialog. */}
      {hasFreeFlows && (
        <FlowDetail
          orgId={orgId}
          userId={userId}
          authHeaders={authHeaders}
          onChanged={props.onChanged}
          embedded={{
            box: 'mine',
            designOnly: true,
            composeSignal,
            composePreset,
            onCreated: (id) => {
              setTab('mine');
              setSelected({ source: 'flow', id });
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
