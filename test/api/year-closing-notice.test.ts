import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { signedHours, yearClosedNotice, yearReopenedNotice } from '../../apps/api/src/year-closing-notice';

// The person hears that their year was closed or reopened, in their language, with their own numbers.

test('year closing notice: signed hours', () => {
  assert.equal(signedHours(-171), '-2:51');
  assert.equal(signedHours(90), '+1:30');
  assert.equal(signedHours(0), '0:00');
});

test('year closing notice: closed, in the person\'s language, Überzeit only when there is some', () => {
  const de = yearClosedNotice('de', 2025, { overtime: -171, legalOvertime: 0, vacation: 2.5 });
  assert.equal(de.title, 'Jahr 2025 abgeschlossen');
  assert.equal(de.body, 'Überstunden Ende Jahr -2:51 h · Ferienrest 2.5 Tage, übertragen ins Jahr 2026');
  const en = yearClosedNotice('en-GB', 2025, { overtime: 600, legalOvertime: 120, vacation: 3 });
  assert.equal(en.body, 'Overtime at year end +10:00 h (of which Überzeit +2:00 h) · Vacation left 3 days, carried into 2026');
  assert.equal(yearClosedNotice('xx', 2025, { overtime: 0, legalOvertime: 0, vacation: 0 }).title, 'Year 2025 closed');
});

test('year closing notice: reopened', () => {
  assert.equal(yearReopenedNotice('fr', 2025).title, 'Année 2025 rouverte');
  assert.equal(yearReopenedNotice('it', 2025).title, 'Anno 2025 riaperto');
});
