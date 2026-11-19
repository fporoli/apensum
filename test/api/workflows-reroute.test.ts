import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { WorkflowsService } from '../../apps/api/src/workflows.service';

const dialect = new PgDialect();
const ORG = '00000000-0000-0000-0000-00000000000a';

function service() {
  const notified: Array<{ recipientUserIds: string[]; sourceTable: string }> = [];
  const svc = new WorkflowsService(
    {} as never,
    { record: async () => {} } as never,
    { notifyMany: async (n: { recipientUserIds: string[]; sourceTable: string }) => { notified.push(n); } } as never,
  );
  return { svc, notified };
}

test('rerouting asks the owners of the source tables for the organization and moves only what it can place', async () => {
  const { svc, notified } = service();
  svc.registerManagerRoutedWorkflow('approve plugin thing');
  const asked: string[] = [];
  svc.registerSourceOrgResolver('plugin_things', async (_db, id) => {
    asked.push(id);
    return ORG;
  });
  const queries: { sql: string; params: unknown[] }[] = [];
  const db = {
    execute: async (q: SQL) => {
      queries.push(dialect.sqlToQuery(q));
      if (queries.length === 1) {
        return {
          rows: [
            { workflow_id: 'w1', source_table: 'plugin_things', source_table_uuid: 't1', assignee: 'old', subject: 'p1' },
            // No resolver for this table: it stays where it is.
            { workflow_id: 'w2', source_table: 'unknown_things', source_table_uuid: 'u1', assignee: 'old', subject: 'p2' },
          ],
        };
      }
      return { rows: [{ workflow_id: 'w1', source_table: 'plugin_things', source_table_uuid: 't1', organization_id: ORG, manager: 'new' }] };
    },
  };
  const moved = await svc.rerouteToCurrentManagers(db as never);
  assert.equal(moved, 1);
  assert.deepEqual(asked, ['t1']);
  assert.ok(queries[0].params.includes('approve plugin thing'), 'the registered workflow is manager-routed');
  assert.ok(queries[0].params.includes('approve timesheet'), 'so are the core ones');
  assert.deepEqual(queries[1].params.slice(0, 4), ['w1', ORG, 'p1', 'old']);
  assert.ok(!queries[1].params.includes('w2'));
  assert.deepEqual(notified.map((n) => [n.recipientUserIds, n.sourceTable]), [[['new'], 'plugin_things']]);
});

test('rerouting with nothing to place runs no update', async () => {
  const { svc } = service();
  let calls = 0;
  const db = { execute: async () => { calls++; return { rows: [] }; } };
  assert.equal(await svc.rerouteToCurrentManagers(db as never), 0);
  assert.equal(calls, 1);
});

test('plugins register record loaders for the Workflow page', async () => {
  const { svc } = service();
  svc.registerSourceRecords('plugin_things', 'plugin_thing', async (_db, ids) => ids.map((id) => ({ id })));
  const entry = svc.sourceRecords().get('plugin_things');
  assert.equal(entry?.field, 'plugin_thing');
  assert.deepEqual(await entry?.load({} as never, ['a']), [{ id: 'a' }]);
});
