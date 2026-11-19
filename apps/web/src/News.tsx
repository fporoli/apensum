import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useI18n } from './i18n';
import { ConfirmDialog, EmptyState, PageHeader } from './components';
import { AddIcon, CampaignIcon, CheckCircleIcon, ChevronLeftIcon, DeleteIcon, EditIcon, ImageIcon, VisibilityIcon } from './icons';
import { formatLocaleDateTime } from './localeFormat';
import { renderMarkdown, safeHref, unescapeHtml } from '@worktime3/shared/markdown';
import { NEWS_LANGS, newsImageId, newsTextFor, type NewsLang, type NewsTexts } from '@worktime3/shared/news';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Post {
  id: string;
  texts: NewsTexts;
  require_ack: boolean;
  published_at: string | null;
  /** Product news: from a superdeveloper to every organization's admins. */
  product: boolean;
  author_user_id: string | null;
  author_name: string | null;
  department_ids: string[];
  read_at: string | null;
  acknowledged_at: string | null;
}

interface Department {
  id: string;
  name: string;
  is_active: boolean;
}

interface ReadRow {
  userId: string;
  name: string;
  /** Product news: the organizations the person administers. */
  organizations: string[];
  readAt: string | null;
  acknowledgedAt: string | null;
}

interface Draft {
  id: string | null;
  texts: Record<NewsLang, { title: string; body: string }>;
  departmentIds: string[];
  requireAck: boolean;
  /** Product news (only when creating; it stays what it is). */
  product: boolean;
}

const emptyTexts = () => Object.fromEntries(NEWS_LANGS.map((l) => [l, { title: '', body: '' }])) as Draft['texts'];

/** A post's Markdown as HTML: pictures are placeholders the PostBody fills with the post's files. */
function postHtml(body: string): string {
  return renderMarkdown(body, {
    image: (src, alt) => {
      const id = newsImageId(unescapeHtml(src));
      return id ? `<img data-news-image="${id}" alt="${alt}">` : alt;
    },
    link: (href, label) => (safeHref(unescapeHtml(href)) ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : label),
  });
}

/**
 * A post's text. Pictures need the caller's credentials, so each is fetched and shown from a
 * blob URL. The HTML comes from renderMarkdown, which escapes everything it is given.
 */
