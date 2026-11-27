import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWorkflow, fillPlaceholders, validateWorkflowConfig } from '@worktime3/shared/workflowConfig';
import { FLOW_CATALOGUE } from '../../apps/api/src/flow-steps';
import { composeDate, composeMailText, composeValues } from '../../apps/api/src/flow-compose';
import { WorkflowsService, composeSent, takenOf } from '../../apps/api/src/workflows.service';

const message = { subject: { de: '{{years}} Dienstjahre: {{name}}' }, text: { de: 'Liebe/r {{firstName}}, am {{date}} … {{unknown}}' } };
const step = (over: Record<string, unknown>) => ({ key: 'gratulate', do: ['compose'], assignTo: 'department:hr', reject: 'none', message, ...over });

test('placeholders: known ones filled, unknown and empty ones stay as typed', () => {
  assert.equal(fillPlaceholders('Hallo {{name}}, {{ firstName }}! {{nope}} {{date}}', { name: 'Marco A', firstName: 'Marco', date: '' }), 'Hallo Marco A, Marco! {{nope}} {{date}}');
});

test('compose values: the first name falls back to the name, dates the Swiss way, a confidential subject stays out', () => {
  const v = composeValues({ aboutName: 'Marco Arnold', aboutFirstName: null, subject: '5 Dienstjahre', confidential: true, taskData: { date: '2027-01-01', years: 5 }, senderName: 'Hanna' }, 'de');
  assert.deepEqual(v, { name: 'Marco Arnold', firstName: 'Marco', date: '01.01.2027', years: '5', subject: null, sender: 'Hanna' });
  assert.equal(composeDate('2027-01-01', 'fr'), '01.01.2027');
  assert.equal(composeDate('soon', 'de'), 'soon');
  assert.equal(composeMailText('  Hallo\n\nFreundliche Grüsse\nHanna  '), 'Hallo\n\nFreundliche Grüsse\nHanna\n');
});

test('config: a compose step needs its template, its recipient defaults to the person and is checked', () => {
  const ok = validateWorkflowConfig(FLOW_CATALOGUE, { version: 1, steps: [step({ reject: 'back' })] });
  assert.ok(ok.ok);
  assert.equal(ok.ok && ok.value.steps[0].mailTo, 'about');
  const noTemplate = validateWorkflowConfig(FLOW_CATALOGUE, { version: 1, steps: [step({ reject: 'back', message: undefined })] });
  assert.ok(!noTemplate.ok && noTemplate.errors.some((e) => e.code === 'invalid-message'));
  const badTo = validateWorkflowConfig(FLOW_CATALOGUE, { version: 1, steps: [step({ reject: 'back', mailTo: 'everyone' })] });
  assert.ok(!badTo.ok && badTo.errors.some((e) => e.code === 'invalid-mail-to'));
  const notCompose = validateWorkflowConfig(FLOW_CATALOGUE, { version: 1, steps: [{ key: 'a', do: ['task'], assignTo: 'manager', reject: 'back', mailTo: 'about' }] });
  assert.ok(!notCompose.ok && notCompose.errors.some((e) => e.code === 'mail-to-not-allowed'));
});

test('compile: a step to several people is taken over first (not each, not a person); compose carries its recipient', () => {
  const steps = compileWorkflow(FLOW_CATALOGUE, {
    version: 1,
    steps: [
      { key: 'a', do: ['review'], assignTo: 'department:hr', reject: 'back' },
      { key: 'b', do: ['compose'], assignTo: 'team:office', reject: 'none', message, mailTo: 'aboutManager' },
      { key: 'c', do: ['task'], assignTo: 'department:hr', reject: 'none', each: true },
      { key: 'd', do: ['task'], assignTo: 'manager', reject: 'none' },
    ],
  });
  assert.deepEqual(steps.map((s) => !!s.takeOver), [true, true, false, false]);
  assert.equal(steps[1].compose, true);
  assert.equal(steps[1].mailTo, 'aboutManager');
});

