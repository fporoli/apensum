// The Flows page: everything someone starts and others work on, in one list (the glossary in CLAUDE.md, "Flow").
// Its tabs are what waits for the caller, what they started, and what is done. The rows come from two sources: free
// flows and flows of the organization's own types (`requests`, opened on the right by Requests.tsx), and the built-in
// types such as absences, expense reports and timesheets (`workflows/assigned-to-me`, opened by Approvals.tsx). A flow
// of an own type is a request with a workflow: it is listed once, as the request.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, Autocomplete, Box, Chip, Divider, InputAdornment, LinearProgress, List, ListItemButton, ListItemText, ListSubheader, Menu, MenuItem, Paper,
  Tab, Tabs, TextField, Typography,
} from '@mui/material';
import { Button } from './Button';
import { flowTypeLabel } from '@worktime3/shared/flows';
import Approvals, { actionItemLabel, correspondingObject, itemPerson, type ActionItem, type Scope, type StatusFilter } from './Approvals';
import FlowDetail, { type Box_, type ComposePreset, type FlowItem } from './FlowDetail';
import { EmptyState, PageHeader } from './components';
import { useI18n } from './i18n';
import { AccountTreeIcon, AddIcon, ArrowDropDownIcon, LockIcon, SearchIcon, AssignmentIcon, PersonIcon, CheckCircleIcon } from './icons';
import { formatRelativeTime } from './localeFormat';
import { NO_FILTERS, flowQueries, flowRows, shownFrom, type FlowFilters, type FlowFocus, type FlowRow, type FlowsTab } from './flowRows';
import { PLUGIN_WORKFLOW_KINDS } from './plugins';
import { VISIBLE_SCROLLBAR } from './scrollbars';
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

/** What each tab asks the workflow items (the query strings of both sources: `flowQueries`). */
const TABS: Record<FlowsTab, { scope: Scope; status: StatusFilter }> = {
  todo: { scope: 'assigned', status: 'pending' },
  mine: { scope: 'mine', status: 'all' },
  done: { scope: 'assigned', status: 'all' },
};

/** The built-in kinds for the type filter (definition names), besides the plugins'. */
const CORE_DEFINITIONS = ['approve absence', 'approve timesheet', 'approve project timesheet', 'reopen approved timesheet'];
const PERIODS = [30, 90, 365] as const;
/** A column of the list and flow side by side: sticky below the app bar, as high as the window, scrolling inside. */
const PANE = {
  position: { md: 'sticky' },
  top: { md: 80 },
  maxHeight: { md: 'calc(100vh - 96px)' },
  overflowY: { md: 'auto' },
  ...VISIBLE_SCROLLBAR,
} as const;

type Person = { userId: string; name: string; email: string };

