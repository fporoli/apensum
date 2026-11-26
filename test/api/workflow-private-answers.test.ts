import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { visibleThread } from '../../apps/api/src/request-workflow';
import { withoutInputs } from '../../apps/api/src/workflows.controller';

const REQUESTER = 'u-req';
const values = [{ key: 'amount', type: 'number', label: { de: 'Betrag' }, value: 20 }];
const thread = [
  { id: 'm1', author_user_id: 'u-a', kind: 'event', data: { workflow: 'done', values, private: true } },
  { id: 'm2', author_user_id: 'u-b', kind: 'event', data: { workflow: 'done', values: [{ ...values[0], value: 30 }], private: true } },
  { id: 'm3', author_user_id: 'u-c', kind: 'event', data: { workflow: 'done', values } },
  { id: 'm4', author_user_id: 'u-b', kind: 'message', body: 'hi', data: null },
];

test('answers for the requester only: the requester sees all, their author their own, the others that someone answered', () => {
  assert.deepEqual(visibleThread(thread, REQUESTER, REQUESTER), thread);
  const forA = visibleThread(thread, 'u-a', REQUESTER);
  assert.deepEqual(forA[0].data, thread[0].data);
  assert.deepEqual(forA[1].data, { workflow: 'done', private: true });
  // Answers that are not private stay for everyone; plain messages are untouched.
  assert.deepEqual(forA[2], thread[2]);
  assert.deepEqual(forA[3], thread[3]);
  // A task without a requester (no one is the requester).
  assert.deepEqual(visibleThread(thread, 'u-c', null)[0].data, { workflow: 'done', private: true });
});

test('the Workflow page never returns the form steps\' answers', () => {
  assert.deepEqual(withoutInputs({ submittedByUserId: 'x', inputs: { give: { 'u-a': { values: { amount: 20 } } } }, history: [] }), { submittedByUserId: 'x', history: [] });
  assert.equal(withoutInputs(null), null);
  assert.deepEqual(withoutInputs({ reason: 'r' }), { reason: 'r' });
});
