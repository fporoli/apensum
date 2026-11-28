import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BillablesService, registerBillableSource, type BillableItem } from '../../apps/api/src/billables.service';

const item = (id: string, over: Partial<BillableItem> = {}): BillableItem => ({
  kind: 'x', id, projectId: 'p1', projectName: 'P', subprojectId: null, date: '2026-11-01', description: 'Fahrt', amount: 10, currency: 'CHF',
  userId: 'u1', userName: 'Anna', documentId: null, ...over,
});

// The organization's modules: none switched on (a source of a module offers nothing then).
const db = { execute: async () => ({ rows: [{ modules: {}, licenses: [] }] }) } as never;

test('billables: the sources that apply, each labelled with its kind; a failing one is left out', async () => {
  const asked: unknown[] = [];
  registerBillableSource({
    kind: 'test-open', open: async (_db, q) => { asked.push(q); return [item('a1')]; }, byIds: async (_db, q) => q.ids.map((id) => item(id)),
  });
  registerBillableSource({ kind: 'test-broken', open: async () => { throw new Error('boom'); }, byIds: async () => { throw new Error('boom'); } });
  registerBillableSource({ kind: 'test-off', module: 'no-such-module', open: async () => [item('z')], byIds: async () => [item('z')] });
  const svc = new BillablesService();
  const open = await svc.open(db, { orgId: 'o1', projectIds: ['p1'], subprojectId: null, to: '2026-11-30' });
  assert.deepEqual(open.map((i) => `${i.kind}:${i.id}`), ['test-open:a1']);
  assert.deepEqual(asked, [{ orgId: 'o1', projectIds: ['p1'], subprojectId: null, to: '2026-11-30' }]);
  assert.deepEqual(await svc.open(db, { orgId: 'o1', projectIds: [], subprojectId: null, to: '2026-11-30' }), [], 'no projects, nothing asked');
  const byIds = await svc.byIds(db, 'o1', [{ kind: 'test-open', id: 'b1' }, { kind: 'unknown', id: 'c1' }]);
  assert.deepEqual(byIds.map((i) => `${i.kind}:${i.id}`), ['test-open:b1']);
  assert.deepEqual(await svc.kinds(db, 'o1'), ['test-open', 'test-broken']);
  assert.throws(() => registerBillableSource({ kind: 'test-open', open: async () => [], byIds: async () => [] }), /registered twice/);
});
