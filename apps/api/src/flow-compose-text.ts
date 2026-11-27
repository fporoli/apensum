// The texts of a flow's e-mails ("E-Mail schreiben", flow-compose.ts, and the automatic mail, flow-steps.ts): the
// language, the template's placeholder values, the filled message. Pure, imports nothing of the API (tested in
// test/api/flow-compose.test.ts).
import { fillPlaceholders, type StepMessage } from '@worktime3/shared/workflowConfig';

type Lang = 'de' | 'fr' | 'it' | 'en';
export const composeLang = (locale: string | null | undefined): Lang => {
  const l = (locale ?? '').slice(0, 2);
  return l === 'en' || l === 'fr' || l === 'it' ? l : 'de';
};
const SWISS: Record<Lang, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-CH' };

/** A date (YYYY-MM-DD) the Swiss way in a language (17.11.2026), else the value as it is. */
export function composeDate(value: unknown, lang: Lang): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return typeof value === 'string' ? value : null;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(SWISS[lang], { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** The values of a template's placeholders: the person it is about, the task's date and years, the subject, the sender. */
export function composeValues(
  input: { aboutName: string | null; aboutFirstName: string | null; subject: string; confidential: boolean; taskData: Record<string, unknown> | null; senderName: string },
  lang: Lang,
): Record<string, string | null> {
  const data = input.taskData ?? {};
  // The task's other values (an event's `type`, `step`, `title`, ...) as they are; dates the Swiss way.
  const extra: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(data)) if (/^[a-zA-Z]+$/.test(k) && (typeof v === 'string' || typeof v === 'number')) extra[k] = composeDate(String(v), lang);
  return {
    ...extra,
    name: input.aboutName,
    firstName: input.aboutFirstName || (input.aboutName ? input.aboutName.split(/\s+/)[0] : null),
    date: composeDate(data.date, lang),
    years: typeof data.years === 'number' || typeof data.years === 'string' ? String(data.years) : null,
    // A confidential flow's subject stays out of what is written for others (it can still be typed in).
    subject: input.confidential ? null : input.subject,
    sender: input.senderName,
  };
}

/**
 * The mail's text: what the sender wrote, as it is. It carries no footer of its own: the templates end with the
 * sender's greeting ({{sender}}), and a reply goes to the sender (Reply-To).
 */
export function composeMailText(text: string): string {
  return `${text.trim()}\n`;
}

/** A step's message with its placeholders filled in every language (an automatic mail's, flow-steps.ts). */
export function filledMessage(message: StepMessage, values: Record<string, string | null>): StepMessage {
  const fill = (m: Partial<Record<string, string>> | undefined) => m && Object.fromEntries(Object.entries(m).map(([l, v]) => [l, fillPlaceholders(v ?? '', values)]));
  return { ...message, subject: fill(message.subject) ?? {}, ...(message.text ? { text: fill(message.text) } : {}) };
}
