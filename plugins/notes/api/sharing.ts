/**
 * Sharing a note (notes.controller.ts): the e-mail addresses a note may be forwarded to, a limit per person and hour
 * (the text leaves the app, so the app must not become a mail relay), and the mail in the recipient's language.
 * Pure, tested in test/notes.test.ts.
 */

import { isMailAddress, MAX_MAIL_ADDRESSES, splitAddresses } from '../shared/mail';

export { MAX_MAIL_ADDRESSES };
/** At most this many addresses per person and hour. */
export const MAX_MAILS_PER_HOUR = 30;

/** The addresses as given (a list, or text separated by commas, semicolons or spaces): trimmed, lower-case, once each. */
export function parseAddresses(raw: unknown): { ok: true; addresses: string[] } | { ok: false; error: string } {
  const parts = (Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [])
    .filter((a): a is string => typeof a === 'string').flatMap(splitAddresses);
  const addresses = [...new Set(parts)];
  if (addresses.length === 0) return { ok: false, error: 'no-addresses' };
  if (addresses.length > MAX_MAIL_ADDRESSES) return { ok: false, error: 'too-many-addresses' };
  if (addresses.some((a) => !isMailAddress(a))) return { ok: false, error: 'invalid-address' };
  return { ok: true, addresses };
}

/** Counts per person in a sliding hour; `take` says whether `n` more fit and takes them. */
export class HourlyLimit {
  private readonly sent = new Map<string, number[]>();
  constructor(private readonly max: number) {}
  take(key: string, n: number, now = Date.now()): boolean { // real time: rate limit
    const recent = (this.sent.get(key) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length + n > this.max) { this.sent.set(key, recent); return false; }
    this.sent.set(key, [...recent, ...Array<number>(n).fill(now)]);
    return true;
  }
}

type Lang = 'de' | 'fr' | 'it' | 'en';
const MAIL: Record<Lang, { subject: string; intro: string; message: string; link: string; external: string }> = {
  de: { subject: 'Notiz von {name}', intro: '{name} hat Ihnen eine Notiz aus Apensum weitergeleitet:', message: 'Nachricht von {name}:', link: 'In Apensum öffnen:', external: 'Sie erhalten diese E-Mail, weil {name} ({email}) sie Ihnen geschickt hat. Antworten gehen an diese Person.' },
  fr: { subject: 'Note de {name}', intro: '{name} vous a transmis une note d’Apensum :', message: 'Message de {name} :', link: 'Ouvrir dans Apensum :', external: 'Vous recevez cet e-mail parce que {name} ({email}) vous l’a envoyé. Les réponses vont à cette personne.' },
  it: { subject: 'Nota di {name}', intro: '{name} le ha inoltrato una nota da Apensum:', message: 'Messaggio di {name}:', link: 'Aprire in Apensum:', external: 'Riceve questa e-mail perché {name} ({email}) gliel’ha inviata. Le risposte vanno a questa persona.' },
  en: { subject: 'Note from {name}', intro: '{name} forwarded you a note from Apensum:', message: 'Message from {name}:', link: 'Open in Apensum:', external: 'You get this e-mail because {name} ({email}) sent it to you. Replies go to them.' },
};
export const mailLang = (locale: string | null | undefined): Lang => (['de', 'fr', 'it', 'en'].includes(locale ?? '') ? locale as Lang : 'de');

/**
 * The forwarded note as a mail in `lang`: the note's text, the sender's message if any, the link (colleagues with an
 * account only: someone outside has none) and who sent it.
 */
export function noteMail(lang: Lang, input: { sender: string; senderEmail: string; text: string; message?: string | null; link: string | null }): { subject: string; text: string } {
  const m = MAIL[lang];
  const fill = (s: string) => s.replace('{name}', input.sender).replace('{email}', input.senderEmail);
  const parts = [
    fill(m.intro), '', input.text,
    ...(input.message ? ['', fill(m.message), input.message] : []),
    ...(input.link ? ['', m.link, input.link] : []),
    '', '—', fill(m.external),
  ];
  return { subject: fill(m.subject), text: parts.join('\n') };
}
