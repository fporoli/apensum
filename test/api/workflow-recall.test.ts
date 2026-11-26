import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { workflowRecallDays } from '../../apps/api/src/workflows.controller';

test('workflowRecallDays: WORKFLOW_RECALL_DAYS, else 5', () => {
  assert.equal(workflowRecallDays({}), 5);
  assert.equal(workflowRecallDays({ WORKFLOW_RECALL_DAYS: '' }), 5);
  assert.equal(workflowRecallDays({ WORKFLOW_RECALL_DAYS: '10' }), 10);
  assert.equal(workflowRecallDays({ WORKFLOW_RECALL_DAYS: '0' }), 0);
  assert.equal(workflowRecallDays({ WORKFLOW_RECALL_DAYS: '-1' }), 5);
  assert.equal(workflowRecallDays({ WORKFLOW_RECALL_DAYS: 'week' }), 5);
});
