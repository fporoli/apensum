import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseWorkflowCursor, workflowCursor } from '../../apps/api/src/workflows.controller';

const ID = '3f0c8a2e-1b2c-4d5e-8f90-123456789abc';

test('the list cursor carries the step start and the id, and reads back', () => {
  const c = workflowCursor({ id: ID, started: '2026-11-27 08:15:00+00' });
  assert.equal(c, `2026-11-27T08:15:00.000Z|${ID}`);
  assert.deepEqual(parseWorkflowCursor(c), { started: '2026-11-27T08:15:00.000Z', id: ID });
  assert.equal(workflowCursor({ id: ID, started: null }), `1970-01-01T00:00:00.000Z|${ID}`, 'older rows without a start sort last');
});

test('a malformed cursor is no cursor (the first page)', () => {
  for (const bad of [undefined, '', 'x|y', `not-a-date|${ID}`, '2026-11-27T08:15:00Z|not-an-id', "2026-11-27T08:15:00Z|1'; DROP TABLE x;--"]) assert.equal(parseWorkflowCursor(bad), null);
});
