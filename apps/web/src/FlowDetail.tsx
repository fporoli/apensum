import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Badge,
  Box,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Link,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  Tab,
  Tabs,
  TextField,
  Typography,
  Tooltip,
} from '@mui/material';
import { Button } from './Button';
import { useI18n } from './i18n';
import { stepFieldLabel, stepFieldValues, type StepField } from '@worktime3/shared/workflowConfig';
import { StepAnswers, StepFieldsForm, type StepAnswer, type StepValues } from './StepFieldsForm';
import { formatLocaleNumber } from './localeFormat';
import { EmptyState, PageHeader } from './components';
import { AddIcon, CheckCircleIcon, ChevronLeftIcon, ChevronRightIcon, EditIcon, LockIcon, MailIcon, PublicIcon, RestartAltIcon, ScheduleIcon, SendIcon, InboxIcon, ArchiveIcon } from './icons';
import { stepProgress, type StepState } from './flowSteps';
import { cleanDueDate, cleanFlowLink, flowTypeConfidential, flowTypeLabel, flowTypeOptions } from '@worktime3/shared/flows';
import { FLOW_FORM, flowTypeForm } from '@worktime3/shared/fields';
import { useFormTemplate, type FormTemplate } from './designMode';
import { FlowCustomFields, checkFlowCustomAll, hasCustomValues } from './FlowCustomFields';
import ForwardMailDialog, { type Recipient } from './ForwardMailDialog';
import { formatLocaleDate, formatLocaleDateTime, formatRelativeTime } from './localeFormat';
import { AttachmentView, DropZone, useAttachmentDraft, type Attachment } from './attachments';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

export type Box_ = 'mine' | 'inbox' | 'archived';
export type Status = 'open' | 'in_progress' | 'resolved';

export interface FlowItem {
  id: string;
  subject: string;
  status: Status;
  flow_type: string | null;
  urgent: boolean;
  link_url: string | null;
  target_kind: 'manager' | 'department' | 'workflow' | 'person';
  department_name: string | null;
  /** Null for a task a module or plugin opened (`source`). */
  requester_user_id: string | null;
  requester_name: string | null;
  requester_email: string | null;
  due_date: string | null;
  /** The module or plugin that opened it, and the page it is about. */
  source: string | null;
  source_section: string | null;
  /** Whom the flow is about (who started it, or whom a task is about): its page opens them. */
  about_user_id?: string | null;
  overdue: boolean;
  /** Only the requester and the handlers see it (its type is confidential). */
  confidential: boolean;
  /** The organization's own fields (form `request`). */
  custom: Record<string, unknown> | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  opened_at: string;
  last_activity_at: string;
  resolved_at: string | null;
  archived_at: string | null;
  message_count: number;
}

interface Message {
  id: string;
  kind: 'message' | 'event';
  body: string | null;
  data: {
    status?: Status;
    archived?: boolean;
    assignee?: string | null;
    details?: { flow_type?: string | null; urgent?: boolean; link_url?: string | null; due_date?: string | null; subject?: string };
    obsolete?: boolean;
    /** A workflow request's step (request-workflow.ts threadEvent). */
    workflow?: 'approved' | 'done' | 'returned' | 'finished' | 'resubmitted' | 'withdrawn' | 'mailed' | 'composed' | 'taken' | 'released';
    step?: StepLabel;
    automatic?: boolean;
    note?: string;
    /** A form step's answers (request-workflow.ts threadEvent); left out for others when `private`. */
    values?: StepAnswer[];
    /** The answers are for the requester only. */
    private?: boolean;
  };
  posted_at: string;
  author_user_id: string | null;
  author_name: string | null;
  attachments: Attachment[];
}

/** A workflow step's name: English, and per language when the configuration gives it. */
interface StepLabel {
  key: string;
  label: string;
  labels?: Record<string, string> | null;
  /** Its blocks, for its name when it has none of its own. */
  blocks?: string[] | null;
}

/** A workflow request's workflow (GET requests/:id `workflow`). */
interface FlowStepsInfo {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  step: string;
  steps: StepLabel[];
  waitingFor: string[];
  canDecide: boolean;
  returns: boolean;
  actionKey: string | null;
  returned: boolean;
  /** What the pending step asks whoever does it (a form step). */
  fields?: StepField[] | null;
  privateAnswers?: boolean;
  /** Every assignee does it on their own. */
  each?: boolean;
  /** Several people got the step: the caller (one of them) takes it over before acting. */
  takeOver?: boolean;
  /** The caller took the step over (and may give it back). */
  takenByMe?: boolean;
  /** The step writes an e-mail first (its dialog), and whether it went out. */
  compose?: boolean;
  composed?: boolean;
}

/** A step's name: its own in the reader's language, else (no name given) its blocks' names translated, else as stored. */
const stepName = (s: StepLabel | undefined, locale: string, t: (key: string) => string) => {
  if (!s) return '';
  if (s.labels && Object.keys(s.labels).length) return s.labels[locale] ?? s.label;
  if (s.blocks?.length) return s.blocks.map((b) => { const key = `workflowDesigner.block.${b}`; const text = t(key); return text === key ? b : text; }).join(' + ');
  return s.label;
};

/** A request type's own form (`flow.<type>`): its fields come after every request's. */
function useFlowTypeTemplate(orgId: string, type: string | null | undefined, authHeaders: () => Promise<Record<string, string>>): FormTemplate {
  const def = useMemo(() => flowTypeForm(type || '_none') ?? flowTypeForm('_none')!, [type]);
  return useFormTemplate(orgId, def, authHeaders);
}

interface Detail {
  flow: FlowItem;
  messages: Message[];
  handlers: { id: string; name: string; email: string }[];
  isRequester: boolean;
  isHandler: boolean;
  workflow: FlowStepsInfo | null;
}

/** The org's flow_type static_data row (its own copy, else the global one). */
interface TypeRow {
  values: Record<string, unknown>;
  translation: Record<string, Record<string, string>>;
}

/** Type, urgency and link as the forms edit them. */
interface DetailsDraft {
  type: string;
  urgent: boolean;
  /** Marked confidential by the requester (new flows only: once confidential, a flow stays so). */
  confidential?: boolean;
  link: string;
  /** YYYY-MM-DD or empty. */
  due: string;
}

const EMPTY_DETAILS: DetailsDraft = { type: '', urgent: false, link: '', due: '' };

/** What the new-flow dialog opens with (the Flows page's menu): a type (with its own steps), or a free flow's target. */
export interface ComposePreset {
  type?: string;
  /** A Free Flow: a type without set steps is preselected; the person picks whom it goes to. */
  free?: boolean;
  target?: 'manager' | 'department';
}

