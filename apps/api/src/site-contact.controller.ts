import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from './jwt.guard';
import { sendMail, type MailOptions } from './mailer';
import { isValidEmail } from './auth.controller';

/** Per sender address (IP) and per hour. */
export const CONTACT_LIMIT_PER_IP = 5;
/** All senders together, per day: a flood never turns into a flood of mails. */
export const CONTACT_LIMIT_PER_DAY = 100;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface ContactForm {
  name?: string;
  email?: string;
  organization?: string;
  message?: string;
  lang?: string;
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
export function contactMail(form: ContactForm, to: string): MailOptions | null {
  const name = oneLine(form.name, 120);
  const email = oneLine(form.email, 200);
  const organization = oneLine(form.organization, 200);
  const lang = oneLine(form.lang, 5);
  const message = typeof form.message === 'string' ? form.message.trim().slice(0, 5000) : '';
  if (!name || !isValidEmail(email) || message.length < 2) return null;
  return {
    to,
    replyTo: email,
    subject: `Apensum-Website: Anfrage von ${name}`,
    text: [
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

/**
 * The website's contact form (apps/site, a static site without a server of its own): a plain HTML
 * form post, answered with a redirect back to the site's thank-you or error page. The message goes
 * only to CONTACT_EMAIL (never to an address from the form, so this is no relay), with the visitor
 * as Reply-To, through the API's SMTP setting (on a VPS instance without a relay: its Mailpit).
 */
@Controller()
export class SiteContactController {
  /** Replaceable in tests. */
  send: (mail: MailOptions) => Promise<void> = (mail) => sendMail(mail, 10_000);
  now: () => number = () => Date.now();
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
    const back = (path: unknown) => res.redirect(303, origin + safeBackPath(path));
    // A bot filled in the hidden field: look successful, send nothing.
    if (oneLine(form?.website, 200)) return back(form.ok);

    const mail = contactMail(form ?? {}, process.env.CONTACT_EMAIL || 'info@apensum.ch');
    if (!mail || !this.allow(clientIp(req))) return back(form?.fail);
    try {
      await this.send(mail);
      back(form.ok);
    } catch {
      back(form.fail);
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

/** Behind the edge Caddy, which sets X-Forwarded-For to the client it saw. */
function clientIp(req: Request): string {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}
