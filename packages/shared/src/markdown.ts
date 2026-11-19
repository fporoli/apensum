/**
 * A small Markdown subset to HTML, shared by the website's news posts (apps/site), the app's News
 * page and the news mails, so a post looks the same everywhere.
 *
 * Supported: `##` / `###` headings, paragraphs, `-` and `1.` lists (an indented line continues an
 * item), `>` quotes, a picture alone on its line (a figure), `**bold**`, `*italic*`, `` `code` ``,
 * `[links](url)` and `![pictures](src)`. Everything else is text: every character is escaped, so
 * the output is safe to put into a page as HTML.
 *
 * The caller decides what pictures and links become (`image(src, alt)`, `link(href, label)`; both get
 * escaped values and return HTML), since a picture is a site file, an app document or a mail URL.
 *
 * Keep this file erasable TypeScript (no enums, no imports) so Node tests and the site can load it.
 */

export interface MarkdownOptions {
  image: (src: string, alt: string) => string;
  link: (href: string, label: string) => string;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function escapeHtml(value: string): string {
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}

/** Back from escaped to plain text (for a picture's src or a link's href handed to the caller). */
export function unescapeHtml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e] ?? '');
}

/** Only these links are kept; anything else (javascript:, data:, ...) shows as its label. */
export function safeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(href);
}

const IMAGE_MD = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const LINK_MD = /\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string, opts: MarkdownOptions): string {
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(c) - 1}\u0000`);
  s = escapeHtml(s);
  s = s.replace(IMAGE_MD, (_, alt: string, src: string) => opts.image(src, alt));
  s = s.replace(LINK_MD, (_, label: string, href: string) => opts.link(href, label));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
}

/** List lines to items: an indented line continues the item above. */
function joinItems(lines: string[], marker: RegExp): string[] {
  const items: string[] = [];
  for (const l of lines) {
    if (marker.test(l)) items.push(l.replace(marker, ''));
    else items[items.length - 1] += ` ${l.trim()}`;
  }
  return items;
}

export function renderMarkdown(md: string, opts: MarkdownOptions): string {
  const out: string[] = [];
  const text = md.replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split('\n');
    const h = /^(#{2,3})\s+(.*)$/.exec(block);
    if (h && lines.length === 1) {
      out.push(`<h${h[1].length}>${inline(h[2], opts)}</h${h[1].length}>`);
    } else if (/^\s*[-*]\s+/.test(lines[0]) && lines.every((l) => /^\s*[-*]\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      out.push(`<ul>${joinItems(lines, /^\s*[-*]\s+/).map((i) => `<li>${inline(i, opts)}</li>`).join('')}</ul>`);
    } else if (/^\s*\d+\.\s+/.test(lines[0]) && lines.every((l) => /^\s*\d+\.\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      out.push(`<ol>${joinItems(lines, /^\s*\d+\.\s+/).map((i) => `<li>${inline(i, opts)}</li>`).join('')}</ol>`);
    } else if (lines.every((l) => l.startsWith('>'))) {
      out.push(`<blockquote><p>${inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '), opts)}</p></blockquote>`);
    } else if (/^!\[[^\]]*\]\([^)\s]+\)$/.test(block.trim())) {
      out.push(`<figure>${inline(block.trim(), opts)}</figure>`);
    } else {
      out.push(`<p>${lines.map((l) => inline(l, opts)).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}

/** The pictures a text shows (their src), outside code spans. */
export function markdownImages(md: string): string[] {
  return [...md.replace(/`[^`]*`/g, '').matchAll(IMAGE_MD)].map((m) => m[2]);
}

/** Plain text of a Markdown text (notifications, mail previews): markup dropped, pictures left out. */
export function markdownPlain(md: string): string {
  return md
    .replace(IMAGE_MD, '')
    .replace(LINK_MD, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*([-*]|\d+\.)\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*|\*|`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
