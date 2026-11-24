import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonthsIso, categoryKeys, categoryRules, personnelDocError } from './personnelDocs.ts';

test('category rules from the static data properties', () => {
  assert.deepEqual(categoryRules({ keyDate: true, acknowledge: true, manager: false, followUpMonths: '12' }), { keyDate: true, acknowledge: true, manager: false, followUpMonths: 12 });
  assert.deepEqual(categoryRules('Old label'), { keyDate: false, acknowledge: false, manager: false, followUpMonths: 0 });
  assert.equal(categoryRules({ followUpMonths: 'x' }).followUpMonths, 0);
});

test('categories in their order', () => {
  assert.deepEqual(categoryKeys({ other: { sort: '6' }, evaluation: { sort: '1' }, mine: {}, salary: { sort: '2' } }), ['evaluation', 'salary', 'other', 'mine']);
});

test('follow-up months later, the day clamped to the month', () => {
  assert.equal(addMonthsIso('2026-11-24', 12), '2027-11-24');
  assert.equal(addMonthsIso('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsIso('nope', 3), '');
});

test('a key date where the category needs one; a confirmation only when the person sees it', () => {
  const rules = categoryRules({ keyDate: true });
  assert.equal(personnelDocError({ category: 'salary', effectiveDate: null, visibleToEmployee: true, requireAck: false }, rules), 'key-date-required');
  assert.equal(personnelDocError({ category: 'salary', effectiveDate: '2027-01-01', visibleToEmployee: false, requireAck: true }, rules), 'ack-needs-sharing');
  assert.equal(personnelDocError({ category: 'salary', effectiveDate: '2027-01-01', visibleToEmployee: true, requireAck: true }, rules), null);
});