export interface Targets {
  manager: { id: string; name: string } | null;
  departments: { id: string; name: string }[];
  /** Request types with their own workflow, and its steps (`conditional`: only when its condition holds). */
  workflows?: Record<string, (StepLabel & { conditional?: boolean })[]>;
}

/** A message's body: multipart when files are attached (the API reads them from `files`), else JSON. */
function messageBody(fields: Record<string, string | undefined>, files: File[]): { body: BodyInit; headers: Record<string, string> } {
  if (files.length === 0) return { body: JSON.stringify(fields), headers: { 'Content-Type': 'application/json' } };
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) form.append(k, v);
  for (const f of files) form.append('files', f, f.name);
  return { body: form, headers: {} };
}

const STATUS_COLOR: Record<Status, 'warning' | 'info' | 'success'> = { open: 'warning', in_progress: 'info', resolved: 'success' };

interface FlowDetailProps {
  orgId: string;
  userId: string | null;
  authHeaders: () => Promise<Record<string, string>>;
  /** A request to open, e.g. from a notification. */
  focusId?: string | null;
  /** Changes when a notification arrives, so the open lists and thread reload. */
  refreshKey?: unknown;
  /** After a change, so the navbar badge can refresh. */
  onChanged?: () => void;
  /** Opens another page by its section id (a task's source page). */
  navigate?: (section: string, query?: string) => void;
  /**
   * Shown inside the Flows page (Flows.tsx): its box is fixed (no header or tabs), a change of `composeSignal` opens
   * the new-flow dialog, and `onCreated` gets the new one (the page then shows it among one's own).
   */
  embedded?: {
    box: Box_;
    composeSignal?: number;
    /** What the new-flow dialog opens with: a type, or a free flow's target. */
    composePreset?: ComposePreset;
    onCreated?: (id: string) => void;
    /** Only the thread of `focusId` (the Flows page's list is its own); `onBack` closes it on a phone. */
    detailOnly?: boolean;
    onBack?: () => void;
    /** Only the design-mode panel of the request forms (nothing when design mode is off). */
    designOnly?: boolean;
  };
}

/**
 * Requests: tickets to one's line manager or a department (HR, ...), each with a message thread.
 * "My requests" lists the caller's own, "Inbox" those they handle (as manager or department
 * member), "Archived" the archived ones of both. Handlers take a request, answer, set its status
 * and archive it; every change notifies the other side.
 */
