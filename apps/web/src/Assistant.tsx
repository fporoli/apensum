import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, Paper, TextField, Tooltip, Typography } from '@mui/material';
import { useT } from './i18n';
import { AutoAwesomeIcon, CloseIcon, HistoryIcon, PushPinIcon, RestartAltIcon, StarBorderIcon, StarIcon } from './icons';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
/** Budget refusals and Azure failures the API returns as codes (AiBudgetService, chatErrorCode). */
const ASSISTANT_ERRORS = ['ai-org-limit-reached', 'ai-budget-exhausted', 'ai-user-busy', 'ai-rate-limited', 'ai-provider-busy', 'ai-provider-unavailable'];
/** Recent questions shown before "show all". */
const RECENT_SHOWN = 6;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** One of the caller's past questions (assistant.controller.ts `assistant_prompts`). */
interface SavedPrompt {
  id: string;
  prompt: string;
  favorite: boolean;
}

interface AssistantProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  onClose?: () => void;
  /** Desktop: whether the panel is docked, and the pin button that docks or undocks it. */
  pinned?: boolean;
  onTogglePin?: () => void;
}

/** The same normalization as the API's normalizePrompt, to find a sent question among the saved ones. */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

export default function Assistant({ orgId, authHeaders, onClose, pinned, onTogglePin }: AssistantProps) {
  const t = useT();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedPrompt[]>([]);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch(`${API}/assistant/prompts?orgId=${encodeURIComponent(orgId)}`, { headers: await authHeaders() });
      const data = await res.json();
      if (data?.ok && Array.isArray(data.prompts)) setSaved(data.prompts);
    } catch { /* the list is a convenience; the chat works without it */ }
  }, [orgId, authHeaders]);

  useEffect(() => { void loadSaved(); }, [loadSaved]);

  /** Stars or unstars a question; shown at once, put back with an error if the API refuses. */
  async function setFavorite(item: SavedPrompt, favorite: boolean) {
    setSaved((list) => list.map((p) => (p.id === item.id ? { ...p, favorite } : p)));
    try {
      const res = await fetch(`${API}/assistant/prompts/${item.id}/favorite?orgId=${encodeURIComponent(orgId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ favorite }),
      });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error);
    } catch {
      setSaved((list) => list.map((p) => (p.id === item.id ? { ...p, favorite: !favorite } : p)));
      setError(t('assistant.favoriteFailed'));
    }
  }

  async function forget(item: SavedPrompt) {
    try {
      const res = await fetch(`${API}/assistant/prompts/${item.id}?orgId=${encodeURIComponent(orgId)}`, { method: 'DELETE', headers: await authHeaders() });
      const data = await res.json();
      if (!data?.ok) throw new Error(data?.error);
      setSaved((list) => list.filter((p) => p.id !== item.id));
    } catch {
      setError(t('assistant.forgetFailed'));
    }
  }

  async function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || sending) return;
    setError(null);
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    if (!overrideText) setInput('');
    setSending(true);
    try {
      const res = await fetch(`${API}/assistant/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ orgId, messages: nextMessages }),
      });
      const data = await res.json();
      if (!data.ok) {
        const message =
          data.error === 'assistant-not-configured' || data.error === 'ai-provider-not-configured'
            ? t('assistant.notConfigured')
            : data.error === 'forbidden'
              ? t('assistant.forbidden')
              : ASSISTANT_ERRORS.includes(data.error)
                ? t(`assistant.error.${data.error}`)
                : t('assistant.failed', { detail: data.detail ? `: ${data.detail}` : '' });
        setError(message);
        return;
      }
      const actionsNote = Array.isArray(data.actions) && data.actions.length > 0 ? `\n\n(${data.actions.join(' ')})` : '';
      setMessages([...nextMessages, { role: 'assistant', content: (data.reply || t('assistant.noReply')) + actionsNote }]);
      void loadSaved(); // the question is now among the recent ones (and can be starred)
    } catch {
      setError(t('assistant.unreachable'));
    } finally {
      setSending(false);
    }
  }

  const starterPrompts = [t('assistant.prompt1'), t('assistant.prompt2'), t('assistant.prompt3')];
  const favorites = saved.filter((p) => p.favorite);
  const recent = saved.filter((p) => !p.favorite);
  const savedFor = (text: string) => saved.find((p) => p.prompt === normalize(text));

  /** A saved question: click asks it again; the star and the cross keep or forget it. */
  const promptRow = (item: SavedPrompt) => (
    <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.25, '&:hover .forget': { opacity: 1 } }}>
      <Tooltip title={item.favorite ? t('assistant.unstar') : t('assistant.star')}>
        <IconButton size="small" aria-label={item.favorite ? t('assistant.unstar') : t('assistant.star')} onClick={() => void setFavorite(item, !item.favorite)}>
          {item.favorite ? <StarIcon fontSize="small" sx={{ color: '#f59e0b' }} /> : <StarBorderIcon fontSize="small" />}
        </IconButton>
      </Tooltip>
      <Chip
        label={item.prompt}
        size="small"
        variant="outlined"
        disabled={sending}
        onClick={() => void send(item.prompt)}
        title={t('assistant.askAgain')}
        sx={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', cursor: 'pointer', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
      />
      <IconButton className="forget" size="small" aria-label={t('assistant.forget')} title={t('assistant.forget')} onClick={() => void forget(item)}
        sx={{ opacity: { xs: 1, md: 0 }, transition: 'opacity 0.15s' }}>
        <CloseIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  );

  return (
    <Paper square elevation={0} sx={{ p: 2, display: 'flex', flexDirection: 'column', height: '100%', borderLeft: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
        <AutoAwesomeIcon fontSize="small" color="primary" />
        <Typography variant="h6" sx={{ flex: 1, ml: 0.5 }}>{t('assistant.title')}</Typography>
        {messages.length > 0 && (
          <Tooltip title={t('assistant.clear')}>
            <IconButton size="small" aria-label={t('assistant.clear')} onClick={() => { setMessages([]); setError(null); }}>
              <RestartAltIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
        {onTogglePin && (
          <Tooltip title={pinned ? t('app.assistantUnpin') : t('app.assistantPin')}>
            <IconButton size="small" aria-label={pinned ? t('app.assistantUnpin') : t('app.assistantPin')} aria-pressed={!!pinned} onClick={onTogglePin}
              color={pinned ? 'primary' : 'default'}>
              <PushPinIcon fontSize="small" sx={{ transform: pinned ? 'none' : 'rotate(45deg)', transition: 'transform 0.15s' }} />
            </IconButton>
          </Tooltip>
        )}
        {onClose && (
          <Tooltip title={t('assistant.close')}>
            <IconButton size="small" aria-label={t('assistant.close')} onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('assistant.subtitle')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Box sx={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
        {messages.length === 0 && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            {favorites.length > 0 && (
              <Box sx={{ display: 'grid', gap: 0.5 }}>
                <Typography variant="overline" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, lineHeight: 1.5 }}>
                  <StarIcon sx={{ fontSize: 14, color: '#f59e0b' }} /> {t('assistant.favorites')}
                </Typography>
                {favorites.map(promptRow)}
              </Box>
            )}
            {recent.length > 0 && (
              <Box sx={{ display: 'grid', gap: 0.5 }}>
                <Typography variant="overline" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, lineHeight: 1.5 }}>
                  <HistoryIcon sx={{ fontSize: 14 }} /> {t('assistant.recent')}
                </Typography>
                {(showAllRecent ? recent : recent.slice(0, RECENT_SHOWN)).map(promptRow)}
                {recent.length > RECENT_SHOWN && (
                  <Button size="small" sx={{ justifySelf: 'start' }} onClick={() => setShowAllRecent((v) => !v)}>
                    {showAllRecent ? t('assistant.showLess') : t('assistant.showAll', { count: recent.length })}
                  </Button>
                )}
              </Box>
            )}
            {saved.length === 0 && (
              <Box sx={{ display: 'grid', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">{t('assistant.empty')}</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.75, mt: 0.5 }}>
                  {starterPrompts.map((prompt) => (
                    <Chip
                      key={prompt}
                      label={prompt}
                      size="small"
                      variant="outlined"
                      onClick={() => void send(prompt)}
                      sx={{ cursor: 'pointer', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.5 } }}
                    />
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        )}
        {messages.map((m, i) => {
          const item = m.role === 'user' ? savedFor(m.content) : undefined;
          return (
            <Box key={i} sx={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', display: 'flex', alignItems: 'center', gap: 0.5, '&:hover .star': { opacity: 1 } }}>
              {item && (
                <IconButton className="star" size="small" aria-label={item.favorite ? t('assistant.unstar') : t('assistant.star')} title={item.favorite ? t('assistant.unstar') : t('assistant.star')}
                  onClick={() => void setFavorite(item, !item.favorite)} sx={{ opacity: item.favorite ? 1 : { xs: 1, md: 0 }, transition: 'opacity 0.15s' }}>
                  {item.favorite ? <StarIcon fontSize="small" sx={{ color: '#f59e0b' }} /> : <StarBorderIcon fontSize="small" />}
                </IconButton>
              )}
              <Box
                sx={{
                  bgcolor: m.role === 'user' ? 'primary.main' : 'action.hover',
                  color: m.role === 'user' ? 'primary.contrastText' : 'text.primary',
                  px: 1.5,
                  py: 1,
                  borderRadius: 2,
                  whiteSpace: 'pre-wrap',
                }}
              >
                <Typography variant="body2">{m.content}</Typography>
              </Box>
            </Box>
          );
        })}
        {sending && <Chip label={t('assistant.thinking')} size="small" sx={{ alignSelf: 'flex-start' }} />}
        <div ref={bottomRef} />
      </Box>

      <Box
        component="form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        sx={{ display: 'flex', gap: 1 }}
      >
        <TextField
          fullWidth
          size="small"
          autoFocus
          placeholder={t('assistant.placeholder')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={sending}
        />
        <Button type="submit" variant="contained" disabled={sending || !input.trim()}>{t('assistant.send')}</Button>
      </Box>
    </Paper>
  );
}
