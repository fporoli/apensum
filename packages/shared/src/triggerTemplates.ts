// Vorlagen of the Auslöser tab (web FlowTriggers.tsx): a trigger together with a flow type whose one step writes an
// e-mail to the person the flow is about from a template (block `compose`), then is done. The API creates them
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
    subject: {
      de: 'Ihre Bewilligung läuft am {{date}} ab',
      fr: 'Votre autorisation échoit le {{date}}',
      it: 'Il Suo permesso scade il {{date}}',
      en: 'Your permit expires on {{date}}',
    },
    text: {
      de: 'Guten Tag {{name}}\n\nIhre Aufenthalts- bzw. Arbeitsbewilligung ({{type}}) läuft am {{date}} ab. Bitte leiten Sie die Verlängerung rechtzeitig ein und senden Sie uns eine Kopie der neuen Bewilligung, sobald Sie sie erhalten haben.\n\nBei Fragen helfen wir Ihnen gerne weiter.\n\nFreundliche Grüsse\n{{sender}}',
      fr: "Bonjour {{name}},\n\nVotre autorisation de séjour ou de travail ({{type}}) échoit le {{date}}. Veuillez lancer le renouvellement à temps et nous envoyer une copie de la nouvelle autorisation dès que vous l'aurez reçue.\n\nNous restons volontiers à votre disposition pour toute question.\n\nMeilleures salutations\n{{sender}}",
      it: 'Buongiorno {{name}},\n\nIl Suo permesso di soggiorno o di lavoro ({{type}}) scade il {{date}}. La preghiamo di avviare per tempo il rinnovo e di inviarci una copia del nuovo permesso non appena lo avrà ricevuto.\n\nRestiamo volentieri a disposizione per qualsiasi domanda.\n\nCordiali saluti\n{{sender}}',
      en: "Hello {{name}},\n\nYour residence or work permit ({{type}}) expires on {{date}}. Please start the renewal in time and send us a copy of the new permit as soon as you have received it.\n\nWe are happy to help if you have any questions.\n\nKind regards\n{{sender}}",
    },
  },
];

/**
 * The flow type's steps for a template: one step to the department (`department:<code>`) that writes the e-mail to the
 * person the flow is about, then is done. It may be sent back (the engine's rule for a first step; a task opened by a
 * trigger has nobody to send it back to, so its card hides that).
 */
export function templateConfig(tpl: TriggerTemplate, departmentCode: string) {
  return {
    version: 1,
    steps: [{
      key: 'mail',
      do: ['compose'],
      assignTo: `department:${departmentCode}`,
      reject: 'back',
      mailTo: 'about',
      label: tpl.stepLabel,
      message: { subject: tpl.subject, text: tpl.text },
    }],
  };
}

/** A flow type key not yet taken: the template's, else with _2, _3, ... */
export function freeTypeKey(key: string, taken: readonly string[]): string {
  if (!taken.includes(key)) return key;
  let n = 2;
  while (taken.includes(`${key.slice(0, 27)}_${n}`)) n++;
  return `${key.slice(0, 27)}_${n}`;
}
