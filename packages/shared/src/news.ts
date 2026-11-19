/**
 * News (module "news"): posts an organization's admin or HR publishes to its members, rules the
 * API and the browser share. A post has a title and a Markdown text (markdown.ts) per language;
 * at least one language is required, a reader sees theirs or else the first one written.
 *
 * Keep this file erasable TypeScript (no enums, no imports) so Node tests can load it directly.
 */

export const NEWS_LANGS = ['de', 'fr', 'it', 'en'] as const;
export type NewsLang = (typeof NEWS_LANGS)[number];
export const MAX_NEWS_TITLE = 200;
export const MAX_NEWS_BODY = 50_000;
/** Pictures per post (each stored as a document, at most the documents' size). */
export const MAX_NEWS_IMAGES = 20;

export interface NewsText {
  title: string;
  body: string;
}
export type NewsTexts = Partial<Record<NewsLang, NewsText>>;

/** A picture in a post's text points at the post's document: `![alt](doc:<document id>)`. */
export const NEWS_IMAGE_PREFIX = 'doc:';
export function newsImageId(src: string): string | null {
  const m = /^doc:([0-9a-f-]{36})$/i.exec(src);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Validates a post's texts from the browser: known languages, each with a title, within the limits.
 * Languages left empty (no title and no text) are dropped.
 */
export function validateNewsTexts(input: unknown): { ok: true; texts: NewsTexts } | { ok: false; error: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'news-text-required' };
  const texts: NewsTexts = {};
  for (const [lang, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(NEWS_LANGS as readonly string[]).includes(lang)) return { ok: false, error: 'news-invalid-language' };
    const v = (value ?? {}) as Record<string, unknown>;
    const title = typeof v.title === 'string' ? v.title.trim() : '';
    const body = typeof v.body === 'string' ? v.body.replace(/\r\n/g, '\n').trim() : '';
    if (!title && !body) continue;
    if (!title) return { ok: false, error: 'news-title-required' };
    if (title.length > MAX_NEWS_TITLE || body.length > MAX_NEWS_BODY) return { ok: false, error: 'news-too-long' };
    texts[lang as NewsLang] = { title, body };
  }
  if (Object.keys(texts).length === 0) return { ok: false, error: 'news-text-required' };
  return { ok: true, texts };
}

/** The text a reader sees: their language, else German, else the first one written. */
export function newsTextFor(texts: NewsTexts, lang: string): (NewsText & { lang: NewsLang }) | null {
  const order = [lang, 'de', ...NEWS_LANGS] as NewsLang[];
  for (const l of order) {
    const t = texts?.[l];
    if (t && t.title) return { lang: l, ...t };
  }
  return null;
}
