import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Tooltip, Typography } from '@mui/material';
import QRCode from 'qrcode';
import { useI18n } from './i18n';
import { CropIcon, PhotoCameraIcon, QrCodeIcon } from './icons';
import { MAX_ATTACHMENT_BYTES } from './attachments';
import { handoffLink } from './receiptHash';
import { swissLocale } from './localeFormat';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

/** Longest side of a receipt photo: sharp enough to read, small enough to send from a phone. */
const MAX_PHOTO_SIDE = 2200;

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

function canvasToFile(canvas: HTMLCanvasElement, name: string, type: 'image/jpeg' | 'image/png'): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('encode'));
        // A large screenshot as PNG can pass the size limit; JPEG then.
        if (type === 'image/png' && blob.size > MAX_ATTACHMENT_BYTES) {
          void canvasToFile(canvas, name.replace(/\.png$/, '.jpg'), 'image/jpeg').then(resolve, reject);
          return;
        }
        resolve(new File([blob], name, { type }));
      },
      type,
      type === 'image/jpeg' ? 0.85 : undefined,
    );
  });
}

/** Draws a (part of a) source onto a canvas, scaled down to MAX_PHOTO_SIDE when asked. */
function drawToCanvas(source: CanvasImageSource, sw: number, sh: number, crop = { x: 0, y: 0, w: sw, h: sh }, limit = true): HTMLCanvasElement {
  const scale = limit ? Math.min(1, MAX_PHOTO_SIDE / Math.max(crop.w, crop.h)) : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(crop.w * scale));
  canvas.height = Math.max(1, Math.round(crop.h * scale));
  canvas.getContext('2d')!.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * A phone photo is often 4-12 MB: shrink it to a readable JPEG before sending. PDFs, small
 * files and images the browser cannot decode (HEIC outside Safari) go as they are.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || file.size < 1024 * 1024) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = drawToCanvas(bitmap, bitmap.width, bitmap.height);
    bitmap.close();
    const name = (file.name.replace(/\.\w+$/, '') || `receipt-${stamp()}`) + '.jpg';
    const shrunk = await canvasToFile(canvas, name, 'image/jpeg');
    return shrunk.size < file.size ? shrunk : file;
  } catch {
    return file;
  }
}

/** Phones and tablets: the file input opens the camera itself, and there is no screen to capture. */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;
}

interface CaptureProps {
  orgId: string;
  authHeaders: () => Promise<Record<string, string>>;
  onFile: (file: File) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

/**
 * The receipt's capture buttons beside the paperclip: a photo (the phone's camera, or the
 * computer's webcam), an area of the screen, and a QR code to take the photo with a phone.
 */
export function ReceiptCaptureButtons({ orgId, authHeaders, onFile, onError, disabled }: CaptureProps) {
  const { t } = useI18n();
  const touch = isTouchDevice();
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const [camera, setCamera] = useState(false);
  const [screenshot, setScreenshot] = useState<HTMLCanvasElement | null>(null);
  const [qr, setQr] = useState(false);
  const canCaptureScreen = !touch && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia;

  async function captureScreen() {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const video = document.createElement('video');
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      // The first frame may still be black: wait for one more.
      await new Promise((r) => setTimeout(r, 250));
      setScreenshot(drawToCanvas(video, video.videoWidth, video.videoHeight, undefined, false));
    } catch (e) {
      if ((e as Error)?.name !== 'NotAllowedError') onError(t('receipt.screen.failed'));
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  return (
    <>
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void shrinkPhoto(file).then(onFile);
        }}
      />
      <Tooltip title={t('receipt.photo')}>
        <span>
          <IconButton size="small" aria-label={t('receipt.photo')} disabled={disabled} onClick={() => (touch ? cameraInput.current?.click() : setCamera(true))}>
            <PhotoCameraIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      {canCaptureScreen && (
        <Tooltip title={t('receipt.screen')}>
          <span>
            <IconButton size="small" aria-label={t('receipt.screen')} disabled={disabled} onClick={() => void captureScreen()}>
              <CropIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {!touch && (
        <Tooltip title={t('receipt.phone')}>
          <span>
            <IconButton size="small" aria-label={t('receipt.phone')} disabled={disabled} onClick={() => setQr(true)}>
              <QrCodeIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      )}
      {camera && <CameraDialog onClose={() => setCamera(false)} onFile={onFile} />}
      {screenshot && <CropDialog image={screenshot} onClose={() => setScreenshot(null)} onFile={onFile} />}
      {qr && <PhoneHandoffDialog orgId={orgId} authHeaders={authHeaders} onClose={() => setQr(false)} onFile={onFile} />}
    </>
  );
}

/** The computer's webcam: live picture, one click takes the photo. */
function CameraDialog({ onClose, onFile }: { onClose: () => void; onFile: (file: File) => void }) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setReady(true);
      } catch {
        if (!cancelled) setError(t('receipt.camera.unavailable'));
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [t]);