function PostBody({ orgId, postId, body, authHeaders }: { orgId: string; postId: string | null; body: string; authHeaders: () => Promise<Record<string, string>> }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => postHtml(body), [body]);
  useEffect(() => {
    const root = ref.current;
    if (!root || !postId) return;
    const urls: string[] = [];
    let cancelled = false;
    (async () => {
      const headers = await authHeaders();
      for (const img of Array.from(root.querySelectorAll<HTMLImageElement>('img[data-news-image]'))) {
        try {
          const res = await fetch(`${API}/organizations/${orgId}/news/${postId}/images/${img.dataset.newsImage}`, { headers });
          if (!res.ok || cancelled) continue;
          const url = URL.createObjectURL(await res.blob());
          urls.push(url);
          img.src = url;
        } catch {
          /* the alt text stays */
        }
      }
    })();
    return () => {
      cancelled = true;
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [html, orgId, postId, authHeaders]);
  return (
    <Box
      ref={ref}
      className="news-body"
      sx={{
        '& h2': { typography: 'h6', mt: 2.5, mb: 1 },
        '& h3': { typography: 'subtitle1', fontWeight: 600, mt: 2, mb: 0.5 },
        '& p, & li': { typography: 'body1', lineHeight: 1.65 },
        '& p': { my: 1 },
        '& img': { maxWidth: '100%', height: 'auto', borderRadius: 1, border: 1, borderColor: 'divider' },
        '& figure': { m: 0, my: 2 },
        '& blockquote': { m: 0, my: 1.5, pl: 2, borderLeft: 3, borderColor: 'primary.main', color: 'text.secondary' },
        '& code': { fontFamily: 'monospace', bgcolor: 'action.hover', px: 0.5, borderRadius: 0.5 },
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

interface NewsProps {
  orgId: string;
  userId: string | null;
  authHeaders: () => Promise<Record<string, string>>;
  /** Changes when a notification arrives, so the list reloads. */
  refreshKey?: unknown;
  /** After reading or a change, so the navbar badge can refresh. */
  onChanged?: () => void;
}

/**
 * News: posts by the organization's admin or HR (nav.news:edit) to everyone or some departments.
 * Readers open a post (marked read) and confirm it when asked; writers draft, publish (notifying
 * the audience, optionally by e-mail), correct and delete posts and see who read them.
 */
export default function News({ orgId, authHeaders, refreshKey, onChanged }: NewsProps) {
  const { t, locale } = useI18n();
  const [posts, setPosts] = useState<Post[]>([]);
  const [editor, setEditor] = useState(false);
  const [productEditor, setProductEditor] = useState(false);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id'));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [publishing, setPublishing] = useState<Post | null>(null);
  const [deleting, setDeleting] = useState<Post | null>(null);
  const [reads, setReads] = useState<ReadRow[] | null>(null);
  const lang = (locale ?? 'de').slice(0, 2);

  const errorText = useCallback(
    (code: string | undefined) => {
      const key = `news.error.${code}`;
      const text = t(key);
      return text === key ? t('news.error.failed', { error: code ?? t('common.unknownError') }) : text;
    },
    [t],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const headers = await authHeaders();
      const [list, deps] = await Promise.all([
        fetch(`${API}/organizations/${orgId}/news`, { headers }).then((r) => r.json()),
        fetch(`${API}/organizations/${orgId}/departments`, { headers }).then((r) => r.json()),
      ]);
      setPosts(Array.isArray(list?.posts) ? list.posts : []);
      setEditor(list?.editor === true);
      setProductEditor(list?.productEditor === true);
      setDepartments(Array.isArray(deps?.departments) ? deps.departments : []);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setLoading(false);
    }
  }, [authHeaders, orgId, t]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // A link to one post (`#/news?id=...`, from a notification or an e-mail) opens it.
  useEffect(() => {
    const onHash = () => {
      const id = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('id');
      if (id) setSelectedId(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const selected = posts.find((p) => p.id === selectedId) ?? null;

  const post = useCallback(
    async (path: string, body?: unknown, method = 'POST') => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/news${path}`, {
          method,
          headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await res.json();
        if (!data?.ok) setError(errorText(data?.error));
        return data;
      } catch {
        setError(t('common.cannotReachApi'));
        return null;
      }
    },
    [authHeaders, orgId, errorText, t],
  );

  // Opening a published post marks it read.
  useEffect(() => {
    if (!selected?.published_at || selected.read_at) return;
    void (async () => {
      const data = await post(`/${selected.id}/read`);
      if (data?.ok) {
        setPosts((list) => list.map((p) => (p.id === selected.id ? { ...p, read_at: new Date().toISOString() } : p)));
        onChanged?.();
      }
    })();
  }, [selected, post, onChanged]);

  useEffect(() => {
    setReads(null);
    if (!selected?.published_at || !(selected.product ? productEditor : editor)) return;
    void (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/news/${selected.id}/reads`, { headers: await authHeaders() });
        const data = await res.json();
        if (data?.ok) setReads(data.people);
      } catch {
        /* the list just stays hidden */
      }
    })();
  }, [editor, productEditor, selected, orgId, authHeaders]);

  function open(id: string | null) {
    setSelectedId(id);
    setError(null);
    setNotice(null);
    const hash = id ? `#/news?id=${id}` : '#/news';
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }

  function startEdit(p: Post | null) {
    const texts = emptyTexts();
    if (p) for (const l of NEWS_LANGS) if (p.texts[l]) texts[l] = { title: p.texts[l]!.title, body: p.texts[l]!.body };
    setDraft({ id: p?.id ?? null, texts, departmentIds: p?.department_ids ?? [], requireAck: p?.require_ack ?? false, product: p ? p.product : !editor });
  }

  async function acknowledge(p: Post) {
    const data = await post(`/${p.id}/acknowledge`);
    if (data?.ok) {
      await load();
      onChanged?.();
    }
  }

  async function publish(p: Post, mail: boolean) {
    const data = await post(`/${p.id}/publish`, { mail });
    if (data?.ok) {
      setNotice(t('news.published', { count: String(data.notified ?? 0) }));
      await load();
      onChanged?.();
    }
  }

  async function remove(p: Post) {
    const data = await post(`/${p.id}`, undefined, 'DELETE');
    if (data?.ok) {
      open(null);
      await load();
      onChanged?.();
    }
  }

  /** Organization posts are changed by the organization's news writers, product news by a superdeveloper. */
  const canEdit = (p: Post) => (p.product ? productEditor : editor);
  const audienceChips = (p: Post) =>
    p.product ? (
      <Chip size="small" variant="outlined" label={t('news.product.audience')} />
    ) : p.department_ids.length > 0 ? (
      p.department_ids.map((d) => <Chip key={d} size="small" variant="outlined" label={depName(d)} />)
    ) : (
      <Chip size="small" variant="outlined" label={t('news.everyone')} />
    );
  const depName = (id: string) => departments.find((d) => d.id === id)?.name ?? '?';
  const unread = (p: Post) => !!p.published_at && (!p.read_at || (p.require_ack && !p.acknowledged_at));

  const header = (
    <PageHeader
      title={t('news.title')}
      subtitle={t('news.subtitle')}
      end={
        (editor || productEditor) && !selected ? (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => startEdit(null)}>
            {t('news.new')}
          </Button>
        ) : undefined
      }
    />
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {header}
      {loading && <LinearProgress />}
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {notice && <Alert severity="success" onClose={() => setNotice(null)}>{notice}</Alert>}

      {selected ? (
        <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
          <Button size="small" startIcon={<ChevronLeftIcon />} onClick={() => open(null)} sx={{ mb: 1 }}>
            {t('news.back')}
          </Button>
          {(() => {
            const text = newsTextFor(selected.texts, lang);
            return (
              <>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 1 }}>
                  {!selected.published_at && <Chip size="small" color="warning" label={t('news.draft')} />}
                  {selected.require_ack && <Chip size="small" color="info" variant="outlined" label={t('news.requiresAck')} />}
                  {selected.product && <Chip size="small" color="primary" label={t('news.product.label')} />}
                  {audienceChips(selected)}
                </Box>
                <Typography variant="h5" component="h2" lang={text?.lang}>
                  {text?.title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {[selected.published_at ? formatLocaleDateTime(selected.published_at, locale) : null, selected.author_name].filter(Boolean).join(' · ')}
                </Typography>
                <Box lang={text?.lang}>
                  <PostBody orgId={orgId} postId={selected.id} body={text?.body ?? ''} authHeaders={authHeaders} />
                </Box>
              </>
            );
          })()}

          {selected.published_at && selected.require_ack && (
            <Box sx={{ mt: 3 }}>
              {selected.acknowledged_at ? (
                <Alert severity="success" icon={<CheckCircleIcon />}>
                  {t('news.acknowledgedAt', { date: formatLocaleDateTime(selected.acknowledged_at, locale) })}
                </Alert>
              ) : (
                <Alert severity="info" action={<Button color="inherit" variant="outlined" size="small" onClick={() => void acknowledge(selected)}>{t('news.acknowledge')}</Button>}>
                  {t('news.acknowledgeText')}
                </Alert>
              )}
            </Box>
          )}

          {canEdit(selected) && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 3 }}>
              {!selected.published_at && (
                <Button variant="contained" startIcon={<CampaignIcon />} onClick={() => setPublishing(selected)}>
                  {t('news.publish')}
                </Button>
              )}
              <Button variant="outlined" startIcon={<EditIcon />} onClick={() => startEdit(selected)}>
                {t('news.edit')}
              </Button>
              <Button color="error" startIcon={<DeleteIcon />} onClick={() => setDeleting(selected)}>
                {t('news.delete')}
              </Button>
            </Box>
          )}

          {canEdit(selected) && reads && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('news.reads.title', { read: String(reads.filter((r) => r.readAt).length), total: String(reads.length) })}
                {selected.require_ack ? ` · ${t('news.reads.acknowledged', { count: String(reads.filter((r) => r.acknowledgedAt).length) })}` : ''}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {reads.map((r) => {
                  const done = selected.require_ack ? !!r.acknowledgedAt : !!r.readAt;
                  const when = selected.require_ack ? r.acknowledgedAt : r.readAt;
                  return (
                    <Chip
                      key={r.userId}
                      size="small"
                      color={done ? 'success' : 'default'}
                      variant={done ? 'filled' : 'outlined'}
                      icon={done ? <CheckCircleIcon /> : r.readAt ? <VisibilityIcon /> : undefined}
                      label={r.organizations.length ? `${r.name} (${r.organizations.join(', ')})` : r.name}
                      title={when ? formatLocaleDateTime(when, locale) : t('news.reads.notYet')}
                    />
                  );
                })}
              </Box>
            </Box>
          )}
        </Paper>
      ) : posts.length === 0 && !loading ? (
        <Paper variant="outlined">
          <EmptyState icon={<CampaignIcon fontSize="inherit" />} title={t('news.empty')} description={editor || productEditor ? t('news.emptyEditor') : undefined} />
        </Paper>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {posts.map((p, i) => {
              const text = newsTextFor(p.texts, lang);
              return (
                <ListItemButton key={p.id} divider={i < posts.length - 1} onClick={() => open(p.id)} sx={{ alignItems: 'flex-start', gap: 1.5 }}>
                  <Box sx={{ width: 8, height: 8, mt: 1, borderRadius: '50%', flexShrink: 0, bgcolor: unread(p) ? 'primary.main' : 'transparent' }} />
                  <ListItemText
                    primary={
                      <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Box component="span" sx={{ fontWeight: unread(p) ? 700 : 500 }} lang={text?.lang}>
                          {text?.title}
                        </Box>
                        {p.product && <Chip size="small" color="primary" label={t('news.product.label')} />}
                        {!p.published_at && <Chip size="small" color="warning" label={t('news.draft')} />}
                        {p.require_ack && !p.acknowledged_at && p.published_at && <Chip size="small" color="info" variant="outlined" label={t('news.requiresAck')} />}
                      </Box>
                    }
                    secondary={[p.published_at ? formatLocaleDateTime(p.published_at, locale) : null, p.author_name].filter(Boolean).join(' · ')}
                  />
                </ListItemButton>
              );
            })}
          </List>
        </Paper>
      )}

      {draft && (
        <PostEditor
          orgId={orgId}
          draft={draft}
          departments={departments}
          canChooseProduct={editor && productEditor}
          authHeaders={authHeaders}
          errorText={errorText}
          onClose={() => setDraft(null)}
          onSaved={async (id) => {
            setDraft(null);
            await load();
            open(id);
          }}
        />
      )}

      <PublishDialog
        post={publishing}
        onClose={() => setPublishing(null)}
        onPublish={async (mail) => {
          const p = publishing;
          setPublishing(null);
          if (p) await publish(p, mail);
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title={t('news.delete')}
        message={t('news.deleteConfirm')}
        confirmLabel={t('news.delete')}
        cancelLabel={t('common.cancel')}
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (deleting) await remove(deleting);
        }}
      />
    </Box>
  );
}

