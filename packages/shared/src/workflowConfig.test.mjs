import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUnitCode, codeFromName, compileWorkflow, evaluateCondition, nextApplicableStep, stepFieldValues, validateWorkflowConfig } from './workflowConfig.ts';

const KIND = {
  id: 'expenses.report',
  definitionName: 'approve expense report',
  rejectModes: ['none', 'back'],
  facts: { total: 'number', categories: 'strings', 'requester.management': 'boolean', currency: 'string' },
  blocks: {
    review: { label: 'Review', action: 'expense.approve', returnAction: 'expense.reject', assignees: ['manager', 'department', 'permission:nav.expensePayout'] },
    process: { label: 'Processing', action: 'expense.process', once: true, after: ['review'], inDialog: true, assignees: ['permission:nav.expenseProcessing'] },
    pay: { label: 'Payment', action: 'expense.paid', once: true, after: ['process'], last: true, assignees: ['permission:nav.expenseProcessing', 'permission:nav.expensePayout'] },
  },
  defaultConfig: { version: 1, steps: [] },
};
const codes = (r) => (r.ok ? [] : r.errors.map((e) => `${e.path} ${e.code}`));

test('a good configuration passes; reject defaults to back where every block can go back', () => {
  const r = validateWorkflowConfig(KIND, { version: 1, steps: [
    { key: 'manager', do: ['review'], assignTo: 'manager' },
    { key: 'finance', do: ['review'], assignTo: 'permission:nav.expensePayout', when: { all: [{ total: { gt: 500 } }, { not: { 'requester.management': true } }] } },
    { key: 'settle', do: ['process'], assignTo: 'permission:nav.expenseProcessing' },
    { key: 'pay', do: ['pay'], assignTo: 'permission:nav.expensePayout' },
  ] });
  assert.deepEqual(codes(r), []);
  assert.equal(r.value.steps[0].reject, 'back');
  assert.equal(r.value.steps[2].reject, 'none');
});

test('what the checker refuses', () => {
  assert.deepEqual(codes(validateWorkflowConfig(KIND, { version: 1, steps: [] })), ['steps no-steps']);
  assert.deepEqual(codes(validateWorkflowConfig(KIND, { version: 1, steps: [
    { key: 'pay', do: ['pay'], assignTo: 'permission:nav.expensePayout' },
  ] })), ['steps[0].do[0] block-order', 'steps[0].reject first-step-decides']);
  assert.deepEqual(codes(validateWorkflowConfig(KIND, { version: 1, steps: [
    { key: 'a', do: ['review'], assignTo: 'permission:nav.admin' },
    { key: 'a', do: ['nope'], assignTo: 'someone', reject: 'back', when: { total: { gt: '5' } }, extra: 1 },
  ] })), [
    'steps[0].assignTo assignee-not-allowed',
    'steps[1].extra unknown-field', 'steps[1].key duplicate-key', 'steps[1].assignTo invalid-assignee', 'steps[1].do[0] unknown-block',
    'steps[1].reject not-rejectable', 'steps[1].when.total invalid-comparison',
  ]);
  assert.deepEqual(codes(validateWorkflowConfig(KIND, { version: 1, steps: [
    { key: 'm', do: ['review'], assignTo: 'manager', when: { total: { gt: 5 } } },
    { key: 'p', do: ['process'], assignTo: 'permission:nav.expenseProcessing', reject: 'back' },
    { key: 'x', do: ['pay', 'review'], assignTo: 'permission:nav.expensePayout' },
    { key: 'y', do: ['process'], assignTo: 'permission:nav.expenseProcessing', when: { colour: true } },
  ] })), [
    'steps[0].when first-step-condition', 'steps[1].reject not-rejectable', 'steps[2].do[0] block-last',
    'steps[3].do[0] block-once', 'steps[3].when.colour unknown-fact',
  ]);
});