test('taken and composed are read per step', () => {
  const data = { taken: { step: 'b', by: 'u1', from: ['u1', 'u2'] }, composed: { b: { by: 'u1' } } };
  assert.deepEqual(takenOf(data, 'b'), { by: 'u1', from: ['u1', 'u2'] });
  assert.equal(takenOf(data, 'a'), null);
  assert.equal(composeSent(data, 'b'), true);
  assert.equal(composeSent(data, 'a'), false);
});

/** An engine whose workflow is `w`; `advance` records that it was reached; updates are kept. */
function engine(w: Record<string, unknown>) {
  const updates: unknown[] = [];
  const notified: string[][] = [];
  const db = {
    execute: async () => ({ rows: [] }),
    update: () => ({ set: (patch: unknown) => ({ where: () => { updates.push(patch); return { returning: async () => [{ id: w.id }] }; } }) }),
  };
  const svc = new WorkflowsService(
    { record: async () => {} } as never,
    { record: async () => {} } as never,
    { notifyMany: async (n: { recipientUserIds: string[] }) => { notified.push(n.recipientUserIds); } } as never,
  );
  const s = svc as unknown as Record<string, unknown>;
  s.loadWorkflow = async () => w;
  s.rerouteToCurrentManagers = async () => 0;
  let advanced = false;
  s.advance = async () => { advanced = true; return { ok: true }; };
  return { svc, db: db as never, updates, notified, advanced: () => advanced };
}

const compiled = compileWorkflow(FLOW_CATALOGUE, { version: 1, steps: [step({ reject: 'none' })] });
const workflowOf = (assignees: string[], data: Record<string, unknown> = {}) => ({
  id: 'w1', organization_id: 'o1', source_table: 'flows', source_table_uuid: 'f1', step: 'gratulate', step_status: 'pending',
  assigned_to_user_id: assignees, assigned_to_team_id: null, workflow_data: data, started: null, definition_name: 'flow:x', steps: compiled, own_steps: compiled,
});

test('a step several people got is taken over before it is done; its e-mail goes out before it is done', async () => {
  let e = engine(workflowOf(['u1', 'u2']));
  assert.deepEqual(await e.svc.resolve(e.db, 'w1', 'u1', 'approved', undefined), { ok: false, error: 'take-first' });
  e = engine(workflowOf(['u1']));
  assert.deepEqual(await e.svc.resolve(e.db, 'w1', 'u1', 'approved', undefined), { ok: false, error: 'mail-not-sent' });
  assert.equal(e.advanced(), false);
  e = engine(workflowOf(['u1'], { composed: { gratulate: { by: 'u1' } } }));
  assert.deepEqual(await e.svc.resolve(e.db, 'w1', 'u1', 'approved', undefined), { ok: true });
  assert.equal(e.advanced(), true);
});

test('take over: only an assignee, then it waits for them alone; only who took it gives it back to everyone', async () => {
  let e = engine(workflowOf(['u1', 'u2', 'u3']));
  assert.deepEqual(await e.svc.take(e.db, 'w1', 'x9'), { ok: false, error: 'forbidden' });
  const took = await e.svc.take(e.db, 'w1', 'u2');
  assert.ok(took.ok);
  const patch = e.updates[0] as { assigned_to_user_id: string[]; workflow_data: { taken: unknown } };
  assert.deepEqual(patch.assigned_to_user_id, ['u2']);
  assert.deepEqual(patch.workflow_data.taken, { step: 'gratulate', by: 'u2', from: ['u1', 'u2', 'u3'] });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(e.notified[0], ['u1', 'u3']);

  e = engine(workflowOf(['u2'], { taken: { step: 'gratulate', by: 'u2', from: ['u1', 'u2', 'u3'] } }));
  assert.deepEqual(await e.svc.take(e.db, 'w1', 'u1', true), { ok: false, error: 'forbidden' });
  assert.ok((await e.svc.take(e.db, 'w1', 'u2', true)).ok);
  const back = e.updates[0] as { assigned_to_user_id: string[]; workflow_data: Record<string, unknown> };
  assert.deepEqual(back.assigned_to_user_id, ['u1', 'u2', 'u3']);
  assert.equal('taken' in back.workflow_data, false);
  // Alone on it: nothing to take.
  e = engine(workflowOf(['u1']));
  assert.deepEqual(await e.svc.take(e.db, 'w1', 'u1'), { ok: false, error: 'already-taken' });
});
