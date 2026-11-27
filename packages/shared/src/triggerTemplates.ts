// Vorlagen of the Auslöser tab (web FlowTriggers.tsx): a trigger together with a flow type whose first step writes an
// e-mail to the person the flow is about from a template (block `compose`), then is done, or goes on to tasks (`then`:
// the permit's holder uploads the new one, HR records it). The API creates them
// (POST flow-triggers/templates, for whoever may set up the event's triggers): the flow type, its steps, the trigger, as
// a person would by hand. Pure, tested in apps/web/src/triggerTemplates.test.mjs (each passes the shared checker).

export type TemplateLang = 'de' | 'fr' | 'it' | 'en';
type PerLang = Record<TemplateLang, string>;

export interface TriggerTemplate {
  /** The event the trigger reacts to. */
  event: string;
  /** The flow type it creates (its key and name). */
  typeKey: string;
  typeName: PerLang;
  /** The days before the event the flow opens. */
  leadDays: number;
  stepLabel: PerLang;
  subject: PerLang;
  text: PerLang;
  /**
   * Who handles it (writes the e-mail, does the `handler` tasks): a department chosen when the Vorlage is added
   * (default), or everyone holding a permission object's edit on all (`permission:<object>`, e.g. who keeps
   * everyone's personal data), one of them taking it over.
   */
  handler?: 'department' | `permission:${string}`;
  /**
   * Tasks after the e-mail, in order: for the person it is about (`about`: upload the new permit) or the handler;
   * the flow is done after the last. Their assignees are reminded after `remindDays` working days (bell and mail).
   */
  then?: { key: string; by: 'about' | 'handler'; label: PerLang; remindDays?: number }[];
}

export const WRITE_EMAIL: PerLang = { de: 'E-Mail schreiben', fr: 'Écrire un e-mail', it: "Scrivere un'e-mail", en: 'Write an e-mail' };

/** The core's Vorlagen (its own events); a plugin brings those of its events (`TriggerSource.templates`). */
export const TRIGGER_TEMPLATES: readonly TriggerTemplate[] = [
  {
    event: 'permitExpires',
    typeKey: 'bewilligung_erneuern',
    typeName: { de: 'Bewilligung erneuern', fr: "Renouveler l'autorisation", it: 'Rinnovare il permesso', en: 'Renew the permit' },
    leadDays: 90,
    stepLabel: WRITE_EMAIL,
    // Who keeps everyone's personal data (HR) writes, the holder uploads the new permit in the flow, HR records it.
    handler: 'permission:section.basicdata.personalien',
    then: [
      {
        key: 'upload', by: 'about', remindDays: 5,
        label: { de: 'Neue Bewilligung hochladen', fr: 'Télécharger la nouvelle autorisation', it: 'Caricare il nuovo permesso', en: 'Upload the new permit' },
      },
      {
        key: 'record', by: 'handler', remindDays: 5,
        label: { de: 'Neue Bewilligung erfassen', fr: 'Saisir la nouvelle autorisation', it: 'Registrare il nuovo permesso', en: 'Record the new permit' },
      },
    ],
    subject: {
      de: 'Ihre Bewilligung läuft am {{date}} ab',
      fr: 'Votre autorisation échoit le {{date}}',
      it: 'Il Suo permesso scade il {{date}}',
      en: 'Your permit expires on {{date}}',
    },
    text: {
      de: 'Guten Tag {{name}}\n\nIhre Aufenthalts- bzw. Arbeitsbewilligung ({{type}}) läuft am {{date}} ab. Bitte leiten Sie die Verlängerung rechtzeitig ein. Sobald Sie die neue Bewilligung erhalten haben, laden Sie bitte eine Kopie in Apensum hoch: unter Flows → Zu erledigen finden Sie die Aufgabe «Neue Bewilligung hochladen».\n\nBei Fragen helfen wir Ihnen gerne weiter.\n\nFreundliche Grüsse\n{{sender}}',
      fr: "Bonjour {{name}},\n\nVotre autorisation de séjour ou de travail ({{type}}) échoit le {{date}}. Veuillez lancer le renouvellement à temps. Dès que vous aurez reçu la nouvelle autorisation, veuillez en télécharger une copie dans Apensum : sous Flows → À faire, vous trouverez la tâche « Télécharger la nouvelle autorisation ».\n\nNous restons volontiers à votre disposition pour toute question.\n\nMeilleures salutations\n{{sender}}",
      it: 'Buongiorno {{name}},\n\nIl Suo permesso di soggiorno o di lavoro ({{type}}) scade il {{date}}. La preghiamo di avviare per tempo il rinnovo. Non appena avrà ricevuto il nuovo permesso, carichi una copia in Apensum: in Flows → Da fare trova il compito «Caricare il nuovo permesso».\n\nRestiamo volentieri a disposizione per qualsiasi domanda.\n\nCordiali saluti\n{{sender}}',
      en: "Hello {{name}},\n\nYour residence or work permit ({{type}}) expires on {{date}}. Please start the renewal in time. As soon as you have received the new permit, please upload a copy in Apensum: under Flows → To do you will find the task “Upload the new permit”.\n\nWe are happy to help if you have any questions.\n\nKind regards\n{{sender}}",
    },
  },
];

/**
 * The flow type's steps for a template: the e-mail to the person the flow is about, by the handler (`department:<code>`
 * or the template's permission), then its tasks (`then`). The first may be sent back (the engine's rule for a first
 * step; a task opened by a trigger has nobody to send it back to, so its card hides that), the others not.
 */
export function templateConfig(tpl: TriggerTemplate, departmentCode: string | null) {
  const handler = tpl.handler && tpl.handler !== 'department' ? tpl.handler : `department:${departmentCode ?? ''}`;
  const steps: Record<string, unknown>[] = [{
    key: 'mail',
    do: ['compose'],
    assignTo: handler,
    reject: 'back',
    mailTo: 'about',
    label: tpl.stepLabel,
    message: { subject: tpl.subject, text: tpl.text },
  }];
  for (const s of tpl.then ?? []) {
    steps.push({
      key: s.key, do: ['task'], assignTo: s.by === 'about' ? 'about' : handler, reject: 'none', label: s.label,
      ...(s.remindDays ? { remindDays: s.remindDays } : {}),
    });
  }
  return { version: 1, steps };
}

/** Whether a template's handler is a department (the Vorlage asks which). */
export const templateNeedsDepartment = (tpl: TriggerTemplate): boolean => !tpl.handler || tpl.handler === 'department';

/** A flow type key not yet taken: the template's, else with _2, _3, ... */
export function freeTypeKey(key: string, taken: readonly string[]): string {
  if (!taken.includes(key)) return key;
  let n = 2;
  while (taken.includes(`${key.slice(0, 27)}_${n}`)) n++;
  return `${key.slice(0, 27)}_${n}`;
}
