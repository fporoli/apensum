import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nextPipelineStage } from '../api/expense-reports.controller';
import { listPage, pageRows } from '../api/list-page';

test('expense pagination opts in, validates the range, and removes the lookahead row', () => {
  assert.equal(listPage(), null);
  assert.deepEqual(listPage('2', '25'), { offset: 50, size: 25 });
  for (const [page, size] of [['-1', '25'], ['1.1', '25'], ['1', '0'], ['0', '101'], ['2147483648', '1']]) {
    assert.throws(() => listPage(page, size), /invalid-pagination/);
  }
  assert.deepEqual(pageRows(['a', 'b', 'c'], 2), { entries: ['a', 'b'], hasMore: true });
  assert.deepEqual(pageRows(['a', 'b'], 2), { entries: ['a', 'b'], hasMore: false });
});

test('nextPipelineStage: approved is processed, then paid; the older in-between stages move on', () => {
  assert.equal(nextPipelineStage('approved'), 'processing_finished');
  assert.equal(nextPipelineStage('submitted_processing'), 'processing_finished');
  assert.equal(nextPipelineStage('processing_finished'), 'finished');
  assert.equal(nextPipelineStage('request_payment'), 'finished');
});

test('nextPipelineStage refuses stages outside or at the end of the pipeline', () => {
  assert.equal(nextPipelineStage('finished'), null);
  assert.equal(nextPipelineStage('in_preparation'), null);
  assert.equal(nextPipelineStage('submitted'), null);
  assert.equal(nextPipelineStage('rejected'), null);
});
