import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { LOCALES, useI18n } from './i18n';
import { AttachFileIcon, CheckCircleIcon, PhotoCameraIcon, UploadIcon } from './icons';
import { shrinkPhoto } from './receiptCapture';
import { formatFileSize } from './localeFormat';

const API = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api/v1';

type Status = 'checking' | 'open' | 'sending' | 'sent' | 'used' | 'expired' | 'offline';

/**
 * Takes the receipt photo on the phone and sends it to the computer that showed the QR code. Not
 * signed in: the code's token is the only credential, good for one file and ten minutes.
 */
export default function PhoneUpload({ token, lang }: { token: string; lang: string | null }) {
  const { t, locale, setLocale } = useI18n();
  const [status, setStatus] = useState<Status>('checking');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // The page speaks the language the code was made in.
  const wanted = LOCALES.find((l) => l.code === lang)?.code;
  useEffect(() => {
    if (wanted && wanted !== locale) setLocale(wanted);
  }, [wanted]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/receipt-handoffs/${encodeURIComponent(token)}/phone`);
        const data = await res.json();
        setStatus(data.status === 'open' ? 'open' : data.status === 'used' ? 'used' : 'expired');
      } catch {
        setStatus('offline');
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function pick(picked: File | undefined) {
    if (!picked) return;
    setError(null);
    setFile(await shrinkPhoto(picked));
  }

  async function send() {
    if (!file) return;
    setError(null);
    setStatus('sending');
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch(`${API}/receipt-handoffs/${encodeURIComponent(token)}/phone`, { method: 'POST', body });
      const data = res.status === 413 ? { ok: false, error: 'too-large' } : await res.json();
      if (data.ok) return setStatus('sent');
      if (data.error === 'handoff-expired') return setStatus('expired');
      if (data.error === 'handoff-used') return setStatus('used');
      setError(t(data.error === 'unsupported-type' ? 'receipt.mobile.unsupported' : 'receipt.mobile.failed', { error: data.error ?? 'unknown' }));
      setStatus('open');
    } catch {
      setError(t('receipt.mobile.failed', { error: 'offline' }));
      setStatus('open');
    }
  }

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', display: 'flex', justifyContent: 'center', p: 2 }}>
      <Paper sx={{ p: 2.5, width: '100%', maxWidth: 440, alignSelf: 'flex-start', mt: { xs: 1, sm: 6 } }}>
        <Typography variant="overline" color="text.secondary">Apensum</Typography>
        <Typography variant="h6" sx={{ mb: 1.5 }}>{t('receipt.mobile.title')}</Typography>

        {status === 'checking' && <CircularProgress />}
        {status === 'expired' && <Alert severity="warning">{t('receipt.mobile.expired')}</Alert>}
        {status === 'used' && <Alert severity="info">{t('receipt.mobile.used')}</Alert>}
        {status === 'offline' && <Alert severity="error">{t('receipt.mobile.failed', { error: 'offline' })}</Alert>}
        {status === 'sent' && (
          <Stack spacing={1.5} alignItems="center" sx={{ py: 2, textAlign: 'center' }}>
            <CheckCircleIcon color="success" sx={{ fontSize: 56 }} />
            <Typography>{t('receipt.mobile.sent')}</Typography>
          </Stack>
        )}

        {(status === 'open' || status === 'sending') && (
          <Stack spacing={1.5}>
            <Typography variant="body2" color="text.secondary">{t('receipt.mobile.intro')}</Typography>
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            <input ref={fileInput} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
            {preview && <Box component="img" src={preview} alt="" sx={{ width: '100%', maxHeight: '50vh', objectFit: 'contain', borderRadius: 1, bgcolor: 'action.hover' }} />}
            {file && !preview && <Typography variant="body2"><AttachFileIcon fontSize="small" sx={{ verticalAlign: 'middle', mr: 0.5 }} />{file.name}</Typography>}
            {file && <Typography variant="caption" color="text.secondary">{formatFileSize(file.size, locale)}</Typography>}
            {error && <Alert severity="error">{error}</Alert>}
            {file ? (
              <>
                <Button size="large" variant="contained" startIcon={status === 'sending' ? <CircularProgress size={18} color="inherit" /> : <UploadIcon />} disabled={status === 'sending'} onClick={() => void send()}>
                  {t('receipt.mobile.send')}
                </Button>
                <Button disabled={status === 'sending'} onClick={() => cameraInput.current?.click()}>{t('receipt.mobile.retake')}</Button>
              </>
            ) : (
              <>
                <Button size="large" variant="contained" startIcon={<PhotoCameraIcon />} onClick={() => cameraInput.current?.click()}>{t('receipt.mobile.takePhoto')}</Button>
                <Button startIcon={<AttachFileIcon />} onClick={() => fileInput.current?.click()}>{t('receipt.mobile.pickFile')}</Button>
              </>
            )}
          </Stack>
        )}
      </Paper>
    </Box>
  );
}
