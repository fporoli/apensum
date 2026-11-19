import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PluginRegistrar } from '../../apps/api/src/plugin-registrar';
import type { ApiPlugin } from '../../apps/api/src/plugin';

test("PluginRegistrar registers a plugin's workflows and documents with the core services", async () => {
  const calls: string[] = [];
  const actions = new Map<string, (db: never, ctx: never) => Promise<void>>();
  const workflows = {
    registerAction: (name: string, handler: (db: never, ctx: never) => Promise<void>) => { calls.push(`action ${name}`); actions.set(name, handler); },
    registerSourceOrgResolver: (table: string) => calls.push(`org ${table}`),
    registerSourceRecords: (table: string, field: string) => calls.push(`records ${table} ${field}`),
    registerManagerRoutedWorkflow: (name: string) => calls.push(`routed ${name}`),
  };
  const documents = { registerPersonalDocuments: (category: string) => calls.push(`documents ${category}`) };
  const versions = { tag: 'versions' };
  const audit = { tag: 'audit' };
  let coreSeen: unknown;
  const plugin: ApiPlugin = {
    id: 'demo',
    workflows: {
      actions: { 'demo.approve': async (_db, _ctx, core) => { coreSeen = core; } },
      sources: {
        demo_things: { organization: async () => 'org', records: { field: 'demo_thing', load: async () => [] } },
        demo_other: { organization: async () => null },
      },
      managerRouted: ['approve demo thing'],
    },
    documents: { demo: async () => [] },
  };
  new PluginRegistrar([plugin], workflows as never, documents as never, versions as never, audit as never).onModuleInit();
  assert.deepEqual(calls, [
    'action demo.approve',
    'org demo_things',
    'records demo_things demo_thing',
    'org demo_other',
    'routed approve demo thing',
    'documents demo',
  ]);
  await actions.get('demo.approve')!({} as never, {} as never);
  assert.deepEqual(coreSeen, { versions, audit }, 'actions get the core services');
});
