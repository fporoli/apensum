// News posts: apps/site/content/news/<YYYY-MM-DD>-<slug>/<lang>.md, pictures next to them.
// A post needs de.md; a language without its own file shows the German text (marked as such).
// Front matter: `title` (required), `summary` (the list and the mail preview), `draft: true`
// (built only with --drafts, the local preview; never deployed).
// The same Markdown becomes the post page and, later, the mail to the subscribers, so the
// renderer takes the picture URLs from its caller (site paths here, absolute URLs in a mail).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { esc } from './layout.mjs';

export const POST_DIR = /^(\d{4}-\d{2}-\d{2})-([a-z0-9-]+)$/;
export const IMAGE = /^[\w-]+\.(jpg|jpeg|png|webp|gif|svg)$/;

/** `---\nkey: value\n---\nbody`; values are plain strings, `true`/`false` booleans. */
export function parseFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const v = kv[2].replace(/^(["'])(.*)\1$/, '$2');
    meta[kv[1]] = v === 'true' ? true : v === 'false' ? false : v;
  }
  return { meta, body: text.slice(m[0].length) };
}

/** Bold, italic, code, links and pictures within a line; everything else is escaped. */
function inline(text, opts) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => opts.image(src, alt));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => opts.link(href, label));
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

/**
 * A small Markdown subset to HTML: ## / ### headings, paragraphs, - and 1. lists, > quotes,
 * a picture alone on its line (a figure), **bold**, *italic*, `code`, [links](url).
 * `opts.image(src, alt)` and `opts.link(href, label)` get escaped values and return HTML.
 */
export function renderMarkdown(md, opts) {
  const out = [];
  const blocks = md.replace(/\r\n/g, '\n').trim().split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const h = /^(#{2,3})\s+(.*)$/.exec(block);
    if (h && lines.length === 1) {
      out.push(`<h${h[1].length}>${inline(h[2], opts)}</h${h[1].length}>`);
    } else if (lines.every((l) => /^\s*[-*]\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      out.push(`<ul>${joinItems(lines, /^\s*[-*]\s+/).map((i) => `<li>${inline(i, opts)}</li>`).join('')}</ul>`);
    } else if (lines.every((l) => /^\s*\d+\.\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      out.push(`<ol>${joinItems(lines, /^\s*\d+\.\s+/).map((i) => `<li>${inline(i, opts)}</li>`).join('')}</ol>`);
    } else if (lines.every((l) => l.startsWith('>'))) {
      out.push(`<blockquote><p>${inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '), opts)}</p></blockquote>`);
    } else if (/^!\[[^\]]*\]\([^)\s]+\)$/.test(block.trim())) {
      out.push(`<figure>${inline(block.trim(), opts)}</figure>`);
    } else {
      out.push(`<p>${inline(lines.join(' '), opts)}</p>`);
    }
  }
  return out.join('\n');
}

/** List lines to items: an indented line continues the item above. */
function joinItems(lines, marker) {
  const items = [];
  for (const l of lines) {
    if (marker.test(l)) items.push(l.replace(marker, ''));
    else items[items.length - 1] += ` ${l.trim()}`;
  }
  return items;
}

/**
 * The posts, newest first: `{ id, date, dir, langs: { de: { title, summary, body, draft } }, images }`.
 * A broken post (no de.md, no title, a missing picture) throws, so it fails the build.
 */
export function loadPosts(dir, { drafts = false } = {}) {
  if (!dir || !existsSync(dir)) return [];
  const posts = [];
  for (const id of readdirSync(dir).sort().reverse()) {
    const m = POST_DIR.exec(id);
    const path = join(dir, id);
    if (!m || !statSync(path).isDirectory()) continue;
    const langs = {};
    for (const file of readdirSync(path).filter((f) => /^(de|fr|it|en)\.md$/.test(f))) {
      const { meta, body } = parseFrontMatter(readFileSync(join(path, file), 'utf8'));
      if (!meta.title) throw new Error(`site: news ${id}/${file} has no title`);
      langs[file.slice(0, 2)] = { title: String(meta.title), summary: meta.summary ? String(meta.summary) : '', body, draft: meta.draft === true };
    }
    if (!langs.de) throw new Error(`site: news ${id} has no de.md`);
    const draft = langs.de.draft;
    if (draft && !drafts) continue;
    const images = readdirSync(path).filter((f) => IMAGE.test(f));
    for (const [lang, post] of Object.entries(langs)) {
      for (const [, src] of post.body.replace(/`[^`]*`/g, '').matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        if (!images.includes(src)) throw new Error(`site: news ${id}/${lang}.md shows ${src}, which is not in its folder`);
      }
    }
    posts.push({ id, date: m[1], dir: path, draft, langs, images });
  }
  return posts;
}
