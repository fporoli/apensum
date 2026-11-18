import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
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
import { useI18n } from './i18n';
import { EmptyState, PageHeader } from './components';
import { AddIcon, ChevronLeftIcon, EditIcon, MailIcon, PublicIcon } from './icons';
import { cleanRequestLink, requestTypeLabel, requestTypeOptions } from '@worktime3/shared/requests';
import ForwardMailDialog, { type Recipient } from './ForwardMailDialog';
import { formatLocaleDateTime, formatRelativeTime } from './localeFormat';
import { AttachmentView, DropZone, useAttachmentDraft, type Attachment } from './attachments';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Box_ = 'mine' | 'inbox' | 'archived';
type Status = 'open' | 'in_progress' | 'resolved';

interface RequestItem {
  id: string;
  subject: string;
  status: Status;
  request_type: string | null;
  urgent: boolean;
  link_url: string | null;
  target_kind: 'manager' | 'department';
  department_name: string | null;
  requester_user_id: string;
  requester_name: string | null;
  requester_email: string;
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
    details?: { request_type?: string | null; urgent?: boolean; link_url?: string | null };
  };
  posted_at: string;
  author_user_id: string | null;
  author_name: string | null;
  attachments: Attachment[];
}

interface Detail {
  request: RequestItem;
  messages: Message[];
  handlers: { id: string; name: string; email: string }[];
  isRequester: boolean;
  isHandler: boolean;
}

/** The org's request_type static_data row (its own copy, else the global one). */
interface TypeRow {
  values: Record<string, unknown>;
  translation: Record<string, Record<string, string>>;
}

/** Type, urgency and link as the forms edit them. */
interface DetailsDraft {
  type: string;
  urgent: boolean;
  link: string;
}

