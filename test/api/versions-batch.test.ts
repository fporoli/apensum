import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { groupVersionEntries } from '../../apps/api/src/versions.service';

const entry = (action: 'insert' | 'update_delta', record: unknown) => ({ action, actioned_by_user_uuid: 'u1', actioned_date: '2026-11-27T10:00:00.000Z', record });

test('a batch writes one row per record, its entries in order and numbered from 1 (renumbered on from version_nr in SQL)', () => {
  const rows = groupVersionEntries([
    { sourceTable: 'work_times', sourceTableUuid: 'a', actorUserId: 'u1', entry: entry('insert', { x: 1 }) },
    { sourceTable: 'workflows', sourceTableUuid: 'b', actorUserId: 'u1', entry: entry('insert', { s: 'pending' }) },
    { sourceTable: 'work_times', sourceTableUuid: 'a', actorUserId: 'u2', entry: entry('update_delta', { x: 2 }) },
  ]);
  assert.equal(rows.length, 2);
  const a = rows.find((r) => r.source_table_uuid === 'a')!;
  assert.deepEqual(a.entries.map((e) => [e.version, e.action, (e.record as { x: number }).x]), [[1, 'insert', 1], [2, 'update_delta', 2]]);
  assert.equal(a.actor, 'u2', 'the last writer is the one who modified it last');
});
