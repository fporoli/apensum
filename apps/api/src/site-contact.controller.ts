import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from './jwt.guard';
import { sendMail, type MailOptions } from './mailer';
import { pushToOperator, type OperatorPush } from './operator-push';
import { isValidEmail } from './auth.controller';
import { clientIp } from './client-ip';

/** Per sender address (IP) and per hour. */
export const CONTACT_LIMIT_PER_IP = 5;
/** All senders together, per day: a flood never turns into a flood of mails. */
export const CONTACT_LIMIT_PER_DAY = 100;
/** Faster than this from opening the page to sending is a bot (the site's contact.js measures it). */
export const CONTACT_MIN_FILL_MS = 3000;
/** More links than this in a message is link spam. */
export const CONTACT_MAX_LINKS = 3;
/** The website form's topics (apps/site CONTACT_TOPICS), named in the subject for mail filters. */
export const CONTACT_TOPICS: Record<string, string> = {
  general: 'Allgemeine Frage',
  demo: 'Vorführung',
  pilot: 'Erste Kunden / Pilot',
  pricing: 'Anpassung / Offerte',
  invest: 'Investition / Partnerschaft',
};
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface ContactForm {
  name?: string;
  email?: string;
  organization?: string;
  message?: string;
  lang?: string;
  /** One of CONTACT_TOPICS; anything else counts as general. */
  topic?: string;
  /** Milliseconds the page was open before sending (empty without JavaScript). */
  elapsed?: string;
  /** Honeypot: hidden on the page, so only bots fill it in. */
  website?: string;
  /** Where to send the visitor afterwards: paths on the website (validated). */
  ok?: string;
  fail?: string;
}

/** The website's origins that may post the form (and that the visitor is sent back to). */
export function allowedOrigins(env: string | undefined = process.env.CONTACT_SITE_ORIGINS): string[] {
  return (env || 'https://apensum.ch,https://www.apensum.ch,http://localhost:3010')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

/** A page path of the website: `/de/kontakt/danke/`. Anything else falls back to the origin. */
export function safeBackPath(path: unknown): string {
  return typeof path === 'string' && /^\/[a-z]{2}\/[a-z-]+\/[a-z-]+\/$/.test(path) ? path : '/';
}

const oneLine = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : '');

/** Checks the fields; null when the form is not usable. */
/** The hint on the operator's phone about a message: its topic only (one of CONTACT_TOPICS). */
export function contactPush(topicKey: unknown): OperatorPush {
  const key = oneLine(topicKey, 20);
  const topic = Object.hasOwn(CONTACT_TOPICS, key) ? CONTACT_TOPICS[key] : CONTACT_TOPICS.general;
  return { title: 'Neue Nachricht über die Website', message: `Thema: ${topic}. Die Nachricht ist in der Mailbox.`, tags: ['incoming_envelope'], priority: 4 };
}

export function contactMail(form: ContactForm, to: string): MailOptions | null {
  const name = oneLine(form.name, 120);
  const email = oneLine(form.email, 200);
  const organization = oneLine(form.organization, 200);
  const lang = oneLine(form.lang, 5);
  const topicKey = oneLine(form.topic, 20);
  const topic = Object.hasOwn(CONTACT_TOPICS, topicKey) ? CONTACT_TOPICS[topicKey] : CONTACT_TOPICS.general;
  const message = typeof form.message === 'string' ? form.message.trim().slice(0, 5000) : '';
  if (!name || !isValidEmail(email) || message.length < 2) return null;
  return {
    to,
    replyTo: email,
    subject: `[Website] ${topic}: ${name}`,
    text: [
      `Thema: ${topic}`,
      `Name: ${name}`,
      `E-Mail: ${email}`,
      organization ? `Organisation: ${organization}` : null,
      lang ? `Sprache: ${lang}` : null,
      '',
      message,
      '',
      '-- ',
      'Gesendet über das Kontaktformular auf der Website. "Antworten" geht direkt an die Absenderin/den Absender.',
    ]
      .filter((l) => l !== null)
      .join('\n'),
  };
}

