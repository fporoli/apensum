import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { DbService } from './db.service';
import { Public } from './jwt.guard';
import { publicApiRoot, verifyNewsUnsubscribeToken } from './news-newsletter';
import { sendMail, type MailOptions } from './mailer';
import { isValidEmail } from './auth.controller';
import { allowedOrigins, clientIp, safeBackPath } from './site-contact.controller';

/**
 * The website's news (apps/site): subscribe with double opt-in, and unsubscribe. The site is static,
 * so its forms post here (like public/contact) and are sent back to its pages. Subscribing mails a
 * confirmation link; only a confirmed address counts. The links in mails lead to a small page with a
 * button (GET shows it, POST acts): mail scanners open links, and must not confirm or unsubscribe.
 * Unsubscribing from the website mails an unsubscribe link, and the answer never tells whether an
 * address is subscribed. Sending the news itself is not part of this.
 */

export const NEWSLETTER_LANGS = ['de', 'fr', 'it', 'en'] as const;
export type NewsletterLang = (typeof NEWSLETTER_LANGS)[number];
/** Subscribe and unsubscribe requests per address (IP) and hour. */
export const NEWSLETTER_LIMIT_PER_IP = 5;
/** Mails these forms may send in a day, all together. */
export const NEWSLETTER_LIMIT_PER_DAY = 200;
/** One address gets at most one mail in this time (a form cannot flood someone's inbox). */
export const NEWSLETTER_MAIL_GAP_MS = 10 * 60 * 1000;
/** A confirmation link older than this no longer confirms (subscribe again). */
export const NEWSLETTER_CONFIRM_DAYS = 7;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface Subscriber {
  id: string;
  email: string;
  lang: NewsletterLang;
  status: 'pending' | 'confirmed' | 'unsubscribed';
  site_origin: string;
  requested_at: Date;
  last_mail_at: Date | null;
}

/** The table newsletter_subscribers (079); replaceable in tests. */
export interface SubscriberStore {
  byEmail(email: string): Promise<Subscriber | null>;
  byToken(tokenHash: string): Promise<Subscriber | null>;
  /** For the unsubscribe link in news mails, which names the subscriber (news-newsletter.ts). */
  byId(id: string): Promise<Subscriber | null>;
  /** Creates or updates the row for `email` as pending with a new link (re-subscribing after unsubscribing too). */
  requestSubscription(email: string, lang: NewsletterLang, siteOrigin: string, tokenHash: string, now: Date): Promise<void>;
  /** A new link for the row (an unsubscribe link mailed on request); records the mail. */
  renewToken(id: string, tokenHash: string, now: Date): Promise<void>;
  confirm(id: string, now: Date): Promise<void>;
  unsubscribe(id: string, now: Date): Promise<void>;
}

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function newsletterLang(value: unknown): NewsletterLang {
  return (NEWSLETTER_LANGS as readonly string[]).includes(String(value)) ? (value as NewsletterLang) : 'de';
}