test('conditions', () => {
  const facts = { total: 620, categories: ['travel', 'meals'], currency: 'CHF', 'requester.management': false };
  assert.equal(evaluateCondition({ total: { gt: 500 } }, facts), true);
  assert.equal(evaluateCondition({ total: { lte: 500 } }, facts), false);
  assert.equal(evaluateCondition({ categories: { any: ['hotel', 'travel'] } }, facts), true);
  assert.equal(evaluateCondition({ categories: { none: ['travel'] } }, facts), false);
  assert.equal(evaluateCondition({ currency: { in: ['EUR', 'CHF'] } }, facts), true);
  assert.equal(evaluateCondition({ any: [{ 'requester.management': true }, { not: { total: { lt: 100 } } }] }, facts), true);
  assert.equal(evaluateCondition({ unknown: true }, facts), false);
});

test('the next step skips what does not apply; facts are asked only when needed', async () => {
  const steps = [{ key: 'a' }, { key: 'b', when: { total: { gt: 500 } } }, { key: 'c', when: { total: { gt: 1000 } } }, { key: 'd' }];
  let asked = 0;
  const facts = async () => { asked++; return { total: 620 }; };
  assert.deepEqual(await nextApplicableStep(steps, 0, facts), { index: 0, skipped: [] });
  assert.equal(asked, 0);
  assert.deepEqual(await nextApplicableStep(steps, 1, facts), { index: 1, skipped: [] });
  assert.deepEqual(await nextApplicableStep(steps, 2, facts), { index: 3, skipped: ['c'] });
  assert.deepEqual(await nextApplicableStep([{ key: 'x', when: { total: { gt: 1000 } } }], 0, facts), { index: -1, skipped: ['x'] });
});

test('compiling: actions in order, a review step flagged, the label from the blocks or the configuration', () => {
  const r = validateWorkflowConfig(KIND, { version: 1, steps: [
    { key: 'manager', do: ['review'], assignTo: 'manager' },
    { key: 'settle', do: ['process', 'pay'], assignTo: 'permission:nav.expenseProcessing', label: { de: 'Abrechnen', en: 'Settle' } },
  ] });
  const [m, s] = compileWorkflow(KIND, r.value);
  assert.deepEqual([m.actions, m.returnActions, m.reject, m.review], [['expense.approve'], ['expense.reject'], 'back', true]);
  assert.deepEqual([s.actions, s.returnActions, s.rejectable, s.inDialog, s.label], [['expense.process', 'expense.paid'], [], false, true, 'Settle']);
});

test('codes of departments and teams; team assignees only where a block allows them', () => {
  assert.equal(cleanUnitCode(' Frontdesk '), 'frontdesk');
  assert.equal(cleanUnitCode('it support'), undefined);
  assert.equal(cleanUnitCode(''), null);
  assert.equal(codeFromName('Research & Développement'), 'research-developpement');
  assert.equal(codeFromName('***'), 'unit');
  const steps = (assignTo) => ({ version: 1, steps: [{ key: 'a', do: ['review'], assignTo }] });
  assert.deepEqual(codes(validateWorkflowConfig(KIND, steps('department:frontdesk'))), []);
  assert.deepEqual(codes(validateWorkflowConfig(KIND, steps('team:it-support'))), ['steps[0].assignTo assignee-not-allowed']);
  assert.deepEqual(codes(validateWorkflowConfig(KIND, steps('department:Front Desk'))), ['steps[0].assignTo invalid-assignee']);
});

test('a kind whose first step may be work (a payment run)', () => {
  const run = { ...KIND, firstStepDecides: false };
  const config = { version: 1, steps: [{ key: 'pay', do: ['pay'], assignTo: 'permission:nav.expensePayout' }] };
  assert.deepEqual(codes(validateWorkflowConfig(KIND, config)), ['steps[0].do[0] block-order', 'steps[0].reject first-step-decides']);
  assert.deepEqual(codes(validateWorkflowConfig({ ...run, blocks: { ...KIND.blocks, pay: { ...KIND.blocks.pay, after: [] } } }, config)), []);
});