  async function take() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    onFile(await canvasToFile(drawToCanvas(video, video.videoWidth, video.videoHeight), `receipt-${stamp()}.jpg`, 'image/jpeg'));
    onClose();
  }

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('receipt.photo')}</DialogTitle>
      <DialogContent>
        {error ? (
          <Alert severity="warning">{error}</Alert>
        ) : (
          <Box sx={{ position: 'relative', bgcolor: 'common.black', borderRadius: 1, overflow: 'hidden', minHeight: 240, display: 'grid', placeItems: 'center' }}>
            <Box component="video" ref={videoRef} playsInline muted sx={{ width: '100%', maxHeight: '65vh', display: 'block' }} />
            {!ready && <CircularProgress sx={{ position: 'absolute' }} />}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" startIcon={<PhotoCameraIcon />} disabled={!ready} onClick={() => void take()}>{t('receipt.camera.take')}</Button>
      </DialogActions>
    </Dialog>
  );
}

interface Rect { x: number; y: number; w: number; h: number }

/** A captured screen or window: drag a rectangle around the receipt, or keep the whole picture. */
function CropDialog({ image, onClose, onFile }: { image: HTMLCanvasElement; onClose: () => void; onFile: (file: File) => void }) {
  const { t } = useI18n();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // In fractions of the picture, so it does not depend on how large the dialog shows it.
  const [rect, setRect] = useState<Rect | null>(null);
  const src = useRef(image.toDataURL('image/png'));

  const point = (e: ReactPointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };

  async function apply(selection: Rect | null) {
    const crop = selection
      ? { x: selection.x * image.width, y: selection.y * image.height, w: selection.w * image.width, h: selection.h * image.height }
      : undefined;
    onFile(await canvasToFile(drawToCanvas(image, image.width, image.height, crop, false), `screenshot-${stamp()}.png`, 'image/png'));
    onClose();
  }

  const usable = rect && rect.w > 0.01 && rect.h > 0.01 ? rect : null;
  return (
    <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{t('receipt.screen')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('receipt.screen.hint')}</Typography>
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Box
            ref={boxRef}
            onPointerDown={(e) => {
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              start.current = point(e);
              setRect(null);
            }}
            onPointerMove={(e) => {
              if (!start.current) return;
              const p = point(e);
              const s = start.current;
              setRect({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
            }}
            onPointerUp={() => { start.current = null; }}
            sx={{ position: 'relative', cursor: 'crosshair', userSelect: 'none', touchAction: 'none', lineHeight: 0 }}
          >
            <Box component="img" src={src.current} alt="" draggable={false} sx={{ maxWidth: '100%', maxHeight: '65vh', display: 'block' }} />
            {rect && (
              <Box
                sx={{
                  position: 'absolute',
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                  outline: '2px solid',
                  outlineColor: 'primary.main',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                  pointerEvents: 'none',
                }}
              />
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button onClick={() => void apply(null)}>{t('receipt.screen.whole')}</Button>
        <Button variant="contained" startIcon={<CropIcon />} disabled={!usable} onClick={() => void apply(usable)}>{t('receipt.screen.useArea')}</Button>
      </DialogActions>
    </Dialog>
  );
}

type HandoffState =
  | { kind: 'loading' }
  | { kind: 'waiting'; token: string; qr: string; link: string; expiresAt: number }
  | { kind: 'receiving' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

/**
 * Shows a QR code for the phone (PhoneUpload.tsx) and waits for its photo, which then lands in the
 * form like a picked file. Closing the dialog cancels the hand-off.
 */
function PhoneHandoffDialog({ orgId, authHeaders, onClose, onFile }: Omit<CaptureProps, 'onError' | 'disabled'> & { onClose: () => void }) {
  const { t, locale } = useI18n();
  const [state, setState] = useState<HandoffState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const tokenRef = useRef<string | null>(null);
  // The parent passes new functions on every render; the effects below must not restart for that.
  const props = useRef({ authHeaders, onFile, onClose });
  props.current = { authHeaders, onFile, onClose };
  const local = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

  const cancel = useCallback(async (token: string | null) => {
    if (!token) return;
    try {
      await fetch(`${API}/receipt-handoffs/${encodeURIComponent(token)}`, { method: 'DELETE', headers: await props.current.authHeaders() });
    } catch { /* it expires anyway */ }
  }, []);

  // Create the hand-off and its QR code.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setState({ kind: 'loading' });
      try {
        const res = await fetch(`${API}/organizations/${orgId}/receipt-handoffs`, { method: 'POST', headers: await props.current.authHeaders() });
        const data = await res.json();
        if (!data.ok || !data.token) throw new Error(data.error ?? 'failed');
        if (cancelled) return void cancel(data.token);
        tokenRef.current = data.token;
        const link = handoffLink(window.location.origin, window.location.pathname, data.token, locale);
        const qr = await QRCode.toDataURL(link, { margin: 1, width: 240, errorCorrectionLevel: 'M' });
        if (!cancelled) setState({ kind: 'waiting', token: data.token, qr, link, expiresAt: data.expiresAt });
      } catch (e) {
        if (!cancelled) setState({ kind: 'error', message: t('receipt.phone.failed', { error: (e as Error).message }) });
      }
    })();
    return () => { cancelled = true; };
    // Not on locale/t: a code already shown keeps the language it was made in.
  }, [orgId, attempt, cancel]);

  // Wait for the phone.
  const waitingToken = state.kind === 'waiting' ? state.token : null;
  useEffect(() => {
    if (!waitingToken) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const { authHeaders: headers, onFile: deliver, onClose: close } = props.current;
        const res = await fetch(`${API}/receipt-handoffs/${encodeURIComponent(waitingToken)}`, { headers: await headers() });
        const data = await res.json();
        if (stopped) return;
        if (data.status === 'expired') {
          stopped = true;
          tokenRef.current = null;
          setState({ kind: 'expired' });
        } else if (data.status === 'ready') {
          stopped = true;
          setState({ kind: 'receiving' });
          const file = await fetch(`${API}/receipt-handoffs/${encodeURIComponent(waitingToken)}/file`, { headers: await headers() });
          tokenRef.current = null;
          if (!file.ok) {
            setState({ kind: 'error', message: t('receipt.phone.failed', { error: String(file.status) }) });
            return;
          }
          const blob = await file.blob();
          deliver(new File([blob], data.fileName ?? `receipt-${stamp()}.jpg`, { type: blob.type }));
          close();
        }
      } catch { /* try again on the next tick */ }
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [waitingToken, t]);

  // Closing (or leaving the page) gives up the hand-off.
  useEffect(() => () => void cancel(tokenRef.current), [cancel]);

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('receipt.phone')}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, justifyItems: 'center', textAlign: 'center' }}>
        {state.kind === 'loading' && <CircularProgress sx={{ my: 6 }} />}
        {state.kind === 'waiting' && (
          <>
            <Typography variant="body2">{t('receipt.phone.scan')}</Typography>
            <Box component="img" src={state.qr} alt={t('receipt.phone.qrAlt')} sx={{ width: 240, height: 240, bgcolor: '#fff', p: 1, borderRadius: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">{t('receipt.phone.waiting', { time: new Date(state.expiresAt).toLocaleTimeString(swissLocale(locale), { hour: '2-digit', minute: '2-digit' }) })}</Typography>
            </Box>
            {local && <Alert severity="info" sx={{ textAlign: 'left' }}>{t('receipt.phone.localhost')}</Alert>}
          </>
        )}
        {state.kind === 'receiving' && (
          <>
            <CircularProgress sx={{ mt: 4 }} />
            <Typography variant="body2">{t('receipt.phone.receiving')}</Typography>
          </>
        )}
        {state.kind === 'expired' && <Alert severity="warning">{t('receipt.phone.expired')}</Alert>}
        {state.kind === 'error' && <Alert severity="error">{state.message}</Alert>}
      </DialogContent>
      <DialogActions>
        {(state.kind === 'expired' || state.kind === 'error') && <Button onClick={() => setAttempt((n) => n + 1)}>{t('receipt.phone.newCode')}</Button>}
        <Button onClick={onClose}>{t('common.cancel')}</Button>
      </DialogActions>
    </Dialog>
  );
}