interface Targets {
  manager: { id: string; name: string } | null;
  departments: { id: string; name: string }[];
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

interface RequestsProps {
  orgId: string;
  userId: string | null;
  authHeaders: () => Promise<Record<string, string>>;
  /** A request to open, e.g. from a notification. */
  focusId?: string | null;
  /** Changes when a notification arrives, so the open lists and thread reload. */
  refreshKey?: unknown;
  /** After a change, so the navbar badge can refresh. */
  onChanged?: () => void;
}

/**
 * Requests: tickets to one's line manager or a department (HR, ...), each with a message thread.
 * "My requests" lists the caller's own, "Inbox" those they handle (as manager or department
 * member), "Archived" the archived ones of both. Handlers take a request, answer, set its status
 * and archive it; every change notifies the other side.
 */
export default function Requests({ orgId, userId, authHeaders, focusId, refreshKey, onChanged }: RequestsProps) {
  const { t, locale } = useI18n();
  const [box, setBox] = useState<Box_>('mine');
  const [items, setItems] = useState<RequestItem[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(focusId ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editingDetails, setEditingDetails] = useState(false);
  const [types, setTypes] = useState<TypeRow>({ values: {}, translation: {} });
  const replyFiles = useAttachmentDraft(setError);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/static-data/requests`, { headers: await authHeaders() });
        const rows = await res.json();
        const row = Array.isArray(rows) ? rows.find((x: { enum_name?: string }) => x.enum_name === 'request_type') : null;
        if (!cancelled) setTypes({ values: row?.values ?? {}, translation: row?.translation ?? {} });
      } catch {
        /* no types: the forms just don't show the field */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, authHeaders]);

  const typeLabel = (key: string | null | undefined) => (key ? requestTypeLabel(types.translation, locale, key) : '');

  const errorText = useCallback(
    (code: string | undefined) => {
      const key = `requests.error.${code}`;
      const text = t(key);
      return text === key ? t('requests.error.failed', { error: code ?? t('common.unknownError') }) : text;
    },
    [t],
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const [list, summary] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/requests?box=${box}`, { headers }).then((r) => r.json()),
        fetch(`${API}/organizations/${orgId}/requests/summary`, { headers }).then((r) => r.json()),
      ]);
      setItems(Array.isArray(list?.requests) ? list.requests : []);
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
        const res = await fetch(`${API}/organizations/${orgId}/requests/${id}`, { headers: await authHeaders() });
        const data = await res.json();
        if (data?.ok && data.request) setDetail(data as Detail);
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
    void loadList();
    // refreshKey: a notification arrived.
  }, [loadList, refreshKey]);

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

  async function post(path: string, fields: Record<string, unknown>, files: File[] = []): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const payload = files.length
        ? messageBody(fields as Record<string, string | undefined>, files)
        : { body: JSON.stringify(fields), headers: { 'Content-Type': 'application/json' } };
      const res = await fetch(`${API}/organizations/${orgId}/requests${path}`, {
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
    if (await post(`/${detail.request.id}/messages`, { body: reply }, replyFiles.files)) {
      setReply('');
      replyFiles.clear();
    }
  }

  const r = detail?.request;
  const target = (item: RequestItem) =>
    item.target_kind === 'manager' ? t('requests.toManager') : t('requests.toDepartment', { department: item.department_name ?? '' });

  function eventText(m: Message): string {
    const who = m.author_name ?? t('requests.someone');
    if (m.data.details) {
      const d = m.data.details;
      if (Object.keys(d).length === 1 && d.urgent !== undefined) return t(d.urgent ? 'requests.event.urgent' : 'requests.event.notUrgent', { who });
      return t('requests.event.details', { who });
    }
    if (m.data.archived === true) return t('requests.event.archived', { who });
    if (m.data.archived === false) return t('requests.event.unarchived', { who });
    if (m.data.assignee !== undefined) return m.data.assignee ? t('requests.event.took', { who }) : t('requests.event.released', { who });
    if (m.data.status) return t('requests.event.status', { who, status: t(`requests.status.${m.data.status}`) });
    return who;
  }

  const list = (
    <Paper variant="outlined" sx={{ minWidth: 0 }}>
      {loading && <LinearProgress />}
      {items.length === 0 && !loading ? (
        <EmptyState icon={<MailIcon fontSize="inherit" />} title={t(`requests.empty.${box}`)} />
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
                      {item.request_type ? `${typeLabel(item.request_type)} · ` : ''}
                      {box === 'mine' ? target(item) : `${item.requester_name ?? item.requester_email} · ${target(item)}`}
                      <br />
                      {formatRelativeTime(item.last_activity_at, locale)}
                      {item.assignee_name ? ` · ${t('requests.handledBy', { name: item.assignee_name })}` : ''}
                    </>
                  }
                />
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
                  <Chip size="small" color={STATUS_COLOR[item.status]} label={t(`requests.status.${item.status}`)} />
                  {item.urgent && item.status !== 'resolved' && <Chip size="small" color="error" variant="outlined" label={t('requests.urgent')} />}
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
  function forwardSuggested(req: RequestItem, d: Detail): Recipient[] {
    return d.isRequester
      ? d.handlers.filter((h) => h.id !== userId).map((h) => ({ id: h.id, name: h.name, email: h.email }))
      : [{ id: req.requester_user_id, name: req.requester_name ?? req.requester_email, email: req.requester_email }];
  }

  function forwardMessage(req: RequestItem, d: Detail): string {
    const messages = d.messages
      .filter((m) => m.kind === 'message')
      .slice(-3)
      .map((m) => {
        const files = m.attachments.length ? `\n📎 ${m.attachments.map((f) => f.file_name).join(', ')}` : '';
        return `${m.author_name ?? '—'} · ${formatLocaleDateTime(m.posted_at, locale)}\n${m.body ?? ''}${files}`.trim();
      });
    return [
      t('requests.mail.intro', { subject: req.subject }),
      [
        t('requests.from', { name: req.requester_name ?? req.requester_email }),
        target(req),
        req.request_type ? typeLabel(req.request_type) : null,
        req.urgent ? t('requests.urgent') : null,
        t(`requests.status.${req.status}`),
      ].filter(Boolean).join(' · '),
      ...(req.link_url ? [req.link_url] : []),
      ...(messages.length ? ['', t('requests.mail.latest'), '', messages.join('\n\n---\n\n')] : []),
    ].join('\n');
  }

  const thread = r && detail && (
    <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 1.5, minWidth: 0, alignContent: 'start' }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
        <Button size="small" startIcon={<ChevronLeftIcon />} onClick={() => setSelectedId(null)} sx={{ display: { md: 'none' } }}>
          {t('requests.back')}
        </Button>
        <Box sx={{ flex: 1, minWidth: 200 }}>
          <Typography variant="h6" sx={{ fontSize: '1.1rem', overflowWrap: 'anywhere' }}>{r.subject}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('requests.from', { name: r.requester_name ?? r.requester_email })} · {target(r)}
            {r.target_kind === 'manager' && detail.handlers.length > 0 ? ` (${detail.handlers.map((h) => h.name).join(', ')})` : ''}
            {' · '}
            {formatLocaleDateTime(r.opened_at, locale)}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          {r.urgent && <Chip size="small" color="error" label={t('requests.urgent')} />}
          {r.request_type && <Chip size="small" variant="outlined" label={typeLabel(r.request_type)} />}
          <Chip size="small" color={STATUS_COLOR[r.status]} label={t(`requests.status.${r.status}`)} />
          {r.archived_at && <Chip size="small" label={t('requests.archived')} />}
          {!r.archived_at && (detail.isHandler || detail.isRequester) && (
            <Tooltip title={t('requests.editDetails')}>
              <IconButton size="small" aria-label={t('requests.editDetails')} onClick={() => setEditingDetails(true)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>

      {r.link_url && (
        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', minWidth: 0 }}>
          <PublicIcon fontSize="small" color="action" />
          <Tooltip title={t('requests.openLink')}>
            <Link href={r.link_url} target="_blank" rel="noopener noreferrer" variant="body2" noWrap sx={{ minWidth: 0 }}>
              {r.link_url.replace(/^https?:\/\//, '')}
            </Link>
          </Tooltip>
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {r.assignee_name && <Typography variant="body2" color="text.secondary">{t('requests.handledBy', { name: r.assignee_name })}</Typography>}
        <Box sx={{ flex: 1 }} />
        {detail.isHandler && !r.archived_at && (
          r.assignee_user_id === userId ? (
            <Button size="small" disabled={busy} onClick={() => void post(`/${r.id}/take`, { release: true })}>{t('requests.release')}</Button>
          ) : (
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void post(`/${r.id}/take`, {})}>{t('requests.take')}</Button>
          )
        )}
        {detail.isHandler && !r.archived_at && (
          <TextField
            select
            size="small"
            label={t('requests.statusLabel')}
            value={r.status}
            disabled={busy}
            onChange={(e) => void post(`/${r.id}/status`, { status: e.target.value })}
            sx={{ minWidth: 150 }}
          >
            {(['open', 'in_progress', 'resolved'] as const).map((s) => (
              <MenuItem key={s} value={s}>{t(`requests.status.${s}`)}</MenuItem>
            ))}
          </TextField>
        )}
        {!detail.isHandler && detail.isRequester && !r.archived_at && (
          r.status === 'resolved' ? (
            <Button size="small" disabled={busy} onClick={() => void post(`/${r.id}/status`, { status: 'open' })}>{t('requests.reopen')}</Button>
          ) : (
            <Button size="small" variant="outlined" disabled={busy} onClick={() => void post(`/${r.id}/status`, { status: 'resolved' })}>{t('requests.markResolved')}</Button>
          )
        )}
        <Tooltip title={t('requests.mail.hint')}>
          <Button size="small" startIcon={<MailIcon />} onClick={() => setForwarding(true)}>
            {t('requests.mail')}
          </Button>
        </Tooltip>
        {detail.isHandler && (
          <Button size="small" disabled={busy} onClick={() => void post(`/${r.id}/archive`, { archived: !r.archived_at })}>
            {r.archived_at ? t('requests.unarchive') : t('requests.archive')}
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
                  {m.author_name ?? t('requests.someone')} · {formatLocaleDateTime(m.posted_at, locale)}
                </Typography>
                {m.body && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</Typography>}
                {m.attachments?.length > 0 && (
                  <Box sx={{ display: 'grid', gap: 0.75, mt: m.body ? 1 : 0.5, justifyItems: 'start' }}>
                    {m.attachments.map((a) => (
                      <AttachmentView
                        key={a.id}
                        attachment={a}
                        url={`${API}/organizations/${orgId}/requests/${r.id}/attachments/${a.id}`}
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
              label={t('requests.reply')}
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
                {t('requests.send')}
              </Button>
            </Box>
          </Box>
        </DropZone>
      ) : (
        <Typography variant="body2" color="text.secondary">{t('requests.archivedReadOnly')}</Typography>
      )}
    </Paper>
  );

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <PageHeader
        title={t('requests.title')}
        subtitle={t('requests.subtitle')}
        end={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setComposeOpen(true)}>
            {t('requests.new')}
          </Button>
        }
      />

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      <Tabs
        value={box}
        onChange={(_, v: Box_) => {
          setBox(v);
          setSelectedId(null);
        }}
        variant="scrollable"
        allowScrollButtonsMobile
      >
        <Tab value="mine" label={t('requests.box.mine')} />
        <Tab
          value="inbox"
          label={
            <Badge color="error" badgeContent={inboxCount} sx={{ '& .MuiBadge-badge': { right: -12 } }}>
              {t('requests.box.inbox')}
            </Badge>
          }
        />
        <Tab value="archived" label={t('requests.box.archived')} />
      </Tabs>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 2fr) 3fr' }, alignItems: 'start' }}>
        <Box sx={{ display: { xs: selectedId ? 'none' : 'block', md: 'block' }, minWidth: 0 }}>{list}</Box>
        <Box sx={{ display: { xs: selectedId ? 'block' : 'none', md: 'block' }, minWidth: 0 }}>
          {thread ?? (
            <Paper variant="outlined">
              <EmptyState title={t('requests.pick')} />
            </Paper>
          )}
        </Box>
      </Box>

      {r && detail && (
        <ForwardMailDialog
          open={forwarding}
          onClose={() => setForwarding(false)}
          onSent={(count) => setNotice(t('mail.sent', { count: String(count) }))}
          orgId={orgId}
          endpoint={`/organizations/${orgId}/requests/${r.id}/forward`}
          suggested={forwardSuggested(r, detail)}
          defaultSubject={t('requests.mail.subject', { subject: r.subject })}
          defaultMessage={forwardMessage(r, detail)}
          authHeaders={authHeaders}
        />
      )}

      {r && (
        <EditDetailsDialog
          open={editingDetails}
          request={r}
          types={types}
          busy={busy}
          onClose={() => setEditingDetails(false)}
          onSave={async (d) => {
            const ok = await post(`/${r.id}/details`, { type: d.type || undefined, urgent: d.urgent, link: d.link });
            if (ok) setEditingDetails(false);
          }}
        />
      )}

      <NewRequestDialog
        open={composeOpen}
        types={types}
        orgId={orgId}
        authHeaders={authHeaders}
        errorText={errorText}
        onClose={() => setComposeOpen(false)}
        onCreated={async (id) => {
          setComposeOpen(false);
          setBox('mine');
          setSelectedId(id);
          onChanged?.();
        }}
      />
    </Box>
  );
}

/** Type, urgency and link fields, shared by the new-request and edit dialogs. */
function DetailsFields({
  value,
  onChange,
  types,
  keepType,
}: {
  value: DetailsDraft;
  onChange: (next: DetailsDraft) => void;
  types: TypeRow;
  keepType?: string | null;
}) {
  const { t, locale } = useI18n();
  const options = requestTypeOptions(types.values, types.translation, locale, [keepType]);
  const linkInvalid = cleanRequestLink(value.link) === undefined;
  return (
    <>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {options.length > 0 && (
          <TextField
            select
            size="small"
            required
            label={t('requests.type')}
            value={value.type}
            onChange={(e) => onChange({ ...value, type: e.target.value })}
            sx={{ minWidth: 220, flex: 1 }}
          >
            {options.map((o) => (
              <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
            ))}
          </TextField>
        )}
        <Tooltip title={t('requests.urgentHint')}>
          <FormControlLabel
            control={<Checkbox size="small" color="error" checked={value.urgent} onChange={(e) => onChange({ ...value, urgent: e.target.checked })} />}
            label={t('requests.urgent')}
          />
        </Tooltip>
      </Box>
      <TextField
        size="small"
        label={t('requests.link')}
        placeholder="https://"
        value={value.link}
        error={linkInvalid}
        helperText={linkInvalid ? t('requests.linkInvalid') : t('requests.linkHint')}
        onChange={(e) => onChange({ ...value, link: e.target.value })}
        slotProps={{ htmlInput: { maxLength: 2000, inputMode: 'url', autoComplete: 'off', spellCheck: false } }}
      />
    </>
  );
}

/** Whether the drafted details can be sent: a type when the org has types, and a usable link. */
function detailsReady(d: DetailsDraft, types: TypeRow): boolean {
  return (Object.keys(types.values).length === 0 || !!d.type) && cleanRequestLink(d.link) !== undefined;
}

function EditDetailsDialog({
  open,
  request,
  types,
  busy,
  onClose,
  onSave,
}: {
  open: boolean;
  request: RequestItem;
  types: TypeRow;
  busy: boolean;
  onClose: () => void;
  onSave: (d: DetailsDraft) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<DetailsDraft>({ type: '', urgent: false, link: '' });
  useEffect(() => {
    if (open) setDraft({ type: request.request_type ?? '', urgent: request.urgent, link: request.link_url ?? '' });
  }, [open, request]);
  // A request from before types existed may be saved without choosing one.
  const ready = cleanRequestLink(draft.link) !== undefined && (!!draft.type || !request.request_type);
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('requests.editDetails')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        <DetailsFields value={draft} onChange={setDraft} types={types} keepType={request.request_type} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={busy || !ready} onClick={() => void onSave(draft)}>{t('common.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function NewRequestDialog({
  open,
  types,
  orgId,
  authHeaders,
  errorText,
  onClose,
  onCreated,
}: {
  open: boolean;
  types: TypeRow;
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  errorText: (code: string | undefined) => string;
  onClose: () => void;
  onCreated: (id: string) => void | Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [targets, setTargets] = useState<Targets>({ manager: null, departments: [] });
  const [kind, setKind] = useState<'manager' | 'department'>('manager');
  const [departmentId, setDepartmentId] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [details, setDetails] = useState<DetailsDraft>({ type: '', urgent: false, link: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useAttachmentDraft(setError);
  // The first type in the org's order (Service request by default) is preselected.
  const firstType = requestTypeOptions(types.values, types.translation, locale)[0]?.value ?? '';

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSubject('');
    setMessage('');
    setDetails({ type: '', urgent: false, link: '' });
    draft.clear();
    (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/requests/targets`, { headers: await authHeaders() });
        const data = await res.json();
        const next: Targets = { manager: data?.manager ?? null, departments: Array.isArray(data?.departments) ? data.departments : [] };
        setTargets(next);
        setKind(next.manager ? 'manager' : 'department');
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
          link: details.link.trim() || undefined,
        },
        draft.files,
      );
      const res = await fetch(`${API}/organizations/${orgId}/requests`, {
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

  const ready =
    subject.trim() &&
    (message.trim() || draft.files.length > 0) &&
    (kind === 'manager' ? !!targets.manager : !!departmentId) &&
    detailsReady(details, types);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('requests.new')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <RadioGroup value={kind} onChange={(e) => setKind(e.target.value as 'manager' | 'department')}>
          <FormControlLabel
            value="manager"
            disabled={!targets.manager}
            control={<Radio size="small" />}
            label={targets.manager ? t('requests.toManagerNamed', { name: targets.manager.name }) : t('requests.noManager')}
          />
          <FormControlLabel value="department" disabled={targets.departments.length === 0} control={<Radio size="small" />} label={t('requests.toADepartment')} />
        </RadioGroup>
        {kind === 'department' && (
          <TextField select size="small" label={t('requests.department')} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            {targets.departments.map((d) => (
              <MenuItem key={d.id} value={d.id}>{d.name}</MenuItem>
            ))}
          </TextField>
        )}
        <TextField size="small" label={t('requests.subject')} value={subject} onChange={(e) => setSubject(e.target.value)} inputProps={{ maxLength: 200 }} />
        <DetailsFields value={details} onChange={setDetails} types={types} />
        <DropZone dragging={draft.dragging} dropProps={draft.dropProps}>
          <Box sx={{ display: 'grid', gap: 1 }}>
            <TextField
              multiline
              minRows={4}
              fullWidth
              label={t('requests.message')}
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
        <Button variant="contained" disabled={busy || !ready} onClick={() => void submit()}>{t('requests.send')}</Button>
      </DialogActions>
    </Dialog>
  );
}