export default function FlowDetail({ orgId, userId, authHeaders, focusId, refreshKey, onChanged, navigate, embedded }: FlowDetailProps) {
  const { t, locale } = useI18n();
  const [chosenBox, setBox] = useState<Box_>('mine');
  const box = embedded?.box ?? chosenBox;
  const [items, setItems] = useState<FlowItem[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  // The e-mail a step writes (block "Write an e-mail"): its draft from the step's template, while its dialog is open.
  const [composing, setComposing] = useState<{ subject: string; text: string; to: Recipient[]; suggested: Recipient[] } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  // The Flows page's "New flow" button.
  useEffect(() => { if (embedded?.composeSignal) setComposeOpen(true); }, [embedded?.composeSignal]);
  const [editingDetails, setEditingDetails] = useState(false);
  const [types, setTypes] = useState<TypeRow>({ values: {}, translation: {} });
  const replyFiles = useAttachmentDraft(setError);
  const template = useFormTemplate(orgId, FLOW_FORM, authHeaders);
  // The shown request's type's own fields, and in design mode the form chosen to design (every request's or a type's).
  const [designType, setDesignType] = useState('');
  const designTypeTemplate = useFlowTypeTemplate(orgId, designType, authHeaders);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/static-data/flows`, { headers: await authHeaders() });
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows.find((x: { enum_name?: string }) => x.enum_name === 'flow_type') : null;
        if (!cancelled) setTypes({ values: row?.values ?? {}, translation: row?.translation ?? {} });
      } catch {
        /* no types: the forms just don't show the field */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, authHeaders]);

  const typeLabel = (key: string | null | undefined) => (key ? flowTypeLabel(types.translation, locale, key) : '');

  const errorText = useCallback(
    (code: string | undefined) => {
      const key = `flow.error.${code}`;
      const text = t(key);
      return text === key ? t('flow.error.failed', { error: code ?? t('common.unknownError') }) : text;
    },
    [t],
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const [list, summary] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/flows?box=${box}`, { headers }).then((r) => r.json()),
        fetch(`${API}/organizations/${orgId}/flows/summary`, { headers }).then((r) => r.json()),
      ]);
      setItems(Array.isArray(list?.flows) ? list.flows : []);
      setInboxCount(typeof summary?.inbox === 'number' ? summary.inbox : 0);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  }, [authHeaders, orgId, box, t]);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/flows/${id}`, { headers: await authHeaders() });
        const data = await res.json();
        if (data?.ok && data.flow) setDetail(data as Detail);
        else {
          setDetail(null);
          setError(errorText(data?.error));
        }
      } catch {
        setError(t('common.cannotReachApi'));
      }
    },
    [authHeaders, orgId, errorText, t],
  );

  useEffect(() => {
    if (embedded?.designOnly) return;
    void loadList();
    // refreshKey: a notification arrived.
  }, [loadList, refreshKey, embedded?.designOnly]);

  useEffect(() => {
    if (focusId) setSelectedId(focusId);
  }, [focusId]);

  // A draft belongs to the request it was written for.
  useEffect(() => {
    setReply('');
    replyFiles.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail, refreshKey]);

  /** Takes over (or gives back) the step several people got (the Workflow page's endpoint). */
  async function takeStep(workflowId: string, release: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/workflows/${workflowId}/take`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify(release ? { release: true } : {}),
      });
      const data = await res.json();
      if (!data?.ok) { setError(errorText(data?.error)); return; }
      if (selectedId) await loadDetail(selectedId);
      await loadList();
      onChanged?.();
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  /** Opens the step's e-mail: its draft (the template filled, to whom the step names). */
  async function openCompose(flowId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/flows/${flowId}/compose`, { headers: await authHeaders() });
      const data = await res.json();
      if (!data?.ok) { setError(errorText(data?.error)); return; }
      setComposing({ subject: data.subject ?? '', text: data.text ?? '', to: data.to ?? [], suggested: data.suggested ?? [] });
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  /** Approves (or sends back) the step of a workflow request the caller decides (the Workflow page's endpoints). */
  async function decide(workflowId: string, what: 'approve' | 'reject', note: string, values?: StepValues, fields?: StepField[] | null): Promise<boolean> {
    const stepFieldError = (code: string, key: string | undefined) => {
      const f = fields?.find((x) => x.key === key);
      return t(`approvals.${code}`, { field: f ? stepFieldLabel(f, locale) : '' });
    };
    // A form step: the answers, checked here first (the API checks them again).
    if (what === 'approve' && fields?.length) {
      const checked = stepFieldValues(fields, values ?? {});
      if (!checked.ok) { setError(stepFieldError(checked.error, checked.field)); return false; }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/workflows/${workflowId}/${what}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ ...(note.trim() ? { note: note.trim() } : {}), ...(what === 'approve' && fields?.length ? { values } : {}) }),
      });
      const data = await res.json();
      if (!data?.ok) {
        setError(String(data?.error ?? '').startsWith('step-field-') ? stepFieldError(data.error, data.field) : errorText(data?.error));
        return false;
      }
      if (selectedId) await loadDetail(selectedId);
      await loadList();
      onChanged?.();
      return true;
    } catch {
      setError(t('common.cannotReachApi'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function post(path: string, fields: Record<string, unknown>, files: File[] = []): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const payload = files.length
        ? messageBody(fields as Record<string, string | undefined>, files)
        : { body: JSON.stringify(fields), headers: { 'Content-Type': 'application/json' } };
      const res = await fetch(`${API}/organizations/${orgId}/flows${path}`, {
        method: 'POST',
        headers: { ...payload.headers, ...(await authHeaders()) },
        body: payload.body,
      });
      if (res.status === 413) {
        setError(t('attachments.rejected'));
        return false;
      }
      const data = await res.json();
      if (!data?.ok) {
        setError(errorText(data?.error));
        return false;
      }
      await loadList();
      if (selectedId) await loadDetail(selectedId);
      onChanged?.();
      return true;
    } catch {
      setError(t('common.cannotReachApi'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (!detail || (!reply.trim() && replyFiles.files.length === 0)) return;
    if (await post(`/${detail.flow.id}/messages`, { body: reply }, replyFiles.files)) {
      setReply('');
      replyFiles.clear();
    }
  }

  const r = detail?.flow;
  const target = (item: FlowItem) =>
    item.target_kind === 'workflow' ? t('flow.toWorkflow')
      // A task a trigger opened (nobody started it): the manager of, or the person it is about.
      : item.target_kind === 'manager' ? t(item.requester_user_id ? 'flow.toManager' : 'flow.toAboutManager')
        : item.target_kind === 'person' ? t('flow.toAboutPerson') : t('flow.toDepartment', { department: item.department_name ?? '' });
  /** A module's or plugin's name (its `modules.<id>` text), for the tasks it opens. */
  const sourceLabel = (source: string | null) => {
    if (!source) return t('flow.system');
    if (source === 'trigger') return t('flowTriggers.sender');
    const label = t(`modules.${source}`);
    return label === `modules.${source}` ? source : label;
  };
  const sender = (item: FlowItem) => item.requester_name ?? item.requester_email ?? sourceLabel(item.source);
  const dueChip = (item: FlowItem) =>
    item.due_date && item.status !== 'resolved' ? (
      <Chip
        size="small"
        color={item.overdue ? 'error' : 'default'}
        variant={item.overdue ? 'filled' : 'outlined'}
        label={t(item.overdue ? 'flow.overdueSince' : 'flow.dueOn', { date: formatLocaleDate(item.due_date, locale) })}
      />
    ) : null;

  /** A message's author: the person, or the module or plugin that opened the task. */
  const authorOf = (m: Message) => m.author_name ?? (m.author_user_id === null && r?.source ? sourceLabel(r.source) : t('flow.someone'));

  function eventText(m: Message): string {
    const who = authorOf(m);
    if (m.data.workflow) {
      const step = stepName(m.data.step, locale, t);
      const text = m.data.automatic
        ? t('flow.event.workflow.automatic', { step })
        : t(`flow.event.workflow.${m.data.workflow}`, { who, step });
      return m.data.note ? `${text}: ${m.data.note}` : text;
    }
    if (m.data.obsolete) return t('flow.event.obsolete', { who });
    if (m.data.details) {
      const d = m.data.details;
      if (d.due_date !== undefined && Object.keys(d).every((k) => k === 'due_date' || k === 'subject')) {
        return d.due_date ? t('flow.event.due', { who, date: formatLocaleDate(d.due_date, locale) }) : t('flow.event.noDue', { who });
      }
      if (Object.keys(d).length === 1 && d.urgent !== undefined) return t(d.urgent ? 'flow.event.urgent' : 'flow.event.notUrgent', { who });
      return t('flow.event.details', { who });
    }
    if (m.data.archived === true) return t('flow.event.archived', { who });
    if (m.data.archived === false) return t('flow.event.unarchived', { who });
    if (m.data.assignee !== undefined) return m.data.assignee ? t('flow.event.took', { who }) : t('flow.event.released', { who });
    if (m.data.status) return t('flow.event.status', { who, status: t(`flow.status.${m.data.status}`) });
    return who;
  }

  const list = (
    <Paper variant="outlined" sx={{ minWidth: 0 }}>
      {loading && <LinearProgress />}
      {items.length === 0 && !loading ? (
        <EmptyState icon={<MailIcon fontSize="inherit" />} title={t(`flow.empty.${box}`)} />
      ) : (
        <List disablePadding>
          {items.map((item, i) => (
            <Box key={item.id}>
              {i > 0 && <Divider component="li" />}
              <ListItemButton selected={item.id === selectedId} onClick={() => setSelectedId(item.id)} sx={{ alignItems: 'flex-start', gap: 1 }}>
                <ListItemText
                  primary={item.subject}
                  primaryTypographyProps={{ noWrap: true, fontWeight: 600 }}
                  secondary={
                    <>
                      {item.flow_type ? `${typeLabel(item.flow_type)} · ` : ''}
                      {box === 'mine' ? target(item) : `${sender(item)} · ${target(item)}`}
                      <br />
                      {formatRelativeTime(item.last_activity_at, locale)}
                      {item.assignee_name ? ` · ${t('flow.handledBy', { name: item.assignee_name })}` : ''}
                    </>
                  }
                />
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
                  <Chip size="small" color={STATUS_COLOR[item.status]} label={t(`flow.status.${item.status}`)} />
                  {item.urgent && item.status !== 'resolved' && <Chip size="small" color="error" variant="outlined" label={t('flow.urgent')} />}
                  {dueChip(item)}
                  {item.confidential && <LockIcon fontSize="small" color="action" titleAccess={t('flow.confidential')} />}
                </Box>
              </ListItemButton>
            </Box>
          ))}
        </List>
      )}
    </Paper>
  );

  /**
   * "Send by e-mail": the server mails it (ForwardMailDialog). Suggested: the other side (the handlers
   * when the caller sent it, else the requester); the message holds the thread's latest messages.
   */
  function forwardSuggested(req: FlowItem, d: Detail): Recipient[] {
    return d.isRequester
      ? d.handlers.filter((h) => h.id !== userId).map((h) => ({ id: h.id, name: h.name, email: h.email }))
      : req.requester_user_id && req.requester_email
        ? [{ id: req.requester_user_id, name: req.requester_name ?? req.requester_email, email: req.requester_email }]
        : [];
  }

  function forwardMessage(req: FlowItem, d: Detail): string {
    const messages = d.messages
      .filter((m) => m.kind === 'message')
      .slice(-3)
      .map((m) => {
        const files = m.attachments.length ? `\n📎 ${m.attachments.map((f) => f.file_name).join(', ')}` : '';
        return `${m.author_name ?? '—'} · ${formatLocaleDateTime(m.posted_at, locale)}\n${m.body ?? ''}${files}`.trim();
      });
    return [
      t('flow.mail.intro', { subject: req.subject }),
      [
        t('flow.from', { name: sender(req) }),
        target(req),
        req.due_date ? t('flow.dueOn', { date: formatLocaleDate(req.due_date, locale) }) : null,
        req.flow_type ? typeLabel(req.flow_type) : null,
        req.urgent ? t('flow.urgent') : null,
        t(`flow.status.${req.status}`),
      ].filter(Boolean).join(' · '),
      ...(req.link_url ? [req.link_url] : []),
      ...(messages.length ? ['', t('flow.mail.latest'), '', messages.join('\n\n---\n\n')] : []),
    ].join('\n');
  }

  const thread = r && detail && (
    <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1.5, minWidth: 0, alignContent: 'start' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<ChevronLeftIcon />} onClick={() => (embedded?.onBack ? embedded.onBack() : setSelectedId(null))} sx={{ display: { md: 'none' } }}>
          {t('flow.back')}
        </Button>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h6" sx={{ fontSize: '1.1rem', overflowWrap: 'anywhere' }}>{r.subject}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('flow.from', { name: sender(r) })} · {target(r)}
            {(r.target_kind === 'manager' || r.target_kind === 'person') && detail.handlers.length > 0 ? ` (${detail.handlers.map((h) => h.name).join(', ')})` : ''}
            {' · '}
            {formatLocaleDateTime(r.opened_at, locale)}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {r.urgent && <Chip size="small" color="error" label={t('flow.urgent')} />}
          {dueChip(r)}
          {r.confidential && (
            <Tooltip title={t('flow.confidentialHint')}>
              <Chip size="small" icon={<LockIcon fontSize="small" />} label={t('flow.confidential')} />
            </Tooltip>
          )}
          {r.flow_type && <Chip size="small" variant="outlined" label={typeLabel(r.flow_type)} />}
          <Chip size="small" color={STATUS_COLOR[r.status]} label={t(`flow.status.${r.status}`)} />
          {r.archived_at && <Chip size="small" label={t('flow.archived')} />}
          {!r.archived_at && (detail.isHandler || detail.isRequester) && (
            <Tooltip title={t('flow.editDetails')}>
              <IconButton size="small" aria-label={t('flow.editDetails')} onClick={() => setEditingDetails(true)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {hasCustomValues(template, r.custom) && (
        <FlowCustomFields template={{ ...template, designer: null }} values={r.custom ?? {}} editing={false} />
      )}
      {r.flow_type && <FlowTypeFields orgId={orgId} type={r.flow_type} authHeaders={authHeaders} values={r.custom ?? {}} />}

      {r.link_url && (
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', minWidth: 0 }}>
          <PublicIcon fontSize="small" color="action" />
          <Tooltip title={t('flow.openLink')}>
            <Link href={r.link_url} target="_blank" rel="noopener noreferrer" variant="body2" noWrap sx={{ minWidth: 0 }}>
              {r.link_url.replace(/^https?:\/\//, '')}
            </Link>
          </Tooltip>
        </Box>
      )}

      {r.source_section && navigate && (
        <Box>
          {/* A task about someone opens that person on its page (`?user=`), e.g. their HR dashboard. */}
          <Button size="small" variant="outlined" onClick={() => navigate(r.source_section as string, r.about_user_id ? `user=${r.about_user_id}` : undefined)}>
            {r.about_user_id ? t('flow.goToPerson') : t('flow.openSource', { name: sourceLabel(r.source) })}
          </Button>
        </Box>
      )}

      {detail.workflow && !r.archived_at && (
        <WorkflowPanel
          workflow={detail.workflow}
          isRequester={detail.isRequester}
          busy={busy}
          onDecide={(what, note, values) => decide(detail.workflow!.id, what, note, values, detail.workflow!.fields)}
          onTake={(release) => void takeStep(detail.workflow!.id, release)}
          onCompose={() => void openCompose(r.id)}
          totals={stepTotals(detail.messages, locale)}
          events={detail.messages.filter((m) => m.kind === 'event')}
          onResubmit={(note) => void post(`/${r.id}/resubmit`, { note })}
          onWithdraw={() => void post(`/${r.id}/withdraw`, {})}
        />
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {r.assignee_name && <Typography variant="body2" color="text.secondary">{t('flow.handledBy', { name: r.assignee_name })}</Typography>}
        <Box sx={{ flex: 1 }} />
        {/* A flow with set steps is taken over step by step (WorkflowPanel), not as a whole. */}
        {detail.isHandler && !r.archived_at && r.target_kind !== 'workflow' && (
          r.assignee_user_id === userId ? (
            <Button size="small" disabled={busy} onClick={() => void post(`/${r.id}/take`, { release: true })}>{t('flow.release')}</Button>
          ) : (
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void post(`/${r.id}/take`, {})}>{t('flow.take')}</Button>
          )
        )}
        {detail.isHandler && !r.archived_at && r.target_kind !== 'workflow' && (
          <TextField
            select
            size="small"
            label={t('flow.statusLabel')}
            value={r.status}
            disabled={busy}
            onChange={(e) => void post(`/${r.id}/status`, { status: e.target.value })}
            sx={{ minWidth: 150 }}
          >
            {(['open', 'in_progress', 'resolved'] as const).map((s) => (
              <MenuItem key={s} value={s}>{t(`flow.status.${s}`)}</MenuItem>
            ))}
          </TextField>
        )}
        {!detail.isHandler && detail.isRequester && !r.archived_at && r.target_kind !== 'workflow' && (
          r.status === 'resolved' ? (
            <Button size="small" disabled={busy} onClick={() => void post(`/${r.id}/status`, { status: 'open' })}>{t('flow.reopen')}</Button>
          ) : (
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void post(`/${r.id}/status`, { status: 'resolved' })}>{t('flow.markResolved')}</Button>
          )
        )}
        {!r.confidential && (
          <Tooltip title={t('flow.mail.hint')}>
            <Button size="small" startIcon={<MailIcon />} onClick={() => setForwarding(true)}>
              {t('flow.mail')}
            </Button>
          </Tooltip>
        )}
        {detail.isHandler && (
          <Button size="small" disabled={busy} onClick={() => void post(`/${r.id}/archive`, { archived: !r.archived_at })}>
            {r.archived_at ? t('flow.unarchive') : t('flow.archive')}
          </Button>
        )}
      </Box>

      <Divider />

      <Box sx={{ display: 'grid', gap: 1 }}>
        {detail.messages.map((m) => {
          if (m.kind === 'event') {
            return (
              <Typography key={m.id} variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
                {eventText(m)} · {formatRelativeTime(m.posted_at, locale)}
                {m.data.values?.length ? <StepAnswers answers={m.data.values} yes={t('common.yes')} /> : null}
                {m.data.private && !m.data.values ? <Typography variant="caption" color="text.secondary" component="div">{t('workflow.privateAnswers.hidden')}</Typography> : null}
              </Typography>
            );
          }
          const own = m.author_user_id === userId;
          return (
            <Box key={m.id} sx={{ display: 'flex', justifyContent: own ? 'flex-end' : 'flex-start' }}>
              <Box
                sx={{
                  maxWidth: '85%',
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  bgcolor: own ? 'primary.main' : 'action.hover',
                  color: own ? 'primary.contrastText' : 'text.primary',
                }}
              >
                <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>
                  {authorOf(m)} · {formatLocaleDateTime(m.posted_at, locale)}
                </Typography>
                {m.body && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</Typography>}
                {m.attachments?.length > 0 && (
                  <Box sx={{ display: 'grid', gap: 0.75, mt: m.body ? 1 : 0.5, justifyItems: 'start' }}>
                    {m.attachments.map((a) => (
                      <AttachmentView
                        key={a.id}
                        attachment={a}
                        url={`${API}/organizations/${orgId}/flows/${r.id}/attachments/${a.id}`}
                        authHeaders={authHeaders}
                      />
                    ))}
                  </Box>
                )}
              </Box>
            </Box>
          );
        })}
      </Box>

      {!r.archived_at ? (
        <DropZone dragging={replyFiles.dragging} dropProps={replyFiles.dropProps}>
          <Box sx={{ display: 'grid', gap: 1 }}>
            <TextField
              multiline
              minRows={2}
              maxRows={10}
              size="small"
              label={t('flow.reply')}
              helperText={t('attachments.hint')}
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onPaste={replyFiles.onPaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void sendReply();
              }}
            />
            {replyFiles.chips}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {replyFiles.button}
              <Button variant="contained" disabled={busy || (!reply.trim() && replyFiles.files.length === 0)} onClick={() => void sendReply()}>
                {t('flow.send')}
              </Button>
            </Box>
          </Box>
        </DropZone>
      ) : (
        <Typography variant="body2" color="text.secondary">{t('flow.archivedReadOnly')}</Typography>
      )}
    </Paper>
  );

  // The request forms' design-mode panel: which form, and its fields.
  const designPanel = template.designer ? (
        <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1.5 }}>
          {/* Which form to design: every request's fields, or a type's own. */}
          <TextField select size="small" label={t('flow.designForm')} value={designType} onChange={(e) => setDesignType(e.target.value)} sx={{ maxWidth: 360 }}>
            <MenuItem value="">{t('flow.designFormAll')}</MenuItem>
            {flowTypeOptions(types.values, types.translation, locale).map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </TextField>
          <FlowCustomFields key={designType || 'all'} template={designType ? designTypeTemplate : template} values={{}} withPanel>
            {(fields, title) => (
              <Box sx={{ display: 'grid', gap: 1 }}>
                <Typography variant="subtitle2">{title}</Typography>
                <Typography variant="body2" color="text.secondary">{t(designType ? 'flow.typeFieldsDesign' : 'flow.customFieldsDesign')}</Typography>
                {fields}
              </Box>
            )}
          </FlowCustomFields>
        </Paper>
  ) : null;
  const newFlowDialog = (
      <NewFlowDialog
        open={composeOpen}
        preset={embedded?.composePreset}
        types={types}
        template={template}
        orgId={orgId}
        authHeaders={authHeaders}
        errorText={errorText}
        onClose={() => setComposeOpen(false)}
        onCreated={async (id) => {
          setComposeOpen(false);
          setBox('mine');
          setSelectedId(id);
          embedded?.onCreated?.(id);
          onChanged?.();
        }}
      />
  );
  // The Flows page's own list: this instance only offers the design panel and the new-flow dialog.
  if (embedded?.designOnly) return <>{designPanel}{newFlowDialog}</>;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      {!embedded && (
        <PageHeader
          title={t('flow.title')}
          subtitle={t('flow.subtitle')}
          end={
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setComposeOpen(true)}>
              {t('flow.new')}
            </Button>
          }
        />
      )}

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      {designPanel}

      {!embedded && <Tabs
        value={box}
        onChange={(_, v: Box_) => {
          setBox(v);
          setSelectedId(null);
        }}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        <Tab value="mine" icon={<SendIcon />} label={t('flow.box.mine')} />
        <Tab
          value="inbox"
          icon={<InboxIcon />}
          label={
            <Badge color="error" badgeContent={inboxCount} sx={{ '& .MuiBadge-badge': { right: -12 } }}>
              {t('flow.box.inbox')}
            </Badge>
          }
        />
        <Tab value="archived" icon={<ArchiveIcon />} label={t('flow.box.archived')} />
      </Tabs>}

      {embedded?.detailOnly ? (thread ?? <LinearProgress />) : (
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 2fr) 3fr' }, alignItems: 'start' }}>
        <Box sx={{ display: { xs: selectedId ? 'none' : 'block', md: 'block' }, minWidth: 0 }}>{list}</Box>
        <Box sx={{ display: { xs: selectedId ? 'block' : 'none', md: 'block' }, minWidth: 0 }}>
          {thread ?? (
            <Paper variant="outlined">
              <EmptyState title={t('flow.pick')} />
            </Paper>
          )}
        </Box>
      </Box>
      )}

      {r && composing && (
        <ForwardMailDialog
          open
          onClose={() => setComposing(null)}
          onSent={(count) => {
            setNotice(t('mail.sent', { count: String(count) }));
            if (selectedId) void loadDetail(selectedId);
          }}
          orgId={orgId}
          endpoint={`/organizations/${orgId}/flows/${r.id}/compose`}
          suggested={composing.suggested}
          initialTo={composing.to}
          defaultSubject={composing.subject}
          defaultMessage={composing.text}
          title={t('flow.compose.title')}
          hint={t('flow.compose.hint')}
          authHeaders={authHeaders}
        />
      )}

      {r && detail && (
        <ForwardMailDialog
          open={forwarding}
          onClose={() => setForwarding(false)}
          onSent={(count) => setNotice(t('mail.sent', { count: String(count) }))}
          orgId={orgId}
          endpoint={`/organizations/${orgId}/flows/${r.id}/forward`}
          suggested={forwardSuggested(r, detail)}
          defaultSubject={t('flow.mail.subject', { subject: r.subject })}
          defaultMessage={forwardMessage(r, detail)}
          authHeaders={authHeaders}
        />
      )}

      {r && (
        <EditDetailsDialog
          open={editingDetails}
          request={r}
          types={types}
          template={template}
          orgId={orgId}
          authHeaders={authHeaders}
          busy={busy}
          onClose={() => setEditingDetails(false)}
          onSave={async (d, custom) => {
            const ok = await post(`/${r.id}/details`, { type: d.type || undefined, urgent: d.urgent, link: d.link, dueDate: d.due || null, custom });
            if (ok) setEditingDetails(false);
          }}
        />
      )}

      {newFlowDialog}
    </Box>
  );
}

/** Type, urgency and link fields, shared by the new-request and edit dialogs. */
function DetailsFields({
  value,
  onChange,
  types,
  keepType,
  askConfidential,
}: {
  value: DetailsDraft;
  onChange: (next: DetailsDraft) => void;
  types: TypeRow;
  keepType?: string | null;
  /** A new flow: the requester may mark it confidential (a confidential type is anyway). */
  askConfidential?: boolean;
}) {
  const { t, locale } = useI18n();
  const options = flowTypeOptions(types.values, types.translation, locale, [keepType]);
  const linkInvalid = cleanFlowLink(value.link) === undefined;
  return (
    <>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {options.length > 0 && (
          <TextField
            select
            size="small"
            required
            label={t('flow.type')}
            value={value.type}
            onChange={(e) => onChange({ ...value, type: e.target.value })}
            sx={{ minWidth: 220, flex: 1 }}
          >
            {options.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>
        )}
        {flowTypeConfidential(types.values, value.type) ? (
          <Chip size="small" icon={<LockIcon fontSize="small" />} label={t('flow.confidential')} />
        ) : askConfidential ? (
          <Tooltip title={t('flow.confidentialHint')}>
            <FormControlLabel
              control={<Checkbox size="small" checked={!!value.confidential} onChange={(e) => onChange({ ...value, confidential: e.target.checked })} />}
              label={t('flow.confidential')}
            />
          </Tooltip>
        ) : null}
        <Tooltip title={t('flow.urgentHint')}>
          <FormControlLabel
            control={<Checkbox size="small" color="error" checked={value.urgent} onChange={(e) => onChange({ ...value, urgent: e.target.checked })} />}
            label={t('flow.urgent')}
          />
        </Tooltip>
      </Box>
      {(flowTypeConfidential(types.values, value.type) || (askConfidential && value.confidential)) && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>{t('flow.confidentialHint')}</Typography>
      )}
      <TextField
        size="small"
        label={t('flow.link')}
        placeholder="https://"
        value={value.link}
        error={linkInvalid}
        helperText={linkInvalid ? t('flow.linkInvalid') : t('flow.linkHint')}
        onChange={(e) => onChange({ ...value, link: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 2000, inputMode: 'url', autoComplete: 'off', spellCheck: false } }}
      />
      <TextField
        type="date"
        size="small"
        label={t('flow.due')}
        value={value.due}
        error={cleanDueDate(value.due) === undefined}
        helperText={t('flow.dueHint')}
        onChange={(e) => onChange({ ...value, due: e.target.value })}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ maxWidth: 240 }}
      />
    </>
  );
}

/** Whether the drafted details can be sent: a type when the org has types, and a usable link. */
function detailsReady(d: DetailsDraft, types: TypeRow): boolean {
  return (Object.keys(types.values).length === 0 || !!d.type) && cleanFlowLink(d.link) !== undefined && cleanDueDate(d.due) !== undefined;
}

function EditDetailsDialog({
  open,
  request,
  types,
  template,
  orgId,
  authHeaders,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  request: FlowItem;
  types: TypeRow;
  template: FormTemplate;
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  busy: boolean;
  onClose: () => void;
  onSave: (d: DetailsDraft, custom: Record<string, unknown>) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<DetailsDraft>(EMPTY_DETAILS);
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    setDraft({ type: request.flow_type ?? '', urgent: request.urgent, link: request.link_url ?? '', due: request.due_date ?? '' });
    setCustom(request.custom ?? {});
    setCustomErrors({});
  }, [open, request]);
  const typeTemplate = useFlowTypeTemplate(orgId, draft.type, authHeaders);
  function save() {
    const checked = checkFlowCustomAll([template, typeTemplate], custom);
    if (!checked.ok) {
      setCustomErrors(checked.errors);
      return;
    }
    void onSave(draft, checked.value);
  }
  // A request from before types existed may be saved without choosing one.
  const ready = cleanFlowLink(draft.link) !== undefined && cleanDueDate(draft.due) !== undefined && (!!draft.type || !request.flow_type);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('flow.editDetails')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        <DetailsFields value={draft} onChange={setDraft} types={types} keepType={request.flow_type} />
        <FlowCustomFields template={{ ...template, designer: null }} values={custom} onChange={setCustom} errors={customErrors} />
        <FlowCustomFields template={{ ...typeTemplate, designer: null }} values={custom} onChange={setCustom} errors={customErrors} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={busy || !ready} onClick={save}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function NewFlowDialog({
  open,
  types,
  template,
  orgId,
  authHeaders,
  errorText,
  onClose,
  onCreated,
  preset,
}: {
  open: boolean;
  types: TypeRow;
  template: FormTemplate;
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  errorText: (code: string | undefined) => string;
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
  preset?: ComposePreset;
}) {
  const { t, locale } = useI18n();
  const [targets, setTargets] = useState<Targets>({ manager: null, departments: [] });
  const [kind, setKind] = useState<'manager' | 'department'>('manager');
  const [departmentId, setDepartmentId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useAttachmentDraft(setError);
  const typeTemplate = useFlowTypeTemplate(orgId, details.type, authHeaders);
  // The first type in the org's order (Service request by default) is preselected; for a free flow (the Flows page's
  // menu) the first without set steps, so it stays free.
  const typeOptions = flowTypeOptions(types.values, types.translation, locale);
  const firstType = !preset?.target && !preset?.free ? typeOptions[0]?.value ?? ''
    : !targets.workflows ? '' // the types with set steps are not known yet
      : typeOptions.find((o) => !targets.workflows![o.value])?.value ?? '';

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubject('');
    setMessage('');
    setDetails(preset?.type ? { ...EMPTY_DETAILS, type: preset.type } : EMPTY_DETAILS);
    setCustom({});
    setCustomErrors({});
    draft.clear();
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/flows/targets`, { headers: await authHeaders() });
        const data = await res.json();
        const next: Targets = { manager: data?.manager ?? null, departments: Array.isArray(data?.departments) ? data.departments : [], workflows: data?.workflows ?? {} };
        setTargets(next);
        setKind(preset?.target === 'department' || !next.manager ? 'department' : 'manager');
        // HR is the usual department to ask; preselect it when there is one.
        const hr = next.departments.find((d) => /^(hr|human resources|personal|ressources humaines|risorse umane)/i.test(d.name));
        setDepartmentId(hr?.id ?? next.departments[0]?.id ?? '');
      } catch {
        setError(t('common.cannotReachApi'));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orgId, authHeaders, t]);

  // Preselect a type once the types are known (they may arrive after the dialog opened).
  useEffect(() => {
    if (open && firstType) setDetails((d) => (d.type ? d : { ...d, type: firstType }));
  }, [open, firstType]);

  async function submit() {
    const checked = checkFlowCustomAll([template, typeTemplate], custom);
    if (!checked.ok) {
      setCustomErrors(checked.errors);
      return;
    }
    setCustomErrors({});
    setBusy(true);
    setError(null);
    try {
      const payload = messageBody(
        {
          target: kind,
          departmentId: kind === 'department' ? departmentId : undefined,
          subject,
          message,
          type: details.type || undefined,
          urgent: details.urgent ? 'true' : undefined,
          confidential: details.confidential ? 'true' : undefined,
          link: details.link.trim() || undefined,
          dueDate: details.due || undefined,
          custom: Object.keys(checked.value).length ? JSON.stringify(checked.value) : undefined,
        },
        draft.files,
      );
      const res = await fetch(`${API}/organizations/${orgId}/flows`, {
        method: 'POST',
        headers: { ...payload.headers, ...(await authHeaders()) },
        body: payload.body,
      });
      if (res.status === 413) {
        setError(t('attachments.rejected'));
        return;
      }
      const data = await res.json();
      if (!data?.ok) setError(errorText(data?.error));
      else await onCreated(data.id);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  // A type with its own workflow goes to its steps: no target to choose.
  const workflowSteps = details.type ? targets.workflows?.[details.type] : undefined;
  const ready =
    subject.trim() &&
    (message.trim() || draft.files.length > 0) &&
    (workflowSteps || (kind === 'manager' ? !!targets.manager : !!departmentId)) &&
    detailsReady(details, types);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('flow.new')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        {workflowSteps ? (
          <Alert severity="info" icon={false}>
            <Typography variant="body2" sx={{ mb: 0.75 }}>{t('flow.workflowHint')}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
              {workflowSteps.map((s, i) => (
                <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  {i > 0 && <ChevronRightIcon fontSize="small" color="action" />}
                  {s.conditional ? (
                    <Tooltip title={t('flow.workflowConditional')}>
                      <Chip size="small" variant="outlined" sx={{ borderStyle: 'dashed' }} label={stepName(s, locale, t)} />
                    </Tooltip>
                  ) : (
                    <Chip size="small" label={stepName(s, locale, t)} />
                  )}
                </Box>
              ))}
            </Box>
          </Alert>
        ) : (
        <>
        <RadioGroup value={kind} onChange={(e) => setKind(e.target.value as 'manager' | 'department')}>
          <FormControlLabel
            value="manager"
            disabled={!targets.manager}
            control={<Radio size="small" />}
            label={targets.manager ? t('flow.toManagerNamed', { name: targets.manager.name }) : t('flow.noManager')}
          />
          <FormControlLabel value="department" disabled={targets.departments.length === 0} control={<Radio size="small" />} label={t('flow.toADepartment')} />
        </RadioGroup>
        {kind === 'department' && (
          <TextField select size="small" label={t('flow.department')} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {targets.departments.map((d) => (
              <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
            ))}
          </TextField>
        )}
        </>
        )}
        <TextField size="small" label={t('flow.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} inputProps={{ maxLength: 200 }} />
        <DetailsFields value={details} onChange={setDetails} types={types} askConfidential />
        <FlowCustomFields template={{ ...template, designer: null }} values={custom} onChange={setCustom} errors={customErrors} />
        <FlowCustomFields template={{ ...typeTemplate, designer: null }} values={custom} onChange={setCustom} errors={customErrors} />
        <DropZone dragging={draft.dragging} dropProps={draft.dropProps}>
          <Box sx={{ display: 'grid', gap: 1 }}>
            <TextField
              multiline
              minRows={4}
              fullWidth
              label={t('flow.message')}
              helperText={t('attachments.hint')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onPaste={draft.onPaste}
            />
            {draft.chips}
            <Box>{draft.button}</Box>
          </Box>
        </DropZone>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={busy || !ready} onClick={() => void submit()}>{t('flow.send')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/**
 * A workflow request's steps: where it stands and who it waits for; the step's assignees approve it (or send it back
 * to the requester), the requester submits a request that was sent back again or withdraws it.
 */
/** The sums of the number answers of the thread's form steps, per step and field ("Amount: 80"). */
function stepTotals(messages: Message[], locale: string): string[] {
  const sums = new Map<string, { label: string; total: number; count: number }>();
  // A step whose answers the caller only partly sees (some for the requester only) gets no total.
  const partly = new Set(messages.filter((m) => m.data.private && !m.data.values).map((m) => m.data.step?.key ?? ''));
  for (const m of messages) {
    if (partly.has(m.data.step?.key ?? '')) continue;
    for (const a of m.data.values ?? []) {
      if (a.type !== 'number' || typeof a.value !== 'number') continue;
      const id = `${m.data.step?.key ?? ''}:${a.key}`;
      const sum = sums.get(id) ?? { label: stepFieldLabel({ key: a.key, type: a.type, label: a.label }, locale), total: 0, count: 0 };
      sum.total += a.value;
      sum.count += 1;
      sums.set(id, sum);
    }
  }
  return [...sums.values()].filter((s) => s.count > 1).map((s) => `${s.label}: ${formatLocaleNumber(s.total, locale)}`);
}

function WorkflowPanel({ workflow, isRequester, busy, onDecide, onResubmit, onWithdraw, onTake, onCompose, totals, events }: {
  workflow: FlowStepsInfo;
  /** Takes the step over (or gives it back, `release`). */
  onTake: (release: boolean) => void;
  /** Opens the step's e-mail. */
  onCompose: () => void;
  /** The thread's events: who did which step when. */
  events: Message[];
  isRequester: boolean;
  busy: boolean;
  onDecide: (what: 'approve' | 'reject', note: string, values?: StepValues) => Promise<boolean>;
  /** The sums of the form steps' number answers. */
  totals: string[];
  onResubmit: (note: string) => void;
  onWithdraw: () => void;
}) {
  const { t, locale } = useI18n();
  const [note, setNote] = useState('');
  const [values, setValues] = useState<StepValues>({});
  const progress = stepProgress(workflow.steps, events, workflow);
  const date = (at: string | null) => (at ? formatLocaleDateTime(at, locale) : '');
  /** What a step's line says beside its name. */
  const stepNote = (p: (typeof progress)[number]) => {
    switch (p.state) {
      case 'done':
        return p.automatic ? t('flows.step.system', { date: date(p.at) }) : t('flows.step.doneBy', { names: p.by.join(', '), date: date(p.at) });
      case 'current': {
        const waiting = workflow.waitingFor.join(', ');
        if (!workflow.each || p.by.length === 0) return waiting ? t('flows.step.waiting', { names: waiting }) : '';
        const progressText = t('flows.step.progress', { done: String(p.by.length), total: String(p.by.length + workflow.waitingFor.length) });
        return waiting ? `${progressText} · ${t('flows.step.waiting', { names: waiting })}` : progressText;
      }
      case 'returned':
        return t('flows.step.returned', { date: date(p.at) });
      case 'skipped':
        return t('flows.step.skipped');
      default:
        return '';
    }
  };
  const mark: Record<StepState, ReactNode> = {
    done: <CheckCircleIcon fontSize="small" color="success" />,
    current: <ScheduleIcon fontSize="small" color="primary" />,
    returned: <RestartAltIcon fontSize="small" color="warning" />,
    skipped: <Box component="span" sx={{ width: 20, textAlign: 'center', color: 'text.disabled' }}>–</Box>,
    upcoming: <Box component="span" sx={{ width: 14, height: 14, m: '3px', borderRadius: '50%', border: 2, borderColor: 'text.disabled' }} />,
  };
  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'grid', gap: 1, bgcolor: 'action.hover' }}>
      {/* The steps one under the other: done (who, when), the current one (who did it so far, who is missing), to come. */}
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 0.75 }}>
        {workflow.steps.map((s, i) => {
          const p = progress[i];
          const text = stepNote(p);
          return (
            <Box component="li" key={s.key} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
              <Box sx={{ display: 'flex', width: 20, justifyContent: 'center', pt: '1px', flexShrink: 0 }}>{mark[p.state]}</Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: p.state === 'current' ? 600 : 400, color: p.state === 'upcoming' || p.state === 'skipped' ? 'text.secondary' : 'text.primary' }}>
                  {stepName(s, locale, t)}
                </Typography>
                {text && <Typography variant="caption" color="text.secondary" component="div">{text}</Typography>}
              </Box>
            </Box>
          );
        })}
      </Box>
      {workflow.status === 'pending' && workflow.each && <Typography variant="caption" color="text.secondary">{t('flow.workflow.each')}</Typography>}
      {totals.length > 0 && <Typography variant="body2">{t('flow.workflow.totals', { totals: totals.join(' · ') })}</Typography>}
      {workflow.returned && <Alert severity="warning">{t(isRequester ? 'flow.workflow.returnedToYou' : 'flow.workflow.returned')}</Alert>}
      {/* Several people got the step: one takes it over, then does it. A step that writes an e-mail: first the e-mail. */}
      {workflow.canDecide && workflow.takeOver && <Typography variant="caption" color="text.secondary">{t('flow.workflow.takeFirst')}</Typography>}
      {workflow.canDecide && !workflow.takeOver && workflow.compose && !workflow.composed && <Typography variant="caption" color="text.secondary">{t('flow.workflow.mailFirst')}</Typography>}
      {workflow.canDecide && workflow.fields?.length ? <StepFieldsForm fields={workflow.fields} values={values} onChange={setValues} disabled={busy} privateAnswers={workflow.privateAnswers} /> : null}
      {(workflow.canDecide || (isRequester && (workflow.returned || workflow.status === 'pending'))) && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {(workflow.canDecide || workflow.returned) && (
            <TextField size="small" label={t('flow.workflow.note')} value={note} onChange={(e) => setNote(e.target.value)} sx={{ flex: 1, minWidth: 200 }} />
          )}
          {workflow.canDecide && workflow.takeOver && (
            <Button size="small" variant="contained" disabled={busy} onClick={() => onTake(false)}>{t('flow.take')}</Button>
          )}
          {workflow.canDecide && !workflow.takeOver && workflow.compose && (
            <Button size="small" variant={workflow.composed ? 'outlined' : 'contained'} startIcon={<MailIcon />} disabled={busy} onClick={onCompose}>{t('flow.workflow.compose')}</Button>
          )}
          {workflow.canDecide && (
            <>
              <Button size="small" variant="contained" disabled={busy || !!workflow.takeOver || (!!workflow.compose && !workflow.composed)} onClick={() => { void onDecide('approve', note, values).then((ok) => { if (ok) { setNote(''); setValues({}); } }); }}>
                {t(workflow.actionKey ?? 'flow.workflow.approve')}
              </Button>
              {workflow.returns && (
                <Button size="small" color="error" disabled={busy || !!workflow.takeOver} onClick={() => { void onDecide('reject', note).then((ok) => { if (ok) setNote(''); }); }}>{t('approvals.return')}</Button>
              )}
              {workflow.takenByMe && (
                <Button size="small" disabled={busy} onClick={() => onTake(true)}>{t('flow.release')}</Button>
              )}
            </>
          )}
          {isRequester && workflow.returned && (
            <Button size="small" variant="contained" disabled={busy} onClick={() => { onResubmit(note); setNote(''); }}>{t('flow.workflow.resubmit')}</Button>
          )}
          {isRequester && (workflow.returned || workflow.status === 'pending') && !workflow.canDecide && (
            <Button size="small" disabled={busy} onClick={onWithdraw}>{t('flow.workflow.withdraw')}</Button>
          )}
        </Box>
      )}
    </Paper>
  );
}

/** A request's values in its type's own fields (read only; nothing when there are none). */
function FlowTypeFields({ orgId, type, authHeaders, values }: { orgId: string; type: string; authHeaders: () => Promise<Record<string, string>>; values: Record<string, unknown> }) {
  const template = useFlowTypeTemplate(orgId, type, authHeaders);
  return hasCustomValues(template, values) ? <FlowCustomFields template={{ ...template, designer: null }} values={values} editing={false} /> : null;
}
