import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { nextPipelineStage } from '../api/expense-reports.controller';

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
