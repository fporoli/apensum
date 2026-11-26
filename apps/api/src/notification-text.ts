/**
 * A notification's text as a text key with values (stored in `notifications.data.text`): the web app shows it in the
 * reader's language, whatever language it was written in (useNotifications.ts `notificationText`); the stored English
 * `title`/`body` stay for anything that reads them plainly. A value is a plain text (a name, a number), a text per
 * language (a step's label), or another text key (`{ t: key }`, e.g. "Confidential flow" instead of a subject).
 */
export type NoticeValue = string | number | { t: string } | Partial<Record<'de' | 'fr' | 'it' | 'en', string>>;

export interface NoticeText {
  /** The title's text key (in the web dictionaries, a plugin's texts included). */
  key: string;
  /** The body's text key, when the body is a fixed text rather than what someone wrote (that stays `body`). */
  bodyKey?: string;
  vars?: Record<string, NoticeValue>;
}

/** A flow's subject as a value: its subject, or "Confidential flow" for a confidential one (noticeSubject). */
export function subjectValue(r: { subject: string; confidential?: boolean }): NoticeValue {
  return r.confidential ? { t: 'notice.confidentialFlow' } : r.subject;
}