const TEXTS: Record<NewsletterLang, Record<string, string>> = {
  de: {
    confirmSubject: 'Apensum News: Bitte bestätigen Sie Ihre Anmeldung',
    confirmBody: 'Guten Tag\n\nSie möchten die News von Apensum erhalten. Bitte bestätigen Sie die Anmeldung mit diesem Link (gültig {{days}} Tage):\n\n{{link}}\n\nWenn Sie sich nicht angemeldet haben, ignorieren Sie diese E-Mail: Ohne Bestätigung erhalten Sie nichts.\n\nApensum',
    unsubscribeSubject: 'Apensum News: Abmelden',
    unsubscribeBody: 'Guten Tag\n\nMit diesem Link melden Sie sich von den News von Apensum ab:\n\n{{link}}\n\nWenn Sie das nicht angefordert haben, ignorieren Sie diese E-Mail.\n\nApensum',
    confirmTitle: 'Anmeldung bestätigen',
    confirmText: 'Bestätigen Sie, dass {{email}} die News von Apensum erhalten soll.',
    confirmButton: 'Anmeldung bestätigen',
    confirmedTitle: 'Vielen Dank!',
    confirmedText: 'Ihre Anmeldung ist bestätigt. Abmelden können Sie sich jederzeit über den Link in jeder News oder auf der Website.',
    unsubscribeTitle: 'Von den News abmelden',
    unsubscribeText: '{{email}} erhält danach keine News von Apensum mehr.',
    unsubscribeButton: 'Abmelden',
    unsubscribedTitle: 'Sie sind abgemeldet',
    unsubscribedText: 'Sie erhalten keine News von Apensum mehr. Anmelden können Sie sich jederzeit wieder auf der Website.',
    invalidTitle: 'Dieser Link gilt nicht (mehr)',
    invalidText: 'Er ist abgelaufen oder wurde durch einen neueren ersetzt. Auf der Website können Sie sich neu an- oder abmelden.',
    back: 'Zur Website',
  },
  fr: {
    confirmSubject: 'Actualités Apensum : veuillez confirmer votre inscription',
    confirmBody: "Bonjour\n\nVous souhaitez recevoir les actualités d'Apensum. Veuillez confirmer votre inscription avec ce lien (valable {{days}} jours) :\n\n{{link}}\n\nSi vous ne vous êtes pas inscrit·e, ignorez cet e-mail : sans confirmation, vous ne recevrez rien.\n\nApensum",
    unsubscribeSubject: 'Actualités Apensum : désinscription',
    unsubscribeBody: "Bonjour\n\nAvec ce lien, vous vous désinscrivez des actualités d'Apensum :\n\n{{link}}\n\nSi vous ne l'avez pas demandé, ignorez cet e-mail.\n\nApensum",
    confirmTitle: "Confirmer l'inscription",
    confirmText: "Confirmez que {{email}} doit recevoir les actualités d'Apensum.",
    confirmButton: "Confirmer l'inscription",
    confirmedTitle: 'Merci !',
    confirmedText: 'Votre inscription est confirmée. Vous pouvez vous désinscrire à tout moment via le lien présent dans chaque envoi ou sur le site.',
    unsubscribeTitle: 'Se désinscrire des actualités',
    unsubscribeText: "{{email}} ne recevra plus d'actualités d'Apensum.",
    unsubscribeButton: 'Se désinscrire',
    unsubscribedTitle: 'Vous êtes désinscrit·e',
    unsubscribedText: "Vous ne recevrez plus d'actualités d'Apensum. Vous pouvez vous réinscrire à tout moment sur le site.",
    invalidTitle: "Ce lien n'est plus valable",
    invalidText: 'Il a expiré ou a été remplacé par un plus récent. Sur le site, vous pouvez vous inscrire ou vous désinscrire à nouveau.',
    back: 'Vers le site',
  },
  it: {
    confirmSubject: 'Novità Apensum: confermi la sua iscrizione',
    confirmBody: "Buongiorno\n\nDesidera ricevere le novità di Apensum. Confermi l'iscrizione con questo link (valido {{days}} giorni):\n\n{{link}}\n\nSe non si è iscritto/a, ignori questa e-mail: senza conferma non riceverà nulla.\n\nApensum",
    unsubscribeSubject: 'Novità Apensum: disiscrizione',
    unsubscribeBody: "Buongiorno\n\nCon questo link si disiscrive dalle novità di Apensum:\n\n{{link}}\n\nSe non l'ha richiesto, ignori questa e-mail.\n\nApensum",
    confirmTitle: "Confermare l'iscrizione",
    confirmText: 'Confermi che {{email}} deve ricevere le novità di Apensum.',
    confirmButton: "Confermare l'iscrizione",
    confirmedTitle: 'Grazie!',
    confirmedText: "L'iscrizione è confermata. Può disiscriversi in ogni momento tramite il link in ogni invio o sul sito.",
    unsubscribeTitle: 'Disiscriversi dalle novità',
    unsubscribeText: '{{email}} non riceverà più novità da Apensum.',
    unsubscribeButton: 'Disiscriversi',
    unsubscribedTitle: 'È disiscritto/a',
    unsubscribedText: 'Non riceverà più novità da Apensum. Può iscriversi di nuovo in ogni momento sul sito.',
    invalidTitle: 'Questo link non è (più) valido',
    invalidText: 'È scaduto o è stato sostituito da uno più recente. Sul sito può iscriversi o disiscriversi di nuovo.',
    back: 'Al sito',
  },
  en: {
    confirmSubject: 'Apensum news: please confirm your subscription',
    confirmBody: "Hello\n\nYou would like to receive Apensum's news. Please confirm with this link (valid for {{days}} days):\n\n{{link}}\n\nIf you did not sign up, ignore this e-mail: without confirmation you will receive nothing.\n\nApensum",
    unsubscribeSubject: 'Apensum news: unsubscribe',
    unsubscribeBody: "Hello\n\nThis link unsubscribes you from Apensum's news:\n\n{{link}}\n\nIf you did not ask for it, ignore this e-mail.\n\nApensum",
    confirmTitle: 'Confirm your subscription',
    confirmText: "Confirm that {{email}} should receive Apensum's news.",
    confirmButton: 'Confirm subscription',
    confirmedTitle: 'Thank you!',
    confirmedText: 'Your subscription is confirmed. You can unsubscribe at any time with the link in every issue or on the website.',
    unsubscribeTitle: "Unsubscribe from Apensum's news",
    unsubscribeText: '{{email}} will no longer receive news from Apensum.',
    unsubscribeButton: 'Unsubscribe',
    unsubscribedTitle: 'You are unsubscribed',
    unsubscribedText: 'You will no longer receive news from Apensum. You can subscribe again at any time on the website.',
    invalidTitle: 'This link is not valid (any more)',
    invalidText: 'It expired or was replaced by a newer one. You can subscribe or unsubscribe again on the website.',
    back: 'To the website',
  },
};

