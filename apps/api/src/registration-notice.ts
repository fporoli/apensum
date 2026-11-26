import { sql } from 'drizzle-orm';
import { OPERATOR_ORG_ID } from '@worktime3/shared/operator';
import type { Executor } from './access';
import { sendMail } from './mailer';
import { pushToOperator } from './operator-push';
import { appBaseUrl } from './app-url';
import type { NotificationsService } from './notifications.service';

/**
 * A new registration (open on every instance: everyone gets a workspace of their own) is told to the instance's
 * operators, the members of the Admin organization: by e-mail and as a notification there (the bell; a click
 * opens Super Admin -> Licenses, where the new organization is listed). Best effort: it never fails a registration.
 */

export interface Registration {
  name: string;
  email: string;
  workspace: string;
  orgId: string;
}

const MAIL: Record<string, { subject: (r: Registration) => string; text: (r: Registration, when: string) => string; title: string }> = {
  en: {
    subject: (r) => `Apensum: new registration of ${r.name}`,
    text: (r, when) => `A new account registered on this Apensum instance:\n\nName: ${r.name}\nE-mail: ${r.email}\nWorkspace: ${r.workspace}\nTime: ${when}\n\nIt is listed under Super Admin -> Licenses.\n`,
    title: 'New registration',
  },
  de: {
    subject: (r) => `Apensum: neue Registrierung von ${r.name}`,
    text: (r, when) => `Auf dieser Apensum-Instanz hat sich ein neues Konto registriert:\n\nName: ${r.name}\nE-Mail: ${r.email}\nArbeitsbereich: ${r.workspace}\nZeit: ${when}\n\nEs steht unter Super-Admin -> Lizenzen.\n`,
    title: 'Neue Registrierung',
  },
  fr: {
    subject: (r) => `Apensum : nouvelle inscription de ${r.name}`,
    text: (r, when) => `Un nouveau compte s’est inscrit sur cette instance Apensum :\n\nNom : ${r.name}\nE-mail : ${r.email}\nEspace de travail : ${r.workspace}\nHeure : ${when}\n\nIl figure sous Super Admin -> Licences.\n`,
    title: 'Nouvelle inscription',
  },
  it: {
    subject: (r) => `Apensum: nuova registrazione di ${r.name}`,
    text: (r, when) => `Un nuovo conto si è registrato su questa istanza Apensum:\n\nNome: ${r.name}\nE-mail: ${r.email}\nSpazio di lavoro: ${r.workspace}\nOra: ${when}\n\nFigura sotto Super Admin -> Licenze.\n`,
    title: 'Nuova registrazione',
  },
};

/** The operator's mail in their language (time in Zurich). Line breaks in the name cannot reach the header. */
export function registrationMail(locale: string | null | undefined, r: Registration, at: Date) {
  const m = MAIL[(locale ?? 'de').slice(0, 2)] ?? MAIL.en;
  const safe = { ...r, name: r.name.replace(/[\r\n]+/g, ' ').trim() };
  const when = at.toLocaleString('de-CH', { timeZone: 'Europe/Zurich' });
  return { subject: m.subject(safe), text: m.text(safe, when), title: m.title };
}

export async function noticeRegistration(db: Executor, notifications: NotificationsService | undefined, r: Registration, at = new Date()): Promise<void> {
  const operators = (
    await db.execute(sql`
      SELECT u.id, u.email::text AS email, u.locale FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ${OPERATOR_ORG_ID} AND m.status = 'active' AND u.status = 'active'`)
  ).rows as { id: string; email: string; locale: string | null }[];
  // On the operator's phone too (operator-push.ts): that someone registered, not who.
  void pushToOperator({ title: 'Neue Registrierung', message: 'Eine neue Organisation hat sich bei Apensum registriert.', click: appBaseUrl(), tags: ['tada'] });
  if (!operators.length) return;
  for (const o of operators) {
    const mail = registrationMail(o.locale, r, at);
    await sendMail({ to: o.email, subject: mail.subject, text: mail.text }).catch(() => {});
    // In each operator's own language.
    await notifications
      ?.notifyMany({
        organizationId: OPERATOR_ORG_ID,
        recipientUserIds: [o.id],
        type: 'operator.registration',
        title: mail.title,
        body: `${r.name} (${r.email})`,
        sourceTable: 'organizations',
        sourceTableUuid: r.orgId,
      })
      .catch(() => {});
  }
}
