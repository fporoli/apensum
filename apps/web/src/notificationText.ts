// A notification's text in the reader's language (API notification-text.ts): its text key with values, else the
// title it was stored with (older notifications, and those written in the recipient's language already). Plain
// TypeScript so Node tests import it (notificationText.test.mjs).

type Translate = (key: string, vars?: Record<string, string>) => string;
type NoticeValue = string | number | { t: string } | Record<string, string>;
interface NoticeText { key: string; bodyKey?: string; vars?: Record<string, NoticeValue> }

function noticeText(data: unknown): NoticeText | null {
  const text = (data as { text?: unknown } | null | undefined)?.text as NoticeText | undefined;
  return text && typeof text === 'object' && typeof text.key === 'string' ? text : null;
}

/** One value in `locale`: a text key translated, a text per language picked (else English, else any), else as it is. */
function value(v: NoticeValue, t: Translate, locale: string): string {
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (v && typeof v === 'object') {
    if (typeof (v as { t?: unknown }).t === 'string') return t((v as { t: string }).t);
    const byLang = v as Record<string, string>;
    return byLang[locale] ?? byLang.en ?? Object.values(byLang)[0] ?? '';
  }
  return '';
}

/** The title and body to show: from the text key when the dictionaries have it, else as stored. */
export function notificationText(
  n: { title: string; body?: string | null; data?: unknown },
  t: Translate,
  locale: string,
): { title: string; body: string | null } {
  const text = noticeText(n.data);
  if (!text || t(text.key) === text.key) return { title: n.title, body: n.body ?? null };
  const vars = Object.fromEntries(Object.entries(text.vars ?? {}).map(([k, v]) => [k, value(v, t, locale)]));
  const body = text.bodyKey && t(text.bodyKey) !== text.bodyKey ? t(text.bodyKey, vars) : n.body ?? null;
  return { title: t(text.key, vars), body };
}
