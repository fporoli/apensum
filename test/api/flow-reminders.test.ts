import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { URGENT_UNTAKEN_MS, overdueRecipients, urgentUntakenMail } from '../../apps/api/src/flows.service';

test('an overdue flow reminds whoever has it; an urgent one everyone who handles it too', () => {
  assert.deepEqual(overdueRecipients('anna', ['anna', 'ben', 'cleo'], false), ['anna']);
  assert.deepEqual(overdueRecipients('anna', ['anna', 'ben', 'cleo'], true), ['anna', 'ben', 'cleo']);
  assert.deepEqual(overdueRecipients(null, ['ben', 'cleo'], false), ['ben', 'cleo'], 'nobody took it: all who handle it');
  assert.deepEqual(overdueRecipients('dora', ['ben'], true), ['dora', 'ben'], 'one who took it but no longer handles it still hears it');
});

test('the reminder that an urgent flow waits for someone: in their language, a confidential one without its subject', () => {
  assert.equal(URGENT_UNTAKEN_MS, 4 * 3_600_000);
  const de = urgentUntakenMail({ id: 'f1', subject: 'Laptop defekt' }, 'de-CH');
  assert.equal(de.subject, 'Dringend, noch niemand hat übernommen: Laptop defekt');
  assert.match(de.text, /seit 4 Stunden/);
  assert.match(de.text, /#\/flows\?id=f1/);
  const secret = urgentUntakenMail({ id: 'f2', subject: 'Lohnfrage Meier', confidential: true }, 'fr');
  assert.ok(!secret.subject.includes('Meier') && !secret.text.includes('Meier'), 'a confidential flow is not named');
  assert.match(secret.subject, /Flow confidentiel/);
  assert.match(urgentUntakenMail({ id: 'f3', subject: 'x' }, 'it').text, /4 ore/);
  assert.match(urgentUntakenMail({ id: 'f4', subject: 'x' }, null).subject, /^Dringend/, 'no language: German');
});