test('a run may start with a condition; the step with the last block never has one; decisions are flagged', () => {
  const run = { ...KIND, firstStepDecides: false, blocks: { review: { ...KIND.blocks.review, decides: true }, pay: { ...KIND.blocks.pay, after: [] } } };
  const r = validateWorkflowConfig(run, { version: 1, steps: [
    { key: 'approval', do: ['review'], assignTo: 'permission:nav.expensePayout', when: { total: { gt: 100 } } },
    { key: 'pay', do: ['pay'], assignTo: 'permission:nav.expensePayout' },
  ] });
  assert.deepEqual(codes(r), []);
  assert.deepEqual(compileWorkflow(run, r.value).map((s) => !!s.decides), [true, false]);
  assert.deepEqual(codes(validateWorkflowConfig(run, { version: 1, steps: [
    { key: 'pay', do: ['pay'], assignTo: 'permission:nav.expensePayout', when: { total: { gt: 100 } } },
  ] })), ['steps[0].when last-step-condition']);
});

test('a required block must be in every configuration', () => {
  const run = { ...KIND, firstStepDecides: false, blocks: { review: { ...KIND.blocks.review }, pay: { ...KIND.blocks.pay, after: [], required: true } } };
  assert.deepEqual(codes(validateWorkflowConfig(run, { version: 1, steps: [{ key: 'a', do: ['review'], assignTo: 'permission:nav.expensePayout' }] })), ['steps block-required']);
});

test('reject end: rejected for good, the default where the kind has no back', () => {
  const absence = { ...KIND, rejectModes: ['none', 'end'] };
  const r = validateWorkflowConfig(absence, { version: 1, steps: [{ key: 'm', do: ['review'], assignTo: 'manager' }] });
  assert.equal(r.value.steps[0].reject, 'end');
  assert.deepEqual(compileWorkflow(absence, r.value)[0].returnActions, ['expense.reject']);
  assert.deepEqual(codes(validateWorkflowConfig(absence, { version: 1, steps: [{ key: 'm', do: ['review'], assignTo: 'manager', reject: 'back' }] })), ['steps[0].reject invalid-reject']);
});

// A request-like kind: a form block with fields, persons as assignees, steps each one on their own.
const REQ = {
  id: 'requests.request',
  definitionName: 'request',
  rejectModes: ['none', 'back'],
  each: true,
  facts: {},
  blocks: {
    review: { label: 'Approval', action: 'r.ok', returnAction: 'r.back', assignees: ['manager', 'team', 'person'], decides: true },
    form: { label: 'Form', action: 'r.done', returnAction: 'r.back', assignees: ['manager', 'team', 'person'], fields: true },
  },
  defaultConfig: { version: 1, steps: [] },
};
const PERSON = 'person:22222222-2222-2222-2222-222222222224';
const AMOUNT = { key: 'amount', type: 'number', label: { de: 'Betrag', en: 'Amount' }, required: true };

test('a step may go to one person, or to everyone of a team each on their own, and ask fields', () => {
  const r = validateWorkflowConfig(REQ, { version: 1, steps: [
    { key: 'ok', do: ['review'], assignTo: PERSON },
    { key: 'give', do: ['form'], assignTo: 'team:gift', each: true, fields: [AMOUNT, { key: 'note', type: 'text', label: { en: 'Note' } }] },
  ] });
  assert.deepEqual(codes(r), []);
  const steps = compileWorkflow(REQ, r.value);
  assert.equal(steps[1].each, true);
  assert.deepEqual(steps[1].fields.map((f) => f.key), ['amount', 'note']);
});

