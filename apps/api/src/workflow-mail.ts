// The mail of a workflow's automatic message step (a request's "E-mail" block, request-workflow.ts): the subject and
// text the organization wrote in the designer, in the recipient's language, then what the request is, the form steps'
// answers when the step asks for them, and a link. A confidential request's mail names neither its subject nor
// anybody's answers (only the link): the thread keeps those.
import { messageText, stepFieldLabel, type StepField, type StepMessage } from '@worktime3/shared/workflowConfig';
import { appBaseUrl } from './app-url';

type Lang = 'de' | 'fr' | 'it' | 'en';
const langOf = (locale: string | null | undefined): Lang => {
  const l = (locale ?? '').slice(0, 2);
  return l === 'en' || l === 'fr' || l === 'it' ? l : 'de';
};
const SWISS: Record<Lang, string> = { de: 'de-CH', fr: 'fr-CH', it: 'it-CH', en: 'en-CH' };

const TEXTS: Record<Lang, { request: string; confidential: string; answers: string; total: string; open: string }> = {
  de: { request: 'Flow', confidential: 'Vertraulicher Flow', answers: 'Beiträge', total: 'Summe', open: 'Öffnen' },
  fr: { request: 'Flow', confidential: 'Flow confidentiel', answers: 'Contributions', total: 'Total', open: 'Ouvrir' },
  it: { request: 'Flow', confidential: 'Flow confidenziale', answers: 'Contributi', total: 'Totale', open: 'Apri' },
  en: { request: 'Flow', confidential: 'Confidential flow', answers: 'Answers', total: 'Total', open: 'Open' },
};

/** One person's answers to a form step, as the thread keeps them. */
export interface MailAnswer {
  name: string;
  values: { key: string; type: StepField['type']; label: StepField['label']; value: string | number | boolean }[];
}

export function workflowMail(
  input: { message: StepMessage; request: { id: string; subject: string; confidential: boolean }; answers: MailAnswer[] },
  locale: string | null | undefined,
): { subject: string; text: string } {
  const lang = langOf(locale);
  const x = TEXTS[lang];
  const number = (n: number) => n.toLocaleString(SWISS[lang], { maximumFractionDigits: 2 });
  const format = (v: MailAnswer['values'][number]) =>
    v.type === 'number' && typeof v.value === 'number' ? number(v.value)
      : v.type === 'date' && typeof v.value === 'string' ? new Date(`${v.value}T12:00:00Z`).toLocaleDateString(SWISS[lang], { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
        : v.type === 'checkbox' ? (v.value === true ? '✓' : '') : String(v.value);
  const lines: string[] = [];
  const text = messageText(input.message.text, lang);
  if (text) lines.push(text, '');
  lines.push(input.request.confidential ? x.confidential : `${x.request}: ${input.request.subject}`);
  // The answers and the sums of the number fields (never for a confidential request).
  if (input.message.answers && !input.request.confidential && input.answers.length) {
    lines.push('', `${x.answers}:`);
    const sums = new Map<string, { label: string; total: number }>();
    for (const a of input.answers) {
      lines.push(`- ${a.name}: ${a.values.map((v) => `${stepFieldLabel(v, lang)} ${format(v)}`).join(' · ')}`);
      for (const v of a.values) {
        if (v.type !== 'number' || typeof v.value !== 'number') continue;
        const s = sums.get(v.key) ?? { label: stepFieldLabel(v, lang), total: 0 };
        s.total += v.value;
        sums.set(v.key, s);
      }
    }
    for (const s of sums.values()) lines.push(`${x.total} ${s.label}: ${number(s.total)}`);
  }
  lines.push('', `${x.open}: ${appBaseUrl()}/#/requests?id=${input.request.id}`);
  return { subject: messageText(input.message.subject, lang).slice(0, 250), text: `${lines.join('\n')}\n` };
}
