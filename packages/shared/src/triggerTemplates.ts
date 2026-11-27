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

const WRITE: PerLang = { de: 'E-Mail schreiben', fr: 'Écrire un e-mail', it: "Scrivere un'e-mail", en: 'Write an e-mail' };

export const TRIGGER_TEMPLATES: readonly TriggerTemplate[] = [
  {
    event: 'hr.anniversary',
    typeKey: 'dienstjubilaeum',
    typeName: { de: 'Dienstjubiläum', fr: "Anniversaire d'ancienneté", it: 'Anniversario di servizio', en: 'Service anniversary' },
    leadDays: 14,
    stepLabel: WRITE,
    subject: {
      de: '{{years}} Jahre bei uns – herzliche Gratulation!',
      fr: '{{years}} ans chez nous – toutes nos félicitations !',
      it: '{{years}} anni con noi – congratulazioni!',
      en: '{{years}} years with us – congratulations!',
    },
    text: {
      de: 'Guten Tag {{name}}\n\nAm {{date}} sind Sie {{years}} Jahre bei uns. Dafür danken wir Ihnen herzlich – für Ihren Einsatz, Ihre Ideen und die gute Zusammenarbeit.\n\nWir freuen uns auf die kommenden Jahre mit Ihnen.\n\nFreundliche Grüsse\n{{sender}}',
      fr: "Bonjour {{name}},\n\nLe {{date}}, cela fera {{years}} ans que vous êtes parmi nous. Nous vous remercions chaleureusement de votre engagement, de vos idées et de l'excellente collaboration.\n\nNous nous réjouissons des années à venir avec vous.\n\nMeilleures salutations\n{{sender}}",
      it: "Buongiorno {{name}},\n\nIl {{date}} saranno {{years}} anni che lavora con noi. La ringraziamo di cuore per il Suo impegno, le Sue idee e l'ottima collaborazione.\n\nCi rallegriamo per i prossimi anni insieme.\n\nCordiali saluti\n{{sender}}",
      en: 'Hello {{name}},\n\nOn {{date}} you will have been with us for {{years}} years. Thank you very much for your commitment, your ideas and the great collaboration.\n\nWe look forward to the years ahead with you.\n\nKind regards\n{{sender}}',
    },
  },
  {
    event: 'hr.probationEnd',
    typeKey: 'probezeit_ende',
    typeName: { de: 'Ende der Probezeit', fr: "Fin du temps d'essai", it: 'Fine del periodo di prova', en: 'End of probation' },
    leadDays: 14,
    stepLabel: WRITE,
    subject: {
      de: 'Ihre Probezeit endet am {{date}}',
      fr: "Votre temps d'essai se termine le {{date}}",
      it: 'Il Suo periodo di prova termina il {{date}}',
      en: 'Your probation ends on {{date}}',
    },
    text: {
      de: 'Guten Tag {{name}}\n\nAm {{date}} endet Ihre Probezeit. Wir freuen uns, dass Sie bei uns sind, und danken Ihnen für Ihren Einsatz in den ersten Monaten.\n\nGerne besprechen wir mit Ihnen in einem kurzen Gespräch, wie Sie sich eingelebt haben. Wir melden uns dafür bei Ihnen.\n\nFreundliche Grüsse\n{{sender}}',
      fr: "Bonjour {{name}},\n\nVotre temps d'essai se termine le {{date}}. Nous sommes heureux de vous compter parmi nous et vous remercions de votre engagement durant ces premiers mois.\n\nNous aimerions faire le point avec vous lors d'un bref entretien. Nous vous contacterons à ce sujet.\n\nMeilleures salutations\n{{sender}}",
      it: 'Buongiorno {{name}},\n\nIl {{date}} termina il Suo periodo di prova. Siamo lieti che faccia parte del nostro team e La ringraziamo per il Suo impegno in questi primi mesi.\n\nVorremmo fare il punto con Lei in un breve colloquio. La contatteremo a tal fine.\n\nCordiali saluti\n{{sender}}',
      en: "Hello {{name}},\n\nYour probation ends on {{date}}. We are glad to have you with us and thank you for your commitment in these first months.\n\nWe would like to talk with you briefly about how you have settled in. We will be in touch to arrange it.\n\nKind regards\n{{sender}}",
    },
  },
  {
    event: 'permitExpires',
    typeKey: 'bewilligung_erneuern',
    typeName: { de: 'Bewilligung erneuern', fr: "Renouveler l'autorisation", it: 'Rinnovare il permesso', en: 'Renew the permit' },
    leadDays: 90,
    stepLabel: WRITE,
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
  {
    event: 'hr.exit',
    typeKey: 'austritt',
    typeName: { de: 'Austritt', fr: 'Départ', it: 'Uscita', en: 'Exit' },
    leadDays: 14,
    stepLabel: WRITE,
    subject: {
      de: 'Ihr letzter Arbeitstag am {{date}}',
      fr: 'Votre dernier jour de travail le {{date}}',
      it: 'Il Suo ultimo giorno di lavoro il {{date}}',
      en: 'Your last working day on {{date}}',
    },
    text: {
      de: 'Guten Tag {{name}}\n\nAm {{date}} ist Ihr letzter Arbeitstag bei uns. Wir danken Ihnen herzlich für Ihren Einsatz und die gute Zusammenarbeit.\n\nIn den nächsten Tagen erhalten Sie Ihr Arbeitszeugnis und die Austrittsabrechnung. Bitte geben Sie Material, Schlüssel und Badge bis zu Ihrem letzten Arbeitstag zurück.\n\nFür Ihre Zukunft wünschen wir Ihnen alles Gute.\n\nFreundliche Grüsse\n{{sender}}',
      fr: "Bonjour {{name}},\n\nLe {{date}} sera votre dernier jour de travail chez nous. Nous vous remercions chaleureusement de votre engagement et de l'excellente collaboration.\n\nVous recevrez prochainement votre certificat de travail et votre décompte de sortie. Merci de restituer le matériel, les clés et le badge d'ici votre dernier jour.\n\nNous vous souhaitons plein succès pour la suite.\n\nMeilleures salutations\n{{sender}}",
      it: "Buongiorno {{name}},\n\nIl {{date}} sarà il Suo ultimo giorno di lavoro da noi. La ringraziamo di cuore per il Suo impegno e l'ottima collaborazione.\n\nNei prossimi giorni riceverà il certificato di lavoro e il conteggio di uscita. La preghiamo di restituire materiale, chiavi e badge entro il Suo ultimo giorno.\n\nLe auguriamo ogni bene per il futuro.\n\nCordiali saluti\n{{sender}}",
      en: 'Hello {{name}},\n\nYour last working day with us is {{date}}. Thank you very much for your commitment and the great collaboration.\n\nYou will receive your reference letter and your final statement in the coming days. Please return equipment, keys and badge by your last working day.\n\nWe wish you all the best for the future.\n\nKind regards\n{{sender}}',
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