test('each, person and fields are refused where they do not belong', () => {
  assert.deepEqual(codes(validateWorkflowConfig(REQ, { version: 1, steps: [
    { key: 'ok', do: ['review'], assignTo: PERSON, each: true, fields: [AMOUNT] },
    { key: 'give', do: ['form'], assignTo: 'team:gift' },
    { key: 'more', do: ['form'], assignTo: 'manager', fields: [AMOUNT, { ...AMOUNT, type: 'money', label: {} }] },
  ] })), [
    'steps[0].each each-not-allowed',
    'steps[0].fields fields-not-allowed',
    'steps[1].fields no-fields',
    'steps[2].fields[1].key duplicate-key',
    'steps[2].fields[1].type invalid-field-type',
    'steps[2].fields[1].label invalid-label',
  ]);
  // Kinds without persons or `each` refuse them.
  assert.deepEqual(codes(validateWorkflowConfig(KIND, { version: 1, steps: [
    { key: 'a', do: ['review'], assignTo: PERSON },
    { key: 'b', do: ['review'], assignTo: 'department:sales', each: true },
  ] })), ['steps[0].assignTo assignee-not-allowed', 'steps[1].each each-not-allowed']);
});

test('stepFieldValues checks what someone gives a step', () => {
  const fields = [AMOUNT, { key: 'on', type: 'date', label: { en: 'On' } }, { key: 'ok', type: 'checkbox', label: { en: 'OK' } }, { key: 'note', type: 'text', label: { en: 'Note' } }];
  assert.deepEqual(stepFieldValues(fields, { amount: "1'250.50", on: '2026-12-01', ok: true, note: '  hi ', other: 1 }), { ok: true, values: { amount: 1250.5, on: '2026-12-01', ok: true, note: 'hi' } });
  assert.deepEqual(stepFieldValues(fields, { amount: '' }), { ok: false, error: 'step-field-required', field: 'amount' });
  assert.deepEqual(stepFieldValues(fields, { amount: 'abc' }), { ok: false, error: 'step-field-invalid', field: 'amount' });
  assert.deepEqual(stepFieldValues(fields, { amount: 20, on: '2026-13-45' }), { ok: false, error: 'step-field-invalid', field: 'on' });
  assert.deepEqual(stepFieldValues(fields, { amount: 20 }), { ok: true, values: { amount: 20 } });
});

// An automatic message block: alone in its step, with a subject; to the requester too.
const MAILKIND = {
  ...REQ,
  blocks: {
    ...REQ.blocks,
    form: { ...REQ.blocks.form, assignees: [...REQ.blocks.form.assignees, 'requester'] },
    mail: { label: 'E-mail', action: 'r.mail', assignees: ['manager', 'team', 'person', 'requester'], automatic: true, message: true },
  },
};

test('a message step sends a subject (and text) to its assignees, the requester among them', () => {
  const r = validateWorkflowConfig(MAILKIND, { version: 1, steps: [
    { key: 'ok', do: ['review'], assignTo: PERSON },
    { key: 'done', do: ['mail'], assignTo: 'requester', message: { subject: { de: ' Sammlung fertig ', en: 'Collection done' }, text: { de: 'Danke!' }, answers: true } },
  ] });
  assert.deepEqual(codes(r), []);
  assert.deepEqual(r.value.steps[1].message, { subject: { de: 'Sammlung fertig', en: 'Collection done' }, text: { de: 'Danke!' }, answers: true });
  assert.equal(r.value.steps[1].reject, 'none');
  const steps = compileWorkflow(MAILKIND, r.value);
  assert.equal(steps[1].automatic, true);
  assert.equal(steps[1].message.answers, true);
});

test('a message step is refused without a subject, with other blocks, or each on their own', () => {
  assert.deepEqual(codes(validateWorkflowConfig(MAILKIND, { version: 1, steps: [
    { key: 'ok', do: ['review'], assignTo: PERSON, message: { subject: { de: 'x' } } },
    { key: 'a', do: ['mail'], assignTo: 'team:gift', each: true, message: { subject: { de: '  ' } } },
    { key: 'b', do: ['form', 'mail'], assignTo: 'manager', fields: [AMOUNT], message: { subject: { de: 'x' }, extra: 1 } },
  ] })), [
    'steps[0].message message-not-allowed',
    'steps[1].each each-not-allowed',
    'steps[1].message invalid-message',
    'steps[2].do automatic-alone',
    'steps[2].message invalid-message',
  ]);
});
