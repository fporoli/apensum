/**
 * A small Markdown subset to HTML, shared by the website's news posts (apps/site), the app's News
 * page and the news mails, so a post looks the same everywhere.
 *
 * Supported: `#` / `##` / `###` headings, paragraphs, `-` / `*` and `1.` / `1)` lists (an indented line continues an
 * item), `>` quotes, a picture alone on its line (a figure), `**bold**`, `*italic*`, `~~struck~~`, `` `code` ``,
 * `[links](url)` and `![pictures](src)`; read line by line, so a heading, list or quote needs no empty line before it. Everything else is text: every character is escaped, so
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
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
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

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+/;
const NUMBERED = /^\s*\d+[.)]\s+/;
const FIGURE = /^!\[[^\]]*\]\([^)\s]+\)$/;

/**
 * Line by line, as editors show Markdown: a heading, a list or a quote starts where its line starts, also right after a
 * line of text (no empty line needed); an empty line ends a paragraph, a list or a quote. `#` and `##` are the same
 * heading (the page has its own title), `###` the smaller one; a list item goes on in a line indented by two spaces.
 */
export function renderMarkdown(md: string, opts: MarkdownOptions): string {
  const out: string[] = [];
  const lines = md.replace(/\r\n/g, '\n').trim().split('\n');
  if (!lines.join('').trim()) return '';
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map((l) => inline(l, opts)).join('<br>')}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    const h = HEADING.exec(line.trim());
    if (h) {
      flush();
      const level = h[1].length === 3 ? 3 : 2;
      out.push(`<h${level}>${inline(h[2], opts)}</h${level}>`);
      continue;
    }
    const list = BULLET.test(line) ? { tag: 'ul', marker: BULLET } : NUMBERED.test(line) ? { tag: 'ol', marker: NUMBERED } : null;
    if (list) {
      flush();
      // The items of this kind, each with the indented lines that go on with it.
      const items: string[] = [];
      while (i < lines.length && (list.marker.test(lines[i]) || (items.length > 0 && /^\s{2,}\S/.test(lines[i])))) items.push(lines[i++]);
      i--;
      out.push(`<${list.tag}>${joinItems(items, list.marker).map((it) => `<li>${inline(it, opts)}</li>`).join('')}</${list.tag}>`);
      continue;
    }
    if (line.startsWith('>')) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quoted.push(lines[i++].replace(/^>\s?/, ''));
      i--;
      out.push(`<blockquote><p>${inline(quoted.join(' '), opts)}</p></blockquote>`);
      continue;
    }
    // A picture alone on its line, with nothing around it in its paragraph: a figure.
    if (FIGURE.test(line.trim()) && para.length === 0 && !(lines[i + 1] ?? '').trim()) {
      out.push(`<figure>${inline(line.trim(), opts)}</figure>`);
      continue;
    }
    para.push(line);
  }
  flush();
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
    .replace(/^\s*([-*]|\d+[.)])\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*|\*|`|~~/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