const LINK = /https?:\/\/|www\./i;

/**
 * Why a form that got past the honeypot is still a bot, or null: sent too fast after opening the
 * page, links in the name or organization, or more than CONTACT_MAX_LINKS links in the message.
 */
export function spamReason(form: ContactForm): string | null {
  const elapsed = Number(oneLine(form.elapsed, 20) || NaN);
  if (Number.isFinite(elapsed) && elapsed < CONTACT_MIN_FILL_MS) return 'too-fast';
  if ([form.name, form.organization].some((v) => typeof v === 'string' && LINK.test(v))) return 'link-in-name';
  const links = typeof form.message === 'string' ? form.message.split(LINK).length - 1 : 0;
  if (links > CONTACT_MAX_LINKS) return 'too-many-links';
  return null;
}

/**
 * The website's contact form (apps/site, a static site without a server of its own): a plain HTML
 * form post, answered with a redirect back to the site's thank-you or error page. The site's
 * contact.js sends the same form with fetch and `Accept: application/json` instead (so the page
 * shows that it is sending), and gets `{ ok }` / `{ ok: false, error }` to pick the page itself. The message goes
 * only to CONTACT_EMAIL (never to an address from the form, so this is no relay), with the visitor
 * as Reply-To, through the API's SMTP setting (on a VPS instance without a relay: its Mailpit).
 */
@Controller()
export class SiteContactController {
  /** Replaceable in tests. */
  send: (mail: MailOptions) => Promise<void> = (mail) => sendMail(mail, 10_000);
  /** The hint on the operator's phone (operator-push.ts); replaceable in tests. */
  push: (push: OperatorPush) => Promise<boolean> = (push) => pushToOperator(push);
  now: () => number = () => Date.now(); // real time: rate limit
  private readonly perIp = new Map<string, number[]>();
  private sentToday: number[] = [];

  @Public()
  @Post('public/contact')
  async submit(@Body() form: ContactForm, @Req() req: Request, @Res() res: Response): Promise<void> {
    const origin = String(req.headers.origin ?? '').replace(/\/$/, '');
    const origins = allowedOrigins();
    if (!origins.includes(origin)) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    const json = String(req.headers.accept ?? '').includes('application/json');
    const done = (error?: string) => {
      if (json) res.status(200).json(error ? { ok: false, error } : { ok: true });
      else res.redirect(303, origin + safeBackPath(error ? form?.fail : form?.ok));
    };
    // A bot filled in the hidden field: look successful, send nothing.
    if (oneLine(form?.website, 200)) return done();
    // The same for the other bot signs; logged (without content) so a lost real message can be explained.
    const spam = spamReason(form ?? {});
    if (spam) {
      // eslint-disable-next-line no-console
      console.log(`contact: message dropped as spam (${spam})`);
      return done();
    }

    const mail = contactMail(form ?? {}, process.env.CONTACT_EMAIL || 'info@apensum.ch');
    if (!mail) return done('invalid');
    if (!this.allow(clientIp(req))) {
      // eslint-disable-next-line no-console
      console.log('contact: message refused, sending limit reached');
      return done('rate-limited');
    }
    try {
      await this.send(mail);
      done();
      // Only the topic (a fixed list), never who wrote or what: the push leaves Switzerland.
      void this.push(contactPush(form?.topic));
    } catch {
      done('mail-failed');
    }
  }

  private allow(ip: string): boolean {
    const now = this.now();
    this.sentToday = this.sentToday.filter((t) => t > now - DAY);
    const mine = (this.perIp.get(ip) ?? []).filter((t) => t > now - HOUR);
    if (mine.length >= CONTACT_LIMIT_PER_IP || this.sentToday.length >= CONTACT_LIMIT_PER_DAY) return false;
    mine.push(now);
    this.perIp.set(ip, mine);
    this.sentToday.push(now);
    if (this.perIp.size > 10_000) this.perIp.clear();
    return true;
  }
}

export { clientIp };
