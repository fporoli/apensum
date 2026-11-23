import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { registrationMail } from '../../apps/api/src/registration-notice';

const r = { name: 'Anna\r\nBcc: x@evil.ch Muster', email: 'anna@example.ch', workspace: "Anna's workspace", orgId: 'o1' };
const at = new Date('2026-11-23T09:30:00Z');

test('the operator is told who registered, in their language, with the Zurich time', () => {
  const de = registrationMail('de-CH', r, at);
  assert.equal(de.title, 'Neue Registrierung');
  assert.match(de.text, /E-Mail: anna@example\.ch/);
  assert.match(de.text, /23\.11\.2026, 10:30:00/);
  assert.equal(registrationMail('fr', r, at).title, 'Nouvelle inscription');
  assert.equal(registrationMail('xx', r, at).title, 'New registration', 'unknown language: English');
});

test('a line break in the name never reaches the subject', () => {
  const m = registrationMail('en', r, at);
  assert.doesNotMatch(m.subject, /[\r\n]/);
  assert.equal(m.subject, 'Apensum: new registration of Anna Bcc: x@evil.ch Muster');
});