const REQUEST_COLOR = { open: 'warning', in_progress: 'info', resolved: 'success' } as const;
/** Each tab shows the newest so many of each source; "Load all" brings the rest that matches the filters. */
const PAGE = 200;
/** "Load all" reads the rest in pages this large (the API's most). */
const ALL = 1000;
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
  // Where each source's older flows start (the API's cursor), when there are more than loaded.
  const [older, setOlder] = useState<{ workflows: string | null; flows: string | null }>({ workflows: null, flows: null });
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ source: FlowRow['source']; id: string } | null>(props.focus ? { source: props.focus.source, id: props.focus.id } : null);
  const [filters, setFilters] = useState<FlowFilters>(NO_FILTERS);
  // The search field as typed; it reaches `filters.q` (and the API) after a pause.
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Person[] | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setFilters((f) => (f.q === search ? f : { ...f, q: search })), 350);
    return () => clearTimeout(id);
  }, [search]);
  // Who can be picked as the one who started a flow: the directory, read when the field is first opened.
  const loadPeople = async () => {
    if (people) return;
    try {
      const data = await (await fetch(`${API}/organizations/${orgId}/directory`, { headers: await authHeaders() })).json();
      setPeople(Array.isArray(data?.people) ? data.people.map((p: Person) => ({ userId: p.userId, name: p.name, email: p.email })) : []);
    } catch {
      setPeople([]);
    }
  };
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

  /** A source's rows as the API answers them: workflow items as an array, flows as `{ flows }`. */
  const fetchRows = async (url: string, headers: Record<string, string>) => {
    const body = await (await fetch(url, { headers })).json();
    if (body?.ok === false) throw new Error(body.error ?? 'error');
    return Array.isArray(body) ? body : Array.isArray(body?.flows) ? body.flows : [];
  };
  const urls = useCallback((before?: { workflows: string | null; flows: string | null }, size = PAGE) => {
    const q = flowQueries(tab, filters, orgId, hasFreeFlows);
    const page = `&limit=${size + 1}`;
    const after = (cursor: string | null | undefined) => (cursor ? `&before=${encodeURIComponent(cursor)}` : '');
    return {
      workflows: q.workflows && (!before || before.workflows) ? `${API}/workflows/assigned-to-me?${q.workflows}${page}${after(before?.workflows)}` : null,
      flows: q.flows && (!before || before.flows) ? `${API}/organizations/${orgId}/flows?${q.flows}${page}${after(before?.flows)}` : null,
    };
  }, [tab, filters, orgId, hasFreeFlows]);
  // Which box a flow belongs to (the thread on the right and the tab's rules): Done holds the inbox's and the archive's.
  const boxed = useCallback((rows: FlowItem[]) => rows.map((r) => ({ ...r, box: (tab === 'mine' ? 'mine' : tab === 'done' && r.archived_at ? 'archived' : 'inbox') as Box_ })), [tab]);
  /** One page of a source: what to show, and where its next page starts (null: no more). */
  const page = <T extends { cursor?: string }>(rows: T[], size = PAGE): { rows: T[]; next: string | null } =>
    ({ rows: rows.slice(0, size), next: rows.length > size ? (rows[size - 1].cursor ?? null) : null });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const u = urls();
      const [wf, fl] = await Promise.all([
        u.workflows ? fetchRows(u.workflows, headers) : Promise.resolve([]),
        u.flows ? fetchRows(u.flows, headers) : Promise.resolve([]),
      ]);
      const w = page(wf as ActionItem[]);
      const f = page(fl as (FlowItem & { cursor?: string })[]);
      setItems(w.rows);
      setRequests(boxed(f.rows));
      setOlder({ workflows: w.next, flows: f.next });
      // Opened without a focus: "To do" stays when something waits there, else "Mine".
      if (chooseTab.current && tab === 'todo') {
        chooseTab.current = false;
        if (wf.length + fl.length === 0) setTab('mine');
      }
      setError(null);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authHeaders, urls, boxed, tab, t]);

  useEffect(() => {
    void load();
  }, [load, props.refreshKey]);

  /** Every flow that matches the filters: the rest of each source, ALL at a time, added below. */
  const loadAll = async () => {
    let next = older;
    if (!next.workflows && !next.flows) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      while (next.workflows || next.flows) {
        const u = urls(next, ALL);
        const [wf, fl] = await Promise.all([
          u.workflows ? fetchRows(u.workflows, headers) : Promise.resolve(null),
          u.flows ? fetchRows(u.flows, headers) : Promise.resolve(null),
        ]);
        const w = wf ? page(wf as ActionItem[], ALL) : null;
        const f = fl ? page(fl as (FlowItem & { cursor?: string })[], ALL) : null;
        if (w) setItems((prev) => [...prev, ...w.rows]);
        if (f) setRequests((prev) => [...prev, ...boxed(f.rows)]);
        next = { workflows: w ? w.next : null, flows: f ? f.next : null };
        setOlder(next);
      }
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
    // While a source has more, only what is not older than its oldest loaded row (`shownFrom`).
    const shownSince = shownFrom([
      { more: !!older.workflows, oldest: items.at(-1)?.started ?? null },
      { more: !!older.flows, oldest: requests.at(-1)?.last_activity_at ?? null },
    ]);
    const time = (at: string | null | undefined) => (at ? Date.parse(at) : 0);
    const shownItems = shownSince === null ? items : items.filter((i) => time(i.started) >= shownSince);
    const shownRequests = shownSince === null ? requests : requests.filter((r) => time(r.last_activity_at) >= shownSince);
    return flowRows(tab, shownRequests, shownItems, {
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
  }, [tab, requests, items, types, locale, t, hasFreeFlows, shown.scope, older]);

  // Every kind there is (not only the loaded ones'): the built-in and the plugins' workflows, the own types, Free Flow.
  const typeOptions = useMemo(() => {
    const options = new Map<string, string>();
    for (const name of [...CORE_DEFINITIONS, ...PLUGIN_WORKFLOW_KINDS.map((k) => k.definitionName)]) options.set(`def:${name}`, actionItemLabel(name, t));
    if (hasFreeFlows) {
      for (const key of Object.keys(types)) options.set(`type:${key}`, flowTypeLabel(types, locale, key));
      options.set('free', t('flows.kind.free'));
    }
    return [...options].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, locale));
  }, [types, hasFreeFlows, locale, t]);
  const filtering = filters.type !== '' || filters.days !== null || (tab !== 'todo' && filters.state !== '') || (tab !== 'mine' && filters.person !== '') || filters.q.trim() !== '';
  const filtered = rows;
  const chosenPerson = people?.find((p) => p.userId === filters.person) ?? null;

  // There are older flows than loaded: said above the list (it stays there while the list scrolls) and below it.
  const hasOlder = !!(older.workflows || older.flows);
  const moreLine = (sticky: boolean) => (
    <Box
      sx={{
        px: 2, py: 0.75, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap',
        bgcolor: 'background.paper', borderColor: 'divider', borderStyle: 'solid', borderWidth: sticky ? '0 0 1px' : '1px 0 0',
        ...(sticky ? { position: 'sticky', top: 0, zIndex: 1 } : {}),
      }}
    >
      <Typography variant="body2" color="text.secondary">{t('flows.shownNewest', { count: filtered.length })}</Typography>
      <Button size="small" disabled={loading} onClick={() => void loadAll()}>{t('flows.loadAll')}</Button>
    </Box>
  );
  const list = (
    <Paper variant="outlined" sx={{ minWidth: 0 }}>
      {hasOlder && moreLine(true)}
      {loading && <LinearProgress />}
      {filtered.length === 0 && !loading ? (
        <EmptyState icon={<AccountTreeIcon fontSize="inherit" />} title={t(filtering ? 'flows.noMatch' : `flows.empty.${tab}`)} />
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
      {hasOlder && filtered.length > 0 && moreLine(false)}
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
        <Tab value="todo" icon={<AssignmentIcon />} label={t('flows.tab.todo')} />
        <Tab value="mine" icon={<PersonIcon />} label={t('flows.tab.mine')} />
        <Tab value="done" icon={<CheckCircleIcon />} label={t('flows.tab.done')} />
      </Tabs>

      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <TextField
          select
          size="small"
          label={t('flows.type')}
          value={typeOptions.some((o) => o.value === filters.type) ? filters.type : ''}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))}
          sx={{ minWidth: { xs: '100%', sm: 220 } }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">{t('flows.allTypes')}</MenuItem>
          {typeOptions.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
        <TextField
          select
          size="small"
          label={t('flows.period')}
          value={filters.days ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, days: e.target.value === '' ? null : Number(e.target.value) }))}
          sx={{ minWidth: { xs: '100%', sm: 170 } }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">{t('flows.period.all')}</MenuItem>
          {PERIODS.map((d) => <MenuItem key={d} value={d}>{t(`flows.period.${d}`)}</MenuItem>)}
        </TextField>
        {tab !== 'todo' && (
          <TextField
            select
            size="small"
            label={t('flows.state')}
            value={filters.state}
            onChange={(e) => setFilters((f) => ({ ...f, state: e.target.value as FlowFilters['state'] }))}
            sx={{ minWidth: { xs: '100%', sm: 160 } }}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value="">{t('flows.state.all')}</MenuItem>
            <MenuItem value="open">{t('flows.state.open')}</MenuItem>
            <MenuItem value="done">{t('flows.state.done')}</MenuItem>
            <MenuItem value="rejected">{t('flows.state.rejected')}</MenuItem>
          </TextField>
        )}
        {tab !== 'mine' && (
          <Autocomplete
            size="small"
            options={people ?? []}
            loading={people === null}
            onOpen={() => void loadPeople()}
            value={chosenPerson ?? (filters.person ? { userId: filters.person, name: '…', email: '' } : null)}
            onChange={(_, p) => setFilters((f) => ({ ...f, person: p?.userId ?? '' }))}
            getOptionLabel={(p) => p.name || p.email}
            isOptionEqualToValue={(a, b) => a.userId === b.userId}
            renderOption={(props, p) => <li {...props} key={p.userId}>{p.name || p.email}</li>}
            renderInput={(params) => <TextField {...params} label={t('flows.person')} placeholder={t('flows.person.anyone')} slotProps={{ inputLabel: { shrink: true } }} />}
            sx={{ minWidth: { xs: '100%', sm: 220 } }}
          />
        )}
        <TextField
          size="small"
          placeholder={t('flows.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ minWidth: { xs: '100%', sm: 260 } }}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment> } }}
        />
      </Box>

      {/* Side by side (md and up), list and flow each scroll on their own and stay below the app bar: a flow chosen far
          down the list is seen at once. */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 2fr) 3fr' }, alignItems: 'start' }}>
        <Box sx={{ display: { xs: selected ? 'none' : 'block', md: 'block' }, minWidth: 0, ...PANE }}>{list}</Box>
        <Box sx={{ display: { xs: selected ? 'block' : 'none', md: 'block' }, minWidth: 0, ...PANE }}>{detail}</Box>
      </Box>
    </Box>
  );
}
