import { useRef, useState } from 'react';
import { Alert, Avatar, Box, CircularProgress, Stack, Typography } from '@mui/material';
import { Button } from './Button';
import { useT } from './i18n';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';
/** Pixels of the stored square picture: enough for the largest avatar shown (Directory, 56 px at 3x). */
const SIZE = 256;

/** The picture cropped to its centre square and shrunk to SIZE, as a JPEG (a few dozen KB). */
async function squareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('avatar-format');
  ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
  if (!blob) throw new Error('avatar-format');
  return blob;
}

/**
 * The caller's profile picture (API avatars.controller.ts): choose a photo, which is cropped and shrunk
 * here before it is uploaded, or remove it. Saved at once, independent of the dialog's other settings.
 */
export default function AvatarEditor({ avatarUrl, initial, orgId, authHeaders, onChange }: {
  avatarUrl: string | null;
  initial: string;
  orgId: string | null;
  authHeaders: () => Promise<Record<string, string>>;
  onChange: (avatarUrl: string | null) => void;
}) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const call = async (method: 'PUT' | 'DELETE', body?: FormData) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/users/me/avatar`, { method, headers: await authHeaders(), body });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const code = res.status === 413 ? 'avatar-too-large' : String(data?.error ?? data?.message ?? '');
        setError(t(`avatar.error.${['avatar-format', 'avatar-too-large', 'forbidden'].includes(code) ? code : 'failed'}`));
        return;
      }
      onChange(data.avatarUrl ?? null);
    } catch {
      setError(t('common.cannotReachApi'));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file || !orgId) return;
    let picture: Blob;
    try {
      picture = await squareJpeg(file);
    } catch {
      setError(t('avatar.error.avatar-format'));
      return;
    }
    const form = new FormData();
    form.set('orgId', orgId);
    form.set('file', picture, 'avatar.jpg');
    await call('PUT', form);
  };

  return (
    <Box>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
        <Avatar src={avatarUrl ?? undefined} sx={{ width: 64, height: 64, fontSize: 24 }}>{initial}</Avatar>
        <Box sx={{ display: 'grid', gap: 0.75 }}>
          <Typography variant="subtitle2">{t('avatar.title')}</Typography>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" disabled={busy || !orgId} onClick={() => input.current?.click()}
              startIcon={busy ? <CircularProgress size={14} /> : undefined}>
              {avatarUrl ? t('avatar.change') : t('avatar.upload')}
            </Button>
            {avatarUrl && <Button size="small" color="error" disabled={busy} onClick={() => void call('DELETE')}>{t('avatar.remove')}</Button>}
          </Stack>
        </Box>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>{t('avatar.hint')}</Typography>
      {error && <Alert severity="error" sx={{ mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/heic,image/*" hidden
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; void choose(file); }} />
    </Box>
  );
}
