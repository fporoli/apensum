// Finds a quote in a PDF's text items (pdf.js getTextContent), for the PDF view's highlight. Pure, tested in
// pdfQuote.test.mjs. Matching ignores case, spacing, punctuation and the kind of quote marks and dashes, like the
// cases plugin's evidence check (normalizeForQuote), so a quote the AI copied from the extracted text is found here too.

/** A stretch of one text item: characters [start, end) of item `item` on page `page` (both 0-based). */
export interface QuoteRange {
  page: number;
  item: number;
  start: number;
  end: number;
}

/** One character as it is compared: lower case, one kind of quote mark and dash, ß as ss; anything else a space. */
function normChar(ch: string): string {
  const c = ch.toLowerCase();
  if (/[‘’‚‛′`´]/.test(c)) return "'";
  if (/[“”„‟«»″]/.test(c)) return '"';
  if (/[‐-―−]/.test(c)) return '-';
  if (c === 'ß') return 'ss';
  return /[\p{L}\p{N}'"-]/u.test(c) ? c : ' ';
}

/** The quote as it is compared: normalized, runs of spaces as one, trimmed. */
export function normalizeQuote(quote: string): string {
  return Array.from(quote, normChar).join('').replace(/ +/g, ' ').trim();
}

/**
 * Where the quote stands: the stretches of text items it covers, in reading order, or [] when it is not there.
 * `pages` are each page's items' strings; items and pages are read as if separated by a space. Only the first
 * occurrence counts.
 */
export function findQuote(pages: string[][], quote: string): QuoteRange[] {
  const q = normalizeQuote(quote);
  if (!q) return [];
  // The normalized text, and for each of its characters where it came from (null: a separator).
  let text = '';
  const from: ({ page: number; item: number; char: number } | null)[] = [];
  const push = (s: string, origin: { page: number; item: number; char: number } | null) => {
    for (const c of s) {
      if (c === ' ' && (text === '' || text.endsWith(' '))) continue; // runs of spaces as one
      text += c;
      from.push(origin);
    }
  };
  pages.forEach((items, page) => items.forEach((str, item) => {
    Array.from(str).forEach((ch, char) => push(normChar(ch), { page, item, char }));
    push(' ', null);
  }));
  const at = text.indexOf(q);
  if (at < 0) return [];
  const ranges: QuoteRange[] = [];
  for (let i = at; i < at + q.length; i++) {
    const o = from[i];
    if (!o || text[i] === ' ') continue; // a space marks nothing (it may be punctuation between words)
    const last = ranges[ranges.length - 1];
    if (last && last.page === o.page && last.item === o.item) last.end = o.char + 1;
    else ranges.push({ page: o.page, item: o.item, start: o.char, end: o.char + 1 });
  }
  return ranges;
}
