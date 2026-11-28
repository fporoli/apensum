import { lazy, Suspense, useEffect, useState } from 'react';
import { Alert, Box, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { Button } from './Button';
import { useT } from './i18n';
import { findQuote } from './pdfQuote';

// pdf.js only when a PDF is shown (its own chunk).
const PdfView = lazy(() => import('./PdfView'));

/** What the dialog can show: a PDF, an image, a text file; anything else is only downloaded. */
export function previewKind(mime: string | null | undefined, name?: string | null): 'pdf' | 'image' | 'text' | null {
  const m = (mime ?? '').toLowerCase();
  const n = (name ?? '').toLowerCase();
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/^image\/(png|jpe?g|gif|webp)$/.test(m) || /\.(png|jpe?g|gif|webp)$/.test(n)) return 'image';
  if (m.startsWith('text/') || /\.(txt|md|csv)$/.test(n)) return 'text';
  return null;
}

/**
 * A document's preview, in the app: a PDF page by page (PdfView), an image, a text file. `load` gives the file's
 * plain bytes (an end-to-end encrypted file is decrypted by the caller, in the browser). With `quote` the passage is
 * marked: in a PDF or a text file; when it is not in the file (a scan, a quote from elsewhere), a note says so.
 */
export function DocumentPreviewDialog({ open, title, fileName, mime, load, quote, onClose, onDownload }: {
  open: boolean;
  title: string;
  fileName?: string | null;
  mime?: string | null;
  load: () => Promise<Blob>;
  quote?: string | null;
  onClose: () => void;
  onDownload?: () => void;
}) {
  const t = useT();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const [quoteFound, setQuoteFound] = useState<boolean | null>(null);
  const kind = previewKind(mime, fileName);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url = '';
    setBlob(null); setText(null); setImageUrl(''); setFailed(false); setQuoteFound(null);
    if (!kind) return;
    load().then(async (b) => {
      if (cancelled) return;
      if (kind === 'image') { url = URL.createObjectURL(b); setImageUrl(url); }
      else if (kind === 'text') setText(await b.text());
      else setBlob(b);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [open, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {quote && (
          <Alert severity={quoteFound === false ? 'warning' : 'info'} sx={{ mb: 1.5 }}>
            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>«{quote}»</Typography>
            {quoteFound === false && <Typography variant="caption">{t('preview.quoteNotFound')}</Typography>}
          </Alert>
        )}
        {!kind && <Alert severity="info">{t('preview.unsupported')}</Alert>}
        {failed && <Alert severity="error">{t('preview.loadFailed')}</Alert>}
        {kind && !failed && !blob && text === null && !imageUrl && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} /></Box>}
        {blob && (
          <Suspense fallback={<Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} /></Box>}>
            <PdfView data={blob} quote={quote} onQuoteFound={setQuoteFound} />
          </Suspense>
        )}
        {imageUrl && <Box component="img" src={imageUrl} alt={title} sx={{ maxWidth: '100%', display: 'block', mx: 'auto' }} />}
        {text !== null && <TextWithQuote text={text} quote={quote ?? null} onFound={setQuoteFound} />}
      </DialogContent>
      <DialogActions>
        {onDownload && <Button onClick={onDownload}>{t('preview.download')}</Button>}
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

/** A text file with the quote marked (findQuote over its lines, so it matches as in a PDF). */
function TextWithQuote({ text, quote, onFound }: { text: string; quote: string | null; onFound: (found: boolean) => void }) {
  const lines = text.split('\n').map((line) => Array.from(line));
  const ranges = quote ? findQuote([lines.map((l) => l.join(''))], quote) : [];
  // Offsets in the text's characters: each line starts after the ones before and their line breaks.
  const starts = lines.reduce<number[]>((acc, l, i) => [...acc, i ? acc[i - 1] + lines[i - 1].length + 1 : 0], []);
  const from = ranges.length ? starts[ranges[0].item] + ranges[0].start : -1;
  const last = ranges[ranges.length - 1];
  const to = last ? starts[last.item] + last.end : -1;
  useEffect(() => { if (quote) onFound(from >= 0); }, [quote, from]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { document.getElementById('preview-quote-mark')?.scrollIntoView({ block: 'center' }); }, [from]);
  const chars = Array.from(text);
  return (
    <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>
      {from >= 0 ? <>
        {chars.slice(0, from).join('')}
        <Box component="mark" id="preview-quote-mark" sx={{ bgcolor: 'warning.light', color: 'text.primary' }}>{chars.slice(from, to).join('')}</Box>
        {chars.slice(to).join('')}
      </> : text}
    </Box>
  );
}
