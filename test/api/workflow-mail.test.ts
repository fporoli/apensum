import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { workflowMail } from '../../apps/api/src/workflow-mail';

const message = { subject: { de: 'Sammlung fertig', en: 'Collection done' }, text: { de: 'Danke allen!' }, answers: true };
const amount = { key: 'amount', type: 'number' as const, label: { de: 'Betrag', en: 'Amount' } };
const answers = [
  { name: 'Marco A', values: [{ ...amount, value: 20 }, { key: 'note', type: 'text' as const, label: { de: 'Bemerkung' }, value: 'gerne' }] },
  { name: 'Uma A', values: [{ ...amount, value: 1250.5 }] },
];

test('the message in the recipient language, the answers with their sum, and the link', () => {
  const mail = workflowMail({ message, request: { id: 'r1', subject: 'Geschenk für Ulla', confidential: false }, answers }, 'de');
  assert.equal(mail.subject, 'Sammlung fertig');
  assert.match(mail.text, /^Danke allen!\n\nFlow: Geschenk für Ulla\n\nBeiträge:\n- Marco A: Betrag 20 · Bemerkung gerne\n- Uma A: Betrag 1['’]250\.5\nSumme Betrag: 1['’]270\.5\n\nÖffnen: .*#\/flows\?id=r1\n$/);
  // English: its own subject; the text falls back to the one there is.
  const en = workflowMail({ message, request: { id: 'r1', subject: 'Gift', confidential: false }, answers: [] }, 'en');
  assert.equal(en.subject, 'Collection done');
  assert.match(en.text, /^Danke allen!\n\nFlow: Gift\n\nOpen: /);
});

test('a confidential request names neither its subject nor the answers', () => {
  const mail = workflowMail({ message, request: { id: 'r2', subject: 'Krankheit X', confidential: true }, answers }, 'fr');
  assert.doesNotMatch(mail.text, /Krankheit|Marco|20/);
  assert.match(mail.text, /Flow confidentiel/);
});
