import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { flowRows } from './flowRows.ts';

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