function PublishDialog({ post, onClose, onPublish }: { post: Post | null; onClose: () => void; onPublish: (mail: boolean) => void }) {
  const { t } = useI18n();
  const [mail, setMail] = useState(false);
  useEffect(() => setMail(false), [post]);
  return (
    <Dialog open={!!post} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('news.publish')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {post?.product ? t('news.product.publishText') : post?.department_ids.length ? t('news.publishTextDepartments') : t('news.publishText')}
        </Typography>
        <FormControlLabel control={<Checkbox checked={mail} onChange={(e) => setMail(e.target.checked)} />} label={t('news.publishMail')} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" startIcon={<CampaignIcon />} onClick={() => onPublish(mail)}>
          {t('news.publish')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Writing a post: a title and Markdown text per language, pictures, audience and the confirmation flag. */
function PostEditor({
  orgId,
  draft: initial,
  departments,
  canChooseProduct,
  authHeaders,
  errorText,
  onClose,
  onSaved,
}: {
  orgId: string;
  draft: Draft;
  departments: Department[];
  /** A superdeveloper who also writes this organization's news chooses which a new post is. */
  canChooseProduct: boolean;
  authHeaders: () => Promise<Record<string, string>>;
  errorText: (code: string | undefined) => string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const userLang = ((locale ?? 'de').slice(0, 2) as NewsLang) ?? 'de';
  const [draft, setDraft] = useState<Draft>(initial);
  const [lang, setLang] = useState<NewsLang>(() => NEWS_LANGS.find((l) => initial.texts[l].title) ?? (NEWS_LANGS.includes(userLang) ? userLang : 'de'));
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const setText = (field: 'title' | 'body', value: string) =>
    setDraft((d) => ({ ...d, texts: { ...d.texts, [lang]: { ...d.texts[lang], [field]: value } } }));

  /** Saves the post (creating it the first time); returns its id, or null with the error shown. */
  async function save(): Promise<string | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/organizations/${orgId}/news${draft.id ? `/${draft.id}` : ''}`, {
        method: draft.id ? 'PUT' : 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: draft.texts, departmentIds: draft.product ? [] : draft.departmentIds, requireAck: draft.requireAck, product: draft.product }),
      });
      const data = await res.json();
      if (!data?.ok) {
        setError(errorText(data?.error));
        return null;
      }
      const id = draft.id ?? (data.id as string);
      setDraft((d) => ({ ...d, id }));
      return id;
    } catch {
      setError(t('common.cannotReachApi'));
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Uploads a picture (saving a new post first, since pictures belong to a post) and puts it at the cursor. */
  async function addImage(file: File) {
    const id = draft.id ?? (await save());
    if (!id) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const res = await fetch(`${API}/organizations/${orgId}/news/${id}/images`, { method: 'POST', headers: await authHeaders(), body: form });
      const data = await res.json();
      if (!data?.ok) {
        setError(errorText(data?.error));
        return;
      }
      const alt = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[[\]]/g, '');
      const snippet = `\n\n![${alt}](doc:${data.documentId})\n\n`;
      const body = draft.texts[lang].body;
      const at = bodyRef.current?.selectionStart ?? body.length;
      setText('body', `${body.slice(0, at)}${snippet}${body.slice(at)}`.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, ''));
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  }

  const filled = (l: NewsLang) => !!(draft.texts[l].title || draft.texts[l].body);

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{draft.id ? t('news.edit') : t('news.new')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        <Tabs value={lang} onChange={(_, v) => setLang(v)} variant="scrollable">
          {NEWS_LANGS.map((l) => (
            <Tab key={l} value={l} label={`${l.toUpperCase()}${filled(l) ? ' •' : ''}`} />
          ))}
        </Tabs>
        <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
          {t('news.editor.languagesHint')}
        </Typography>
        <TextField label={t('news.editor.title')} value={draft.texts[lang].title} onChange={(e) => setText('title', e.target.value)} fullWidth inputProps={{ maxLength: 200 }} />
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button size="small" variant={preview ? 'outlined' : 'contained'} onClick={() => setPreview(false)}>
            {t('news.editor.write')}
          </Button>
          <Button size="small" variant={preview ? 'contained' : 'outlined'} onClick={() => setPreview(true)}>
            {t('news.editor.preview')}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<ImageIcon />} disabled={busy || preview} onClick={() => fileRef.current?.click()}>
            {t('news.editor.image')}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void addImage(f);
            }}
          />
        </Box>
        {preview ? (
          <Paper variant="outlined" sx={{ p: 2, minHeight: 240 }}>
            <Typography variant="h6" sx={{ mb: 1 }}>{draft.texts[lang].title}</Typography>
            <PostBody orgId={orgId} postId={draft.id} body={draft.texts[lang].body} authHeaders={authHeaders} />
          </Paper>
        ) : (
          <TextField
            inputRef={bodyRef}
            label={t('news.editor.body')}
            value={draft.texts[lang].body}
            onChange={(e) => setText('body', e.target.value)}
            onPaste={(e) => {
              const file = Array.from(e.clipboardData.files).find((f) => f.type.startsWith('image/'));
              if (file) {
                e.preventDefault();
                void addImage(file);
              }
            }}
            multiline
            minRows={10}
            fullWidth
            helperText={t('news.editor.markdownHint')}
          />
        )}
        {!draft.id && canChooseProduct && (
          <FormControlLabel
            control={<Checkbox checked={draft.product} onChange={(e) => setDraft((d) => ({ ...d, product: e.target.checked }))} />}
            label={t('news.product.choose')}
          />
        )}
        {draft.product ? (
          <Alert severity="info">{t('news.product.hint')}</Alert>
        ) : (
          <TextField
            select
            label={t('news.editor.audience')}
            value={draft.departmentIds}
            onChange={(e) => {
              const v = e.target.value as unknown as string[];
              setDraft((d) => ({ ...d, departmentIds: typeof v === 'string' ? [v] : v }));
            }}
            SelectProps={{
              multiple: true,
              displayEmpty: true,
              renderValue: (v) => {
                const ids = v as string[];
                return ids.length ? ids.map((id) => departments.find((d) => d.id === id)?.name ?? '?').join(', ') : t('news.everyone');
              },
            }}
            InputLabelProps={{ shrink: true }}
            helperText={t('news.editor.audienceHint')}
            fullWidth
          >
            {departments
              .filter((d) => d.is_active || draft.departmentIds.includes(d.id))
              .map((d) => (
                <MenuItem key={d.id} value={d.id}>
                  <Checkbox size="small" checked={draft.departmentIds.includes(d.id)} sx={{ py: 0 }} />
                  {d.name}
                </MenuItem>
              ))}
          </TextField>
        )}
        <FormControlLabel
          control={<Checkbox checked={draft.requireAck} onChange={(e) => setDraft((d) => ({ ...d, requireAck: e.target.checked }))} />}
          label={t('news.editor.requireAck')}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="contained"
          disabled={busy}
          onClick={async () => {
            const id = await save();
            if (id) onSaved(id);
          }}
        >
          {t('news.editor.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
