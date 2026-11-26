import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { ConfirmDialog, EmptyState, EditIcon, formatLocaleDateTime, MarkdownHelp, MarkdownView, PageHeader, SearchIcon, useI18n, Button } from '@worktime3/web/plugin';
import { isMailAddress, MAX_MAIL_ADDRESSES, splitAddresses } from '../shared/mail';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Note { id: string; text: string; created_at: string; shared_with?: { userId: string; name: string }[] }
interface SharedNote { id: string; text: string; created_at: string; author: string }
interface Person { userId: string; name: string; departmentId: string | null; department: string | null }

/** Lower case, without accents: "Müller" finds "muller". */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Whether every word of the search is in the texts (none = everything). */
const matches = (query: string, ...texts: (string | null | undefined)[]) => {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hay = fold(texts.filter(Boolean).join(' '));
  return words.every((w) => hay.includes(w));
};

/** Whether the notes shared with the caller are shown: remembered in this browser, on by default. */
const SHOW_SHARED = 'notes.showShared';
const storedShowShared = () => { try { return localStorage.getItem(SHOW_SHARED) !== '0'; } catch { return true; } };

/** The note a link names (`#/notes?id=<id>`), to scroll to and mark. */
const linkedId = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id');

/**
 * The caller's notes in this organization: write one, read them newest first, delete one; share one with colleagues
 * or a department, forward it by e-mail, copy its link; and read the notes others shared. Like every page, it calls
 * the API with the caller's token and shows the API's errors (CLAUDE.md, "Web conventions").
 */
