import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dueNow, withDeputies } from '../../apps/api/src/workflow-dues.service';

const deputyOf = new Map([['marta', 'marco'], ['fido', 'ulla'], ['ulla', 'fido']]);

test('a step one does for all goes to the deputies only when nobody of it is there', () => {
  assert.deepEqual(withDeputies({ assignees: ['marta'], each: false, absent: new Set(['marta']), deputyOf, decides: true }), {
    assignees: ['marta', 'marco'], covered: [{ absent: 'marta', deputy: 'marco' }],
  });
  // Ulla is there: the step stays with the two of them.
  assert.equal(withDeputies({ assignees: ['fido', 'ulla'], each: false, absent: new Set(['fido']), deputyOf, decides: false }), null);
});

test('a step each does on their own: the absent one\'s deputy takes their place', () => {
  assert.deepEqual(withDeputies({ assignees: ['fido', 'marta'], each: true, absent: new Set(['marta']), deputyOf, decides: false }), {
    assignees: ['fido', 'marco'], covered: [{ absent: 'marta', deputy: 'marco' }],
  });
});

test('no deputy who is away too, already has the step, or decides their own submission', () => {
  assert.equal(withDeputies({ assignees: ['fido', 'ulla'], each: false, absent: new Set(['fido', 'ulla']), deputyOf, decides: false }), null);
  assert.equal(withDeputies({ assignees: ['marta'], each: false, absent: new Set(['marta']), deputyOf, submittedBy: 'marco', decides: true }), null);
  // A work step (not a decision): the submitter may do it as deputy.
  assert.ok(withDeputies({ assignees: ['marta'], each: false, absent: new Set(['marta']), deputyOf, submittedBy: 'marco', decides: false }));
  assert.equal(withDeputies({ assignees: ['marta', 'marco'], each: true, absent: new Set(['marta']), deputyOf, decides: false }), null);
  assert.equal(withDeputies({ assignees: ['ueli'], each: false, absent: new Set(['ueli']), deputyOf, decides: false }), null);
});

test('reminder, then escalation, each once per step; an escalation includes the reminder', () => {
  const step = { remindDays: 2, escalateDays: 4 };
  // Started Monday 23.11.2026.
  assert.deepEqual(dueNow(step, '2026-11-23', '2026-11-24', {}), { days: 1, remind: false, escalate: false });
  assert.deepEqual(dueNow(step, '2026-11-23', '2026-11-25', {}), { days: 2, remind: true, escalate: false });
  assert.deepEqual(dueNow(step, '2026-11-23', '2026-11-26', { reminded: true }), { days: 3, remind: false, escalate: false });
  assert.deepEqual(dueNow(step, '2026-11-23', '2026-11-27', { reminded: true }), { days: 4, remind: false, escalate: true });
  assert.deepEqual(dueNow(step, '2026-11-23', '2026-11-30', { reminded: true, escalated: true }), { days: 5, remind: false, escalate: false });
  // Not looked at for a while: straight to the escalation, no reminder after it.
  assert.deepEqual(dueNow(step, '2026-11-23', '2026-12-01', {}), { days: 6, remind: false, escalate: true });
  assert.deepEqual(dueNow({}, '2026-11-01', '2026-12-01', {}), { days: 22, remind: false, escalate: false });
});
