// News posts: apps/site/content/news/<YYYY-MM-DD>-<slug>/<lang>.md, pictures next to them.
// A post needs de.md; a language without its own file shows the German text (marked as such).
// Front matter: `title` (required), `summary` (the list and the mail preview), `draft: true`
// (built only with --drafts, the local preview; never deployed).
// The same Markdown becomes the post page and, later, the mail to the subscribers, so the
// renderer takes the picture URLs from its caller (site paths here, absolute URLs in a mail).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { markdownImages, renderMarkdown } from '../../../packages/shared/src/markdown.ts';

export { renderMarkdown };

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
      for (const src of markdownImages(post.body)) {
        if (!images.includes(src)) throw new Error(`site: news ${id}/${lang}.md shows ${src}, which is not in its folder`);
      }
    }
    posts.push({ id, date: m[1], dir: path, draft, langs, images });
  }
  return posts;
}
