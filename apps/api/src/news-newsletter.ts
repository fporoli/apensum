import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { escapeHtml, markdownPlain, renderMarkdown, safeHref, unescapeHtml } from '@worktime3/shared/markdown';
import { newsImageId, newsTextFor, type NewsTexts } from '@worktime3/shared/news';
import { purposeKey } from './jwt';

/**
 * Public product news (083) for the website and its newsletter: the HTML a post becomes, the mail
 * to one subscriber and the unsubscribe link in it. Pure, so tests need no database or SMTP.
 */

/** The API's public root as the caller reached it (behind Caddy: the forwarded host and scheme). */
export function publicApiRoot(req: Request): string {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:8001').split(',')[0].trim();
  return `${proto}://${host}/api/v1`;
}

/** The website's News page per language (apps/site/src/i18n/<lang>.mjs `slug.news`; a test keeps them equal). */
export const SITE_NEWS_SLUGS: Record<string, string> = { de: 'news', fr: 'actualites', it: 'novita', en: 'news' };

/** A post on the website: its News page opens the post from `?post=`. */
export function sitePostUrl(siteOrigin: string, lang: string, postId: string): string {
  const l = SITE_NEWS_SLUGS[lang] ? lang : 'de';
  return `${siteOrigin.replace(/\/$/, '')}/${l}/${SITE_NEWS_SLUGS[l]}/?post=${postId}`;
}

/** A picture of a public post, served without login (public-news.controller.ts). */
export const publicImageUrl = (apiRoot: string, postId: string, documentId: string) => `${apiRoot}/public/news/${postId}/images/${documentId}`;

/** A post's Markdown as HTML for the website or a mail: pictures from the public API, links that open elsewhere. */
export function publicPostHtml(body: string, apiRoot: string, postId: string, mail = false): string {
  const img = mail ? ' style="max-width:100%;height:auto;border-radius:8px;border:1px solid #e3e8f0"' : ' loading="lazy" decoding="async"';
  return renderMarkdown(body, {
    image: (src, alt) => {
      const id = newsImageId(unescapeHtml(src));
      return id ? `<img src="${escapeHtml(publicImageUrl(apiRoot, postId, id))}" alt="${alt}"${img}>` : alt;
    },
    link: (href, label) => (safeHref(unescapeHtml(href)) ? `<a href="${href}" rel="noopener"${mail ? ' style="color:#1a56db"' : ''}>${label}</a>` : label),
  });
}

/**
 * The unsubscribe token in every news mail: the subscriber's id and its HMAC. Unlike the one-time
 * links of 079 it never changes, so the link in an older mail still works.
 */
const unsubscribeMac = (id: string) => createHmac('sha256', purposeKey('newsletter-unsubscribe')).update(id).digest('base64url');
export function newsUnsubscribeToken(subscriberId: string): string {
  return `${subscriberId}_${unsubscribeMac(subscriberId)}`;
}
/** The subscriber id of a valid news-mail unsubscribe token, else null. */
export function verifyNewsUnsubscribeToken(token: string): string | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([A-Za-z0-9_-]{43})$/.exec(token);
  if (!m) return null;
  const expected = Buffer.from(unsubscribeMac(m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? m[1] : null;
}

const MAIL_TEXTS: Record<string, { browser: string; unsubscribe: string; why: string }> = {
  de: { browser: 'Im Browser lesen', unsubscribe: 'Abmelden', why: 'Sie erhalten diese E-Mail, weil Sie die News von Apensum abonniert haben.' },
  fr: { browser: 'Lire dans le navigateur', unsubscribe: 'Se désinscrire', why: 'Vous recevez cet e-mail car vous êtes abonné·e aux actualités d’Apensum.' },
  it: { browser: 'Leggere nel browser', unsubscribe: 'Disiscriversi', why: 'Riceve questa e-mail perché è iscritto/a alle novità di Apensum.' },
  en: { browser: 'Read in your browser', unsubscribe: 'Unsubscribe', why: 'You receive this e-mail because you subscribed to Apensum news.' },
};

export interface NewsIssue {
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/** The mail of a public post to one subscriber, in their language (else German, else the first written). */
export function newsletterIssue(
  post: { id: string; texts: NewsTexts },
  subscriber: { lang: string },
  links: { apiRoot: string; siteUrl: string; unsubscribeUrl: string },
): NewsIssue | null {
  const text = newsTextFor(post.texts, subscriber.lang);
  if (!text) return null;
  const t = MAIL_TEXTS[subscriber.lang] ?? MAIL_TEXTS.de;
  const body = publicPostHtml(text.body, links.apiRoot, post.id, true);
  const html = `<!doctype html>
<html lang="${text.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(text.title)}</title></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;border:1px solid #e3e8f0">
<tr><td style="padding:20px 28px 0;font-size:20px;font-weight:700;color:#1a56db">apensum</td></tr>
<tr><td style="padding:12px 28px 4px"><h1 style="margin:0;font-size:24px;line-height:1.3;color:#0f1a33">${escapeHtml(text.title)}</h1></td></tr>
<tr><td style="padding:4px 28px 20px;font-size:16px;line-height:1.6">${body}</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #e3e8f0;font-size:13px;line-height:1.5;color:#5b6475">
<a href="${escapeHtml(links.siteUrl)}" style="color:#1a56db">${t.browser}</a> · <a href="${escapeHtml(links.unsubscribeUrl)}" style="color:#5b6475">${t.unsubscribe}</a><br>${t.why}
</td></tr></table></td></tr></table></body></html>`;
  const plain = [text.title, '', markdownPlainParagraphs(text.body), '', `${t.browser}: ${links.siteUrl}`, `${t.unsubscribe}: ${links.unsubscribeUrl}`, '', t.why].join('\n');
  return {
    subject: text.title,
    text: `${plain}\n`,
    html,
    // RFC 2369 / 8058: the mail program's own "Unsubscribe" button, one click, no page.
    headers: { 'List-Unsubscribe': `<${links.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

/** Plain text of a Markdown text with its paragraphs kept apart (the mail's text part). */
function markdownPlainParagraphs(md: string): string {
  return md
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) =>
      /^\s*([-*]|\d+\.)\s+/.test(block)
        ? block.split('\n').map((l) => `- ${markdownPlain(l)}`).join('\n')
        : markdownPlain(block),
    )
    .filter(Boolean)
    .join('\n\n');
}
