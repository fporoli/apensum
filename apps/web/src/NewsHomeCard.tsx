import { useEffect, useState } from 'react';
import { Box, Button, Chip, List, ListItemButton, ListItemText, Paper, Typography } from '@mui/material';
import { useI18n } from './i18n';
import { CampaignIcon } from './icons';
import { formatLocaleDateTime } from './localeFormat';
import { newsTextFor, type NewsTexts } from '@worktime3/shared/news';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

interface Post {
  id: string;
  texts: NewsTexts;
  require_ack: boolean;
  published_at: string | null;
  read_at: string | null;
  acknowledged_at: string | null;
}

/**
 * Home: the news the caller has not read (or not confirmed) yet, newest first, at most three.
 * Nothing when there is none, or when the News module is off (the list is then empty).
 */
export default function NewsHomeCard({ orgId, authHeaders }: { orgId: string; authHeaders: () => Promise<Record<string, string>> }) {
  const { t, locale } = useI18n();
  const [posts, setPosts] = useState<Post[]>([]);
  const lang = (locale ?? 'de').slice(0, 2);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API}/organizations/${orgId}/news`, { headers: await authHeaders() });
        const data = await res.json();
        const list = (Array.isArray(data?.posts) ? data.posts : []) as Post[];
        if (!cancelled) setPosts(list.filter((p) => p.published_at && (!p.read_at || (p.require_ack && !p.acknowledged_at))));
      } catch {
        /* Home works without it */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, authHeaders]);

  if (posts.length === 0) return null;
  const open = (id?: string) => {
    window.location.hash = id ? `#/news?id=${id}` : '#/news';
  };
  return (
    <Paper variant="outlined" sx={{ p: 2, borderColor: 'primary.main' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <CampaignIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          {t('news.home.title', { count: String(posts.length) })}
        </Typography>
        <Button size="small" onClick={() => open()}>
          {t('news.home.all')}
        </Button>
      </Box>
      <List dense disablePadding>
        {posts.slice(0, 3).map((p) => {
          const text = newsTextFor(p.texts, lang);
          return (
            <ListItemButton key={p.id} onClick={() => open(p.id)} sx={{ borderRadius: 1 }}>
              <ListItemText
                primary={
                  <Box component="span" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Box component="span" sx={{ fontWeight: 600 }} lang={text?.lang}>
                      {text?.title}
                    </Box>
                    {p.require_ack && !p.acknowledged_at && <Chip size="small" color="info" variant="outlined" label={t('news.requiresAck')} />}
                  </Box>
                }
                secondary={p.published_at ? formatLocaleDateTime(p.published_at, locale) : undefined}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Paper>
  );
}
