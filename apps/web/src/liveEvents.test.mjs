import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveMatches, publishLive, subscribeLive } from './liveEvents.ts';

test('a push reaches the lists of its table; a resync reaches every list', () => {
  const push = { sourceTable: 'flows', sourceId: 'f1' };
  assert.equal(liveMatches(push, ['flows', 'workflows']), true);
  assert.equal(liveMatches(push, ['absences']), false);
  assert.equal(liveMatches(push, true), true);
  assert.equal(liveMatches({ sourceTable: null, sourceId: null, resync: true }, ['absences']), true);
  assert.equal(liveMatches({ sourceTable: null, sourceId: null }, ['absences']), false);
});

test('subscribers get each event until they leave; one that throws does not stop the others', () => {
  const got = [];
  const offBad = subscribeLive(() => { throw new Error('page broke'); });
  const off = subscribeLive((e) => got.push(e.sourceTable));
  publishLive({ sourceTable: 'flows', sourceId: 'a' });
  off();
  publishLive({ sourceTable: 'absences', sourceId: 'b' });
  offBad();
  assert.deepEqual(got, ['flows']);
});
