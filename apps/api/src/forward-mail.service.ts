import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Executor } from './access';
import { AuditService } from './audit.service';
import { sendMail } from './mailer';
import { appBaseUrl } from './orgs.controller';

/** At most this many people per forward: it is a reminder to colleagues, not a mailing list. */
export const MAX_FORWARD_RECIPIENTS = 20;
const MAX_SUBJECT = 200;
const MAX_MESSAGE = 5000;

const FOOTER: Record<string, (name: string) => string> = {
  en: (name) => `Sent by ${name} via Apensum. Reply to this e-mail to answer ${name}.`,
  de: (name) => `Gesendet von ${name} über Apensum. Antworte auf diese E-Mail, um ${name} zu antworten.`,
  fr: (name) => `Envoyé par ${name} via Apensum. Répondez à cet e-mail pour répondre à ${name}.`,
  it: (name) => `Inviato da ${name} tramite Apensum. Rispondi a questa e-mail per rispondere a ${name}.`,
};
const OPEN: Record<string, string> = { en: 'Open in Apensum', de: 'In Apensum öffnen', fr: 'Ouvrir dans Apensum', it: 'Apri in Apensum' };

export interface ForwardInput {
  userIds?: unknown;
  subject?: unknown;
  message?: unknown;
}

/** The mail text: the sender's message, the link back into the app and who sent it, in the recipient's language. */
export function forwardMailText(message: string, link: string, senderName: string, locale: string | null | undefined): string {
  const lang = (locale ?? 'en').slice(0, 2);
  const footer = FOOTER[lang] ?? FOOTER.en;
  return `${message.trim()}\n\n${OPEN[lang] ?? OPEN.en}: ${link}\n\n--\n${footer(senderName)}\n`;
}

/** Checks the request body: 1..MAX recipients (ids), a subject and a message, trimmed and bounded. */
export function parseForward(body: ForwardInput): { ok: true; userIds: string[]; subject: string; message: string } | { ok: false; error: string } {
  const ids = Array.isArray(body.userIds) ? [...new Set(body.userIds.filter((x): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)))] : [];
  if (ids.length === 0) return { ok: false, error: 'no-recipients' };
  if (ids.length > MAX_FORWARD_RECIPIENTS) return { ok: false, error: 'too-many-recipients' };
  const subject = typeof body.subject === 'string' ? body.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_SUBJECT) : '';
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE) : '';
  if (!subject) return { ok: false, error: 'subject-required' };
  if (!message) return { ok: false, error: 'message-required' };
  return { ok: true, userIds: ids, subject, message };
}

/**
 * "Send by e-mail" on requests and Approvals items: the server mails colleagues (active members of
 * the organization only, so nothing leaves it and the app is no open relay). The caller checks access
 * to the item first. Sent from the app's address with Reply-To the sender; recorded in the audit log.
 * Unlike notification mail this is the action itself, so a failure is reported, not swallowed.
 */
@Injectable()
export class ForwardMailService {
  constructor(private readonly audit: AuditService) {}

  async send(
    db: Executor,
    orgId: string,
    senderId: string,
    body: ForwardInput,
    target: { type: string; id: string; path: string },
  ): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
    const input = parseForward(body);
    if (!input.ok) return input;
    const recipients = (
      await db.execute(sql`
        SELECT u.id, u.email, u.locale FROM organization_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ${orgId} AND m.status = 'active' AND u.is_active
          AND u.id IN (${sql.join(input.userIds.map((x) => sql`${x}`), sql`, `)})`)
    ).rows as { id: string; email: string; locale: string | null }[];
    if (recipients.length !== input.userIds.length) return { ok: false, error: 'unknown-recipient' };
    const sender = (await db.execute(sql`SELECT coalesce(nullif(display_name, ''), email) AS name, email FROM users WHERE id = ${senderId}`)).rows[0] as
      | { name: string; email: string }
      | undefined;
    if (!sender) return { ok: false, error: 'unauthenticated' };
    const link = `${appBaseUrl()}/${target.path}`;
    let sent = 0;
    try {
      for (const r of recipients) {
        // Someone is waiting on the result: allow a slow relay more time than background mail.
        await sendMail({ to: r.email, replyTo: sender.email, subject: input.subject, text: forwardMailText(input.message, link, sender.name, r.locale) }, 15_000);
        sent += 1;
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`forward mail failed after ${sent} of ${recipients.length}: ${err instanceof Error ? err.message : err}`);
      return { ok: false, error: sent > 0 ? 'mail-partly-sent' : 'mail-failed' };
    } finally {
      if (sent > 0) {
        void this.audit
          .record(orgId, senderId, 'mail.forward', target.type, target.id, { recipients: recipients.slice(0, sent).map((r) => r.id), subject: input.subject })
          .catch(() => {});
      }
    }
    return { ok: true, sent };
  }
}
