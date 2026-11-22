import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { workflowHistory } from '../../apps/api/src/workflows.service';

test('a stored history is returned as it is, without broken entries', () => {
  const history = [
    { key: 'approvals.event.submitted', by: 'u', at: '2026-11-20T08:00:00Z' },
    { key: 'approvals.event.approved', by: 'm', at: '2026-11-21T09:00:00Z', note: 'ok' },
    { key: 'expenseProcessing.stage.processing_finished', by: 'h', at: '2026-11-22T10:00:00Z' },
    { by: 'x' },
  ];
  assert.deepEqual(workflowHistory({ history }, { started: null, finished: null, status: null }), history.slice(0, 3));
});

test('without a stored history: submitted from the start, the decision without who made it', () => {
  const data = { submittedByUserId: 'u', decisionNote: 'Danke' };
  assert.deepEqual(workflowHistory(data, { started: '2026-11-20T08:00:00Z', finished: '2026-11-21T09:00:00Z', status: 'approved' }), [
    { key: 'approvals.event.submitted', by: 'u', at: '2026-11-20T08:00:00Z' },
    { key: 'approvals.event.approved', by: null, at: '2026-11-21T09:00:00Z', note: 'Danke' },
  ]);
  assert.deepEqual(workflowHistory({}, { started: '2026-11-20T08:00:00Z', finished: null, status: 'pending' }), [
    { key: 'approvals.event.submitted', by: null, at: '2026-11-20T08:00:00Z' },
  ]);
});
