import { Fragment, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Typography,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Button } from './Button';
import { minutes, periodLabel, periodRange, type Entry } from './aggregate';
import { useI18n, type TFunction } from './i18n';
import { stepFieldLabel, stepFieldValues, type StepField } from '@worktime3/shared/workflowConfig';
import { StepFieldsForm, type StepValues } from './StepFieldsForm';
import { formatDurationMinutes, formatFileSize, formatLocaleDate, formatLocaleDateTime, formatSignedMinutes, swissLocale } from './localeFormat';
import { getSourceTitle } from './Timesheet';
import { PLUGIN_WORKFLOW_KINDS } from './plugins';
import type { PluginWorkflowKind, PluginWorkflowRecord } from './plugin';
import { getAbsenceTitle } from './Absences';
import { PageHeader, TableEmptyRow } from './components';
import { CheckCircleIcon, DownloadIcon, MailIcon, SearchIcon } from './icons';
import ForwardMailDialog from './ForwardMailDialog';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface PeriodRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  period_start: string;
}

interface ProjectPeriodRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  period_start: string;
  project_id: string;
  project_name: string;
  minutes: number;
}

/** One day of a working-time month (GET day-targets). */
interface DayRow {
  date: string;
  target: number;
  attended: number;
  absence: number;
  absenceType?: string;
  holidayInfo: { name?: string; key?: string } | null;
}

interface AbsenceRow {
  id: string;
  user_id: string;
  user_display_name: string;
  user_email: string;
  date_start: string;
  date_end: string;
  absence_type: string;
  half_day: boolean;
  document_id: string | null;
  /** Set when the vacation starts in the person's probation. */
  probation_until?: string | null;
}

