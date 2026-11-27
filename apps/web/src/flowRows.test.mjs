import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { NO_FILTERS, flowQueries, flowRows, shownFrom } from './flowRows.ts';

const label = {
  flow: (r) => ({ title: r.subject, type: r.flow_type ?? 'free', line: '', status: { label: r.status, color: 'info' } }),
  item: (i) => ({ title: i.id, type: i.definition_name, line: '', status: { label: i.step_status, color: 'info' } }),
};
const req = (id, status, box, at, extra = {}) => ({ id, subject: id, status, box, last_activity_at: at, flow_type: null, urgent: false, confidential: false, ...extra });
const item = (id, step_status, source_table, started, extra = {}) => ({ id, step_status, source_table, started, definition_name: 'approve absence', ...extra });

test('to do: open requests and pending items, a request\'s workflow item once, newest first', () => {
  const rows = flowRows('todo',
    [req('r1', 'open', 'inbox', '2026-11-20T10:00:00Z'), req('r2', 'resolved', 'inbox', '2026-11-25T10:00:00Z'), req('r3', 'in_progress', 'inbox', '2026-11-24T10:00:00Z', { urgent: true })],
    [item('w1', 'pending', 'absences', '2026-11-22T10:00:00Z'), item('w2', 'pending', 'flows', '2026-11-26T10:00:00Z')],
    label, true);
  assert.deepEqual(rows.map((r) => `${r.source}:${r.id}`), ['flow:r3', 'workflow:w1', 'flow:r1']);
  assert.equal(rows[0].urgent, true);
});

test('without free flows (module off) a request\'s workflow item is listed itself', () => {
  const rows = flowRows('todo', [], [item('w2', 'pending', 'flows', '2026-11-26T10:00:00Z')], label, false);
  assert.deepEqual(rows.map((r) => r.id), ['w2']);
});

test('done: decided items, resolved requests of the inbox and archived ones, each once', () => {
  const rows = flowRows('done',
    [req('r1', 'open', 'inbox', '2026-11-20T10:00:00Z'), req('r2', 'resolved', 'inbox', '2026-11-25T10:00:00Z'), req('r2', 'resolved', 'archived', '2026-11-25T10:00:00Z'), req('r4', 'open', 'archived', '2026-11-21T10:00:00Z')],
    [item('w1', 'pending', 'absences', '2026-11-22T10:00:00Z'), item('w3', 'approved', 'absences', '2026-11-01T10:00:00Z', { finished: '2026-11-23T10:00:00Z' })],
    label, true);
  assert.deepEqual(rows.map((r) => `${r.source}:${r.id}`), ['flow:r2', 'workflow:w3', 'flow:r4']);
});

test("done: a flow one did a step of shows while it waits with someone else (recalled), pending ones of one's own queue do not", () => {
  const rows = flowRows('done', [],
    [item('w1', 'pending', 'expense_payruns', '2026-11-26T10:00:00Z', { assigned_to_me: false }), item('w2', 'pending', 'absences', '2026-11-25T10:00:00Z', { assigned_to_me: true })],
    label, true);
  assert.deepEqual(rows.map((r) => r.id), ['w1']);
});

const ORG = '00000000-0000-4000-8000-000000000001';
const TODAY = new Date('2026-11-27T10:00:00Z');
const params = (q) => (q === null ? null : Object.fromEntries(new URLSearchParams(q)));

test('flowQueries: each tab asks both sources, To do only what is open', () => {
  assert.deepEqual(params(flowQueries('todo', NO_FILTERS, ORG, true, TODAY).workflows), { scope: 'assigned', status: 'pending', orgId: ORG });
  assert.deepEqual(params(flowQueries('todo', NO_FILTERS, ORG, true, TODAY).flows), { box: 'inbox', state: 'open' });
  assert.deepEqual(params(flowQueries('mine', NO_FILTERS, ORG, true, TODAY).workflows), { scope: 'mine', status: 'all', orgId: ORG });
  assert.deepEqual(params(flowQueries('done', NO_FILTERS, ORG, true, TODAY).flows), { box: 'done' });
  assert.equal(flowQueries('done', NO_FILTERS, ORG, false, TODAY).flows, null, 'without Free Flows only the workflow items');
});

test('flowQueries: the filters go to the source that has such flows', () => {
  const absences = flowQueries('done', { ...NO_FILTERS, type: 'def:approve absence' }, ORG, true, TODAY);
  assert.equal(params(absences.workflows).definition, 'approve absence');
  assert.equal(absences.flows, null, 'an absence is no row of flows');
  const free = flowQueries('done', { ...NO_FILTERS, type: 'free' }, ORG, true, TODAY);
  assert.equal(free.workflows, null);
  assert.equal(params(free.flows).type, 'free');
  const own = flowQueries('done', { ...NO_FILTERS, type: 'type:it' }, ORG, false, TODAY);
  assert.equal(params(own.workflows).definition, 'flow:it', 'an own type without Free Flows: its workflow items');
  const all = flowQueries('done', { type: '', days: 30, state: 'rejected', person: ORG, q: ' Zoë ' }, ORG, true, TODAY);
  assert.deepEqual(params(all.workflows), { scope: 'assigned', status: 'all', orgId: ORG, state: 'rejected', since: '2026-10-28', person: ORG, q: 'Zoë' });
  assert.equal(all.flows, null, 'a Free Flow is never sent back');
  assert.equal(params(flowQueries('done', { ...NO_FILTERS, state: 'done' }, ORG, true, TODAY).workflows).state, 'approved');
});

test('flowQueries: no status filter in To do, no person in Mine', () => {
  const todo = flowQueries('todo', { ...NO_FILTERS, state: 'done', person: ORG }, ORG, true, TODAY);
  assert.equal(params(todo.workflows).state, undefined);
  assert.equal(params(todo.flows).state, 'open');
  assert.equal(params(todo.flows).person, ORG);
  assert.equal(params(flowQueries('mine', { ...NO_FILTERS, person: ORG }, ORG, true, TODAY).workflows).person, undefined);
});

test('shownFrom: while a source has more, nothing older than its oldest loaded row', () => {
  assert.equal(shownFrom([{ more: false, oldest: '2020-01-01T00:00:00Z' }, { more: false, oldest: null }]), null);
  assert.equal(shownFrom([{ more: true, oldest: '2025-06-01 08:00:00+00' }, { more: false, oldest: '2020-01-01T00:00:00Z' }]), Date.parse('2025-06-01T08:00:00Z'));
  assert.equal(shownFrom([{ more: true, oldest: '2024-01-01T00:00:00Z' }, { more: true, oldest: '2025-01-01T00:00:00Z' }]), Date.parse('2025-01-01T00:00:00Z'), 'the newer of the two');
});
