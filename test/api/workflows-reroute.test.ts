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

/**
 * A database for the rerouting: the pending requests given, the acting manager per person, who was ever their
 * manager, who is above whom; it records the updates.
 */
function rerouteDb(opts: {
  pending: Array<{ workflow_id: string; assignee: string; subject: string; assignee_present: boolean }>;
  acting: Record<string, string | null>;
  everManager: Array<[subject: string, manager: string]>;
  above?: Array<[manager: string, subject: string]>;
}) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const updates: unknown[][] = [];
  const db = {
    execute: async (q: SQL) => {
      const query = dialect.sqlToQuery(q);
      queries.push(query);
      if (queries.length === 1) {
        return { rows: opts.pending.map((p) => ({ ...p, organization_id: ORG, source_table: 'plugin_things', source_table_uuid: `t-${p.workflow_id}` })) };
      }
      if (query.sql.includes('WITH RECURSIVE chain(manager_user_id')) return { rows: [{ manager_user_id: opts.acting[query.params[1] as string] ?? null }] };
      if (query.sql.includes('WITH RECURSIVE cur')) {
        // isAboveInReportingLine: organization, today, the person, the one above.
        const [, , subject, manager] = query.params as string[];
        return { rows: (opts.above ?? []).some(([m, s]) => m === manager && s === subject) ? [{ '?column?': 1 }] : [] };
      }
      if (query.sql.startsWith('SELECT 1 FROM employee_assignments')) {
        const [, subject, manager] = query.params as string[];
        return { rows: opts.everManager.some(([s, m]) => s === subject && m === manager) ? [{ '?column?': 1 }] : [] };
      }
      if (query.sql.startsWith('UPDATE workflows')) {
        updates.push(query.params);
        return { rows: [{ workflow_id: query.params[1] }] };
      }
      return { rows: [] };
    },
  };
  return { db, queries, updates };
}

test("rerouting moves what is still with an earlier manager to the one who acts today", async () => {
  const { svc, notified } = service();
  svc.registerManagerRoutedWorkflow('approve plugin thing');
  const { db, queries, updates } = rerouteDb({
    pending: [{ workflow_id: 'w1', assignee: 'old', subject: 'p1', assignee_present: true }],
    acting: { p1: 'new' },
    everManager: [['p1', 'old']],
  });
  assert.equal(await svc.rerouteToCurrentManagers(db as never), 1);
  assert.ok(queries[0].params.includes('approve plugin thing'), 'the registered workflow is manager-routed');
  assert.ok(queries[0].params.includes('approve timesheet'), 'so are the core ones');
  assert.deepEqual(updates, [['new', 'w1', 'old']]);
  assert.deepEqual(notified.map((n) => [n.recipientUserIds, n.sourceTable]), [[['new'], 'plugin_things']]);
});

test('a request with a manager who has left goes to the next one up; one with someone else stays', async () => {
  const { svc, notified } = service();
  const { db, updates } = rerouteDb({
    pending: [
      // Their manager left; HR named nobody yet: the skip-level manager acts.
      { workflow_id: 'w-left', assignee: 'gone', subject: 'p1', assignee_present: false },
      // With someone who is there, was never p2's manager and is not above p2 (another step's person): stays.
      { workflow_id: 'w-other', assignee: 'someone', subject: 'p2', assignee_present: true },
      // With the skip-level who stood in, now that a successor is named: on to the successor.
      { workflow_id: 'w-stood-in', assignee: 'skip', subject: 'p3', assignee_present: true },
      // Nobody above is still there: stays (HR and admin reach it anyway).
      { workflow_id: 'w-nobody', assignee: 'gone2', subject: 'p4', assignee_present: false },
    ],
    acting: { p1: 'skip', p2: 'boss2', p3: 'successor', p4: null },
    everManager: [['p1', 'gone'], ['p3', 'gone3']],
    above: [['skip', 'p3']],
  });
  assert.equal(await svc.rerouteToCurrentManagers(db as never), 2);
  assert.deepEqual(updates, [['skip', 'w-left', 'gone'], ['successor', 'w-stood-in', 'skip']]);
  assert.deepEqual(notified.map((n) => n.recipientUserIds), [['skip'], ['successor']]);
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
