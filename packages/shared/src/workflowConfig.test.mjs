import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanUnitCode, codeFromName, compileWorkflow, evaluateCondition, nextApplicableStep, validateWorkflowConfig } from './workflowConfig.ts';

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