interface AbsenceDocumentRow {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

function formatAbsenceType(type: string, t: TFunction): string {
  const key = `absences.type.${type}`;
  const translated = t(key);
  if (translated !== key) return translated;
  const spaced = type.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export type Scope = 'assigned' | 'mine';
const STATUS_FILTERS = ['pending', 'approved', 'rejected', 'all'] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
const STATUS_COLOR = { pending: 'warning', approved: 'success', rejected: 'error' } as const;

export interface ActionItem {
  id: string;
  source_table: string;
  source_table_uuid: string;
  step_status: 'pending' | 'approved' | 'rejected';
  workflow_data: { reason?: string; note?: string; decisionNote?: string | null };
  started: string | null;
  finished?: string | null;
  /** Who decides (on one's own requests). */
  assignee_name?: string | null;
  step?: string | null;
  step_number?: number | null;
  step_count?: number;
  step_action_key?: string | null;
  step_rejectable?: boolean;
  /** Rejecting sends it back to the person to change and submit again (a configurable workflow's `reject: back`). */
  step_returns?: boolean;
  step_in_dialog?: boolean;
  /** What the step asks whoever does it (a form step). */
  step_fields?: StepField[] | null;
  step_private_answers?: boolean;
  /** Several people got the step: one of them takes it over before acting. */
  step_take_over?: boolean;
  /** The caller took it over (and may give it back). */
  step_taken_by_me?: boolean;
  /** The step writes an e-mail first: done on the flow's page. */
  step_compose?: boolean;
  /** The caller submitted it. */
  is_own?: boolean;
  /** Where the list continues after this item (`before`, Flows -> Done "Load older"). */
  cursor?: string;
  /** False for an item recalled under "Done": the caller did a step of it, it waits with someone else now. */
  assigned_to_me?: boolean;
  /** What happened, oldest first (`key` is a text key: the core's or a plugin's). */
  history?: { key: string; by_name: string | null; at: string; note?: string | null }[];
  definition_name: string;
  source: string | null;
  source_name: string | null;
  timesheet_period: PeriodRow | null;
  absence: AbsenceRow | null;
  project_time_period: ProjectPeriodRow | null;
  /** A request with its own workflow (its subject is null when it is confidential). */
  flow?: { id: string; user_display_name: string; user_email: string; subject: string | null; flow_type: string | null } | null;
}

/** The plugin approval kind of an item (PLUGIN_WORKFLOW_KINDS) with its record, if it is one. */
function pluginRecord(item: ActionItem): { kind: PluginWorkflowKind; record: PluginWorkflowRecord } | null {
  for (const kind of PLUGIN_WORKFLOW_KINDS) {
    const record = (item as unknown as Record<string, unknown>)[kind.recordField];
    if (record && typeof record === 'object') return { kind, record: record as PluginWorkflowRecord };
  }
  return null;
}

export function actionItemLabel(definitionName: string, t: TFunction): string {
  const kind = PLUGIN_WORKFLOW_KINDS.find((k) => k.definitionName === definitionName);
  if (kind) return kind.label(t);
  if (definitionName === 'approve timesheet') return t('approvals.kind.timesheet');
  if (definitionName === 'reopen approved timesheet') return t('approvals.kind.reopen');
  if (definitionName === 'approve absence') return t('approvals.kind.absence');
  if (definitionName === 'approve project timesheet') return t('approvals.kind.projectTimesheet');
  // A request type's own workflow (`flow:<type>`).
  if (definitionName.startsWith('flow:')) return t('approvals.kind.flow');
  return definitionName;
}

function actionItemDetail(item: ActionItem): string {
  const text = item.workflow_data.reason || item.workflow_data.note || '';
  if (item.project_time_period) return [formatDurationMinutes(item.project_time_period.minutes), text].filter(Boolean).join(' · ');
  return text || '—';
}

/** The person an action item is about, whatever kind of record it is. */
export function itemPerson(item: ActionItem): { name: string; email: string } | null {
  const row = item.timesheet_period ?? pluginRecord(item)?.record ?? item.absence ?? item.project_time_period ?? item.flow;
  return row ? { name: row.user_display_name, email: row.user_email } : null;
}

const SOURCE_TITLE_FNS: Record<string, (item: ActionItem) => string | null> = {
  getSourceTitle: (item) => (item.timesheet_period ? getSourceTitle(item.timesheet_period.period_start) : null),
  getAbsenceTitle: (item) => (item.absence ? getAbsenceTitle(item.absence) : null),
  getFlowTitle: (item) => item.flow?.subject ?? null,
  getProjectTimesheetTitle: (item) =>
    item.project_time_period ? `${item.project_time_period.project_name} · ${getSourceTitle(item.project_time_period.period_start)}` : null,
};

/** The API's (English) source labels, shown in the user's language. Others are shown as they come. */
const SOURCE_KEYS: Record<string, string> = {
  'Vacation Request': 'approvals.source.absence',
  'Project time': 'approvals.source.projectTimesheet',
  'Timesheet Period': 'approvals.source.timesheet',
  Flow: 'approvals.source.flow',
};

export function correspondingObject(item: ActionItem, t: TFunction): string {
  if (!item.source) return '—';
  const plugin = pluginRecord(item);
  const pluginSource = PLUGIN_WORKFLOW_KINDS.find((k) => k.source?.name === item.source)?.source;
  const source = pluginSource ? pluginSource.label(t) : SOURCE_KEYS[item.source] ? t(SOURCE_KEYS[item.source]) : item.source;
  const fn = item.source_name ? SOURCE_TITLE_FNS[item.source_name] : undefined;
  const title = fn
    ? fn(item)
    : plugin && plugin.kind.title?.sourceName === item.source_name ? plugin.kind.title.get(plugin.record) : null;
  return title ? `${source} ${title}` : source;
}

interface ApprovalsProps {
  orgId: string;
  role: 'admin' | 'manager' | 'user';
  /** Decides on others' requests (managers, HR): opens on the inbox, else on one's own requests. */
  canDecide: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  onChanged?: () => void;
  /**
   * Shown inside the Flows page (Flows.tsx): no page header; a given scope or status is fixed (its selector hidden),
   * `statuses` limits the status selector, and items of `excludeSources` (e.g. requests, listed there on their own)
   * are left out.
   */
  embedded?: {
    scope?: Scope;
    status?: StatusFilter;
    statuses?: readonly StatusFilter[];
    excludeSources?: readonly string[];
    /** Only this item, without the filters (the Flows page's list is its own). */
    onlyId?: string;
  };
}

export default function Approvals({ orgId, role, canDecide, authHeaders, onChanged, embedded }: ApprovalsProps) {
  const { t, locale } = useI18n();
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [forwardingItem, setForwardingItem] = useState<ActionItem | null>(null);
  const [note, setNote] = useState('');
  // A form step being filled in (its item's id) and its answers.
  const [fillingId, setFillingId] = useState<string | null>(null);
  const [fillValues, setFillValues] = useState<StepValues>({});
  const stepFieldError = (code: string, field: StepField | undefined) =>
    t(`approvals.${code}`, { field: field ? stepFieldLabel(field, locale) : '' });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  /** The workflow definition shown, '' = all. */
  const [kind, setKind] = useState('');
  /** `assigned` = to decide (the inbox), `mine` = what one submitted. */
  const [chosenScope, setScope] = useState<Scope>(canDecide ? 'assigned' : 'mine');
  const [chosenStatus, setStatusFilter] = useState<StatusFilter>(embedded?.statuses?.[0] ?? 'pending');
  const scope = embedded?.scope ?? chosenScope;
  const statusFilter = embedded?.status ?? chosenStatus;
  const statusOptions = embedded?.statuses ?? STATUS_FILTERS;
  // The rights arrive after the first render: open on the inbox once they say the caller decides.
  useEffect(() => setScope(canDecide ? 'assigned' : 'mine'), [canDecide]);
  const decides = scope === 'assigned' && statusFilter === 'pending';
  /** The item's id when the caller decides it now (its dialogs then offer approve/reject), else null. */
  const decidable = (item: ActionItem) => (decides && item.step_status === 'pending' ? item.id : null);

  const [inspectingPeriod, setInspectingPeriod] = useState<PeriodRow | null>(null);
  const [inspectingActionItemId, setInspectingActionItemId] = useState<string | null>(null);
  const [inspectingEntries, setInspectingEntries] = useState<Entry[]>([]);
  const [inspectingLoading, setInspectingLoading] = useState(false);
  const [inspectingError, setInspectingError] = useState<string | null>(null);
  /** Set when the entries dialog shows one project's month rather than nothing. */
  const [inspectingProject, setInspectingProject] = useState<string | null>(null);

  const [inspectingMonth, setInspectingMonth] = useState<PeriodRow | null>(null);
  const [inspectingMonthItemId, setInspectingMonthItemId] = useState<string | null>(null);
  const [monthDays, setMonthDays] = useState<DayRow[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);
  const [monthError, setMonthError] = useState<string | null>(null);

  /** A plugin approval kind's Inspect dialog (PluginWorkflowKind.Inspect). */
  const [inspectingPlugin, setInspectingPlugin] = useState<{ kind: PluginWorkflowKind; record: PluginWorkflowRecord; actionItemId: string | null; step: ActionItem | null } | null>(null);

  const [inspectingAbsence, setInspectingAbsence] = useState<AbsenceRow | null>(null);
  const [absenceDocument, setAbsenceDocument] = useState<AbsenceDocumentRow | null>(null);
  const [absencePreviewUrl, setAbsencePreviewUrl] = useState<string | null>(null);

  useEffect(() => () => {
    if (absencePreviewUrl) URL.revokeObjectURL(absencePreviewUrl);
  }, [absencePreviewUrl]);

  function closeAbsenceDialog() {
    setInspectingAbsence(null);
    setAbsenceDocument(null);
    if (absencePreviewUrl) {
      URL.revokeObjectURL(absencePreviewUrl);
      setAbsencePreviewUrl(null);
    }
  }

  async function viewAbsenceDocument(absence: AbsenceRow) {
    setInspectingAbsence(absence);
    setAbsenceDocument(null);
    if (absencePreviewUrl) {
      URL.revokeObjectURL(absencePreviewUrl);
      setAbsencePreviewUrl(null);
    }
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API}/organizations/${orgId}/absences/${absence.id}/document`, { headers });
      const data: AbsenceDocumentRow | null = await res.json();
      if (data) {
        setAbsenceDocument(data);
        if (data.mime_type.startsWith('image/') || data.mime_type === 'application/pdf') {
          const fileRes = await fetch(`${API}/absences/${absence.id}/document`, { headers });
          const blob = await fileRes.blob();
          setAbsencePreviewUrl(URL.createObjectURL(blob));
        }
      }
    } catch { /* offline fallback */ }
  }

  async function downloadAbsenceDocument(absenceId: string, doc: AbsenceDocumentRow) {
    try {
      const res = await fetch(`${API}/absences/${absenceId}/document`, { headers: await authHeaders() });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.file_name;
      a.click();
      URL.revokeObjectURL(url);
    } catch { /* offline fallback */ }
  }

  /** A working-time month: the person's days with target, worked and difference. */
  async function inspect(period: PeriodRow, actionItemId: string | null) {
    setInspectingMonth(period);
    setInspectingMonthItemId(actionItemId);
    setMonthDays([]);
    setMonthLoading(true);
    setMonthError(null);
    try {
      const startDate = period.period_start.slice(0, 10);
      const [y, m] = startDate.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      const res = await fetch(`${API}/organizations/${orgId}/day-targets?userId=${period.user_id}&from=${startDate}&to=${lastDay}`, { headers: await authHeaders() });
      const data = await res.json();
      if (data?.ok === false) setMonthError(t('approvals.loadEntriesFailed'));
      setMonthDays(Array.isArray(data?.days) ? data.days : []);
    } catch {
      setMonthError(t('approvals.loadEntriesFailed'));
    } finally {
      setMonthLoading(false);
    }
  }

  /** A project month: that project's entries of the person in that month. */
  async function inspectProjectMonth(period: ProjectPeriodRow, actionItemId: string | null) {
    setInspectingPeriod({ id: period.id, user_id: period.user_id, user_display_name: period.user_display_name, user_email: period.user_email, period_start: period.period_start });
    setInspectingProject(period.project_name);
    setInspectingActionItemId(actionItemId);
    setInspectingEntries([]);
    setInspectingLoading(true);
    setInspectingError(null);
    try {
      const res = await fetch(`${API}/project-timesheets/${period.id}/entries`, { headers: await authHeaders() });
      const data = await res.json();
      if (data?.ok === false) setInspectingError(t('approvals.loadEntriesFailed'));
      setInspectingEntries(Array.isArray(data?.entries) ? data.entries.map((e: Entry) => ({ ...e, project_name: period.project_name })) : []);
    } catch {
      setInspectingError(t('approvals.loadEntriesFailed'));
    } finally {
      setInspectingLoading(false);
    }
  }

  async function reload() {
    setLoading(true);
    try {
      const headers = await authHeaders();
      // One item's card (Flows) asks for that item only, not the whole list it comes from.
      const only = embedded?.onlyId ? `&id=${encodeURIComponent(embedded.onlyId)}` : '';
      const i = await (await fetch(`${API}/workflows/assigned-to-me?scope=${scope}&status=${statusFilter}&orgId=${orgId}${only}`, { headers })).json();
      if (Array.isArray(i)) {
        setActionItems(i.filter((x: ActionItem) =>
          (!embedded?.onlyId || x.id === embedded.onlyId) && !embedded?.excludeSources?.includes(x.source_table)));
      }
    } catch { /* offline fallback */ } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, scope, statusFilter]);

  async function approveItem(id: string, values?: StepValues, fields?: StepField[]) {
    setError(null);
    setSuccess(null);
    // A form step: the answers, checked here first (the API checks them again).
    if (fields?.length) {
      const checked = stepFieldValues(fields, values ?? {});
      if (!checked.ok) { setError(stepFieldError(checked.error, fields.find((f) => f.key === checked.field))); return; }
    }
    try {
      const res = await fetch(`${API}/workflows/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(fields?.length ? { values } : {}),
      });
      const data = await res.json();
      if (!data.ok) {
        const field = fields?.find((f) => f.key === data.field);
        setError(data.error?.startsWith('step-field-') ? stepFieldError(data.error, field) : t('approvals.approveFailedWith', { error: data.error ?? t('common.unknownError') }));
        return;
      }
      setFillingId(null);
      setFillValues({});
      setSuccess(t('approvals.approved'));
      await reload();
      onChanged?.();
    } catch {
      setError(t('approvals.approveFailed'));
    }
  }

  /** Takes over (or gives back) a step several people got. */
  async function takeItem(id: string, release: boolean) {
    setError(null);
    try {
      const res = await fetch(`${API}/workflows/${id}/take`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(release ? { release: true } : {}),
      });
      const data = await res.json();
      if (!data?.ok) {
        const key = `flow.error.${data?.error}`;
        setError(t(key) === key ? t('flow.error.failed', { error: data?.error ?? t('common.unknownError') }) : t(key));
        return;
      }
      await reload();
    } catch {
      setError(t('common.cannotReachApi'));
    }
  }

  async function rejectItem(id: string) {
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`${API}/workflows/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ note }),
      });
      const data = await res.json();
      if (!data.ok) { setError(t('approvals.declineFailedWith', { error: data.error ?? t('common.unknownError') })); return; }
      setSuccess(t('approvals.declined'));
      setRejectingId(null);
      setNote('');
      await reload();
      onChanged?.();
    } catch {
      setError(t('approvals.declineFailed'));
    }
  }

  /** "Send by e-mail" (ForwardMailDialog): suggested to the person the item is about, e.g. as a reminder or a question. */
  function itemPersonId(item: ActionItem): string | null {
    return (item.timesheet_period ?? pluginRecord(item)?.record ?? item.absence ?? item.project_time_period)?.user_id ?? null;
  }

  function itemMessage(item: ActionItem): string {
    const person = itemPerson(item);
    const detail = actionItemDetail(item);
    return [
      t('approvals.mail.intro', { kind: actionItemLabel(item.definition_name, t), object: correspondingObject(item, t) }),
      person ? `${person.name} <${person.email}>` : '',
      detail !== '—' ? detail : '',
      item.started ? t('approvals.mail.since', { date: formatLocaleDate(item.started.slice(0, 10), locale) }) : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // The kinds (workflow definitions) in the inbox, by their label.
  const kinds = [...new Set(actionItems.map((i) => i.definition_name))].sort((a, b) => actionItemLabel(a, t).localeCompare(actionItemLabel(b, t)));
  // A kind that left the inbox (after a decision) no longer filters.
  const shownKind = kinds.includes(kind) ? kind : '';
  const filteredActionItems = actionItems.filter((item) => {
    if (shownKind && item.definition_name !== shownKind) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const haystack = [
      item.timesheet_period?.user_display_name,
      item.timesheet_period?.user_email,
      pluginRecord(item)?.record.user_display_name,
      pluginRecord(item)?.record.user_email,
      item.absence?.user_display_name,
      item.absence?.user_email,
      item.project_time_period?.user_display_name,
      item.project_time_period?.user_email,
      actionItemLabel(item.definition_name, t),
      correspondingObject(item, t),
      actionItemDetail(item),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  /** The parts of an item's row: the table's cells, or the card of one item (`embedded.onlyId`). */
  const itemParts = (item: ActionItem) => ({
    person: (
        <>
                      {scope === 'mine' ? (
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.assignee_name ?? '—'}</Typography>
                      ) : (
                        <>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>{itemPerson(item)?.name ?? '—'}</Typography>
                          <Typography variant="caption" color="text.secondary">{itemPerson(item)?.email ?? ''}</Typography>
                        </>
                      )}
        </>
      ),
    type: (
        <>
                      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                        <Chip label={actionItemLabel(item.definition_name, t)} size="small" variant="outlined" />
                        {statusFilter !== 'pending' && (
                          <Chip label={t(`approvals.status.${item.step_status}`)} size="small" color={STATUS_COLOR[item.step_status]} />
                        )}
                        {scope === 'assigned' && item.is_own && (
                          <Tooltip title={t('approvals.ownRequestHint')}>
                            <Chip label={t('approvals.ownRequest')} size="small" color="warning" variant="outlined" />
                          </Tooltip>
                        )}
                        {item.step_status === 'pending' && (item.step_count ?? 0) > 1 && item.step_number && (
                          <Chip label={t('approvals.stepOf', { n: String(item.step_number), count: String(item.step_count) })} size="small" />
                        )}
                      </Box>
        </>
      ),
    object: (
        <>
                      {correspondingObject(item, t)}
                      {item.absence && (
                        <Box sx={{ mt: 0.5, display: 'flex', gap: 0.5 }}>
                          <Chip label={formatAbsenceType(item.absence.absence_type, t)} size="small" variant="outlined" />
                          {item.absence.half_day && <Chip label={t('approvals.halfDay')} size="small" />}
                          {item.absence.probation_until && (
                            <Chip color="warning" label={t('approvals.probation', { date: item.absence.probation_until.split('-').reverse().join('.') })} size="small" />
                          )}
                        </Box>
                      )}
        </>
      ),
    details: (
        <>
                      {(item.history ?? []).length > 0 && actionItemDetail(item) === '—' ? null : actionItemDetail(item)}
                      {(item.history ?? []).length > 0 && (
                        <Box component="ul" sx={{ m: 0, mt: 0.5, p: 0, listStyle: 'none' }}>
                          {item.history!.map((e, i) => (
                            <Typography key={i} component="li" variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              {[formatLocaleDateTime(e.at, locale), t(e.key), e.by_name].filter(Boolean).join(' · ')}
                              {e.note ? ` – «${e.note}»` : ''}
                            </Typography>
                          ))}
                        </Box>
                      )}
        </>
      ),
    actions: (
        <>
                      {item.timesheet_period && (
                        <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => void inspect(item.timesheet_period!, decidable(item))}>{t('approvals.inspect')}</Button>
                      )}
                      {(() => {
                        const plugin = pluginRecord(item);
                        return plugin?.kind.Inspect ? (
                          <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => setInspectingPlugin({ ...plugin, actionItemId: decidable(item), step: item })}>{t('approvals.inspect')}</Button>
                        ) : null;
                      })()}
                      {item.project_time_period && (
                        <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => void inspectProjectMonth(item.project_time_period!, decidable(item))}>{t('approvals.inspect')}</Button>
                      )}
                      {item.absence?.document_id && (
                        <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => void viewAbsenceDocument(item.absence!)}>{t('approvals.documents')}</Button>
                      )}
                      {(() => {
                        // A kind done on its own page (PluginWorkflowKind.page): open the record there.
                        const page = pluginRecord(item)?.kind.page;
                        return page && (!page.ownOnly || item.is_own) ? (
                          <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => { window.location.hash = page.hash(item.source_table_uuid); }}>
                            {t('approvals.goToPage')}
                          </Button>
                        ) : null;
                      })()}
                      {item.flow && (
                        <Button size="small" variant="outlined" sx={{ mr: 1 }} onClick={() => { window.location.hash = `#/flows?id=${item.source_table_uuid}`; }}>
                          {t('approvals.goToFlow')}
                        </Button>
                      )}
                      {scope === 'assigned' && (
                        <Tooltip title={t('approvals.mail.hint')}>
                          <IconButton size="small" aria-label={t('approvals.mail')} sx={{ mr: 0.5 }} onClick={() => setForwardingItem(item)}>
                            <MailIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {/* Several people got it: one takes it over first; then its button (or give it back). */}
                      {decides && item.step_status === 'pending' && item.step_take_over && (
                        <Tooltip title={t('flow.workflow.takeFirst')}>
                          <Button size="small" variant="contained" sx={{ mr: 1 }} onClick={() => void takeItem(item.id, false)}>{t('flow.take')}</Button>
                        </Tooltip>
                      )}
                      {decides && item.step_status === 'pending' && item.step_taken_by_me && (
                        <Button size="small" sx={{ mr: 1 }} onClick={() => void takeItem(item.id, true)}>{t('flow.release')}</Button>
                      )}
                      {decides && item.step_status === 'pending' && !item.step_take_over && !item.step_compose && (() => {
                        const plugin = pluginRecord(item);
                        // A step done in the dialog (it shows what the step needs) opens it instead.
                        const act = item.step_in_dialog && plugin?.kind.Inspect
                          ? () => setInspectingPlugin({ ...plugin, actionItemId: item.id, step: item })
                          : item.step_fields?.length
                            ? () => { setFillingId(fillingId === item.id ? null : item.id); setFillValues({}); }
                            : () => void approveItem(item.id);
                        return (
                          <>
                            <Button size="small" variant="contained" sx={{ mr: 1 }} onClick={act}>{t(item.step_action_key ?? 'approvals.approve')}</Button>
                            {item.step_rejectable !== false && (
                              <Button size="small" color="error" onClick={() => setRejectingId(rejectingId === item.id ? null : item.id)}>{t(item.step_returns ? 'approvals.return' : 'approvals.reject')}</Button>
                            )}
                          </>
                        );
                      })()}
        </>
      ),
    fill: fillingId === item.id && item.step_fields?.length ? (
        <>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                          <StepFieldsForm fields={item.step_fields} values={fillValues} onChange={setFillValues} privateAnswers={item.step_private_answers} />
                          <Button size="small" variant="contained" onClick={() => void approveItem(item.id, fillValues, item.step_fields ?? undefined)}>{t('approvals.submitForm')}</Button>
                        </Box>
        </>
      ) : null,
    reject: rejectingId === item.id ? (
        <>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          <TextField size="small" label={t('approvals.note')} value={note} onChange={(e) => setNote(e.target.value)} fullWidth />
                          <Button size="small" color="error" variant="contained" onClick={() => void rejectItem(item.id)}>{t(item.step_returns ? 'approvals.confirmReturn' : 'approvals.confirmReject')}</Button>
                        </Box>
        </>
      ) : null,
  });

  // The dialogs (inspect a month, a plugin's record, forward by e-mail, ...), for the table and the card.
  const dialogs = (
    <>
      <Dialog open={!!inspectingMonth} onClose={() => setInspectingMonth(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {inspectingMonth
            ? t('approvals.reviewTimesheetFor', { name: inspectingMonth.user_display_name, period: periodLabel('month', inspectingMonth.period_start.slice(0, 10), locale) })
            : t('approvals.reviewTimesheet')}
        </DialogTitle>
        <DialogContent dividers>
          {monthError && <Alert severity="error" sx={{ mb: 2 }}>{monthError}</Alert>}
          {monthLoading && <LinearProgress sx={{ mb: 2 }} />}
          {inspectingMonth && (() => {
            const target = monthDays.reduce((sum, d) => sum + d.target, 0);
            const worked = monthDays.reduce((sum, d) => sum + d.attended, 0);
            return (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>{inspectingMonth.user_email}</Typography>
                <Chip label={`${t('timesheet.target')}: ${formatDurationMinutes(target)}`} variant="outlined" />
                <Chip label={`${t('timesheet.workHours')}: ${formatDurationMinutes(worked)}`} variant="outlined" />
                <Chip label={`${t('timesheet.difference')}: ${formatSignedMinutes(worked - target)}`} color={worked - target < 0 ? 'error' : 'success'} variant="outlined" />
              </Box>
            );
          })()}
          <TableContainer sx={{ maxHeight: 480 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>{t('timesheet.day')}</TableCell>
                  <TableCell align="right">{t('timesheet.target')}</TableCell>
                  <TableCell align="right">{t('timesheet.workHours')}</TableCell>
                  <TableCell align="right">{t('timesheet.difference')}</TableCell>
                  <TableCell>{t('timesheet.dayNote')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {monthDays.map((d) => {
                  const [y, m, dd] = d.date.split('-').map(Number);
                  const note = [d.holidayInfo?.name ?? '', d.absence > 0 && d.absenceType ? formatAbsenceType(d.absenceType, t) : ''].filter(Boolean).join(' · ');
                  return (
                    <TableRow key={d.date} sx={{ opacity: d.target === 0 && d.attended === 0 ? 0.5 : 1 }}>
                      <TableCell>{new Date(y, m - 1, dd).toLocaleDateString(swissLocale(locale), { weekday: 'short', day: 'numeric', month: 'short' })}</TableCell>
                      <TableCell align="right">{d.target ? formatDurationMinutes(d.target) : '—'}</TableCell>
                      <TableCell align="right">{d.attended ? formatDurationMinutes(d.attended) : '—'}</TableCell>
                      <TableCell align="right" sx={{ color: d.attended - d.target < 0 ? 'error.main' : undefined }}>
                        {d.target || d.attended ? formatSignedMinutes(d.attended - d.target) : ''}
                      </TableCell>
                      <TableCell>{note}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingMonth(null)}>{t('common.close')}</Button>
          {inspectingMonthItemId && (
            <>
              <Button
                color="error"
                onClick={() => {
                  const id = inspectingMonthItemId;
                  setInspectingMonth(null);
                  setRejectingId(id);
                }}
              >
                {t('approvals.reject')}…
              </Button>
              <Button
                variant="contained"
                onClick={async () => {
                  const id = inspectingMonthItemId;
                  setInspectingMonth(null);
                  await approveItem(id);
                }}
              >
                {t('approvals.approve')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      <Dialog open={!!inspectingPeriod} onClose={() => setInspectingPeriod(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {inspectingPeriod
            ? t('approvals.reviewProjectTimeFor', {
                name: inspectingPeriod.user_display_name,
                project: inspectingProject ?? '',
                period: periodLabel('month', inspectingPeriod.period_start.slice(0, 10), locale),
              })
            : t('approvals.reviewTimesheet')}
        </DialogTitle>
        <DialogContent dividers>
          {inspectingError && <Alert severity="error" sx={{ mb: 2 }}>{inspectingError}</Alert>}
          {inspectingLoading && <LinearProgress sx={{ mb: 2 }} />}
          {inspectingPeriod && (
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {inspectingPeriod.user_email}
              </Typography>
              <Chip
                label={`${t('approvals.total')}: ${formatDurationMinutes(inspectingEntries.reduce((sum, e) => sum + minutes(e), 0))}`}
                color="primary"
                variant="outlined"
              />
            </Box>
          )}
          {inspectingEntries.length === 0 && !inspectingLoading ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('approvals.noEntries')}</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common.date')}</TableCell>
                    <TableCell>{t('time.time')}</TableCell>
                    <TableCell align="right">{t('approvals.duration')}</TableCell>
                    <TableCell>{t('common.project')}</TableCell>
                    <TableCell>{t('common.subproject')}</TableCell>
                    <TableCell>{t('common.comment')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {inspectingEntries.map((e) => {
                    const startTime = new Date(e.start_time).toLocaleTimeString(swissLocale(locale), { hour: '2-digit', minute: '2-digit' });
                    const endTime = new Date(e.end_time).toLocaleTimeString(swissLocale(locale), { hour: '2-digit', minute: '2-digit' });
                    return (
                      <TableRow key={e.id}>
                        <TableCell>{new Date(e.start_time).toLocaleDateString(swissLocale(locale))}</TableCell>
                        <TableCell>{`${startTime} – ${endTime}`}</TableCell>
                        <TableCell align="right">{formatDurationMinutes(minutes(e))}</TableCell>
                        <TableCell>{e.project_name ?? '—'}</TableCell>
                        <TableCell>{e.subproject_name ?? '—'}</TableCell>
                        <TableCell>{e.comment ?? '—'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInspectingPeriod(null)}>{t('common.close')}</Button>
          {inspectingActionItemId && (
            <>
              <Button
                color="error"
                onClick={() => {
                  const id = inspectingActionItemId;
                  setInspectingPeriod(null);
                  setRejectingId(id);
                }}
              >
                {t('approvals.reject')}…
              </Button>
              <Button
                variant="contained"
                onClick={async () => {
                  const id = inspectingActionItemId;
                  setInspectingPeriod(null);
                  await approveItem(id);
                }}
              >
                {t('approvals.approve')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>

      {inspectingPlugin?.kind.Inspect && (
        <inspectingPlugin.kind.Inspect
          open
          orgId={orgId}
          authHeaders={authHeaders}
          record={inspectingPlugin.record}
          actionItemId={inspectingPlugin.actionItemId}
          step={inspectingPlugin.step?.step ? { key: inspectingPlugin.step.step, actionKey: inspectingPlugin.step.step_action_key ?? null, rejectable: inspectingPlugin.step.step_rejectable !== false } : null}
          onClose={() => setInspectingPlugin(null)}
          onApprove={(id) => {
            setInspectingPlugin(null);
            void approveItem(id);
          }}
          onReject={(id) => {
            setInspectingPlugin(null);
            setRejectingId(id);
          }}
        />
      )}

      <Dialog open={!!inspectingAbsence} onClose={closeAbsenceDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {inspectingAbsence ? t('approvals.evidenceFor', { name: inspectingAbsence.user_display_name }) : t('approvals.evidence')}
        </DialogTitle>
        <DialogContent dividers>
          {absenceDocument ? (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{absenceDocument.file_name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('absences.fileSize', { size: formatFileSize(absenceDocument.size_bytes, locale) })} · {new Date(absenceDocument.created_at).toLocaleString(swissLocale(locale))}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<DownloadIcon fontSize="small" />}
                  onClick={() => inspectingAbsence && void downloadAbsenceDocument(inspectingAbsence.id, absenceDocument)}
                >
                  {t('approvals.download')}
                </Button>
              </Box>
              {absencePreviewUrl && absenceDocument.mime_type.startsWith('image/') && (
                <Box component="img" src={absencePreviewUrl} alt={absenceDocument.file_name} sx={{ maxWidth: '100%', maxHeight: 360, objectFit: 'contain', borderRadius: 1 }} />
              )}
              {absencePreviewUrl && absenceDocument.mime_type === 'application/pdf' && (
                <Box component="iframe" src={absencePreviewUrl} title={absenceDocument.file_name} sx={{ width: '100%', height: 380, border: 1, borderColor: 'divider', borderRadius: 1 }} />
              )}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>{t('approvals.noDocument')}</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeAbsenceDialog}>{t('common.close')}</Button>
        </DialogActions>
      </Dialog>
      {forwardingItem && (
        <ForwardMailDialog
          open
          onClose={() => setForwardingItem(null)}
          onSent={(count) => setSuccess(t('mail.sent', { count: String(count) }))}
          orgId={orgId}
          endpoint={`/workflows/${forwardingItem.id}/forward`}
          suggested={
            itemPersonId(forwardingItem) && itemPerson(forwardingItem)
              ? [{ id: itemPersonId(forwardingItem) as string, name: itemPerson(forwardingItem)!.name, email: itemPerson(forwardingItem)!.email }]
              : []
          }
          defaultSubject={t('approvals.mail.subject', { kind: actionItemLabel(forwardingItem.definition_name, t), object: correspondingObject(forwardingItem, t) })}
          defaultMessage={itemMessage(forwardingItem)}
          authHeaders={authHeaders}
        />
      )}
    </>
  );

  // One item as a card (the Flows page's detail): the same parts as a row, one under the other.
  if (embedded?.onlyId) {
    const item = actionItems[0];
    if (!item) return loading ? <LinearProgress /> : <Paper variant="outlined" sx={{ p: 2 }}><Typography color="text.secondary">{t('approvals.nothingFound')}</Typography></Paper>;
    const part = itemParts(item);
    return (
      <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1.5, minWidth: 0 }}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
        <Box>
          <Typography variant="h6" sx={{ fontSize: '1.1rem', overflowWrap: 'anywhere' }}>{part.object}</Typography>
          <Box sx={{ mt: 0.5 }}>{part.person}</Box>
        </Box>
        {part.type}
        <Box sx={{ color: 'text.secondary' }}>{part.details}</Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', '& .MuiButton-root': { mr: 0 } }}>{part.actions}</Box>
        {part.fill}
        {part.reject}
        {dialogs}
      </Paper>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {!embedded && <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />}

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {success && <Alert severity="success" onClose={() => setSuccess(null)}>{success}</Alert>}
      {loading && <LinearProgress />}

      <Paper sx={{ p: 2 }}>
        {!embedded?.onlyId && <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {search.trim() || shownKind
              ? t('approvals.actionItemsFiltered', { count: filteredActionItems.length, total: actionItems.length })
              : t(decides ? 'approvals.actionItems' : 'approvals.items', { count: filteredActionItems.length })}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', flex: { xs: '1 1 100%', sm: '0 1 auto' } }}>
          {!embedded?.scope && (
            <TextField select size="small" label={t('approvals.view')} value={scope} onChange={(e) => setScope(e.target.value as Scope)} sx={{ minWidth: { xs: '100%', sm: 190 } }}>
              <MenuItem value="assigned">{t('approvals.view.assigned')}</MenuItem>
              <MenuItem value="mine">{t('approvals.view.mine')}</MenuItem>
            </TextField>
          )}
          {!embedded?.status && (
            <TextField select size="small" label={t('approvals.status')} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} sx={{ minWidth: { xs: '100%', sm: 150 } }}>
              {statusOptions.map((s) => <MenuItem key={s} value={s}>{t(`approvals.status.${s}`)}</MenuItem>)}
            </TextField>
          )}
          <TextField
            select
            size="small"
            label={t('approvals.col.type')}
            value={shownKind}
            onChange={(e) => setKind(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 220 } }}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value="">{t('approvals.allTypes')}</MenuItem>
            {kinds.map((k) => (
              <MenuItem key={k} value={k}>{actionItemLabel(k, t)}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            placeholder={t('approvals.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: 300 } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" color="action" />
                  </InputAdornment>
                ),
              },
            }}
          />
          </Box>
        </Box>}

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{scope === 'mine' ? t('approvals.col.assignee') : t('teamHours.member')}</TableCell>
                <TableCell>{t('approvals.col.type')}</TableCell>
                <TableCell>{t('approvals.col.object')}</TableCell>
                <TableCell>{t('audit.col.details')}</TableCell>
                <TableCell align="right">{t('common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredActionItems.map((item) => {
                const part = itemParts(item);
                return (
                <Fragment key={item.id}>
                  <TableRow hover>
                    <TableCell>{part.person}</TableCell>
                    <TableCell>{part.type}</TableCell>
                    <TableCell>{part.object}</TableCell>
                    <TableCell>{part.details}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{part.actions}</TableCell>
                  </TableRow>
                  {part.fill && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ bgcolor: 'action.hover' }}>{part.fill}</TableCell>
                    </TableRow>
                  )}
                  {part.reject && (
                    <TableRow>
                      <TableCell colSpan={5} sx={{ bgcolor: 'action.hover' }}>{part.reject}</TableCell>
                    </TableRow>
                  )}
                </Fragment>
                );
              })}
              {filteredActionItems.length === 0 && (
                <TableEmptyRow
                  colSpan={5}
                  icon={<CheckCircleIcon fontSize="inherit" />}
                  title={actionItems.length > 0 ? t('approvals.noMatch') : decides ? t('approvals.nothingPending') : t('approvals.nothingFound')}
                />
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {dialogs}
    </Box>
  );
}