export default function Notes({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [shared, setShared] = useState<SharedNote[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<Note | null>(null);
  const [sharing, setSharing] = useState<Note | null>(null);
  const [mailing, setMailing] = useState<Note | null>(null);
  const [focus, setFocus] = useState<string | null>(linkedId);
  const [query, setQuery] = useState('');
  const [showShared, setShowShared] = useState(storedShowShared);
  const toggleShared = (on: boolean) => {
    setShowShared(on);
    try { localStorage.setItem(SHOW_SHARED, on ? '1' : '0'); } catch { /* not remembered */ }
  };
  // Searched: one's own notes by their text and with whom they are shared, the others' by text and author.
  const shownNotes = useMemo(() => (notes ?? []).filter((n) => matches(query, n.text, ...(n.shared_with ?? []).map((s) => s.name))), [notes, query]);
  const shownShared = useMemo(() => (showShared ? shared.filter((n) => matches(query, n.text, n.author)) : []), [shared, showShared, query]);
  // A link or a notification to a note shared with the caller shows the shared ones, the search cleared.
  useEffect(() => {
    if (focus && shared.some((n) => n.id === focus)) { setShowShared(true); setQuery(''); }
  }, [focus, shared]);
  // Writing: the text or its preview (like VS Code's Markdown preview); a saved note shows formatted, its source on demand.
  // A note being changed: its id and the text so far.
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [source, setSource] = useState<Set<string>>(new Set());
  const toggleSource = (id: string) => setSource((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const body = (id: string, text: string) => (source.has(id)
    ? <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', m: 0 }}>{text}</Typography>
    : <MarkdownView text={text} />);

  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    try {
      const res = await fetch(`${API}/organizations/${orgId}/notes${path}`, {
        ...init,
        headers: { ...(await authHeaders()), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
      });
      const data = await res.json();
      if (!data?.ok) setError(t(`notes.error.${data?.error}`) === `notes.error.${data?.error}` ? t('notes.error.failed') : t(`notes.error.${data.error}`));
      return data;
    } catch {
      setError(t('common.cannotReachApi'));
      return null;
    }
  }, [orgId, authHeaders, t]);

  const load = useCallback(async () => {
    const data = await call('');
    setNotes(data?.ok ? data.notes : []);
    setShared(data?.ok ? data.shared ?? [] : []);
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  // A link (or a notification) names a note: scroll to it once the list is there; a new link while open, again.
  useEffect(() => {
    const onHash = () => setFocus(linkedId());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (focus && notes) document.getElementById(`note-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focus, notes, shared]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const data = await call('', { method: 'POST', body: JSON.stringify({ text }) });
    setBusy(false);
    if (data?.ok) {
      setText('');
      await load();
    }
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    const data = await call(`/${editing.id}`, { method: 'PUT', body: JSON.stringify({ text: editing.text }) });
    setBusy(false);
    if (data?.ok) {
      setEditing(null);
      await load();
    }
  }

  async function copyLink(id: string) {
    const url = `${window.location.origin}${window.location.pathname}#/notes?id=${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setInfo(t('notes.linkCopied'));
    } catch {
      setInfo(url);
    }
  }

  async function unshare(noteId: string, userId: string) {
    setError(null);
    const data = await call(`/${noteId}/share/${userId}`, { method: 'DELETE' });
    if (data?.ok) await load();
  }

  const mark = (id: string) => (focus === id ? { borderColor: 'primary.main', borderWidth: 2 } : {});

  return (
    <Stack spacing={2}>
      <PageHeader title={t('notes.title')} subtitle={t('notes.subtitle')} />
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {info && <Alert severity="success" onClose={() => setInfo(null)}>{info}</Alert>}
      <Paper variant="outlined" component="form" onSubmit={add} sx={{ p: 2 }}>
        <NoteEditor text={text} onChange={setText} placeholder={t('notes.placeholder')} />
        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end' }}>
          <Button type="submit" variant="contained" disabled={busy || !text.trim()}>{t('notes.add')}</Button>
        </Box>
      </Paper>
      {((notes?.length ?? 0) > 0 || shared.length > 0) && (
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('notes.search')}
            sx={{ flex: '1 1 260px', maxWidth: 420 }}
            slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" color="action" /></InputAdornment> }, htmlInput: { 'aria-label': t('notes.search') } }}
          />
          {shared.length > 0 && (
            <FormControlLabel
              control={<Checkbox size="small" checked={showShared} onChange={(e) => toggleShared(e.target.checked)} />}
              label={t('notes.showShared', { count: String(shared.length) })}
            />
          )}
        </Box>
      )}
      {query.trim() && shownNotes.length === 0 && shownShared.length === 0 && (
        <Typography color="text.secondary">{t('notes.noMatch')}</Typography>
      )}
      {notes && notes.length === 0 && !query.trim() && (
        <Paper variant="outlined"><EmptyState icon={<EditIcon fontSize="inherit" />} title={t('notes.empty')} /></Paper>
      )}
      {shownNotes.map((n) => (
        <Paper key={n.id} id={`note-${n.id}`} variant="outlined" sx={{ p: 2, ...mark(n.id) }}>
          {editing?.id === n.id ? (
            <>
              <NoteEditor text={editing.text} onChange={(v) => setEditing({ id: n.id, text: v })} autoFocus />
              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button onClick={() => setEditing(null)} disabled={busy}>{t('common.cancel')}</Button>
                <Button variant="contained" disabled={busy || !editing.text.trim() || editing.text === n.text} onClick={() => void save()}>{t('common.save')}</Button>
              </Box>
            </>
          ) : body(n.id, n.text)}
          {(n.shared_with?.length ?? 0) > 0 && (
            <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">{t('notes.sharedWith')}</Typography>
              {n.shared_with!.map((s) => (
                <Chip key={s.userId} size="small" label={s.name} onDelete={() => void unshare(n.id, s.userId)} />
              ))}
            </Box>
          )}
          {editing?.id !== n.id && <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">{formatLocaleDateTime(n.created_at, locale)}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              <Button size="small" onClick={() => setEditing({ id: n.id, text: n.text })}>{t('notes.edit')}</Button>
              <Button size="small" onClick={() => toggleSource(n.id)}>{t(source.has(n.id) ? 'notes.preview' : 'notes.source')}</Button>
              <Button size="small" onClick={() => setSharing(n)}>{t('notes.share')}</Button>
              <Button size="small" onClick={() => setMailing(n)}>{t('notes.mail')}</Button>
              <Button size="small" onClick={() => void copyLink(n.id)}>{t('notes.copyLink')}</Button>
              <Button size="small" color="error" onClick={() => setDeleting(n)}>{t('notes.delete')}</Button>
            </Box>
          </Box>}
        </Paper>
      ))}

      {shownShared.length > 0 && (
        <>
          <Typography variant="h6" sx={{ pt: 1 }}>{t('notes.sharedWithMe')}</Typography>
          {shownShared.map((n) => (
            <Paper key={n.id} id={`note-${n.id}`} variant="outlined" sx={{ p: 2, bgcolor: 'action.hover', ...mark(n.id) }}>
              <Typography variant="caption" color="text.secondary">{t('notes.from', { name: n.author })}</Typography>
              <Box sx={{ mt: 0.5 }}>{body(n.id, n.text)}</Box>
              <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">{formatLocaleDateTime(n.created_at, locale)}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Button size="small" onClick={() => toggleSource(n.id)}>{t(source.has(n.id) ? 'notes.preview' : 'notes.source')}</Button>
                  <Button size="small" onClick={() => void unshare(n.id, 'me')}>{t('notes.hide')}</Button>
                </Box>
              </Box>
            </Paper>
          ))}
        </>
      )}

      <ConfirmDialog
        open={!!deleting}
        title={t('notes.delete')}
        message={t('notes.deleteConfirm')}
        confirmLabel={t('notes.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const data = await call(`/${deleting.id}`, { method: 'DELETE' });
          if (data?.ok) await load();
        }}
      />
      {sharing && (
        <ShareDialog orgId={orgId} authHeaders={authHeaders} onClose={() => setSharing(null)}
          onShare={async (userIds, departmentIds) => {
            setError(null);
            const data = await call(`/${sharing.id}/share`, { method: 'POST', body: JSON.stringify({ userIds, departmentIds }) });
            if (!data?.ok) return false;
            setSharing(null);
            setInfo(t('notes.shared', { count: String(data.added ?? 0) }));
            await load();
            return true;
          }} />
      )}
      {mailing && (
        <MailDialog onClose={() => setMailing(null)}
          onSend={async (addresses, message) => {
            setError(null);
            const data = await call(`/${mailing.id}/mail`, { method: 'POST', body: JSON.stringify({ addresses, message }) });
            if (!data?.ok) return false;
            setMailing(null);
            setInfo(data.failed ? t('notes.mailedPartly', { sent: String(data.sent), failed: String(data.failed) }) : t('notes.mailed', { count: String(data.sent) }));
            await load();
            return true;
          }} />
      )}
    </Stack>
  );
}

/** Colleagues and departments to share a note with (the directory: everyone sees it). */
function ShareDialog({ orgId, authHeaders, onClose, onShare }: {
  orgId: string; authHeaders: () => Promise<Record<string, string>>; onClose: () => void;
  onShare: (userIds: string[], departmentIds: string[]) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [people, setPeople] = useState<Person[]>([]);
  const [chosen, setChosen] = useState<Person[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void (async () => {
      try {
        const data = await (await fetch(`${API}/organizations/${orgId}/directory`, { headers: await authHeaders() })).json();
        setPeople(Array.isArray(data?.people) ? data.people : []);
      } catch { /* the dialog stays empty; sharing shows the API's error */ }
    })();
  }, [orgId, authHeaders]);
  const allDepartments = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of people) if (p.departmentId && p.department) map.set(p.departmentId, p.department);
    return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [people]);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('notes.shareTitle')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        <Typography variant="body2" color="text.secondary">{t('notes.shareHint')}</Typography>
        <Autocomplete multiple options={people} value={chosen} onChange={(_, v) => setChosen(v)} getOptionLabel={(p) => p.name}
          isOptionEqualToValue={(a, b) => a.userId === b.userId}
          renderInput={(params) => <TextField {...params} size="small" label={t('notes.people')} />} />
        <Autocomplete multiple options={allDepartments} value={departments} onChange={(_, v) => setDepartments(v)} getOptionLabel={(d) => d.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => <TextField {...params} size="small" label={t('notes.departments')} />} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={busy || (!chosen.length && !departments.length)} onClick={async () => {
          setBusy(true);
          const ok = await onShare(chosen.map((p) => p.userId), departments.map((d) => d.id));
          if (!ok) setBusy(false);
        }}>{t('notes.share')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Addresses (any, at most ten) and an optional message to forward a note by e-mail. */
function MailDialog({ onClose, onSend }: { onClose: () => void; onSend: (addresses: string[], message: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [addresses, setAddresses] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Addresses are taken from what is typed on Enter, a comma, semicolon or space, a paste, and when leaving the field.
  const take = (more: string[]) => setAddresses((prev) => [...new Set([...prev, ...more.flatMap(splitAddresses)])].slice(0, MAX_MAIL_ADDRESSES));
  const commit = () => { if (typed.trim()) { take([typed]); setTyped(''); } };
  const wrong = addresses.filter((a) => !isMailAddress(a));
  // What is still in the field counts too, so Send right after typing works.
  const pending = typed.trim() ? splitAddresses(typed) : [];
  const all = [...new Set([...addresses, ...pending])];
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{t('notes.mailTitle')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        <Typography variant="body2" color="text.secondary">{t('notes.mailHint')}</Typography>
        <Autocomplete
          multiple freeSolo options={[]} value={addresses} inputValue={typed}
          onChange={(_, v) => { setAddresses([]); take(v as string[]); }}
          onInputChange={(_, v, reason) => {
            if (reason === 'reset') return;
            // A separator typed or pasted ends an address.
            if (/[\s,;]/.test(v)) { take([v.replace(/[^\s,;]*$/, '')]); setTyped(v.replace(/^.*[\s,;]/, '')); } else setTyped(v);
          }}
          onBlur={commit}
          renderTags={(value, getTagProps) => value.map((a, i) => {
            const { key, ...props } = getTagProps({ index: i });
            return <Chip key={key} {...props} size="small" label={a} color={isMailAddress(a) ? 'default' : 'error'} variant={isMailAddress(a) ? 'filled' : 'outlined'} />;
          })}
          renderInput={(params) => (
            <TextField {...params} size="small" label={t('notes.addresses')} error={wrong.length > 0}
              helperText={wrong.length ? t('notes.error.invalid-address') : t('notes.addressesHint')} />
          )}
        />
        <TextField size="small" multiline minRows={2} label={t('notes.message')} value={message} onChange={(e) => setMessage(e.target.value)} inputProps={{ maxLength: 1000 }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" disabled={busy || all.length === 0 || all.some((a) => !isMailAddress(a))} onClick={async () => {
          commit();
          setBusy(true);
          const ok = await onSend(all, message);
          if (!ok) setBusy(false);
        }}>{t('notes.send')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Writing a note: the text or its preview (like VS Code's Markdown preview), with the syntax hint and the quick reference. */
function NoteEditor({ text, onChange, placeholder, autoFocus }: { text: string; onChange: (text: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  return (
    <>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36, mb: 1, '& .MuiTab-root': { minHeight: 36, py: 0.5 } }}>
        <Tab value="write" label={t('notes.write')} />
        <Tab value="preview" label={t('notes.preview')} disabled={!text.trim()} />
      </Tabs>
      {tab === 'write' ? (
        <TextField
          fullWidth
          multiline
          minRows={3}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          inputProps={{ maxLength: 2000 }}
          helperText={<>{t('notes.markdownHint')} · <MarkdownHelp /></>}
        />
      ) : (
        <Box sx={{ minHeight: 88, p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}><MarkdownView text={text} /></Box>
      )}
    </>
  );
}
