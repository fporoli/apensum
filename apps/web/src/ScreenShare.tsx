import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, TextField, Typography } from '@mui/material';
import { useT } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
const FRAME_EVERY_MS = 1000;
const MAX_WIDTH = 1400;

/** Desktop browsers only: phones cannot capture the screen. */
export function canShareScreen(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

type Headers = () => Promise<Record<string, string>>;

interface Running {
  id: string;
  orgId: string;
  viewerName: string;
  stream: MediaStream;
  until: number;
}

/** What opens the dialog: the menu, or someone's ask (their id is preselected). */
export interface ShareRequest {
  orgId: string;
  viewerId?: string;
}

/**
 * Show my screen (screen-share.service.ts): pick a colleague, pick the tab in the browser's own dialog,
 * and a bar stays until it is stopped. Pictures go out once a second; nothing can be clicked by the viewer.
 */
export function ScreenSharer({ request, userId, authHeaders, onClose }: { request: ShareRequest | null; userId: string; authHeaders: Headers; onClose: () => void }) {
  const t = useT();
  const [people, setPeople] = useState<{ user_id: string; display_name: string }[]>([]);
  const [viewerId, setViewerId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Running | null>(null);
  const [watching, setWatching] = useState(false);
  const [ended, setEnded] = useState(false);
  const headers = useRef(authHeaders);
  headers.current = authHeaders;

  useEffect(() => {
    if (!request) return;
    setError(null);
    setEnded(false);
    setViewerId(request.viewerId ?? '');
    void (async () => {
      try {
        const res = await fetch(`${API}/organizations/${request.orgId}/members`, { headers: await headers.current() });
        const data = await res.json();
        if (Array.isArray(data)) {
          setPeople(
            data
              .filter((m) => m.status === 'active' && m.user_id !== userId)
              .sort((a, b) => String(a.display_name).localeCompare(String(b.display_name))),
          );
        }
      } catch {
        setError(t('common.cannotReachApi'));
      }
    })();
  }, [request, userId, t]);

  const start = async () => {
    if (!request) return;
    setError(null);
    let stream: MediaStream;
    try {
      // First thing after the click: browsers open the picker only on a user's action.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser', frameRate: 2 },
        audio: false,
        preferCurrentTab: true,
      } as DisplayMediaStreamOptions);
    } catch {
      setError(t('screenShare.cancelled'));
      return;
    }
    const release = () => stream.getTracks().forEach((track) => track.stop());
    if (stream.getVideoTracks()[0]?.getSettings().displaySurface === 'monitor') {
      release();
      setError(t('screenShare.notWholeScreen'));
      return;
    }
    try {
      const res = await fetch(`${API}/organizations/${request.orgId}/screen-shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await headers.current()) },
        body: JSON.stringify({ viewerId }),
      });
      const data = await res.json();
      if (!data?.ok || !data.id) {
        release();
        setError(t('screenShare.failed', { error: data?.error ?? t('common.unknownError') }));
        return;
      }
      setWatching(false);
      setRunning({
        id: data.id,
        orgId: request.orgId,
        viewerName: people.find((p) => p.user_id === viewerId)?.display_name ?? '',
        stream,
        until: Date.parse(data.until),
      });
      onClose();
    } catch {
      release();
      setError(t('common.cannotReachApi'));
    }
  };

  useEffect(() => {
    if (!running) return;
    const { id, orgId, stream, until } = running;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => {});
    const canvas = document.createElement('canvas');
    let over = false;
    let timer = 0;
    const finish = () => {
      if (over) return;
      setRunning(null);
      setEnded(true);
    };
    stream.getVideoTracks()[0]?.addEventListener('ended', finish);
    const tick = async () => {
      if (Date.now() >= until) return finish();
      try {
        if (video.videoWidth) {
          const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.6));
          if (blob && !over) {
            const form = new FormData();
            form.append('file', blob, 'screen.jpg');
            const res = await fetch(`${API}/organizations/${orgId}/screen-shares/${id}/frame`, { method: 'POST', headers: await headers.current(), body: form });
            const data = await res.json();
            if (data?.error === 'share-ended' || data?.error === 'forbidden') return finish();
            setWatching(data?.watching === true);
          }
        }
      } catch {
        /* a lost picture: the next one follows */
      }
      if (!over) timer = window.setTimeout(() => void tick(), FRAME_EVERY_MS);
    };
    void tick();
    return () => {
      over = true;
      window.clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
      void (async () => {
        try {
          await fetch(`${API}/organizations/${orgId}/screen-shares/${id}`, { method: 'DELETE', headers: await headers.current() });
        } catch {
          /* it ends by itself without pictures */
        }
      })();
    };
  }, [running]);

  return (
    <>
      <Dialog open={!!request} onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>{t('screenShare.title')}</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2 }}>
          <Typography variant="body2" color="text.secondary">{t('screenShare.explain')}</Typography>
          <Alert severity="warning">{t('screenShare.warning')}</Alert>
          {error && <Alert severity="error">{error}</Alert>}
          {!canShareScreen() ? (
            <Alert severity="info">{t('screenShare.unsupported')}</Alert>
          ) : (
            <TextField select size="small" label={t('screenShare.with')} value={people.some((p) => p.user_id === viewerId) ? viewerId : ''} onChange={(e) => setViewerId(e.target.value)} sx={{ mt: 1 }}>
              {people.map((p) => (<MenuItem key={p.user_id} value={p.user_id}>{p.display_name}</MenuItem>))}
            </TextField>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="contained" disabled={!canShareScreen() || !people.some((p) => p.user_id === viewerId)} onClick={() => void start()}>
            {t('screenShare.start')}
          </Button>
        </DialogActions>
      </Dialog>

      {(running || ended) && (
        <Paper
          role="status"
          elevation={6}
          sx={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', zIndex: (th) => th.zIndex.snackbar, px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 2, maxWidth: 'calc(100vw - 32px)', border: 2, borderColor: running ? 'error.main' : 'divider' }}
        >
          <Typography variant="body2">
            {running ? t(watching ? 'screenShare.watched' : 'screenShare.waiting', { name: running.viewerName }) : t('screenShare.stopped')}
          </Typography>
          {running ? (
            <Button size="small" color="error" variant="contained" onClick={() => setRunning(null)}>{t('screenShare.stop')}</Button>
          ) : (
            <Button size="small" onClick={() => setEnded(false)}>{t('common.close')}</Button>
          )}
        </Paper>
      )}
    </>
  );
}

/** The viewer's side, opened from the notification: the latest picture, once a second. */
export function ScreenViewer({ share, authHeaders, onClose }: { share: { orgId: string; id: string; title: string } | null; authHeaders: Headers; onClose: () => void }) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const headers = useRef(authHeaders);
  headers.current = authHeaders;

  useEffect(() => {
    if (!share) return;
    setOver(false);
    setSrc(null);
    let stopped = false;
    let timer = 0;
    let shown: string | null = null;
    const tick = async () => {
      try {
        const res = await fetch(`${API}/organizations/${share.orgId}/screen-shares/${share.id}/frame`, { headers: await headers.current(), cache: 'no-store' });
        if (stopped) return;
        if (res.status === 404) {
          setOver(true);
          setSrc(null);
          return;
        }
        if (res.status === 200) {
          const next = URL.createObjectURL(await res.blob());
          if (stopped) return URL.revokeObjectURL(next);
          setSrc(next);
          if (shown) URL.revokeObjectURL(shown);
          shown = next;
        }
      } catch {
        /* the next look may work */
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), FRAME_EVERY_MS);
    };
    void tick();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (shown) URL.revokeObjectURL(shown);
    };
  }, [share]);

  const end = useCallback(async () => {
    if (share) {
      try {
        await fetch(`${API}/organizations/${share.orgId}/screen-shares/${share.id}`, { method: 'DELETE', headers: await headers.current() });
      } catch {
        /* closing stops the watching anyway */
      }
    }
    onClose();
  }, [share, onClose]);

  return (
    <Dialog open={!!share} onClose={onClose} fullWidth maxWidth="xl">
      <DialogTitle>{t('screenShare.viewerTitle')}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{share?.title}</Typography>
        {over ? (
          <Alert severity="info">{t('screenShare.over')}</Alert>
        ) : src ? (
          <Box component="img" src={src} alt={t('screenShare.viewerTitle')} sx={{ display: 'block', width: '100%', maxHeight: '72vh', objectFit: 'contain', pointerEvents: 'none' }} />
        ) : (
          <Typography variant="body2">{t('screenShare.loading')}</Typography>
        )}
      </DialogContent>
      <DialogActions>
        {!over && <Button color="error" onClick={() => void end()}>{t('screenShare.end')}</Button>}
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
