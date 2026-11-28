import { useEffect, useRef, useState } from 'react';
import { Alert, Box, CircularProgress } from '@mui/material';
import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useT } from './i18n';
import { findQuote, type QuoteRange } from './pdfQuote';

// The worker is a file of the app's own origin (CSP worker-src 'self'); loaded only with this view (lazy, DocumentPreviewDialog).
GlobalWorkerOptions.workerSrc = workerUrl;

/** A page's highlight boxes, in CSS pixels of the rendered page. */
interface Mark { left: number; top: number; width: number; height: number }

/**
 * A PDF rendered in the page (pdf.js, no browser plugin, nothing leaves the browser): every page as a canvas, as wide
 * as the view. With `quote` the passage is marked (findQuote: spacing, case and punctuation aside) and scrolled to.
 */
export default function PdfView({ data, quote, onQuoteFound }: {
  data: Blob;
  quote?: string | null;
  /** Whether the quote was found in the PDF's text (a scan has none). */
  onQuoteFound?: (found: boolean) => void;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<{ width: number; height: number; marks: Mark[] }[]>([]);
  const canvases = useRef<(HTMLCanvasElement | null)[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setPages([]);
    setError(false);
    setLoading(true);
    void (async () => {
      try {
        task = getDocument({ data: new Uint8Array(await data.arrayBuffer()) });
        const pdf = await task.promise;
        const width = Math.max(320, (box.current?.clientWidth ?? 800) - 16);
        // First the text of every page, to know where the quote is; then the pages.
        const all = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
        const items = await Promise.all(all.map(async (p) => (await p.getTextContent()).items.filter((it): it is TextItem => 'str' in it)));
        const ranges = quote ? findQuote(items.map((list) => list.map((it) => it.str)), quote) : [];
        if (quote) onQuoteFound?.(ranges.length > 0);
        const layout = all.map((p, i) => {
          const base = p.getViewport({ scale: 1 });
          const viewport = p.getViewport({ scale: width / base.width });
          const marks = ranges.filter((r) => r.page === i).map((r: QuoteRange): Mark => {
            const it = items[i][r.item];
            const chars = Math.max(1, Array.from(it.str).length);
            const [, , , d, x, y] = it.transform as number[];
            const h = it.height || Math.abs(d) || 10;
            const x0 = x + (it.width * r.start) / chars;
            const x1 = x + (it.width * r.end) / chars;
            const [ax, ay] = viewport.convertToViewportPoint(x0, y + h * 0.92) as number[];
            const [bx, by] = viewport.convertToViewportPoint(x1, y - h * 0.18) as number[];
            return { left: Math.min(ax, bx), top: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
          });
          return { page: p, viewport, width: viewport.width, height: viewport.height, marks };
        });
        if (cancelled) return;
        setPages(layout.map(({ width: w, height: h, marks }) => ({ width: w, height: h, marks })));
        setLoading(false);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const ratio = window.devicePixelRatio || 1;
        for (const [i, { page, viewport }] of layout.entries()) {
          const canvas = canvases.current[i];
          if (cancelled || !canvas) return;
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          await page.render({ canvas, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined }).promise;
        }
      } catch {
        if (!cancelled) { setError(true); setLoading(false); }
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [data, quote]); // eslint-disable-line react-hooks/exhaustive-deps

  // The first mark into view, once the pages stand.
  useEffect(() => {
    if (pages.some((p) => p.marks.length)) box.current?.querySelector('[data-quote-mark]')?.scrollIntoView({ block: 'center' });
  }, [pages]);

  return (
    <Box ref={box} sx={{ bgcolor: 'action.hover', p: 1, borderRadius: 1, minHeight: 200 }}>
      {loading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={28} /></Box>}
      {error && <Alert severity="warning">{t('preview.pdfFailed')}</Alert>}
      {pages.map((p, i) => (
        <Box key={i} sx={{ position: 'relative', width: p.width, height: p.height, mx: 'auto', mb: 1, bgcolor: '#fff', boxShadow: 1 }}>
          <canvas ref={(el) => { canvases.current[i] = el; }} style={{ width: p.width, height: p.height, display: 'block' }} aria-label={t('preview.page', { n: i + 1 })} />
          {p.marks.map((m, j) => (
            <Box key={j} data-quote-mark={j === 0 && i === pages.findIndex((x) => x.marks.length) ? '' : undefined}
              sx={{ position: 'absolute', left: m.left - 2, top: m.top - 1, width: m.width + 4, height: m.height + 2, bgcolor: 'rgba(255, 193, 7, 0.38)', outline: '2px solid rgba(255, 152, 0, 0.8)', borderRadius: 0.5, pointerEvents: 'none' }} />
          ))}
        </Box>
      ))}
    </Box>
  );
}