const fill = (text: string, vars: Record<string, string | number>) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
const escHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function newsletterText(lang: NewsletterLang, key: string, vars: Record<string, string | number> = {}): string {
  return fill(TEXTS[lang][key] ?? TEXTS.de[key], vars);
}

/** The mail with a confirm or unsubscribe link, in the subscriber's language. */
export function newsletterMail(kind: 'confirm' | 'unsubscribe', to: string, lang: NewsletterLang, link: string): MailOptions {
  return {
    to,
    subject: newsletterText(lang, `${kind}Subject`),
    text: newsletterText(lang, `${kind}Body`, { link, days: NEWSLETTER_CONFIRM_DAYS }),
  };
}

/** The small page a link in a mail opens: a message and, to act, a button that posts the token back. */
export function newsletterPage(lang: NewsletterLang, page: { title: string; text: string; action?: { url: string; token: string; button: string }; back?: string }): string {
  const button = page.action
    ? `<form method="post" action="${escHtml(page.action.url)}"><input type="hidden" name="t" value="${escHtml(page.action.token)}"><button type="submit">${escHtml(page.action.button)}</button></form>`
    : '';
  const back = page.back ? `<p><a href="${escHtml(page.back)}">${escHtml(newsletterText(lang, 'back'))}</a></p>` : '';
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escHtml(page.title)} – Apensum</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fc; color: #2b3550;
         font: 16px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 480px; margin: 24px; padding: 32px; background: #fff; border: 1px solid #e3e8f2; border-radius: 14px; }
  h1 { margin: 0 0 12px; font-size: 1.4rem; color: #0f1a33; }
  button { margin-top: 12px; padding: 10px 18px; border: 0; border-radius: 9px; background: #1a56db; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
  a { color: #1a56db; }
  @media (prefers-color-scheme: dark) { body { background: #0b1222; color: #c8d2e6; } main { background: #111b31; border-color: #22304d; } h1 { color: #fff; } }
</style>
</head>
<body><main><h1>${escHtml(page.title)}</h1><p>${escHtml(page.text)}</p>${button}${back}</main></body>
</html>`;
}

/** The API's own address as the visitor reached it (behind the edge Caddy, from X-Forwarded-*). */
function apiBase(req: Request): string {
  return `${publicApiRoot(req)}/public/newsletter`;
}

export interface NewsletterForm {
  email?: string;
  lang?: string;
  /** Honeypot: hidden on the page, so only bots fill it in. */
  website?: string;
  /** Where to send the visitor afterwards: paths on the website (validated). */
  ok?: string;
  fail?: string;
}

@Controller('public/newsletter')
export class SiteNewsletterController {
  /** Replaceable in tests. */
  send: (mail: MailOptions) => Promise<void> = (mail) => sendMail(mail, 10_000);
  now: () => number = () => Date.now();
  store: SubscriberStore;
  private readonly perIp = new Map<string, number[]>();
  private mailedToday: number[] = [];

  constructor(db: DbService) {
    this.store = dbSubscriberStore(db);
  }

  /** The website's subscribe form: a confirmation link to the address; the visitor goes back to "check your inbox". */
  @Public()
  @Post('subscribe')
  async subscribe(@Body() form: NewsletterForm, @Req() req: Request, @Res() res: Response): Promise<void> {
    const back = this.formBack(req, res, form);
    if (!back) return;
    if (String(form?.website ?? '').trim()) return back(); // a bot: look successful, do nothing
    const email = String(form?.email ?? '').trim().toLowerCase().slice(0, 200);
    if (!isValidEmail(email)) return back('invalid');
    if (!this.allowIp(clientIp(req))) return back('rate-limited');
    try {
      const existing = await this.store.byEmail(email);
      // Already confirmed: nothing to do, and the answer looks the same (no telling who is subscribed).
      if (existing?.status === 'confirmed') return back();
      if (!this.mayMail(existing)) return back();
      const token = newToken();
      const now = new Date(this.now());
      await this.store.requestSubscription(email, newsletterLang(form?.lang), back.origin, hashToken(token), now);
      await this.send(newsletterMail('confirm', email, newsletterLang(form?.lang), `${apiBase(req)}/confirm?t=${token}`));
      back();
    } catch {
      back('failed');
    }
  }

  /** The website's unsubscribe form: an unsubscribe link to the address if it is subscribed; the same answer either way. */
  @Public()
  @Post('unsubscribe-request')
  async unsubscribeRequest(@Body() form: NewsletterForm, @Req() req: Request, @Res() res: Response): Promise<void> {
    const back = this.formBack(req, res, form);
    if (!back) return;
    if (String(form?.website ?? '').trim()) return back();
    const email = String(form?.email ?? '').trim().toLowerCase().slice(0, 200);
    if (!isValidEmail(email)) return back('invalid');
    if (!this.allowIp(clientIp(req))) return back('rate-limited');
    try {
      const existing = await this.store.byEmail(email);
      if (existing && existing.status !== 'unsubscribed' && this.mayMail(existing)) {
        const token = newToken();
        await this.store.renewToken(existing.id, hashToken(token), new Date(this.now()));
        await this.send(newsletterMail('unsubscribe', email, existing.lang, `${apiBase(req)}/unsubscribe?t=${token}`));
      }
      back();
    } catch {
      back('failed');
    }
  }

  /** The confirmation link: a page with the button (scanners only GET). */
  @Public()
  @Get('confirm')
  async confirmPage(@Query('t') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const sub = await this.valid(token, 'confirm');
    if (!sub) return this.page(res, 'de', 'invalid');
    if (sub.status === 'confirmed') return this.page(res, sub.lang, 'confirmed', sub);
    this.page(res, sub.lang, 'confirm', sub, { url: `${apiBase(req)}/confirm`, token });
  }

  @Public()
  @Post('confirm')
  async confirm(@Body() body: { t?: string }, @Query('t') queryToken: string, @Res() res: Response): Promise<void> {
    const sub = await this.valid(body?.t ?? queryToken, 'confirm');
    if (!sub) return this.page(res, 'de', 'invalid');
    if (sub.status !== 'confirmed') await this.store.confirm(sub.id, new Date(this.now()));
    this.page(res, sub.lang, 'confirmed', sub);
  }

  /** The unsubscribe link: a page with the button. */
  @Public()
  @Get('unsubscribe')
  async unsubscribePage(@Query('t') token: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const sub = await this.valid(token, 'unsubscribe');
    if (!sub) return this.page(res, 'de', 'invalid');
    if (sub.status === 'unsubscribed') return this.page(res, sub.lang, 'unsubscribed', sub);
    this.page(res, sub.lang, 'unsubscribe', sub, { url: `${apiBase(req)}/unsubscribe`, token });
  }

  /** The button, and one-click unsubscribing from a mail program (RFC 8058: POST with the token in the link). */
  @Public()
  @Post('unsubscribe')
  async unsubscribe(@Body() body: { t?: string }, @Query('t') queryToken: string, @Res() res: Response): Promise<void> {
    const sub = await this.valid(body?.t ?? queryToken, 'unsubscribe');
    if (!sub) return this.page(res, 'de', 'invalid');
    if (sub.status !== 'unsubscribed') await this.store.unsubscribe(sub.id, new Date(this.now()));
    this.page(res, sub.lang, 'unsubscribed', sub);
  }

  /** The subscriber a link's token belongs to; a confirmation link only while pending and not expired. */
  private async valid(token: unknown, purpose: 'confirm' | 'unsubscribe'): Promise<Subscriber | null> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
    // A news mail's link: signed, names the subscriber, never expires (it only unsubscribes).
    const signedId = purpose === 'unsubscribe' ? verifyNewsUnsubscribeToken(token) : null;
    const sub = await (signedId ? this.store.byId(signedId) : this.store.byToken(hashToken(token))).catch(() => null);
    if (!sub) return null;
    if (purpose === 'confirm' && sub.status === 'pending' && this.now() - new Date(sub.requested_at).getTime() > NEWSLETTER_CONFIRM_DAYS * DAY) return null;
    if (purpose === 'confirm' && sub.status === 'unsubscribed') return null;
    return sub;
  }

  private page(res: Response, lang: NewsletterLang, kind: 'confirm' | 'confirmed' | 'unsubscribe' | 'unsubscribed' | 'invalid', sub?: Subscriber, action?: { url: string; token: string }): void {
    const vars = { email: sub?.email ?? '' };
    const button = kind === 'confirm' ? 'confirmButton' : 'unsubscribeButton';
    res
      .status(kind === 'invalid' ? 404 : 200)
      .set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
      .send(newsletterPage(lang, {
        title: newsletterText(lang, `${kind}Title`, vars),
        text: newsletterText(lang, `${kind}Text`, vars),
        action: action ? { ...action, button: newsletterText(lang, button) } : undefined,
        back: sub ? `${sub.site_origin}/${sub.lang}/` : undefined,
      }));
  }

  /** Checks the website's Origin; returns how to answer (redirect back, or JSON), or null when refused. */
  private formBack(req: Request, res: Response, form: NewsletterForm) {
    const origin = String(req.headers.origin ?? '').replace(/\/$/, '');
    if (!allowedOrigins().includes(origin)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return null;
    }
    const json = String(req.headers.accept ?? '').includes('application/json');
    return Object.assign(
      (error?: string) => {
        if (json) res.status(200).json(error ? { ok: false, error } : { ok: true });
        else res.redirect(303, origin + safeBackPath(error ? form?.fail : form?.ok));
      },
      { origin },
    );
  }

  /** At most one mail per address in NEWSLETTER_MAIL_GAP_MS, and NEWSLETTER_LIMIT_PER_DAY in all. */
  private mayMail(existing: Subscriber | null): boolean {
    const now = this.now();
    if (existing?.last_mail_at && now - new Date(existing.last_mail_at).getTime() < NEWSLETTER_MAIL_GAP_MS) return false;
    this.mailedToday = this.mailedToday.filter((t) => t > now - DAY);
    if (this.mailedToday.length >= NEWSLETTER_LIMIT_PER_DAY) return false;
    this.mailedToday.push(now);
    return true;
  }

  private allowIp(ip: string): boolean {
    const now = this.now();
    const mine = (this.perIp.get(ip) ?? []).filter((t) => t > now - HOUR);
    if (mine.length >= NEWSLETTER_LIMIT_PER_IP) return false;
    mine.push(now);
    this.perIp.set(ip, mine);
    if (this.perIp.size > 10_000) this.perIp.clear();
    return true;
  }
}

/** The store on the API's database (offline: nothing found, nothing written). */
export function dbSubscriberStore(dbService: DbService): SubscriberStore {
  const db = () => {
    const d = dbService.getDb();
    if (!d) throw new Error('db-unavailable');
    return d;
  };
  const row = (rows: unknown[]): Subscriber | null => (rows[0] as Subscriber | undefined) ?? null;
  const cols = sql.raw('id, email::text AS email, lang, status, site_origin, requested_at, last_mail_at');
  return {
    byEmail: async (email) => row((await db().execute(sql`SELECT ${cols} FROM newsletter_subscribers WHERE email = ${email}`)).rows),
    byToken: async (hash) => row((await db().execute(sql`SELECT ${cols} FROM newsletter_subscribers WHERE token_hash = ${hash}`)).rows),
    byId: async (id) => row((await db().execute(sql`SELECT ${cols} FROM newsletter_subscribers WHERE id = ${id}::uuid`)).rows),
    requestSubscription: async (email, lang, origin, hash, now) => {
      await db().execute(sql`
        INSERT INTO newsletter_subscribers (email, lang, status, token_hash, site_origin, requested_at, last_mail_at)
        VALUES (${email}, ${lang}, 'pending', ${hash}, ${origin}, ${now.toISOString()}, ${now.toISOString()})
        ON CONFLICT (email) DO UPDATE SET lang = EXCLUDED.lang, status = 'pending', token_hash = EXCLUDED.token_hash,
          site_origin = EXCLUDED.site_origin, requested_at = EXCLUDED.requested_at, last_mail_at = EXCLUDED.last_mail_at,
          confirmed_at = NULL, unsubscribed_at = NULL`);
    },
    renewToken: async (id, hash, now) => {
      await db().execute(sql`UPDATE newsletter_subscribers SET token_hash = ${hash}, last_mail_at = ${now.toISOString()} WHERE id = ${id}::uuid`);
    },
    confirm: async (id, now) => {
      await db().execute(sql`UPDATE newsletter_subscribers SET status = 'confirmed', confirmed_at = ${now.toISOString()} WHERE id = ${id}::uuid AND status = 'pending'`);
    },
    unsubscribe: async (id, now) => {
      await db().execute(sql`UPDATE newsletter_subscribers SET status = 'unsubscribed', unsubscribed_at = ${now.toISOString()} WHERE id = ${id}::uuid`);
    },
  };
}
